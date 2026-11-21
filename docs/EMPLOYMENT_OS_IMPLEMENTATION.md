# KAZI AFRICA — Employment OS

## Décision d'architecture

Construire un domaine dédié à l'emploi et au recrutement, multi-tenant et multi-pays. L'emploi est distinct du workflow de prestations (missions, devis, réservations), mais réutilise l'identité KAZI, les organisations, l'activation pays, les compétences, les notifications, l'audit et la facturation.

Ce document constitue le contrat d'implémentation. Il ne prétend pas que le moteur de recrutement est déjà développé.

## 1. Périmètre fonctionnel

### Espace entreprise / recruteur
- Profil entreprise, identité légale, statut de vérification et périmètre pays.
- Plusieurs établissements, départements et équipes de recrutement.
- Invitation de recruteurs et rôles dédiés : OWNER, HR_ADMIN, RECRUITER, HIRING_MANAGER, INTERVIEWER, READ_ONLY.
- Création, modification, duplication, prévisualisation, soumission à modération, publication, suspension, clôture et archivage des offres.
- Réponse à des annonces publiques, appels à candidatures et appels à recrutement via manifestation d'intérêt ou dossier structuré.
- Gestion des candidatures, notes internes, grilles d'évaluation, entretiens, retours, propositions d'embauche et décisions.
- Statistiques : vues, candidatures, conversions, délai de recrutement et sources.

### Espace candidat
- Profil professionnel et visibilité contrôlée.
- Import CV PDF/DOCX et création de CV sur KAZI AFRICA.
- Expériences, formations, diplômes, certifications, langues, compétences, portfolio et références.
- Recherche, alertes, favoris et suivi des candidatures.
- Candidature avec CV choisi, message et réponses aux questions de présélection.
- Retrait d'une candidature, disponibilité pour entretien et réponse à une proposition.
- Export, rectification, demande d'effacement et retrait du consentement.

### Types d'offres
- CDI, CDD, intérim, temps partiel, stage, alternance, programme jeunes diplômés, saisonnier et emploi public.
- Télétravail, hybride et présentiel.
- Recrutement local et international.
- Les missions freelance/prestations restent distinctes des emplois salariés.
- Les appels à candidatures peuvent recevoir des réponses structurées.

### Workflow de recrutement
Offre : Brouillon -> En attente de modération si nécessaire -> Publiée -> Suspendue / Expirée / Clôturée.
Candidature : Soumise -> En examen -> Présélectionnée -> Entretien -> Évaluation -> Offre -> Recrutée.
Issues terminales : Refusée, Retirée, Offre déclinée, Archivée.

Toutes les transitions sont autorisées côté serveur, horodatées, auditées et idempotentes lorsque nécessaire. Un candidat ne voit que ses candidatures et échanges. Un employeur ne voit que les candidatures de ses propres offres et dans le périmètre de son organisation.

## 2. IA d'assistance, jamais décisionnaire
- Extraction de CV et normalisation des compétences avec confirmation/correction du candidat.
- Suggestions explicables de pertinence offre-profil selon compétences, expérience, localisation, langues et préférences déclarées.
- Aide à la rédaction des offres, questions d'entretien et communications.
- Détection d'offres incomplètes, frauduleuses ou dupliquées.
- Interdiction de rejeter automatiquement un candidat ou de prendre une décision d'embauche. Validation humaine obligatoire, explication des critères, possibilité de correction et contrôle des biais.
- Ne pas inférer ni utiliser de caractéristiques protégées dans le matching.

## 3. Modèle de données PostgreSQL / Drizzle

