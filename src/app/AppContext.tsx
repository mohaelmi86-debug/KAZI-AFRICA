import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { TRANSLATIONS, type LangCode, type TranslationDict } from '../i18n/translations';
import type { CategoryRecord, CountryRecord } from '../types/kazi';
import { apiFetch } from '../services/api';
import { useAuth } from '../modules/auth/AuthContext';

const SUPPORTED_LANGS: LangCode[] = ['fr', 'en', 'pt', 'ar'];

function normalizeLang(val: string | null | undefined): LangCode | null {
  if (!val) return null;
  return (SUPPORTED_LANGS as string[]).includes(val) ? (val as LangCode) : null;
}

interface AppContextValue {
  lang: LangCode;
  setLang: (l: LangCode) => void;
  t: TranslationDict;
  isRtl: boolean;
  countries: CountryRecord[];
  selectedCountryIso2: string;
  setSelectedCountryIso2: (iso2: string) => void;
  selectedCountry: CountryRecord | null;
  categories: CategoryRecord[];
  reloadCountries: () => Promise<void>;
  loadingCore: boolean;
}

const AppContext = createContext<AppContextValue | null>(null);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { profile } = useAuth();
  const [lang, setLangState] = useState<LangCode>(() => {
    try {
      const saved = normalizeLang(localStorage.getItem('kazi_lang'));
      if (saved) return saved;
    } catch {
      // ignore storage unavailability
    }
    return 'fr';
  });
  const manualOverrideRef = useRef<boolean>(false);
  const lastProfileUidRef = useRef<string | null>(null);

  const [countries, setCountries] = useState<CountryRecord[]>([]);
  const [selectedCountryIso2, setSelectedCountryIso2] = useState<string>('CI');
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [loadingCore, setLoadingCore] = useState<boolean>(true);

  const setLang = useCallback(
    (nextLang: LangCode) => {
      manualOverrideRef.current = true;
      setLangState(nextLang);
      try {
        localStorage.setItem('kazi_lang', nextLang);
      } catch {
        // ignore
      }
      document.documentElement.lang = nextLang;
      document.documentElement.dir = nextLang === 'ar' ? 'rtl' : 'ltr';
      if (profile) {
        apiFetch('/api/auth/preferences', {
          method: 'PATCH',
          body: JSON.stringify({ preferredLang: nextLang }),
        }).catch(() => {});
      }
    },
    [profile]
  );

  useEffect(() => {
    if (!profile) {
      lastProfileUidRef.current = null;
      return;
    }
    if (lastProfileUidRef.current !== profile.uid) {
      lastProfileUidRef.current = profile.uid;
      if (!manualOverrideRef.current) {
        const profileLang = normalizeLang(profile.preferredLang);
        if (profileLang && profileLang !== lang) {
          setLangState(profileLang);
          try {
            localStorage.setItem('kazi_lang', profileLang);
          } catch {
            // ignore
          }
        }
      }
    }
  }, [profile, lang]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);

  const reloadCountries = useCallback(async () => {
    try {
      const [cRes, catRes] = await Promise.all([
        apiFetch<{ countries: CountryRecord[] }>('/api/countries'),
        apiFetch<{ categories: CategoryRecord[] }>('/api/categories'),
      ]);
      setCountries(cRes.countries || []);
      setCategories(catRes.categories || []);
    } catch (err) {
      console.error('Failed loading core referentials:', err);
    } finally {
      setLoadingCore(false);
    }
  }, []);

  useEffect(() => {
    reloadCountries();
    const onReconnect = () => {
      reloadCountries();
    };
    window.addEventListener('online', onReconnect);
    return () => window.removeEventListener('online', onReconnect);
  }, [reloadCountries]);

  const selectedCountry = countries.find((c) => c.iso2 === selectedCountryIso2) || countries[0] || null;

  return (
    <AppContext.Provider
      value={{
        lang,
        setLang,
        t: TRANSLATIONS[lang],
        isRtl: lang === 'ar',
        countries,
        selectedCountryIso2,
        setSelectedCountryIso2,
        selectedCountry,
        categories,
        reloadCountries,
        loadingCore,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
