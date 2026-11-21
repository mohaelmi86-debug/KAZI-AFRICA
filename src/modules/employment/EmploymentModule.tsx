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
  const [view, setView] = useState<'jobs' | 'applications' | 'publish' | 'profile' | 'recruiter'>('jobs');
  const [candidate, setCandidate] = useState({ headline: '', summary: '', city: '', skillsText: '', experienceYears: '0', visibility: 'PRIVATE' });
  const [employerJobs, setEmployerJobs] = useState<any[]>([]);
  const [selectedJobId, setSelectedJobId] = useState('');
  const [jobApplications, setJobApplications] = useState<any[]>([]);
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

  useEffect(() => { void loadWorkspace(); void loadCandidate(); }, []);

  const loadCandidate = async () => {
    try {
      const result = await apiFetch<any>('/api/employment/candidates/me');
      const c = result.candidate || {};
      setCandidate({ headline: c.headline || '', summary: c.summary || '', city: c.city || result.profile?.cityName || '', skillsText: (c.skills || []).join(', '), experienceYears: String(c.experienceYears || 0), visibility: c.visibility || 'PRIVATE' });
    } catch { /* profile is loaded when the candidate opens the tab */ }
  };

  const saveCandidate = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await apiFetch('/api/employment/candidates/me', { method: 'PATCH', body: JSON.stringify({
        headline: candidate.headline, summary: candidate.summary, city: candidate.city,
        skills: candidate.skillsText.split(',').map(v => v.trim()).filter(Boolean),
        experienceYears: Number(candidate.experienceYears), visibility: candidate.visibility,
      }) });
      setNotice('Votre profil professionnel a été enregistré.');
    } catch (e: any) { setError(e.message || 'Impossible d’enregistrer le profil.'); }
    finally { setBusy(false); }
  };

  const loadEmployerJobs = async () => {
    if (!organization?.id) { setError('Aucun espace entreprise associé à votre compte.'); return; }
    try {
      const result = await apiFetch<{ jobs: any[] }>(`/api/employment/employer/jobs?organizationId=${organization.id}`);
      setEmployerJobs(result.jobs || []);
    } catch (e: any) { setError(e.message || 'Impossible de charger vos offres.'); }
  };

  const loadJobApplications = async (jobId: string) => {
    setSelectedJobId(jobId);
    try {
      const result = await apiFetch<{ applications: any[] }>(`/api/employment/jobs/${jobId}/applications`);
      setJobApplications(result.applications || []);
    } catch (e: any) { setError(e.message || 'Impossible de charger les candidatures.'); }
  };

  const changeApplicationStatus = async (applicationId: string, status: string) => {
    try {
      await apiFetch(`/api/employment/applications/${applicationId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      if (selectedJobId) await loadJobApplications(selectedJobId);
      await loadEmployerJobs();
      setNotice('Le statut de la candidature a été actualisé.');
    } catch (e: any) { setError(e.message || 'Impossible de modifier le statut.'); }
  };

  const withdrawApplication = async (applicationId: string) => {
    setBusy(true); setError(''); setNotice('');
    try {
      await apiFetch(`/api/employment/applications/${applicationId}/withdraw`, { method: 'POST', body: JSON.stringify({}) });
      await loadApplications();
      setNotice('Votre candidature a été retirée.');
    } catch (e: any) { setError(e.message || 'Impossible de retirer cette candidature.'); }
    finally { setBusy(false); }
  };

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
          <button onClick={() => setView('profile')} className={`px-4 py-2 rounded-lg text-xs font-bold ${view === 'profile' ? 'bg-[#E9B66B] text-[#102D3A]' : 'bg-white/10 text-white'}`}>Mon profil</button>
          <button onClick={() => { setView('recruiter'); void loadEmployerJobs(); }} className={`px-4 py-2 rounded-lg text-xs font-bold ${view === 'recruiter' ? 'bg-[#E9B66B] text-[#102D3A]' : 'bg-white/10 text-white'}`}>Espace recruteur</button>
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

      {view === 'applications' && <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-7 space-y-4"><div className="flex items-center justify-between"><h2 className="font-bold text-lg text-[#102D3A]">Suivi de mes candidatures</h2><button onClick={() => void loadApplications()} className="text-xs font-semibold text-[#087F70] inline-flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5" /> Actualiser</button></div>{applications.length === 0 ? <p className="text-sm text-slate-500">Aucune candidature à afficher. Connectez-vous puis postulez à une offre.</p> : applications.map(app => <div key={app.id} className="border-t border-slate-100 py-3 flex flex-wrap items-center justify-between gap-3"><div><div className="font-semibold text-sm">{app.jobTitle}</div><div className="text-xs text-slate-500">{app.organizationName} · {app.jobCity} · {new Date(app.submittedAt).toLocaleDateString()}</div></div><div className="flex items-center gap-2"><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold">{app.status}</span>{['SUBMITTED','REVIEWING','SHORTLISTED','INTERVIEW'].includes(app.status) && <button disabled={busy} onClick={() => void withdrawApplication(app.id)} className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 disabled:opacity-50">Retirer</button>}</div></div>)}</section>}

      {view === 'profile' && <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-7 space-y-4"><div><h2 className="font-bold text-lg text-[#102D3A]">Mon profil professionnel</h2><p className="text-sm text-slate-500 mt-1">Maîtrisez les informations visibles par les employeurs.</p></div><form onSubmit={saveCandidate} className="grid sm:grid-cols-2 gap-3">
        <input value={candidate.headline} onChange={e => setCandidate({...candidate,headline:e.target.value})} maxLength={160} placeholder="Titre professionnel (ex. Comptable senior)" className="sm:col-span-2 rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
        <input value={candidate.city} onChange={e => setCandidate({...candidate,city:e.target.value})} maxLength={120} placeholder="Ville de résidence" className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
        <input type="number" min="0" max="60" value={candidate.experienceYears} onChange={e => setCandidate({...candidate,experienceYears:e.target.value})} placeholder="Années d'expérience" className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
        <input value={candidate.skillsText} onChange={e => setCandidate({...candidate,skillsText:e.target.value})} placeholder="Compétences séparées par des virgules" className="sm:col-span-2 rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
        <textarea rows={6} maxLength={4000} value={candidate.summary} onChange={e => setCandidate({...candidate,summary:e.target.value})} placeholder="Présentez votre parcours et vos objectifs professionnels…" className="sm:col-span-2 rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
        <select value={candidate.visibility} onChange={e => setCandidate({...candidate,visibility:e.target.value})} className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm"><option value="PRIVATE">Profil privé</option><option value="EMPLOYERS_WITH_APPLICATION">Visible aux employeurs auxquels je candidate</option><option value="PUBLIC">Profil public</option></select>
        <button disabled={busy} type="submit" className="rounded-xl bg-[#087F70] text-white py-3 font-bold text-sm disabled:opacity-50">{busy ? 'Enregistrement…' : 'Enregistrer mon profil'}</button>
      </form><p className="text-xs text-slate-500">Le CV et les justificatifs seront ajoutés dans une prochaine tranche avec stockage privé, contrôle de type de fichier et analyse antivirus. Aucun document n'est rendu public ici.</p></section>}

      {view === 'recruiter' && <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-7 space-y-5"><div className="flex items-center justify-between gap-2"><div><h2 className="font-bold text-lg text-[#102D3A]">Tableau de recrutement</h2><p className="text-sm text-slate-500">Offres et candidatures de votre organisation.</p></div><button onClick={() => void loadEmployerJobs()} className="text-xs font-bold text-[#087F70]">Actualiser</button></div>{employerJobs.length === 0 ? <p className="text-sm text-slate-500">Aucune offre pour cette entreprise.</p> : <div className="grid md:grid-cols-2 gap-3">{employerJobs.map(job => <button key={job.id} onClick={() => void loadJobApplications(job.id)} className={`text-left rounded-xl border p-4 ${selectedJobId === job.id ? 'border-[#087F70] bg-emerald-50' : 'border-slate-200'}`}><div className="font-bold text-sm">{job.title}</div><div className="text-xs text-slate-500 mt-1">{job.city} · {job.status} · {job.referenceCode}</div><div className="flex flex-wrap gap-2 mt-3">{Object.entries(job.applicationCounts || {}).map(([status,count]) => <span key={status} className="rounded-full bg-slate-100 px-2 py-1 text-[10px]">{status}: {String(count)}</span>)}</div></button>)}</div>}
        {selectedJobId && <div className="border-t border-slate-200 pt-4 space-y-3"><h3 className="font-bold text-sm">Candidatures reçues ({jobApplications.length})</h3>{jobApplications.length === 0 ? <p className="text-sm text-slate-500">Aucune candidature reçue pour cette offre.</p> : jobApplications.map(app => <article key={app.id} className="rounded-xl border border-slate-200 p-4 space-y-2"><div className="flex flex-wrap items-center justify-between gap-2"><div><div className="font-bold text-sm">{app.candidateName || app.headline || 'Candidat'}</div><div className="text-xs text-slate-500">{app.headline || 'Profil professionnel'} · {app.city || 'Ville non renseignée'} · {app.experienceYears} an(s) d’expérience</div></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold">{app.status}</span></div>{app.skills?.length > 0 && <div className="text-xs text-slate-600">Compétences : {app.skills.join(', ')}</div>}{app.coverLetter && <p className="text-sm text-slate-600 whitespace-pre-line">{app.coverLetter}</p>}<div className="flex flex-wrap gap-2">{(app.status === 'SUBMITTED' ? ['REVIEWING','REJECTED'] : app.status === 'REVIEWING' ? ['SHORTLISTED','INTERVIEW','REJECTED'] : app.status === 'SHORTLISTED' ? ['INTERVIEW','OFFER','REJECTED'] : app.status === 'INTERVIEW' ? ['OFFER','REJECTED'] : app.status === 'OFFER' ? ['HIRED','REJECTED'] : []).map(next => <button key={next} onClick={() => void changeApplicationStatus(app.id,next)} className="rounded-lg bg-[#087F70] text-white px-3 py-2 text-xs font-bold">{next === 'REVIEWING' ? 'Examiner' : next === 'SHORTLISTED' ? 'Présélectionner' : next === 'INTERVIEW' ? 'Entretien' : next === 'OFFER' ? 'Proposer embauche' : next === 'HIRED' ? 'Recruté' : 'Refuser'}</button>)}</div></article>)}</div>}
      </section>}

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
