import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// ============================================================================
// 1. RÉFÉRENTIELS (54 PAYS, DÉPLOIEMENTS, DEVISES, LANGUES, VILLES, CATÉGORIES)
// ============================================================================

export const countries = pgTable('countries', {
  id: uuid('id').defaultRandom().primaryKey(),
  iso2: text('iso2').notNull().unique(),
  iso3: text('iso3').notNull().unique(),
  nameFr: text('name_fr').notNull(),
  nameEn: text('name_en').notNull(),
  nameAr: text('name_ar').notNull(),
  namePt: text('name_pt'),
  region: text('region').notNull(), // West Africa, North Africa, Central Africa, East Africa, Southern Africa
  capital: text('capital').notNull(),
  defaultCurrency: text('default_currency').notNull(),
  currencySymbol: text('currency_symbol').notNull(),
  defaultLanguage: text('default_language').notNull().default('fr'),
  supportedLanguages: jsonb('supported_languages').$type<string[]>().notNull().default(['fr', 'en']),
  timezone: text('timezone').notNull(),
  callingCode: text('calling_code').notNull(),
  status: text('status').notNull().default('PLANNED'), // PLANNED | CONFIGURING | TESTING | ACTIVE | SUSPENDED
  commissionRatePct: numeric('commission_rate_pct', { precision: 5, scale: 2 }).notNull().default('10.00'),
  taxRatePct: numeric('tax_rate_pct', { precision: 5, scale: 2 }).notNull().default('18.00'),
  regulatoryNotes: text('regulatory_notes').notNull().default(''),
  proSubscriptionMonthly: numeric('pro_subscription_monthly', { precision: 12, scale: 2 }).notNull().default('3.00'),
  enterpriseSubscriptionMonthly: numeric('enterprise_subscription_monthly', { precision: 12, scale: 2 }).notNull().default('29.00'),
  operatorLicenseMonthly: numeric('operator_license_monthly', { precision: 12, scale: 2 }).notNull().default('99.00'),
  pricingCurrency: text('pricing_currency').notNull().default('EUR'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const countryDeployments = pgTable('country_deployments', {
  id: uuid('id').defaultRandom().primaryKey(),
  countryId: uuid('country_id').references(() => countries.id, { onDelete: 'cascade' }).notNull().unique(),
  configComplete: boolean('config_complete').notNull().default(false),
  complianceVerified: boolean('compliance_verified').notNull().default(false),
  paymentsConfigured: boolean('payments_configured').notNull().default(false),
  localLeadAssigned: boolean('local_lead_assigned').notNull().default(false),
  securityTestsPassed: boolean('security_tests_passed').notNull().default(false),
  functionalTestsPassed: boolean('functional_tests_passed').notNull().default(false),
  activationAuthorized: boolean('activation_authorized').notNull().default(false),
  registrationsOpen: boolean('registrations_open').notNull().default(false),
  missionsOpen: boolean('missions_open').notNull().default(false),
  suspensionReason: text('suspension_reason'),
  activatedByUid: text('activated_by_uid'),
  activatedAt: timestamp('activated_at'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const countryModules = pgTable('country_modules', {
  id: uuid('id').defaultRandom().primaryKey(),
  countryId: uuid('country_id').references(() => countries.id, { onDelete: 'cascade' }).notNull(),
  moduleKey: text('module_key').notNull(), // marketplace | b2b_enterprise | kazi_skills | ai_assistant | instant_booking
  enabled: boolean('enabled').notNull().default(true),
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
});

export const countryPaymentProviders = pgTable(
  'country_payment_providers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    countryId: uuid('country_id').references(() => countries.id, { onDelete: 'cascade' }).notNull(),
    providerCode: text('provider_code').notNull(), // mobile_money | card_stripe | bank_transfer | manual_cash
    providerLabel: text('provider_label').notNull(),
    status: text('status').notNull().default('UNVERIFIED'), // UNVERIFIED | SANDBOX | VERIFIED_ACTIVE | DISABLED
    verificationNote: text('verification_note').notNull().default('Availability pending local PSP verification'),
    supportsEscrow: boolean('supports_escrow').notNull().default(false),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('country_psp_country_provider_unique_idx').on(table.countryId, table.providerCode)]
);

export const countryCurrencies = pgTable('country_currencies', {
  id: uuid('id').defaultRandom().primaryKey(),
  countryId: uuid('country_id').references(() => countries.id, { onDelete: 'cascade' }).notNull(),
  currencyCode: text('currency_code').notNull(),
  symbol: text('symbol').notNull(),
  decimals: integer('decimals').notNull().default(2),
  isPrimary: boolean('is_primary').notNull().default(true),
});

export const languages = pgTable('languages', {
  code: text('code').primaryKey(), // fr, en, pt, ar
  nameNative: text('name_native').notNull(),
  direction: text('direction').notNull().default('ltr'), // ltr | rtl
  isEnabled: boolean('is_enabled').notNull().default(true),
});

export const cities = pgTable(
  'cities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    countryId: uuid('country_id').references(() => countries.id, { onDelete: 'cascade' }).notNull(),
    name: text('name').notNull(),
    latitude: numeric('latitude', { precision: 9, scale: 6 }).notNull(),
    longitude: numeric('longitude', { precision: 9, scale: 6 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
  },
  (table) => [index('cities_country_id_idx').on(table.countryId)]
);

export const serviceCategories = pgTable('service_categories', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: text('slug').notNull().unique(),
  nameFr: text('name_fr').notNull(),
  nameEn: text('name_en').notNull(),
  nameAr: text('name_ar').notNull(),
  namePt: text('name_pt'),
  iconName: text('icon_name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
});

// ============================================================================
// 2. IDENTITÉ, RBAC & ORGANISATIONS
// ============================================================================

export const profiles = pgTable('profiles', {
  id: uuid('id').defaultRandom().primaryKey(),
  uid: text('uid').notNull().unique(), // Firebase Auth UID
  email: text('email').notNull(),
  fullName: text('full_name').notNull(),
  phone: text('phone'),
  avatarUrl: text('avatar_url'),
  countryIso2: text('country_iso2').notNull().default('CI'),
  cityName: text('city_name').notNull().default('Abidjan'),
  preferredLang: text('preferred_lang').notNull().default('fr'),
  activeRole: text('active_role').notNull().default('CLIENT'), // CLIENT | PROFESSIONAL | ENTERPRISE_ADMIN | LOCAL_ADMIN | SUPER_ADMIN
  isSuspended: boolean('is_suspended').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const userRoles = pgTable(
  'user_roles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    profileId: uuid('profile_id').references(() => profiles.id, { onDelete: 'cascade' }).notNull(),
    role: text('role').notNull(), // CLIENT | PROFESSIONAL | ENTERPRISE_ADMIN | TRAINING_PARTNER | LOCAL_ADMIN | SUPER_ADMIN
    countryIso2: text('country_iso2'), // Scoped country for LOCAL_ADMIN
    grantedBy: text('granted_by'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('user_roles_profile_role_country_idx').on(table.profileId, table.role, table.countryIso2)]
);

export const permissions = pgTable('permissions', {
  id: uuid('id').defaultRandom().primaryKey(),
  role: text('role').notNull(),
  permissionKey: text('permission_key').notNull(),
  description: text('description').notNull(),
});

export const organizations = pgTable('organizations', {
  id: uuid('id').defaultRandom().primaryKey(),
  countryId: uuid('country_id').references(() => countries.id).notNull(),
  name: text('name').notNull(),
  sector: text('sector').notNull(),
  registrationNumber: text('registration_number'),
  subscriptionPlan: text('subscription_plan').notNull().default('ENTERPRISE'), // FREE | ENTERPRISE
  billingCurrency: text('billing_currency').notNull().default('EUR'),
  ownerProfileId: uuid('owner_profile_id').references(() => profiles.id).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const orgMembers = pgTable(
  'org_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
    profileId: uuid('profile_id').references(() => profiles.id, { onDelete: 'cascade' }).notNull(),
    memberRole: text('member_role').notNull().default('MANAGER'), // OWNER | MANAGER | TECHNICIAN | DISPATCHER
    siteLocation: text('site_location'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('org_members_org_profile_unique_idx').on(table.organizationId, table.profileId)]
);

export const countryAdmins = pgTable('country_admins', {
  id: uuid('id').defaultRandom().primaryKey(),
  countryId: uuid('country_id').references(() => countries.id, { onDelete: 'cascade' }).notNull(),
  profileId: uuid('profile_id').references(() => profiles.id, { onDelete: 'cascade' }).notNull(),
  canVerifyDocs: boolean('can_verify_docs').notNull().default(true),
  canModerateDisputes: boolean('can_moderate_disputes').notNull().default(true),
  canManageCategories: boolean('can_manage_categories').notNull().default(false),
  assignedAt: timestamp('assigned_at').defaultNow().notNull(),
});

// ============================================================================
// 3. PROFESSIONNELS, COMPÉTENCES & VÉRIFICATIONS
// ============================================================================

export const professionals = pgTable(
  'professionals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    profileId: uuid('profile_id').references(() => profiles.id, { onDelete: 'cascade' }).notNull().unique(),
    countryId: uuid('country_id').references(() => countries.id).notNull(),
    primaryCategorySlug: text('primary_category_slug').notNull(),
    headlineFr: text('headline_fr').notNull(),
    headlineEn: text('headline_en').notNull(),
    headlineAr: text('headline_ar').notNull(),
    headlinePt: text('headline_pt'),
    bioFr: text('bio_fr').notNull(),
    bioEn: text('bio_en').notNull(),
    bioAr: text('bio_ar').notNull(),
    bioPt: text('bio_pt'),
    yearsExperience: integer('years_experience').notNull().default(1),
    hourlyRate: numeric('hourly_rate', { precision: 12, scale: 2 }).notNull().default('25.00'),
    currency: text('currency').notNull().default('EUR'),
    city: text('city').notNull(),
    neighborhood: text('neighborhood').notNull(),
    latitude: numeric('latitude', { precision: 9, scale: 6 }).notNull().default('5.359952'),
    longitude: numeric('longitude', { precision: 9, scale: 6 }).notNull().default('-4.008256'),
    distanceKm: numeric('distance_km', { precision: 6, scale: 2 }).notNull().default('1.50'),
    isVerified: boolean('is_verified').notNull().default(false), // NEVER modifiable by pro directly
    isProSubscriber: boolean('is_pro_subscriber').notNull().default(false),
    availableToday: boolean('available_today').notNull().default(true),
    ratingAvg: numeric('rating_avg', { precision: 3, scale: 2 }).notNull().default('5.00'),
    reviewsCount: integer('reviews_count').notNull().default(0),
    kaziSkillsScore: integer('kazi_skills_score').notNull().default(0),
    avatarUrl: text('avatar_url'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('professionals_country_cat_idx').on(table.countryId, table.primaryCategorySlug)]
);

export const skills = pgTable('skills', {
  id: uuid('id').defaultRandom().primaryKey(),
  categorySlug: text('category_slug').notNull(),
  nameFr: text('name_fr').notNull(),
  nameEn: text('name_en').notNull(),
  nameAr: text('name_ar').notNull(),
  namePt: text('name_pt'),
});

export const professionalSkills = pgTable('professional_skills', {
  id: uuid('id').defaultRandom().primaryKey(),
  professionalId: uuid('professional_id').references(() => professionals.id, { onDelete: 'cascade' }).notNull(),
  skillId: uuid('skill_id').references(() => skills.id, { onDelete: 'cascade' }).notNull(),
  level: text('level').notNull().default('CERTIFIED'), // BASIC | INTERMEDIATE | CONFIRMED | CERTIFIED
  verifiedByKazi: boolean('verified_by_kazi').notNull().default(false),
});

export const professionalServices = pgTable('professional_services', {
  id: uuid('id').defaultRandom().primaryKey(),
  professionalId: uuid('professional_id').references(() => professionals.id, { onDelete: 'cascade' }).notNull(),
  categoryId: uuid('category_id').references(() => serviceCategories.id).notNull(),
  titleFr: text('title_fr').notNull(),
  titleEn: text('title_en').notNull(),
  titleAr: text('title_ar').notNull(),
  titlePt: text('title_pt'),
  basePrice: numeric('base_price', { precision: 12, scale: 2 }).notNull(),
  currency: text('currency').notNull().default('EUR'),
  durationMinutes: integer('duration_minutes').notNull().default(120),
});

export const verifications = pgTable(
  'verifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    professionalId: uuid('professional_id').references(() => professionals.id, { onDelete: 'cascade' }).notNull(),
    docType: text('doc_type').notNull(), // NATIONAL_ID | TRADE_DIPLOMA | INSURANCE | TAX_ID
    documentName: text('document_name').notNull(),
    documentStorageRef: text('document_storage_ref').notNull(),
    status: text('status').notNull().default('PENDING'), // PENDING | APPROVED | REJECTED
    reviewerUid: text('reviewer_uid'),
    reviewNote: text('review_note'),
    reviewEvidenceReference: text('review_evidence_reference'),
    submittedAt: timestamp('submitted_at').defaultNow().notNull(),
    reviewedAt: timestamp('reviewed_at'),
  },
  (table) => [index('verifications_pro_status_idx').on(table.professionalId, table.status)]
);

export const professionalAvailability = pgTable('professional_availability', {
  id: uuid('id').defaultRandom().primaryKey(),
  professionalId: uuid('professional_id').references(() => professionals.id, { onDelete: 'cascade' }).notNull(),
  dayOfWeek: integer('day_of_week').notNull(), // 0-6
  startTime: text('start_time').notNull(), // 08:00
  endTime: text('end_time').notNull(), // 18:00
  isAvailable: boolean('is_available').notNull().default(true),
});

// ============================================================================
// 4. ACTIVITÉ : MISSIONS, DEVIS, RÉSERVATIONS, PAIEMENTS, AVIS, LITIGES
// ============================================================================

export const missions = pgTable(
  'missions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    referenceCode: text('reference_code').notNull().unique(),
    countryId: uuid('country_id').references(() => countries.id).notNull(),
    clientProfileId: uuid('client_profile_id').references(() => profiles.id).notNull(),
    organizationId: uuid('organization_id').references(() => organizations.id),
    categoryId: uuid('category_id').references(() => serviceCategories.id).notNull(),
    targetProfessionalId: uuid('target_professional_id').references(() => professionals.id),
    title: text('title').notNull(),
    description: text('description').notNull(),
    address: text('address').notNull(),
    city: text('city').notNull(),
    desiredDate: text('desired_date').notNull(),
    timeSlot: text('time_slot').notNull(),
    estimatedBudget: numeric('estimated_budget', { precision: 12, scale: 2 }),
    currency: text('currency').notNull().default('EUR'),
    status: text('status').notNull().default('REQUESTED'), // REQUESTED | QUOTED | ACCEPTED | IN_PROGRESS | PENDING_VALIDATION | COMPLETED | CANCELLED | DISPUTED
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('missions_country_status_idx').on(table.countryId, table.status),
    index('missions_client_idx').on(table.clientProfileId),
    index('missions_org_idx').on(table.organizationId),
  ]
);

export const quotes = pgTable(
  'quotes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    missionId: uuid('mission_id').references(() => missions.id, { onDelete: 'cascade' }).notNull(),
    professionalId: uuid('professional_id').references(() => professionals.id).notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('EUR'),
    scopeDetails: text('scope_details').notNull(),
    estimatedDuration: text('estimated_duration').notNull(),
    status: text('status').notNull().default('PENDING'), // PENDING | ACCEPTED | REJECTED | EXPIRED
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('quotes_mission_idx').on(table.missionId),
    index('quotes_pro_idx').on(table.professionalId),
  ]
);

export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    bookingNumber: text('booking_number').notNull().unique(),
    missionId: uuid('mission_id').references(() => missions.id, { onDelete: 'cascade' }).notNull(),
    quoteId: uuid('quote_id').references(() => quotes.id),
    clientProfileId: uuid('client_profile_id').references(() => profiles.id).notNull(),
    professionalId: uuid('professional_id').references(() => professionals.id).notNull(),
    countryId: uuid('country_id').references(() => countries.id).notNull(),
    agreedAmount: numeric('agreed_amount', { precision: 12, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('EUR'),
    scheduledStart: timestamp('scheduled_start').notNull(),
    scheduledEnd: timestamp('scheduled_end').notNull(),
    status: text('status').notNull().default('CONFIRMED'), // CONFIRMED | IN_PROGRESS | AWAITING_CLIENT_VALIDATION | COMPLETED | CANCELLED | DISPUTED
    clientValidatedAt: timestamp('client_validated_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('bookings_mission_id_unique_idx').on(table.missionId),
    index('bookings_country_status_idx').on(table.countryId, table.status),
    index('bookings_client_idx').on(table.clientProfileId),
    index('bookings_pro_idx').on(table.professionalId),
  ]
);

export const bookingStatusHistory = pgTable('booking_status_history', {
  id: uuid('id').defaultRandom().primaryKey(),
  bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'cascade' }).notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status').notNull(),
  actorUid: text('actor_uid').notNull(),
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'cascade' }).notNull(),
    countryId: uuid('country_id').references(() => countries.id).notNull(),
    payerProfileId: uuid('payer_profile_id').references(() => profiles.id).notNull(),
    amountGross: numeric('amount_gross', { precision: 12, scale: 2 }).notNull(),
    commissionAmount: numeric('commission_amount', { precision: 12, scale: 2 }).notNull(),
    netToProfessional: numeric('net_to_professional', { precision: 12, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('EUR'),
    providerCode: text('provider_code').notNull(), // mobile_money | card_stripe | bank_transfer | manual_cash
    idempotencyKey: text('idempotency_key').notNull().unique(),
    status: text('status').notNull().default('INITIATED'), // INITIATED | PENDING_CONFIRMATION | CONFIRMED_SERVER | FAILED | REFUNDED
    externalRef: text('external_ref'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    confirmedAt: timestamp('confirmed_at'),
  },
  (table) => [
    index('payments_booking_idx').on(table.bookingId),
    index('payments_country_status_idx').on(table.countryId, table.status),
    index('payments_external_ref_idx').on(table.externalRef),
  ]
);

export const paymentTransactions = pgTable(
  'payment_transactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    paymentId: uuid('payment_id').references(() => payments.id, { onDelete: 'cascade' }).notNull(),
    eventType: text('event_type').notNull(), // INIT | WEBHOOK_RECEIVED | SERVER_RECONCILED | REFUND_ISSUED
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    signatureVerified: boolean('signature_verified').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('payment_tx_payment_idx').on(table.paymentId)]
);

export const commissions = pgTable('commissions', {
  id: uuid('id').defaultRandom().primaryKey(),
  paymentId: uuid('payment_id').references(() => payments.id, { onDelete: 'cascade' }).notNull().unique(),
  countryId: uuid('country_id').references(() => countries.id).notNull(),
  ratePct: numeric('rate_pct', { precision: 5, scale: 2 }).notNull(),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  currency: text('currency').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const refunds = pgTable('refunds', {
  id: uuid('id').defaultRandom().primaryKey(),
  paymentId: uuid('payment_id').references(() => payments.id, { onDelete: 'cascade' }).notNull(),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  currency: text('currency').notNull(),
  reason: text('reason').notNull(),
  status: text('status').notNull().default('APPROVED'),
  processedByUid: text('processed_by_uid').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const reviews = pgTable('reviews', {
  id: uuid('id').defaultRandom().primaryKey(),
  bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'cascade' }).notNull().unique(),
  professionalId: uuid('professional_id').references(() => professionals.id).notNull(),
  authorProfileId: uuid('author_profile_id').references(() => profiles.id).notNull(),
  rating: integer('rating').notNull(),
  comment: text('comment').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    missionId: uuid('mission_id').references(() => missions.id, { onDelete: 'cascade' }).notNull(),
    senderProfileId: uuid('sender_profile_id').references(() => profiles.id).notNull(),
    recipientProfileId: uuid('recipient_profile_id').references(() => profiles.id).notNull(),
    content: text('content').notNull(),
    isRead: boolean('is_read').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('messages_mission_idx').on(table.missionId),
    index('messages_sender_idx').on(table.senderProfileId),
    index('messages_recipient_idx').on(table.recipientProfileId),
  ]
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    profileId: uuid('profile_id').references(() => profiles.id, { onDelete: 'cascade' }).notNull(),
    type: text('type').notNull(),
    titleFr: text('title_fr').notNull(),
    titleEn: text('title_en').notNull(),
    titleAr: text('title_ar').notNull(),
    titlePt: text('title_pt'),
    bodyFr: text('body_fr').notNull(),
    bodyEn: text('body_en').notNull(),
    bodyAr: text('body_ar').notNull(),
    bodyPt: text('body_pt'),
    isRead: boolean('is_read').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('notifications_profile_idx').on(table.profileId)]
);

export const disputes = pgTable(
  'disputes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    missionId: uuid('mission_id').references(() => missions.id, { onDelete: 'cascade' }).notNull(),
    countryId: uuid('country_id').references(() => countries.id).notNull(),
    openedByProfileId: uuid('opened_by_profile_id').references(() => profiles.id).notNull(),
    reason: text('reason').notNull(),
    status: text('status').notNull().default('OPEN'), // OPEN | UNDER_REVIEW | RESOLVED_REFUND | RESOLVED_RELEASE
    resolutionNote: text('resolution_note'),
    resolvedByUid: text('resolved_by_uid'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    resolvedAt: timestamp('resolved_at'),
  },
  (table) => [index('disputes_country_status_idx').on(table.countryId, table.status)]
);

// ============================================================================
// 5. KAZI SKILLS (FORMATIONS, INSCRIPTIONS, ÉVALUATIONS, CERTIFICATIONS)
// ============================================================================

export const trainingCourses = pgTable('training_courses', {
  id: uuid('id').defaultRandom().primaryKey(),
  categorySlug: text('category_slug').notNull(),
  partnerOrgName: text('partner_org_name').notNull(),
  titleFr: text('title_fr').notNull(),
  titleEn: text('title_en').notNull(),
  titleAr: text('title_ar').notNull(),
  titlePt: text('title_pt'),
  descriptionFr: text('description_fr').notNull(),
  descriptionEn: text('description_en').notNull(),
  descriptionAr: text('description_ar').notNull(),
  descriptionPt: text('description_pt'),
  durationHours: integer('duration_hours').notNull(),
  level: text('level').notNull(), // BEGINNER | INTERMEDIATE | CONFIRMED
  deliveryMode: text('delivery_mode').notNull().default('ONLINE'), // ONLINE | HYBRID | IN_PERSON
  priceEur: numeric('price_eur', { precision: 10, scale: 2 }).notNull().default('25.00'),
  enrolledCount: integer('enrolled_count').notNull().default(0),
  thumbnailUrl: text('thumbnail_url'),
  status: text('status').notNull().default('PUBLISHED'), // DRAFT | PUBLISHED | ARCHIVED
  credentialType: text('credential_type').notNull().default('PARTNER_ATTESTATION'), // KAZI_EVALUATION | PARTNER_ATTESTATION | OFFICIAL_DIPLOMA
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const enrollments = pgTable(
  'enrollments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    courseId: uuid('course_id').references(() => trainingCourses.id, { onDelete: 'cascade' }).notNull(),
    profileId: uuid('profile_id').references(() => profiles.id, { onDelete: 'cascade' }).notNull(),
    progressPct: integer('progress_pct').notNull().default(0),
    status: text('status').notNull().default('ENROLLED'), // ENROLLED | IN_PROGRESS | COMPLETED
    enrolledAt: timestamp('enrolled_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('enrollments_course_profile_unique_idx').on(table.courseId, table.profileId)]
);

export const evaluations = pgTable('evaluations', {
  id: uuid('id').defaultRandom().primaryKey(),
  courseId: uuid('course_id').references(() => trainingCourses.id, { onDelete: 'cascade' }).notNull(),
  profileId: uuid('profile_id').references(() => profiles.id, { onDelete: 'cascade' }).notNull(),
  evaluationType: text('evaluation_type').notNull(), // THEORETICAL | PRACTICAL
  scorePct: integer('score_pct').notNull(),
  status: text('status').notNull().default('PASSED'), // PASSED | IN_PROGRESS | FAILED
  evaluatedAt: timestamp('evaluated_at').defaultNow().notNull(),
});

export const certifications = pgTable('certifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  profileId: uuid('profile_id').references(() => profiles.id, { onDelete: 'cascade' }).notNull(),
  skillId: uuid('skill_id').references(() => skills.id),
  credentialCategory: text('credential_category').notNull(), // KAZI_EVALUATION | PARTNER_ATTESTATION | OFFICIAL_DIPLOMA
  title: text('title').notNull(),
  issuerName: text('issuer_name').notNull(),
  certificateCode: text('certificate_code').notNull().unique(),
  issuedAt: timestamp('issued_at').defaultNow().notNull(),
});

export const skillPassports = pgTable('skill_passports', {
  id: uuid('id').defaultRandom().primaryKey(),
  profileId: uuid('profile_id').references(() => profiles.id, { onDelete: 'cascade' }).notNull().unique(),
  tradeTitle: text('trade_title').notNull(),
  completionPct: integer('completion_pct').notNull().default(0),
  practicalStatus: text('practical_status').notNull().default('IN_PROGRESS'),
  theoreticalStatus: text('theoretical_status').notNull().default('IN_PROGRESS'),
  kaziCertStatus: text('kazi_cert_status').notNull().default('IN_PROGRESS'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================================================
// 6. ADMINISTRATION, AUDIT & SUPPORT
// ============================================================================

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorProfileId: uuid('actor_profile_id').references(() => profiles.id),
    actorUid: text('actor_uid').notNull(),
    actorRole: text('actor_role').notNull(),
    countryIso2: text('country_iso2'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('audit_logs_country_created_idx').on(table.countryIso2, table.createdAt)]
);

export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<Record<string, unknown>>().notNull(),
  updatedByUid: text('updated_by_uid').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const supportTickets = pgTable('support_tickets', {
  id: uuid('id').defaultRandom().primaryKey(),
  profileId: uuid('profile_id').references(() => profiles.id, { onDelete: 'cascade' }).notNull(),
  countryId: uuid('country_id').references(() => countries.id).notNull(),
  subject: text('subject').notNull(),
  message: text('message').notNull(),
  status: text('status').notNull().default('OPEN'), // OPEN | IN_PROGRESS | CLOSED
  createdAt: timestamp('created_at').defaultNow().notNull(),
});


 // ============================================================================
 // EMPLOYMENT OS — RECRUTEMENT SALARIÉ (distinct des missions de prestation)
 // ============================================================================
export const jobPosts = pgTable(
  'job_posts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
    countryId: uuid('country_id').references(() => countries.id).notNull(),
    createdByProfileId: uuid('created_by_profile_id').references(() => profiles.id).notNull(),
    referenceCode: text('reference_code').notNull().unique(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    department: text('department'),
    contractType: text('contract_type').notNull(),
    workMode: text('work_mode').notNull().default('ONSITE'),
    city: text('city').notNull(),
    salaryMin: numeric('salary_min', { precision: 14, scale: 2 }),
    salaryMax: numeric('salary_max', { precision: 14, scale: 2 }),
    salaryCurrency: text('salary_currency').notNull(),
    salaryPeriod: text('salary_period').notNull().default('MONTH'),
    experienceLevel: text('experience_level'),
    requiredSkills: jsonb('required_skills').$type<string[]>().notNull().default([]),
    applicationDeadline: timestamp('application_deadline'),
    status: text('status').notNull().default('DRAFT'), // DRAFT | PUBLISHED | PAUSED | CLOSED | EXPIRED
    publishedAt: timestamp('published_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('job_posts_country_status_created_idx').on(table.countryId, table.status, table.createdAt),
    index('job_posts_org_status_idx').on(table.organizationId, table.status),
  ]
);

export const candidateProfiles = pgTable(
  'candidate_profiles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    profileId: uuid('profile_id').references(() => profiles.id, { onDelete: 'cascade' }).notNull().unique(),
    headline: text('headline'),
    summary: text('summary'),
    city: text('city'),
    countryIso2: text('country_iso2').notNull(),
    skills: jsonb('skills').$type<string[]>().notNull().default([]),
    experienceYears: integer('experience_years').notNull().default(0),
    cvStorageRef: text('cv_storage_ref'),
    visibility: text('visibility').notNull().default('PRIVATE'), // PRIVATE | EMPLOYERS_WITH_APPLICATION | PUBLIC
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('candidate_profiles_country_idx').on(table.countryIso2)]
);

export const jobApplications = pgTable(
  'job_applications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    jobPostId: uuid('job_post_id').references(() => jobPosts.id, { onDelete: 'cascade' }).notNull(),
    candidateProfileId: uuid('candidate_profile_id').references(() => candidateProfiles.id, { onDelete: 'cascade' }).notNull(),
    coverLetter: text('cover_letter'),
    status: text('status').notNull().default('SUBMITTED'), // SUBMITTED | REVIEWING | SHORTLISTED | INTERVIEW | OFFER | HIRED | REJECTED | WITHDRAWN
    submittedAt: timestamp('submitted_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('job_applications_job_candidate_unique_idx').on(table.jobPostId, table.candidateProfileId),
    index('job_applications_job_status_idx').on(table.jobPostId, table.status),
    index('job_applications_candidate_idx').on(table.candidateProfileId, table.submittedAt),
  ]
);

export const jobApplicationEvents = pgTable('job_application_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  applicationId: uuid('application_id').references(() => jobApplications.id, { onDelete: 'cascade' }).notNull(),
  actorProfileId: uuid('actor_profile_id').references(() => profiles.id),
  fromStatus: text('from_status'),
  toStatus: text('to_status').notNull(),
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [index('job_application_events_application_created_idx').on(table.applicationId, table.createdAt)]);

export const jobInterviews = pgTable(
  'job_interviews',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    applicationId: uuid('application_id').references(() => jobApplications.id, { onDelete: 'cascade' }).notNull(),
    scheduledByProfileId: uuid('scheduled_by_profile_id').references(() => profiles.id).notNull(),
    startsAt: timestamp('starts_at').notNull(),
    endsAt: timestamp('ends_at').notNull(),
    timezone: text('timezone').notNull(),
    mode: text('mode').notNull(), // VIDEO | PHONE | ONSITE
    locationOrUrl: text('location_or_url'),
    candidateResponse: text('candidate_response').notNull().default('PENDING'), // PENDING | CONFIRMED | DECLINED
    status: text('status').notNull().default('SCHEDULED'), // SCHEDULED | COMPLETED | CANCELLED
    candidateMessage: text('candidate_message'),
    internalNotes: text('internal_notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('job_interviews_application_start_idx').on(table.applicationId, table.startsAt)]
);

export const jobInterviewEvaluations = pgTable(
  'job_interview_evaluations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    interviewId: uuid('interview_id').references(() => jobInterviews.id, { onDelete: 'cascade' }).notNull(),
    reviewerProfileId: uuid('reviewer_profile_id').references(() => profiles.id).notNull(),
    score: integer('score').notNull(),
    recommendation: text('recommendation').notNull(), // STRONG_YES | YES | HOLD | NO
    strengths: text('strengths').notNull().default(''),
    concerns: text('concerns').notNull().default(''),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('job_interview_evaluations_interview_reviewer_unique_idx').on(table.interviewId, table.reviewerProfileId),
    index('job_interview_evaluations_interview_idx').on(table.interviewId),
  ]
);


export const employerVerifications = pgTable(
  'employer_verifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull().unique(),
    legalName: text('legal_name').notNull(),
    registrationNumber: text('registration_number').notNull(),
    contactName: text('contact_name').notNull(),
    contactEmail: text('contact_email').notNull(),
    status: text('status').notNull().default('PENDING'), // PENDING | VERIFIED | REJECTED | MORE_INFO_REQUIRED
    submittedAt: timestamp('submitted_at').defaultNow().notNull(),
    reviewedByProfileId: uuid('reviewed_by_profile_id').references(() => profiles.id),
    reviewedAt: timestamp('reviewed_at'),
    reviewNote: text('review_note'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('employer_verifications_status_submitted_idx').on(table.status, table.submittedAt),
  ]
);

// ============================================================================
// RELATIONS DRIZZLE
// ============================================================================

export const countriesRelations = relations(countries, ({ one, many }) => ({
  deployment: one(countryDeployments, {
    fields: [countries.id],
    references: [countryDeployments.countryId],
  }),
  cities: many(cities),
  paymentProviders: many(countryPaymentProviders),
  modules: many(countryModules),
}));

export const professionalsRelations = relations(professionals, ({ one, many }) => ({
  profile: one(profiles, {
    fields: [professionals.profileId],
    references: [profiles.id],
  }),
  country: one(countries, {
    fields: [professionals.countryId],
    references: [countries.id],
  }),
  skills: many(professionalSkills),
  services: many(professionalServices),
  verifications: many(verifications),
}));
