# Audit du code — Évolution Multi-clients / Multi-tenant / White Label

- Date de l'audit : 2026-11-20
- Dépôt : `mohaelmi86-debug/KAZI-AFRICA`
- Branche examinée : `main`
- Commit examiné : `f000467a0478cdb40f7192003dc5b3c91e99510e`
- Méthode : lecture du tree GitHub, code source, schéma Drizzle, backend Express, middleware d'authentification, interfaces, tests et rapports techniques présents dans le dépôt.
- Limite : audit statique GitHub. Aucun accès direct à Cloud SQL, aucun lancement de tests dans un environnement d'exécution pendant cette inspection. Les résultats de tests mentionnés ci-dessous proviennent des rapports versionnés dans le dépôt et doivent être distingués d'une nouvelle exécution.

## 1. Synthèse exécutive

Le dépôt possède déjà un socle marketplace multi-pays et B2B : profils, rôles, organisations, membres, missions, réservations, paiements, commissions, administration pays et fonctionnalités professionnelles. La décision recommandée est de conserver ce socle et de l'étendre de façon additive.

En revanche, le code examiné ne présente pas encore une architecture commerciale complète permettant de vendre et d'opérer plusieurs plateformes White Label et co-brandées indépendantes. Les concepts de tenant commercial, domaine personnalisé par tenant, contrat partenaire, licence, droits par tenant et partage des revenus ne sont pas identifiables comme des entités cohérentes dans le schéma et les routes examinés.

## 2. Périmètre vérifié

Fichiers principaux consultés :
- `src/db/schema.ts`
- `server.ts`
- `src/middleware/auth.ts`
- `src/modules/auth/AuthContext.tsx`
- `src/App.tsx`
- `src/app/AppContext.tsx`
- `src/config/brand.ts`
- `src/modules/companies/EnterpriseModule.tsx`
- `src/modules/administration/AdminConsoleModule.tsx`
- `src/modules/professionals/ProWorkspaceModule.tsx`
- `src/modules/clients/ClientHomeModule.tsx`
- `src/db/drizzle.config.ts`
- `package.json`
- `tests/kazi.test.ts`
- Rapports : `PROJECT_STATUS.md`, `FINAL_SECURITY_VALIDATION.md`, `FUNCTIONAL_REGRESSION_REPORT.md`, `PAYMENT_RELIABILITY_REPORT.md`, `MULTICOUNTRY_VALIDATION.md`, `PRODUCTION_READINESS.md`, `BRANDING_INTEGRATION_AUDIT.md`.

L'arborescence contient 98 fichiers suivis au commit examiné. Le fichier `src/db/schema.ts` expose 23 déclarations `pgTable` (ce chiffre décrit le schéma source inspecté, pas le nombre réel de tables Cloud SQL).

## 3. Matrice EXISTANT / À COMPLÉTER / À CRÉER

