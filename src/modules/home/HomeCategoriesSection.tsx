import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Briefcase,
  Building2,
  CalendarCheck,
  Car,
  GraduationCap,
  Hammer,
  HeartPulse,
  Home,
  Leaf,
  Monitor,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Sun,
  Truck,
  Wind,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { getLocalizedField } from '../../i18n/translations';
import type { HomeCategoryItem } from '../../types/kazi';

const ICON_MAP: Record<string, React.FC<{ className?: string }>> = {
  Home,
  Hammer,
  Sparkles,
  Truck,
  Monitor,
  GraduationCap,
  HeartPulse,
  CalendarCheck,
  Building2,
  ShoppingBag,
  Leaf,
  Briefcase,
  Zap,
  Wrench,
  Smartphone,
  Wind,
  Car,
  Sun,
};

const ICON_ACCENTS = [
  'text-[#087F70] bg-[#087F70]/10',
  'text-[#D97706] bg-amber-500/10',
  'text-[#0D9488] bg-teal-500/10',
  'text-[#087F70] bg-[#087F70]/10',
  'text-[#0284C7] bg-sky-500/10',
  'text-[#102D3A] bg-[#102D3A]/10',
  'text-rose-600 bg-rose-500/10',
  'text-[#087F70] bg-[#087F70]/10',
  'text-[#102D3A] bg-[#102D3A]/10',
  'text-[#D97706] bg-amber-500/10',
  'text-[#16A68A] bg-emerald-500/10',
  'text-[#087F70] bg-[#087F70]/10',
];

const FALLBACK_HOME_CATEGORIES: HomeCategoryItem[] = [
  { slug: 'home_building', iconName: 'Home', nameFr: 'Maison et bâtiment', nameEn: 'Home & Building', namePt: 'Casa e Construção', nameAr: 'المنزل والبناء', mappedSlugs: ['electricity', 'plumbing', 'hvac', 'home_help', 'solar'] },
  { slug: 'crafts', iconName: 'Hammer', nameFr: 'Artisanat', nameEn: 'Crafts & Trades', namePt: 'Artesanato e Ofícios', nameAr: 'الحرف اليدوية', mappedSlugs: ['plumbing', 'electricity', 'mechanics'] },
  { slug: 'beauty_wellness', iconName: 'Sparkles', nameFr: 'Beauté et bien-être', nameEn: 'Beauty & Wellness', namePt: 'Beleza e Bem-estar', nameAr: 'الجمال والعافية', mappedSlugs: ['home_help'] },
  { slug: 'transport_delivery', iconName: 'Truck', nameFr: 'Transport et livraison', nameEn: 'Transport & Delivery', namePt: 'Transporte e Entregas', nameAr: 'النقل والتوصيل', mappedSlugs: ['mechanics'] },
  { slug: 'it_tech', iconName: 'Monitor', nameFr: 'Informatique et technologie', nameEn: 'IT & Technology', namePt: 'Informática e Tecnologia', nameAr: 'تكنولوجيا المعلومات', mappedSlugs: ['phone_repair'] },
  { slug: 'education_training', iconName: 'GraduationCap', nameFr: 'Éducation et formation', nameEn: 'Education & Training', namePt: 'Educação e Formação', nameAr: 'التعليم والتدريب', mappedSlugs: ['electricity', 'solar'] },
  { slug: 'health_assistance', iconName: 'HeartPulse', nameFr: 'Santé et assistance', nameEn: 'Health & Assistance', namePt: 'Saúde e Assistência', nameAr: 'الصحة والمساعدة', mappedSlugs: ['home_help'] },
  { slug: 'events', iconName: 'CalendarCheck', nameFr: 'Événementiel', nameEn: 'Events & Catering', namePt: 'Eventos', nameAr: 'تنظيم الفعاليات', mappedSlugs: ['home_help'] },
  { slug: 'business_services', iconName: 'Building2', nameFr: 'Services aux entreprises', nameEn: 'Business Services', namePt: 'Serviços Empresariais', nameAr: 'خدمات الشركات', mappedSlugs: ['electricity', 'hvac', 'solar'] },
  { slug: 'commerce', iconName: 'ShoppingBag', nameFr: 'Commerce', nameEn: 'Commerce & Retail', namePt: 'Comércio', nameAr: 'التجارة', mappedSlugs: ['phone_repair'] },
  { slug: 'agriculture', iconName: 'Leaf', nameFr: 'Agriculture', nameEn: 'Agriculture & Agri-Tech', namePt: 'Agricultura', nameAr: 'الزراعة', mappedSlugs: ['solar', 'mechanics'] },
  { slug: 'professional_services', iconName: 'Briefcase', nameFr: 'Services professionnels', nameEn: 'Professional Services', namePt: 'Serviços Profissionais', nameAr: 'الخدمات المهنية', mappedSlugs: ['electricity', 'plumbing', 'hvac', 'solar'] },
];

