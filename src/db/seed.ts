import { and, count, eq, isNull } from 'drizzle-orm';
import { db } from './index.ts';
import {
  auditLogs,
  bookings,
  bookingStatusHistory,
  certifications,
  cities,
  commissions,
  countries,
  countryCurrencies,
  countryDeployments,
  countryModules,
  countryPaymentProviders,
  disputes,
  enrollments,
  evaluations,
  languages,
  messages,
  missions,
  notifications,
  organizations,
  orgMembers,
  payments,
  paymentTransactions,
  platformSettings,
  professionals,
  professionalAvailability,
  professionalServices,
  professionalSkills,
  profiles,
  quotes,
  reviews,
  serviceCategories,
  skillPassports,
  skills,
  trainingCourses,
  userRoles,
  verifications,
} from './schema.ts';
import { AFRICAN_COUNTRIES_54 } from '../data/africanCountries.ts';

let seedPromise: Promise<void> | null = null;

export async function ensureDatabaseSeeded(): Promise<void> {
  if (!seedPromise) {
    seedPromise = runSeed().catch((err) => {
      seedPromise = null;
      throw err;
    });
  }
  return seedPromise;
}

async function ensurePortugueseSeedBackfill(): Promise<void> {
  await db
    .insert(languages)
    .values([
      { code: 'fr', nameNative: 'Français', direction: 'ltr', isEnabled: true },
      { code: 'en', nameNative: 'English', direction: 'ltr', isEnabled: true },
      { code: 'pt', nameNative: 'Português', direction: 'ltr', isEnabled: true },
      { code: 'ar', nameNative: 'العربية', direction: 'rtl', isEnabled: true },
    ])
    .onConflictDoNothing();

  const missingCountryPt = await db
    .select({ id: countries.id, iso2: countries.iso2 })
    .from(countries)
    .where(isNull(countries.namePt));

  if (missingCountryPt.length > 0) {
    const byIso = new Map(AFRICAN_COUNTRIES_54.map((c) => [c.iso2, c]));
    for (const row of missingCountryPt) {
      const seedRow = byIso.get(row.iso2);
      if (!seedRow) continue;
      await db
        .update(countries)
        .set({
          namePt: seedRow.namePt,
          defaultLanguage: seedRow.defaultLanguage,
          supportedLanguages: seedRow.supportedLanguages,
        })
        .where(and(eq(countries.id, row.id), isNull(countries.namePt)));
    }
  }

  const categoryPtMap: Record<string, string> = {
    electricity: 'Eletricidade',
    plumbing: 'Canalização',
    phone_repair: 'Reparação de Telemóvel',
    hvac: 'Climatização',
    mechanics: 'Mecânica',
    home_help: 'Ajuda Doméstica',
    solar: 'Solar & Energia',
  };
  for (const [slug, namePt] of Object.entries(categoryPtMap)) {
    await db
      .update(serviceCategories)
      .set({ namePt })
      .where(and(eq(serviceCategories.slug, slug), isNull(serviceCategories.namePt)));
  }

  const skillPtMap: Record<string, string> = {
    'Installation électrique': 'Instalação elétrica',
    'Dépannage et réparation': 'Diagnóstico e reparação',
    'Mise aux normes': 'Conformidade com normas de segurança',
    'Domotique (de base)': 'Domótica (básica)',
    'Entretien climatisation split': 'Manutenção de ar condicionado split',
    'Dépannage fuites & canalisations': 'Reparação de fugas e canalizações',
    'Installation solaire photovoltaïque': 'Instalação solar fotovoltaica',
  };
  for (const [nameFr, namePt] of Object.entries(skillPtMap)) {
    await db
      .update(skills)
      .set({ namePt })
      .where(and(eq(skills.nameFr, nameFr), isNull(skills.namePt)));
  }

  const coursePtMap: Array<{ titleFr: string; titlePt: string; descriptionPt: string }> = [
    {
      titleFr: 'Installation solaire photovoltaïque',
      titlePt: 'Instalação solar fotovoltaica',
      descriptionPt: 'Dimensionamento, cablagem DC/AC, ligação à terra e manutenção de sistemas solares autónomos e híbridos.',
    },
    {
      titleFr: 'Mise aux normes électriques',
      titlePt: 'Conformidade e normas elétricas',
      descriptionPt: 'Proteção diferencial, seletividade, esquemas unifilares e prevenção de riscos elétricos em África.',
    },
    {
      titleFr: 'Plomberie — Dépannage & installation',
      titlePt: 'Canalização — Reparação e instalação',
      descriptionPt: 'Soldadura PEX/multicamada, deteção acústica de fugas e instalação sanitária em conformidade.',
    },
  ];
  for (const c of coursePtMap) {
    await db
      .update(trainingCourses)
      .set({ titlePt: c.titlePt, descriptionPt: c.descriptionPt })
      .where(and(eq(trainingCourses.titleFr, c.titleFr), isNull(trainingCourses.titlePt)));
  }

  const proPtMap: Array<{ headlineFr: string; headlinePt: string; bioPt: string }> = [
    {
      headlineFr: "Électricien — 5 ans d'expérience",
      headlinePt: 'Eletricista Certificado — 5 anos de experiência',
      bioPt: 'Especialista em instalações residenciais e comerciais em Abidjan. Conformidade, quadros elétricos e reparação rápida.',
    },
    {
      headlineFr: 'Ingénieure Électricité & Solaire — 6 ans',
      headlinePt: 'Engenheira de Eletricidade e Solar — 6 anos',
      bioPt: 'Diagnóstico elétrico, climatização e sistemas solares híbridos para particulares e PME.',
    },
    {
      headlineFr: 'Plombier & Multiservices — 7 ans',
      headlinePt: 'Canalizador e Multisserviços — 7 anos',
      bioPt: 'Deteção de fugas, instalações sanitárias, reparações elétricas locais e manutenção de edifícios.',
    },
    {
      headlineFr: 'Technicien Solaire & Électricité — Dakar',
      headlinePt: 'Técnico Solar e Eletricidade — Dakar',
      bioPt: 'Instalação fotovoltaica e manutenção industrial certificada KAZI Skills em Dakar.',
    },
  ];
  for (const p of proPtMap) {
    await db
      .update(professionals)
      .set({ headlinePt: p.headlinePt, bioPt: p.bioPt })
      .where(and(eq(professionals.headlineFr, p.headlineFr), isNull(professionals.headlinePt)));
  }

  const servicePtMap: Record<string, string> = {
    'Installation de prises et tableau électrique': 'Instalação de tomadas e quadro elétrico',
    'Diagnostic panne de courant partielle': 'Diagnóstico de falha elétrica parcial',
    'Entretien complet climatisation split': 'Manutenção completa de ar condicionado split',
  };
  for (const [titleFr, titlePt] of Object.entries(servicePtMap)) {
    await db
      .update(professionalServices)
      .set({ titlePt })
      .where(and(eq(professionalServices.titleFr, titleFr), isNull(professionalServices.titlePt)));
  }

  await db
    .update(notifications)
    .set({
      titlePt: 'Intervenção em curso',
      bodyPt: 'Koffi Laurent iniciou a missão KZ-2026-01584 em Cocody.',
    })
    .where(and(eq(notifications.titleFr, 'Intervention en cours'), isNull(notifications.titlePt)));

  await ensureHomepagePlatformSettings();
}

