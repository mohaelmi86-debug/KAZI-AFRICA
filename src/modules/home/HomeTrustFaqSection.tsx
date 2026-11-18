import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Headphones,
  Lock,
  Scale,
  Search,
  ShieldCheck,
  Star,
  TrendingUp,
  UserPlus,
} from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { useAuth } from '../auth/AuthContext';
import { getLocalizedField } from '../../i18n/translations';
import type { FaqItem, HomeTestimonial } from '../../types/kazi';

interface HomeTrustFaqSectionProps {
  testimonials: HomeTestimonial[];
  faqItems: FaqItem[];
}

export const HomeTrustFaqSection: React.FC<HomeTrustFaqSectionProps> = ({
  testimonials,
  faqItems,
}) => {
  const { t, lang, countries } = useApp();
  const { profile, signIn } = useAuth();
  const navigate = useNavigate();

  const [reviewIdx, setReviewIdx] = useState(0);
  const [openFaqId, setOpenFaqId] = useState<string | null>(faqItems[0]?.id || null);

  const activeTestimonial = testimonials[reviewIdx] || null;
  const countryNameMap = new Map(countries.map((c) => [c.iso2, getLocalizedField(lang, c, 'name')]));

  const trustItems = [
    { icon: ShieldCheck, title: t.homepage.trustItem1Title, desc: t.homepage.trustItem1Desc },
    { icon: Lock, title: t.homepage.trustItem2Title, desc: t.homepage.trustItem2Desc },
    { icon: Star, title: t.homepage.trustItem3Title, desc: t.homepage.trustItem3Desc },
    { icon: Headphones, title: t.homepage.trustItem4Title, desc: t.homepage.trustItem4Desc },
    { icon: Scale, title: t.homepage.trustItem5Title, desc: t.homepage.trustItem5Desc },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 space-y-6 py-4 pb-12">
      {/* TRUST & SECURITY STRIP */}
      <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6">
        <div className="flex flex-col xl:flex-row xl:items-center gap-6">
          <h2 className="font-display text-lg font-bold text-[#102D3A] xl:w-52 shrink-0">
            {t.homepage.trustSectionTitle}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4 flex-1">
            {trustItems.map((item, idx) => {
              const Icon = item.icon;
              return (
                <div key={idx} className="flex items-start gap-2.5">
                  <span className="w-9 h-9 rounded-full border border-[#E9B66B]/60 bg-[#FAF7F0] text-[#9A6314] flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4" />
                  </span>
                  <div className="space-y-0.5">
                    <h3 className="text-xs font-bold text-[#102D3A]">{item.title}</h3>
                    <p className="text-[11px] text-slate-600 leading-snug">{item.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* TESTIMONIALS + FAQ + CONVERSION BANNER */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* 1. Real Verified Testimonials */}
        <div className="lg:col-span-4 bg-white rounded-2xl border border-slate-200 p-5 flex flex-col justify-between gap-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-base font-bold text-[#102D3A]">
              {t.homepage.testimonialsTitle}
            </h2>
            {testimonials.length > 1 && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setReviewIdx((i) => (i - 1 + testimonials.length) % testimonials.length)}
                  aria-label="Previous review"
                  className="w-7 h-7 rounded-full border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-[#FAF7F0]"
                >
                  <ChevronLeft className="w-4 h-4 rtl:rotate-180" />
                </button>
                <button
                  type="button"
                  onClick={() => setReviewIdx((i) => (i + 1) % testimonials.length)}
                  aria-label="Next review"
                  className="w-7 h-7 rounded-full border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-[#FAF7F0]"
                >
                  <ChevronRight className="w-4 h-4 rtl:rotate-180" />
                </button>
              </div>
            )}
          </div>

          {activeTestimonial ? (
            <div className="space-y-3">
              <div className="flex items-center gap-1 text-[#E9B66B]">
                {Array.from({ length: activeTestimonial.rating }).map((_, idx) => (
                  <Star key={idx} className="w-3.5 h-3.5 fill-[#E9B66B]" />
                ))}
                <span className="ms-2 text-[10px] font-semibold text-[#087F70]">
                  {t.homepage.testimonialsVerifiedTag}
                </span>
              </div>
              <blockquote className="text-xs sm:text-sm text-[#23343B] italic leading-relaxed">
                « {activeTestimonial.comment} »
              </blockquote>
              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                <div>
                  <div className="font-bold text-[#102D3A]">{activeTestimonial.authorDisplayName}</div>
                  <div className="text-[11px] text-slate-500">
                    {activeTestimonial.city},{' '}
                    {countryNameMap.get(activeTestimonial.countryIso2) || activeTestimonial.countryIso2}
                  </div>
                </div>
                {activeTestimonial.professionalName && (
                  <span className="text-[11px] font-medium text-[#087F70]">
                    → {activeTestimonial.professionalName}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-xl bg-[#FAF7F0] p-4 space-y-1 text-center">
              <div className="text-xs font-bold text-[#102D3A]">{t.homepage.testimonialsEmptyTitle}</div>
              <p className="text-[11px] text-slate-600">{t.homepage.testimonialsEmptyDesc}</p>
            </div>
          )}
        </div>

        {/* 2. Administrable FAQ Accordion */}
        <div className="lg:col-span-4 bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-bold text-[#102D3A]">
              {t.homepage.faqTitle}
            </h2>
            <button
              type="button"
              onClick={() => navigate('/help')}
              className="text-xs font-semibold text-[#087F70] hover:underline"
            >
              {t.footer.linkFaq} →
            </button>
          </div>

          {faqItems.length === 0 ? (
            <p className="text-xs text-slate-500">{t.homepage.faqEmpty}</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {faqItems.slice(0, 4).map((item) => {
                const isOpen = openFaqId === item.id;
                return (
                  <div key={item.id} className="py-2">
                    <button
                      type="button"
                      onClick={() => setOpenFaqId(isOpen ? null : item.id)}
                      aria-expanded={isOpen}
                      className="w-full flex items-center justify-between gap-2 text-start py-1 text-xs font-semibold text-[#102D3A] hover:text-[#087F70]"
                    >
                      <span>{getLocalizedField(lang, item, 'question')}</span>
                      <ChevronDown
                        className={`w-4 h-4 shrink-0 transition-transform ${
                          isOpen ? 'rotate-180 text-[#087F70]' : 'text-slate-400'
                        }`}
                      />
                    </button>
                    {isOpen && (
                      <p className="pt-1.5 pb-1 text-[11px] text-slate-600 leading-relaxed">
                        {getLocalizedField(lang, item, 'answer')}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 3. Final Warm Savanna Conversion Banner */}
        <div className="lg:col-span-4 rounded-2xl overflow-hidden relative bg-gradient-to-br from-[#2B1F16] via-[#7A4B24] to-[#D4943E] text-white p-6 flex flex-col justify-between gap-5 shadow-md">
          <div className="space-y-1.5">
            <h2 className="font-display text-lg sm:text-xl font-extrabold leading-snug [text-wrap:balance]">
              <span className="block">{t.homepage.ctaBannerTitle1}</span>
              <span className="block text-[#FBE0B4]">{t.homepage.ctaBannerTitle2}</span>
            </h2>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => (profile ? navigate('/bookings') : signIn())}
              className="min-h-[40px] px-3.5 py-2 rounded-lg bg-[#E9B66B] hover:bg-[#f0c582] text-[#102D3A] text-xs font-bold inline-flex items-center gap-1.5 transition-colors"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>{t.homepage.ctaBannerJoin}</span>
            </button>
            <button
              type="button"
              onClick={() => navigate('/pro-space')}
              className="min-h-[40px] px-3.5 py-2 rounded-lg bg-white hover:bg-[#FAF7F0] text-[#102D3A] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
            >
              <TrendingUp className="w-3.5 h-3.5 text-[#087F70]" />
              <span>{t.homepage.ctaBannerGrow}</span>
            </button>
            <button
              type="button"
              onClick={() => navigate('/professionals')}
              className="min-h-[40px] px-3.5 py-2 rounded-lg bg-[#102D3A]/85 hover:bg-[#102D3A] border border-white/25 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
            >
              <Search className="w-3.5 h-3.5 text-[#E9B66B]" />
              <span>{t.homepage.ctaBannerFind}</span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
