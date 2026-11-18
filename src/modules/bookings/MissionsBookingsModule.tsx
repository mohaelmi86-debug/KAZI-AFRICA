import React, { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  CreditCard,
  MessageSquare,
  Printer,
  Send,
  Star,
  X,
} from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { useAuth } from '../auth/AuthContext';
import { AuthGateCard, BrandEmptyState, BrandLoadingState, StatusLabel } from '../../components/DesignSystem';
import { KaziBrand } from '../../components/KaziBrand';
import { KAZI_BRAND } from '../../config/brand';
import { apiFetch } from '../../services/api';
import { formatLocalCurrency, getLocalizedField } from '../../i18n/translations';
import type { MissionRecord } from '../../types/kazi';

export const MissionsBookingsModule: React.FC = () => {
  const [searchParams] = useSearchParams();
  const { t, lang, selectedCountryIso2, selectedCountry, countries, categories } = useApp();
  const { profile, loading: authLoading } = useAuth();

  const [missions, setMissions] = useState<MissionRecord[]>([]);
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null);
  const [messagesList, setMessagesList] = useState<any[]>([]);
  const [msgDraft, setMsgDraft] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showReceiptModal, setShowReceiptModal] = useState(false);

  // New mission form
  const [categorySlug, setCategorySlug] = useState('electricity');
  const [description, setDescription] = useState('');
  const [address, setAddress] = useState('Cocody, Abidjan');
  const [desiredDate, setDesiredDate] = useState('2026-11-20');
  const [timeSlot, setTimeSlot] = useState('14:00 - 16:00');
  const [selectedProviderCode, setSelectedProviderCode] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Review state
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');

  const loadData = useCallback(async () => {
    if (!profile) return;
    try {
      const [mRes, msgRes] = await Promise.all([
        apiFetch<{ missions: MissionRecord[] }>('/api/missions'),
        apiFetch<{ messages: any[] }>('/api/messages'),
      ]);
      const list = mRes.missions || [];
      setMissions(list);
      if (!selectedMissionId && list[0]) {
        setSelectedMissionId(list[0].id);
      }
      setMessagesList(msgRes.messages || []);
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  }, [profile, selectedMissionId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (authLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
        <BrandLoadingState />
      </div>
    );
  }
  if (!profile) {
    return <AuthGateCard />;
  }

  const handleCreateMission = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    setFeedback(null);
    try {
      const res = await apiFetch('/api/missions', {
        method: 'POST',
        body: JSON.stringify({
          countryIso2: selectedCountryIso2,
          categorySlug,
          targetProfessionalId: searchParams.get('proId') || null,
          title: description.slice(0, 60),
          description,
          address,
          city: selectedCountry?.capital || 'Abidjan',
          desiredDate,
          timeSlot,
        }),
      });
      setDescription('');
      setFeedback(`${t.booking.missionRecordedPrefix} ${res.mission.referenceCode}`);
      await loadData();
      setSelectedMissionId(res.mission.id);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAcceptQuote = async (quoteId: string) => {
    setErrorMsg(null);
    try {
      await apiFetch(`/api/quotes/${quoteId}/accept`, { method: 'POST' });
      setFeedback(t.booking.quoteAcceptedMsg);
      await loadData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleBookingTransition = async (bookingId: string, toStatus: string) => {
    setErrorMsg(null);
    try {
      await apiFetch(`/api/bookings/${bookingId}/transition`, {
        method: 'POST',
        body: JSON.stringify({ toStatus }),
      });
      setFeedback(`${t.booking.statusUpdatedPrefix} ${t.statuses[toStatus] || toStatus}`);
      await loadData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handlePaySandbox = async (bookingId: string, providerCode: string) => {
    setErrorMsg(null);
    if (!providerCode) {
      setErrorMsg(t.booking.noEligibleProvider);
      return;
    }
    try {
      const initRes = await apiFetch('/api/payments/initiate', {
        method: 'POST',
        body: JSON.stringify({
          bookingId,
          providerCode,
          idempotencyKey: `kazi-pay-${bookingId}-${Date.now()}`,
        }),
      });
      if (initRes.providerMode === 'SANDBOX') {
        await apiFetch(`/api/payments/${initRes.payment.id}/sandbox-confirm`, {
          method: 'POST',
        });
        setFeedback(t.booking.sandboxConfirmedMsg);
      } else {
        setFeedback(t.booking.webhookPendingMsg);
      }
      await loadData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMissionId || !msgDraft.trim()) return;
    try {
      await apiFetch('/api/messages', {
        method: 'POST',
        body: JSON.stringify({ missionId: selectedMissionId, content: msgDraft }),
      });
      setMsgDraft('');
      await loadData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleReview = async (bookingId: string) => {
    try {
      await apiFetch('/api/reviews', {
        method: 'POST',
        body: JSON.stringify({ bookingId, rating: reviewRating, comment: reviewComment }),
      });
      setReviewComment('');
      setFeedback(t.booking.reviewPublishedMsg);
      await loadData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleOpenDispute = async (missionId: string) => {
    try {
      await apiFetch('/api/disputes', {
        method: 'POST',
        body: JSON.stringify({
          missionId,
          reason: t.booking.disputeDefaultReason,
        }),
      });
      setFeedback(t.booking.disputeOpenedMsg);
      await loadData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const selectedMission = missions.find((m) => m.id === selectedMissionId) || missions[0] || null;
  const missionCountry = selectedMission
    ? countries.find((c) => c.iso2 === selectedMission.countryIso2) || selectedCountry
    : selectedCountry;
  const eligibleProviders = (missionCountry?.paymentProviders || []).filter(
    (p) => p.status === 'SANDBOX' || p.status === 'VERIFIED_ACTIVE'
  );
  const activeProviderCode =
    eligibleProviders.find((p) => p.providerCode === selectedProviderCode)?.providerCode ||
    eligibleProviders[0]?.providerCode ||
    '';

  const missionMsgs = selectedMission
    ? messagesList.filter((m) => m.missionId === selectedMission.id)
    : [];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 pb-20 space-y-6">
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

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT: STEP 1 BOOKING FORM */}
        <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 p-6 space-y-5 no-print">
          <div className="space-y-2">
            <div className="flex items-center gap-2.5">
              <KaziBrand variant="symbol" theme="light" size="sm" />
              <h1 className="font-display text-xl font-bold text-kazi-navy">{t.booking.title}</h1>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
              <span className="font-semibold text-kazi-navy">1. {t.booking.stepDetails}</span>
              <span>→</span>
              <span>2. {t.booking.stepQuote}</span>
              <span>→</span>
              <span>3. {t.booking.stepConfirm}</span>
            </div>
          </div>

          <form onSubmit={handleCreateMission} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">{t.booking.categoryLabel}</label>
              <select
                value={categorySlug}
                onChange={(e) => setCategorySlug(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm bg-white"
              >
                {categories.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {getLocalizedField(lang, c, 'name')}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {t.booking.describeProblem} *
              </label>
              <textarea
                rows={3}
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t.booking.problemPlaceholder}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {t.booking.address} *
              </label>
              <input
                type="text"
                required
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {t.booking.desiredDate}
                </label>
                <input
                  type="date"
                  value={desiredDate}
                  onChange={(e) => setDesiredDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {t.booking.timeSlot}
                </label>
                <select
                  value={timeSlot}
                  onChange={(e) => setTimeSlot(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm bg-white"
                >
                  <option value="09:00 - 11:00">09:00 - 11:00</option>
                  <option value="14:00 - 16:00">14:00 - 16:00</option>
                  <option value="16:30 - 18:30">16:30 - 18:30</option>
                </select>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 rounded-lg bg-kazi-orange-bright text-kazi-navy font-bold text-sm hover:bg-kazi-orange hover:text-white transition-colors"
            >
              {submitting ? '...' : t.booking.getQuote}
            </button>
          </form>
        </div>

        {/* RIGHT: BOOKING TRACKER & QUOTES & PAYMENTS */}
        <div className="lg:col-span-7 space-y-5">
          <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-lg font-bold text-kazi-navy">{t.booking.myBookings}</h2>
              {missions.length > 0 && (
                <select
                  value={selectedMission?.id || ''}
                  onChange={(e) => setSelectedMissionId(e.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium bg-white"
                >
                  {missions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.referenceCode} — {m.title.slice(0, 32)}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {selectedMission ? (
              <div className="space-y-5 pt-2">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
                  <div>
                    <div className="text-xs font-mono text-slate-500">N° {selectedMission.referenceCode}</div>
                    <div className="text-base font-bold text-slate-900">{selectedMission.title}</div>
                    <div className="text-xs text-slate-500">
                      {selectedMission.address} · {selectedMission.desiredDate} ({selectedMission.timeSlot})
                    </div>
                  </div>
                  <StatusLabel status={selectedMission.booking?.status || selectedMission.status} />
                </div>

                {/* Timeline */}
                <div className="space-y-3 text-sm">
                  <div className="flex items-center gap-3 text-slate-800">
                    <CheckCircle2 className="w-5 h-5 text-kazi-green-accessible shrink-0" />
                    <span>{t.booking.statusSent}</span>
                  </div>
                  <div className="flex items-center gap-3 text-slate-800">
                    {selectedMission.quotes.length > 0 ? (
                      <CheckCircle2 className="w-5 h-5 text-kazi-green-accessible shrink-0" />
                    ) : (
                      <Clock className="w-5 h-5 text-slate-300 shrink-0" />
                    )}
                    <span>{t.booking.statusQuoted}</span>
                  </div>
                  <div className="flex items-center gap-3 text-slate-800">
                    {['IN_PROGRESS', 'AWAITING_CLIENT_VALIDATION', 'COMPLETED'].includes(
                      selectedMission.booking?.status || ''
                    ) ? (
                      <CheckCircle2 className="w-5 h-5 text-kazi-green-accessible shrink-0" />
                    ) : (
                      <Clock className="w-5 h-5 text-slate-300 shrink-0" />
                    )}
                    <span>{t.booking.statusInProgress}</span>
                  </div>
                  <div className="flex items-center gap-3 text-slate-800">
                    {selectedMission.booking?.status === 'COMPLETED' ? (
                      <CheckCircle2 className="w-5 h-5 text-kazi-green-accessible shrink-0" />
                    ) : (
                      <Clock className="w-5 h-5 text-slate-300 shrink-0" />
                    )}
                    <span>{t.booking.statusCompleted}</span>
                  </div>
                </div>

                {/* Quotes List */}
                {selectedMission.quotes.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-slate-100">
                    <h3 className="text-xs font-bold text-kazi-navy">{t.booking.receivedQuotes}</h3>
                    {selectedMission.quotes.map((q) => (
                      <div
                        key={q.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-kazi-canvas p-3"
                      >
                        <div className="space-y-0.5">
                          <div className="text-sm font-bold text-slate-900 tabular-nums">
                            {formatLocalCurrency(q.amount, q.currency, lang)} · {q.estimatedDuration}
                          </div>
                          <div className="text-xs text-slate-600">{q.scopeDetails}</div>
                        </div>
                        {q.status === 'PENDING' ? (
                          <button
                            type="button"
                            onClick={() => handleAcceptQuote(q.id)}
                            className="px-4 py-2 rounded-lg bg-kazi-green-accessible text-white text-xs font-semibold hover:bg-kazi-green"
                          >
                            {t.booking.acceptAndBook}
                          </button>
                        ) : (
                          <StatusLabel status={q.status} />
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Booking Actions & Payment */}
                {selectedMission.booking && (
                  <div className="pt-3 border-t border-slate-100 space-y-3">
                    <div className="flex flex-wrap items-center gap-2 no-print">
                      {selectedMission.booking.status === 'AWAITING_CLIENT_VALIDATION' && (
                        <button
                          type="button"
                          onClick={() => handleBookingTransition(selectedMission.booking!.id, 'COMPLETED')}
                          className="px-4 py-2 rounded-lg bg-kazi-green-accessible text-white text-xs font-semibold hover:bg-kazi-green"
                        >
                          {t.booking.validateCompletion}
                        </button>
                      )}

                      {!selectedMission.payment && eligibleProviders.length > 0 && (
                        <>
                          <select
                            aria-label={t.booking.paymentProviderLabel}
                            value={activeProviderCode}
                            onChange={(e) => setSelectedProviderCode(e.target.value)}
                            className="rounded-lg border border-slate-300 px-3 py-2 text-xs bg-white"
                          >
                            {eligibleProviders.map((psp) => (
                              <option key={psp.id} value={psp.providerCode}>
                                {psp.providerLabel} ({psp.status})
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => handlePaySandbox(selectedMission.booking!.id, activeProviderCode)}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-kazi-orange-bright text-kazi-navy text-xs font-bold hover:bg-kazi-orange hover:text-white transition-colors"
                          >
                            <CreditCard className="w-3.5 h-3.5" />
                            <span>{t.booking.paySandbox}</span>
                          </button>
                        </>
                      )}

                      {!selectedMission.payment && eligibleProviders.length === 0 && (
                        <span className="text-xs text-amber-800 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg">
                          {t.booking.noEligibleProvider}
                        </span>
                      )}

                      <button
                        type="button"
                        onClick={() => handleOpenDispute(selectedMission.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-rose-200 text-rose-700 text-xs font-semibold hover:bg-rose-50"
                      >
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>{t.booking.openDispute}</span>
                      </button>
                    </div>

                    {selectedMission.payment && (
                      <div className="rounded-lg border border-slate-200 bg-kazi-canvas p-3 text-xs space-y-2 tabular-nums">
                        <div className="flex flex-wrap items-center justify-between gap-2 font-semibold text-kazi-navy">
                          <span>{t.booking.paymentLabel} ({selectedMission.payment.providerCode})</span>
                          <div className="flex items-center gap-3">
                            <StatusLabel status={selectedMission.payment.status} />
                            <button
                              type="button"
                              onClick={() => setShowReceiptModal(true)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 bg-white text-kazi-navy hover:bg-slate-50 no-print"
                            >
                              <Printer className="w-3.5 h-3.5" />
                              <span>{t.booking.officialReceiptBtn}</span>
                            </button>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 text-slate-600">
                          <span>
                            {t.booking.grossAmount} :{' '}
                            {formatLocalCurrency(
                              selectedMission.payment.amountGross,
                              selectedMission.payment.currency,
                              lang
                            )}
                          </span>
                          <span>
                            {t.booking.platformCommission} :{' '}
                            {formatLocalCurrency(
                              selectedMission.payment.commissionAmount,
                              selectedMission.payment.currency,
                              lang
                            )}
                          </span>
                          <span>
                            {t.booking.netToPro} :{' '}
                            {formatLocalCurrency(
                              selectedMission.payment.netToProfessional,
                              selectedMission.payment.currency,
                              lang
                            )}
                          </span>
                        </div>
                      </div>
                    )}

                    {selectedMission.booking.status === 'COMPLETED' && (
                      <div className="pt-2 space-y-2 no-print">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-slate-700">{t.booking.ratingLabel}</span>
                          {[1, 2, 3, 4, 5].map((n) => (
                            <button key={n} type="button" onClick={() => setReviewRating(n)}>
                              <Star
                                className={`w-4 h-4 ${
                                  n <= reviewRating
                                    ? 'text-kazi-orange-bright fill-kazi-orange-bright'
                                    : 'text-slate-300'
                                }`}
                              />
                            </button>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={reviewComment}
                            onChange={(e) => setReviewComment(e.target.value)}
                            placeholder={t.booking.reviewPlaceholder}
                            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => handleReview(selectedMission.booking!.id)}
                            className="px-4 py-2 rounded-lg bg-kazi-navy text-white text-xs font-semibold hover:bg-kazi-navy-mid"
                          >
                            {t.booking.leaveReview}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Messaging */}
                <div className="pt-4 border-t border-slate-100 space-y-3 no-print">
                  <h3 className="inline-flex items-center gap-2 text-xs font-bold text-kazi-navy">
                    <MessageSquare className="w-4 h-4" />
                    <span>{t.booking.messagesTitle}</span>
                  </h3>
                  <div className="max-h-40 overflow-y-auto space-y-2 bg-kazi-canvas rounded-lg p-3">
                    {missionMsgs.length === 0 ? (
                      <p className="text-xs text-slate-400">{t.booking.noMessages}</p>
                    ) : (
                      missionMsgs.map((msg) => (
                        <div key={msg.id} className="text-xs">
                          <span className="font-semibold text-kazi-navy">{msg.senderName}: </span>
                          <span className="text-slate-700">{msg.content}</span>
                        </div>
                      ))
                    )}
                  </div>
                  <form onSubmit={handleSendMessage} className="flex gap-2">
                    <input
                      type="text"
                      value={msgDraft}
                      onChange={(e) => setMsgDraft(e.target.value)}
                      placeholder={t.booking.writeMessage}
                      className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs"
                    />
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-kazi-navy text-white text-xs font-semibold hover:bg-kazi-navy-mid"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>{t.booking.sendMessage}</span>
                    </button>
                  </form>
                </div>
              </div>
            ) : (
              <BrandEmptyState title={t.booking.noMissions} />
            )}
          </div>
        </div>
      </div>

      {/* Printable Official Receipt Modal */}
      {showReceiptModal && selectedMission?.payment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white border border-slate-200 p-6 space-y-5 shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
              <KaziBrand variant="full" theme="light" size="md" />
              <button
                type="button"
                onClick={() => setShowReceiptModal(false)}
                aria-label={t.common.close}
                className="p-1 text-slate-400 hover:text-slate-700 no-print"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-display text-sm font-bold text-kazi-navy">{t.booking.officialReceiptTitle}</span>
                <span className="font-mono text-slate-500">N° {selectedMission.referenceCode}</span>
              </div>
              <div className="rounded-lg bg-kazi-canvas border border-slate-200 p-4 space-y-2 tabular-nums">
                <div className="flex justify-between">
                  <span className="text-slate-500">{t.booking.missionLabel}</span>
                  <span className="font-semibold text-slate-900">{selectedMission.title}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">{t.booking.marketCountryLabel}</span>
                  <span className="font-semibold text-slate-900">{selectedMission.countryIso2}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">{t.booking.pspLabel}</span>
                  <span className="font-semibold text-slate-900">{selectedMission.payment.providerCode}</span>
                </div>
                <div className="flex justify-between border-t border-slate-200 pt-2">
                  <span className="text-slate-500">{t.booking.grossAmount}</span>
                  <span className="font-bold text-kazi-navy">
                    {formatLocalCurrency(selectedMission.payment.amountGross, selectedMission.payment.currency, lang)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">{t.booking.platformCommission}</span>
                  <span>
                    {formatLocalCurrency(selectedMission.payment.commissionAmount, selectedMission.payment.currency, lang)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">{t.booking.netToPro}</span>
                  <span className="font-semibold text-kazi-green-accessible">
                    {formatLocalCurrency(selectedMission.payment.netToProfessional, selectedMission.payment.currency, lang)}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-[11px] text-slate-500">
                <span>{KAZI_BRAND.tagline}</span>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-kazi-navy text-white text-xs font-semibold hover:bg-kazi-navy-mid no-print"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>{t.common.print}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
