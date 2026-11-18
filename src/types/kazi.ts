export interface CountryRecord {
  id: string;
  iso2: string;
  iso3: string;
  nameFr: string;
  nameEn: string;
  namePt?: string | null;
  nameAr: string;
  region: string;
  capital: string;
  defaultCurrency: string;
  currencySymbol: string;
  defaultLanguage: string;
  supportedLanguages: string[];
  timezone: string;
  callingCode: string;
  status: 'PLANNED' | 'CONFIGURING' | 'TESTING' | 'ACTIVE' | 'SUSPENDED';
  commissionRatePct: string;
  taxRatePct: string;
  regulatoryNotes: string;
  proSubscriptionMonthly: string;
  enterpriseSubscriptionMonthly: string;
  operatorLicenseMonthly: string;
  pricingCurrency: string;
  deployment: {
    configComplete: boolean;
    complianceVerified: boolean;
    paymentsConfigured: boolean;
    localLeadAssigned: boolean;
    securityTestsPassed: boolean;
    functionalTestsPassed: boolean;
    activationAuthorized: boolean;
    registrationsOpen: boolean;
    missionsOpen: boolean;
    suspensionReason: string | null;
  } | null;
  readiness: {
    canActivate: boolean;
    missingCriteria: string[];
  };
  paymentProviders: Array<{
    id: string;
    providerCode: string;
    providerLabel: string;
    status: string;
    verificationNote: string;
    supportsEscrow: boolean;
  }>;
  cities: Array<{ id: string; name: string; latitude: string; longitude: string }>;
}

export interface CategoryRecord {
  id: string;
  slug: string;
  nameFr: string;
  nameEn: string;
  namePt?: string | null;
  nameAr: string;
  iconName: string;
}

export interface ProfessionalRecord {
  id: string;
  profileId: string;
  fullName: string;
  countryIso2: string;
  countryNameFr?: string;
  primaryCategorySlug: string;
  headlineFr: string;
  headlineEn: string;
  headlinePt?: string | null;
  headlineAr: string;
  bioFr: string;
  bioEn: string;
  bioPt?: string | null;
  bioAr: string;
  yearsExperience: number;
  hourlyRate: string;
  currency: string;
  city: string;
  neighborhood: string;
  latitude: string;
  longitude: string;
  distanceKm: string;
  isVerified: boolean;
  isProSubscriber: boolean;
  availableToday: boolean;
  ratingAvg: string;
  reviewsCount: number;
  kaziSkillsScore: number;
  avatarUrl: string | null;
  skills?: Array<{
    level: string;
    verifiedByKazi: boolean;
    skill: { id: string; nameFr: string; nameEn: string; namePt?: string | null; nameAr: string };
  }>;
  services?: Array<{
    id: string;
    titleFr: string;
    titleEn: string;
    titlePt?: string | null;
    titleAr: string;
    basePrice: string;
    currency: string;
    durationMinutes: number;
  }>;
  reviews?: Array<{
    id: string;
    rating: number;
    comment: string;
    authorName: string;
    createdAt: string;
  }>;
}

export interface MissionRecord {
  id: string;
  referenceCode: string;
  countryIso2: string;
  title: string;
  description: string;
  address: string;
  city: string;
  desiredDate: string;
  timeSlot: string;
  estimatedBudget: string | null;
  currency: string;
  status: string;
  createdAt: string;
  category: CategoryRecord;
  quotes: Array<{
    id: string;
    professionalId: string;
    amount: string;
    currency: string;
    scopeDetails: string;
    estimatedDuration: string;
    status: string;
  }>;
  booking: {
    id: string;
    bookingNumber: string;
    agreedAmount: string;
    currency: string;
    status: string;
  } | null;
  payment: {
    id: string;
    amountGross: string;
    commissionAmount: string;
    netToProfessional: string;
    currency: string;
    providerCode: string;
    status: string;
  } | null;
}

export interface CourseRecord {
  id: string;
  categorySlug: string;
  partnerOrgName: string;
  titleFr: string;
  titleEn: string;
  titlePt?: string | null;
  titleAr: string;
  descriptionFr: string;
  descriptionEn: string;
  descriptionPt?: string | null;
  descriptionAr: string;
  durationHours: number;
  level: string;
  deliveryMode: string;
  priceEur: string;
  enrolledCount: number;
  thumbnailUrl: string | null;
  status: string;
  credentialType: string;
}

export interface HomeCategoryItem {
  slug: string;
  iconName: string;
  nameFr: string;
  nameEn: string;
  namePt?: string | null;
  nameAr: string;
  mappedSlugs: string[];
  enabled?: boolean;
  sortOrder?: number;
}

export interface HomeTestimonial {
  id: string;
  authorDisplayName: string;
  rating: number;
  comment: string;
  city: string;
  countryIso2: string;
  professionalName?: string | null;
  createdAt: string;
  isVerifiedReview: boolean;
}

export interface FaqItem {
  id: string;
  category: string;
  questionFr: string;
  questionEn: string;
  questionPt?: string | null;
  questionAr: string;
  answerFr: string;
  answerEn: string;
  answerPt?: string | null;
  answerAr: string;
  enabled?: boolean;
  sortOrder?: number;
}

export interface OpportunityRecord {
  id: string;
  type: 'MISSION' | 'JOB' | 'PARTNERSHIP' | 'COLLABORATION' | 'ENTREPRENEURSHIP' | string;
  domain: string;
  countryIso2: string;
  city: string;
  titleFr: string;
  titleEn: string;
  titlePt?: string | null;
  titleAr: string;
  summaryFr: string;
  summaryEn: string;
  summaryPt?: string | null;
  summaryAr: string;
  organizationName: string;
  referenceCode?: string;
  isLiveMission?: boolean;
  isPilotProgram?: boolean;
  targetPath: string;
}

export interface HomeHighlightsResponse {
  homeCategories: HomeCategoryItem[];
  testimonials: HomeTestimonial[];
  countryStats: {
    ACTIVE: number;
    TESTING: number;
    CONFIGURING: number;
    PLANNED: number;
    SUSPENDED: number;
    TOTAL: number;
  };
  metrics: {
    professionalsCount: number;
    verifiedProfessionalsCount: number;
    coursesCount: number;
    openMissionsCount: number;
  };
}

