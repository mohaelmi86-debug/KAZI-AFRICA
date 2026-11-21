# KAZI SECURITY — audit transversal et plan de durcissement

**Date de l'audit documentaire :** 2026-11-21  
**Dépôt audité :** `mohaelmi86-debug/KAZI-AFRICA`  
**Branche de référence :** `main`  
**Périmètre :** backend Express/TypeScript, Firebase Authentication, RBAC, PostgreSQL/Drizzle, organisations multi-pays, paiements/webhooks, PWA, KAZI PROTECT et chaîne CI/CD.

> Ce document est une revue statique ciblée du dépôt et des rapports/tests présents. Il ne constitue ni un pentest, ni une validation de l'environnement de production. Les contrôles hérités sont notés « déclarés/testés dans le rapport » tant que leur exécution CI actuelle n'a pas été reproduite.

## 1. Résumé exécutif

Le projet possède déjà une base de sécurité significative documentée dans `FINAL_SECURITY_VALIDATION.md` (rapport daté du 18 novembre 2026) : vérification des jetons Firebase, RBAC, suspension des comptes, contrôles d'accès par organisation/pays, anti-IDOR, validation UUID, en-têtes HTTP, CORS explicite, limitation des requêtes, cache privé et tests de webhooks de paiement.

Le rapport mentionne 8/8 tests dans `tests/kazi.test.ts` et 5/5 sous-tests dans `tests/v1_1_validation.test.ts`. Ces résultats sont des résultats rapportés dans le dépôt et doivent être confirmés sur le commit courant par GitHub Actions.

**Niveau de maturité provisoire :** fondations applicatives présentes ; sécurité multi-instance, gouvernance des privilèges, stockage documentaire et isolation DB formelle à compléter/valider. Ne pas présenter KAZI AFRICA comme certifié ou pentesté.

## 2. Inventaire des contrôles existants

| Domaine | Preuve dans le dépôt | Statut de revue |
|---|---|---|
| Firebase Auth | `src/middleware/auth.ts`, `src/lib/firebase-admin.ts`, rapport V1.1 | Implémenté ; révocation Firebase live dépend de configuration IAM |
| Suspension compte | `profiles.is_suspended` et `requireAuth` | Déclaré testé |
| RBAC | `user_roles`, `requireAnyRole`, contrôles routes | Déclaré testé ; revue route par route à automatiser |
| Bootstrap super-admin | constante `BOOTSTRAP_SUPER_ADMINS` dans `src/middleware/auth.ts` | **Risque critique de gouvernance** : adresse privilégiée codée en dur |
| Isolation organisation | propriétaire / membership `org_members` | Déclaré testé sur les parcours B2B couverts |
| Isolation pays | `adminCountryIso2s` / `country_admins` | Déclaré testé sur certains endpoints |
| Anti-IDOR | contrôles propriétaire/participant rapportés | Déclaré testé ; couverture exhaustive non démontrée |
| Validation UUID | helper `isValidUuid` rapporté | Déclaré testé |
| En-têtes/CORS | middleware de `server.ts` | Déclaré testé ; CSP à définir et valider |
| Rate limiting | `Map` locale dans `src/middleware/auth.ts` | **Insuffisant en multi-instance** |
| Paiements | HMAC, timestamp ±300 s, delivery ID, contrôle montant/devise | Déclaré testé ; stockage anti-rejeu local à externaliser |
| PWA | denylist API + NetworkOnly + purge cache au logout | Déclaré testé dans rapport ; revalider chaque build |
| Audit trail | table `audit_logs` et événements métier | Présence à auditer par flux et vérifier anti-altération/rétention |
| KAZI PROTECT | PR #1, branche `feat/kazi-protect-global` | PR brouillon indépendante ; ne pas confondre avec sécurité globale |
| Documents privés | PR #1 indique stockage privé à faire | **Non terminé selon la PR** |
| Webhooks partenaires PROTECT | PR #1 indique signature, timestamp, anti-rejeu à faire | **Non terminé selon la PR** |
| RLS / isolation DB formelle | PR #1 indique tests et isolation formelle à compléter | **Non validé** |
| CI de la PR PROTECT | description PR indique CI non vérifiée | **Non validé à la date de l'audit** |

## 3. Constats prioritaires issus de l'inspection du code

### SEC-001 — Rate limiting non distribué (HAUTE avant mise à l'échelle)
Le middleware `src/middleware/auth.ts` conserve `rateLimitStore` dans une `Map` Node.js et réinitialise la Map si elle dépasse le seuil d'entrées. Chaque instance détient son propre compteur ; un attaquant peut multiplier le débit effectif via plusieurs instances et un redémarrage efface l'état.
- Remplacer par un store partagé Redis/Memorystore ou PostgreSQL atomique.
- Fail closed pour les endpoints sensibles si le store partagé est indisponible (avec exception explicitement conçue pour endpoints de santé).
- Clés distinctes par route, acteur authentifié et IP normalisée ; limites spécifiques login/signup, récupération compte, contact, IA, recherche et endpoints métier coûteux.
- Tests multi-instance, expiration, concurrence, contournement IP et comportement de panne.

