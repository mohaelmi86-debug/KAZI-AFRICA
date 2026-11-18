import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Briefcase,
  Building2,
  CheckCircle2,
  ChevronDown,
  Clock,
  Globe,
  GraduationCap,
  Home,
  LayoutDashboard,
  LogOut,
  Menu,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserCircle2,
  Wrench,
  X,
} from 'lucide-react';
import { useApp } from '../app/AppContext';
import { useAuth } from '../modules/auth/AuthContext';
import { getLocalizedField, type LangCode } from '../i18n/translations';
import { KaziBrand } from './KaziBrand';
import { PWAInstallButton } from './PWAControls';

const NAV_CATEGORIES_PREVIEW = [
  { slug: 'home_building', mapped: 'electricity,plumbing,hvac,home_help,solar', nameFr: 'Maison et bâtiment', nameEn: 'Home & Building', namePt: 'Casa e Construção', nameAr: 'المنزل والبناء' },
  { slug: 'crafts', mapped: 'plumbing,electricity,mechanics', nameFr: 'Artisanat', nameEn: 'Crafts & Trades', namePt: 'Artesanato e Ofícios', nameAr: 'الحرف اليدوية' },
  { slug: 'it_tech', mapped: 'phone_repair', nameFr: 'Informatique et technologie', nameEn: 'IT & Technology', namePt: 'Informática e Tecnologia', nameAr: 'تكنولوجيا المعلومات' },
  { slug: 'transport_delivery', mapped: 'mechanics', nameFr: 'Transport et livraison', nameEn: 'Transport & Delivery', namePt: 'Transporte e Entregas', nameAr: 'النقل والتوصيل' },
  { slug: 'business_services', mapped: 'electricity,hvac,solar', nameFr: 'Services aux entreprises', nameEn: 'Business Services', namePt: 'Serviços Empresariais', nameAr: 'خدمات الشركات' },
  { slug: 'agriculture', mapped: 'solar,mechanics', nameFr: 'Agriculture', nameEn: 'Agriculture & Agri-Tech', namePt: 'Agricultura', nameAr: 'الزراعة' },
  { slug: 'education_training', mapped: 'electricity,solar', nameFr: 'Éducation et formation', nameEn: 'Education & Training', namePt: 'Educação e Formação', nameAr: 'التعليم والتدريب' },
  { slug: 'professional_services', mapped: 'electricity,plumbing,hvac,solar', nameFr: 'Services professionnels', nameEn: 'Professional Services', namePt: 'Serviços Profissionais', nameAr: 'الخدمات المهنية' },
];

