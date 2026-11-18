import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Globe, MapPin, Search, ShieldCheck } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { getLocalizedField } from '../../i18n/translations';
import { AfricaInteractiveMap } from '../../components/AfricaInteractiveMap';
import { StatusLabel } from '../../components/DesignSystem';

export const CountriesExplorerModule: React.FC = () => {
  const { t, lang, countries, selectedCountryIso2, setSelectedCountryIso2 } = useApp();
  const navigate = useNavigate();

  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [regionFilter, setRegionFilter] = useState<string>('ALL');
  const [searchQ, setSearchQ] = useState<string>('');

  const regions = useMemo(() => {
    const set = new Set<string>();
    countries.forEach((c) => {
      if (c.region) set.add(c.region);
    });
    return ['ALL', ...Array.from(set).sort()];
  }, [countries]);

  const counts = useMemo(
    () => ({
      ACTIVE: countries.filter((c) => c.status === 'ACTIVE').length,
      TESTING: countries.filter((c) => c.status === 'TESTING').length,
      CONFIGURING: countries.filter((c) => c.status === 'CONFIGURING').length,
      PLANNED: countries.filter((c) => c.status === 'PLANNED').length,
    }),
    [countries]
  );

  const filtered = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    return countries.filter((c) => {
      if (statusFilter !== 'ALL' && c.status !== statusFilter) return false;
      if (regionFilter !== 'ALL' && c.region !== regionFilter) return false;
      if (q) {
        const hay = [c.nameFr, c.nameEn, c.namePt || '', c.nameAr, c.iso2, c.capital, c.region]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [countries, statusFilter, regionFilter, searchQ]);

  const inspectedCountry = countries.find((c) => c.iso2 === selectedCountryIso2) || countries[0];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 pb-20 space-y-6">
      {/* Header & Honest 54-Country Notice */}
      <section className="rounded-2xl bg-[#102D3A] text-white p-6 sm:p-8 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#E9B66B]">
              <Globe className="w-4 h-4" />
              <span>KAZI AFRICA · 54</span>
            </div>
            <h1 className="font-display text-2xl sm:text-3xl font-extrabold">{t.countriesPage.title}</h1>
            <p className="text-sm text-slate-200 leading-relaxed">{t.countriesPage.subtitle}</p>
          </div>

          {/* Real Rollout Counters */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0 tabular-nums">
            <div className="rounded-xl bg-white/10 border border-white/15 px-4 py-3 text-center">
              <div className="font-display text-xl font-extrabold text-[#16A68A]">{counts.ACTIVE}</div>
              <div className="text-[11px] text-slate-200">{t.countriesPage.statsActive}</div>
            </div>
            <div className="rounded-xl bg-white/10 border border-white/15 px-4 py-3 text-center">
              <div className="font-display text-xl font-extrabold text-[#E9B66B]">{counts.TESTING}</div>
              <div className="text-[11px] text-slate-200">{t.countriesPage.statsTesting}</div>
            </div>
            <div className="rounded-xl bg-white/10 border border-white/15 px-4 py-3 text-center">
              <div className="font-display text-xl font-extrabold text-sky-300">{counts.CONFIGURING}</div>
              <div className="text-[11px] text-slate-200">{t.countriesPage.statsConfiguring}</div>
            </div>
            <div className="rounded-xl bg-white/10 border border-white/15 px-4 py-3 text-center">
              <div className="font-display text-xl font-extrabold text-slate-200">{counts.PLANNED}</div>
              <div className="text-[11px] text-slate-300">{t.countriesPage.statsPlanned}</div>
            </div>
          </div>
        </div>

        <div className="rounded-xl bg-white/10 border border-[#E9B66B]/40 px-4 py-3 text-xs text-[#FBE0B4] flex items-start gap-2.5">
          <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-[#E9B66B]" />
          <span>{t.countriesPage.honestRolloutNotice}</span>
        </div>
      </section>

      {/* Interactive Continental Map + Inspected Country Card */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7">
          <AfricaInteractiveMap
            countries={countries}
            selectedIso2={selectedCountryIso2}
            onSelectCountry={(iso) => setSelectedCountryIso2(iso)}
            lang={lang}
          />
        </div>

        {inspectedCountry && (
          <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 p-6 space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-mono text-slate-500">
                  {inspectedCountry.iso2} · {inspectedCountry.iso3} · {inspectedCountry.region}
                </div>
                <h2 className="font-display text-xl font-bold text-[#102D3A] mt-0.5">
                  {getLocalizedField(lang, inspectedCountry, 'name')}
                </h2>
              </div>
              <StatusLabel status={inspectedCountry.status} />
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs bg-[#FAF7F0] rounded-xl p-4 border border-slate-100 tabular-nums">
              <div>
                <div className="text-slate-500">{inspectedCountry.capital}</div>
                <div className="font-semibold text-[#102D3A]">{inspectedCountry.timezone}</div>
              </div>
              <div>
                <div className="text-slate-500">{t.hero.currencyLabel}</div>
                <div className="font-semibold text-[#102D3A]">
                  {inspectedCountry.defaultCurrency} ({inspectedCountry.callingCode})
                </div>
              </div>
              <div>
                <div className="text-slate-500">{t.hero.commissionLabel}</div>
                <div className="font-semibold text-[#102D3A]">{inspectedCountry.commissionRatePct}%</div>
              </div>
              <div>
                <div className="text-slate-500">{t.hero.taxLabel}</div>
                <div className="font-semibold text-[#102D3A]">{inspectedCountry.taxRatePct}%</div>
              </div>
            </div>

            {inspectedCountry.cities?.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-bold text-[#102D3A]">{t.countriesPage.majorCities}</div>
                <div className="flex flex-wrap gap-2">
                  {inspectedCountry.cities.map((city) => (
                    <span
                      key={city.id}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#FAF7F0] border border-slate-200 text-xs text-[#23343B]"
                    >
                      <MapPin className="w-3 h-3 text-[#087F70]" />
                      {city.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <p className="text-xs text-slate-600 leading-relaxed">{inspectedCountry.regulatoryNotes}</p>

            {inspectedCountry.status === 'ACTIVE' || inspectedCountry.status === 'TESTING' ? (
              <button
                type="button"
                onClick={() => navigate(`/professionals?country=${inspectedCountry.iso2}`)}
                className="w-full min-h-[42px] rounded-xl bg-[#087F70] hover:bg-[#16A68A] text-white text-xs font-bold inline-flex items-center justify-center gap-2 transition-colors"
              >
                <span>{t.countriesPage.activeAction}</span>
                <ArrowRight className="w-4 h-4 rtl:rotate-180" />
              </button>
            ) : (
              <div className="rounded-xl bg-[#FAF7F0] border border-slate-200 p-3 text-xs text-slate-600 space-y-2">
                <p>{t.countriesPage.waitlistNotice}</p>
                <button
                  type="button"
                  onClick={() =>
                    navigate(
                      `/contact?subject=${encodeURIComponent(
                        `Partnership / Launch inquiry (${inspectedCountry.iso2})`
                      )}`
                    )
                  }
                  className="text-xs font-bold text-[#087F70] hover:underline"
                >
                  {t.footer.linkContact} →
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Filterable Grid of all 54 Sovereign African States */}
      <section className="space-y-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
            <input
              type="text"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder={t.countriesPage.searchPlaceholder}
              className="w-full h-10 rounded-lg border border-slate-300 bg-[#FAF7F0] ps-9 pe-3 text-xs text-[#23343B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#087F70]"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label={t.countriesPage.filterStatus}
            className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-[#23343B]"
          >
            <option value="ALL">{t.countriesPage.filterStatus}: {t.common.all}</option>
            <option value="ACTIVE">{t.statuses.ACTIVE}</option>
            <option value="TESTING">{t.statuses.TESTING}</option>
            <option value="CONFIGURING">{t.statuses.CONFIGURING}</option>
            <option value="PLANNED">{t.statuses.PLANNED}</option>
            <option value="SUSPENDED">{t.statuses.SUSPENDED}</option>
          </select>

          <select
            value={regionFilter}
            onChange={(e) => setRegionFilter(e.target.value)}
            aria-label={t.countriesPage.filterRegion}
            className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-[#23343B]"
          >
            {regions.map((rg) => (
              <option key={rg} value={rg}>
                {rg === 'ALL' ? `${t.countriesPage.filterRegion}: ${t.common.all}` : rg}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map((c) => {
            const isSelected = c.iso2 === selectedCountryIso2;
            return (
              <button
                key={c.iso2}
                type="button"
                onClick={() => setSelectedCountryIso2(c.iso2)}
                className={`text-start rounded-xl border p-4 bg-white transition-all space-y-2 ${
                  isSelected
                    ? 'border-[#087F70] ring-2 ring-[#087F70]/20'
                    : 'border-slate-200 hover:border-[#102D3A]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-sm font-bold text-[#102D3A] truncate">
                    {getLocalizedField(lang, c, 'name')}
                  </span>
                  <span className="text-[11px] font-mono text-slate-400 shrink-0">{c.iso2}</span>
                </div>
                <div className="text-xs text-slate-500">
                  {c.capital} · {c.defaultCurrency}
                </div>
                <div className="flex items-center justify-between pt-1">
                  <StatusLabel status={c.status} />
                  {c.status === 'ACTIVE' && (
                    <CheckCircle2 className="w-4 h-4 text-[#087F70]" />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
};
