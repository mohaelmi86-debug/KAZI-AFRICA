import React, { useEffect, useState, useCallback } from 'react';
import { FileCheck2, ShieldAlert, Sparkles } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { useAuth } from '../auth/AuthContext';
import { AuthGateCard, BrandEmptyState, BrandLoadingState, StatusLabel } from '../../components/DesignSystem';
import { KaziBrand } from '../../components/KaziBrand';
import { apiFetch } from '../../services/api';
import { formatLocalCurrency } from '../../i18n/translations';
import type { MissionRecord } from '../../types/kazi';

export const ProWorkspaceModule: React.FC = () => {
  const { t, lang, selectedCountryIso2, selectedCountry } = useApp();
  const { profile, loading: authLoading } = useAuth();

  const [missions, setMissions] = useState<MissionRecord[]>([]);
  const [tab, setTab] = useState<'new' | 'planned' | 'completed'>('new');
  const [quoteAmount, setQuoteAmount] = useState('225');
  const [quoteScope, setQuoteScope] = useState('');
  const [quoteDuration, setQuoteDuration] = useState('2h00');
  const [docType, setDocType] = useState('NATIONAL_ID');
  const [docName, setDocName] = useState('');
  const [trade, setTrade] = useState('Électricien');
  const [rawBio, setRawBio] = useState('');
  const [aiBioResult, setAiBioResult] = useState<any>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadMissions = useCallback(async () => {
    if (!profile) return;
    try {
      const res = await apiFetch<{ missions: MissionRecord[] }>('/api/missions');
      setMissions(res.missions || []);
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  }, [profile]);

  useEffect(() => {
    loadMissions();
  }, [loadMissions]);

  if (authLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
        <BrandLoadingState />
      </div>
    );
  }
  if (!profile) return <AuthGateCard />;

  const newMissions = missions.filter((m) => ['REQUESTED', 'QUOTED'].includes(m.status));
  const plannedMissions = missions.filter((m) => ['ACCEPTED', 'IN_PROGRESS', 'PENDING_VALIDATION'].includes(m.status));
  const completedMissions = missions.filter((m) => m.status === 'COMPLETED');

  const activeList = tab === 'new' ? newMissions : tab === 'planned' ? plannedMissions : completedMissions;

  const handleSendQuote = async (missionId: string) => {
    setErrorMsg(null);
    try {
      await apiFetch(`/api/missions/${missionId}/quotes`, {
        method: 'POST',
        body: JSON.stringify({
          amount: Number(quoteAmount),
          scopeDetails: quoteScope || t.proSpace.defaultQuoteScope,
          estimatedDuration: quoteDuration,
        }),
      });
      setFeedback(t.proSpace.quoteSentMsg);
      await loadMissions();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleProBookingTransition = async (bookingId: string, toStatus: string) => {
    setErrorMsg(null);
    try {
      await apiFetch(`/api/bookings/${bookingId}/transition`, {
        method: 'POST',
        body: JSON.stringify({ toStatus }),
      });
      setFeedback(`${toStatus}`);
      await loadMissions();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleAiQuoteDraft = async (mission: MissionRecord) => {
    setErrorMsg(null);
    try {
      const res = await apiFetch('/api/ai/quote-assist', {
        method: 'POST',
        body: JSON.stringify({
          missionTitle: mission.title,
          missionDescription: mission.description,
          city: mission.city,
          currency: mission.currency,
          lang,
        }),
      });
      setQuoteScope(res.scopeDetails || '');
      setQuoteDuration(res.estimatedDuration || '2h00');
      if (res.suggestedAmount) setQuoteAmount(String(res.suggestedAmount));
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleSubmitVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    try {
      await apiFetch('/api/professionals/register', {
        method: 'POST',
        body: JSON.stringify({
          countryIso2: selectedCountryIso2,
          primaryCategorySlug: 'electricity',
          headlineFr: trade,
          bioFr: rawBio || 'Artisan certifié sur KAZI AFRICA.',
        }),
      });
      await apiFetch('/api/professionals/me/verifications', {
        method: 'POST',
        body: JSON.stringify({ docType, documentName: docName || `${docType} — ${profile.fullName}` }),
      });
      setDocName('');
      setFeedback(t.proSpace.verificationSentMsg);
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleAiBioAssist = async () => {
    setErrorMsg(null);
    try {
      const res = await apiFetch('/api/ai/profile-assist', {
        method: 'POST',
        body: JSON.stringify({ trade, yearsExperience: 5, rawBio }),
      });
      setAiBioResult(res);
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 pb-20 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <KaziBrand variant="symbol" theme="light" size="md" />
          <div>
            <h1 className="font-display text-2xl font-bold text-kazi-navy">{t.proSpace.title}</h1>
            <p className="text-sm text-slate-600">
              {t.proSpace.greetingPrefix} {profile.fullName} — {newMissions.length} {t.proSpace.missionsToProcess.toLowerCase()}.
            </p>
          </div>
        </div>
      </div>

      {feedback && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {feedback}
        </div>
      )}
      {errorMsg && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {errorMsg}
        </div>
      )}

      {/* 3 KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="text-xs text-slate-500">{t.proSpace.missionsToProcess}</div>
          <div className="text-3xl font-extrabold text-kazi-navy mt-1 tabular-nums">{newMissions.length}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="text-xs text-slate-500">{t.proSpace.missionsMonth}</div>
          <div className="text-3xl font-extrabold text-kazi-navy mt-1 tabular-nums">{missions.length}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="text-xs text-slate-500">{t.proSpace.estimatedRevenue}</div>
          <div className="text-3xl font-extrabold text-kazi-orange mt-1 tabular-nums">
            {formatLocalCurrency(
              missions.reduce((s, m) => s + Number(m.estimatedBudget || 225), 0),
              missions[0]?.currency || selectedCountry?.defaultCurrency || 'EUR',
              lang
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Missions & Quotes */}
        <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 p-6 space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
            {(['new', 'planned', 'completed'] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  tab === key ? 'bg-kazi-navy text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {key === 'new' ? t.proSpace.tabNew : key === 'planned' ? t.proSpace.tabPlanned : t.proSpace.tabCompleted}
              </button>
            ))}
          </div>

          <div className="space-y-4">
            {activeList.length === 0 ? (
              <BrandEmptyState title={t.proSpace.noTabMissions} />
            ) : (
              activeList.map((m) => (
                <div key={m.id} className="rounded-xl border border-slate-200 bg-kazi-canvas p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-display text-sm font-bold text-kazi-navy">{m.title}</h3>
                      <p className="text-xs text-slate-600">
                        {m.address} · {m.desiredDate} · {m.timeSlot}
                      </p>
                    </div>
                    <div className="text-end">
                      <div className="text-sm font-bold text-kazi-orange tabular-nums">
                        {formatLocalCurrency(m.estimatedBudget || 225, m.currency, lang)}
                      </div>
                      <StatusLabel status={m.booking?.status || m.status} />
                    </div>
                  </div>

                  {m.status === 'REQUESTED' && (
                    <div className="pt-2 border-t border-slate-200 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="number"
                          value={quoteAmount}
                          onChange={(e) => setQuoteAmount(e.target.value)}
                          placeholder={t.proSpace.amountPlaceholder}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
                        />
                        <input
                          type="text"
                          value={quoteDuration}
                          onChange={(e) => setQuoteDuration(e.target.value)}
                          placeholder={t.proSpace.durationPlaceholder}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
                        />
                      </div>
                      <input
                        type="text"
                        value={quoteScope}
                        onChange={(e) => setQuoteScope(e.target.value)}
                        placeholder={t.proSpace.quoteScopePlaceholder}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleAiQuoteDraft(m)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-100 text-amber-900 text-xs font-semibold hover:bg-amber-200"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>{t.proSpace.aiQuoteAssist}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSendQuote(m.id)}
                          className="px-4 py-1.5 rounded-lg bg-kazi-green-accessible text-white text-xs font-semibold hover:bg-kazi-green"
                        >
                          {t.proSpace.sendQuote}
                        </button>
                      </div>
                    </div>
                  )}

                  {m.booking?.status === 'CONFIRMED' && (
                    <div className="pt-2 border-t border-slate-200 flex justify-end">
                      <button
                        type="button"
                        onClick={() => handleProBookingTransition(m.booking!.id, 'IN_PROGRESS')}
                        className="px-4 py-1.5 rounded-lg bg-kazi-navy text-white text-xs font-semibold hover:bg-kazi-navy-mid"
                      >
                        {t.proSpace.startExecution}
                      </button>
                    </div>
                  )}

                  {m.booking?.status === 'IN_PROGRESS' && (
                    <div className="pt-2 border-t border-slate-200 flex justify-end">
                      <button
                        type="button"
                        onClick={() => handleProBookingTransition(m.booking!.id, 'AWAITING_CLIENT_VALIDATION')}
                        className="px-4 py-1.5 rounded-lg bg-kazi-green-accessible text-white text-xs font-semibold hover:bg-kazi-green"
                      >
                        {t.proSpace.markDoneForValidation}
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Verification & AI Multilingual Profile Assistant */}
        <div className="lg:col-span-5 space-y-5">
          <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
            <div className="flex items-center gap-2 text-kazi-navy">
              <FileCheck2 className="w-5 h-5" />
              <h2 className="font-display text-base font-bold">{t.proSpace.submitVerification}</h2>
            </div>
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{t.proSpace.verificationPendingNotice}</span>
            </div>

            <form onSubmit={handleSubmitVerification} className="space-y-3">
              <select
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs bg-white"
              >
                <option value="NATIONAL_ID">{t.proSpace.docId}</option>
                <option value="TRADE_DIPLOMA">{t.proSpace.docDiploma}</option>
                <option value="INSURANCE">{t.proSpace.docInsurance}</option>
              </select>
              <input
                type="text"
                value={docName}
                onChange={(e) => setDocName(e.target.value)}
                placeholder={t.proSpace.docRefPlaceholder}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
              />
              <button
                type="submit"
                className="w-full py-2.5 rounded-lg bg-kazi-navy text-white text-xs font-semibold hover:bg-kazi-navy-mid"
              >
                {t.proSpace.submitVerification}
              </button>
            </form>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-3">
            <h2 className="font-display text-base font-bold text-kazi-navy">{t.proSpace.aiBioAssist}</h2>
            <input
              type="text"
              value={trade}
              onChange={(e) => setTrade(e.target.value)}
              placeholder={t.proSpace.tradePlaceholder}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
            />
            <textarea
              rows={2}
              value={rawBio}
              onChange={(e) => setRawBio(e.target.value)}
              placeholder={t.proSpace.bioPlaceholder}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
            />
            <button
              type="button"
              onClick={handleAiBioAssist}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-kazi-orange-bright text-kazi-navy text-xs font-bold hover:bg-kazi-orange hover:text-white transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{t.proSpace.generateAllLangs}</span>
            </button>
            {aiBioResult && (
              <div className="text-xs space-y-1.5 bg-kazi-canvas rounded-lg p-3 border border-slate-200">
                <div><strong>FR:</strong> {aiBioResult.bioFr}</div>
                <div><strong>EN:</strong> {aiBioResult.bioEn}</div>
                {aiBioResult.bioPt && <div><strong>PT:</strong> {aiBioResult.bioPt}</div>}
                <div dir="rtl"><strong>AR:</strong> {aiBioResult.bioAr}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