async function ensureHomepagePlatformSettings(): Promise<void> {
  await db
    .insert(platformSettings)
    .values([
      {
        key: 'home_categories',
        value: {
          items: [
            { slug: 'home_building', iconName: 'Home', nameFr: 'Maison et bâtiment', nameEn: 'Home & Building', namePt: 'Casa e Construção', nameAr: 'المنزل والبناء', mappedSlugs: ['electricity', 'plumbing', 'hvac', 'home_help', 'solar'], enabled: true, sortOrder: 1 },
            { slug: 'crafts', iconName: 'Hammer', nameFr: 'Artisanat', nameEn: 'Crafts & Trades', namePt: 'Artesanato e Ofícios', nameAr: 'الحرف اليدوية', mappedSlugs: ['plumbing', 'electricity', 'mechanics'], enabled: true, sortOrder: 2 },
            { slug: 'beauty_wellness', iconName: 'Sparkles', nameFr: 'Beauté et bien-être', nameEn: 'Beauty & Wellness', namePt: 'Beleza e Bem-estar', nameAr: 'الجمال والعافية', mappedSlugs: ['home_help'], enabled: true, sortOrder: 3 },
            { slug: 'transport_delivery', iconName: 'Truck', nameFr: 'Transport et livraison', nameEn: 'Transport & Delivery', namePt: 'Transporte e Entregas', nameAr: 'النقل والتوصيل', mappedSlugs: ['mechanics'], enabled: true, sortOrder: 4 },
            { slug: 'it_tech', iconName: 'Monitor', nameFr: 'Informatique et technologie', nameEn: 'IT & Technology', namePt: 'Informática e Tecnologia', nameAr: 'تكنولوجيا المعلومات', mappedSlugs: ['phone_repair'], enabled: true, sortOrder: 5 },
            { slug: 'education_training', iconName: 'GraduationCap', nameFr: 'Éducation et formation', nameEn: 'Education & Training', namePt: 'Educação e Formação', nameAr: 'التعليم والتدريب', mappedSlugs: ['electricity', 'solar'], enabled: true, sortOrder: 6 },
            { slug: 'health_assistance', iconName: 'HeartPulse', nameFr: 'Santé et assistance', nameEn: 'Health & Assistance', namePt: 'Saúde e Assistência', nameAr: 'الصحة والمساعدة', mappedSlugs: ['home_help'], enabled: true, sortOrder: 7 },
            { slug: 'events', iconName: 'CalendarCheck', nameFr: 'Événementiel', nameEn: 'Events & Catering', namePt: 'Eventos', nameAr: 'تنظيم الفعاليات', mappedSlugs: ['home_help'], enabled: true, sortOrder: 8 },
            { slug: 'business_services', iconName: 'Building2', nameFr: 'Services aux entreprises', nameEn: 'Business Services', namePt: 'Serviços Empresariais', nameAr: 'خدمات الشركات', mappedSlugs: ['electricity', 'hvac', 'solar'], enabled: true, sortOrder: 9 },
            { slug: 'commerce', iconName: 'ShoppingBag', nameFr: 'Commerce', nameEn: 'Commerce & Retail', namePt: 'Comércio', nameAr: 'التجارة', mappedSlugs: ['phone_repair'], enabled: true, sortOrder: 10 },
            { slug: 'agriculture', iconName: 'Leaf', nameFr: 'Agriculture', nameEn: 'Agriculture & Agri-Tech', namePt: 'Agricultura', nameAr: 'الزراعة', mappedSlugs: ['solar', 'mechanics'], enabled: true, sortOrder: 11 },
            { slug: 'professional_services', iconName: 'Briefcase', nameFr: 'Services professionnels', nameEn: 'Professional Services', namePt: 'Serviços Profissionais', nameAr: 'الخدمات المهنية', mappedSlugs: ['electricity', 'plumbing', 'hvac', 'solar'], enabled: true, sortOrder: 12 },
          ],
        },
        updatedByUid: 'SYSTEM_INIT',
      },
      {
        key: 'home_faq',
        value: {
          items: [
            {
              id: 'faq-register',
              category: 'registration',
              questionFr: 'Comment m’inscrire sur KAZI AFRICA ?',
              questionEn: 'How do I sign up on KAZI AFRICA?',
              questionPt: 'Como posso registar-me na KAZI AFRICA?',
              questionAr: 'كيف أسجل في KAZI AFRICA؟',
              answerFr: 'Cliquez sur « Se connecter » ou « S’inscrire », connectez-vous avec votre compte Google sécurisé, puis sélectionnez votre pays et votre rôle (Client, Professionnel ou Entreprise).',
              answerEn: 'Click "Sign In" or "Sign Up", authenticate via your secure Google account, then choose your country and workspace role (Client, Professional, or Enterprise).',
              answerPt: 'Clique em "Entrar" ou "Registar", autentique-se com a sua conta Google segura e selecione o seu país e função (Cliente, Profissional ou Empresa).',
              answerAr: 'انقر على "تسجيل الدخول" أو "إنشاء حساب"، وسجّل الدخول عبر حساب غوغل الآمن ثم اختر دولتك ودورك (عميل أو مهني أو شركة).',
              enabled: true,
              sortOrder: 1,
            },
            {
              id: 'faq-find-pro',
              category: 'services',
              questionFr: 'Comment trouver un professionnel fiable ?',
              questionEn: 'How can I find a reliable professional?',
              questionPt: 'Como encontrar um profissional de confiança?',
              questionAr: 'كيف أجد مهنياً موثوقاً؟',
              answerFr: 'Utilisez la barre de recherche ou le filtre « Vérifiés uniquement ». Le badge Vérifié est attribué exclusivement après contrôle documentaire humain par l’administration locale ou centrale, accompagné d’avis clients réels.',
              answerEn: 'Use the search bar or "Verified only" filter. The Verified badge is granted exclusively after human document review by platform administrators alongside real client reviews.',
              answerPt: 'Utilize a barra de pesquisa ou o filtro "Apenas verificados". O selo Verificado é atribuído apenas após revisão documental humana pela administração, junto com avaliações reais de clientes.',
              answerAr: 'استخدم شريط البحث أو مرشح "الموثقون فقط". تُمنح شارة التوثيق حصرياً بعد مراجعة بشرية للوثائق من طرف الإدارة مع تقييمات حقيقية.',
              enabled: true,
              sortOrder: 2,
            },
            {
              id: 'faq-payments',
              category: 'payments',
              questionFr: 'Les paiements sont-ils sécurisés ?',
              questionEn: 'Are payments secured on the platform?',
              questionPt: 'Os pagamentos são seguros na plataforma?',
              questionAr: 'هل المدفوعات آمنة على المنصة؟',
              answerFr: 'Chaque marché actif configure ses prestataires vérifiés (virement B2B, carte internationale ou Mobile Money en environnement sandbox selon l’état réglementaire du pays). Les transactions sont tracées côté serveur avec reçu officiel.',
              answerEn: 'Each active market configures verified or sandbox payment providers depending on local regulatory status (B2B bank transfer, card gateway, or Mobile Money sandbox). Every transaction is server-reconciled with an official receipt.',
              answerPt: 'Cada mercado ativo configura prestadores verificados ou em sandbox conforme o estado regulatório local. Todas as transações são conciliadas no servidor com recibo oficial.',
              answerAr: 'يتم ضبط مزودي الدفع المعتمدين أو التجريبيين في كل سوق نشط وفق اللوائح المحلية، مع مطابقة على الخادم وإيصال رسمي.',
              enabled: true,
              sortOrder: 3,
            },
            {
              id: 'faq-verification',
              category: 'verification',
              questionFr: 'Comment fonctionne la vérification des professionnels ?',
              questionEn: 'How does professional verification work?',
              questionPt: 'Como funciona a verificação dos profissionais?',
              questionAr: 'كيف يتم توثيق المهنيين؟',
              answerFr: 'Le professionnel soumet sa pièce d’identité nationale, son diplôme ou certificat métier et son attestation d’assurance dans son Espace Pro. Aucun compte ne peut s’auto-vérifier : seule la modération valide le statut.',
              answerEn: 'Professionals submit national ID, trade diploma/certificate, and insurance documents in their Pro Workspace. Self-verification is strictly blocked: only platform reviewers approve verification.',
              answerPt: 'O profissional envia documento de identificação, diploma ou certificado e seguro no Espaço Pro. A autoverificação é bloqueada: apenas a moderação aprova o estatuto.',
              answerAr: 'يرفع المهني بطاقة الهوية والدبلوم المهني والتأمين في فضائه. التوثيق الذاتي ممنوع تقنياً ولا يُمنح إلا بموافقة الإدارة.',
              enabled: true,
              sortOrder: 4,
            },
            {
              id: 'faq-security',
              category: 'security',
              questionFr: 'Comment sont protégées nos données et interventions ?',
              questionEn: 'How are user data and interventions protected?',
              questionPt: 'Como são protegidos os dados e as intervenções?',
              questionAr: 'كيف تتم حماية البيانات والتدخلات؟',
              answerFr: 'Les échanges passent par une messagerie rattachée aux missions, la validation finale d’intervention appartient au client, et un module dédié permet d’ouvrir et d’arbitrer tout litige avec journal d’audit.',
              answerEn: 'Communications stay inside mission-scoped messaging, final work validation belongs to the client, and any dispute is routed through moderated resolution backed by full audit logs.',
              answerPt: 'As mensagens ficam associadas às missões, a validação final cabe ao cliente e qualquer litígio é tratado com mediação e registo de auditoria.',
              answerAr: 'تتم المراسلات داخل كل مهمة بأمان، ويعود التأكيد النهائي للإنجاز للعميل مع آلية تحكيم للنزاعات وسجل تدقيق كامل.',
              enabled: true,
              sortOrder: 5,
            },
          ],
        },
        updatedByUid: 'SYSTEM_INIT',
      },
      {
        key: 'home_opportunities',
        value: {
          items: [
            {
              id: 'opp-solar-ci',
              type: 'PARTNERSHIP',
              domain: 'education_training',
              countryIso2: 'CI',
              city: 'Abidjan',
              titleFr: 'Partenariat centres de formation Solaire & BTP — Côte d’Ivoire',
              titleEn: 'Solar & Construction Training Center Partnership — Côte d’Ivoire',
              titlePt: 'Parceria com centros de formação Solar e Construção — Costa do Marfim',
              titleAr: 'شراكة مع مراكز التدريب في الطاقة الشمسية والبناء — ساحل العاج',
              summaryFr: 'Appel aux organismes techniques souhaitant certifier des cohortes sur KAZI Skills.',
              summaryEn: 'Call for technical institutes looking to certify cohorts via KAZI Skills.',
              summaryPt: 'Convite a institutos técnicos para certificar turmas através da KAZI Skills.',
              summaryAr: 'دعوة للمعاهد التقنية لاعتماد المتدربين عبر كازي سكيلز.',
              organizationName: 'KAZI Skills Network',
              isPilotProgram: true,
            },
            {
              id: 'opp-b2b-sn',
              type: 'JOB',
              domain: 'business_services',
              countryIso2: 'SN',
              city: 'Dakar',
              titleFr: 'Techniciens multi-techniques B2B (CVC & Électricité) — Dakar',
              titleEn: 'B2B Multi-Trade Technicians (HVAC & Electrical) — Dakar',
              titlePt: 'Técnicos multitécnicos B2B (AVAC e Eletricidade) — Dakar',
              titleAr: 'فنيو الصيانة متعددة التخصصات للشركات — داكار',
              summaryFr: 'Opportunité d’affectation sur contrats de maintenance tertiaire dans les marchés actifs.',
              summaryEn: 'Assignment opportunity on commercial maintenance contracts in active markets.',
              summaryPt: 'Oportunidade de afetação em contratos de manutenção empresarial nos mercados ativos.',
              summaryAr: 'فرصة عمل ضمن عقود الصيانة للشركات في الأسواق النشطة.',
              organizationName: 'Réseau Entreprises KAZI',
              isPilotProgram: true,
            },
            {
              id: 'opp-coop-pan',
              type: 'ENTREPRENEURSHIP',
              domain: 'home_building',
              countryIso2: 'CI',
              city: 'Abidjan',
              titleFr: 'Programme de structuration pour artisans indépendants (KAZI Pro)',
              titleEn: 'Independent Artisan Growth Program (KAZI Pro)',
              titlePt: 'Programa de estruturação para profissionais independentes (KAZI Pro)',
              titleAr: 'برنامج تطوير الحرفيين المستقلين (KAZI Pro)',
              summaryFr: 'Accès aux devis structurés, au passeport de compétences et aux commandes B2B vérifiées.',
              summaryEn: 'Access structured quoting, digital skills passport, and verified B2B work orders.',
              summaryPt: 'Acesso a orçamentos estruturados, passaporte de competências e encomendas B2B.',
              summaryAr: 'الوصول إلى عروض الأسعار المنظمة وجواز المهارات وطلبات الشركات الموثقة.',
              organizationName: 'KAZI AFRICA Operations',
              isPilotProgram: true,
            },
          ],
        },
        updatedByUid: 'SYSTEM_INIT',
      },
    ])
    .onConflictDoNothing();
}

