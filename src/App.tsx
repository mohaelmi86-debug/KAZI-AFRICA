import React from 'react';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { Globe } from 'lucide-react';
import { AppProvider, useApp } from './app/AppContext';
import { AuthProvider } from './modules/auth/AuthContext';
import { KAZI_BRAND } from './config/brand';
import { KaziBrand } from './components/KaziBrand';
import { getLocalizedField, TRANSLATIONS, type LangCode } from './i18n/translations';
import {
  MobileBottomTabBar,
  NotFoundView,
  TopNavBar,
  WorkspaceUtilityBar,
} from './components/DesignSystem';
import { OfflineIndicator } from './components/PWAControls';
import { ClientHomeModule } from './modules/clients/ClientHomeModule';
import { ProfessionalsDirectoryModule } from './modules/professionals/ProfessionalsDirectoryModule';
import { MissionsBookingsModule } from './modules/bookings/MissionsBookingsModule';
import { ProWorkspaceModule } from './modules/professionals/ProWorkspaceModule';
import { KaziSkillsModule } from './modules/kazi-skills/KaziSkillsModule';
import { EnterpriseModule } from './modules/companies/EnterpriseModule';
import { AdminConsoleModule } from './modules/administration/AdminConsoleModule';
import { OpportunitiesModule } from './modules/home/OpportunitiesModule';
import { CountriesExplorerModule } from './modules/home/CountriesExplorerModule';
import {
  AboutPage,
  ContactPage,
  HelpPage,
  PrivacyPage,
  TermsPage,
} from './modules/home/InfoLegalViews';

class BrandErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      let currentLang: LangCode = 'fr';
      try {
        const stored = localStorage.getItem('kazi_lang');
        if (stored === 'fr' || stored === 'en' || stored === 'pt' || stored === 'ar') {
          currentLang = stored;
        }
      } catch {
        // ignore
      }
      const dict = TRANSLATIONS[currentLang];
      return (
        <div className="max-w-lg mx-auto my-12 px-4">
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center space-y-5">
            <div className="flex justify-center">
              <KaziBrand variant="symbol" theme="light" size="lg" />
            </div>
            <div className="space-y-1">
              <h2 className="font-display text-lg font-bold text-kazi-navy">
                {dict.common.errorBoundaryTitle}
              </h2>
              <p className="text-sm text-slate-600">
                {dict.common.errorBoundaryDesc}
              </p>
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 rounded-lg bg-kazi-navy text-white text-sm font-semibold hover:bg-kazi-navy-mid transition-colors"
            >
              {dict.common.reload}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const KaziFooter: React.FC = () => {
  const { t, lang, setLang, countries, selectedCountryIso2, setSelectedCountryIso2 } = useApp();

  const columns = [
    {
      title: t.footer.colServices,
      links: [
        { label: t.footer.linkFindPro, to: '/professionals' },
        { label: t.footer.linkCategories, to: '/professionals' },
        { label: t.footer.linkKaziSkills, to: '/skills' },
        { label: t.footer.linkOpportunities, to: '/opportunities' },
      ],
    },
    {
      title: t.footer.colProfessionals,
      links: [
        { label: t.footer.linkCreatePro, to: '/pro-space' },
        { label: t.footer.linkPublishServices, to: '/pro-space' },
        { label: t.footer.linkManageRequests, to: '/pro-space' },
        { label: t.footer.linkGrowActivity, to: '/pro-space' },
      ],
    },
    {
      title: t.footer.colEnterprise,
      links: [
        { label: t.footer.linkEnterpriseSolutions, to: '/enterprise' },
        { label: t.footer.linkRecruitTalent, to: '/enterprise' },
        { label: t.footer.linkPartnerships, to: '/contact?subject=Partnership' },
      ],
    },
    {
      title: t.footer.colAbout,
      links: [
        { label: t.footer.linkVision, to: '/about' },
        { label: t.footer.linkTeam, to: '/about' },
        { label: t.footer.linkContact, to: '/contact' },
      ],
    },
    {
      title: t.footer.colHelp,
      links: [
        { label: t.footer.linkHelpCenter, to: '/help' },
        { label: t.footer.linkFaq, to: '/help' },
        { label: t.footer.linkTerms, to: '/terms' },
        { label: t.footer.linkPrivacy, to: '/privacy' },
      ],
    },
  ];

  return (
    <footer className="bg-[#102D3A] text-slate-200 border-t border-white/10 pt-10 pb-24 md:pb-8 no-print">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-8">
          {/* Brand Column */}
          <div className="lg:col-span-3 space-y-3">
            <KaziBrand variant="compact" theme="dark" size="sm" />
            <p className="text-xs text-slate-300 leading-relaxed max-w-xs">
              {t.footer.presentation}
            </p>
            <div className="text-[11px] font-semibold text-[#E9B66B]">
              {KAZI_BRAND.tagline}
            </div>
          </div>

          {/* 5 Structured Navigation Columns */}
          <div className="lg:col-span-7 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-6 text-xs">
            {columns.map((col) => (
              <div key={col.title} className="space-y-2.5">
                <h3 className="font-display font-bold text-white text-xs tracking-wide">
                  {col.title}
                </h3>
                <ul className="space-y-1.5">
                  {col.links.map((lk) => (
                    <li key={`${col.title}-${lk.label}`}>
                      <Link
                        to={lk.to}
                        className="text-slate-300 hover:text-[#E9B66B] transition-colors inline-block py-0.5"
                      >
                        {lk.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Right Controls: Social + Country & Language Selectors */}
          <div className="lg:col-span-2 space-y-4">
            <div className="space-y-2">
              <div className="text-xs font-bold text-white">{t.footer.followUs}</div>
              <div className="flex items-center gap-2.5">
                <a
                  href="https://www.linkedin.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="LinkedIn"
                  className="w-8 h-8 rounded-lg bg-white/10 hover:bg-[#087F70] text-white text-[11px] font-bold flex items-center justify-center transition-colors"
                >
                  in
                </a>
                <a
                  href="https://x.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="X"
                  className="w-8 h-8 rounded-lg bg-white/10 hover:bg-[#087F70] text-white text-[11px] font-bold flex items-center justify-center transition-colors"
                >
                  X
                </a>
                <a
                  href="https://www.instagram.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Instagram"
                  className="w-8 h-8 rounded-lg bg-white/10 hover:bg-[#087F70] text-white text-[11px] font-bold flex items-center justify-center transition-colors"
                >
                  IG
                </a>
                <a
                  href="https://www.youtube.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="YouTube"
                  className="w-8 h-8 rounded-lg bg-white/10 hover:bg-[#087F70] text-white text-[11px] font-bold flex items-center justify-center transition-colors"
                >
                  YT
                </a>
              </div>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 rounded-lg border border-white/20 bg-[#0b202a] px-2.5 py-1.5 text-xs">
                <Globe className="w-3.5 h-3.5 text-[#E9B66B] shrink-0" />
                <select
                  value={selectedCountryIso2}
                  onChange={(e) => setSelectedCountryIso2(e.target.value)}
                  aria-label={t.toolbar.countryLabel}
                  className="w-full bg-transparent text-xs text-white focus:outline-none"
                >
                  {countries.map((c) => (
                    <option key={c.iso2} value={c.iso2} className="text-[#102D3A]">
                      {getLocalizedField(lang, c, 'name')} ({c.iso2})
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="sr-only">{t.toolbar.languageLabel}</span>
                <select
                  value={lang}
                  onChange={(e) => setLang(e.target.value as LangCode)}
                  aria-label={t.toolbar.languageLabel}
                  className="w-full rounded-lg border border-white/20 bg-[#0b202a] px-2.5 py-1.5 text-xs text-white focus:outline-none"
                >
                  <option value="fr" className="text-[#102D3A]">FR — Français</option>
                  <option value="en" className="text-[#102D3A]">EN — English</option>
                  <option value="pt" className="text-[#102D3A]">PT — Português</option>
                  <option value="ar" className="text-[#102D3A]">AR — العربية</option>
                </select>
              </label>
            </div>
          </div>
        </div>

        {/* Bottom Copyright & 54-State Governance Note */}
        <div className="border-t border-white/10 pt-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-[11px] text-slate-400">
          <div>{t.footer.copyright}</div>
          <div className="flex items-center gap-4">
            <Link to="/countries" className="hover:text-[#E9B66B] transition-colors">
              {t.common.footerPreparedStates}
            </Link>
            <span aria-hidden="true">·</span>
            <span>{KAZI_BRAND.descriptor}</span>
          </div>
        </div>
      </div>
    </footer>
  );
};

const AppShell: React.FC = () => {
  const { t } = useApp();
  return (
    <div className="min-h-screen flex flex-col bg-[#FAF7F0] text-[#23343B]">
      <TopNavBar />
      <WorkspaceUtilityBar />
      <main className="flex-1">
        <BrandErrorBoundary>
          <Routes>
            <Route path="/" element={<ClientHomeModule />} />
            <Route path="/professionals" element={<ProfessionalsDirectoryModule />} />
            <Route path="/professionals/:id" element={<ProfessionalsDirectoryModule />} />
            <Route path="/bookings" element={<MissionsBookingsModule />} />
            <Route path="/pro-space" element={<ProWorkspaceModule />} />
            <Route path="/skills" element={<KaziSkillsModule />} />
            <Route path="/opportunities" element={<OpportunitiesModule />} />
            <Route path="/countries" element={<CountriesExplorerModule />} />
            <Route path="/enterprise" element={<EnterpriseModule />} />
            <Route path="/admin" element={<AdminConsoleModule />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/contact" element={<ContactPage />} />
            <Route path="/help" element={<HelpPage />} />
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="*" element={<NotFoundView />} />
          </Routes>
        </BrandErrorBoundary>
      </main>
      <KaziFooter />
      <MobileBottomTabBar />
      <OfflineIndicator message={t.toolbar.offlineNotice} />
    </div>
  );
};

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppProvider>
          <AppShell />
        </AppProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