Créer un schéma dédié et des migrations versionnées :
- employer_profiles : organisation, entité légale, état de vérification, profil public, pays.
- employer_members : membre d'organisation, rôle RH, département, établissement, statut.
- job_categories, employment_contract_types, work_modes : référentiels configurables par pays.
- job_posts : employeur, pays, titre, description, catégorie, contrat, fourchette salariale/devise/périodicité, lieu, mode de travail, expérience, formation, compétences, langues, effectif, fenêtre de publication, statut, modération et paramètres de candidature.
- job_post_localizations : titre, description et contenu de candidature traduits.
- candidate_profiles, candidate_experiences, candidate_educations, candidate_certifications, candidate_skills, candidate_languages, candidate_preferences.
- candidate_documents : clé de stockage privée, MIME, taille, checksum, analyse antivirus, date de rétention.
- job_applications : offre, candidat, CV sélectionné, message, réponses, statut, source et dates ; unicité d'une candidature active par candidat/offre, sauf réouverture explicitement autorisée.
- application_events : historique immuable des événements et de leurs auteurs.
- interviews, interview_participants, interview_feedback, assessments.
- job_offers et job_offer_events : propositions d'embauche, expiration, acceptation/refus et audit.
- saved_jobs, saved_searches, job_alerts.
- employer_verifications, job_reports, moderation_cases.
- employment_consents, candidate_data_requests.
- employment_audit_logs : organisation, pays, acteur, action, entité et métadonnées expurgées.

### Isolation et autorisations
- Chaque donnée employeur est liée à organization_id ; vérifier l'appartenance et le rôle à chaque requête.
- Les données candidat sont détenues par le candidat ; l'employeur ne voit que les candidatures à ses offres et les informations autorisées.
- Les accès super-admin et administrateur pays sont limités par permissions et périmètre pays, puis audités.
- Contraintes/index DB en complément de l'autorisation API. Ajouter PostgreSQL RLS si l'architecture de déploiement le permet ; ne jamais compter uniquement sur les filtres UI.

## 4. Contrat API

Toutes les routes sont sous /api/employment. Authentification requise sauf lecture publique explicitement autorisée. Validation des entrées, pagination, rate-limit, erreurs stables et absence de fuite de données personnelles.

Employeurs :
- GET/POST /employers/me
- GET/POST /employers/:id/members
- PATCH/DELETE /employers/:id/members/:memberId
- GET/POST /jobs ; GET/PATCH/DELETE /jobs/:id
- POST /jobs/:id/submit, /publish, /pause, /close, /duplicate
- GET /jobs/:id/applications
- POST /applications/:id/status, /notes, /interviews, /offers

Candidats :
- GET/PATCH /candidates/me
- POST /candidates/me/documents ; GET/DELETE /candidates/me/documents/:id
- GET/POST /applications ; GET /applications/:id ; POST /applications/:id/withdraw
- GET /jobs ; GET /jobs/:id ; POST/DELETE /jobs/:id/save
- GET/POST /saved-searches ; GET/PATCH /preferences

Plateforme :
- GET /admin/jobs/moderation ; POST /admin/jobs/:id/moderate
- GET /admin/employers/verifications ; POST /admin/employers/:id/verify
- POST /admin/reports/:id/resolve
- GET /admin/analytics

Les routes publiques renvoient uniquement des champs assainis. Ne jamais exposer email/téléphone candidat, adresse personnelle précise, clés de stockage CV, réponses de présélection ou notes internes dans la recherche publique.

## 5. Activation pays par pays

Ajouter employment comme module activable indépendamment pour chaque pays. Configuration locale :
- ouverture des inscriptions et publications ;
- contrats et modes de travail autorisés ;
- affichage des salaires, devises et périodicités ;
- justificatifs de vérification des employeurs ;
- mentions légales, confidentialité, rétention et restrictions locales ;
- langues, catégories, règles de modération et intégrations ;
- offres payantes, quotas, sponsoring, facturation et taxes.

Ne jamais appliquer automatiquement le droit du travail d'un pays à un autre. Une revue juridique locale est nécessaire avant l'ouverture d'un marché. L'activation doit échouer par défaut si les paramètres de conformité requis manquent.

## 6. Modèle économique