### SEC-002 — Bootstrap SUPER_ADMIN lié à une adresse e-mail dans le code (CRITIQUE)
`BOOTSTRAP_SUPER_ADMINS` contient une adresse e-mail codée en dur ; `resolveAuthContext` attribue à ce compte plusieurs rôles si le profil n'a aucune ligne de rôle.
- Retirer tout privilège implicite accordé par comparaison d'e-mail.
- Prévoir un bootstrap contrôlé hors bande : commande one-shot d'administration, secret de bootstrap à usage unique fourni via secret manager, vérification MFA/identité, journal d'audit et désactivation définitive après usage.
- Aucun endpoint public, champ de formulaire, claim client ou e-mail seul ne doit accorder SUPER_ADMIN.
- Migrer les rôles existants sans retirer accidentellement les accès nécessaires : inventaire, approbation, migration transactionnelle et test de rollback.
- Exiger MFA et réauthentification fraîche pour les actions privilégiées, avec double approbation pour changements critiques.

### SEC-003 — Email vérifié et identité de confiance
Le rapport d'onboarding de la PR #1 exige que les workflows sensibles contrôlent `email_verified` depuis le jeton Firebase vérifié côté serveur. Vérifier que tous les endpoints sensibles appliquent la règle et que seuls les endpoints de découverte nécessaires restent accessibles sans vérification.
- Créer un middleware réutilisable `requireVerifiedEmail`.
- Tests sur jetons vérifiés/non vérifiés, expirés, révoqués et comptes suspendus.
- Les flux de changement d'adresse et récupération doivent éviter l'énumération de comptes.

### SEC-004 — Anti-rejeu paiement en mémoire
Le rapport V1.1 indique que le cache des `X-Kazi-Delivery-Id` est en mémoire.
- Déplacer l'idempotence des webhooks dans une table durable avec contrainte unique provider + delivery ID.
- Vérifier signature sur octets bruts, timestamp ±300 secondes, unicité, atomicité et cohérence montant/devise/transaction.
- Conserver une trace d'audit sans données carte ou secrets.

### SEC-005 — Isolation base de données / tenant
Les contrôles applicatifs ne remplacent pas un cloisonnement SQL.
- Définir le modèle de tenant canonique : pays, organisation, profil et ressource.
- Pour chaque table métier, préciser tenant owner, politique d'accès, rôles DB et chemins de lecture/écriture.
- Si RLS PostgreSQL est retenu : activer et forcer RLS sur les tables concernées, utiliser un rôle applicatif non propriétaire/non BYPASSRLS, définir le contexte tenant par transaction de façon non falsifiable par les clients, couvrir les tâches asynchrones et migrations.
- Tests croisés pays A/pays B, organisation A/B, utilisateur non membre, super-admin avec audit ; vérifier aussi JOIN, exports, recherche, fichiers et tâches en arrière-plan.
- Aucun déploiement de politique RLS sans tests en base isolée et validation des connexions pooled.

### SEC-006 — Documents et pièces justificatives
La PR KAZI PROTECT indique le stockage privé et les URLs signées comme restant à réaliser.
- Bucket privé par défaut ; accès seulement par API autorisée.
- URLs signées courtes, scope objet + utilisateur + action, expiration et révocation autant que possible.
- Validation MIME réelle, extension, taille, signature fichier, antivirus/quarantaine, limites de fréquence, noms générés côté serveur.
- Interdire HTML/SVG actif et archives dangereuses ou les servir en téléchargement avec `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`.
- Politique de conservation, suppression, export, accès administratif tracé.

### SEC-007 — Sécurité API / navigateur
- Définir CSP stricte compatible avec Firebase/Google AI Studio, sans `unsafe-eval` sauf nécessité démontrée ; réduire `unsafe-inline` via nonce/hash.
- Confirmer HTTPS, HSTS uniquement derrière TLS fiable, proxy trust strictement configuré, CORS exact et sans wildcard avec credentials.
- Protection CSRF selon modèle cookie ; vérifier absence de mutation via GET.
- Schémas Zod/valideurs pour corps, query, params ; limites de taille ; requêtes SQL paramétrées.
- Secrets uniquement dans secret manager, rotation, interdiction de secrets réels dans git, artefacts, journaux.
- Masquage des données personnelles, tokens, pièces justificatives et données sensibles dans logs/erreurs.

### SEC-008 — Dépendances, CI/CD et supply chain
- Ajouter jobs PR obligatoires : lint/typecheck, unit/integration, build, secret scan, dependency audit, CodeQL/SAST, tests de sécurité.
- Geler versions d'actions par SHA complet, permissions GITHUB_TOKEN minimales, pas de secrets sur PR issues de forks.
- Dependabot/Renovate, SBOM CycloneDX/SPDX, provenance des builds, artefacts retenus.
- Protéger branche main : reviews, status checks requis, force-push interdit, signed commits si faisable.
- Les scans ne doivent pas exposer les secrets ni exécuter du code non fiable avec des privilèges.

