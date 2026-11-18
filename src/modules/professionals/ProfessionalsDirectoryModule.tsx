import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  Heart,
  MapPin,
  ShieldCheck,
  Star,
} from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { apiFetch } from '../../services/api';
import { formatLocalCurrency, getLocalizedField } from '../../i18n/translations';
import { BrandEmptyState, BrandLoadingState } from '../../components/DesignSystem';
import { KaziBrand } from '../../components/KaziBrand';
import type { ProfessionalRecord } from '../../types/kazi';

export const ProfessionalsDirectoryModule: React.FC = () => {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t, lang, selectedCountryIso2, setSelectedCountryIso2, selectedCountry, categories } = useApp();

  const [pros, setPros] = useState<ProfessionalRecord[]>([]);
  const [selectedPro, setSelectedPro] = useState<ProfessionalRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'about' | 'services' | 'reviews'>('about');

  const [categoryFilter, setCategoryFilter] = useState(searchParams.get('category') || 'all');
  const [searchQ, setSearchQ] = useState(searchParams.get('q') || '');
  const [cityFilter, setCityFilter] = useState(searchParams.get('city') || '');
  const [verifiedOnly, setVerifiedOnly] = useState(searchParams.get('verifiedOnly') === 'true');
  const [availableToday, setAvailableToday] = useState(false);
  const [allCountriesScope, setAllCountriesScope] = useState(searchParams.get('country') === 'ALL');
  const [favorites, setFavorites] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const paramCountry = searchParams.get('country');
    if (paramCountry === 'ALL') {
      setAllCountriesScope(true);
    } else if (paramCountry && paramCountry.length === 2) {
      setAllCountriesScope(false);
      setSelectedCountryIso2(paramCountry.toUpperCase());
    } else {
      setAllCountriesScope(false);
    }
    setCategoryFilter(searchParams.get('category') || 'all');
    setSearchQ(searchParams.get('q') || '');
    setCityFilter(searchParams.get('city') || '');
    setVerifiedOnly(searchParams.get('verifiedOnly') === 'true');
  }, [searchParams, setSelectedCountryIso2]);

  useEffect(() => {
    const loadPros = async () => {
      setLoading(true);
      try {
        const qs = new URLSearchParams();
        if (allCountriesScope) {
          qs.set('countryIso2', 'ALL');
        } else if (selectedCountryIso2) {
          qs.set('countryIso2', selectedCountryIso2);
        }
        if (categoryFilter && categoryFilter !== 'all') qs.set('category', categoryFilter);
        if (cityFilter) qs.set('city', cityFilter);
        if (searchQ) qs.set('q', searchQ);
        if (verifiedOnly) qs.set('verifiedOnly', 'true');
        if (availableToday) qs.set('availableToday', 'true');
        const data = await apiFetch<{ professionals: ProfessionalRecord[] }>(`/api/professionals?${qs.toString()}`);
        setPros(data.professionals || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    if (!id) loadPros();
  }, [id, categoryFilter, cityFilter, searchQ, verifiedOnly, availableToday, selectedCountryIso2, allCountriesScope]);

  useEffect(() => {
    if (!id) {
      setSelectedPro(null);
      return;
    }
    const loadDetail = async () => {
      setLoading(true);
      try {
        const data = await apiFetch<{ professional: ProfessionalRecord }>(`/api/professionals/${id}`);
        setSelectedPro(data.professional);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    loadDetail();
  }, [id]);

  // SCREEN 3: PROFESSIONAL PROFILE DETAIL
  if (id && loading && !selectedPro) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        <BrandLoadingState label={t.search.loadingPros} />
      </div>
    );
  }

  if (id && !loading && !selectedPro) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        <BrandEmptyState
          title={t.search.noProsFound}
          action={
            <button
              type="button"
              onClick={() => navigate('/professionals')}
              className="px-4 py-2 rounded-lg bg-kazi-navy text-white text-xs font-semibold hover:bg-kazi-navy-mid"
            >
              {t.search.title}
            </button>
          }
        />
      </div>
    );
  }

  if (id && selectedPro) {
    const headline = getLocalizedField(lang, selectedPro, 'headline');
    const bio = getLocalizedField(lang, selectedPro, 'bio');

    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 pb-20 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => navigate('/professionals')}
            className="inline-flex items-center gap-2 text-sm font-medium text-kazi-navy hover:underline"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>{t.search.title}</span>
          </button>
          <KaziBrand variant="compact" theme="light" size="xs" />
        </div>

        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="bg-kazi-navy p-6 sm:p-8 text-white flex flex-col sm:flex-row items-start sm:items-center gap-6">
            <img
              src={selectedPro.avatarUrl || '/src/assets/images/pro_koffi_laurent_1794936770045.jpg'}
              alt={selectedPro.fullName}
              referrerPolicy="no-referrer"
              className="w-24 h-24 rounded-full object-cover border-2 border-white/80 shrink-0"
            />
            <div className="space-y-2 flex-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="font-display text-2xl font-bold">{selectedPro.fullName}</h1>
                {selectedPro.isVerified && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-300">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>{t.search.verifiedBadge}</span>
                  </span>
                )}
                {selectedPro.isProSubscriber && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-kazi-orange-bright">
                    <KaziBrand variant="symbol" theme="dark" size="xs" />
                    <span>KAZI Pro</span>
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-200">{headline}</p>
              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-200 tabular-nums">
                <span className="inline-flex items-center gap-1">
                  <Star className="w-4 h-4 text-kazi-orange-bright fill-kazi-orange-bright" />
                  <strong>{selectedPro.ratingAvg}</strong> ({selectedPro.reviewsCount} {t.search.reviewsCount})
                </span>
                <span>·</span>
                <span className="inline-flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" />
                  {selectedPro.neighborhood}, {selectedPro.city} ({selectedPro.distanceKm} km)
                </span>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => navigate(`/bookings?proId=${selectedPro.id}&mode=quote`)}
                className="px-4 py-2.5 rounded-lg border border-white/30 text-white text-sm font-semibold hover:bg-white/10 transition-colors whitespace-nowrap"
              >
                {t.search.requestQuote}
              </button>
              <button
                type="button"
                onClick={() => navigate(`/bookings?proId=${selectedPro.id}&mode=book`)}
                className="px-5 py-2.5 rounded-lg bg-kazi-orange-bright text-kazi-navy text-sm font-bold hover:bg-kazi-orange hover:text-white transition-colors whitespace-nowrap"
              >
                {t.search.bookNow}
              </button>
            </div>
          </div>

          {/* Profile Tabs */}
          <div className="border-b border-slate-200 px-6 flex items-center gap-6">
            {(['about', 'services', 'reviews'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`py-3.5 text-sm font-semibold border-b-2 transition-colors ${
                  activeTab === tab
                    ? 'border-kazi-orange text-kazi-navy'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                {t.search[tab]}
              </button>
            ))}
          </div>

          <div className="p-6 sm:p-8 space-y-6">
            {activeTab === 'about' && (
              <>
                <p className="text-sm text-slate-700 leading-relaxed">{bio}</p>
                <div>
                  <h3 className="font-display text-sm font-bold text-kazi-navy mb-3">{t.search.skillsTitle}</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {(selectedPro.skills || []).map((sk, idx) => (
                      <div key={idx} className="flex items-center gap-2.5 text-sm text-slate-700">
                        <CheckCircle2 className="w-4 h-4 text-kazi-green-accessible shrink-0" />
                        <span>
                          {getLocalizedField(lang, sk.skill, 'name')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {activeTab === 'services' && (
              <div className="divide-y divide-slate-200">
                {(selectedPro.services || []).map((sv) => (
                  <div key={sv.id} className="py-4 flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">
                        {getLocalizedField(lang, sv, 'title')}
                      </div>
                      <div className="text-xs text-slate-500 tabular-nums">{sv.durationMinutes} min</div>
                    </div>
                    <div className="text-sm font-bold text-kazi-navy tabular-nums">
                      {formatLocalCurrency(sv.basePrice, sv.currency, lang)}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'reviews' && (
              <div className="space-y-4">
                {(selectedPro.reviews || []).length === 0 ? (
                  <p className="text-sm text-slate-500">{t.search.noReviews}</p>
                ) : (
                  (selectedPro.reviews || []).map((rv) => (
                    <div key={rv.id} className="border-b border-slate-100 pb-4">
                      <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                        <span className="font-semibold text-slate-800">{rv.authorName}</span>
                        <span className="inline-flex items-center gap-1 text-kazi-orange font-bold">
                          <Star className="w-3.5 h-3.5 fill-kazi-orange-bright text-kazi-orange-bright" /> {rv.rating}/5
                        </span>
                      </div>
                      <p className="text-sm text-slate-700">{rv.comment}</p>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // SCREEN 2: SEARCH RESULTS & OPENSTREETMAP
  const mapCenterLat = pros[0]?.latitude || selectedCountry?.cities?.[0]?.latitude || '5.359952';
  const mapCenterLng = pros[0]?.longitude || selectedCountry?.cities?.[0]?.longitude || '-4.008256';
  const latNum = Number(mapCenterLat);
  const lngNum = Number(mapCenterLng);
  const osmUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${lngNum - 0.08}%2C${latNum - 0.06}%2C${lngNum + 0.08}%2C${latNum + 0.06}&layer=mapnik&marker=${latNum}%2C${lngNum}`;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 pb-20 space-y-6">
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <KaziBrand variant="symbol" theme="light" size="sm" />
            <div>
              <h1 className="font-display text-xl font-bold text-kazi-navy">{t.search.title}</h1>
              <p className="text-xs text-slate-500 tabular-nums">
                {pros.length} {t.search.prosFound} · {selectedCountry?.capital || 'Abidjan'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder={t.hero.searchPlaceholder}
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#087F70]"
            />
            <input
              type="text"
              value={cityFilter}
              onChange={(e) => setCityFilter(e.target.value)}
              placeholder={t.search.cityFilterPlaceholder}
              className="w-36 rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#087F70]"
            />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 bg-white"
            >
              <option value="all">{t.search.allCategories}</option>
              {categoryFilter.includes(',') && (
                <option value={categoryFilter}>{searchParams.get('domain') || t.nav.categories}</option>
              )}
              {categories.map((cat) => (
                <option key={cat.slug} value={cat.slug}>
                  {getLocalizedField(lang, cat, 'name')}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setVerifiedOnly(!verifiedOnly)}
              className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                verifiedOnly
                  ? 'bg-kazi-green-accessible text-white border-kazi-green-accessible'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              {t.search.verifiedOnly}
            </button>
            <button
              type="button"
              onClick={() => setAvailableToday(!availableToday)}
              className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                availableToday
                  ? 'bg-kazi-navy text-white border-kazi-navy'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              {t.search.availableToday}
            </button>
            <button
              type="button"
              onClick={() => setAllCountriesScope(!allCountriesScope)}
              className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                allCountriesScope
                  ? 'bg-kazi-orange-bright text-kazi-navy border-kazi-orange-bright'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              {t.search.allCountriesToggle}
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Pro list */}
        <div className="lg:col-span-7 space-y-4">
          {loading ? (
            <BrandLoadingState label={t.search.loadingPros} />
          ) : pros.length === 0 ? (
            <BrandEmptyState title={t.search.noProsFound} />
          ) : (
            pros.map((pro) => {
              const headline = getLocalizedField(lang, pro, 'headline');
              return (
                <div
                  key={pro.id}
                  onClick={() => navigate(`/professionals/${pro.id}`)}
                  className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 flex items-center gap-4 hover:border-kazi-navy transition-colors cursor-pointer"
                >
                  <img
                    src={pro.avatarUrl || '/src/assets/images/pro_koffi_laurent_1794936770045.jpg'}
                    alt={pro.fullName}
                    referrerPolicy="no-referrer"
                    className="w-16 h-16 rounded-full object-cover shrink-0 border border-slate-200"
                  />
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="font-display text-base font-bold text-kazi-navy truncate">{pro.fullName}</h2>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFavorites((prev) => ({ ...prev, [pro.id]: !prev[pro.id] }));
                        }}
                        className="p-1.5 text-slate-400 hover:text-rose-500"
                        aria-label={t.search.favoriteAria}
                      >
                        <Heart className={`w-4 h-4 ${favorites[pro.id] ? 'fill-rose-500 text-rose-500' : ''}`} />
                      </button>
                    </div>
                    <p className="text-xs text-slate-600 truncate">{headline}</p>
                    <div className="flex flex-wrap items-center gap-2.5 text-xs text-slate-600 tabular-nums">
                      <span className="inline-flex items-center gap-1 font-semibold text-slate-900">
                        <Star className="w-3.5 h-3.5 text-kazi-orange-bright fill-kazi-orange-bright" />
                        {pro.ratingAvg} ({pro.reviewsCount})
                      </span>
                      <span>·</span>
                      <span>
                        {pro.city} ({pro.distanceKm} km)
                      </span>
                      {pro.isVerified && (
                        <>
                          <span>·</span>
                          <span className="inline-flex items-center gap-1 font-semibold text-kazi-green-accessible">
                            <ShieldCheck className="w-3.5 h-3.5" /> {t.search.verifiedBadge}
                          </span>
                        </>
                      )}
                      {pro.isProSubscriber && (
                        <>
                          <span>·</span>
                          <span className="font-semibold text-kazi-orange">Pro</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* OpenStreetMap Geolocation View */}
        <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-sm font-bold text-kazi-navy">{t.search.mapTitle}</h3>
            <span className="text-xs text-slate-500 tabular-nums">
              {latNum.toFixed(3)}, {lngNum.toFixed(3)}
            </span>
          </div>
          <div className="w-full h-[360px] rounded-lg overflow-hidden border border-slate-200 bg-slate-100">
            <iframe
              title="OpenStreetMap KAZI AFRICA"
              src={osmUrl}
              className="w-full h-full border-0"
              loading="lazy"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
