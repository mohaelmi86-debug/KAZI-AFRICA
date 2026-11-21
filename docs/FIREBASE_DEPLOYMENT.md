# KAZI AFRICA — configuration et déploiement Firebase

## Projet cible

Le projet Firebase actuellement référencé par l'application est :

- Project ID : `gen-lang-client-0581402838`
- Bucket Storage : `gen-lang-client-0581402838.firebasestorage.app`
- Alias Firebase CLI : `default` (fichier `.firebaserc`)

Ces identifiants sont la configuration publique du projet, pas des secrets. Vérifier le projet dans la console Firebase avant tout déploiement.

## Authentification serveur

`src/lib/firebase-admin.ts` utilise désormais Application Default Credentials (ADC) :

- Cloud Run / Google Cloud : attacher au service une identité de service dédiée.
- Docker privé / développement : monter un fichier de compte de service en lecture seule et définir `GOOGLE_APPLICATION_CREDENTIALS`.
- Ne jamais committer de clé JSON, ni l'exposer dans une variable `VITE_*`.

Variables prises en charge :

- `FIREBASE_PROJECT_ID` (défaut : projectId de `firebase-applet-config.json`)
- `FIREBASE_STORAGE_BUCKET` (défaut : storageBucket de `firebase-applet-config.json`)
- `GOOGLE_APPLICATION_CREDENTIALS` (chemin ADC, fourni par l'environnement d'exécution)

Les variables de surcharge doivent viser le même projet que l'environnement déployé. Ne pas mélanger un bucket de préproduction avec une identité de production.

## Règles Storage

Le fichier `storage.rules` refuse volontairement toutes les lectures et écritures directes depuis les SDK clients. Les opérations documentaires passent par le backend authentifié, qui contrôle le propriétaire, l'organisation, le consentement et l'état antivirus.

Depuis la racine du dépôt, après avoir vérifié le projet sélectionné :

```bash
firebase projects:list
firebase use gen-lang-client-0581402838
firebase deploy --only storage
```

Puis contrôler dans Firebase Console > Storage > Rules que la version déployée correspond au fichier `storage.rules`.

Ne pas déployer les règles depuis une session CLI connectée à un autre compte ou projet. La commande de déploiement requiert une authentification Firebase CLI ou un compte CI autorisé.

## Identité de service et droits

Créer une identité distincte pour le backend KAZI et le worker antivirus. Accorder uniquement les droits nécessaires au bucket concerné :

- lire les objets déposés ;
- créer et supprimer les objets lorsque le flux l'exige ;
- générer les URL signées de lecture de courte durée pour les documents propres et explicitement partagés.

Pour les URL signées depuis une identité Google Cloud sans clé privée locale, vérifier la capacité de signature IAM (`iam.serviceAccounts.signBlob`) et l'autorisation de signature de l'identité d'exécution. Ne pas accorder le rôle Owner ou Editor pour contourner un problème de permission.

Le worker antivirus ne doit pas recevoir de droit de lecture public. Le port ClamAV reste privé au réseau du worker.

## Contrôles de validation en préproduction

1. Vérifier Project ID et bucket ciblés.
2. Déployer les règles Storage.
3. Vérifier que l'accès anonyme/client direct au bucket est refusé.
4. Vérifier que le backend peut écrire et relire un objet dans le chemin de quarantaine.
5. Vérifier que le worker peut lire le même objet et que le hash est identique.
6. Tester un PDF sain, un PDF invalide, le fichier EICAR, un scanner indisponible et un consentement de partage révoqué.
7. Vérifier qu'aucune URL signée n'est fournie avant le statut antivirus `CLEAN`, ni après révocation du consentement.

## État de déploiement

Ce dépôt contient la configuration et les règles déclaratives. Leur présence ne prouve pas qu'elles sont déployées dans Firebase. Aucun secret, compte de service, rôle IAM, règle Storage distante ou test d'intégration Firebase ne doit être considéré comme activé tant qu'il n'a pas été vérifié dans le projet cible.