| Domaine | État du code | Décision |
|---|---|---|
| Marketplace particuliers | Parcours client, annuaire professionnels, demandes, devis et réservation présents | CONSERVER |
| Espace professionnels | `ProWorkspaceModule`, profils, vérifications, missions et devis présents | CONSERVER / ÉTENDRE |
| B2B entreprises | `organizations`, `org_members`, `EnterpriseModule`, interventions et affectations présents | CONSERVER / ÉTENDRE |
| Authentification | Firebase Auth / Firebase Admin, flux frontend Google Sign-In observé | CONSERVER / ÉTENDRE les méthodes |
| RBAC | `user_roles`, `permissions`, `requireAnyRole`, restrictions pays | ÉTENDRE au contexte tenant/organisation/ressource |
| Multi-pays | `countries`, `country_deployments`, `country_modules`, devises, PSP, villes et checklist activation | CONSERVER |
| Paiements | `payments`, `payment_transactions`, webhooks HMAC, idempotence et remboursements | CONSERVER / ÉTENDRE aux revenus partenaires |
| Commissions | `commissions`, calcul serveur, taux par pays | ÉTENDRE à des règles versionnées par contrat, forfait, tenant et catégorie |
| Branding KAZI | `src/config/brand.ts` et `KaziBrand` statiques | CONSERVER comme thème par défaut, CRÉER le branding tenant dynamique |
| Organisations | Une organisation cliente avec membres et pays | ÉTENDRE; ne pas la confondre avec un tenant |
| Partenaires commerciaux | Noms de partenaires de formation; pas de gestion complète des partenaires commerciaux identifiée | CRÉER |
| Tenants | Aucune table/route tenant dédiée identifiée dans le schéma et serveur examinés | CRÉER |
| White Label | Pas de provisioning de plateforme, domaine, licence et branding par tenant identifié | CRÉER |
| Co-branding | Pas de configuration de double marque et règles d'affichage par contrat identifiée | CRÉER |
| Licences et abonnements | Champs de prix pays et `organizations.subscriptionPlan`; cycle de vie licence/billing complet non identifié | ÉTENDRE / CRÉER les entités manquantes |
| Partage revenus | Pas de ledger partenaire / règle de revenue share identifié | CRÉER |
| Espace institutionnel | Espace Enterprise réutilisable, mais workflows institutionnels spécifiques non identifiés | ÉTENDRE |
| API partenaires | API REST métier présente; gestion de clés, quotas, webhooks partenaires par tenant non identifiée | CRÉER |
| Domaines personnalisés | Aucun registre de domaines tenant identifié | CRÉER |

## 4. Constatations techniques détaillées

### 4.1 Organisations et multi-organisation

Le schéma contient :
- `organizations` : `countryId`, nom, secteur, numéro d'enregistrement, plan, devise de facturation et propriétaire.
- `org_members` : rattachement profil/organisation, rôle de membre, site et état actif.
- `missions.organizationId` : rattachement d'une mission à une organisation.

Le backend vérifie l'adhésion à l'organisation dans la création de missions, l'ajout de membres et l'affectation d'interventions. Les rapports de sécurité décrivent également des tests anti-IDOR B2B.

Limites observées :
- Les types d'organisations (banque, télécom, assureur, association, ONG, institution, etc.) ne sont pas modélisés comme un référentiel métier distinct.
- Les membres d'organisation n'ont pas de permissions granulaires par module et ressource visibles dans le modèle actuel.
- L'organisation commerciale partenaire et l'espace technique qui lui est fourni sont deux concepts différents et doivent être séparés.

### 4.2 Multi-pays

Le référentiel pays comprend devise, langues, fuseau horaire, taxes, commission, abonnements, statut de déploiement, modules, prestataires de paiement et villes. La checklist d'activation contient notamment configuration, conformité, paiement, responsable local, tests de sécurité, tests fonctionnels et autorisation d'activation.

Le backend contrôle les administrateurs locaux par pays. Ce mécanisme est une base à conserver.

Limites :
- Le taux de commission est actuellement borné de 8 à 12 % dans le code métier et les tests.
- Les montants par défaut et certaines valeurs de seed sont encore orientés EUR.
- Un pays actif ne suffit pas à définir le contrat commercial d'un tenant ou d'un partenaire.
- Les tarifs par pays doivent devenir des règles explicites, historisées et rattachées à une devise.

### 4.3 Authentification et autorisations

`src/modules/auth/AuthContext.tsx` utilise `signInWithPopup` et `googleAuthProvider`. Le backend vérifie les jetons Firebase et reconstruit les rôles depuis PostgreSQL. Le middleware `requireAnyRole` applique des rôles globaux.

Actions :
- Conserver Firebase pour l'identité.
- Ajouter l'association au tenant et aux organisations au contexte d'autorisation.
- Introduire des permissions contextuelles (tenant, organisation, pays, module, ressource).
- Permettre les invitations de collaborateurs par un partenaire.
- Ne jamais faire confiance à un tenantId ou organizationId envoyé par le frontend sans vérifier l'appartenance.
- Remplacer/encadrer l'attribution privilégiée bootstrap fondée sur une adresse email codée en dur par un provisionnement administratif explicite, audité et contrôlé.