Plans configurables par pays, sans prix codés en dur :
- Compte candidat gratuit.
- Abonnements employeur Starter / Growth / Enterprise.
- Tarification par siège recruteur si pertinente.
- Offres mises en avant et campagnes sponsorisées, clairement signalées.
- Licences cabinets RH, institutions et marque blanche.
- Accès API et tarification volume pour grands employeurs.
- La candidature reste gratuite par défaut pour les candidats.

Droits, quotas, taxes, devise et prestataire de paiement sont configurables par pays et audités. Réutiliser l'abstraction de paiement existante sans supposer qu'un PSP est disponible partout.

## 7. Architecture frontend et navigation

Créer une entrée Emploi dédiée :
- /employment : recherche et découverte.
- /employment/jobs/:id : détail et candidature.
- /employment/candidate : tableau de bord, profil, CV et candidatures.
- /employment/employers : onboarding et espace employeur.
- /employment/employers/jobs/new et /employment/employers/jobs/:id/edit.
- /employment/employers/jobs/:id/applications : pipeline RH.
- /employment/admin : modération et gouvernance pays.

Réutiliser le design system, les traductions FR/EN/PT/AR, les composants responsive, l'authentification et le sélecteur de pays existants. Ne pas surcharger /opportunities : cette page reste un portail de découverte transversal qui oriente vers emplois, missions, partenariats et formations.

## 8. Sécurité, confidentialité et conformité
- Authentification, appartenance organisation, RBAC, périmètre pays et autorisation objet côté serveur.
- Stockage privé des CV, URLs signées de courte durée, liste MIME/taille autorisée, antivirus et checksum.
- Rate limits, anti-énumération, anti-spam, protections CSRF selon contexte et journalisation d'audit.
- Minimisation des données ; rétention définie par pays et purge/anonymisation à échéance.
- Consentement explicite avant partage du CV à un employeur ou à un vivier.
- Avis de confidentialité, preuve de consentement, accès/rectification/export/effacement.
- Exclure les données sensibles des logs et analytics.
- Matching IA explicable, non discriminatoire et supervisé par un humain.
- Revue juridique locale pour droit du travail, vie privée, égalité des chances, signature électronique et transferts internationaux.

## 9. Critères d'acceptation

1. Une entreprise authentifiée peut s'inscrire, être vérifiée et inviter des recruteurs avec rôles limités.
2. Un recruteur autorisé peut créer, prévisualiser, soumettre, publier, suspendre, clôturer et archiver une offre.
3. Le public recherche les offres publiées par pays, ville, catégorie, contrat, mode de travail et mots-clés sans obtenir de données personnelles.
4. Un candidat crée son profil, gère un CV, postule, retire sa candidature et suit son statut.
5. Un employeur consulte uniquement ses candidats, fait progresser les dossiers, planifie des entretiens et émet une offre.
6. Les notifications couvrent les événements pertinents et respectent les préférences.
7. Chaque lecture/écriture sensible et transition est autorisée et auditée.
8. Les tests d'isolation inter-tenant et inter-pays passent.
9. L'activation pays est indépendante et échoue par défaut en cas de conformité incomplète.
10. L'IA est facultative, explicable, supervisée et ne rejette jamais automatiquement.
11. Accessibilité, mobile, traductions et tests automatisés sont couverts.
12. Les workflows missions, devis, réservations, paiements et professionnels existants ne régressent pas.

## 10. Séquence de livraison

1. Schéma, migration, permissions, module pays et audit.
2. Onboarding employeur, membres et cycle de vie des offres.
3. Recherche publique, profil candidat, stockage CV privé et candidatures.
4. Pipeline RH, entretiens, évaluations et propositions d'embauche.
5. Notifications, modération, signalements et administration.
6. IA d'assistance, analytics, abonnements, marque blanche et intégrations.
7. Validation conformité pays par pays, tests de sécurité et préparation production.

Livrer par petites pull requests relues. Ne pas fusionner dans main avant migrations, vérification des types, tests, revue sécurité et tests de non-régression.