### SEC-009 — Observabilité et réponse aux incidents
- Identifiant de corrélation, journal d'événements de sécurité append-only, horodatage UTC, acteur, action, ressource, tenant, résultat et origine.
- Alertes : élévation de privilège, changement MFA, export massif, échecs de connexion anormaux, anomalies de paiement, tentatives inter-pays, accès documents.
- Runbooks : compromission compte admin, fuite données, vol de secret, fraude paiement, indisponibilité DB, ransomware fournisseur.
- Sauvegardes chiffrées, copies séparées, restauration testée, RPO/RTO décidés.

## 4. Architecture cible KAZI SECURITY

KAZI SECURITY est une couche transversale, pas un module isolé :
1. Identity & Access — Firebase, MFA, vérification, sessions, privilèges.
2. Authorization — RBAC + règles attributaires pays/organisation/ressource.
3. Data Protection — chiffrement, classification, minimisation, rétention, fichiers privés.
4. API Shield — validation, rate limit distribué, anti-abus, CORS/CSP/CSRF.
5. Transaction Shield — HMAC, anti-rejeu durable, idempotence, cohérence financière.
6. Threat Detection — audit logs, signaux de fraude, alertes et réponse.
7. Governance — règles pays activables, preuves, revues, contrôles et dérogations tracées.

La configuration pays ne peut jamais désactiver les protections globales minimales. Les options locales ne peuvent que renforcer ou ajouter des contrôles.

## 5. Plan de remédiation et critères de sortie

| Priorité | Livrable | Critère d'acceptation |
|---|---|---|
| P0 | Retirer bootstrap email privilégié et fournir procédure sûre | Aucun chemin d'auto-attribution SUPER_ADMIN ; test d'escalade négatif |
| P0 | Rate limit partagé | Limites effectives entre deux instances et tests de panne |
| P0 | Anti-rejeu webhook durable | Delivery ID unique transactionnel, replay rejeté/idempotent |
| P0 | Secrets / CI permissions | Aucun secret détecté ; permissions workflow minimales |
| P1 | Contrôle email vérifié sur actions sensibles | Tests automatisés par groupe de routes |
| P1 | RLS ou preuve alternative de cloisonnement DB | Matrice exhaustive multi-pays/tenant sans fuite |
| P1 | Stockage de documents privé et antivirus | Aucun accès anonyme ; URLs courtes ; scan à l'upload |
| P1 | CSP et durcissement API | Tests headers/CORS/CSRF/schema/size |
| P1 | Audit logs & alertes | Événements critiques exhaustifs, intégrité et alertes |
| P2 | Backups, reprise et exercices | Restauration chronométrée conforme RTO/RPO |
| P2 | Pentest indépendant | Rapport externe, zéro vulnérabilité critique/haute ouverte |
| P2 | Gouvernance pays | Activation seulement après preuve juridique/technique locale |

## 6. Matrice de tests obligatoire

- Auth : jeton invalide/expiré/révoqué, e-mail non vérifié, compte suspendu, MFA manquant, session privilégiée expirée.
- Autorisation : rôle insuffisant, rôle auto-sélectionné, élévation, changement de pays, admin local hors pays.
- Tenant : accès croisé aux profils, organisations, missions, devis, factures, conversations, paiements, documents, exports et tâches différées.
- Paiements : signature invalide, timestamp obsolète/futur, replay, delivery ID dupliqué, montant/devise modifiés, ordre d'événements inversé, concurrence.
- API : injection, payload trop gros, type inattendu, mass assignment, SSRF si fetch URL, CORS hostile, CSRF selon cookies, XSS stockée/réfléchie.
- Fichiers : MIME falsifié, polyglotte, malware EICAR en environnement de test, dépassement taille, URL expirée, accès inter-tenant.
- CI : secret scanning, dépendance vulnérable, permission excessive, PR issue de fork, artefact non fiable.
- Résilience : redémarrage instance, deux instances simultanées, panne Redis/DB, backup restore, révocation d'un secret.

## 7. Contraintes de réalisation

- Ne pas réécrire l'application ni créer un second système d'authentification.
- Ne pas fusionner automatiquement la PR #1 KAZI PROTECT.
- Ne pas appliquer de migration sur une base de production pendant cet audit.
- Ne pas affirmer qu'un contrôle est actif sans preuve de code + test.
- Préserver les fonctionnalités et migrations existantes ; changements DB additifs, testés et avec rollback.
- Aucun pays ne peut activer une fonctionnalité financière, assurantielle ou réglementée sans les validations locales pertinentes.
- Référentiels visés : OWASP ASVS 5, OWASP API Security Top 10, NIST CSF 2.0, ISO/IEC 27001 comme cadre de management ; aucune certification n'est revendiquée.

## 8. Instruction pour l'agent d'implémentation

Prendre ce rapport comme backlog d'ingénierie. Inspecter la branche et le code actuels avant chaque changement. Implémenter en tranches P0/P1 avec tests reproductibles et commits isolés. Fournir pour chaque finding : preuve, scénario de risque, fichiers modifiés, test ajouté, résultat CI et éventuelle limite résiduelle. Ne pas modifier les secrets, déployer, migrer en production ou fusionner sans validation humaine explicite.
