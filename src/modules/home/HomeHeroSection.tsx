import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Briefcase, Globe, MapPin, Search, Sparkles, Users } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { getLocalizedField } from '../../i18n/translations';
import { apiFetch } from '../../services/api';

export const HomeHeroSection: React.FC = () => {
  const { t, lang, countries, selectedCountryIso2, setSelectedCountryIso2 } = useApp();
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [heroCountryIso, setHeroCountryIso] = useState<string>(selectedCountryIso2 || 'CI');
  const [heroCity, setHeroCity] = useState<string>('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<{
    recommendedCategorySlug?: string;
    summary: string;
  } | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const selectedHeroCountry = useMemo(
    () => countries.find((c) => c.iso2 === heroCountryIso) || null,
    [countries, heroCountryIso]
  );

  const cityOptions = useMemo(() => {
    if (!selectedHeroCountry) return [];
    return selectedHeroCountry.cities || [];
  }, [selectedHeroCountry]);

  const handleCountryChange = (nextIso: string) => {
    setHeroCountryIso(nextIso);
    setHeroCity('');
    if (nextIso !== 'ALL') {
      setSelectedCountryIso2(nextIso);
    }
  };

  const handleExplore = (e: React.FormEvent) => {
    e.preventDefault();
    const qs = new URLSearchParams();
    if (query.trim()) qs.set('q', query.trim());
    if (heroCountryIso) qs.set('country', heroCountryIso);
    if (heroCity.trim()) qs.set('city', heroCity.trim());
    navigate(`/professionals?${qs.toString()}`);
  };

  const handleAiQuickMatch = async () => {
    if (!query.trim()) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await apiFetch<{ recommendedCategorySlug?: string; summary: string }>('/api/ai/match', {
        method: 'POST',
        body: JSON.stringify({
          query: query.trim(),
          countryIso2: heroCountryIso === 'ALL' ? 'CI' : heroCountryIso,
          lang,
        }),
      });
      setAiResult(res);
    } catch (err: any) {
      setAiError(err.message);
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <section className="relative bg-[#102D3A] text-white overflow-hidden">
      {/* Authentic right-aligned photo with measured scrim for WCAG AA legibility */}
      <div className="absolute inset-0 pointer-events-none">
        <img
          src="/src/assets/images/hero_african_professionals_1794936767192.jpg"
          alt="Professionnels qualifiés KAZI AFRICA"
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover object-right md:object-center opacity-45 md:opacity-75"
        />
        <div
          className="absolute inset-0 bg-gradient-to-r from-[#102D3A] via-[#102D3A]/92 to-[#102D3A]/25 rtl:bg-gradient-to-l"
          aria-hidden="true"
        />
      </div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-10 sm:py-14 lg:py-16">
        <div className="max-w-3xl space-y-5">
          {/* Gold Brand Kicker */}
          <p className="text-xs sm:text-[13px] font-bold tracking-[0.14em] uppercase text-[#E9B66B]">
            {t.homepage.kicker}
          </p>

          {/* Hero Headline */}
          <h1 className="font-display text-3xl sm:text-4xl lg:text-[46px] font-extrabold leading-[1.12] tracking-tight [text-wrap:balance]">
            <span className="block text-white">{t.homepage.headlineLine1}</span>
            <span className="block text-[#E9B66B] mt-1">{t.homepage.headlineLine2}</span>
          </h1>

          {/* Subtitle */}
          <p className="text-sm sm:text-base text-slate-200 max-w-2xl leading-relaxed">
            {t.homepage.heroSub}
          </p>

          {/* Integrated Marketplace Search Bar */}
          <form
            onSubmit={handleExplore}
            className="bg-white rounded-xl p-1.5 shadow-xl border border-white/20 flex flex-col md:flex-row items-stretch md:items-center gap-1.5 text-[#23343B]"
          >
            {/* Service or Skill Input */}
            <div className="relative flex-1 min-w-0">
              <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3 pointer-events-none" />
              <label className="sr-only" htmlFor="hero-service-input">
                {t.homepage.serviceInputPlaceholder}
              </label>
              <input
                id="hero-service-input"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t.homepage.serviceInputPlaceholder}
                className="w-full h-11 rounded-lg bg-transparent ps-9 pe-3 text-sm text-[#23343B] placeholder:text-slate-400 focus:outline-none focus:bg-[#FAF7F0]"
              />
            </div>

            <span className="hidden md:block w-px h-7 bg-slate-200 shrink-0" aria-hidden="true" />

            {/* Country Selector (54 Countries) */}
            <div className="relative md:w-44 shrink-0">
              <Globe className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3 pointer-events-none" />
              <label className="sr-only" htmlFor="hero-country-select">
                {t.homepage.countrySelectLabel}
              </label>
              <select
                id="hero-country-select"
                value={heroCountryIso}
                onChange={(e) => handleCountryChange(e.target.value)}
                className="w-full h-11 rounded-lg bg-transparent ps-9 pe-3 text-sm font-medium text-[#23343B] focus:outline-none focus:bg-[#FAF7F0]"
              >
                <option value="ALL">{t.homepage.allAfricaOption}</option>
                {countries.map((c) => (
                  <option key={c.iso2} value={c.iso2}>
                    {getLocalizedField(lang, c, 'name')} ({c.iso2})
                  </option>
                ))}
              </select>
            </div>

            <span className="hidden md:block w-px h-7 bg-slate-200 shrink-0" aria-hidden="true" />

            {/* City Selector */}
            <div className="relative md:w-40 shrink-0">
              <MapPin className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3 pointer-events-none" />
              <label className="sr-only" htmlFor="hero-city-select">
                {t.homepage.citySelectLabel}
              </label>
              {cityOptions.length > 0 ? (
                <select
                  id="hero-city-select"
                  value={heroCity}
                  onChange={(e) => setHeroCity(e.target.value)}
                  className="w-full h-11 rounded-lg bg-transparent ps-9 pe-3 text-sm font-medium text-[#23343B] focus:outline-none focus:bg-[#FAF7F0]"
                >
                  <option value="">{t.homepage.allCitiesOption}</option>
                  {cityOptions.map((ct) => (
                    <option key={ct.id} value={ct.name}>
                      {ct.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id="hero-city-select"
                  type="text"
                  value={heroCity}
                  onChange={(e) => setHeroCity(e.target.value)}
                  placeholder={t.homepage.citySelectLabel}
                  className="w-full h-11 rounded-lg bg-transparent ps-9 pe-3 text-sm text-[#23343B] placeholder:text-slate-400 focus:outline-none focus:bg-[#FAF7F0]"
                />
              )}
            </div>

            {/* Submit Explore CTA */}
            <button
              type="submit"
              className="h-11 px-5 rounded-lg bg-[#087F70] hover:bg-[#16A68A] text-white text-sm font-bold inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Search className="w-4 h-4" />
              <span>{t.homepage.exploreCta}</span>
            </button>
          </form>

          {/* Optional AI Match result / trigger */}
          {query.trim().length >= 2 && (
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <button
                type="button"
                onClick={handleAiQuickMatch}
                disabled={aiLoading}
                className="inline-flex items-center gap-1.5 text-[#E9B66B] hover:underline font-semibold"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{aiLoading ? t.common.loading : t.hero.aiMatchCta}</span>
              </button>
              {aiError && <span className="text-rose-300">{aiError}</span>}
              {aiResult && (
                <button
                  type="button"
                  onClick={() =>
                    navigate(
                      `/professionals?category=${encodeURIComponent(
                        aiResult.recommendedCategorySlug || 'all'
                      )}&q=${encodeURIComponent(query)}`
                    )
                  }
                  className="text-slate-200 underline hover:text-white text-start"
                >
                  {aiResult.summary} →
                </button>
              )}
            </div>
          )}

          {/* Dual Primary CTAs */}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              onClick={() => navigate('/professionals')}
              className="min-h-[44px] px-5 py-2.5 rounded-xl bg-[#E9B66B] hover:bg-[#f0c582] text-[#102D3A] text-sm font-bold inline-flex items-center gap-2 transition-colors shadow-sm"
            >
              <Users className="w-4 h-4" />
              <span>{t.homepage.ctaFindPro}</span>
            </button>
            <button
              type="button"
              onClick={() => navigate('/pro-space')}
              className="min-h-[44px] px-5 py-2.5 rounded-xl border border-[#E9B66B]/60 bg-[#102D3A]/60 hover:bg-white/10 text-white text-sm font-semibold inline-flex items-center gap-2 transition-colors"
            >
              <Briefcase className="w-4 h-4 text-[#E9B66B]" />
              <span>{t.homepage.ctaOfferServices}</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