async function runSeed(): Promise<void> {
  const existingCount = await db.select({ value: count() }).from(countries);
  if ((existingCount[0]?.value ?? 0) >= 54) {
    await ensurePortugueseSeedBackfill();
    return;
  }

  // 1. Languages
  await db
    .insert(languages)
    .values([
      { code: 'fr', nameNative: 'Français', direction: 'ltr', isEnabled: true },
      { code: 'en', nameNative: 'English', direction: 'ltr', isEnabled: true },
      { code: 'pt', nameNative: 'Português', direction: 'ltr', isEnabled: true },
      { code: 'ar', nameNative: 'العربية', direction: 'rtl', isEnabled: true },
    ])
    .onConflictDoNothing();

  // 2. Countries (All 54 African countries)
  const countryMap = new Map<string, string>();
  for (const c of AFRICAN_COUNTRIES_54) {
    const [insertedCountry] = await db
      .insert(countries)
      .values({
        iso2: c.iso2,
        iso3: c.iso3,
        nameFr: c.nameFr,
        nameEn: c.nameEn,
        nameAr: c.nameAr,
        namePt: c.namePt,
        region: c.region,
        capital: c.capital,
        defaultCurrency: c.defaultCurrency,
        currencySymbol: c.currencySymbol,
        defaultLanguage: c.defaultLanguage,
        supportedLanguages: c.supportedLanguages,
        timezone: c.timezone,
        callingCode: c.callingCode,
        status: c.status,
        commissionRatePct: c.commissionRatePct,
        taxRatePct: c.taxRatePct,
        regulatoryNotes: c.regulatoryNotes,
        proSubscriptionMonthly: '3.00',
        enterpriseSubscriptionMonthly: '29.00',
        operatorLicenseMonthly: '99.00',
        pricingCurrency: 'EUR',
      })
      .onConflictDoNothing()
      .returning();

    const countryId = insertedCountry?.id;
    if (!countryId) continue;
    countryMap.set(c.iso2, countryId);

    const isActive = c.status === 'ACTIVE';
    const isTesting = c.status === 'TESTING';

    await db
      .insert(countryDeployments)
      .values({
        countryId,
        configComplete: isActive || isTesting || c.status === 'CONFIGURING',
        complianceVerified: isActive,
        paymentsConfigured: isActive,
        localLeadAssigned: isActive || isTesting,
        securityTestsPassed: isActive || isTesting,
        functionalTestsPassed: isActive || isTesting,
        activationAuthorized: isActive,
        registrationsOpen: isActive,
        missionsOpen: isActive,
        activatedByUid: isActive ? 'SYSTEM_INIT' : null,
        activatedAt: isActive ? new Date() : null,
      })
      .onConflictDoNothing();

    await db.insert(countryCurrencies).values({
      countryId,
      currencyCode: c.defaultCurrency,
      symbol: c.currencySymbol,
      decimals: c.defaultCurrency === 'XOF' || c.defaultCurrency === 'XAF' ? 0 : 2,
      isPrimary: true,
    });

    const moduleKeys = ['marketplace', 'b2b_enterprise', 'kazi_skills', 'ai_assistant', 'instant_booking'];
    for (const mk of moduleKeys) {
      await db.insert(countryModules).values({
        countryId,
        moduleKey: mk,
        enabled: isActive || isTesting || mk === 'kazi_skills',
        config: {},
      });
    }

    // Honest PSP configuration (never claim live availability without verification)
    await db.insert(countryPaymentProviders).values([
      {
        countryId,
        providerCode: 'mobile_money',
        providerLabel: 'Mobile Money (Opérateur local à vérifier)',
        status: isActive ? 'SANDBOX' : 'UNVERIFIED',
        verificationNote: isActive
          ? 'Mode sandbox actif — contrat agrégateur local en cours de signature'
          : 'Disponibilité non vérifiée pour ce pays',
        supportsEscrow: true,
      },
      {
        countryId,
        providerCode: 'card_stripe',
        providerLabel: 'Carte Bancaire (Passerelle internationale)',
        status: isActive ? 'SANDBOX' : 'UNVERIFIED',
        verificationNote: isActive
          ? 'Passerelle carte en environnement de test'
          : 'En attente de validation réglementaire locale',
        supportsEscrow: true,
      },
      {
        countryId,
        providerCode: 'bank_transfer',
        providerLabel: 'Virement Bancaire (B2B)',
        status: isActive ? 'VERIFIED_ACTIVE' : 'UNVERIFIED',
        verificationNote: isActive
          ? 'Autorisé pour facturation Entreprise B2B'
          : 'Non activé',
        supportsEscrow: false,
      },
      {
        countryId,
        providerCode: 'manual_cash',
        providerLabel: 'Paiement manuel autorisé (sur validation)',
        status: isActive ? 'VERIFIED_ACTIVE' : 'DISABLED',
        verificationNote: isActive
          ? 'Autorisé avec rapprochement manuel et suivi de commission'
          : 'Désactivé hors marché actif',
        supportsEscrow: false,
      },
    ]);

    for (const city of c.majorCities) {
      await db.insert(cities).values({
        countryId,
        name: city.name,
        latitude: city.lat.toFixed(6),
        longitude: city.lng.toFixed(6),
        isActive: true,
      });
    }
  }

  // 3. Service Categories (Exact 6 from mockup + Solar/Digital)
  const categoriesData = [
    { slug: 'electricity', nameFr: 'Électricité', nameEn: 'Electricity', nameAr: 'الكهرباء', namePt: 'Eletricidade', iconName: 'Zap', sortOrder: 1 },
    { slug: 'plumbing', nameFr: 'Plomberie', nameEn: 'Plumbing', nameAr: 'السباكة', namePt: 'Canalização', iconName: 'Wrench', sortOrder: 2 },
    { slug: 'phone_repair', nameFr: 'Réparation Téléphone', nameEn: 'Phone Repair', nameAr: 'إصلاح الهواتف', namePt: 'Reparação de Telemóvel', iconName: 'Smartphone', sortOrder: 3 },
    { slug: 'hvac', nameFr: 'Climatisation', nameEn: 'Air Conditioning', nameAr: 'التكييف', namePt: 'Climatização', iconName: 'Wind', sortOrder: 4 },
    { slug: 'mechanics', nameFr: 'Mécanique', nameEn: 'Mechanics', nameAr: 'الميكانيك', namePt: 'Mecânica', iconName: 'Car', sortOrder: 5 },
    { slug: 'home_help', nameFr: 'Aide à domicile', nameEn: 'Home Help', nameAr: 'المساعدة المنزلية', namePt: 'Ajuda Doméstica', iconName: 'Home', sortOrder: 6 },
    { slug: 'solar', nameFr: 'Solaire & Énergie', nameEn: 'Solar & Energy', nameAr: 'الطاقة الشمسية', namePt: 'Solar & Energia', iconName: 'Sun', sortOrder: 7 },
  ];

  const categoryMap = new Map<string, string>();
  for (const cat of categoriesData) {
    const [inserted] = await db
      .insert(serviceCategories)
      .values(cat)
      .onConflictDoNothing()
      .returning();
    if (inserted) categoryMap.set(cat.slug, inserted.id);
  }

  // 4. Skills
  const skillsSeed = [
    { categorySlug: 'electricity', nameFr: 'Installation électrique', nameEn: 'Electrical installation', nameAr: 'التركيب الكهربائي', namePt: 'Instalação elétrica' },
    { categorySlug: 'electricity', nameFr: 'Dépannage et réparation', nameEn: 'Troubleshooting & repair', nameAr: 'إصلاح الأعطال', namePt: 'Diagnóstico e reparação' },
    { categorySlug: 'electricity', nameFr: 'Mise aux normes', nameEn: 'Safety standards compliance', nameAr: 'مطابقة معايير السلامة', namePt: 'Conformidade com normas de segurança' },
    { categorySlug: 'electricity', nameFr: 'Domotique (de base)', nameEn: 'Basic smart home', nameAr: 'الأنظمة الذكية الأساسية', namePt: 'Domótica (básica)' },
    { categorySlug: 'hvac', nameFr: 'Entretien climatisation split', nameEn: 'Split AC maintenance', nameAr: 'صيانة مكيفات سبليت', namePt: 'Manutenção de ar condicionado split' },
    { categorySlug: 'plumbing', nameFr: 'Dépannage fuites & canalisations', nameEn: 'Leak & pipe repair', nameAr: 'إصلاح التسربات والأنابيب', namePt: 'Reparação de fugas e canalizações' },
    { categorySlug: 'solar', nameFr: 'Installation solaire photovoltaïque', nameEn: 'Solar PV installation', nameAr: 'تركيب الألواح الشمسية', namePt: 'Instalação solar fotovoltaica' },
  ];
  const insertedSkills = await db.insert(skills).values(skillsSeed).returning();

  // 5. Profiles (Demo Client, Verified Pros, Enterprise Owner)
  const ciId = countryMap.get('CI')!;
  const snId = countryMap.get('SN')!;
  const kmId = countryMap.get('KM')!;

  const [clientProfile, koffiProfile, awaProfile, yaoProfile, dakarProProfile, emmaProfile] = await db
    .insert(profiles)
    .values([
      {
        uid: 'seed-client-ami',
        email: 'aminata.kone@kazi-demo.africa',
        fullName: 'Aminata Koné',
        phone: '+225 07 00 11 22',
        countryIso2: 'CI',
        cityName: 'Abidjan',
        preferredLang: 'fr',
        activeRole: 'CLIENT',
      },
      {
        uid: 'seed-pro-koffi',
        email: 'koffi.laurent@kazi-demo.africa',
        fullName: 'Koffi Laurent',
        phone: '+225 07 88 44 10',
        avatarUrl: '/src/assets/images/pro_koffi_laurent_1794936770045.jpg',
        countryIso2: 'CI',
        cityName: 'Abidjan',
        preferredLang: 'fr',
        activeRole: 'PROFESSIONAL',
      },
      {
        uid: 'seed-pro-awa',
        email: 'awa.traore@kazi-demo.africa',
        fullName: 'Awa Traoré',
        phone: '+225 05 22 33 44',
        avatarUrl: '/src/assets/images/pro_awa_traore_1794936768899.jpg',
        countryIso2: 'CI',
        cityName: 'Abidjan',
        preferredLang: 'fr',
        activeRole: 'PROFESSIONAL',
      },
      {
        uid: 'seed-pro-yao',
        email: 'yao.services@kazi-demo.africa',
        fullName: 'Yao Services',
        phone: '+225 01 44 55 66',
        avatarUrl: '/src/assets/images/pro_yao_artisan_1794936767842.jpg',
        countryIso2: 'CI',
        cityName: 'Abidjan',
        preferredLang: 'fr',
        activeRole: 'PROFESSIONAL',
      },
      {
        uid: 'seed-pro-ibrahim-sn',
        email: 'ibrahim.diallo@kazi-demo.africa',
        fullName: 'Ibrahim Diallo',
        phone: '+221 77 450 20 10',
        avatarUrl: '/src/assets/images/pro_yao_artisan_1794936767842.jpg',
        countryIso2: 'SN',
        cityName: 'Dakar',
        preferredLang: 'fr',
        activeRole: 'PROFESSIONAL',
      },
      {
        uid: 'seed-ent-emma',
        email: 'direction@emmabtp.africa',
        fullName: 'Emma BTP Direction',
        phone: '+225 27 22 40 50',
        countryIso2: 'CI',
        cityName: 'Abidjan',
        preferredLang: 'fr',
        activeRole: 'ENTERPRISE_ADMIN',
      },
    ])
    .returning();

  await db.insert(userRoles).values([
    { profileId: clientProfile.id, role: 'CLIENT', grantedBy: 'SEED' },
    { profileId: koffiProfile.id, role: 'PROFESSIONAL', grantedBy: 'SEED' },
    { profileId: awaProfile.id, role: 'PROFESSIONAL', grantedBy: 'SEED' },
    { profileId: yaoProfile.id, role: 'PROFESSIONAL', grantedBy: 'SEED' },
    { profileId: dakarProProfile.id, role: 'PROFESSIONAL', grantedBy: 'SEED' },
    { profileId: emmaProfile.id, role: 'ENTERPRISE_ADMIN', grantedBy: 'SEED' },
  ]);

  // 6. Professionals
  const [proKoffi, proAwa, proYao, proIbrahim] = await db
    .insert(professionals)
    .values([
      {
        profileId: koffiProfile.id,
        countryId: ciId,
        primaryCategorySlug: 'electricity',
        headlineFr: "Électricien — 5 ans d'expérience",
        headlineEn: 'Certified Electrician — 5 yrs experience',
        headlineAr: 'كهربائي معتمد — خبرة 5 سنوات',
        headlinePt: 'Eletricista Certificado — 5 anos de experiência',
        bioFr: 'Spécialiste des installations résidentielles et tertiaires à Abidjan. Mise aux normes, tableaux électriques et dépannage rapide.',
        bioEn: 'Residential and commercial electrical specialist in Abidjan. Code compliance, breaker panels, and rapid troubleshooting.',
        bioAr: 'متخصص في التركيبات الكهربائية السكنية والتجارية في أبيدجان ومطابقة معايير السلامة.',
        bioPt: 'Especialista em instalações residenciais e comerciais em Abidjan. Conformidade, quadros elétricos e reparação rápida.',
        yearsExperience: 5,
        hourlyRate: '35.00',
        currency: 'EUR',
        city: 'Abidjan',
        neighborhood: 'Cocody',
        latitude: '5.359952',
        longitude: '-4.008256',
        distanceKm: '1.20',
        isVerified: true,
        isProSubscriber: true,
        availableToday: true,
        ratingAvg: '4.80',
        reviewsCount: 126,
        kaziSkillsScore: 75,
        avatarUrl: '/src/assets/images/pro_koffi_laurent_1794936770045.jpg',
      },
      {
        profileId: awaProfile.id,
        countryId: ciId,
        primaryCategorySlug: 'electricity',
        headlineFr: 'Ingénieure Électricité & Solaire — 6 ans',
        headlineEn: 'Electrical & Solar Engineer — 6 yrs',
        headlineAr: 'مهندسة كهرباء وطاقة شمسية — 6 سنوات',
        headlinePt: 'Engenheira de Eletricidade e Solar — 6 anos',
        bioFr: 'Diagnostique électrique, climatisation et systèmes solaires hybrides pour particuliers et PME.',
        bioEn: 'Electrical diagnostics, HVAC systems, and hybrid solar installations for homes and SMEs.',
        bioAr: 'تشخيص الأعطال الكهربائية وأنظمة التكييف والطاقة الشمسية.',
        bioPt: 'Diagnóstico elétrico, climatização e sistemas solares híbridos para particulares e PME.',
        yearsExperience: 6,
        hourlyRate: '40.00',
        currency: 'EUR',
        city: 'Abidjan',
        neighborhood: 'Marcory',
        latitude: '5.302600',
        longitude: '-3.981800',
        distanceKm: '2.30',
        isVerified: true,
        isProSubscriber: false,
        availableToday: true,
        ratingAvg: '4.70',
        reviewsCount: 89,
        kaziSkillsScore: 90,
        avatarUrl: '/src/assets/images/pro_awa_traore_1794936768899.jpg',
      },
      {
        profileId: yaoProfile.id,
        countryId: ciId,
        primaryCategorySlug: 'plumbing',
        headlineFr: 'Plombier & Multiservices — 7 ans',
        headlineEn: 'Master Plumber & Maintenance — 7 yrs',
        headlineAr: 'سباك وفني صيانة — 7 سنوات',
        headlinePt: 'Canalizador e Multisserviços — 7 anos',
        bioFr: 'Recherche de fuites, installation sanitaire, dépannage électrique de proximité et entretien de bâtiments.',
        bioEn: 'Leak detection, sanitary plumbing, local electrical repairs, and building maintenance.',
        bioAr: 'كشف التسربات وتركيب الأدوات الصحية وصيانة المباني.',
        bioPt: 'Deteção de fugas, instalações sanitárias, reparações elétricas locais e manutenção de edifícios.',
        yearsExperience: 7,
        hourlyRate: '30.00',
        currency: 'EUR',
        city: 'Abidjan',
        neighborhood: 'Yopougon',
        latitude: '5.345317',
        longitude: '-4.084440',
        distanceKm: '3.10',
        isVerified: true,
        isProSubscriber: false,
        availableToday: true,
        ratingAvg: '4.60',
        reviewsCount: 65,
        kaziSkillsScore: 80,
        avatarUrl: '/src/assets/images/pro_yao_artisan_1794936767842.jpg',
      },
      {
        profileId: dakarProProfile.id,
        countryId: snId,
        primaryCategorySlug: 'solar',
        headlineFr: 'Technicien Solaire & Électricité — Dakar',
        headlineEn: 'Solar & Electrical Technician — Dakar',
        headlineAr: 'فني طاقة شمسية وكهرباء — داكار',
        headlinePt: 'Técnico Solar e Eletricidade — Dakar',
        bioFr: 'Installation photovoltaïque et maintenance industrielle certifiée KAZI Skills à Dakar.',
        bioEn: 'Photovoltaic installation and certified industrial maintenance in Dakar.',
        bioAr: 'تركيب الألواح الشمسية والصيانة المعتمدة في داكار.',
        bioPt: 'Instalação fotovoltaica e manutenção industrial certificada KAZI Skills em Dakar.',
        yearsExperience: 4,
        hourlyRate: '32.00',
        currency: 'EUR',
        city: 'Dakar',
        neighborhood: 'Plateau',
        latitude: '14.693700',
        longitude: '-17.444060',
        distanceKm: '1.80',
        isVerified: true,
        isProSubscriber: true,
        availableToday: true,
        ratingAvg: '4.90',
        reviewsCount: 44,
        kaziSkillsScore: 85,
        avatarUrl: '/src/assets/images/pro_yao_artisan_1794936767842.jpg',
      },
    ])
    .returning();

  // Professional skills & services
  for (const sk of insertedSkills.slice(0, 4)) {
    await db.insert(professionalSkills).values({
      professionalId: proKoffi.id,
      skillId: sk.id,
      level: 'CERTIFIED',
      verifiedByKazi: true,
    });
  }
  await db.insert(professionalServices).values([
    {
      professionalId: proKoffi.id,
      categoryId: categoryMap.get('electricity')!,
      titleFr: 'Installation de prises et tableau électrique',
      titleEn: 'Outlets & circuit breaker installation',
      titleAr: 'تركيب المقابس ولوحة الكهرباء',
      titlePt: 'Instalação de tomadas e quadro elétrico',
      basePrice: '225.00',
      currency: 'EUR',
      durationMinutes: 120,
    },
    {
      professionalId: proKoffi.id,
      categoryId: categoryMap.get('electricity')!,
      titleFr: 'Diagnostic panne de courant partielle',
      titleEn: 'Partial power outage diagnostics',
      titleAr: 'تشخيص انقطاع التيار الكهربائي الجزئي',
      titlePt: 'Diagnóstico de falha elétrica parcial',
      basePrice: '75.00',
      currency: 'EUR',
      durationMinutes: 90,
    },
    {
      professionalId: proAwa.id,
      categoryId: categoryMap.get('hvac')!,
      titleFr: 'Entretien complet climatisation split',
      titleEn: 'Full split AC maintenance',
      titleAr: 'صيانة شاملة لمكيف الهواء',
      titlePt: 'Manutenção completa de ar condicionado split',
      basePrice: '95.00',
      currency: 'EUR',
      durationMinutes: 90,
    },
  ]);

  await db.insert(professionalAvailability).values([
    { professionalId: proKoffi.id, dayOfWeek: 1, startTime: '08:00', endTime: '18:00', isAvailable: true },
    { professionalId: proKoffi.id, dayOfWeek: 2, startTime: '08:00', endTime: '18:00', isAvailable: true },
    { professionalId: proKoffi.id, dayOfWeek: 3, startTime: '08:00', endTime: '18:00', isAvailable: true },
  ]);

  // Verifications queue (matches Admin verification queue in mockup)
  await db.insert(verifications).values([
    {
      professionalId: proKoffi.id,
      docType: 'NATIONAL_ID',
      documentName: 'CNI Côte d\'Ivoire — Koffi Laurent',
      documentStorageRef: 'kazi-vault/ci/cni-koffi.pdf',
      status: 'APPROVED',
      reviewerUid: 'SYSTEM_INIT',
      reviewedAt: new Date(),
    },
    {
      professionalId: proYao.id,
      docType: 'TRADE_DIPLOMA',
      documentName: 'Certificat d\'aptitude professionnelle — Plomberie',
      documentStorageRef: 'kazi-vault/ci/cap-yao.pdf',
      status: 'PENDING',
    },
    {
      professionalId: proIbrahim.id,
      docType: 'INSURANCE',
      documentName: 'Attestation Responsabilité Civile Pro — Dakar',
      documentStorageRef: 'kazi-vault/sn/rc-ibrahim.pdf',
      status: 'PENDING',
    },
  ]);

  // 7. Organization (Emma BTP from mockup Screen 9)
  const [emmaOrg] = await db
    .insert(organizations)
    .values({
      countryId: ciId,
      name: 'Emma BTP',
      sector: 'BTP & Maintenance Industrielle',
      registrationNumber: 'CI-ABJ-2024-B-19402',
      subscriptionPlan: 'ENTERPRISE',
      billingCurrency: 'EUR',
      ownerProfileId: emmaProfile.id,
    })
    .returning();

  await db.insert(orgMembers).values([
    { organizationId: emmaOrg.id, profileId: emmaProfile.id, memberRole: 'OWNER', siteLocation: 'Siège Abidjan' },
    { organizationId: emmaOrg.id, profileId: koffiProfile.id, memberRole: 'TECHNICIAN', siteLocation: 'Siège Abidjan' },
    { organizationId: emmaOrg.id, profileId: awaProfile.id, memberRole: 'TECHNICIAN', siteLocation: 'Entrepôt Yopougon' },
    { organizationId: emmaOrg.id, profileId: yaoProfile.id, memberRole: 'TECHNICIAN', siteLocation: 'Chantier Cocody' },
  ]);

  // 8. Missions, Quotes, Bookings, Payments, Commissions, Reviews
  const [m1, m2, m3, m4] = await db
    .insert(missions)
    .values([
      {
        referenceCode: 'KZ-2026-01584',
        countryId: ciId,
        clientProfileId: clientProfile.id,
        categoryId: categoryMap.get('electricity')!,
        targetProfessionalId: proKoffi.id,
        title: 'Panne de courant partielle dans le salon et la cuisine',
        description: 'Disjoncteur différentiel qui saute dès que le climatiseur et les prises cuisine fonctionnent ensemble.',
        address: 'Cocody, Abidjan',
        city: 'Abidjan',
        desiredDate: '2026-11-20',
        timeSlot: '14:00 - 16:00',
        estimatedBudget: '225.00',
        currency: 'EUR',
        status: 'IN_PROGRESS',
      },
      {
        referenceCode: 'KZ-2026-01589',
        countryId: ciId,
        clientProfileId: clientProfile.id,
        categoryId: categoryMap.get('electricity')!,
        targetProfessionalId: proKoffi.id,
        title: 'Installation de prises',
        description: 'Pose de 6 prises avec mise à la terre dans un bureau à Cocody.',
        address: 'Cocody, Abidjan',
        city: 'Abidjan',
        desiredDate: '2026-11-20',
        timeSlot: '14:00 - 16:00',
        estimatedBudget: '225.00',
        currency: 'EUR',
        status: 'REQUESTED',
      },
      {
        referenceCode: 'INT-5842',
        countryId: ciId,
        clientProfileId: emmaProfile.id,
        organizationId: emmaOrg.id,
        categoryId: categoryMap.get('electricity')!,
        targetProfessionalId: proKoffi.id,
        title: 'Maintenance tableau principal — Siège Abidjan',
        description: 'Vérification thermographique et équilibrage des phases.',
        address: 'Siège Abidjan, Plateau',
        city: 'Abidjan',
        desiredDate: '2026-11-20',
        timeSlot: '09:00 - 12:00',
        estimatedBudget: '480.00',
        currency: 'EUR',
        status: 'IN_PROGRESS',
      },
      {
        referenceCode: 'INT-5839',
        countryId: ciId,
        clientProfileId: emmaProfile.id,
        organizationId: emmaOrg.id,
        categoryId: categoryMap.get('hvac')!,
        targetProfessionalId: proAwa.id,
        title: 'Entretien groupe froid — Entrepôt Yopougon',
        description: 'Nettoyage filtres et contrôle pression fluide frigorigène.',
        address: 'Entrepôt Yopougon, Zone Industrielle',
        city: 'Abidjan',
        desiredDate: '2026-11-21',
        timeSlot: '10:00 - 13:00',
        estimatedBudget: '360.00',
        currency: 'EUR',
        status: 'ACCEPTED',
      },
    ])
    .returning();

  const [q1] = await db
    .insert(quotes)
    .values([
      {
        missionId: m1.id,
        professionalId: proKoffi.id,
        amount: '225.00',
        currency: 'EUR',
        scopeDetails: 'Remplacement différentiel 30mA, équilibrage ligne cuisine, test charge complète.',
        estimatedDuration: '2h00',
        status: 'ACCEPTED',
      },
    ])
    .returning();

  const [b1, bCompleted] = await db
    .insert(bookings)
    .values([
      {
        bookingNumber: 'KZ-2026-01584',
        missionId: m1.id,
        quoteId: q1.id,
        clientProfileId: clientProfile.id,
        professionalId: proKoffi.id,
        countryId: ciId,
        agreedAmount: '225.00',
        currency: 'EUR',
        scheduledStart: new Date('2026-11-20T14:00:00Z'),
        scheduledEnd: new Date('2026-11-20T16:00:00Z'),
        status: 'IN_PROGRESS',
      },
      {
        bookingNumber: 'INT-5835',
        missionId: m3.id,
        clientProfileId: emmaProfile.id,
        professionalId: proYao.id,
        countryId: ciId,
        agreedAmount: '310.00',
        currency: 'EUR',
        scheduledStart: new Date('2026-11-12T09:00:00Z'),
        scheduledEnd: new Date('2026-11-12T12:00:00Z'),
        status: 'COMPLETED',
        clientValidatedAt: new Date('2026-11-12T12:15:00Z'),
      },
    ])
    .returning();

  await db.insert(bookingStatusHistory).values([
    { bookingId: b1.id, fromStatus: null, toStatus: 'CONFIRMED', actorUid: clientProfile.uid, note: 'Devis accepté par le client' },
    { bookingId: b1.id, fromStatus: 'CONFIRMED', toStatus: 'IN_PROGRESS', actorUid: koffiProfile.uid, note: 'Technicien arrivé sur site' },
  ]);

  const [p1] = await db
    .insert(payments)
    .values([
      {
        bookingId: bCompleted.id,
        countryId: ciId,
        payerProfileId: emmaProfile.id,
        amountGross: '310.00',
        commissionAmount: '31.00',
        netToProfessional: '279.00',
        currency: 'EUR',
        providerCode: 'bank_transfer',
        idempotencyKey: 'seed-payment-int-5835',
        status: 'CONFIRMED_SERVER',
        externalRef: 'BNK-2026-5835',
        confirmedAt: new Date(),
      },
    ])
    .returning();

  await db.insert(commissions).values({
    paymentId: p1.id,
    countryId: ciId,
    ratePct: '10.00',
    amount: '31.00',
    currency: 'EUR',
  });

  await db.insert(paymentTransactions).values({
    paymentId: p1.id,
    eventType: 'SERVER_RECONCILED',
    payload: { source: 'seed', amount: '310.00', currency: 'EUR' },
    signatureVerified: true,
  });

  await db.insert(reviews).values({
    bookingId: bCompleted.id,
    professionalId: proKoffi.id,
    authorProfileId: clientProfile.id,
    rating: 5,
    comment: 'Intervention très propre à Cocody, diagnostic rapide et respect des normes de sécurité.',
  });

  await db.insert(messages).values([
    {
      missionId: m1.id,
      senderProfileId: clientProfile.id,
      recipientProfileId: koffiProfile.id,
      content: 'Bonjour Koffi, le tableau est situé dans le couloir principal.',
    },
    {
      missionId: m1.id,
      senderProfileId: koffiProfile.id,
      recipientProfileId: clientProfile.id,
      content: 'Merci Aminata, je suis sur place avec les appareils de mesure.',
    },
  ]);

  await db.insert(notifications).values([
    {
      profileId: clientProfile.id,
      type: 'BOOKING_UPDATE',
      titleFr: 'Intervention en cours',
      titleEn: 'Intervention in progress',
      titleAr: 'التدخل قيد التنفيذ',
      titlePt: 'Intervenção em curso',
      bodyFr: 'Koffi Laurent a démarré la mission KZ-2026-01584 à Cocody.',
      bodyEn: 'Koffi Laurent started mission KZ-2026-01584 in Cocody.',
      bodyAr: 'بدأ كوفي لوران المهمة KZ-2026-01584 في كوكودي.',
      bodyPt: 'Koffi Laurent iniciou a missão KZ-2026-01584 em Cocody.',
    },
  ]);

  await db.insert(disputes).values([
    {
      missionId: m1.id,
      countryId: kmId,
      openedByProfileId: clientProfile.id,
      reason: 'Retard de facturation sur pièce de rechange — demande de vérification tarifaire.',
      status: 'OPEN',
    },
  ]);

  // 9. KAZI Skills Courses & Passport
  const [c1] = await db
    .insert(trainingCourses)
    .values([
      {
        categorySlug: 'solar',
        partnerOrgName: 'Institut Panafricain de l\'Énergie (IPE)',
        titleFr: 'Installation solaire photovoltaïque',
        titleEn: 'Solar Photovoltaic Installation',
        titleAr: 'تركيب الطاقة الشمسية الكهروضوئية',
        titlePt: 'Instalação solar fotovoltaica',
        descriptionFr: 'Dimensionnement, câblage DC/AC, mise à la terre et maintenance des systèmes solaires autonomes et hybrides.',
        descriptionEn: 'Sizing, DC/AC wiring, grounding, and maintenance of off-grid and hybrid solar systems.',
        descriptionAr: 'تصميم وتوصيل وصيانة أنظمة الطاقة الشمسية المستقلة والهجينة.',
        descriptionPt: 'Dimensionamento, cablagem DC/AC, ligação à terra e manutenção de sistemas solares autónomos e híbridos.',
        durationHours: 4,
        level: 'BEGINNER',
        deliveryMode: 'ONLINE',
        priceEur: '25.00',
        enrolledCount: 1248,
        thumbnailUrl: '/src/assets/images/course_solar_installation_1794936769118.jpg',
        status: 'PUBLISHED',
        credentialType: 'PARTNER_ATTESTATION',
      },
      {
        categorySlug: 'electricity',
        partnerOrgName: 'KAZI Skills Academy',
        titleFr: 'Mise aux normes électriques',
        titleEn: 'Electrical Safety Compliance',
        titleAr: 'مطابقة معايير السلامة الكهربائية',
        titlePt: 'Conformidade e normas elétricas',
        descriptionFr: 'Protection différentielle, sélectivité, schémas unifilaires et prévention des risques électriques en Afrique.',
        descriptionEn: 'Differential protection, selectivity, single-line diagrams, and electrical hazard prevention.',
        descriptionAr: 'الحماية التفاضلية والوقاية من المخاطر الكهربائية.',
        descriptionPt: 'Proteção diferencial, seletividade, esquemas unifilares e prevenção de riscos elétricos em África.',
        durationHours: 6,
        level: 'CONFIRMED',
        deliveryMode: 'HYBRID',
        priceEur: '35.00',
        enrolledCount: 942,
        thumbnailUrl: '/src/assets/images/hero_african_professionals_1794936767192.jpg',
        status: 'PUBLISHED',
        credentialType: 'KAZI_EVALUATION',
      },
      {
        categorySlug: 'plumbing',
        partnerOrgName: 'Centre Technique des Métiers d\'Abidjan',
        titleFr: 'Plomberie — Dépannage & installation',
        titleEn: 'Plumbing — Repair & Installation',
        titleAr: 'السباكة — الإصلاح والتركيب',
        titlePt: 'Canalização — Reparação e instalação',
        descriptionFr: 'Soudure PER/multicouche, détection acoustique de fuites et pose sanitaire conforme.',
        descriptionEn: 'PEX/multilayer piping, acoustic leak detection, and compliant sanitary installation.',
        descriptionAr: 'تركيب الأنابيب وكشف التسربات وصيانة الأدوات الصحية.',
        descriptionPt: 'Soldadura PEX/multicamada, deteção acústica de fugas e instalação sanitária em conformidade.',
        durationHours: 5,
        level: 'INTERMEDIATE',
        deliveryMode: 'IN_PERSON',
        priceEur: '45.00',
        enrolledCount: 786,
        thumbnailUrl: '/src/assets/images/pro_yao_artisan_1794936767842.jpg',
        status: 'PUBLISHED',
        credentialType: 'OFFICIAL_DIPLOMA',
      },
    ])
    .returning();

  await db.insert(enrollments).values({
    courseId: c1.id,
    profileId: koffiProfile.id,
    progressPct: 75,
    status: 'IN_PROGRESS',
  });

  await db.insert(evaluations).values([
    {
      courseId: c1.id,
      profileId: koffiProfile.id,
      evaluationType: 'PRACTICAL',
      scorePct: 88,
      status: 'PASSED',
    },
    {
      courseId: c1.id,
      profileId: koffiProfile.id,
      evaluationType: 'THEORETICAL',
      scorePct: 92,
      status: 'PASSED',
    },
  ]);

  await db.insert(skillPassports).values({
    profileId: koffiProfile.id,
    tradeTitle: 'Électricien',
    completionPct: 75,
    practicalStatus: 'PASSED',
    theoreticalStatus: 'PASSED',
    kaziCertStatus: 'IN_PROGRESS',
  });

  await db.insert(certifications).values([
    {
      profileId: koffiProfile.id,
      skillId: insertedSkills[0]?.id,
      credentialCategory: 'KAZI_EVALUATION',
      title: 'Évaluation pratique Électricité Bâtiment',
      issuerName: 'KAZI Skills',
      certificateCode: 'KAZI-EVAL-2026-8841',
    },
    {
      profileId: koffiProfile.id,
      skillId: insertedSkills[2]?.id,
      credentialCategory: 'PARTNER_ATTESTATION',
      title: 'Attestation Sécurité & Normes Basse Tension',
      issuerName: 'Institut Panafricain de l\'Énergie (IPE)',
      certificateCode: 'PART-IPE-2026-3019',
    },
  ]);

  await db.insert(platformSettings).values({
    key: 'monetization_defaults',
    value: {
      commissionMinPct: 8,
      commissionMaxPct: 12,
      defaultCommissionPct: 10,
      proSubscriptionEur: 3,
      enterpriseSubscriptionEur: 29,
      operatorLicenseEur: 99,
      trainingCommissionPct: 15,
    },
    updatedByUid: 'SYSTEM_INIT',
  });

  await db.insert(auditLogs).values([
    {
      actorUid: 'SYSTEM_INIT',
      actorRole: 'SUPER_ADMIN',
      countryIso2: 'CI',
      action: 'COUNTRY_MARKET_ACTIVATED',
      entityType: 'country',
      entityId: ciId,
      details: { iso2: 'CI', reason: 'Initial pilot market activation' },
    },
    {
      actorUid: 'SYSTEM_INIT',
      actorRole: 'SUPER_ADMIN',
      countryIso2: 'SN',
      action: 'COUNTRY_MARKET_ACTIVATED',
      entityType: 'country',
      entityId: snId,
      details: { iso2: 'SN', reason: 'Initial pilot market activation' },
    },
  ]);
}