### 4.4 Branding

`src/config/brand.ts` fournit une constante `KAZI_BRAND` fixe et les assets officiels. C'est adapté à la marque native KAZI, mais pas à un portefeuille de marques de partenaires.

Créer un moteur de résolution de marque côté serveur à partir du domaine/hôte validé et du tenant actif. Ne jamais laisser le client imposer librement son tenant ou ses assets. Prévoir identité, palette, logos, favicon, nom affiché, mentions et langues. Le mode co-branding doit pouvoir afficher les deux marques selon les règles contractuelles. Le mode White Label doit pouvoir masquer la marque publique KAZI si le contrat le prévoit, tout en conservant les mentions techniques/légales requises.

### 4.5 Monétisation

Le schéma contient des montants pays pour commission et abonnements, ainsi que des paiements et commissions. Le moteur calcule actuellement une commission depuis le pays associé à la réservation.

Le test unitaire `Commission calculation clamps between 8% and 12%` confirme que le calcul empêche d'utiliser les nouveaux taux proposés de 2 à 5 %. La logique actuelle doit être refondue en moteur de règles déterministes et versionnées, sans casser les paiements existants.

Créer des règles de tarification et contrats couvrant :
- Offre Free/Starter/Pro/Business.
- Licence White Label et Co-brand.
- Frais de mise en service et renouvellement.
- Quotas et fonctionnalités activées.
- Commission par catégorie, forfait, pays et contrat.
- Plafonds éventuels et exceptions gros chantiers.
- Partage de revenus partenaire.
- Facturation, taxes, périodes d'essai, impayés et résiliation.
- Historique des règles appliquées à chaque transaction.

### 4.6 Données et migrations

`src/db/drizzle.config.ts` définit un dossier de sortie `./drizzle`, mais l'arborescence GitHub consultée ne montre pas de dossier `drizzle/` ni de fichiers de migration. Les rapports V1.1 décrivent une base Cloud SQL de 40 tables, tandis que le fichier de schéma source actuellement consulté expose 23 déclarations `pgTable`.

Ce n'est pas une preuve que Cloud SQL ne contient que 23 tables : le schéma peut être incomplet, des objets peuvent être gérés hors de ce fichier ou les rapports peuvent viser une version de base différente. **Une comparaison réelle entre le catalogue PostgreSQL, le schéma Drizzle et les migrations versionnées est un préalable bloquant à toute migration.**

## 5. Risques et priorités

| ID | Risque / lacune | Priorité |
|---|---|---|
| AUD-01 | Pas d'isolation tenant formalisée sur toutes les tables/API | CRITIQUE |
| AUD-02 | Branding fixe, pas de résolution par domaine/tenant | ÉLEVÉE |
| AUD-03 | Pas de registre complet des partenaires, contrats et licences | ÉLEVÉE |
| AUD-04 | Modèle de commission incompatible avec les taux économiques africains proposés | ÉLEVÉE |
| AUD-05 | Pas de moteur identifié de partage de revenus partenaire | ÉLEVÉE |
| AUD-06 | Cycle de vie abonnement/licence et facturation B2B incomplet | ÉLEVÉE |
| AUD-07 | Permissions non contextualisées tenant / ressource / module | CRITIQUE |
| AUD-08 | Écart entre compte-rendu de 40 tables et 23 déclarations de schéma source | BLOQUANT avant migration |
| AUD-09 | Rate limiting et cache anti-rejeu en mémoire pour montée en charge multi-instance | MOYENNE |
| AUD-10 | Flux frontend d'authentification Google uniquement observé | MOYENNE |

## 6. Architecture cible recommandée

Conserver le cœur métier et introduire les couches suivantes :

