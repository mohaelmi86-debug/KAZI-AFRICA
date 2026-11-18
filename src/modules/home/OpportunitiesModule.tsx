import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Briefcase, Building2, Globe, MapPin, Search, Sparkles } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { apiFetch } from '../../services/api';
import { getLocalizedField } from '../../i18n/translations';
import { BrandEmptyState, BrandLoadingState } from '../../components/DesignSystem';
import type { OpportunityRecord } from '../../types/kazi';

export const OpportunitiesModule: React.FC = () => {
  const { t, lang, countries } = useApp();
  const navigate = useNavigate();

  const [opportunities, setOpportunities] = useState<OpportunityRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [countryFilter, setCountryFilter] = useState<string>('ALL');
  const [domainFilter, setDomainFilter] = useState<string>('ALL');
  const [searchQ, setSearchQ] = useState<string>('');

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams();
        if (countryFilter !== 'ALL') qs.set('countryIso2', countryFilter);
        if (typeFilter !== 'ALL') qs.set('type', typeFilter);
        if (domainFilter !== 'ALL') qs.set('domain', domainFilter);
        if (searchQ.trim()) qs.set('q', searchQ.trim());
        const res = await apiFetch<{ opportunities: OpportunityRecord[] }>(
          `/api/opportunities?${qs.toString()}`
        );
        if (active) setOpportunities(res.opportunities || []);
      } catch (err: any) {
        if (active) setError(err.message || 'Failed to load opportunities');
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [countryFilter, typeFilter, domainFilter, searchQ]);

  const countryNameMap = useMemo(
    () => new Map(countries.map((c) => [c.iso2, getLocalizedField(lang, c, 'name')])),
    [countries, lang]
  );

  const typeOptions = ['ALL', 'MISSION', 'JOB', 'PARTNERSHIP', 'COLLABORATION', 'ENTREPRENEURSHIP'] as const;

  const domainOptions = useMemo(() => {
    const set = new Set<string>();
    opportunities.forEach((o) => {
      if (o.domain) set.add(o.domain);
    });
    return ['ALL', ...Array.from(set)];
  }, [opportunities]);

  const resetFilters = () => {
    setTypeFilter('ALL');
    setCountryFilter('ALL');
    setDomainFilter('ALL');
    setSearchQ('');
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 pb-20 space-y-6">
      {/* Header Banner */}
      <section className="rounded-2xl bg-[#102D3A] text-white p-6 sm:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="space-y-2 max-w-2xl">
          <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#E9B66B]">
            <Briefcase className="w-4 h-4" />
            <span>KAZI AFRICA · {t.nav.opportunities}</span>
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold">{t.opportunities.title}</h1>
          <p className="text-sm text-slate-200 leading-relaxed">{t.opportunities.subtitle}</p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/pro-space')}
          className="min-h-[44px] px-5 py-2.5 rounded-xl bg-[#E9B66B] hover:bg-[#f0c582] text-[#102D3A] text-xs font-bold inline-flex items-center gap-2 shrink-0 transition-colors"
        >
          <span>{t.homepage.ctaOfferServices}</span>
          <ArrowRight className="w-4 h-4 rtl:rotate-180" />
        </button>
      </section>

      {/* Filters */}
      <section className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
            <input
              type="text"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder={t.opportunities.searchPlaceholder}
              className="w-full h-10 rounded-lg border border-slate-300 bg-[#FAF7F0] ps-9 pe-3 text-xs text-[#23343B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#087F70]"
            />
          </div>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            aria-label={t.opportunities.filterType}
            className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-[#23343B]"
          >
            {typeOptions.map((tp) => (
              <option key={tp} value={tp}>
                {t.opportunities.filterType}: {t.opportunities.types[tp]}
              </option>
            ))}
          </select>

          <select
            value={countryFilter}
            onChange={(e) => setCountryFilter(e.target.value)}
            aria-label={t.opportunities.filterCountry}
            className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-[#23343B]"
          >
            <option value="ALL">{t.opportunities.filterCountry}: {t.common.all}</option>
            {countries.map((c) => (
              <option key={c.iso2} value={c.iso2}>
                {getLocalizedField(lang, c, 'name')} ({c.iso2})
              </option>
            ))}
          </select>

          <select
            value={domainFilter}
            onChange={(e) => setDomainFilter(e.target.value)}
            aria-label={t.opportunities.filterDomain}
            className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-[#23343B]"
          >
            <option value="ALL">{t.opportunities.filterDomain}: {t.common.all}</option>
            {domainOptions
              .filter((d) => d !== 'ALL')
              .map((dom) => (
                <option key={dom} value={dom}>
                  {dom}
                </option>
              ))}
          </select>
        </div>
      </section>

      {/* Results */}
      {loading ? (
        <BrandLoadingState />
      ) : error ? (
        <div className="rounded-xl border border-rose-200 bg-white p-6 text-sm text-rose-700">{error}</div>
      ) : opportunities.length === 0 ? (
        <BrandEmptyState
          title={t.opportunities.noResults}
          action={
            <button
              type="button"
              onClick={resetFilters}
              className="px-4 py-2 rounded-lg bg-[#102D3A] text-white text-xs font-semibold"
            >
              {t.common.resetFilters}
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {opportunities.map((opp) => {
            const title = getLocalizedField(lang, opp, 'title');
            const summary = getLocalizedField(lang, opp, 'summary');
            const cName = countryNameMap.get(opp.countryIso2) || opp.countryIso2;
            const typeLabel =
              (t.opportunities.types as Record<string, string>)[opp.type] || opp.type;

            return (
              <article
                key={opp.id}
                className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col justify-between gap-4 hover:border-[#087F70] transition-colors"
              >
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    <span className="font-bold uppercase tracking-wider text-[#087F70]">
                      {typeLabel}
                    </span>
                    <span className="inline-flex items-center gap-1 font-semibold text-slate-600">
                      <Sparkles className="w-3.5 h-3.5 text-[#E9B66B]" />
                      <span>
                        {opp.isLiveMission
                          ? t.opportunities.liveMissionBadge
                          : t.opportunities.pilotProgramBadge}
                      </span>
                    </span>
                  </div>

                  <h2 className="font-display text-base font-bold text-[#102D3A] leading-snug">
                    {title}
                  </h2>

                  <p className="text-xs text-slate-600 leading-relaxed">{summary}</p>

                  <div className="space-y-1 text-xs text-slate-500 pt-1">
                    <div className="inline-flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5 text-[#087F70]" />
                      <span className="font-medium text-[#23343B]">{opp.organizationName}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-[#087F70]" />
                        {opp.city}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Globe className="w-3.5 h-3.5 text-slate-400" />
                        {cName} ({opp.countryIso2})
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    if (opp.targetPath === '/contact') {
                      navigate(`/contact?subject=${encodeURIComponent(title)}`);
                    } else {
                      navigate(opp.targetPath || '/pro-space');
                    }
                  }}
                  className="min-h-[40px] w-full rounded-xl bg-[#087F70] hover:bg-[#16A68A] text-white text-xs font-bold inline-flex items-center justify-center gap-2 transition-colors"
                >
                  <span>{t.opportunities.applyCta}</span>
                  <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" />
                </button>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
