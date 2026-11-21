# KAZI AFRICA — analyse antivirus des documents Emploi

## Architecture livrée

Le worker `scripts/scan-employment-documents.ts` traite les documents candidats stockés dans le bucket Firebase privé. Il utilise le protocole `INSTREAM` de ClamAV (`clamd`) sur un réseau privé. Les CV et justificatifs ne sont pas envoyés à un service public d'analyse.

Commande :

```bash
bun run employment:scan-documents
```

Variables serveur :

- `CLAMAV_HOST` : nom DNS ou adresse privée du daemon clamd (obligatoire).
- `CLAMAV_PORT` : port TCP clamd, 3310 par défaut.
- `CLAMAV_TIMEOUT_MS` : délai maximal d'analyse, 20 secondes par défaut.
- `EMPLOYMENT_SCAN_BATCH_SIZE` : taille du lot, limitée à 50 (10 par défaut).

## Invariants de sécurité

1. Le worker refuse de démarrer si `CLAMAV_HOST` n'est pas configuré. Il ne revendique aucun document.
2. Le worker revendique atomiquement les documents `QUARANTINED` et récupère les états `SCANNING` abandonnés depuis plus de 15 minutes.
3. Avant analyse, il vérifie la taille réelle, la signature PDF et le SHA-256 par rapport aux métadonnées PostgreSQL.
4. Seul le verdict explicite `OK` du scanner permet le passage à `CLEAN`.
5. Un verdict infecté ou un faux PDF entraîne `REJECTED`.
6. Une erreur réseau, un timeout, une erreur de stockage ou une incohérence de hash replace le document en `QUARANTINED`. Aucun échec technique ne peut produire `CLEAN`.
7. Les URLs signées recruteur existantes restent conditionnées à `CLEAN` et au consentement actif du candidat.

## Déploiement requis — non effectué par ce commit

- Provisionner ClamAV/clamd dans un réseau privé, maintenir ses signatures à jour et n'exposer son port qu'au worker.
- Configurer les variables d'environnement dans le secret manager du serveur/worker.
- Exécuter le worker via un ordonnanceur (par exemple toutes les minutes) avec une identité de service limitée au bucket privé et à la base KAZI.
- Configurer alertes sur erreurs, documents en quarantaine persistante, et âge des états `SCANNING`.
- Tester sur un environnement de préproduction avec le fichier de test EICAR, un PDF sain, un PDF invalide, un scanner indisponible et un hash altéré.
- Appliquer les migrations et vérifier les permissions Firebase/SQL avant activation.

**État réel :** le code du worker est présent et appelable ; aucun daemon ClamAV, secret, ordonnanceur ni environnement de production n'a été configuré ou testé par ce commit. Tant que `CLAMAV_HOST` n'est pas défini et que le worker n'est pas exécuté, les documents restent en quarantaine.


## Déploiement Docker Compose (serveur privé)

Fichiers livrés :

- `Dockerfile.employment-scanner` : image minimale du worker, exécutée avec l'utilisateur non-root `bun`.
- `compose.employment-scanner.yml` : ClamAV et worker sur le même réseau Docker ; le port 3310 n'est pas publié sur Internet.
- `.dockerignore` et exclusion du dossier local `secrets/` de Git.

Préparation sur le serveur :

1. Installer Docker Engine et le plugin Docker Compose.
2. Créer un fichier `.env` non versionné avec les variables PostgreSQL nécessaires au worker (`SQL_HOST`, `SQL_USER`, `SQL_PASSWORD`, `SQL_DB_NAME`). `SQL_HOST` doit être joignable depuis le réseau Docker.
3. Créer `secrets/firebase-service-account.json` à partir d'un compte de service dédié. Lui accorder uniquement les droits nécessaires au bucket Firebase privé ; ne jamais committer ce fichier. Vérifier que l'utilisateur hôte correspondant à l'UID 1000 peut le lire, puis appliquer `chmod 0400 secrets/firebase-service-account.json`.
4. Vérifier que `firebase-applet-config.json` cible bien le projet Firebase attendu et que le bucket est celui de production/préproduction voulu.
5. Lancer : `docker compose -f compose.employment-scanner.yml up -d --build`.
6. Contrôler les logs : `docker compose -f compose.employment-scanner.yml logs -f employment-document-worker clamav`.
7. Vérifier les signatures ClamAV à jour, l'accès PostgreSQL et Firebase, puis réaliser les tests EICAR et PDF sain en préproduction.

Le worker tourne en boucle et traite un lot toutes les 60 secondes. Le service ClamAV ne publie aucun port hôte ; seul le worker le joint sur le réseau Docker. Le worker est non-root, son système de fichiers est en lecture seule et le compte de service est monté en lecture seule.

**Attention :** ce Compose est un artefact de déploiement prêt à configurer, pas une preuve de déploiement. Aucun serveur, compte de service, base de données, bucket, secret ni signature antivirus n'a été provisionné ou activé par les commits GitHub. Ne pas lancer en production avant validation en préproduction.
