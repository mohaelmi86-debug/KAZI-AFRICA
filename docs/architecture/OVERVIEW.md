# KAZI AFRICA — Architecture & Documentation Technique

## 1. Architecture Globale (« Un seul cœur logiciel, 54 pays »)
- **Frontend**: React 19, TypeScript strict, Tailwind CSS v4, React Router v7, PWA (`vite-plugin-pwa` avec mode dégradé et indicateur hors-ligne).
- **Backend**: Node.js + Express (`server.ts`), services métier isolés (`src/server/businessLogic.ts`), proxy IA Google Gemini (`src/server/geminiService.ts`).
- **Base de données**: PostgreSQL (Cloud SQL) via Drizzle ORM (`src/db/schema.ts`, 40 tables normalisées avec UUID, timestamps et précision décimale `numeric(12, 2)`).
- **Authentification**: Firebase Auth (Google Sign-In) vérifiée côté serveur via `firebase-admin` et couplée au RBAC PostgreSQL (`user_roles`, `country_admins`, `org_members`).

## 2. Moteur d'Activation Pays par Pays
- **Référentiel préchargé**: 54 États souverains d'Afrique avec ISO2/ISO3, devise, langues, fuseau horaire, villes et statut (`PLANNED`, `CONFIGURING`, `TESTING`, `ACTIVE`, `SUSPENDED`).
- **Règle d'activation**: Seul `SUPER_ADMIN` peut exécuter `POST /api/countries/:iso2/activate`, et uniquement lorsque les 7 prérequis dans `country_deployments` sont validés.
- **Suspension contrôlée**: `POST /api/countries/:iso2/suspend` bloque les nouvelles inscriptions et missions tout en préservant 100 % des historiques, paiements et litiges.

## 3. Sécurité & Anti-IDOR
- Aucune clé secrète ni `GEMINI_API_KEY` exposée au navigateur.
- Vérification des rôles uniquement côté serveur depuis PostgreSQL (jamais depuis le client).
- Un professionnel ne peut jamais définir `isVerified = true` lui-même ; la validation passe par `verifications` + revue humaine `LOCAL_ADMIN` / `SUPER_ADMIN`.
- Paiements rapprochés exclusivement côté serveur avec signature HMAC-SHA256 et clé d'idempotence unique.

## 4. API REST Principale
- `GET /api/health` — État du cœur serveur.
- `GET /api/countries` — Liste des 54 pays, devises, villes, prestataires de paiement et checklists.
- `PATCH /api/countries/:iso2/config` — Configuration locale/globale (RBAC strict).
- `POST /api/countries/:iso2/activate` & `POST /api/countries/:iso2/suspend` — Activation/suspension `SUPER_ADMIN`.
- `GET /api/professionals`, `GET /api/professionals/:id`, `POST /api/professionals/register`, `POST /api/professionals/me/verifications`.
- `GET /api/missions`, `POST /api/missions`, `POST /api/missions/:id/quotes`, `POST /api/quotes/:id/accept`.
- `POST /api/bookings/:id/transition` — Machine à états serveur.
- `POST /api/payments/initiate`, `POST /api/payments/webhook`, `POST /api/payments/:id/sandbox-confirm`, `POST /api/payments/:id/refund`.
- `GET /api/skills/courses`, `POST /api/skills/enroll`, `POST /api/skills/evaluate`, `GET /api/skills/passport`.
- `GET /api/enterprise/overview`, `POST /api/enterprise/organizations`.
- `GET /api/admin/overview`, `POST /api/admin/verifications/:id/review`, `POST /api/admin/disputes/:id/resolve`.
- `POST /api/ai/match`, `POST /api/ai/quote-assist`, `POST /api/ai/profile-assist`, `POST /api/ai/analytics`.

## 5. Plan de Déploiement Production
1. `npm run build` (compile le client Vite + copie `src/assets`).
2. Définir `GEMINI_API_KEY`, `SQL_HOST`, `SQL_USER`, `SQL_PASSWORD`, `SQL_DB_NAME`, `PAYMENT_WEBHOOK_SECRET` en variables d'environnement sécurisées.
3. Lancer `npm start` (`node server.ts`).
