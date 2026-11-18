import React, { useEffect, useState, useCallback } from 'react';
import { Building2, ClipboardList, FileText, MapPin, Plus, Printer, Users } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { useAuth } from '../auth/AuthContext';
import { AuthGateCard, BrandLoadingState, StatusLabel } from '../../components/DesignSystem';
import { KaziBrand } from '../../components/KaziBrand';
import { apiFetch } from '../../services/api';
import { formatLocalCurrency, getLocalizedField } from '../../i18n/translations';

export const EnterpriseModule: React.FC = () => {
  const { t, lang, selectedCountryIso2, selectedCountry, categories } = useApp();
  const { profile, loading: authLoading } = useAuth();

  const [org, setOrg] = useState<any>(null);
  const [orgCountry, setOrgCountry] = useState<any>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [interventions, setInterventions] = useState<any[]>([]);
  const [countryPros, setCountryPros] = useState<any[]>([]);
  const [activeNav, setActiveNav] = useState<'dashboard' | 'interventions' | 'team' | 'billing'>('dashboard');

  const [showNewIntervention, setShowNewIntervention] = useState(false);
  const [intTitle, setIntTitle] = useState('');
  const [intAddress, setIntAddress] = useState('');
  const [intCategory, setIntCategory] = useState('electricity');
  const [intBudget, setIntBudget] = useState('450');

  const [memberEmail, setMemberEmail] = useState('');
  const [memberRole, setMemberRole] = useState('TECHNICIAN');
  const [memberSite, setMemberSite] = useState('');

  const [orgName, setOrgName] = useState('');
  const [orgSector, setOrgSector] = useState('BTP & Maintenance');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadEnterprise = useCallback(async () => {
    if (!profile) return;
    try {
      const data = await apiFetch('/api/enterprise/overview');
      setOrg(data.organization);
      setOrgCountry(data.country || null);
      setMembers(data.members || []);
      setInterventions(data.interventions || []);
      const iso = data.country?.iso2 || selectedCountryIso2;
      if (iso) {
        const prosRes = await apiFetch<{ professionals: any[] }>(`/api/professionals?countryIso2=${iso}`);
        setCountryPros(prosRes.professionals || []);
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  }, [profile, selectedCountryIso2]);

  useEffect(() => {
    loadEnterprise();
  }, [loadEnterprise]);

  if (authLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
        <BrandLoadingState />
      </div>
    );
  }
  if (!profile) return <AuthGateCard />;

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    try {
      await apiFetch('/api/enterprise/organizations', {
        method: 'POST',
        body: JSON.stringify({ name: orgName, sector: orgSector, countryIso2: selectedCountryIso2 }),
      });
      setFeedback(t.enterprise.orgCreatedMsg);
      await loadEnterprise();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleCreateIntervention = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!org) return;
    setErrorMsg(null);
    const targetIso2 = orgCountry?.iso2 || selectedCountryIso2;
    const targetCity = orgCountry?.capital || selectedCountry?.capital || 'Abidjan';
    try {
      await apiFetch('/api/missions', {
        method: 'POST',
        body: JSON.stringify({
          countryIso2: targetIso2,
          organizationId: org.id,
          categorySlug: intCategory,
          title: intTitle,
          description: intTitle,
          address: intAddress || targetCity,
          city: targetCity,
          desiredDate: '2026-11-24',
          timeSlot: '09:00 - 12:00',
          estimatedBudget: Number(intBudget),
        }),
      });
      setIntTitle('');
      setShowNewIntervention(false);
      setFeedback(t.enterprise.interventionCreatedMsg);
      await loadEnterprise();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!org || !memberEmail) return;
    setErrorMsg(null);
    try {
      await apiFetch('/api/enterprise/members', {
        method: 'POST',
        body: JSON.stringify({
          organizationId: org.id,
          email: memberEmail,
          memberRole,
          siteLocation: memberSite || orgCountry?.capital || 'Siège',
        }),
      });
      setMemberEmail('');
      setMemberSite('');
      setFeedback(t.enterprise.memberAddedMsg);
      await loadEnterprise();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleAssignTech = async (missionId: string, professionalId: string) => {
    if (!professionalId) return;
    setErrorMsg(null);
    try {
      await apiFetch(`/api/enterprise/interventions/${missionId}/assign`, {
        method: 'POST',
        body: JSON.stringify({ professionalId }),
      });
      setFeedback(t.enterprise.techAssignedMsg);
      await loadEnterprise();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  if (!org) {
    return (
      <div className="max-w-xl mx-auto px-4 py-10">
        <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <KaziBrand variant="compact" theme="light" size="sm" />
            <span className="text-xs font-semibold text-kazi-orange">{t.enterprise.b2bBadge}</span>
          </div>
          <h1 className="font-display text-xl font-bold text-kazi-navy">{t.enterprise.createOrg}</h1>
          <p className="text-sm text-slate-600">
            {t.enterprise.createOrgSubtitle}
          </p>
          {errorMsg && <p className="text-xs text-rose-600">{errorMsg}</p>}
          <form onSubmit={handleCreateOrg} className="space-y-3">
            <input
              type="text"
              required
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder={t.enterprise.orgNamePlaceholder}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
            />
            <input
              type="text"
              required
              value={orgSector}
              onChange={(e) => setOrgSector(e.target.value)}
              placeholder={t.enterprise.orgSectorPlaceholder}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
            />
            <button
              type="submit"
              className="w-full py-2.5 rounded-lg bg-kazi-navy text-white text-sm font-semibold hover:bg-kazi-navy-mid"
            >
              {t.enterprise.createOrg}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const orgCurrency = orgCountry?.defaultCurrency || org.billingCurrency || 'EUR';
  const totalCost = interventions.reduce((sum, i) => sum + Number(i.estimatedBudget || 0), 0);
  const completedCount = interventions.filter((i) => i.status === 'COMPLETED').length;
  const completionRatePct =
    interventions.length > 0 ? Math.round((completedCount / interventions.length) * 100) : 0;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 pb-20">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Enterprise Dark Sidebar */}
        <aside className="lg:col-span-3 bg-kazi-navy text-white rounded-xl p-4 space-y-2 no-print">
          <div className="px-3 py-2.5 border-b border-white/15 mb-2 space-y-2">
            <KaziBrand variant="compact" theme="dark" size="sm" />
            <div>
              <div className="text-[11px] font-semibold text-kazi-orange-bright">
                B2B · {orgCountry?.iso2 || selectedCountryIso2}
              </div>
              <div className="font-display text-base font-bold truncate">{org.name}</div>
            </div>
          </div>
          {[
            { key: 'dashboard', label: t.enterprise.dashboardTab, icon: Building2 },
            { key: 'interventions', label: t.enterprise.interventionsTab, icon: ClipboardList },
            { key: 'team', label: t.enterprise.teamField, icon: Users },
            { key: 'billing', label: t.enterprise.billing, icon: FileText },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setActiveNav(item.key as any)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-semibold transition-colors ${
                  activeNav === item.key ? 'bg-white/15 text-white' : 'text-slate-200 hover:bg-white/10'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </aside>

        {/* Main Enterprise Content */}
        <div className="lg:col-span-9 space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 p-5 flex flex-wrap items-center justify-between gap-4 no-print">
            <div>
              <h1 className="font-display text-xl font-bold text-kazi-navy">
                {t.enterprise.companyPrefix} {org.name}
              </h1>
              <p className="text-xs text-slate-500">
                {org.sector} · {t.enterprise.planLabel} {org.subscriptionPlan}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowNewIntervention(!showNewIntervention)}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-kazi-orange-bright text-kazi-navy text-xs font-bold hover:bg-kazi-orange hover:text-white transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>{t.enterprise.newIntervention}</span>
            </button>
          </div>

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

          {showNewIntervention && (
            <form
              onSubmit={handleCreateIntervention}
              className="bg-white rounded-xl border border-slate-200 p-5 grid grid-cols-1 sm:grid-cols-4 gap-3 no-print"
            >
              <input
                type="text"
                required
                value={intTitle}
                onChange={(e) => setIntTitle(e.target.value)}
                placeholder={t.enterprise.interventionTitlePlaceholder}
                className="rounded-lg border border-slate-300 px-3 py-2 text-xs"
              />
              <input
                type="text"
                required
                value={intAddress}
                onChange={(e) => setIntAddress(e.target.value)}
                placeholder={t.enterprise.sitePlaceholder}
                className="rounded-lg border border-slate-300 px-3 py-2 text-xs"
              />
              <select
                value={intCategory}
                onChange={(e) => setIntCategory(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-xs bg-white"
              >
                {categories.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {getLocalizedField(lang, c, 'name')}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="rounded-lg bg-kazi-navy text-white text-xs font-semibold py-2 px-4 hover:bg-kazi-navy-mid"
              >
                {t.enterprise.newIntervention}
              </button>
            </form>
          )}

          {/* 4 KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 no-print">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="text-xs text-slate-500">{t.enterprise.activeInterventions}</div>
              <div className="text-2xl font-extrabold text-kazi-navy mt-1 tabular-nums">{interventions.length}</div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="text-xs text-slate-500">{t.enterprise.assignedTechs}</div>
              <div className="text-2xl font-extrabold text-kazi-navy mt-1 tabular-nums">{members.length}</div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="text-xs text-slate-500">{t.enterprise.completionRate}</div>
              <div className="text-2xl font-extrabold text-kazi-green-accessible mt-1 tabular-nums">{completionRatePct}%</div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="text-xs text-slate-500">{t.enterprise.monthlyCost}</div>
              <div className="text-2xl font-extrabold text-kazi-orange mt-1 tabular-nums">
                {formatLocalCurrency(totalCost, orgCurrency, lang)}
              </div>
            </div>
          </div>

          {activeNav === 'team' ? (
            <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
              <h2 className="font-display text-base font-bold text-kazi-navy">{t.enterprise.teamField}</h2>
              <form
                onSubmit={handleAddMember}
                className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 bg-kazi-canvas p-3.5 rounded-lg border border-slate-200"
              >
                <input
                  type="email"
                  required
                  value={memberEmail}
                  onChange={(e) => setMemberEmail(e.target.value)}
                  placeholder={t.enterprise.memberEmail}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                />
                <select
                  value={memberRole}
                  onChange={(e) => setMemberRole(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                >
                  <option value="MANAGER">MANAGER</option>
                  <option value="DISPATCHER">DISPATCHER</option>
                  <option value="TECHNICIAN">TECHNICIAN</option>
                </select>
                <input
                  type="text"
                  value={memberSite}
                  onChange={(e) => setMemberSite(e.target.value)}
                  placeholder={t.enterprise.siteLocation}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                />
                <button
                  type="submit"
                  className="rounded-lg bg-kazi-navy text-white text-xs font-semibold px-3 py-2 hover:bg-kazi-navy-mid"
                >
                  {t.enterprise.addMember}
                </button>
              </form>
              <div className="divide-y divide-slate-100">
                {members.map((m) => (
                  <div key={m.id} className="py-3 flex items-center justify-between text-sm">
                    <div>
                      <div className="font-semibold text-slate-900">{m.fullName}</div>
                      <div className="text-xs text-slate-500">
                        {m.email} · {m.memberRole}
                      </div>
                    </div>
                    <div className="inline-flex items-center gap-1 text-xs text-slate-600">
                      <MapPin className="w-3.5 h-3.5 text-kazi-navy" />
                      <span>{m.siteLocation || orgCountry?.capital || '-'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : activeNav === 'billing' ? (
            <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
                <div className="flex items-center gap-3">
                  <KaziBrand variant="mono" theme="light" size="sm" />
                  <div>
                    <h2 className="font-display text-base font-bold text-kazi-navy">{t.enterprise.billingTitle}</h2>
                    <div className="text-xs text-slate-500">
                      {org.name} · {org.subscriptionPlan} · {orgCurrency}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-kazi-navy text-xs font-semibold hover:bg-slate-50 no-print"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>{t.enterprise.printStatement}</span>
                </button>
              </div>
              <div className="divide-y divide-slate-100 text-xs tabular-nums">
                {interventions.map((intItem) => (
                  <div key={intItem.id} className="py-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="font-mono font-semibold text-kazi-navy">{intItem.referenceCode}</div>
                      <div className="text-slate-600">{intItem.title} · {intItem.address}</div>
                    </div>
                    <div className="flex items-center gap-4">
                      <StatusLabel status={intItem.status} />
                      <span className="font-bold text-slate-900">
                        {formatLocalCurrency(intItem.estimatedBudget || 0, intItem.currency || orgCurrency, lang)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4 overflow-x-auto">
              <h2 className="font-display text-base font-bold text-kazi-navy">{t.enterprise.ongoingInterventions}</h2>
              <table className="w-full text-start text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2.5 pe-4 font-semibold">{t.enterprise.colRef}</th>
                    <th className="py-2.5 pe-4 font-semibold">{t.enterprise.colSite}</th>
                    <th className="py-2.5 pe-4 font-semibold">{t.enterprise.colService}</th>
                    <th className="py-2.5 pe-4 font-semibold">{t.enterprise.assignTech}</th>
                    <th className="py-2.5 pe-4 font-semibold">{t.enterprise.colStatus}</th>
                    <th className="py-2.5 text-end font-semibold">{t.enterprise.colBudget}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {interventions.map((intItem) => (
                    <tr key={intItem.id} className="hover:bg-slate-50">
                      <td className="py-3 pe-4 font-mono font-semibold text-kazi-navy">{intItem.referenceCode}</td>
                      <td className="py-3 pe-4 text-slate-800">{intItem.address}</td>
                      <td className="py-3 pe-4 text-slate-600">
                        {getLocalizedField(lang, intItem.category, 'name') || '-'}
                      </td>
                      <td className="py-3 pe-4">
                        <select
                          value={intItem.targetProfessionalId || ''}
                          onChange={(e) => handleAssignTech(intItem.id, e.target.value)}
                          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                        >
                          <option value="">{t.enterprise.unassigned}</option>
                          {countryPros.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.fullName}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-3 pe-4">
                        <StatusLabel status={intItem.status} />
                      </td>
                      <td className="py-3 text-end font-semibold text-slate-900">
                        {formatLocalCurrency(intItem.estimatedBudget || 0, intItem.currency || orgCurrency, lang)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
