import React, { useEffect, useState } from 'react';
import { BriefcaseBusiness, Building2, MapPin, Search, Send, UserRound, RefreshCw } from 'lucide-react';
import { apiFetch } from '../../services/api';
import { useApp } from '../../app/AppContext';

type Job = {
  id: string; referenceCode: string; title: string; description: string;
  contractType: string; workMode: string; city: string;
  salaryMin: string | null; salaryMax: string | null; salaryCurrency: string;
  salaryPeriod: string; organizationName: string; countryIso2: string;
  countryName: string; requiredSkills: string[];
};
type Application = { id: string; status: string; submittedAt: string; jobTitle: string; organizationName: string; jobCity: string };

export const EmploymentModule: React.FC = () => {
  const { selectedCountryIso2 } = useApp();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [organization, setOrganization] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [view, setView] = useState<'jobs' | 'applications' | 'publish'>('jobs');
  const [form, setForm] = useState({ title: '', description: '', city: '', contractType: 'PERMANENT', workMode: 'ONSITE', salaryMin: '', salaryMax: '', department: '' });

  const loadJobs = async () => {
    setLoading(true); setError('');
    try {
      const qs = new URLSearchParams({ countryIso2: selectedCountryIso2 });
      if (query.trim()) qs.set('q', query.trim());
      const result = await apiFetch<{ jobs: Job[] }>(`/api/employment/jobs?${qs.toString()}`);
      setJobs(result.jobs || []);
    } catch (e: any) { setError(e.message || 'Impossible de charger les offres.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void loadJobs(); }, [selectedCountryIso2]);

  const loadWorkspace = async () => {
    try {
      const result = await apiFetch<any>('/api/enterprise/overview');
      setOrganization(result.organization || null);
    } catch { setOrganization(null); }
  };

  const loadApplications = async () => {
    try {
      const result = await apiFetch<{ applications: Application[] }>('/api/employment/me/applications');
      setApplications(result.applications || []);
    } catch (e: any) { setError(e.message || 'Connectez-vous pour consulter vos candidatures.'); }
  };

  useEffect(() => { void loadWorkspace(); }, []);

  const apply = async (jobId: string) => {
    setBusy(true); setNotice(''); setError('');
    try {
      await apiFetch(`/api/employment/jobs/${jobId}/applications`, { method: 'POST', body: JSON.stringify({}) });
      setNotice('Candidature envoyée. Vous pouvez suivre son évolution dans « Mes candidatures ».');
    } catch (e: any) { setError(e.message || 'La candidature n’a pas pu être envoyée.'); }
    finally { setBusy(false); }
  };

  const publish = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!organization?.id) { setError('Créez d’abord votre espace entreprise.'); return; }
    setBusy(true); setNotice(''); setError('');
    try {
      const result = await apiFetch<{ job: { id: string } }>('/api/employment/jobs', {
        method: 'POST',
        body: JSON.stringify({ ...form, organizationId: organization.id }),
      });
      await apiFetch(`/api/employment/jobs/${result.job.id}/publish`, { method: 'POST', body: JSON.stringify({}) });
      setNotice('Votre offre est publiée et visible dans le pays activé.');
      setForm({ title: '', description: '', city: '', contractType: 'PERMANENT', workMode: 'ONSITE', salaryMin: '', salaryMax: '', department: '' });
      setView('jobs'); await loadJobs();
    } catch (e: any) { setError(e.message || 'Publication impossible. Vérifiez vos droits et l’activation du module Emploi dans ce pays.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 pb-24 space-y-6">
      <header className="rounded-2xl bg-[#102D3A] text-white p-6 sm:p-8 flex flex-col md:flex-row md:items-center justify-between gap-5">
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-widest font-bold text-[#E9B66B] flex items-center gap-2"><BriefcaseBusiness className="w-4 h-4" /> KAZI AFRICA · EMPLOYMENT</div>
          <h1 className="text-2xl sm:text-3xl font-extrabold">Emploi & recrutement en Afrique</h1>
          <p className="text-sm text-slate-200 max-w-2xl">Trouvez un emploi, candidatez et suivez vos candidatures. Les entreprises publient leurs offres et gèrent leur recrutement.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setView('jobs')} className={`px-4 py-2 rounded-lg text-xs font-bold ${view === 'jobs' ? 'bg-[#E9B66B] text-[#102D3A]' : 'bg-white/10 text-white'}`}>Offres</button>
          <button onClick={() => { setView('applications'); void loadApplications(); }} className={`px-4 py-2 rounded-lg text-xs font-bold ${view === 'applications' ? 'bg-[#E9B66B] text-[#102D3A]' : 'bg-white/10 text-white'}`}>Mes candidatures</button>
          <button onClick={() => setView('publish')} className={`px-4 py-2 rounded-lg text-xs font-bold ${view === 'publish' ? 'bg-[#E9B66B] text-[#102D3A]' : 'bg-white/10 text-white'}`}>Publier une offre</button>
        </div>
      </header>

      {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</div>}
      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>}

      {view === 'jobs' && <>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1 relative"><Search className="absolute left-3 top-3 w-4 h-4 text-slate-400" /><input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && void loadJobs()} placeholder="Métier, compétence ou ville" className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm" /></div>
          <button onClick={() => void loadJobs()} className="rounded-xl bg-[#087F70] text-white px-5 py-2.5 text-sm font-bold inline-flex items-center justify-center gap-2"><Search className="w-4 h-4" /> Rechercher</button>
        </div>
        {loading ? <div className="p-10 text-center text-sm text-slate-500">Chargement des offres…</div> : jobs.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"><BriefcaseBusiness className="w-8 h-8 mx-auto text-slate-400 mb-3" /><p className="font-semibold text-slate-700">Aucune offre publiée pour ce pays</p><p className="text-sm text-slate-500 mt-1">Les offres apparaîtront dès que le module Emploi sera activé et que les entreprises publieront leurs annonces.</p></div> :
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">{jobs.map(job => <article key={job.id} className="rounded-2xl border border-slate-200 bg-white p-5 flex flex-col gap-4">
            <div className="space-y-2"><div className="flex items-center justify-between gap-2"><span className="text-[10px] font-bold uppercase tracking-wider text-[#087F70]">{job.contractType.replaceAll('_',' ')}</span><span className="text-[10px] text-slate-500">{job.referenceCode}</span></div><h2 className="font-bold text-lg text-[#102D3A]">{job.title}</h2><div className="flex items-center gap-2 text-xs text-slate-600"><Building2 className="w-3.5 h-3.5" />{job.organizationName}</div><div className="flex items-center gap-2 text-xs text-slate-600"><MapPin className="w-3.5 h-3.5" />{job.city} · {job.countryName}</div><p className="text-sm text-slate-600 line-clamp-4 whitespace-pre-line">{job.description}</p></div>
            <div className="mt-auto border-t border-slate-100 pt-3 flex items-center justify-between gap-2"><span className="text-xs font-semibold text-slate-700">{job.salaryMin || job.salaryMax ? `${job.salaryMin || '—'} – ${job.salaryMax || '—'} ${job.salaryCurrency} / ${job.salaryPeriod.toLowerCase()}` : 'Rémunération à préciser'}</span><button disabled={busy} onClick={() => void apply(job.id)} className="rounded-lg bg-[#087F70] px-3 py-2 text-xs font-bold text-white disabled:opacity-50 inline-flex items-center gap-1"><Send className="w-3.5 h-3.5" /> Postuler</button></div>
          </article>)}</div>}
      </>}

      {view === 'applications' && <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-7 space-y-4"><div className="flex items-center justify-between"><h2 className="font-bold text-lg text-[#102D3A]">Suivi de mes candidatures</h2><button onClick={() => void loadApplications()} className="text-xs font-semibold text-[#087F70] inline-flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5" /> Actualiser</button></div>{applications.length === 0 ? <p className="text-sm text-slate-500">Aucune candidature à afficher. Connectez-vous puis postulez à une offre.</p> : applications.map(app => <div key={app.id} className="border-t border-slate-100 py-3 flex flex-wrap items-center justify-between gap-3"><div><div className="font-semibold text-sm">{app.jobTitle}</div><div className="text-xs text-slate-500">{app.organizationName} · {app.jobCity} · {new Date(app.submittedAt).toLocaleDateString()}</div></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold">{app.status}</span></div>)}</section>}

      {view === 'publish' && <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-7 space-y-5"><div><h2 className="font-bold text-lg text-[#102D3A]">Publier une offre d’emploi</h2><p className="text-sm text-slate-500 mt-1">{organization ? `Entreprise : ${organization.name}` : 'Un espace entreprise est requis pour publier.'}</p></div>{!organization ? <a href="/enterprise" className="inline-flex rounded-lg bg-[#087F70] text-white px-4 py-2.5 text-sm font-bold">Créer mon espace entreprise</a> : <form onSubmit={publish} className="grid sm:grid-cols-2 gap-3">
        <input required minLength={4} maxLength={160} value={form.title} onChange={e => setForm({...form,title:e.target.value})} placeholder="Intitulé du poste" className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
        <input value={form.department} onChange={e => setForm({...form,department:e.target.value})} placeholder="Service / département" className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
        <input required value={form.city} onChange={e => setForm({...form,city:e.target.value})} placeholder="Ville du poste" className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
        <select value={form.contractType} onChange={e => setForm({...form,contractType:e.target.value})} className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm"><option value="PERMANENT">CDI / Permanent</option><option value="FIXED_TERM">CDD / Fixed term</option><option value="TEMPORARY">Intérim / Temporary</option><option value="PART_TIME">Temps partiel</option><option value="INTERNSHIP">Stage</option><option value="APPRENTICESHIP">Apprentissage</option><option value="SEASONAL">Saisonnier</option><option value="GRADUATE">Jeune diplômé</option><option value="PUBLIC_SERVICE">Service public</option></select>
        <select value={form.workMode} onChange={e => setForm({...form,workMode:e.target.value})} className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm"><option value="ONSITE">Sur site</option><option value="HYBRID">Hybride</option><option value="REMOTE">Télétravail</option></select>
        <input type="number" min="0" value={form.salaryMin} onChange={e => setForm({...form,salaryMin:e.target.value})} placeholder="Salaire minimum" className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
        <input type="number" min="0" value={form.salaryMax} onChange={e => setForm({...form,salaryMax:e.target.value})} placeholder="Salaire maximum" className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
        <textarea required minLength={30} maxLength={12000} rows={7} value={form.description} onChange={e => setForm({...form,description:e.target.value})} placeholder="Missions, responsabilités, profil recherché, compétences et modalités de candidature…" className="sm:col-span-2 rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
        <button disabled={busy} type="submit" className="sm:col-span-2 rounded-xl bg-[#087F70] text-white py-3 font-bold text-sm disabled:opacity-50">{busy ? 'Publication…' : 'Publier l’offre'}</button>
      </form>}</section>}
      <div className="text-xs text-slate-500 flex items-start gap-2"><UserRound className="w-4 h-4 shrink-0" /> Les candidatures et les informations des candidats sont accessibles uniquement aux personnes autorisées de l’entreprise concernée.</div>
    </div>
  );
};