1. **Organization Registry** : types d'organisations, membres, établissements, relations et statut de vérification.
2. **Partner Management** : partenaire, contrats, programmes, commissions et responsabilités.
3. **Tenant Management** : tenants, statut, pays, organisation propriétaire, mode commercial et configuration.
4. **Branding & Domain Engine** : marque, co-brand, domaines, assets, favicon et résolution par hôte.
5. **Feature Entitlements** : modules activés, quotas, limites et droits selon contrat.
6. **Commercial & Billing Engine** : forfaits, licences, prix, factures, cycles, taxes et paiements.
7. **Revenue Sharing Ledger** : lignes de partage, règles appliquées, rapprochements et paiements partenaires.
8. **Authorization Context** : contrôles tenant + organisation + pays + rôle + permission + ressource.

Tables candidates à vérifier avant création (réutiliser toute table équivalente déjà présente) :
- `organization_types`
- `organization_locations`
- `organization_relationships`
- `partners`
- `partner_agreements`
- `partner_licenses`
- `tenants`
- `tenant_members`
- `tenant_branding`
- `tenant_domains`
- `tenant_features`
- `subscription_plans`
- `subscriptions`
- `subscription_entitlements`
- `commercial_pricing_rules`
- `partner_revenue_shares`
- `partner_revenue_ledger`
- `partner_api_credentials`

Ce sont des candidats d'architecture, pas une instruction de créer toutes ces tables sans audit de doublons.

## 7. Plan d'implémentation sécurisé

### Phase 0 — Précondition de données
- Obtenir un inventaire réel des tables, colonnes, FK, index et contraintes de Cloud SQL.
- Comparer cet inventaire à Drizzle et aux migrations réellement déployées.
- Sauvegarde, plan de restauration et stratégie rollback.
- Aucun changement destructif.

### Phase 1 — Modèle organisationnel et autorisations
- Étendre les organisations et relations.
- Définir les contextes tenant/organisation.
- Ajouter les contrôles backend et tests anti-IDOR inter-tenant.
- Vérifier les accès aux missions, devis, factures, documents, messages, paiements et analytics.

### Phase 2 — Tenants et marques
- Provisionnement tenant.
- Résolution domaine.
- Branding dynamique et co-brand.
- Feature entitlements.
- Tests de fuite de données entre marques.

### Phase 3 — Partenaires et contrats
- Onboarding et vérification partenaire.
- Contrats, licences, renouvellements et suspension.
- Espaces KAZI PARTNERS et KAZI INSTITUTION.

### Phase 4 — Économie
- Plans et prix pays.
- Règles de commission versionnées.
- Abonnements et facturation.
- Revenue share ledger et rapprochements.
- Tests de calcul et de réversibilité comptable.

### Phase 5 — Expansion
- Domaines personnalisés.
- API et webhooks partenaires.
- Observabilité et rate limiting partagé.
- Contrôles réglementaires et conformité pays.

## 8. Tests d'acceptation obligatoires

- Un utilisateur du tenant A ne peut lire/modifier aucune donnée privée du tenant B.
- Un partenaire ne peut administrer que ses tenants autorisés.
- Un administrateur pays ne peut pas modifier les règles globales ou les tenants d'un autre périmètre sans permission.
- Le domaine d'un tenant charge la bonne identité, la bonne configuration et les bons modules.
- Les assets d'une marque ne peuvent pas être choisis par un utilisateur non autorisé.
- Les factures, contrats, reçus et notifications affichent la marque et l'entité contractante correctes.
- Les commissions et revenue shares sont calculés avec la règle contractuelle versionnée au moment de l'opération.
- La suspension d'un tenant ne suspend pas le cœur KAZI ni les autres tenants.
- La suppression ou sortie d'un partenaire respecte la réversibilité et la conservation légale des données.
- Les migrations sont testées sur une copie représentative et peuvent être annulées sans perte.

## 9. Conclusion

Le dépôt fournit un socle sérieux pour la marketplace panafricaine et le B2B. La prochaine évolution ne doit pas être une reconstruction des espaces client/professionnel/entreprise. Elle doit être une extension contrôlée vers le modèle commercial multi-tenant, multi-brand et partenaire.

**Décision : commencer par la Phase 0 et l'audit d'isolation. Ne pas appliquer de migration ni développer les écrans White Label avant d'avoir confirmé le vrai schéma PostgreSQL et le périmètre d'autorisation actuel.**