export const TopNavBar: React.FC = () => {
  const { t, lang, setLang, countries, selectedCountryIso2, setSelectedCountryIso2 } = useApp();
  const { profile, roles, signIn, signOut, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [openMenu, setOpenMenu] = useState<'categories' | 'countries' | 'account' | null>(null);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setOpenMenu(null);
    setMobileDrawerOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenMenu(null);
        setMobileDrawerOpen(false);
      }
    };
    const onClickOutside = (e: MouseEvent) => {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClickOutside);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClickOutside);
    };
  }, []);

  const isAdmin = roles.includes('SUPER_ADMIN') || roles.includes('LOCAL_ADMIN');
  const activeOrTestingCountries = countries.filter((c) => c.status === 'ACTIVE' || c.status === 'TESTING');

  return (
    <header
      ref={headerRef}
      className="sticky top-0 z-50 bg-[#102D3A] text-white border-b border-white/10 shadow-sm no-print"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
        {/* Left: Official dark-theme KAZI AFRICA brand lockup */}
        <Link
          to="/"
          aria-label="KAZI AFRICA"
          className="inline-flex items-center whitespace-nowrap shrink-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E9B66B]"
        >
          <KaziBrand variant="compact" theme="dark" size="sm" responsiveMobileSymbol />
        </Link>

        {/* Center Desktop Navigation */}
        <nav
          className="hidden lg:flex items-center gap-5 text-[13px] font-medium text-slate-200"
          aria-label="Navigation principale"
        >
          <Link
            to="/"
            className={`whitespace-nowrap py-2 border-b-2 transition-colors ${
              location.pathname === '/'
                ? 'text-white border-[#16A68A] font-semibold'
                : 'border-transparent hover:text-white'
            }`}
          >
            {t.nav.home}
          </Link>

          <Link
            to="/professionals"
            className={`whitespace-nowrap py-2 border-b-2 transition-colors ${
              location.pathname.startsWith('/professionals')
                ? 'text-white border-[#16A68A] font-semibold'
                : 'border-transparent hover:text-white'
            }`}
          >
            {t.nav.findPro}
          </Link>

          {/* Categories Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpenMenu((m) => (m === 'categories' ? null : 'categories'))}
              aria-expanded={openMenu === 'categories'}
              className="inline-flex items-center gap-1 whitespace-nowrap py-2 text-slate-200 hover:text-white transition-colors"
            >
              <span>{t.nav.categories}</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${openMenu === 'categories' ? 'rotate-180' : ''}`} />
            </button>
            {openMenu === 'categories' && (
              <div className="absolute top-full start-0 mt-2 w-72 rounded-xl bg-white text-[#23343B] shadow-xl border border-slate-200 py-2 z-50">
                {NAV_CATEGORIES_PREVIEW.map((cat) => (
                  <button
                    key={cat.slug}
                    type="button"
                    onClick={() => {
                      setOpenMenu(null);
                      navigate(`/professionals?category=${encodeURIComponent(cat.mapped)}&domain=${cat.slug}`);
                    }}
                    className="w-full text-start px-4 py-2 text-xs font-medium hover:bg-[#FAF7F0] hover:text-[#087F70] transition-colors flex items-center justify-between"
                  >
                    <span>{getLocalizedField(lang, cat, 'name')}</span>
                  </button>
                ))}
                <div className="border-t border-slate-100 mt-1 pt-1 px-2">
                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenu(null);
                      navigate('/professionals');
                    }}
                    className="w-full text-start px-2 py-2 text-xs font-bold text-[#087F70] hover:underline"
                  >
                    {t.nav.viewAllCategories} →
                  </button>
                </div>
              </div>
            )}
          </div>

          <Link
            to="/skills"
            className={`whitespace-nowrap py-2 border-b-2 transition-colors ${
              location.pathname.startsWith('/skills')
                ? 'text-white border-[#16A68A] font-semibold'
                : 'border-transparent hover:text-white'
            }`}
          >
            {t.nav.skills}
          </Link>

          <Link
            to="/opportunities"
            className={`whitespace-nowrap py-2 border-b-2 transition-colors ${
              location.pathname.startsWith('/opportunities')
                ? 'text-white border-[#16A68A] font-semibold'
                : 'border-transparent hover:text-white'
            }`}
          >
            {t.nav.opportunities}
          </Link>

          {/* Countries Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpenMenu((m) => (m === 'countries' ? null : 'countries'))}
              aria-expanded={openMenu === 'countries'}
              className={`inline-flex items-center gap-1 whitespace-nowrap py-2 border-b-2 transition-colors ${
                location.pathname.startsWith('/countries')
                  ? 'text-white border-[#16A68A] font-semibold'
                  : 'border-transparent text-slate-200 hover:text-white'
              }`}
            >
              <span>{t.nav.countries}</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${openMenu === 'countries' ? 'rotate-180' : ''}`} />
            </button>
            {openMenu === 'countries' && (
              <div className="absolute top-full end-0 mt-2 w-80 rounded-xl bg-white text-[#23343B] shadow-xl border border-slate-200 p-3 z-50 space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 px-1">
                  {t.hero.activeMarkets} ({activeOrTestingCountries.length}/54)
                </div>
                <div className="space-y-1 max-h-56 overflow-y-auto">
                  {activeOrTestingCountries.map((c) => (
                    <button
                      key={c.iso2}
                      type="button"
                      onClick={() => {
                        setSelectedCountryIso2(c.iso2);
                        setOpenMenu(null);
                      }}
                      className={`w-full text-start px-3 py-2 rounded-lg text-xs flex items-center justify-between transition-colors ${
                        selectedCountryIso2 === c.iso2
                          ? 'bg-[#087F70]/10 text-[#087F70] font-bold'
                          : 'hover:bg-[#FAF7F0] text-slate-700'
                      }`}
                    >
                      <span>
                        {getLocalizedField(lang, c, 'name')} ({c.iso2})
                      </span>
                      <span className="text-[10px] font-semibold text-[#087F70]">
                        {t.statuses[c.status] || c.status}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="border-t border-slate-100 pt-2">
                  <Link
                    to="/countries"
                    onClick={() => setOpenMenu(null)}
                    className="block w-full text-center py-2 rounded-lg bg-[#102D3A] text-white text-xs font-semibold hover:bg-[#184052]"
                  >
                    {t.nav.allCountriesView} →
                  </Link>
                </div>
              </div>
            )}
          </div>
        </nav>

        {/* Right: Language switcher + Auth/Account + Mobile Menu Toggle */}
        <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
          {/* Language Switcher */}
          <label className="sr-only" htmlFor="top-lang-select">
            {t.toolbar.languageLabel}
          </label>
          <select
            id="top-lang-select"
            value={lang}
            onChange={(e) => setLang(e.target.value as LangCode)}
            className="h-9 rounded-lg border border-white/25 bg-[#102D3A] px-2.5 text-xs font-semibold text-white focus:outline-none focus:ring-2 focus:ring-[#E9B66B]"
            aria-label={t.toolbar.languageLabel}
          >
            <option value="fr">FR</option>
            <option value="en">EN</option>
            <option value="pt">PT</option>
            <option value="ar">العربية</option>
          </select>

          {/* Desktop Auth Controls */}
          <div className="hidden sm:flex items-center gap-2">
            {profile ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setOpenMenu((m) => (m === 'account' ? null : 'account'))}
                  aria-expanded={openMenu === 'account'}
                  className="inline-flex items-center gap-2 h-9 px-3 rounded-lg bg-white/10 hover:bg-white/15 border border-white/20 text-xs font-semibold text-white transition-colors"
                >
                  <UserCircle2 className="w-4 h-4 text-[#E9B66B]" />
                  <span className="max-w-[110px] truncate">{profile.fullName}</span>
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
                {openMenu === 'account' && (
                  <div className="absolute top-full end-0 mt-2 w-60 rounded-xl bg-white text-[#23343B] shadow-xl border border-slate-200 py-2 z-50">
                    <div className="px-4 py-2 border-b border-slate-100">
                      <div className="text-xs font-bold text-[#102D3A] truncate">{profile.fullName}</div>
                      <div className="text-[11px] text-slate-500 truncate">{profile.email}</div>
                    </div>
                    <Link
                      to="/bookings"
                      className="flex items-center gap-2 px-4 py-2 text-xs font-medium hover:bg-[#FAF7F0] text-slate-700"
                    >
                      <Briefcase className="w-3.5 h-3.5 text-[#087F70]" />
                      <span>{t.nav.bookings}</span>
                    </Link>
                    <Link
                      to="/pro-space"
                      className="flex items-center gap-2 px-4 py-2 text-xs font-medium hover:bg-[#FAF7F0] text-slate-700"
                    >
                      <Wrench className="w-3.5 h-3.5 text-[#087F70]" />
                      <span>{t.nav.proSpace}</span>
                    </Link>
                    <Link
                      to="/enterprise"
                      className="flex items-center gap-2 px-4 py-2 text-xs font-medium hover:bg-[#FAF7F0] text-slate-700"
                    >
                      <Building2 className="w-3.5 h-3.5 text-[#087F70]" />
                      <span>{t.nav.enterprise}</span>
                    </Link>
                    {isAdmin && (
                      <Link
                        to="/admin"
                        className="flex items-center gap-2 px-4 py-2 text-xs font-semibold hover:bg-[#FAF7F0] text-[#102D3A]"
                      >
                        <LayoutDashboard className="w-3.5 h-3.5 text-[#087F70]" />
                        <span>{t.nav.admin}</span>
                      </Link>
                    )}
                    <div className="border-t border-slate-100 mt-1 pt-1">
                      <button
                        type="button"
                        onClick={signOut}
                        className="w-full text-start flex items-center gap-2 px-4 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span>{t.auth.signOut}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={signIn}
                  disabled={loading}
                  className="h-9 px-3.5 rounded-lg border border-white/30 text-white text-xs font-semibold hover:bg-white/10 transition-colors whitespace-nowrap"
                >
                  {loading ? t.auth.signingIn : t.auth.signIn}
                </button>
                <button
                  type="button"
                  onClick={signIn}
                  disabled={loading}
                  className="h-9 px-4 rounded-lg bg-[#E9B66B] text-[#102D3A] text-xs font-bold hover:bg-[#f0c582] transition-colors whitespace-nowrap"
                >
                  {t.nav.signUp}
                </button>
              </>
            )}
          </div>

          {/* Mobile Drawer Trigger (>=44px touch target) */}
          <button
            type="button"
            onClick={() => setMobileDrawerOpen((o) => !o)}
            aria-label={mobileDrawerOpen ? t.nav.closeMenu : t.nav.openMenu}
            aria-expanded={mobileDrawerOpen}
            className="lg:hidden inline-flex items-center justify-center w-11 h-11 rounded-lg border border-white/20 text-white hover:bg-white/10"
          >
            {mobileDrawerOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Responsive Mobile Navigation Drawer */}
      {mobileDrawerOpen && (
        <div className="lg:hidden bg-[#102D3A] border-t border-white/10 px-4 py-4 space-y-4">
          <div className="grid grid-cols-1 gap-1 text-sm font-medium">
            <Link to="/" className="px-3 py-2.5 rounded-lg hover:bg-white/10 min-h-[44px] flex items-center">
              {t.nav.home}
            </Link>
            <Link to="/professionals" className="px-3 py-2.5 rounded-lg hover:bg-white/10 min-h-[44px] flex items-center">
              {t.nav.findPro}
            </Link>
            <Link to="/skills" className="px-3 py-2.5 rounded-lg hover:bg-white/10 min-h-[44px] flex items-center">
              {t.nav.skills}
            </Link>
            <Link to="/opportunities" className="px-3 py-2.5 rounded-lg hover:bg-white/10 min-h-[44px] flex items-center">
              {t.nav.opportunities}
            </Link>
            <Link to="/countries" className="px-3 py-2.5 rounded-lg hover:bg-white/10 min-h-[44px] flex items-center">
              {t.nav.allCountriesView}
            </Link>
            <Link to="/bookings" className="px-3 py-2.5 rounded-lg hover:bg-white/10 min-h-[44px] flex items-center">
              {t.nav.bookings}
            </Link>
            <Link to="/pro-space" className="px-3 py-2.5 rounded-lg hover:bg-white/10 min-h-[44px] flex items-center">
              {t.nav.proSpace}
            </Link>
            <Link to="/enterprise" className="px-3 py-2.5 rounded-lg hover:bg-white/10 min-h-[44px] flex items-center">
              {t.nav.enterprise}
            </Link>
            {isAdmin && (
              <Link to="/admin" className="px-3 py-2.5 rounded-lg hover:bg-white/10 min-h-[44px] flex items-center text-[#E9B66B]">
                {t.nav.admin}
              </Link>
            )}
          </div>

          <div className="border-t border-white/10 pt-3 space-y-3">
            <label className="block text-xs text-slate-300">
              {t.toolbar.countryLabel}
              <select
                value={selectedCountryIso2}
                onChange={(e) => setSelectedCountryIso2(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/25 bg-[#0a1f29] px-3 py-2.5 text-xs text-white"
              >
                {countries.map((c) => (
                  <option key={c.iso2} value={c.iso2}>
                    {getLocalizedField(lang, c, 'name')} ({c.iso2}) — {t.statuses[c.status] || c.status}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {profile ? (
                <button
                  type="button"
                  onClick={signOut}
                  className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-white/30 text-xs font-semibold text-white"
                >
                  <LogOut className="w-4 h-4" />
                  <span>{t.auth.signOut} ({profile.fullName})</span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={signIn}
                    disabled={loading}
                    className="flex-1 min-h-[44px] px-4 py-2 rounded-lg border border-white/30 text-xs font-semibold text-white"
                  >
                    {t.auth.signIn}
                  </button>
                  <button
                    type="button"
                    onClick={signIn}
                    disabled={loading}
                    className="flex-1 min-h-[44px] px-4 py-2 rounded-lg bg-[#E9B66B] text-[#102D3A] text-xs font-bold"
                  >
                    {t.nav.signUp}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
};

export const WorkspaceUtilityBar: React.FC = () => {
  const { countries, selectedCountryIso2, setSelectedCountryIso2, t, lang } = useApp();
  const { roles } = useAuth();
  const location = useLocation();

  // Keep the homepage clean and faithful to the marketplace visual design; show workspace bar inside app workspaces
  if (location.pathname === '/') return null;

  const isAdmin = roles.includes('SUPER_ADMIN') || roles.includes('LOCAL_ADMIN');

  return (
    <div className="bg-white border-b border-slate-200 no-print">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4 text-xs">
          {/* 54-country selector */}
          <label className="inline-flex items-center gap-2 text-slate-600 font-medium">
            <Globe className="w-4 h-4 text-[#087F70]" />
            <span>{t.toolbar.countryLabel}:</span>
            <select
              value={selectedCountryIso2}
              onChange={(e) => setSelectedCountryIso2(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#087F70]"
              aria-label={t.toolbar.countryLabel}
            >
              {countries.map((c) => {
                const name = getLocalizedField(lang, c, 'name');
                return (
                  <option key={c.iso2} value={c.iso2}>
                    {name} ({c.iso2}) — {t.statuses[c.status] || c.status}
                  </option>
                );
              })}
            </select>
          </label>

          {/* Secondary workspace links */}
          <div className="hidden sm:flex items-center gap-4 border-s border-slate-300 ps-4">
            <Link
              to="/bookings"
              className={`inline-flex items-center gap-1.5 font-medium whitespace-nowrap ${
                location.pathname.startsWith('/bookings')
                  ? 'text-[#087F70] font-semibold'
                  : 'text-slate-600 hover:text-[#102D3A]'
              }`}
            >
              <Briefcase className="w-3.5 h-3.5" />
              <span>{t.nav.bookings}</span>
            </Link>
            <Link
              to="/pro-space"
              className={`inline-flex items-center gap-1.5 font-medium whitespace-nowrap ${
                location.pathname.startsWith('/pro-space')
                  ? 'text-[#087F70] font-semibold'
                  : 'text-slate-600 hover:text-[#102D3A]'
              }`}
            >
              <Wrench className="w-3.5 h-3.5" />
              <span>{t.nav.proSpace}</span>
            </Link>
            <Link
              to="/enterprise"
              className={`inline-flex items-center gap-1.5 font-medium whitespace-nowrap ${
                location.pathname.startsWith('/enterprise')
                  ? 'text-[#087F70] font-semibold'
                  : 'text-slate-600 hover:text-[#102D3A]'
              }`}
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>{t.nav.enterprise}</span>
            </Link>
            {isAdmin && (
              <Link
                to="/admin"
                className={`inline-flex items-center gap-1.5 font-medium whitespace-nowrap ${
                  location.pathname.startsWith('/admin')
                    ? 'text-[#087F70] font-semibold'
                    : 'text-slate-600 hover:text-[#102D3A]'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>{t.nav.admin}</span>
              </Link>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <PWAInstallButton label={t.toolbar.installApp} />
        </div>
      </div>
    </div>
  );
};

export const MobileBottomTabBar: React.FC = () => {
  const { t } = useApp();
  const location = useLocation();
  const tabs = [
    { to: '/', label: t.nav.home, icon: Home },
    { to: '/professionals', label: t.nav.professionals, icon: Search },
    { to: '/bookings', label: t.nav.bookings, icon: Briefcase },
    { to: '/pro-space', label: t.nav.proSpace, icon: Wrench },
    { to: '/skills', label: t.nav.skills, icon: GraduationCap },
  ];

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 h-14 grid grid-cols-5 items-center no-print"
      aria-label="Navigation mobile"
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const active = tab.to === '/' ? location.pathname === '/' : location.pathname.startsWith(tab.to);
        return (
          <Link
            key={tab.to}
            to={tab.to}
            className={`flex flex-col items-center justify-center h-full min-h-[44px] ${
              active ? 'text-[#102D3A] font-semibold' : 'text-slate-500'
            }`}
          >
            <Icon className={`w-4 h-4 ${active ? 'text-[#087F70]' : ''}`} />
            <span className="text-[10px] mt-0.5 truncate max-w-[68px]">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
};

export const StatusLabel: React.FC<{ status: string; label?: string }> = ({ status, label }) => {
  const { t } = useApp();
  const text = label || t.statuses[status] || status;

  if (
    ['ACTIVE', 'APPROVED', 'COMPLETED', 'CONFIRMED_SERVER', 'VERIFIED_ACTIVE', 'PASSED'].includes(status)
  ) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#087F70] whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
        <span>{text}</span>
      </span>
    );
  }
  if (
    ['TESTING', 'PENDING', 'IN_PROGRESS', 'SANDBOX', 'AWAITING_CLIENT_VALIDATION', 'QUOTED'].includes(status)
  ) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 whitespace-nowrap">
        <Clock className="w-3.5 h-3.5 shrink-0" />
        <span>{text}</span>
      </span>
    );
  }
  if (['SUSPENDED', 'REJECTED', 'OPEN', 'FAILED'].includes(status)) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-600 whitespace-nowrap">
        <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
        <span>{text}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 whitespace-nowrap">
      <span>{text}</span>
    </span>
  );
};

export const AuthGateCard: React.FC = () => {
  const { t } = useApp();
  const { signIn, authError } = useAuth();
  return (
    <div className="max-w-lg mx-auto my-12 px-4">
      <div className="bg-white rounded-xl border border-slate-200 p-8 text-center space-y-5">
        <div className="flex justify-center">
          <KaziBrand variant="full" theme="light" size="lg" />
        </div>
        <p className="text-sm text-slate-600 leading-relaxed">{t.auth.accountRequired}</p>
        {authError && <p className="text-xs text-rose-600">{authError}</p>}
        <button
          type="button"
          onClick={signIn}
          className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg bg-[#102D3A] text-white text-sm font-semibold hover:bg-[#184052] transition-colors"
        >
          <Building2 className="w-4 h-4" />
          <span>{t.auth.signInWithGoogle}</span>
        </button>
      </div>
    </div>
  );
};

export const BrandLoadingState: React.FC<{ label?: string }> = ({ label }) => {
  const { t } = useApp();
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-10 flex flex-col items-center justify-center gap-3 text-center">
      <KaziBrand variant="symbol" theme="light" size="md" className="animate-pulse" />
      <p className="text-sm font-medium text-slate-600">{label || t.common.loading}</p>
    </div>
  );
};

export const BrandEmptyState: React.FC<{
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}> = ({ title, subtitle, action }) => (
  <div className="bg-white rounded-xl border border-slate-200 p-8 sm:p-10 flex flex-col items-center justify-center gap-3 text-center">
    <KaziBrand variant="symbol" theme="light" size="md" />
    <div className="space-y-1 max-w-md">
      <h3 className="font-display text-base font-bold text-[#102D3A]">{title}</h3>
      {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
    </div>
    {action && <div className="pt-1">{action}</div>}
  </div>
);

export const NotFoundView: React.FC = () => {
  const { t } = useApp();
  return (
    <div className="max-w-lg mx-auto my-12 px-4">
      <div className="bg-white rounded-xl border border-slate-200 p-8 text-center space-y-5">
        <div className="flex justify-center">
          <KaziBrand variant="full" theme="light" size="lg" />
        </div>
        <div className="space-y-1.5">
          <div className="text-xs font-mono font-semibold text-[#087F70]">404</div>
          <h1 className="font-display text-xl font-bold text-[#102D3A]">{t.slogan}</h1>
          <p className="text-sm text-slate-600">
            {t.common.notFoundDesc}
          </p>
        </div>
        <Link
          to="/"
          className="inline-flex items-center justify-center px-5 py-2.5 rounded-lg bg-[#102D3A] text-white text-sm font-semibold hover:bg-[#184052] transition-colors"
        >
          {t.nav.home}
        </Link>
      </div>
    </div>
  );
};
