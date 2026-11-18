import { fr } from './fr';
import { en } from './en';
import { pt } from './pt';
import { ar } from './ar';
import type { LangCode, TranslationDict } from './types';

export type { LangCode, TranslationDict };

export const TRANSLATIONS: Record<LangCode, TranslationDict> = {
  fr,
  en,
  pt,
  ar,
};

export function getLocalizedField(
  lang: LangCode,
  record: Record<string, any> | null | undefined,
  baseKey: string
): string {
  if (!record) return '';
  const suffixMap: Record<LangCode, string> = {
    fr: 'Fr',
    en: 'En',
    pt: 'Pt',
    ar: 'Ar',
  };
  const preferred = record[`${baseKey}${suffixMap[lang]}`];
  if (typeof preferred === 'string' && preferred.trim()) return preferred;
  const fallbacks = ['Fr', 'En', 'Pt', 'Ar'];
  for (const suffix of fallbacks) {
    const val = record[`${baseKey}${suffix}`];
    if (typeof val === 'string' && val.trim()) return val;
  }
  return '';
}

export function formatLocalCurrency(amount: number | string, currency = 'EUR', lang: LangCode = 'fr'): string {
  const num = Number(amount || 0);
  const locale = lang === 'ar' ? 'ar-EG' : lang === 'en' ? 'en-GB' : lang === 'pt' ? 'pt-PT' : 'fr-FR';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: currency === 'XOF' || currency === 'XAF' ? 0 : 2,
    }).format(num);
  } catch {
    return `${num.toFixed(2)} ${currency}`;
  }
}
