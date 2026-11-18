import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Briefcase, CheckCircle2, GraduationCap } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { AfricaInteractiveMap } from '../../components/AfricaInteractiveMap';
import type { HomeHighlightsResponse } from '../../types/kazi';

interface HomePillarsSectionProps {
  countryStats?: HomeHighlightsResponse['countryStats'];
}

export const HomePillarsSection: React.FC<HomePillarsSectionProps> = ({ countryStats }) => {
  const { t, lang, countries, selectedCountryIso2, setSelectedCountryIso2 } = useApp();
  const navigate = useNavigate();

  const activeCount = countryStats?.ACTIVE ?? countries.filter((c) => c.status === 'ACTIVE').length;
  const prepCount =
    (countryStats?.TOTAL ?? countries.length) - activeCount;

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* 1. KAZI Skills Spotlight */}
        <article className="relative rounded-2xl bg-[#102D3A] text-white overflow-hidden border border-[#102D3A] min-h-[210px] flex items-center">
          <div className="grid grid-cols-12 w-full h-full items-stretch">
            <div className="col-span-5 relative min-h-[190px]">
              <img
                src="/src/assets/images/course_solar_installation_1794936769118.jpg"
                alt="KAZI Skills"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-transparent to-[#102D3A] rtl:bg-gradient-to-l" />
            </div>
            <div className="col-span-7 p-5 flex flex-col justify-between gap-3">
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2">
                  <GraduationCap className="w-5 h-5 text-[#E9B66B]" />
                  <h3 className="font-display text-lg font-bold text-white">
                    {t.homepage.skillsSpotlightTitle}
                  </h3>
                </div>
                <p className="text-xs text-slate-200 leading-relaxed">
                  {t.homepage.skillsSpotlightDesc}
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/skills')}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-[#E9B66B] hover:bg-[#f0c582] text-[#102D3A] text-xs font-bold transition-colors w-fit"
              >
                <span>{t.homepage.skillsSpotlightCta}</span>
                <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" />
              </button>
            </div>
          </div>
        </article>

        {/* 2. Opportunities Spotlight */}
        <article className="relative rounded-2xl bg-[#F3EFE6] text-[#102D3A] overflow-hidden border border-slate-200 min-h-[210px] flex items-center">
          <div className="grid grid-cols-12 w-full h-full items-stretch">
            <div className="col-span-7 p-5 flex flex-col justify-between gap-3">
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2">
                  <Briefcase className="w-5 h-5 text-[#C88435]" />
                  <h3 className="font-display text-lg font-bold text-[#102D3A]">
                    {t.homepage.opportunitiesSpotlightTitle}
                  </h3>
                </div>
                <p className="text-xs text-[#23343B] leading-relaxed">
                  {t.homepage.opportunitiesSpotlightDesc}
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/opportunities')}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-[#E9B66B] hover:bg-[#f0c582] text-[#102D3A] text-xs font-bold transition-colors w-fit"
              >
                <span>{t.homepage.opportunitiesSpotlightCta}</span>
                <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" />
              </button>
            </div>
            <div className="col-span-5 relative min-h-[190px]">
              <img
                src="/src/assets/images/pro_awa_traore_1794936768899.jpg"
                alt="Opportunités KAZI AFRICA"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-l from-transparent to-[#F3EFE6] rtl:bg-gradient-to-r" />
            </div>
          </div>
        </article>

        {/* 3. Connected Africa (54 Countries Interactive Map + Honest Rollout Status) */}
        <article className="rounded-2xl bg-[#EAF4F2] text-[#102D3A] border border-[#087F70]/20 p-5 flex items-center gap-4 min-h-[210px]">
          <div className="w-28 sm:w-32 shrink-0">
            <AfricaInteractiveMap
              countries={countries}
              selectedIso2={selectedCountryIso2}
              onSelectCountry={(iso) => setSelectedCountryIso2(iso)}
              lang={lang}
              variant="homepageCompact"
            />
          </div>
          <div className="flex-1 min-w-0 space-y-2.5">
            <h3 className="font-display text-base sm:text-lg font-bold text-[#102D3A]">
              {t.homepage.africaConnectedTitle}
            </h3>
            <p className="text-[11px] text-[#23343B] leading-relaxed">
              {t.homepage.africaConnectedDesc}
            </p>
            <ul className="grid grid-cols-1 gap-1 text-[11px] font-semibold text-[#102D3A]">
              <li className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-[#087F70] shrink-0" />
                <span>{t.homepage.africaPoint1} ({activeCount} {t.homepage.activeStatusSummary} · {prepCount} {t.homepage.pilotStatusSummary})</span>
              </li>
              <li className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-[#087F70] shrink-0" />
                <span>{t.homepage.africaPoint2} · {t.homepage.africaPoint3}</span>
              </li>
              <li className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-[#087F70] shrink-0" />
                <span>{t.homepage.africaPoint4}</span>
              </li>
            </ul>
            <button
              type="button"
              onClick={() => navigate('/countries')}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#087F70] hover:bg-[#16A68A] text-white text-xs font-bold transition-colors"
            >
              <span>{t.homepage.africaCta}</span>
              <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" />
            </button>
          </div>
        </article>
      </div>
    </section>
  );
};
