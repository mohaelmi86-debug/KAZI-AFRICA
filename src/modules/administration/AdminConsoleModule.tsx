import React, { useEffect, useState, useCallback } from 'react';
import {
  Activity,
  BarChart3,
  CheckCircle2,
  CreditCard,
  Globe,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Users,
  XCircle,
} from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { useAuth } from '../auth/AuthContext';
import { AuthGateCard, BrandLoadingState, StatusLabel } from '../../components/DesignSystem';
import { KaziBrand } from '../../components/KaziBrand';
import { KAZI_BRAND } from '../../config/brand';
import { AfricaInteractiveMap } from '../../components/AfricaInteractiveMap';
import { apiFetch } from '../../services/api';
import { formatLocalCurrency, getLocalizedField } from '../../i18n/translations';

export const AdminConsoleModule: React.FC = () => {
  const { t, lang, countries, reloadCountries } = useApp();
  const { profile, roles, adminCountryIso2s, loading: authLoading } = useAuth();

  const [tab, setTab] = useState<
    'dashboard' | 'countries54' | 'verifications' | 'disputes' | 'users' | 'payments' | 'audit'
  >('dashboard');
  const [countryFilter, setCountryFilter] = useState('ALL');
  const [selectedIso2, setSelectedIso2] = useState('CI');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [overview, setOverview] = useState<any>(null);
  const [usersList, setUsersList] = useState<any[]>([]);
  const [roleGrantCountry, setRoleGrantCountry] = useState('CI');
  const [aiAnalysis, setAiAnalysis] = useState<any>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isAdmin = roles.includes('SUPER_ADMIN') || roles.includes('LOCAL_ADMIN');
  const isSuperAdmin = roles.includes('SUPER_ADMIN');

  const loadOverview = useCallback(async () => {
    if (!profile || !isAdmin) return;
    try {
      const [ov, usr] = await Promise.all([
        apiFetch(`/api/admin/overview?countryIso2=${countryFilter}`),
        apiFetch<{ users: any[] }>('/api/admin/users'),
      ]);
      setOverview(ov);
      setUsersList(usr.users || []);
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  }, [profile, isAdmin, countryFilter]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  if (authLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
        <BrandLoadingState />
      </div>
    );
  }
  if (!profile) return <AuthGateCard />;

  if (!isAdmin) {
    return (
      <div className="max-w-xl mx-auto my-12 px-4">
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center space-y-4">
          <div className="flex justify-center">
            <KaziBrand variant="symbol" theme="light" size="md" />
          </div>
          <ShieldAlert className="w-7 h-7 text-rose-600 mx-auto" />
          <h2 className="font-display text-lg font-bold text-kazi-navy">{t.admin.rbacRestrictedTitle}</h2>
          <p className="text-sm text-slate-600">
            {t.admin.rbacRestrictedDesc}
          </p>
        </div>
      </div>
    );
  }

  const inspectedCountry = countries.find((c) => c.iso2 === selectedIso2) || countries[0];
  const filteredCountries = countries.filter((c) => statusFilter === 'ALL' || c.status === statusFilter);

  const handleToggleChecklist = async (field: string, value: boolean) => {
    if (!inspectedCountry) return;
    setErrorMsg(null);
    try {
      await apiFetch(`/api/countries/${inspectedCountry.iso2}/config`, {
        method: 'PATCH',
        body: JSON.stringify({ checklist: { [field]: value } }),
      });
      await reloadCountries();
      setFeedback(`${t.admin.checklistUpdatedMsg} (${getLocalizedField(lang, inspectedCountry, 'name')} · ${field})`);
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleActivateCountry = async () => {
    if (!inspectedCountry) return;
    setErrorMsg(null);
    try {
      await apiFetch(`/api/countries/${inspectedCountry.iso2}/activate`, { method: 'POST' });
      await reloadCountries();
      setFeedback(`${t.admin.marketActivatedMsg} (${getLocalizedField(lang, inspectedCountry, 'name')} - ${inspectedCountry.iso2})`);
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleSuspendCountry = async () => {
    if (!inspectedCountry) return;
    setErrorMsg(null);
    try {
      await apiFetch(`/api/countries/${inspectedCountry.iso2}/suspend`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Controlled compliance/incident suspension.' }),
      });
      await reloadCountries();
      setFeedback(`${t.admin.marketSuspendedMsg} (${getLocalizedField(lang, inspectedCountry, 'name')})`);
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleReviewVerification = async (id: string, decision: 'APPROVED' | 'REJECTED') => {
    setErrorMsg(null);
    try {
      await apiFetch(`/api/admin/verifications/${id}/review`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      });
      setFeedback(`Vérification ${decision}.`);
      await loadOverview();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleResolveDispute = async (id: string) => {
    setErrorMsg(null);
    try {
      await apiFetch(`/api/admin/disputes/${id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ status: 'RESOLVED_RELEASE', resolutionNote: 'Clôturé après vérification.' }),
      });
      setFeedback(t.admin.disputeResolvedMsg);
      await loadOverview();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleUpdateProviderStatus = async (iso2: string, providerCode: string, status: string) => {
    setErrorMsg(null);
    try {
      await apiFetch(`/api/countries/${iso2}/providers/${providerCode}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await reloadCountries();
      setFeedback(`PSP ${providerCode} (${iso2}) -> ${status}`);
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleToggleUserRole = async (userId: string, role: string, action: 'GRANT' | 'REVOKE') => {
    setErrorMsg(null);
    try {
      await apiFetch(`/api/admin/users/${userId}/roles`, {
        method: 'POST',
        body: JSON.stringify({ role, action, countryIso2: roleGrantCountry }),
      });
      setFeedback(`Rôle ${role} (${action}) mis à jour.`);
      await Promise.all([loadOverview(), reloadCountries()]);
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleToggleSuspendUser = async (userId: string, nextSuspended: boolean) => {
    setErrorMsg(null);
    try {
      await apiFetch(`/api/admin/users/${userId}/suspend`, {
        method: 'PATCH',
        body: JSON.stringify({ isSuspended: nextSuspended }),
      });
      setFeedback(nextSuspended ? t.admin.userSuspendedMsg : t.admin.userReinstatedMsg);
      await loadOverview();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleRefundPayment = async (paymentId: string) => {
    setErrorMsg(null);
    try {
      await apiFetch(`/api/payments/${paymentId}/refund`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Administrative refund' }),
      });
      setFeedback(t.admin.refundIssuedMsg);
      await loadOverview();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleAiAnalyze = async () => {
    setAiLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch('/api/ai/analytics', {
        method: 'POST',
        body: JSON.stringify({
          lang,
          metricsSnapshot: {
            kpis: overview?.kpis,
            activeCountries: countries.filter((c) => c.status === 'ACTIVE').map((c) => c.iso2),
            testingCountries: countries.filter((c) => c.status === 'TESTING').map((c) => c.iso2),
          },
        }),
      });
      setAiAnalysis(res);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setAiLoading(false);
    }
  };

  const chartSeries: Array<{ label: string; missionsCount: number; volumeEur: number }> =
    overview?.monthlySeries || [];
  const maxChartVal = Math.max(1, ...chartSeries.map((pt) => pt.missionsCount));
  const svgPoints = chartSeries
    .map((pt, idx) => {
      const x = 40 + idx * 65;
      const y = Math.round(115 - (pt.missionsCount / maxChartVal) * 80);
      return `${x},${y}`;
    })
    .join(' ');
  const svgPolygon = chartSeries.length
    ? `40,120 ${svgPoints} ${40 + (chartSeries.length - 1) * 65},120`
    : '';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 pb-20">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Admin Dark Sidebar */}
        <aside className="lg:col-span-3 bg-kazi-navy text-white rounded-xl p-4 space-y-2">
          <div className="px-3 py-2.5 border-b border-white/15 mb-2 space-y-2">
            <KaziBrand variant="compact" theme="dark" size="sm" />
            <div className="text-xs font-semibold text-kazi-orange-bright">
              {isSuperAdmin ? t.admin.centralAdminLabel : `${t.admin.localAdminLabel} (${adminCountryIso2s.join(', ')})`}
            </div>
          </div>
          {[
            { key: 'dashboard', label: t.admin.dashboard, icon: BarChart3 },
            { key: 'countries54', label: t.admin.countries54, icon: Globe },
            { key: 'verifications', label: t.admin.verifications, icon: ShieldCheck },
            { key: 'disputes', label: t.admin.disputes, icon: Scale },
            { key: 'users', label: t.admin.usersRoles, icon: Users },
            { key: 'payments', label: t.admin.paymentsFinance, icon: CreditCard },
            { key: 'audit', label: t.admin.auditLogs, icon: Activity },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key as any)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-semibold transition-colors ${
                  tab === item.key ? 'bg-white/15 text-white' : 'text-slate-200 hover:bg-white/10'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </aside>

        {/* Main Admin Content */}
        <div className="lg:col-span-9 space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 p-5 flex flex-wrap items-center justify-between gap-4">
            <h1 className="font-display text-xl font-bold text-kazi-navy">{t.admin.title}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={countryFilter}
                onChange={(e) => setCountryFilter(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs bg-white"
              >
                <option value="ALL">{t.admin.allCountries} (54)</option>
                {countries.filter((c) => c.status === 'ACTIVE' || c.status === 'TESTING').map((c) => (
                  <option key={c.iso2} value={c.iso2}>
                    {getLocalizedField(lang, c, 'name')} ({c.iso2})
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleAiAnalyze}
                disabled={aiLoading}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-kazi-orange-bright text-kazi-navy text-xs font-bold hover:bg-kazi-orange hover:text-white transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{aiLoading ? '...' : t.admin.aiAnalyze}</span>
              </button>
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

          {aiAnalysis && (
            <div className="bg-white rounded-xl border border-amber-200 p-5 space-y-2">
              <div className="font-display text-sm font-bold text-kazi-navy">{t.admin.aiSummaryTitle}</div>
              <p className="text-xs text-slate-700">{aiAnalysis.executiveSummary}</p>
              <p className="text-xs text-amber-800 font-medium">{aiAnalysis.humanReviewNote}</p>
            </div>
          )}

          {/* TAB 1: DASHBOARD */}
          {tab === 'dashboard' && overview && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="text-xs text-slate-500">{t.admin.users}</div>
                  <div className="text-2xl font-extrabold text-kazi-navy mt-1 tabular-nums">
                    {overview.kpis.usersCount}
                  </div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="text-xs text-slate-500">{t.admin.professionals}</div>
                  <div className="text-2xl font-extrabold text-kazi-green-accessible mt-1 tabular-nums">
                    {overview.kpis.professionalsCount}
                  </div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="text-xs text-slate-500">{t.admin.missions}</div>
                  <div className="text-2xl font-extrabold text-kazi-navy mt-1 tabular-nums">
                    {overview.kpis.missionsCount}
                  </div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="text-xs text-slate-500">{t.admin.revenue}</div>
                  <div className="text-2xl font-extrabold text-kazi-orange mt-1 tabular-nums">
                    {formatLocalCurrency(overview.kpis.revenueEur, 'EUR', lang)}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 p-5 space-y-3">
                  <h2 className="font-display text-sm font-bold text-kazi-navy">{t.admin.monthlyEvolution}</h2>
                  <svg viewBox="0 0 420 150" className="w-full h-40">
                    <line x1="30" y1="120" x2="400" y2="120" stroke="#E2E8F0" strokeWidth="1" />
                    <line x1="30" y1="75" x2="400" y2="75" stroke="#F1F5F9" strokeWidth="1" />
                    <line x1="30" y1="30" x2="400" y2="30" stroke="#F1F5F9" strokeWidth="1" />
                    {svgPoints && (
                      <>
                        <polyline fill="none" stroke={KAZI_BRAND.palette.navy} strokeWidth="3" points={svgPoints} />
                        <polygon fill="rgba(2,37,84,0.08)" points={svgPolygon} />
                      </>
                    )}
                    {chartSeries.map((pt, i) => (
                      <g key={pt.label}>
                        <circle
                          cx={40 + i * 65}
                          cy={Math.round(115 - (pt.missionsCount / maxChartVal) * 80)}
                          r="3.5"
                          fill={KAZI_BRAND.palette.orange}
                        />
                        <text x={32 + i * 65} y="138" fontSize="10" fill="#64748B">
                          {pt.label} ({pt.missionsCount})
                        </text>
                      </g>
                    ))}
                  </svg>
                </div>

                <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 p-5 space-y-3">
                  <h2 className="font-display text-sm font-bold text-kazi-navy">
                    {t.admin.verificationQueue} ({overview.kpis.pendingVerifications})
                  </h2>
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between py-2 border-b border-slate-100">
                      <span>{t.admin.pendingVerificationsLabel}</span>
                      <span className="font-bold text-kazi-navy tabular-nums">{overview.kpis.pendingVerifications}</span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b border-slate-100">
                      <span>{t.admin.openDisputesLabel}</span>
                      <span className="font-bold text-rose-600 tabular-nums">{overview.kpis.openDisputes}</span>
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <span>{t.admin.collectedCommissionsLabel}</span>
                      <span className="font-bold text-kazi-green-accessible tabular-nums">
                        {formatLocalCurrency(overview.kpis.commissionsEur, 'EUR', lang)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: 54 COUNTRIES & ACTIVATION ENGINE */}
          {tab === 'countries54' && (
            <div className="space-y-6">
              <AfricaInteractiveMap
                countries={countries}
                selectedIso2={selectedIso2}
                onSelectCountry={setSelectedIso2}
                lang={lang}
              />

              {inspectedCountry && (
                <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
                    <div>
                      <div className="text-xs text-slate-500">
                        {inspectedCountry.iso2} / {inspectedCountry.iso3} · {inspectedCountry.region} · {inspectedCountry.timezone}
                      </div>
                      <h2 className="font-display text-lg font-bold text-kazi-navy">
                        {getLocalizedField(lang, inspectedCountry, 'name')} — {inspectedCountry.defaultCurrency}
                      </h2>
                    </div>
                    <StatusLabel status={inspectedCountry.status} />
                  </div>

                  {/* 7-point activation checklist */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    {[
                      { key: 'configComplete', label: t.admin.checklistConfig },
                      { key: 'complianceVerified', label: t.admin.checklistCompliance },
                      { key: 'paymentsConfigured', label: t.admin.checklistPayments },
                      { key: 'localLeadAssigned', label: t.admin.checklistLead },
                      { key: 'securityTestsPassed', label: t.admin.checklistSecurity },
                      { key: 'functionalTestsPassed', label: t.admin.checklistFunctional },
                      { key: 'activationAuthorized', label: t.admin.checklistAuth },
                    ].map((item) => {
                      const checked = Boolean((inspectedCountry.deployment as any)?.[item.key]);
                      return (
                        <label
                          key={item.key}
                          className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-kazi-canvas px-3 py-2.5 cursor-pointer"
                        >
                          <span className="font-medium text-slate-800">{item.label}</span>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={item.key === 'activationAuthorized' && !isSuperAdmin}
                            onChange={(e) => handleToggleChecklist(item.key, e.target.checked)}
                            className="w-4 h-4 accent-kazi-green"
                          />
                        </label>
                      );
                    })}
                  </div>

                  {/* Payment providers honest state + Super Admin config */}
                  <div className="space-y-2">
                    <h3 className="text-xs font-bold text-kazi-navy">{t.admin.pspRealStateTitle}</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      {inspectedCountry.paymentProviders.map((psp) => (
                        <div key={psp.id} className="rounded-lg border border-slate-200 p-3 flex items-start justify-between gap-2">
                          <div>
                            <div className="font-semibold text-slate-900">{psp.providerLabel}</div>
                            <div className="text-slate-500">{psp.verificationNote}</div>
                          </div>
                          {isSuperAdmin ? (
                            <select
                              value={psp.status}
                              onChange={(e) => handleUpdateProviderStatus(inspectedCountry.iso2, psp.providerCode, e.target.value)}
                              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold"
                            >
                              <option value="UNVERIFIED">UNVERIFIED</option>
                              <option value="SANDBOX">SANDBOX</option>
                              <option value="VERIFIED_ACTIVE">VERIFIED_ACTIVE</option>
                              <option value="DISABLED">DISABLED</option>
                            </select>
                          ) : (
                            <StatusLabel status={psp.status} />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Super Admin Activation / Suspension Controls */}
                  {isSuperAdmin && (
                    <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-200">
                      <button
                        type="button"
                        onClick={handleActivateCountry}
                        disabled={!inspectedCountry.readiness.canActivate}
                        className="px-4 py-2 rounded-lg bg-kazi-green-accessible text-white text-xs font-semibold hover:bg-kazi-green disabled:opacity-40"
                      >
                        {t.admin.activateMarket}
                      </button>
                      <button
                        type="button"
                        onClick={handleSuspendCountry}
                        className="px-4 py-2 rounded-lg border border-rose-300 text-rose-700 text-xs font-semibold hover:bg-rose-50"
                      >
                        {t.admin.suspendMarket}
                      </button>
                      {!inspectedCountry.readiness.canActivate && (
                        <span className="text-xs text-slate-500">
                          {t.admin.missingCriteriaPrefix} {inspectedCountry.readiness.missingCriteria.join(', ')}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 54-country filterable matrix */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-display text-sm font-bold text-kazi-navy">
                    {t.admin.fullReferentialPrefix} ({filteredCountries.length}/54)
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {['ALL', 'ACTIVE', 'TESTING', 'CONFIGURING', 'PLANNED', 'SUSPENDED'].map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => setStatusFilter(st)}
                        className={`px-2.5 py-1 rounded-md text-xs font-semibold ${
                          statusFilter === st ? 'bg-kazi-navy text-white' : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {st === 'ALL' ? t.admin.allStatusFilter : t.statuses[st] || st}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 text-xs">
                  {filteredCountries.map((c) => (
                    <div
                      key={c.iso2}
                      onClick={() => setSelectedIso2(c.iso2)}
                      className="py-2.5 px-2 flex items-center justify-between gap-3 hover:bg-slate-50 cursor-pointer"
                    >
                      <div className="font-medium text-slate-900">
                        <span className="font-mono text-kazi-navy me-2">{c.iso2}</span>
                        {getLocalizedField(lang, c, 'name')}
                      </div>
                      <div className="flex items-center gap-4 tabular-nums">
                        <span className="text-slate-500">{c.defaultCurrency}</span>
                        <span className="text-slate-500">{c.commissionRatePct}%</span>
                        <StatusLabel status={c.status} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: VERIFICATIONS */}
          {tab === 'verifications' && overview && (
            <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
              <h2 className="font-display text-base font-bold text-kazi-navy">{t.admin.verificationQueue}</h2>
              <div className="divide-y divide-slate-100">
                {overview.verifications.map((v: any) => (
                  <div key={v.id} className="py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div>
                      <div className="font-semibold text-slate-900">
                        {v.professionalName} ({v.countryIso2})
                      </div>
                      <div className="text-slate-500">
                        {v.docType} · {v.documentName}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusLabel status={v.status} />
                      {v.status === 'PENDING' && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleReviewVerification(v.id, 'APPROVED')}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-kazi-green-accessible text-white font-semibold hover:bg-kazi-green"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>{t.admin.approve}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReviewVerification(v.id, 'REJECTED')}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-rose-300 text-rose-700 font-semibold"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            <span>{t.admin.reject}</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 4: DISPUTES */}
          {tab === 'disputes' && overview && (
            <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
              <h2 className="font-display text-base font-bold text-kazi-navy">{t.admin.disputes}</h2>
              <div className="divide-y divide-slate-100">
                {overview.disputes.map((d: any) => (
                  <div key={d.id} className="py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div>
                      <div className="font-semibold text-slate-900">
                        {d.missionRef} ({d.countryIso2})
                      </div>
                      <div className="text-slate-600">{d.reason}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusLabel status={d.status} />
                      {d.status === 'OPEN' && (
                        <button
                          type="button"
                          onClick={() => handleResolveDispute(d.id)}
                          className="px-3 py-1.5 rounded-lg bg-kazi-navy text-white font-semibold hover:bg-kazi-navy-mid"
                        >
                          {t.admin.resolve}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 5: USERS & RBAC */}
          {tab === 'users' && (
            <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-display text-base font-bold text-kazi-navy">{t.admin.usersRoles}</h2>
                {isSuperAdmin && (
                  <select
                    value={roleGrantCountry}
                    onChange={(e) => setRoleGrantCountry(e.target.value)}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs bg-white"
                  >
                    {countries.map((c) => (
                      <option key={c.iso2} value={c.iso2}>
                        LOCAL_ADMIN → {getLocalizedField(lang, c, 'name')} ({c.iso2})
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="divide-y divide-slate-100 text-xs">
                {usersList.map((u) => (
                  <div key={u.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold text-slate-900">
                        {u.fullName} · <span className="font-mono text-slate-500">{u.countryIso2}</span>
                      </div>
                      <div className="text-slate-500">
                        {u.email} · {t.admin.rolesLabel} {(u.roles || []).join(', ')}
                        {u.adminCountries?.length > 0 ? ` [Admin: ${u.adminCountries.join(', ')}]` : ''}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {isSuperAdmin && (
                        <>
                          {u.roles?.includes('LOCAL_ADMIN') ? (
                            <button
                              type="button"
                              onClick={() => handleToggleUserRole(u.id, 'LOCAL_ADMIN', 'REVOKE')}
                              className="px-2.5 py-1 rounded border border-slate-300 text-slate-700 font-semibold"
                            >
                              {t.admin.revokeRole} LOCAL_ADMIN
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleToggleUserRole(u.id, 'LOCAL_ADMIN', 'GRANT')}
                              className="px-2.5 py-1 rounded bg-kazi-navy text-white font-semibold hover:bg-kazi-navy-mid"
                            >
                              {t.admin.grantRole} LOCAL_ADMIN
                            </button>
                          )}
                        </>
                      )}
                      {u.id !== profile.id && !u.roles?.includes('SUPER_ADMIN') && (
                        <button
                          type="button"
                          onClick={() => handleToggleSuspendUser(u.id, !u.isSuspended)}
                          className={`px-2.5 py-1 rounded font-semibold ${
                            u.isSuspended
                              ? 'bg-kazi-green-accessible text-white hover:bg-kazi-green'
                              : 'border border-rose-300 text-rose-700 hover:bg-rose-50'
                          }`}
                        >
                          {u.isSuspended ? t.admin.reinstateUser : t.admin.suspendUser}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 6: PAYMENTS & REFUNDS */}
          {tab === 'payments' && overview && (
            <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4 overflow-x-auto">
              <h2 className="font-display text-base font-bold text-kazi-navy">{t.admin.paymentsFinance}</h2>
              <table className="w-full text-start text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 pe-3 font-semibold">{t.admin.colBooking}</th>
                    <th className="py-2 pe-3 font-semibold">{t.admin.colCountry}</th>
                    <th className="py-2 pe-3 font-semibold">{t.admin.colGross}</th>
                    <th className="py-2 pe-3 font-semibold">{t.admin.colCommission}</th>
                    <th className="py-2 pe-3 font-semibold">{t.admin.colNetPro}</th>
                    <th className="py-2 pe-3 font-semibold">{t.admin.colStatus}</th>
                    <th className="py-2 text-end font-semibold">{t.admin.colAction}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {(overview.payments || []).map((p: any) => (
                    <tr key={p.id}>
                      <td className="py-2.5 pe-3 font-mono font-semibold text-kazi-navy">{p.bookingNumber}</td>
                      <td className="py-2.5 pe-3">{p.countryIso2}</td>
                      <td className="py-2.5 pe-3">{formatLocalCurrency(p.amountGross, p.currency, lang)}</td>
                      <td className="py-2.5 pe-3 text-kazi-green-accessible font-semibold">
                        {formatLocalCurrency(p.commissionAmount, p.currency, lang)}
                      </td>
                      <td className="py-2.5 pe-3">{formatLocalCurrency(p.netToProfessional, p.currency, lang)}</td>
                      <td className="py-2.5 pe-3">
                        <StatusLabel status={p.status} />
                      </td>
                      <td className="py-2.5 text-end">
                        {p.status === 'CONFIRMED_SERVER' && (
                          <button
                            type="button"
                            onClick={() => handleRefundPayment(p.id)}
                            className="px-2.5 py-1 rounded border border-rose-300 text-rose-700 font-semibold hover:bg-rose-50"
                          >
                            {t.admin.refundPayment}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 7: AUDIT LOGS */}
          {tab === 'audit' && overview && (
            <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
              <h2 className="font-display text-base font-bold text-kazi-navy">{t.admin.auditLogs}</h2>
              <div className="divide-y divide-slate-100 text-xs font-mono">
                {overview.auditLogs.map((log: any) => (
                  <div key={log.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-bold text-kazi-navy">{log.action}</span>
                      <span className="text-slate-500 ms-2">
                        {log.entityType} · {log.actorRole} {log.countryIso2 ? `(${log.countryIso2})` : ''}
                      </span>
                    </div>
                    <span className="text-slate-400 tabular-nums">
                      {new Date(log.createdAt).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