export const HomeCategoriesSection: React.FC<{ homeCategories?: HomeCategoryItem[] }> = ({
  homeCategories,
}) => {
  const { t, lang, categories } = useApp();
  const navigate = useNavigate();
  const [modalOpen, setModalOpen] = useState(false);

  const items = homeCategories && homeCategories.length > 0 ? homeCategories : FALLBACK_HOME_CATEGORIES;

  const openCategory = (item: HomeCategoryItem) => {
    const querySlugs = item.mappedSlugs?.length ? item.mappedSlugs.join(',') : item.slug;
    navigate(`/professionals?category=${encodeURIComponent(querySlugs)}&domain=${encodeURIComponent(item.slug)}`);
  };

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 pt-8 pb-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="font-display text-lg sm:text-xl font-bold text-[#102D3A]">
          {t.homepage.categoriesTitle}
        </h2>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-[#087F70] hover:text-[#102D3A] transition-colors"
        >
          <span>{t.homepage.viewAllCategories}</span>
          <ArrowRight className="w-4 h-4 rtl:rotate-180" />
        </button>
      </div>

      {/* 12 Service Domain Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-12 gap-2.5">
        {items.slice(0, 12).map((cat, idx) => {
          const Icon = ICON_MAP[cat.iconName] || Briefcase;
          const accent = ICON_ACCENTS[idx % ICON_ACCENTS.length];
          const label = getLocalizedField(lang, cat, 'name');
          return (
            <button
              key={cat.slug}
              type="button"
              onClick={() => openCategory(cat)}
              className="group bg-white rounded-xl border border-slate-200/90 hover:border-[#087F70] hover:shadow-md px-2.5 py-3.5 flex flex-col items-center justify-start gap-2 text-center transition-all min-h-[104px] cursor-pointer"
            >
              <span
                className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-transform group-hover:scale-105 ${accent}`}
              >
                <Icon className="w-4 h-4" />
              </span>
              <span className="text-[11px] font-semibold text-[#23343B] leading-tight [text-wrap:balance]">
                {label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Expandable Modal showing all 12 domains + concrete sub-trades from /api/categories */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="all-categories-modal-title"
        >
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-3xl w-full max-h-[85vh] overflow-y-auto p-6 space-y-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 id="all-categories-modal-title" className="font-display text-lg font-bold text-[#102D3A]">
                  {t.homepage.allCategoriesModalTitle}
                </h3>
                <p className="text-xs text-slate-600 mt-1">{t.homepage.allCategoriesModalSub}</p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label={t.common.close}
                className="w-9 h-9 rounded-lg border border-slate-200 flex items-center justify-center text-slate-500 hover:text-slate-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {items.map((cat, idx) => {
                const Icon = ICON_MAP[cat.iconName] || Briefcase;
                const accent = ICON_ACCENTS[idx % ICON_ACCENTS.length];
                return (
                  <button
                    key={cat.slug}
                    type="button"
                    onClick={() => {
                      setModalOpen(false);
                      openCategory(cat);
                    }}
                    className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 hover:border-[#087F70] hover:bg-[#FAF7F0] text-start transition-colors"
                  >
                    <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${accent}`}>
                      <Icon className="w-4 h-4" />
                    </span>
                    <span className="text-xs font-semibold text-[#102D3A]">
                      {getLocalizedField(lang, cat, 'name')}
                    </span>
                  </button>
                );
              })}
            </div>

            {categories.length > 0 && (
              <div className="border-t border-slate-200 pt-4 space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  {t.homepage.subTradesTitle}
                </h4>
                <div className="flex flex-wrap gap-2">
                  {categories.map((sub) => {
                    const SubIcon = ICON_MAP[sub.iconName] || Wrench;
                    return (
                      <button
                        key={sub.id}
                        type="button"
                        onClick={() => {
                          setModalOpen(false);
                          navigate(`/professionals?category=${encodeURIComponent(sub.slug)}`);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-[#FAF7F0] hover:border-[#087F70] text-xs font-medium text-[#23343B]"
                      >
                        <SubIcon className="w-3.5 h-3.5 text-[#087F70]" />
                        <span>{getLocalizedField(lang, sub, 'name')}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
