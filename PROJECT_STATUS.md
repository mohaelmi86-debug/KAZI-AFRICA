# KAZI AFRICA — État d'avancement du projet (PROJECT_STATUS.md)

## Fonctionnalités réalisées & Audit V1 consolidé
- **Phase 1 & 2 (Initialisation & Design System)** : Charte visuelle `#123B70`, `#F59E0B`, `#13A887`, `#F4F7FB`, typographie `Plus Jakarta Sans` / `DM Sans` / `Cairo` (RTL), navigation responsive desktop & mobile PWA.
- **Phase 3 (Référentiel 54 pays & Moteur d'activation)** : 54 pays africains préchargés en PostgreSQL, statuts (`PLANNED`, `CONFIGURING`, `TESTING`, `ACTIVE`, `SUSPENDED`), checklist 7 points + intégrité serveur (`evaluateCountryActivationIntegrity`), gestion PSP (`PATCH /api/countries/:iso2/providers/:providerCode`), carte interactive de l'Afrique.
- **Phase 4 (Auth & Sécurité)** : Firebase Auth Google Sign-In vérifié par `firebase-admin`, RBAC serveur, protection IDOR sur missions/devis/réservations/paiements/messages/litiges/organisations, validation UUID, rate limiting, en-têtes de sécurité HTTP, audit logs.
- **Phase 5, 6, 7 (Client, Professionnel, Missions/Devis/Réservations)** : Recherche multicritères avec portée pays/continent, carte OpenStreetMap, profil pro détaillé, formulaire 3 étapes, suivi temps réel, machine à états serveur (`canActorTransitionBooking`), messagerie, avis et litiges.
- **Phase 8 (Entreprise B2B)** : Création d'organisation, ajout de membres (`POST /api/enterprise/members`), affectation de techniciens (`POST /api/enterprise/interventions/:id/assign`), suivi des interventions multi-sites, onglet Facturation et taux de complétion réel.
- **Phase 9 (KAZI Skills)** : Passeport numérique de compétences, catalogue formations, inscriptions, évaluations théorique & pratique distinctes, distinction claire entre évaluations KAZI, attestations partenaires et diplômes officiels.
- **Phase 10 (Administration Centrale & Locale)** : KPIs multi-pays, série mensuelle issue de PostgreSQL, gestion des utilisateurs/rôles/suspensions (`/api/admin/users`), file de vérification documentaire, modération des litiges, remboursements, journal d'audit, périmètre isolé pour administrateurs locaux.
- **Phase 11 (Paiements & Commissions)** : Architecture extensible par pays, sélection PSP éligible côté client, clé d'idempotence, webhooks signés HMAC-SHA256 sur `rawBody`, calcul serveur des commissions (8–12 %), remboursements.
- **Phase 12 (IA Google Gemini)** : Proxy serveur uniquement (`src/server/geminiService.ts`) — matching intelligent, assistant rédaction de devis, assistant biographie multilingue FR/EN/AR, analyse exécutive des tendances.
- **Phase 13 (i18n & RTL)** : Traduction complète Français, Anglais, Arabe avec parité vérifiée et bascule `dir="rtl"` native.
- **Phase 14 (PWA & Tests)** : Service Worker + Manifeste + stratégie `NetworkFirst` pour les référentiels publics + reconnexion automatique, suite de tests unitaires et d'intégration HTTP (`tests/kazi.test.ts`).

## Blocages / Notes d'environnement
- Les prestataires de paiement externes (Mobile Money locaux, Stripe) sont configurés en mode `SANDBOX` ou `UNVERIFIED` dans l'attente de contractualisation et clés PSP locales, conformément à l'exigence de ne pas inventer leur disponibilité.
- L'environnement utilise Cloud SQL PostgreSQL + Drizzle ORM + Firebase Auth.

## Tests et vérifications exécutés
- **7 / 7 suites de tests réussies** via `./node_modules/.bin/tsx --test tests/kazi.test.ts` (référentiel des 54 pays, moteur d'activation 7 prérequis, machine à états des réservations, calcul serveur des commissions 8–12 %, vérification signature HMAC-SHA256 des webhooks, parité i18n FR/EN/AR, et tests d'intégration HTTP sur Express + PostgreSQL : Auth 401, RBAC 403, anti-auto-vérification pro, validation UUID 400, anti-IDOR, isolation `LOCAL_ADMIN` par pays, blocage d'activation pays sans prérequis, et signature HMAC webhook).
- **Vérification TypeScript & Build** : `tsc --noEmit` et `vite build` réussis sans erreur.
