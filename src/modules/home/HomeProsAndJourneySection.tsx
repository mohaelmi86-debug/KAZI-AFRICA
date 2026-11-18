import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Award,
  Briefcase,
  Building2,
  CalendarCheck,
  CheckCircle2,
  CreditCard,
  MapPin,
  Search,
  ShieldCheck,
  Star,
  UserPlus,
  Users,
} from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { getLocalizedField } from '../../i18n/translations';
import { apiFetch } from '../../services/api';
import type { ProfessionalRecord } from '../../types/kazi';

export const HomeProsAndJourneySection: React.FC = () => {
  const { t, lang, countries } = useApp();
  const navigate = useNavigate();

  const [pros, setPros] = useState<ProfessionalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [journeyTab, setJourneyTab] = useState<'client' | 'pro' | 'enterprise'>('client');

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch<{ professionals: ProfessionalRecord[] }>(
          '/api/professionals?countryIso2=ALL'
        );
        if (!active) return;
        // Prioritize verified & reviewed professionals first, honest DB order
        const list = (res.professionals || []).slice(0, 4);
        setPros(list);
      } catch (err: any) {
        if (active) setError(err.message || 'Error loading professionals');
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, []);

  const countryNameByIso = new Map(
    countries.map((c) => [c.iso2, getLocalizedField(lang, c, 'name')])
  );

  const clientStepIcons = [Search, Users, CalendarCheck, CreditCard, Star];
  const proStepIcons = [UserPlus, Award, ShieldCheck, Briefcase, CheckCircle2, Star];
  const entStepIcons = [Building2, Briefcase, Users, CreditCard];

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 py-5">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN: Professionals to Discover */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg sm:text-xl font-bold text-[#102D3A]">
              {t.homepage.prosToDiscover}
            </h2>
            <button
              type="button"
              onClick={() => navigate('/professionals?country=ALL')}
              className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-[#087F70] hover:text-[#102D3A]"
            >
              <span>{t.homepage.viewMorePros}</span>
              <ArrowRight className="w-4 h-4 rtl:rotate-180" />
            </button>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {[1, 2, 3, 4].map((idx) => (
                <div
                  key={idx}
                  className="bg-white rounded-xl border border-slate-200 p-4 h-44 animate-pulse"
                />
              ))}
            </div>
          ) : error ? (
            <div className="bg-white rounded-xl border border-rose-200 p-6 text-xs text-rose-700">
              {error}
            </div>
          ) : pros.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-500">
              {t.search.noProsFound}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {pros.map((pro) => {
                const headline = getLocalizedField(lang, pro, 'headline');
                const bio = getLocalizedField(lang, pro, 'bio');
                const cName = countryNameByIso.get(pro.countryIso2) || pro.countryIso2;
                return (
                  <article
                    key={pro.id}
                    className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col justify-between gap-3.5 hover:border-[#087F70] transition-colors shadow-2xs"
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-start gap-3">
                        <img
                          src={pro.avatarUrl || '/src/assets/images/pro_koffi_laurent_1794936770045.jpg'}
                          alt={pro.fullName}
                          referrerPolicy="no-referrer"
                          className="w-14 h-14 rounded-xl object-cover shrink-0 border border-slate-200"
                        />
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="flex items-center justify-between gap-1.5">
                            <h3 className="font-display text-sm font-bold text-[#102D3A] truncate">
                              {pro.fullName}
                            </h3>
                            {pro.isVerified ? (
                              <span
                                title={t.search.verifiedBadge}
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#087F70] shrink-0"
                              >
                                <CheckCircle2 className="w-4 h-4 fill-[#087F70] text-white" />
                              </span>
                            ) : (
                              <span className="text-[10px] font-medium text-slate-400 shrink-0">
                                {t.homepage.unverifiedNote}
                              </span>
                            )}
                          </div>
                          <p className="text-xs font-medium text-slate-600 line-clamp-1">{headline}</p>
                          <p className="text-[11px] text-slate-500 inline-flex items-center gap-1 truncate">
                            <MapPin className="w-3 h-3 text-[#087F70] shrink-0" />
                            <span>
                              {pro.city}, {cName}
                            </span>
                          </p>
                        </div>
                      </div>

                      <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">{bio}</p>

                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs tabular-nums">
                        {pro.reviewsCount > 0 ? (
                          <span className="inline-flex items-center gap-1 font-bold text-[#23343B]">
                            <Star className="w-3.5 h-3.5 text-[#E9B66B] fill-[#E9B66B]" />
                            <span>{pro.ratingAvg}</span>
                            <span className="font-normal text-slate-500">
                              ({pro.reviewsCount} {t.search.reviewsCount})
                            </span>
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-500">{t.homepage.noReviewsYet}</span>
                        )}

                        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#087F70]">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              pro.availableToday ? 'bg-[#16A68A]' : 'bg-slate-300'
                            }`}
                          />
                          <span>
                            {pro.availableToday ? t.homepage.availableLabel : t.homepage.unavailableLabel}
                          </span>
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => navigate(`/professionals/${pro.id}`)}
                        className="min-h-[38px] px-3 py-1.5 rounded-lg border border-slate-300 text-[#23343B] hover:border-[#102D3A] hover:bg-[#FAF7F0] text-xs font-semibold transition-colors"
                      >
                        {t.homepage.viewProfile}
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate(`/bookings?proId=${pro.id}&mode=quote`)}
                        className="min-h-[38px] px-3 py-1.5 rounded-lg bg-[#087F70] hover:bg-[#16A68A] text-white text-xs font-semibold transition-colors"
                      >
                        {t.homepage.contactPro}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: How It Works (Interactive 3-Tab Journey) */}
        <div className="lg:col-span-5 space-y-4">
          <h2 className="font-display text-lg sm:text-xl font-bold text-[#102D3A]">
            {t.homepage.howItWorksTitle}
          </h2>

          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-5 shadow-2xs">
            {/* Segmented Tab Switcher */}
            <div
              className="grid grid-cols-3 gap-1.5 rounded-xl bg-[#FAF7F0] p-1 border border-slate-200"
              role="tablist"
              aria-label={t.homepage.howItWorksTitle}
            >
              {(
                [
                  { id: 'client', label: t.homepage.tabClient },
                  { id: 'pro', label: t.homepage.tabPro },
                  { id: 'enterprise', label: t.homepage.tabEnterprise },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={journeyTab === tab.id}
                  onClick={() => setJourneyTab(tab.id)}
                  className={`min-h-[40px] px-2 py-1.5 rounded-lg text-[11px] sm:text-xs font-semibold transition-colors leading-tight ${
                    journeyTab === tab.id
                      ? 'bg-[#087F70] text-white shadow-xs'
                      : 'text-[#23343B] hover:bg-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Steps Panel */}
            {journeyTab === 'client' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                  {[
                    t.homepage.clientSteps.step1,
                    t.homepage.clientSteps.step2,
                    t.homepage.clientSteps.step3,
                    t.homepage.clientSteps.step4,
                    t.homepage.clientSteps.step5,
                  ].map((label, idx) => {
                    const Icon = clientStepIcons[idx];
                    return (
                      <div
                        key={idx}
                        className="flex flex-col items-center text-center gap-2 p-2.5 rounded-xl bg-[#FAF7F0] border border-slate-100"
                      >
                        <span className="w-9 h-9 rounded-full bg-[#E9B66B]/20 text-[#9A6314] flex items-center justify-center">
                          <Icon className="w-4 h-4" />
                        </span>
                        <span className="text-[11px] font-semibold text-[#23343B] leading-snug">
                          {label}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/professionals')}
                  className="w-full min-h-[42px] rounded-xl bg-[#102D3A] hover:bg-[#184052] text-white text-xs font-bold inline-flex items-center justify-center gap-2 transition-colors"
                >
                  <span>{t.homepage.clientSteps.cta}</span>
                  <ArrowRight className="w-4 h-4 rtl:rotate-180" />
                </button>
              </div>
            )}

            {journeyTab === 'pro' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {[
                    t.homepage.proSteps.step1,
                    t.homepage.proSteps.step2,
                    t.homepage.proSteps.step3,
                    t.homepage.proSteps.step4,
                    t.homepage.proSteps.step5,
                    t.homepage.proSteps.step6,
                  ].map((label, idx) => {
                    const Icon = proStepIcons[idx];
                    return (
                      <div
                        key={idx}
                        className="flex items-start gap-2 p-2.5 rounded-xl bg-[#FAF7F0] border border-slate-100 text-start"
                      >
                        <span className="w-7 h-7 rounded-lg bg-[#087F70]/15 text-[#087F70] flex items-center justify-center shrink-0">
                          <Icon className="w-3.5 h-3.5" />
                        </span>
                        <span className="text-[11px] font-semibold text-[#23343B] leading-snug">
                          {label}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/pro-space')}
                  className="w-full min-h-[42px] rounded-xl bg-[#087F70] hover:bg-[#16A68A] text-white text-xs font-bold inline-flex items-center justify-center gap-2 transition-colors"
                >
                  <span>{t.homepage.proSteps.cta}</span>
                  <ArrowRight className="w-4 h-4 rtl:rotate-180" />
                </button>
              </div>
            )}

            {journeyTab === 'enterprise' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2.5">
                  {[
                    t.homepage.enterpriseSteps.step1,
                    t.homepage.enterpriseSteps.step2,
                    t.homepage.enterpriseSteps.step3,
                    t.homepage.enterpriseSteps.step4,
                  ].map((label, idx) => {
                    const Icon = entStepIcons[idx];
                    return (
                      <div
                        key={idx}
                        className="flex items-start gap-2.5 p-3 rounded-xl bg-[#FAF7F0] border border-slate-100 text-start"
                      >
                        <span className="w-8 h-8 rounded-lg bg-[#102D3A]/10 text-[#102D3A] flex items-center justify-center shrink-0">
                          <Icon className="w-4 h-4" />
                        </span>
                        <span className="text-xs font-semibold text-[#23343B] leading-snug">
                          {label}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/enterprise')}
                  className="w-full min-h-[42px] rounded-xl bg-[#E9B66B] hover:bg-[#f0c582] text-[#102D3A] text-xs font-bold inline-flex items-center justify-center gap-2 transition-colors"
                >
                  <span>{t.homepage.enterpriseSteps.cta}</span>
                  <ArrowRight className="w-4 h-4 rtl:rotate-180" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
