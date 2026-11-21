# Brief d'implémentation — KAZI SECURITY

Ce brief accompagne `KAZI_SECURITY_AUDIT_2026-11-21.md`.

## Mission
Implémenter les remédiations P0/P1 dans le dépôt KAZI-AFRICA en conservant l'architecture existante (React/Vite, Express/TypeScript, Firebase Auth, PostgreSQL/Drizzle). Ne pas créer un deuxième backend ou système d'identité.

## Ordre obligatoire
1. **SEC-002 — privilèges SUPER_ADMIN** : remplacer la liste d'e-mails codée en dur par un bootstrap opérationnel hors bande, à usage unique, audité, MFA/réauthentification; inventaire et migration des accès existants avant retrait du mécanisme actuel. Bloquer tout auto-octroi via API/UI/claims client.
2. **SEC-001 — rate limiting distribué** : choisir Redis/Memorystore si déjà disponible, sinon table PostgreSQL à compteurs atomiques; définir limites par endpoint et acteur; comportement fail-closed pour fonctions sensibles; tests à deux instances et panne du store.
3. **SEC-004 — idempotence webhook durable** : table delivery avec contrainte unique par fournisseur + delivery ID, insertion et traitement transactionnels; conserver vérification HMAC/raw body/timestamp; tests de rejeu et concurrence.
4. **SEC-003 — email vérifié / identité** : middleware réutilisable fondé exclusivement sur le claim Firebase vérifié côté serveur; l'appliquer aux actions sensibles après inventaire exhaustif des routes.
5. **SEC-005 — tenant/database** : inventaire tables et flux; établir les politiques RLS et le rôle SQL non propriétaire, ou documenter et tester un contrôle compensatoire équivalent. Ne pas appliquer en prod.
6. **SEC-006/007 — fichiers et API** : stockage privé, scan et quarantaine, URLs signées courtes; CSP construite depuis les dépendances et domaines réels; validation schémas et limites.
7. **SEC-008/009 — chaîne CI et détection** : secret scan, audit dépendances, CodeQL/SAST, permissions minimales workflows, alertes et procédures d'incident.

## Règles de sûreté
- Lire l'implémentation et les migrations existantes avant de modifier.
- Ne pas désactiver ni retirer un mécanisme de sécurité avant que son remplacement soit opérationnel et testé.
- Aucun secret réel ne doit apparaître dans le code, tests, fixtures, journaux ou commits.
- Ne pas imprimer les contenus des secrets pour les diagnostiquer.
- Ne pas exécuter de migration sur une base de production, ne pas déployer et ne pas fusionner.
- Changements DB additifs, idempotents, testés sur une base locale/éphémère, avec stratégie rollback.
- Tests sur compte client, professionnel, administrateur local de pays A et B, super-admin et utilisateur suspendu.
- Tester l'accès croisé sur chaque type de ressource, y compris exports, fichiers et tâches asynchrones.
- Ne jamais considérer une UI masquée comme un contrôle d'autorisation.
- Ne déclarer aucune conformité ou certification sans audit indépendant.

## Livrables attendus
- Commits séparés par finding, avec tests.
- Matrice route -> middleware -> rôle -> tenant -> pays.
- Rapport des migrations et procédures de rollback.
- Résultats CI, limites connues et preuve du comportement multi-instance.
- PR en brouillon tant que tous les tests et revues ne sont pas validés.

## Definition of Done
Aucun finding P0 ouvert; pas d'escalade de privilège; limites de débit partagées; webhooks rejoués idempotents; aucune fuite inter-pays/inter-organisation dans les tests; documents privés; scans CI sans secret détecté; migrations testées hors production.
