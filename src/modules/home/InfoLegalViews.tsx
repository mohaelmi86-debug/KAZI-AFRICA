import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Globe,
  HelpCircle,
  Mail,
  Search,
  Send,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { apiFetch } from '../../services/api';
import { getLocalizedField } from '../../i18n/translations';
import { KaziBrand } from '../../components/KaziBrand';
import type { FaqItem } from '../../types/kazi';

export const AboutPage: React.FC = () => {
  const { t } = useApp();
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 pb-20 space-y-6">
      <Link to="/" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#087F70] hover:underline">
        <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
        <span>{t.common.backHome}</span>
      </Link>

      <section className="rounded-2xl bg-[#102D3A] text-white p-6 sm:p-10 space-y-4">
        <KaziBrand variant="full" theme="dark" size="md" />
        <h1 className="font-display text-2xl sm:text-3xl font-extrabold">{t.pages.aboutTitle}</h1>
        <p className="text-sm sm:text-base text-slate-200 max-w-2xl leading-relaxed">
          {t.pages.aboutSubtitle}
        </p>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <article className="bg-white rounded-2xl border border-slate-200 p-6 space-y-2.5">
          <ShieldCheck className="w-6 h-6 text-[#087F70]" />
          <h2 className="font-display text-base font-bold text-[#102D3A]">{t.pages.aboutMissionTitle}</h2>
          <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">{t.pages.aboutMissionBody}</p>
        </article>
        <article className="bg-white rounded-2xl border border-slate-200 p-6 space-y-2.5">
          <Users className="w-6 h-6 text-[#E9B66B]" />
          <h2 className="font-display text-base font-bold text-[#102D3A]">{t.pages.aboutTeamTitle}</h2>
          <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">{t.pages.aboutTeamBody}</p>
        </article>
        <article className="bg-white rounded-2xl border border-slate-200 p-6 space-y-2.5">
          <Globe className="w-6 h-6 text-[#087F70]" />
          <h2 className="font-display text-base font-bold text-[#102D3A]">{t.pages.aboutPanAfricanTitle}</h2>
          <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">{t.pages.aboutPanAfricanBody}</p>
        </article>
      </div>
    </div>
  );
};

