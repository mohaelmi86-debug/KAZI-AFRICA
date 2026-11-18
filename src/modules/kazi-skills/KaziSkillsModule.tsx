import React, { useEffect, useState, useCallback } from 'react';
import { Award, BookOpen, CheckCircle2, Clock, GraduationCap, Plus, Printer, X } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { useAuth } from '../auth/AuthContext';
import { StatusLabel } from '../../components/DesignSystem';
import { KaziBrand } from '../../components/KaziBrand';
import { KAZI_BRAND } from '../../config/brand';
import { apiFetch } from '../../services/api';
import { formatLocalCurrency, getLocalizedField } from '../../i18n/translations';
import type { CourseRecord } from '../../types/kazi';

export const KaziSkillsModule: React.FC = () => {
  const { t, lang } = useApp();
  const { profile, roles, signIn } = useAuth();

  const [courses, setCourses] = useState<CourseRecord[]>([]);
  const [categoryTab, setCategoryTab] = useState('all');
  const [passport, setPassport] = useState<any>(null);
  const [certifications, setCertifications] = useState<any[]>([]);
  const [selectedCert, setSelectedCert] = useState<any | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTitleFr, setNewTitleFr] = useState('');
  const [newPartner, setNewPartner] = useState('KAZI Skills Academy');
  const [newCategory, setNewCategory] = useState('electricity');
  const [newCredentialType, setNewCredentialType] = useState('PARTNER_ATTESTATION');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadSkillsData = useCallback(async () => {
    try {
      const [cRes, pRes] = await Promise.all([
        apiFetch<{ courses: CourseRecord[] }>(`/api/skills/courses?category=${categoryTab}`),
        apiFetch<{ passport: any; certifications: any[] }>('/api/skills/passport'),
      ]);
      setCourses(cRes.courses || []);
      setPassport(pRes.passport);
      setCertifications(pRes.certifications || []);
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  }, [categoryTab]);

  useEffect(() => {
    loadSkillsData();
  }, [loadSkillsData]);

  const handleEnroll = async (courseId: string) => {
    if (!profile) {
      await signIn();
      return;
    }
    setErrorMsg(null);
    try {
      await apiFetch('/api/skills/enroll', {
        method: 'POST',
        body: JSON.stringify({ courseId }),
      });
      setFeedback(t.skills.enrolledMsg);
      await loadSkillsData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleEvaluate = async (courseId: string, evaluationType: 'THEORETICAL' | 'PRACTICAL') => {
    if (!profile) {
      await signIn();
      return;
    }
    setErrorMsg(null);
    try {
      await apiFetch('/api/skills/evaluate', {
        method: 'POST',
        body: JSON.stringify({ courseId, evaluationType, scorePct: 90 }),
      });
      setFeedback(
        evaluationType === 'PRACTICAL'
          ? t.skills.evalPracticalMsg
          : t.skills.evalTheoreticalMsg
      );
      await loadSkillsData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleCreateCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    try {
      await apiFetch('/api/skills/courses', {
        method: 'POST',
        body: JSON.stringify({
          titleFr: newTitleFr,
          partnerOrgName: newPartner,
          categorySlug: newCategory,
          credentialType: newCredentialType,
          durationHours: 5,
          level: 'INTERMEDIATE',
        }),
      });
      setNewTitleFr('');
      setShowCreateForm(false);
      setFeedback(t.skills.coursePublishedMsg);
      await loadSkillsData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const pct = passport?.completionPct ?? 0;
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (pct / 100) * circumference;
  const canCreateCourse = roles.includes('SUPER_ADMIN') || roles.includes('TRAINING_PARTNER');

  const credentialLabel = (type: string) => {
    if (type === 'OFFICIAL_DIPLOMA') return t.skills.credOfficialDiploma;
    if (type === 'KAZI_EVALUATION') return t.skills.credKaziEval;
    return t.skills.credPartnerAttestation;
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 pb-20 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 no-print">
        <div className="flex items-center gap-3">
          <KaziBrand variant="symbol" theme="light" size="md" />
          <div>
            <h1 className="font-display text-2xl font-bold text-kazi-navy">{t.skills.title}</h1>
            <p className="text-sm text-slate-600">{t.skills.subtitle}</p>
          </div>
        </div>
        {canCreateCourse && (
          <button
            type="button"
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-kazi-navy text-white text-xs font-semibold hover:bg-kazi-navy-mid"
          >
            <Plus className="w-4 h-4" />
            <span>{t.skills.createCourse}</span>
          </button>
        )}
      </div>

      <p className="text-xs font-medium text-slate-600 no-print">{t.skills.credentialLegend}</p>

      {feedback && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 no-print">
          {feedback}
        </div>
      )}
      {errorMsg && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 no-print">
          {errorMsg}
        </div>
      )}

      {showCreateForm && (
        <form onSubmit={handleCreateCourse} className="bg-white rounded-xl border border-slate-200 p-5 grid grid-cols-1 sm:grid-cols-4 gap-3 no-print">
          <input
            type="text"
            required
            value={newTitleFr}
            onChange={(e) => setNewTitleFr(e.target.value)}
            placeholder={t.skills.courseTitlePlaceholder}
            className="rounded-lg border border-slate-300 px-3 py-2 text-xs"
          />
          <input
            type="text"
            required
            value={newPartner}
            onChange={(e) => setNewPartner(e.target.value)}
            placeholder={t.skills.partnerOrgPlaceholder}
            className="rounded-lg border border-slate-300 px-3 py-2 text-xs"
          />
          <select
            value={newCredentialType}
            onChange={(e) => setNewCredentialType(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-xs bg-white"
          >
            <option value="KAZI_EVALUATION">{t.skills.credKaziEval}</option>
            <option value="PARTNER_ATTESTATION">{t.skills.credPartnerAttestation}</option>
            <option value="OFFICIAL_DIPLOMA">{t.skills.credOfficialDiploma}</option>
          </select>
          <button
            type="submit"
            className="rounded-lg bg-kazi-green-accessible text-white text-xs font-semibold py-2 px-4 hover:bg-kazi-green"
          >
            {t.skills.publishBtn}
          </button>
        </form>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start no-print">
        {/* DIGITAL SKILLS PASSPORT */}
        <div className="lg:col-span-4 bg-white rounded-xl border border-slate-200 p-6 space-y-5">
          <div className="bg-kazi-navy text-white rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-white/15 pb-3">
              <KaziBrand variant="compact" theme="dark" size="xs" />
              <span className="text-[11px] font-semibold text-kazi-orange-bright">KAZI Skills</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-xs text-slate-300">{t.skills.passportTitle}</div>
                <div className="font-display text-lg font-bold mt-1">
                  {passport?.tradeTitle || 'Électricien'}
                </div>
              </div>
              <div className="relative w-20 h-20 flex items-center justify-center shrink-0">
                <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
                  <circle cx="40" cy="40" r={radius} stroke="rgba(255,255,255,0.2)" strokeWidth="6" fill="none" />
                  <circle
                    cx="40"
                    cy="40"
                    r={radius}
                    stroke={KAZI_BRAND.palette.green}
                    strokeWidth="6"
                    fill="none"
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    strokeLinecap="round"
                  />
                </svg>
                <span className="absolute text-sm font-bold tabular-nums">{pct}%</span>
              </div>
            </div>
          </div>

          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between py-2 border-b border-slate-100">
              <span className="inline-flex items-center gap-2 text-slate-800">
                <CheckCircle2 className="w-4 h-4 text-kazi-green-accessible" />
                <span>{t.skills.practicalEval}</span>
              </span>
              <StatusLabel status={passport?.practicalStatus || 'IN_PROGRESS'} />
            </div>
            <div className="flex items-center justify-between py-2 border-b border-slate-100">
              <span className="inline-flex items-center gap-2 text-slate-800">
                <CheckCircle2 className="w-4 h-4 text-kazi-green-accessible" />
                <span>{t.skills.theoreticalKnowledge}</span>
              </span>
              <StatusLabel status={passport?.theoreticalStatus || 'IN_PROGRESS'} />
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="inline-flex items-center gap-2 text-slate-800">
                <Clock className="w-4 h-4 text-kazi-orange" />
                <span>{t.skills.kaziCert}</span>
              </span>
              <StatusLabel status={passport?.kaziCertStatus || 'IN_PROGRESS'} />
            </div>
          </div>

          {certifications.length > 0 && (
            <div className="pt-3 border-t border-slate-200 space-y-2">
              <h3 className="text-xs font-bold text-kazi-navy">{t.skills.attestationsTitle}</h3>
              {certifications.map((cert) => (
                <div key={cert.id} className="text-xs bg-kazi-canvas rounded-lg p-3 border border-slate-200 space-y-1.5">
                  <div className="font-semibold text-slate-900">{cert.title}</div>
                  <div className="text-slate-500">
                    {credentialLabel(cert.credentialCategory)} · {cert.issuerName} ·{' '}
                    <span className="font-mono">{cert.certificateCode}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedCert(cert)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-kazi-navy hover:underline"
                  >
                    <Printer className="w-3 h-3" />
                    <span>{t.skills.previewPrint}</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* COURSE CATALOG */}
        <div className="lg:col-span-8 bg-white rounded-xl border border-slate-200 p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
            <h2 className="font-display text-lg font-bold text-kazi-navy inline-flex items-center gap-2">
              <GraduationCap className="w-5 h-5" />
              <span>{t.skills.catalogTitle}</span>
            </h2>
            <div className="flex flex-wrap items-center gap-1.5">
              {[
                { key: 'all', label: t.skills.allCategories },
                { key: 'electricity', label: t.skills.catElectricity },
                { key: 'plumbing', label: t.skills.catPlumbing },
                { key: 'solar', label: t.skills.catSolar },
              ].map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setCategoryTab(c.key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    categoryTab === c.key ? 'bg-kazi-navy text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            {courses.map((course) => {
              const title = getLocalizedField(lang, course, 'title');
              const desc = getLocalizedField(lang, course, 'description');
              return (
                <div
                  key={course.id}
                  className="rounded-xl border border-slate-200 p-4 flex flex-col sm:flex-row items-start sm:items-center gap-4"
                >
                  <img
                    src={course.thumbnailUrl || '/src/assets/images/course_solar_installation_1794936769118.jpg'}
                    alt={title}
                    referrerPolicy="no-referrer"
                    className="w-full sm:w-32 h-24 rounded-lg object-cover shrink-0 border border-slate-200"
                  />
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="text-xs font-medium text-kazi-green-accessible">
                      {credentialLabel(course.credentialType)} · {course.partnerOrgName}
                    </div>
                    <h3 className="font-display text-base font-bold text-kazi-navy">{title}</h3>
                    <p className="text-xs text-slate-600 line-clamp-2">{desc}</p>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 tabular-nums pt-1">
                      <span>{course.durationHours} h</span>
                      <span>·</span>
                      <span>{course.level}</span>
                      <span>·</span>
                      <span>{course.enrolledCount} {t.skills.enrolledCountLabel}</span>
                      <span>·</span>
                      <span className="font-bold text-slate-900">
                        {formatLocalCurrency(course.priceEur, 'EUR', lang)}
                      </span>
                    </div>
                  </div>
                  <div className="flex sm:flex-col gap-2 w-full sm:w-auto shrink-0">
                    <button
                      type="button"
                      onClick={() => handleEnroll(course.id)}
                      className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-kazi-navy text-white text-xs font-semibold hover:bg-kazi-navy-mid whitespace-nowrap"
                    >
                      <BookOpen className="w-3.5 h-3.5" />
                      <span>{t.skills.enroll}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleEvaluate(course.id, 'THEORETICAL')}
                      className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50 whitespace-nowrap"
                    >
                      <Award className="w-3.5 h-3.5" />
                      <span>{t.skills.takeEval}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleEvaluate(course.id, 'PRACTICAL')}
                      className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg border border-emerald-300 text-emerald-800 text-xs font-semibold hover:bg-emerald-50 whitespace-nowrap"
                    >
                      <Award className="w-3.5 h-3.5" />
                      <span>{t.skills.takePracticalEval}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Printable Official Certificate / Attestation Modal */}
      {selectedCert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-xl rounded-xl bg-white border-2 border-kazi-navy p-8 space-y-5 shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
              <KaziBrand variant="full" theme="light" size="md" />
              <button
                type="button"
                onClick={() => setSelectedCert(null)}
                aria-label={t.common.close}
                className="p-1 text-slate-400 hover:text-slate-700 no-print"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="text-center space-y-2 py-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-kazi-orange">
                {credentialLabel(selectedCert.credentialCategory)}
              </div>
              <h2 className="font-display text-2xl font-bold text-kazi-navy">{selectedCert.title}</h2>
              {profile && <p className="text-sm font-medium text-slate-700">{t.skills.issuedTo} {profile.fullName}</p>}
              <p className="text-xs text-slate-500">
                {t.skills.issuingOrg} {selectedCert.issuerName} · {t.skills.codeLabel}{' '}
                <span className="font-mono font-semibold text-kazi-navy">{selectedCert.certificateCode}</span>
              </p>
            </div>
            <div className="flex items-center justify-between border-t border-slate-200 pt-4 text-xs text-slate-500">
              <span>{KAZI_BRAND.tagline}</span>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-kazi-navy text-white font-semibold hover:bg-kazi-navy-mid no-print"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>{t.common.print}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