export const ContactPage: React.FC = () => {
  const { t, lang, countries, selectedCountryIso2 } = useApp();
  const [searchParams] = useSearchParams();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [countryIso2, setCountryIso2] = useState(selectedCountryIso2 || 'CI');
  const [subject, setSubject] = useState(searchParams.get('subject') || '');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refCode, setRefCode] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch<{ received: boolean; referenceCode: string }>('/api/contact', {
        method: 'POST',
        body: JSON.stringify({ name, email, countryIso2, subject, message }),
      });
      setRefCode(res.referenceCode);
      setMessage('');
    } catch (err: any) {
      setError(err.message || 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 pb-20 space-y-6">
      <Link to="/" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#087F70] hover:underline">
        <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
        <span>{t.common.backHome}</span>
      </Link>

      <section className="rounded-2xl bg-[#102D3A] text-white p-6 sm:p-8 space-y-2">
        <div className="inline-flex items-center gap-2 text-xs font-bold text-[#E9B66B]">
          <Mail className="w-4 h-4" />
          <span>KAZI AFRICA</span>
        </div>
        <h1 className="font-display text-2xl font-extrabold">{t.pages.contactTitle}</h1>
        <p className="text-sm text-slate-200">{t.pages.contactSubtitle}</p>
      </section>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8">
        {refCode ? (
          <div className="rounded-xl bg-[#EAF4F2] border border-[#087F70]/30 p-6 text-center space-y-3">
            <CheckCircle2 className="w-8 h-8 text-[#087F70] mx-auto" />
            <p className="text-sm font-semibold text-[#102D3A]">{t.pages.contactSuccess}</p>
            <div className="font-mono text-xs font-bold text-[#087F70]">{refCode}</div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <p className="text-xs text-rose-600">{error}</p>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block space-y-1 text-xs font-semibold text-[#102D3A]">
                <span>{t.pages.contactName}</span>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full h-10 rounded-lg border border-slate-300 bg-[#FAF7F0] px-3 text-sm font-normal text-[#23343B]"
                />
              </label>
              <label className="block space-y-1 text-xs font-semibold text-[#102D3A]">
                <span>{t.pages.contactEmail}</span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-10 rounded-lg border border-slate-300 bg-[#FAF7F0] px-3 text-sm font-normal text-[#23343B]"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block space-y-1 text-xs font-semibold text-[#102D3A]">
                <span>{t.toolbar.countryLabel}</span>
                <select
                  value={countryIso2}
                  onChange={(e) => setCountryIso2(e.target.value)}
                  className="w-full h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal text-[#23343B]"
                >
                  {countries.map((c) => (
                    <option key={c.iso2} value={c.iso2}>
                      {getLocalizedField(lang, c, 'name')} ({c.iso2})
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1 text-xs font-semibold text-[#102D3A]">
                <span>{t.pages.contactSubject}</span>
                <input
                  type="text"
                  required
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full h-10 rounded-lg border border-slate-300 bg-[#FAF7F0] px-3 text-sm font-normal text-[#23343B]"
                />
              </label>
            </div>

            <label className="block space-y-1 text-xs font-semibold text-[#102D3A]">
              <span>{t.pages.contactMessage}</span>
              <textarea
                required
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-[#FAF7F0] p-3 text-sm font-normal text-[#23343B]"
              />
            </label>

            <button
              type="submit"
              disabled={submitting}
              className="min-h-[44px] px-6 py-2.5 rounded-xl bg-[#087F70] hover:bg-[#16A68A] text-white text-sm font-bold inline-flex items-center gap-2 transition-colors disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              <span>{submitting ? t.common.loading : t.pages.contactSend}</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export const HelpPage: React.FC = () => {
  const { t, lang } = useApp();
  const [items, setItems] = useState<FaqItem[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [searchQ, setSearchQ] = useState('');

  useEffect(() => {
    apiFetch<{ items: FaqItem[] }>('/api/faq')
      .then((res) => {
        setItems(res.items || []);
        if (res.items?.[0]) setOpenId(res.items[0].id);
      })
      .catch(() => {});
  }, []);

  const filtered = items.filter((item) => {
    if (!searchQ.trim()) return true;
    const q = getLocalizedField(lang, item, 'question').toLowerCase();
    const a = getLocalizedField(lang, item, 'answer').toLowerCase();
    return q.includes(searchQ.toLowerCase()) || a.includes(searchQ.toLowerCase());
  });

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 pb-20 space-y-6">
      <Link to="/" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#087F70] hover:underline">
        <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
        <span>{t.common.backHome}</span>
      </Link>

      <section className="rounded-2xl bg-[#102D3A] text-white p-6 sm:p-8 space-y-3">
        <div className="inline-flex items-center gap-2 text-xs font-bold text-[#E9B66B]">
          <HelpCircle className="w-4 h-4" />
          <span>KAZI AFRICA</span>
        </div>
        <h1 className="font-display text-2xl font-extrabold">{t.pages.helpTitle}</h1>
        <p className="text-sm text-slate-200">{t.pages.helpSubtitle}</p>
        <div className="relative max-w-md pt-2">
          <Search className="w-4 h-4 text-slate-400 absolute top-1/2 translate-y-[-10%] start-3" />
          <input
            type="text"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder={t.pages.helpSearchPlaceholder}
            className="w-full h-10 rounded-lg bg-white text-[#23343B] ps-9 pe-3 text-xs"
          />
        </div>
      </section>

      <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 p-4 sm:p-6">
        {filtered.length === 0 ? (
          <p className="text-sm text-slate-500 py-4">{t.homepage.faqEmpty}</p>
        ) : (
          filtered.map((item) => {
            const isOpen = openId === item.id;
            return (
              <div key={item.id} className="py-3">
                <button
                  type="button"
                  onClick={() => setOpenId(isOpen ? null : item.id)}
                  aria-expanded={isOpen}
                  className="w-full flex items-center justify-between gap-4 text-start py-1 text-sm font-bold text-[#102D3A] hover:text-[#087F70]"
                >
                  <span>{getLocalizedField(lang, item, 'question')}</span>
                  <ChevronDown
                    className={`w-4 h-4 shrink-0 transition-transform ${isOpen ? 'rotate-180 text-[#087F70]' : ''}`}
                  />
                </button>
                {isOpen && (
                  <p className="pt-2 text-xs sm:text-sm text-slate-600 leading-relaxed">
                    {getLocalizedField(lang, item, 'answer')}
                  </p>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="rounded-xl bg-[#EAF4F2] border border-[#087F70]/20 p-5 flex flex-wrap items-center justify-between gap-4">
        <span className="text-xs sm:text-sm font-semibold text-[#102D3A]">{t.pages.contactSubtitle}</span>
        <Link
          to="/contact"
          className="px-4 py-2 rounded-lg bg-[#087F70] text-white text-xs font-bold hover:bg-[#16A68A]"
        >
          {t.footer.linkContact}
        </Link>
      </div>
    </div>
  );
};

export const TermsPage: React.FC = () => {
  const { t } = useApp();
  const sections = [
    { title: t.pages.termsSec1Title, body: t.pages.termsSec1Body },
    { title: t.pages.termsSec2Title, body: t.pages.termsSec2Body },
    { title: t.pages.termsSec3Title, body: t.pages.termsSec3Body },
  ];
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 pb-20 space-y-6">
      <Link to="/" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#087F70] hover:underline">
        <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
        <span>{t.common.backHome}</span>
      </Link>
      <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 space-y-6">
        <div className="space-y-2 border-b border-slate-100 pb-4">
          <h1 className="font-display text-2xl font-extrabold text-[#102D3A]">{t.pages.termsTitle}</h1>
          <p className="text-sm text-slate-600 leading-relaxed">{t.pages.termsIntro}</p>
        </div>
        {sections.map((sec, idx) => (
          <section key={idx} className="space-y-1.5">
            <h2 className="font-display text-base font-bold text-[#102D3A]">{sec.title}</h2>
            <p className="text-sm text-slate-600 leading-relaxed">{sec.body}</p>
          </section>
        ))}
      </div>
    </div>
  );
};

export const PrivacyPage: React.FC = () => {
  const { t } = useApp();
  const sections = [
    { title: t.pages.privacySec1Title, body: t.pages.privacySec1Body },
    { title: t.pages.privacySec2Title, body: t.pages.privacySec2Body },
    { title: t.pages.privacySec3Title, body: t.pages.privacySec3Body },
  ];
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 pb-20 space-y-6">
      <Link to="/" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#087F70] hover:underline">
        <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
        <span>{t.common.backHome}</span>
      </Link>
      <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 space-y-6">
        <div className="space-y-2 border-b border-slate-100 pb-4">
          <h1 className="font-display text-2xl font-extrabold text-[#102D3A]">{t.pages.privacyTitle}</h1>
          <p className="text-sm text-slate-600 leading-relaxed">{t.pages.privacyIntro}</p>
        </div>
        {sections.map((sec, idx) => (
          <section key={idx} className="space-y-1.5">
            <h2 className="font-display text-base font-bold text-[#102D3A]">{sec.title}</h2>
            <p className="text-sm text-slate-600 leading-relaxed">{sec.body}</p>
          </section>
        ))}
      </div>
    </div>
  );
};
