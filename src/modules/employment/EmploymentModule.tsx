import React, { useEffect, useState } from 'react';
import { BriefcaseBusiness, Building2, MapPin, Search, Send, UserRound, RefreshCw, Bell } from 'lucide-react';
import { apiFetch } from '../../services/api';
import { useApp } from '../../app/AppContext';
import { useAuth } from '../auth/AuthContext';

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
  const { firebaseUser, roles, loading: authLoading } = useAuth();
  const isPlatformAdmin = roles.includes('SUPER_ADMIN') || roles.includes('LOCAL_ADMIN');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJob, setSelectedJob] = useState<any>(null);
  const [coverLetter, setCoverLetter] = useState('');
  const [applications, setApplications] = useState<Application[]>([]);
  const [employmentOffers, setEmploymentOffers] = useState<any[]>([]);
  const [employmentContracts, setEmploymentContracts] = useState<any[]>([]);
  const [employerContracts, setEmployerContracts] = useState<any[]>([]);
  const [approvedContractTemplates, setApprovedContractTemplates] = useState<any[]>([]);
  const [contractTemplateByApplication, setContractTemplateByApplication] = useState<Record<string, string>>({});
  const [offerDraft, setOfferDraft] = useState({ salaryAmount: '', salaryBasis: 'GROSS', payFrequency: 'MONTH', startDate: '', workLocation: '', weeklyHours: '40', probationDays: '', benefits: '', additionalConditions: '', localLawNotice: '', expiresInDays: '7' });
  const [applicationHistories, setApplicationHistories] = useState<Record<string, any[]>>({});
  const [expandedApplicationHistories, setExpandedApplicationHistories] = useState<Record<string, boolean>>({});
  const [candidateDocuments, setCandidateDocuments] = useState<any[]>([]);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState('CV');
  const [documentBusy, setDocumentBusy] = useState(false);
  const [documentShareTargets, setDocumentShareTargets] = useState<Record<string, string>>({});
  const [interviews, setInterviews] = useState<any[]>([]);
  const [interviewForm, setInterviewForm] = useState({ startsAt: '', endsAt: '', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', mode: 'VIDEO', locationOrUrl: '' });
  const [organization, setOrganization] = useState<any>(null);
  const [availableOrganizations, setAvailableOrganizations] = useState<any[]>([]);
  const [employerVerification, setEmployerVerification] = useState<any>(null);
  const [verificationForm, setVerificationForm] = useState({ legalName: '', registrationNumber: '', contactName: '', contactEmail: '' });
  const [verificationLoading, setVerificationLoading] = useState(false);
  const [adminVerifications, setAdminVerifications] = useState<any[]>([]);
  const [adminReviewDrafts, setAdminReviewDrafts] = useState<Record<string, { note: string; evidenceReference: string }>>({});
  const [adminQueueLoading, setAdminQueueLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [contractFilter, setContractFilter] = useState('');
  const [workModeFilter, setWorkModeFilter] = useState('');
  const [employmentNotifications, setEmploymentNotifications] = useState<any[]>([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [view, setView] = useState<'jobs' | 'jobDetail' | 'applications' | 'interviews' | 'offers' | 'contracts' | 'publish' | 'profile' | 'recruiter' | 'employerVerification' | 'adminVerifications'>('jobs');
  const [candidate, setCandidate] = useState({ headline: '', summary: '', city: '', skillsText: '', experienceYears: '0', visibility: 'PRIVATE' });
  const [employerJobs, setEmployerJobs] = useState<any[]>([]);
  const [selectedJobId, setSelectedJobId] = useState('');
  const [jobApplications, setJobApplications] = useState<any[]>([]);
  const [employerInterviews, setEmployerInterviews] = useState<any[]>([]);
  const [applicationDocuments, setApplicationDocuments] = useState<Record<string, any[]>>({});
  const [evaluationDrafts, setEvaluationDrafts] = useState<Record<string, { score: string; recommendation: string; strengths: string; concerns: string }>>({});
  const [form, setForm] = useState({ title: '', description: '', city: '', contractType: 'PERMANENT', workMode: 'ONSITE', salaryMin: '', salaryMax: '', department: '' });

  const loadJobs = async () => {
    setLoading(true); setError('');
    try {
      const qs = new URLSearchParams({ countryIso2: selectedCountryIso2 });
      if (query.trim()) qs.set('q', query.trim());
      if (cityFilter.trim()) qs.set('city', cityFilter.trim());
      if (contractFilter) qs.set('contractType', contractFilter);
      if (workModeFilter) qs.set('workMode', workModeFilter);
      const result = await apiFetch<{ jobs: Job[] }>(`/api/employment/jobs?${qs.toString()}`);
      setJobs(result.jobs || []);
    } catch (e: any) { setError(e.message || 'Impossible de charger les offres.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void loadJobs(); }, [selectedCountryIso2]);

  const loadWorkspace = async (organizationId?: string) => {
    try {
      const qs = organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : '';
      const result = await apiFetch<any>(`/api/enterprise/overview${qs}`);
      setAvailableOrganizations(result.organizations || []);
      setOrganization(result.organization || null);
      setEmployerJobs([]);
      setJobApplications([]);
      setEmployerInterviews([]);
      setApplicationDocuments({});
      setSelectedJobId('');
      setEmployerVerification(null);
    } catch {
      setOrganization(null);
      setAvailableOrganizations([]);
    }
  };

  const loadEmploymentNotifications = async () => {
    try {
      const result = await apiFetch<{ notifications: any[] }>('/api/notifications');
      setEmploymentNotifications(result.notifications || []);
    } catch { /* notifications are supplementary; do not block the employment workspace */ }
  };

  const markEmploymentNotificationRead = async (id: string) => {
    try {
      await apiFetch(`/api/notifications/${id}/read`, { method: 'PATCH' });
      setEmploymentNotifications((current) => current.map((item) => item.id === id ? { ...item, isRead: true } : item));
    } catch (e: any) {
      setError(e.message || 'Impossible de mettre à jour la notification.');
    }
  };

  const loadEmploymentOffers = async () => {
    try {
      const result = await apiFetch<{ offers: any[] }>('/api/employment/me/offers');
      setEmploymentOffers(result.offers || []);
    } catch (e: any) { setError(e.message || 'Impossible de charger les propositions d’embauche.'); }
  };

  const respondToEmploymentOffer = async (offerId: string, response: 'ACCEPTED' | 'DECLINED') => {
    setBusy(true); setError(''); setNotice('');
    try {
      await apiFetch(`/api/employment/offers/${offerId}/response`, { method: 'PATCH', body: JSON.stringify({ response }) });
      await loadEmploymentOffers();
      await loadApplications();
      setNotice(response === 'ACCEPTED'
        ? 'Proposition acceptée. Le recrutement est maintenant marqué comme conclu ; la signature du contrat reste une étape distincte.'
        : 'Proposition refusée. L’entreprise en a été informée.');
    } catch (e: any) { setError(e.message || 'Impossible d’enregistrer votre réponse.'); }
    finally { setBusy(false); }
  };

  const sendEmploymentOffer = async (applicationId: string) => {
    setBusy(true); setError(''); setNotice('');
    try {
      await apiFetch(`/api/employment/applications/${applicationId}/offers`, {
        method: 'POST',
        body: JSON.stringify({
          ...offerDraft, salaryAmount: Number(offerDraft.salaryAmount),
          weeklyHours: offerDraft.weeklyHours === '' ? null : Number(offerDraft.weeklyHours),
          probationDays: offerDraft.probationDays === '' ? null : Number(offerDraft.probationDays),
          expiresInDays: Number(offerDraft.expiresInDays),
        }),
      });
      setNotice('Proposition d’embauche envoyée au candidat.');
      if (selectedJobId) await loadJobApplications(selectedJobId);
      await loadEmploymentNotifications();
    } catch (e: any) { setError(e.message || 'Impossible d’envoyer la proposition.'); }
    finally { setBusy(false); }
  };

  const generateEmploymentContractPdf = async (contractId: string) => {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await apiFetch<{ sha256: string; sizeBytes: number; signatureStatus: string }>(`/api/employment/contracts/${contractId}/generate-pdf`, { method: 'POST', body: JSON.stringify({}) });
      await loadEmployerContractWorkspace();
      setNotice(`PDF brouillon généré et archivé en stockage privé. Empreinte SHA-256 : ${result.sha256}. Statut : non signé.`);
    } catch (e: any) { setError(e.message || 'Impossible de générer le PDF du contrat.'); }
    finally { setBusy(false); }
  };

  const downloadEmploymentContractPdf = async (contractId: string) => {
    if (!firebaseUser) { setError('Connectez-vous pour consulter ce document.'); return; }
    setBusy(true); setError('');
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch(`/api/employment/contracts/${contractId}/document`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Téléchargement du contrat impossible.');
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl; link.download = `kazi-contrat-${contractId}.pdf`;
      document.body.appendChild(link); link.click(); link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (e: any) { setError(e.message || 'Impossible de télécharger le contrat.'); }
    finally { setBusy(false); }
  };

  const loadEmploymentContracts = async () => {
    try { const result = await apiFetch<{ contracts: any[] }>('/api/employment/me/contracts'); setEmploymentContracts(result.contracts || []); }
    catch (e: any) { setError(e.message || 'Impossible de charger vos contrats.'); }
  };

  const loadEmployerContractWorkspace = async () => {
    if (!organization?.id) return;
    try {
      const [contractsResult, templatesResult] = await Promise.all([
        apiFetch<{ contracts: any[] }>(`/api/employment/organizations/${organization.id}/contracts`),
        apiFetch<{ templates: any[] }>(`/api/employment/organizations/${organization.id}/contract-templates`),
      ]);
      setEmployerContracts(contractsResult.contracts || []); setApprovedContractTemplates(templatesResult.templates || []);
    } catch (e: any) { setEmployerContracts([]); setApprovedContractTemplates([]); setError(e.message || 'Impossible de charger les modèles et contrats.'); }
  };

  const createEmploymentContractDraft = async (applicationId: string) => {
    const templateId = contractTemplateByApplication[applicationId];
    const template = approvedContractTemplates.find((item) => item.id === templateId);
    if (!template) { setError('Sélectionnez un modèle approuvé pour le pays et le type de contrat.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      await apiFetch(`/api/employment/applications/${applicationId}/contracts`, { method: 'POST', body: JSON.stringify({ templateId, language: template.language }) });
      await loadEmployerContractWorkspace();
      setNotice('Brouillon de contrat créé à partir de la proposition acceptée. Il doit être relu avant toute signature.');
    } catch (e: any) { setError(e.message || 'Impossible de créer le brouillon de contrat.'); }
    finally { setBusy(false); }
  };

  const loadApplications = async () => {
    try {
      const result = await apiFetch<{ applications: Application[] }>('/api/employment/me/applications');
      setApplications(result.applications || []);
    } catch (e: any) { setError(e.message || 'Connectez-vous pour consulter vos candidatures.'); }
  };

  useEffect(() => {
    if (authLoading) return;
    if (firebaseUser) {
      void loadWorkspace();
      void loadCandidate();
      void loadEmploymentNotifications();
      void loadEmploymentOffers();
      void loadEmploymentContracts();
      return;
    }
    setOrganization(null);
    setEmployerJobs([]);
    setJobApplications([]);
    setApplications([]);
    setInterviews([]);
    setCandidateDocuments([]);
    setEmploymentNotifications([]);
    setEmploymentOffers([]);
    setEmploymentContracts([]);
    setEmployerContracts([]);
    setApprovedContractTemplates([]);
  }, [authLoading, firebaseUser]);

  const toggleApplicationHistory = async (applicationId: string) => {
    const nextOpen = !expandedApplicationHistories[applicationId];
    setExpandedApplicationHistories((current) => ({ ...current, [applicationId]: nextOpen }));
    if (!nextOpen || applicationHistories[applicationId]) return;
    try {
      const result = await apiFetch<{ events: any[] }>(`/api/employment/applications/${applicationId}/events`);
      setApplicationHistories((current) => ({ ...current, [applicationId]: result.events || [] }));
    } catch (e: any) {
      setError(e.message || 'Impossible de charger l’historique de cette candidature.');
      setExpandedApplicationHistories((current) => ({ ...current, [applicationId]: false }));
    }
  };

  const loadInterviews = async () => {
    try {
      const result = await apiFetch<{ interviews: any[] }>('/api/employment/me/interviews');
      setInterviews(result.interviews || []);
    } catch (e: any) { setError(e.message || 'Impossible de charger les entretiens.'); }
  };

  const respondToInterview = async (id: string, response: 'CONFIRMED' | 'DECLINED') => {
    try {
      await apiFetch(`/api/employment/interviews/${id}/response`, {
        method: 'PATCH', body: JSON.stringify({ response }),
      });
      await loadInterviews();
      setNotice(response === 'CONFIRMED' ? 'Entretien confirmé.' : 'Invitation refusée.');
    } catch (e: any) { setError(e.message || 'Impossible d’enregistrer votre réponse.'); }
  };

  const scheduleInterview = async (applicationId: string) => {
    if (!interviewForm.startsAt || !interviewForm.endsAt) { setError('Renseignez les dates de début et de fin.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      await apiFetch(`/api/employment/applications/${applicationId}/interviews`, {
        method: 'POST',
        body: JSON.stringify({
          ...interviewForm,
          startsAt: new Date(interviewForm.startsAt).toISOString(),
          endsAt: new Date(interviewForm.endsAt).toISOString(),
        }),
      });
      if (selectedJobId) await loadJobApplications(selectedJobId);
      setNotice('Invitation à l’entretien envoyée au candidat.');
    } catch (e: any) { setError(e.message || 'Impossible de planifier cet entretien.'); }
    finally { setBusy(false); }
  };

  const loadCandidateDocuments = async () => {
    try {
      const result = await apiFetch<{ documents: any[] }>('/api/employment/candidates/me/documents');
      setCandidateDocuments(result.documents || []);
    } catch (e: any) { setError(e.message || 'Impossible de charger vos documents.'); }
  };

  const uploadCandidateDocument = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!documentFile) { setError('Sélectionnez un fichier PDF.'); return; }
    if (documentFile.type !== 'application/pdf' || !documentFile.name.toLowerCase().endsWith('.pdf')) { setError('Seuls les fichiers PDF sont acceptés.'); return; }
    if (documentFile.size > 8 * 1024 * 1024) { setError('La taille maximale est de 8 Mo.'); return; }
    setDocumentBusy(true); setError(''); setNotice('');
    try {
      await apiFetch('/api/employment/candidates/me/documents?documentType=' + encodeURIComponent(documentType) + '&fileName=' + encodeURIComponent(documentFile.name), {
        method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: documentFile,
      });
      setDocumentFile(null);
      await loadCandidateDocuments();
      setNotice('Document déposé en quarantaine. Il n’est pas accessible aux recruteurs avant analyse antivirus.');
    } catch (e: any) { setError(e.message || 'Échec du dépôt sécurisé.'); }
    finally { setDocumentBusy(false); }
  };

  const shareCandidateDocument = async (documentId: string) => {
    const applicationId = documentShareTargets[documentId];
    if (!applicationId) { setError('Choisissez la candidature concernée avant de donner votre consentement.'); return; }
    setDocumentBusy(true); setError(''); setNotice('');
    try {
      const result = await apiFetch<{ message: string }>(`/api/employment/candidates/me/documents/${documentId}/share`, {
        method: 'POST', body: JSON.stringify({ applicationId }),
      });
      setNotice(result.message);
    } catch (e: any) { setError(e.message || 'Impossible d’enregistrer le consentement.'); }
    finally { setDocumentBusy(false); }
  };

  const deleteCandidateDocument = async (documentId: string) => {
    setDocumentBusy(true); setError(''); setNotice('');
    try {
      await apiFetch(`/api/employment/candidates/me/documents/${documentId}`, { method: 'DELETE' });
      await loadCandidateDocuments();
      setNotice('Document supprimé du stockage privé.');
    } catch (e: any) { setError(e.message || 'Impossible de supprimer le document.'); }
    finally { setDocumentBusy(false); }
  };

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

  const loadAdminVerificationQueue = async () => {
    setAdminQueueLoading(true); setError('');
    try {
      const result = await apiFetch<{ verifications: any[] }>('/api/employment/admin/employer-verifications');
      setAdminVerifications(result.verifications || []);
    } catch (e: any) { setError(e.message || 'Accès réservé aux administrateurs habilités.'); }
    finally { setAdminQueueLoading(false); }
  };

  const reviewEmployerVerification = async (id: string, action: 'VERIFY' | 'REJECT' | 'REQUEST_INFO') => {
    const draft = adminReviewDrafts[id] || { note: '', evidenceReference: '' };
    if (action === 'VERIFY' && draft.evidenceReference.trim().length < 5) { setError('Une référence de preuve officielle (5 caractères minimum) est obligatoire pour valider.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      await apiFetch(`/api/employment/admin/employer-verifications/${id}`, { method: 'PATCH', body: JSON.stringify({ action, note: draft.note, evidenceReference: draft.evidenceReference }) });
      await loadAdminVerificationQueue();
      setNotice(action === 'VERIFY' ? 'Entreprise vérifiée.' : action === 'REJECT' ? 'Dossier refusé.' : 'Informations complémentaires demandées.');
    } catch (e: any) { setError(e.message || 'Impossible d’enregistrer la décision.'); }
    finally { setBusy(false); }
  };

  const loadEmployerVerification = async () => {
    if (!organization?.id) { setError('Aucun espace entreprise associé à votre compte.'); return; }
    setVerificationLoading(true); setError('');
    try {
      const result = await apiFetch<{ verification: any }>(`/api/employment/employer/verification?organizationId=${organization.id}`);
      setEmployerVerification(result.verification || null);
      if (result.verification) setVerificationForm({ legalName: result.verification.legalName || '', registrationNumber: result.verification.registrationNumber || '', contactName: result.verification.contactName || '', contactEmail: result.verification.contactEmail || '' });
    } catch (e: any) { setError(e.message || 'Impossible de charger le dossier de vérification.'); }
    finally { setVerificationLoading(false); }
  };

  const submitEmployerVerification = async (event: React.FormEvent) => {
    event.preventDefault(); if (!organization?.id) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await apiFetch<{ verification: any }>('/api/employment/employer/verification', { method: 'POST', body: JSON.stringify({ organizationId: organization.id, ...verificationForm }) });
      setEmployerVerification(result.verification);
      setNotice('Votre dossier a été transmis. La publication des offres sera disponible après validation.');
    } catch (e: any) { setError(e.message || 'Impossible de transmettre le dossier.'); }
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
      const docsEntries = await Promise.all((result.applications || []).map(async (app: any) => {
        try {
          const docs = await apiFetch<{ documents: any[] }>(`/api/employment/applications/${app.id}/documents`);
          return [app.id, docs.documents || []] as const;
        } catch { return [app.id, []] as const; }
      }));
      setApplicationDocuments(Object.fromEntries(docsEntries));
      const interviewResult = await apiFetch<{ interviews: any[] }>(`/api/employment/jobs/${jobId}/interviews`);
      setEmployerInterviews(interviewResult.interviews || []);
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

  const saveInterviewEvaluation = async (interviewId: string) => {
    const draft = evaluationDrafts[interviewId] || { score: '3', recommendation: 'HOLD', strengths: '', concerns: '' };
    setBusy(true); setError(''); setNotice('');
    try {
      await apiFetch(`/api/employment/interviews/${interviewId}/evaluation`, {
        method: 'POST',
        body: JSON.stringify({
          score: Number(draft.score), recommendation: draft.recommendation,
          strengths: draft.strengths, concerns: draft.concerns,
        }),
      });
      if (selectedJobId) await loadJobApplications(selectedJobId);
      setNotice('Évaluation enregistrée dans le dossier de recrutement.');
    } catch (e: any) { setError(e.message || 'Impossible d’enregistrer l’évaluation.'); }
    finally { setBusy(false); }
  };

  const revokeCandidateDocumentShare = async (documentId: string) => {
    const applicationId = documentShareTargets[documentId];
    if (!applicationId) { setError('Choisissez la candidature pour laquelle révoquer le partage.'); return; }
    setDocumentBusy(true); setError(''); setNotice('');
    try {
      await apiFetch(`/api/employment/candidates/me/documents/${documentId}/share/${applicationId}`, { method: 'DELETE' });
      setNotice('Le consentement de partage a été révoqué.');
    } catch (e: any) { setError(e.message || 'Impossible de révoquer le consentement.'); }
    finally { setDocumentBusy(false); }
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

  const openJob = async (jobId: string) => {
    setBusy(true); setError('');
    try {
      const result = await apiFetch<{ job: any }>(`/api/employment/jobs/${jobId}`);
      setSelectedJob(result.job);
      setCoverLetter('');
      setView('jobDetail');
    } catch (e: any) { setError(e.message || 'Impossible de charger cette offre.'); }
    finally { setBusy(false); }
  };

  const apply = async (jobId: string) => {
    setBusy(true); setNotice(''); setError('');
    try {
      await apiFetch(`/api/employment/jobs/${jobId}/applications`, {
        method: 'POST', body: JSON.stringify({ coverLetter: coverLetter.trim() || null }),
      });
      setNotice('Candidature envoyée. Vous pouvez suivre son évolution dans « Mes candidatures ».');
      setCoverLetter('');
      setView('applications');
      await loadApplications();
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
          {firebaseUser && <>
            <button onClick={() => { setView('applications'); void loadApplications(); }} className={`px-4 py-2 rounded-lg text-xs font-bold ${view === 'applications' ? 'bg-[#E9B66B] text-[#102D3A]' : 'bg-white/10 text-white'}`}>Mes candidatures</button>
            <button onClick={() => { setView('interviews'); void loadInterviews(); }} className={`px-4 py-2 rounded-lg text-xs font-bold ${view === 'interviews' ? 'bg-[#E9B66B] text-[#102D3A]' : 'bg-white/10 text-white'}`}>Mes entretiens</button>
            <button onClick={() => { setView('contracts'); void loadEmploymentContracts(); }} className={`px-4 py-2 rounded-lg text-xs font-bold ${view === 'contracts' ? 'bg-[#E9B66B] text-[#102D3A]' : 'bg-white/10 text-white'}`}>Mes contrats</button>
            <button onClick={() => { setView('offers'); void loadEmploymentOffers(); }} className={`px-4 py-2 rounded-lg text-xs font-bold ${view === 'offers' ? 'bg-[#E9B66B] text-[#102D3A]' : 'bg-white/10 text-white'}`}>Mes propositions</button>
            <button onClick={() => { setView('profile'); void loadCandidateDocuments(); void loadApplications(); }} className={`px-4 py-2 rounded-lg text-xs font-bold ${view === 'profile' ? 'bg-[#E9B66B] text-[#102D3A]' : 'bg-white/10 text-white'}`}>Mon profil</button>
          </>}
          {firebaseUser && organization && <>
            <button onClick={() => { setView('recruiter'); void loadEmployerJobs(); void loadEmployerContractWorkspace(); }} className={`px-4 py-2 rounded-lg text-xs font-bold ${view === 'recruiter' ? 'bg-[#E9B66B] text-[#102D3A]' : 'bg-white/10 text-white'}`}>Espace recruteur</button>
            <button onClick={() => { setView('employerVerification'); void loadEmployerVerification(); }} className={`px-4 py-2 rounded-lg text-xs font-bold ${view === 'employerVerification' ? 'bg-[#E9B66B] text-[#102D3A]' : 'bg-white/10 text-white'}`}>Vérification entreprise</button>
            <button onClick={() => setView('publish')} className={`px-4 py-2 rounded-lg text-xs font-bold ${view === 'publish' ? 'bg-[#E9B66B] text-[#102D3A]' : 'bg-white/10 text-white'}`}>Publier une offre</button>
          </>}
          {firebaseUser && isPlatformAdmin && <button onClick={() => { setView('adminVerifications'); void loadAdminVerificationQueue(); }} className={`px-4 py-2 rounded-lg text-xs font-bold ${view === 'adminVerifications' ? 'bg-[#E9B66B] text-[#102D3A]' : 'bg-white/10 text-white'}`}>Administration</button>}
        </div>
      </header>

      {firebaseUser && availableOrganizations.length > 1 && <div className="rounded-xl border border-slate-200 bg-white p-3 flex flex-wrap items-center gap-3">
        <label htmlFor="employment-organization" className="text-xs font-bold text-slate-600">Espace entreprise actif</label>
        <select id="employment-organization" value={organization?.id || ''} onChange={e => { void loadWorkspace(e.target.value); }} className="min-w-[220px] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
          {availableOrganizations.map((org: any) => <option key={org.id} value={org.id}>{org.name}</option>)}
        </select>
      </div>}
      {firebaseUser && <section aria-label="Notifications de recrutement" className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2"><Bell className="w-4 h-4 text-[#087F70]" /><h2 className="text-sm font-bold text-[#102D3A]">Notifications</h2>
            {employmentNotifications.some((item) => !item.isRead) && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">{employmentNotifications.filter((item) => !item.isRead).length} non lue(s)</span>}
          </div>
          <button onClick={() => void loadEmploymentNotifications()} className="text-xs font-semibold text-[#087F70]">Actualiser</button>
        </div>
        {employmentNotifications.length === 0 ? <p className="text-xs text-slate-500">Aucune notification pour le moment.</p> :
          <div className="space-y-2">{employmentNotifications.slice(0, 5).map((item) => <article key={item.id} className={`rounded-xl border p-3 ${item.isRead ? 'border-slate-100 bg-slate-50' : 'border-emerald-200 bg-emerald-50/50'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><p className="text-xs font-bold text-[#102D3A]">{item.titleFr || item.titleEn}</p><p className="mt-1 text-xs text-slate-600">{item.bodyFr || item.bodyEn}</p><p className="mt-1 text-[10px] text-slate-400">{item.createdAt ? new Date(item.createdAt).toLocaleString('fr-FR') : ''}</p></div>
              {!item.isRead && <button onClick={() => void markEmploymentNotificationRead(item.id)} className="shrink-0 text-[10px] font-bold text-[#087F70]">Marquer lue</button>}
            </div>
          </article>)}</div>}
      </section>}
      {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</div>}
      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>}

      {view === 'jobs' && <>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-3">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <div className="relative sm:col-span-2 lg:col-span-1"><Search className="absolute left-3 top-3 w-4 h-4 text-slate-400" /><input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && void loadJobs()} placeholder="Métier, compétence ou mot-clé" className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm" /></div>
            <input value={cityFilter} onChange={e => setCityFilter(e.target.value)} onKeyDown={e => e.key === 'Enter' && void loadJobs()} placeholder="Ville (ex. Abidjan)" className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm" />
            <select value={contractFilter} onChange={e => setContractFilter(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm">
              <option value="">Tous les contrats</option><option value="PERMANENT">CDI / Permanent</option><option value="FIXED_TERM">CDD / Durée déterminée</option><option value="TEMPORARY">Intérim / Temporaire</option><option value="PART_TIME">Temps partiel</option><option value="INTERNSHIP">Stage</option><option value="APPRENTICESHIP">Apprentissage</option><option value="SEASONAL">Saisonnier</option><option value="GRADUATE">Jeune diplômé</option><option value="PUBLIC_SERVICE">Fonction publique</option>
            </select>
            <select value={workModeFilter} onChange={e => setWorkModeFilter(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm">
              <option value="">Tous les modes</option><option value="ONSITE">Sur site</option><option value="HYBRID">Hybride</option><option value="REMOTE">À distance</option>
            </select>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-500">Les offres expirées sont automatiquement masquées.</p>
            <div className="flex gap-2">
              <button onClick={() => { setQuery(''); setCityFilter(''); setContractFilter(''); setWorkModeFilter(''); }} className="rounded-xl border border-slate-300 text-slate-600 px-4 py-2.5 text-sm font-semibold">Réinitialiser</button>
              <button onClick={() => void loadJobs()} className="rounded-xl bg-[#087F70] text-white px-5 py-2.5 text-sm font-bold inline-flex items-center justify-center gap-2"><Search className="w-4 h-4" /> Rechercher</button>
            </div>
          </div>
        </div>
        {loading ? <div className="p-10 text-center text-sm text-slate-500">Chargement des offres…</div> : jobs.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"><BriefcaseBusiness className="w-8 h-8 mx-auto text-slate-400 mb-3" /><p className="font-semibold text-slate-700">Aucune offre publiée pour ce pays</p><p className="text-sm text-slate-500 mt-1">Les offres apparaîtront dès que le module Emploi sera activé et que les entreprises publieront leurs annonces.</p></div> :
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">{jobs.map(job => <article key={job.id} className="rounded-2xl border border-slate-200 bg-white p-5 flex flex-col gap-4">
            <div className="space-y-2"><div className="flex items-center justify-between gap-2"><span className="text-[10px] font-bold uppercase tracking-wider text-[#087F70]">{job.contractType.replaceAll('_',' ')}</span><span className="text-[10px] text-slate-500">{job.referenceCode}</span></div><h2 className="font-bold text-lg text-[#102D3A]">{job.title}</h2><div className="flex items-center gap-2 text-xs text-slate-600"><Building2 className="w-3.5 h-3.5" />{job.organizationName}</div><div className="flex items-center gap-2 text-xs text-slate-600"><MapPin className="w-3.5 h-3.5" />{job.city} · {job.countryName}</div><p className="text-sm text-slate-600 line-clamp-4 whitespace-pre-line">{job.description}</p></div>
            <div className="mt-auto border-t border-slate-100 pt-3 flex items-center justify-between gap-2"><span className="text-xs font-semibold text-slate-700">{job.salaryMin || job.salaryMax ? `${job.salaryMin || '—'} – ${job.salaryMax || '—'} ${job.salaryCurrency} / ${job.salaryPeriod.toLowerCase()}` : 'Rémunération à préciser'}</span><button disabled={busy} onClick={() => void openJob(job.id)} className="rounded-lg border border-[#087F70] text-[#087F70] px-3 py-2 text-xs font-bold disabled:opacity-50">Voir le détail</button></div>
          </article>)}</div>}
      </>}

      {view === 'jobDetail' && selectedJob && <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-7 space-y-5">
        <button onClick={() => setView('jobs')} className="text-xs font-bold text-[#087F70]">← Retour aux offres</button>
        <div className="space-y-2">
          <div className="text-xs font-bold uppercase tracking-wider text-[#087F70]">{selectedJob.contractType?.replaceAll('_',' ')} · {selectedJob.workMode?.replaceAll('_',' ')}</div>
          <h2 className="text-2xl font-extrabold text-[#102D3A]">{selectedJob.title}</h2>
          <p className="text-sm text-slate-600">{selectedJob.organizationName} · {selectedJob.city} · {selectedJob.countryName}</p>
          {selectedJob.department && <p className="text-xs text-slate-500">Service : {selectedJob.department}</p>}
          <p className="text-sm text-slate-700 whitespace-pre-line leading-6">{selectedJob.description}</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">Rémunération</div><div className="font-semibold">{selectedJob.salaryMin || selectedJob.salaryMax ? `${selectedJob.salaryMin || '—'} – ${selectedJob.salaryMax || '—'} ${selectedJob.salaryCurrency} / ${String(selectedJob.salaryPeriod || '').toLowerCase()}` : 'À préciser par l’employeur'}</div></div>
          <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">Expérience</div><div className="font-semibold">{selectedJob.experienceLevel || 'Non précisée'}</div></div>
          <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">Référence</div><div className="font-semibold">{selectedJob.referenceCode}</div></div>
          <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">Date limite</div><div className="font-semibold">{selectedJob.applicationDeadline ? new Date(selectedJob.applicationDeadline).toLocaleDateString() : 'Non précisée'}</div></div>
        </div>
        {selectedJob.requiredSkills?.length > 0 && <div><h3 className="font-bold text-sm mb-2">Compétences recherchées</h3><div className="flex flex-wrap gap-2">{selectedJob.requiredSkills.map((skill: string) => <span key={skill} className="rounded-full bg-emerald-50 text-emerald-800 px-3 py-1 text-xs">{skill}</span>)}</div></div>}
        <div className="border-t border-slate-200 pt-4 space-y-3">
          <h3 className="font-bold text-sm">Votre candidature</h3>
          <textarea value={coverLetter} onChange={e => setCoverLetter(e.target.value)} maxLength={5000} rows={5} placeholder="Présentez brièvement votre motivation (facultatif, 5 000 caractères maximum)." className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
          <div className="flex flex-wrap items-center gap-3"><button disabled={busy || !selectedJob.acceptingApplications} onClick={() => void apply(selectedJob.id)} className="rounded-xl bg-[#087F70] text-white px-5 py-3 text-sm font-bold disabled:opacity-50">{busy ? 'Envoi…' : 'Envoyer ma candidature'}</button>{!selectedJob.acceptingApplications && <span className="text-xs font-semibold text-rose-700">Les candidatures sont clôturées.</span>}</div>
        </div>
      </section>}

      {view === 'applications' && <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-7 space-y-4"><div className="flex items-center justify-between"><h2 className="font-bold text-lg text-[#102D3A]">Suivi de mes candidatures</h2><button onClick={() => void loadApplications()} className="text-xs font-semibold text-[#087F70] inline-flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5" /> Actualiser</button></div>{applications.length === 0 ? <p className="text-sm text-slate-500">Aucune candidature à afficher. Connectez-vous puis postulez à une offre.</p> : applications.map(app => <article key={app.id} className="border-t border-slate-100 py-3 space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="font-semibold text-sm">{app.jobTitle}</div><div className="text-xs text-slate-500">{app.organizationName} · {app.jobCity} · {new Date(app.submittedAt).toLocaleDateString()}</div></div><div className="flex items-center gap-2"><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold">{app.status}</span>{['SUBMITTED','REVIEWING','SHORTLISTED','INTERVIEW'].includes(app.status) && <button disabled={busy} onClick={() => void withdrawApplication(app.id)} className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 disabled:opacity-50">Retirer</button>}</div></div><button onClick={() => void toggleApplicationHistory(app.id)} className="text-xs font-semibold text-[#087F70]">{expandedApplicationHistories[app.id] ? 'Masquer l’historique' : 'Voir l’historique'}</button>{expandedApplicationHistories[app.id] && <div className="rounded-lg bg-slate-50 p-3 space-y-2">{(applicationHistories[app.id] || []).length === 0 ? <p className="text-xs text-slate-500">Aucun événement disponible.</p> : (applicationHistories[app.id] || []).map((event: any) => <div key={event.id} className="flex items-start justify-between gap-3 border-b border-slate-200 last:border-0 pb-2 last:pb-0"><div><div className="text-xs font-bold text-slate-700">{String(event.toStatus).replaceAll('_',' ')}</div>{event.note && <p className="text-xs text-slate-500 mt-0.5">{event.note}</p>}</div><time className="text-[10px] text-slate-500 whitespace-nowrap">{new Date(event.createdAt).toLocaleString()}</time></div>)}</div>}</article>)}</section>}

      {view === 'contracts' && <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-7 space-y-4">
        <div className="flex items-center justify-between gap-3"><div><h2 className="font-bold text-lg text-[#102D3A]">Mes contrats</h2><p className="text-sm text-slate-500">Consultez les brouillons et l’état de vos contrats de travail.</p></div><button onClick={() => void loadEmploymentContracts()} className="text-xs font-bold text-[#087F70]">Actualiser</button></div>
        {employmentContracts.length === 0 ? <p className="text-sm text-slate-500">Aucun contrat disponible. Un contrat sera préparé après acceptation de votre proposition.</p> : <div className="space-y-3">{employmentContracts.map(contract => {
          const terms = contract.termsSnapshot || {}; const offer = terms.offer || {}; const template = terms.template || {};
          return <article key={contract.id} className="rounded-xl border border-slate-200 p-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-bold text-sm text-[#102D3A]">{template.title || offer.jobTitle || 'Contrat de travail'}</h3><p className="text-xs text-slate-500">{contract.organizationName} · {contract.countryName} · {contract.language?.toUpperCase()}</p></div><span className="rounded-full bg-amber-50 text-amber-800 px-3 py-1 text-xs font-bold">{contract.status}</span></div>
            <div className="grid sm:grid-cols-2 gap-2 text-xs text-slate-600"><div>Poste : <strong>{offer.jobTitle || '—'}</strong></div><div>Type : <strong>{offer.contractType || '—'}</strong></div><div>Rémunération : <strong>{offer.salaryAmount || '—'} {offer.salaryCurrency || ''} ({offer.salaryBasis === 'NET' ? 'net' : 'brut'})</strong></div><div>Début prévu : <strong>{offer.startDate || '—'}</strong></div><div>Employeur : <strong>{terms.employer?.legalName || contract.organizationName}</strong></div><div>Modèle : <strong>{template.version ? 'v' + template.version : '—'}</strong></div></div>
            <p className="text-[11px] text-amber-800 bg-amber-50 rounded-lg p-3">Brouillon de travail : ce document n’est pas signé et aucune signature électronique n’a été enregistrée.</p>
            {contract.documentStoragePath && <button disabled={busy} onClick={() => void downloadEmploymentContractPdf(contract.id)} className="rounded-lg border border-[#087F70] text-[#087F70] px-3 py-2 text-xs font-bold disabled:opacity-50">Télécharger le PDF sécurisé</button>}
          </article>;
        })}</div>}
      </section>}

      {view === 'offers' && <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-7 space-y-4">
        <div className="flex items-center justify-between gap-3"><div><h2 className="font-bold text-lg text-[#102D3A]">Mes propositions d’embauche</h2><p className="text-xs text-slate-500">Consultez les conditions et répondez avant la date limite.</p></div><button onClick={() => void loadEmploymentOffers()} className="text-xs font-semibold text-[#087F70]">Actualiser</button></div>
        {employmentOffers.length === 0 ? <p className="text-sm text-slate-500">Aucune proposition reçue pour le moment.</p> : employmentOffers.map((offer: any) => <article key={offer.id} className="rounded-xl border border-slate-200 p-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-bold text-sm text-[#102D3A]">{offer.jobTitleSnapshot}</h3><p className="text-xs text-slate-500">{offer.organizationName} · {offer.countryName} · Version {offer.version}</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold">{offer.status}</span></div>
          <div className="grid sm:grid-cols-2 gap-2 text-xs text-slate-700">
            <div>Rémunération ({offer.salaryBasis === 'GROSS' ? 'brute' : 'nette'}) : <strong>{Number(offer.salaryAmount).toLocaleString('fr-FR')} {offer.salaryCurrency} / {offer.payFrequency}</strong></div>
            <div>Début prévu : <strong>{offer.startDate}</strong></div>
            <div>Contrat : <strong>{offer.contractType}</strong></div><div>Lieu : <strong>{offer.workLocation}</strong></div>
            {offer.weeklyHours && <div>Temps de travail : <strong>{offer.weeklyHours} h/semaine</strong></div>}
            {offer.probationDays !== null && <div>Période d’essai : <strong>{offer.probationDays} jour(s)</strong></div>}
          </div>
          {offer.benefits && <p className="text-xs text-slate-600"><strong>Avantages :</strong> {offer.benefits}</p>}
          {offer.additionalConditions && <p className="text-xs text-slate-600 whitespace-pre-line"><strong>Conditions :</strong> {offer.additionalConditions}</p>}
          {offer.localLawNotice && <p className="text-xs text-slate-600 whitespace-pre-line"><strong>Précisions réglementaires de l’employeur :</strong> {offer.localLawNotice}</p>}
          <p className="text-[11px] text-slate-500">Réponse attendue avant le {new Date(offer.expiresAt).toLocaleString('fr-FR')}.</p>
          {offer.status === 'SENT' && <div className="flex flex-wrap gap-2"><button disabled={busy} onClick={() => void respondToEmploymentOffer(offer.id, 'ACCEPTED')} className="rounded-lg bg-[#087F70] px-4 py-2 text-xs font-bold text-white disabled:opacity-50">Accepter la proposition</button><button disabled={busy} onClick={() => void respondToEmploymentOffer(offer.id, 'DECLINED')} className="rounded-lg border border-rose-200 px-4 py-2 text-xs font-bold text-rose-700 disabled:opacity-50">Refuser</button></div>}
          <p className="text-[10px] text-amber-700">Cette réponse ne constitue pas une signature électronique du contrat de travail.</p>
        </article>)}
      </section>}

      {view === 'interviews' && <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-7 space-y-4"><div className="flex items-center justify-between"><h2 className="font-bold text-lg text-[#102D3A]">Mes entretiens</h2><button onClick={() => void loadInterviews()} className="text-xs font-semibold text-[#087F70]">Actualiser</button></div>{interviews.length === 0 ? <p className="text-sm text-slate-500">Aucune invitation à un entretien pour le moment.</p> : interviews.map(interview => <article key={interview.id} className="rounded-xl border border-slate-200 p-4 space-y-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-bold text-sm">{interview.jobTitle}</h3><p className="text-xs text-slate-500">{interview.organizationName} · {new Date(interview.startsAt).toLocaleString()} ({interview.timezone})</p><p className="text-xs text-slate-600 mt-1">{interview.mode} · {interview.locationOrUrl || 'Modalités communiquées par l’entreprise'}</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold">{interview.candidateResponse}</span></div>{interview.status === 'SCHEDULED' && interview.candidateResponse === 'PENDING' && <div className="flex gap-2"><button onClick={() => void respondToInterview(interview.id,'CONFIRMED')} className="rounded-lg bg-[#087F70] text-white px-3 py-2 text-xs font-bold">Confirmer</button><button onClick={() => void respondToInterview(interview.id,'DECLINED')} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold">Décliner</button></div>}{interview.candidateMessage && <p className="text-xs text-slate-500">{interview.candidateMessage}</p>}</article>)}</section>}

      {view === 'profile' && <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-7 space-y-4"><div><h2 className="font-bold text-lg text-[#102D3A]">Mon profil professionnel</h2><p className="text-sm text-slate-500 mt-1">Maîtrisez les informations visibles par les employeurs.</p></div><form onSubmit={saveCandidate} className="grid sm:grid-cols-2 gap-3">
        <input value={candidate.headline} onChange={e => setCandidate({...candidate,headline:e.target.value})} maxLength={160} placeholder="Titre professionnel (ex. Comptable senior)" className="sm:col-span-2 rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
        <input value={candidate.city} onChange={e => setCandidate({...candidate,city:e.target.value})} maxLength={120} placeholder="Ville de résidence" className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
        <input type="number" min="0" max="60" value={candidate.experienceYears} onChange={e => setCandidate({...candidate,experienceYears:e.target.value})} placeholder="Années d'expérience" className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
        <input value={candidate.skillsText} onChange={e => setCandidate({...candidate,skillsText:e.target.value})} placeholder="Compétences séparées par des virgules" className="sm:col-span-2 rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
        <textarea rows={6} maxLength={4000} value={candidate.summary} onChange={e => setCandidate({...candidate,summary:e.target.value})} placeholder="Présentez votre parcours et vos objectifs professionnels…" className="sm:col-span-2 rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
        <select value={candidate.visibility} onChange={e => setCandidate({...candidate,visibility:e.target.value})} className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm"><option value="PRIVATE">Profil privé</option><option value="EMPLOYERS_WITH_APPLICATION">Visible aux employeurs auxquels je candidate</option><option value="PUBLIC">Profil public</option></select>
        <button disabled={busy} type="submit" className="rounded-xl bg-[#087F70] text-white py-3 font-bold text-sm disabled:opacity-50">{busy ? 'Enregistrement…' : 'Enregistrer mon profil'}</button>
      </form><p className="text-xs text-slate-500">Les documents déposés sont stockés en privé et restent en quarantaine tant qu’un antivirus réel n’a pas confirmé leur innocuité. Aucun document n’est rendu public ni téléchargeable par un recruteur avant cette validation.</p><div className="border-t border-slate-200 pt-5 space-y-4">
        <div><h3 className="font-bold text-base text-[#102D3A]">Mes CV et justificatifs</h3><p className="text-xs text-slate-500 mt-1">PDF uniquement · 8 Mo maximum · stockage privé et analyse antivirus requise avant tout accès recruteur.</p></div>
        <form onSubmit={uploadCandidateDocument} className="grid sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
          <label className="text-xs font-semibold text-slate-600">Type de document<select value={documentType} onChange={e => setDocumentType(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"><option value="CV">CV</option><option value="CERTIFICATE">Certificat</option><option value="DIPLOMA">Diplôme</option><option value="OTHER">Autre justificatif</option></select></label>
          <label className="text-xs font-semibold text-slate-600">Fichier PDF<input type="file" accept="application/pdf,.pdf" onChange={e => setDocumentFile(e.target.files?.[0] || null)} className="mt-1 block w-full text-xs file:mr-2 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2" /></label>
          <button disabled={documentBusy || !documentFile} type="submit" className="rounded-lg bg-[#087F70] text-white px-4 py-2.5 text-xs font-bold disabled:opacity-50">{documentBusy ? 'Dépôt…' : 'Déposer en sécurité'}</button>
        </form>
        {candidateDocuments.length === 0 ? <p className="text-sm text-slate-500">Aucun document déposé.</p> : <div className="space-y-2">{candidateDocuments.map(document => <div key={document.id} className="rounded-xl border border-slate-200 p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><div className="text-sm font-bold text-slate-800">{document.originalFileName}</div><div className="text-xs text-slate-500">{document.documentType} · {(document.sizeBytes / 1024 / 1024).toFixed(2)} Mo · {new Date(document.uploadedAt).toLocaleDateString()}</div></div><span className="rounded-full bg-amber-50 text-amber-800 px-3 py-1 text-[10px] font-bold">{document.scanStatus === 'QUARANTINED' ? 'En quarantaine · antivirus en attente' : document.scanStatus}</span></div>
          <div className="flex flex-wrap gap-2 items-center"><select value={documentShareTargets[document.id] || ''} onChange={e => setDocumentShareTargets({...documentShareTargets,[document.id]:e.target.value})} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-2 text-xs"><option value="">Choisir une candidature pour consentement</option>{applications.map(app => <option key={app.id} value={app.id}>{app.jobTitle} · {app.organizationName}</option>)}</select><button disabled={documentBusy || !documentShareTargets[document.id]} onClick={() => void shareCandidateDocument(document.id)} className="rounded-lg border border-[#087F70] text-[#087F70] px-3 py-2 text-xs font-bold disabled:opacity-50">Autoriser le partage</button><button disabled={documentBusy || !documentShareTargets[document.id]} onClick={() => void revokeCandidateDocumentShare(document.id)} className="rounded-lg border border-amber-300 text-amber-800 px-3 py-2 text-xs font-bold disabled:opacity-50">Révoquer</button><button disabled={documentBusy} onClick={() => void deleteCandidateDocument(document.id)} className="rounded-lg border border-rose-200 text-rose-700 px-3 py-2 text-xs font-bold disabled:opacity-50">Supprimer</button></div>
        </div>)}</div>}
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">Important : le dépôt et le consentement ne rendent pas le document visible. Tant qu’un antivirus réel n’a pas marqué le fichier « CLEAN », aucun recruteur ne peut le télécharger.</p>
      </div></section>}

      {view === 'recruiter' && <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-7 space-y-5"><div className="flex items-center justify-between gap-2"><div><h2 className="font-bold text-lg text-[#102D3A]">Tableau de recrutement</h2><p className="text-sm text-slate-500">Offres et candidatures de votre organisation.</p></div><button onClick={() => void loadEmployerJobs()} className="text-xs font-bold text-[#087F70]">Actualiser</button></div>{employerJobs.length === 0 ? <p className="text-sm text-slate-500">Aucune offre pour cette entreprise.</p> : <div className="grid md:grid-cols-2 gap-3">{employerJobs.map(job => <button key={job.id} onClick={() => void loadJobApplications(job.id)} className={`text-left rounded-xl border p-4 ${selectedJobId === job.id ? 'border-[#087F70] bg-emerald-50' : 'border-slate-200'}`}><div className="font-bold text-sm">{job.title}</div><div className="text-xs text-slate-500 mt-1">{job.city} · {job.status} · {job.referenceCode}</div><div className="flex flex-wrap gap-2 mt-3">{Object.entries(job.applicationCounts || {}).map(([status,count]) => <span key={status} className="rounded-full bg-slate-100 px-2 py-1 text-[10px]">{status}: {String(count)}</span>)}</div></button>)}</div>}
        <div className="border-t border-slate-200 pt-4 space-y-3"><div className="flex items-center justify-between gap-2"><h3 className="font-bold text-sm">Contrats de l’entreprise ({employerContracts.length})</h3><button onClick={() => void loadEmployerContractWorkspace()} className="text-xs font-bold text-[#087F70]">Actualiser</button></div>
          {employerContracts.length === 0 ? <p className="text-xs text-slate-500">Aucun brouillon de contrat. Les modèles disponibles dépendent de la validation juridique du pays.</p> : <div className="space-y-2">{employerContracts.map(contract => <div key={contract.id} className="rounded-lg border border-slate-200 p-3 flex flex-wrap justify-between gap-2"><div><div className="text-xs font-bold text-[#102D3A]">{contract.termsSnapshot?.offer?.jobTitle || 'Contrat de travail'}</div><div className="text-[11px] text-slate-500">{contract.termsSnapshot?.candidate?.fullName || 'Candidat'} · {contract.language?.toUpperCase()} · v{contract.templateVersion}</div></div><div className="flex items-center gap-2"><span className="h-fit rounded-full bg-amber-50 text-amber-800 px-2 py-1 text-[10px] font-bold">{contract.status}</span>{contract.documentStoragePath ? <button disabled={busy} onClick={() => void downloadEmploymentContractPdf(contract.id)} className="text-[10px] font-bold text-[#087F70] disabled:opacity-50">PDF</button> : contract.status === 'DRAFT' ? <button disabled={busy} onClick={() => void generateEmploymentContractPdf(contract.id)} className="text-[10px] font-bold text-[#087F70] disabled:opacity-50">Générer PDF</button> : null}</div></div>)}</div>}
          {approvedContractTemplates.length === 0 && <p className="text-[11px] text-amber-800 bg-amber-50 rounded-lg p-3">Aucun modèle juridiquement approuvé n’est disponible pour le pays de cette entreprise. Contactez l’administrateur local après validation par un juriste du pays.</p>}
        </div>
        {selectedJobId && <div className="border-t border-slate-200 pt-4 space-y-3"><h3 className="font-bold text-sm">Candidatures reçues ({jobApplications.length})</h3>{jobApplications.length === 0 ? <p className="text-sm text-slate-500">Aucune candidature reçue pour cette offre.</p> : jobApplications.map(app => <article key={app.id} className="rounded-xl border border-slate-200 p-4 space-y-2"><div className="flex flex-wrap items-center justify-between gap-2"><div><div className="font-bold text-sm">{app.candidateName || app.headline || 'Candidat'}</div><div className="text-xs text-slate-500">{app.headline || 'Profil professionnel'} · {app.city || 'Ville non renseignée'} · {app.experienceYears} an(s) d’expérience</div></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold">{app.status}</span></div>{app.skills?.length > 0 && <div className="text-xs text-slate-600">Compétences : {app.skills.join(', ')}</div>}{app.coverLetter && <p className="text-sm text-slate-600 whitespace-pre-line">{app.coverLetter}</p>}
                <div className="rounded-lg border border-slate-200 p-3 space-y-2"><div className="text-xs font-bold text-slate-700">Documents partagés par le candidat</div>{(applicationDocuments[app.id] || []).length === 0 ? <p className="text-xs text-slate-500">Aucun document partagé pour cette candidature.</p> : (applicationDocuments[app.id] || []).map((doc: any) => <div key={doc.id} className="flex flex-wrap items-center justify-between gap-2 text-xs"><span>{doc.originalFileName} · {doc.scanStatus}</span>{doc.downloadUrl ? <a href={doc.downloadUrl} target="_blank" rel="noreferrer" className="font-bold text-[#087F70] underline">Télécharger</a> : <span className="text-amber-700">Bloqué jusqu’à validation antivirus</span>}</div>)}</div>
                <div className="rounded-lg border border-slate-200 p-3 space-y-3">
                  <div className="text-xs font-bold text-slate-700">Entretiens et évaluations</div>
                  {employerInterviews.filter(interview => interview.applicationId === app.id).length === 0
                    ? <p className="text-xs text-slate-500">Aucun entretien planifié pour ce candidat.</p>
                    : employerInterviews.filter(interview => interview.applicationId === app.id).map(interview => {
                      const draft = evaluationDrafts[interview.id] || {
                        score: String(interview.myEvaluation?.score || 3),
                        recommendation: interview.myEvaluation?.recommendation || 'HOLD',
                        strengths: interview.myEvaluation?.strengths || '',
                        concerns: interview.myEvaluation?.concerns || '',
                      };
                      return <div key={interview.id} className="rounded-lg bg-slate-50 p-3 space-y-2">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div><div className="text-xs font-bold">{new Date(interview.startsAt).toLocaleString()} · {interview.timezone}</div><div className="text-[11px] text-slate-500">{interview.mode} · {interview.candidateResponse} · {interview.status}</div></div>
                          <span className="text-[10px] text-slate-500">{interview.evaluations?.length || 0} évaluation(s)</span>
                        </div>
                        {interview.evaluations?.length > 0 && <div className="space-y-1">{interview.evaluations.map((evaluation: any) => <div key={evaluation.id} className="text-[11px] text-slate-600 border-t border-slate-200 pt-1">Évaluateur · {evaluation.score}/5 · {evaluation.recommendation.replaceAll('_',' ')}{evaluation.strengths ? <div>Points forts : {evaluation.strengths}</div> : null}{evaluation.concerns ? <div>Réserves : {evaluation.concerns}</div> : null}</div>)}</div>}
                        <div className="grid sm:grid-cols-2 gap-2">
                          <label className="text-[11px] text-slate-600">Note / 5<select value={draft.score} onChange={e => setEvaluationDrafts({...evaluationDrafts,[interview.id]:{...draft,score:e.target.value}})} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-xs"><option value="1">1 — Insuffisant</option><option value="2">2 — Faible</option><option value="3">3 — Correct</option><option value="4">4 — Très bien</option><option value="5">5 — Excellent</option></select></label>
                          <label className="text-[11px] text-slate-600">Recommandation<select value={draft.recommendation} onChange={e => setEvaluationDrafts({...evaluationDrafts,[interview.id]:{...draft,recommendation:e.target.value}})} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-xs"><option value="STRONG_YES">Très favorable</option><option value="YES">Favorable</option><option value="HOLD">À revoir</option><option value="NO">Défavorable</option></select></label>
                          <textarea value={draft.strengths} onChange={e => setEvaluationDrafts({...evaluationDrafts,[interview.id]:{...draft,strengths:e.target.value}})} maxLength={3000} rows={2} placeholder="Points forts observés" className="rounded-lg border border-slate-300 px-2 py-2 text-xs" />
                          <textarea value={draft.concerns} onChange={e => setEvaluationDrafts({...evaluationDrafts,[interview.id]:{...draft,concerns:e.target.value}})} maxLength={3000} rows={2} placeholder="Réserves / points à approfondir" className="rounded-lg border border-slate-300 px-2 py-2 text-xs" />
                        </div>
                        <button disabled={busy} onClick={() => void saveInterviewEvaluation(interview.id)} className="rounded-lg bg-[#102D3A] text-white px-3 py-2 text-xs font-bold disabled:opacity-50">{interview.myEvaluation ? 'Mettre à jour mon évaluation' : 'Enregistrer mon évaluation'}</button>
                      </div>;
                    })}
                </div><div className="rounded-lg bg-slate-50 p-3 space-y-2"><div className="text-xs font-bold text-slate-700">Planifier un entretien</div><div className="grid sm:grid-cols-2 gap-2"><input type="datetime-local" value={interviewForm.startsAt} onChange={e => setInterviewForm({...interviewForm,startsAt:e.target.value})} className="rounded-lg border border-slate-300 px-2 py-2 text-xs" /><input type="datetime-local" value={interviewForm.endsAt} onChange={e => setInterviewForm({...interviewForm,endsAt:e.target.value})} className="rounded-lg border border-slate-300 px-2 py-2 text-xs" /><select value={interviewForm.mode} onChange={e => setInterviewForm({...interviewForm,mode:e.target.value})} className="rounded-lg border border-slate-300 px-2 py-2 text-xs"><option value="VIDEO">Visioconférence</option><option value="PHONE">Téléphone</option><option value="ONSITE">Sur site</option></select><input value={interviewForm.locationOrUrl} onChange={e => setInterviewForm({...interviewForm,locationOrUrl:e.target.value})} placeholder="Lien vidéo, téléphone ou adresse" className="rounded-lg border border-slate-300 px-2 py-2 text-xs" /></div><input value={interviewForm.timezone} onChange={e => setInterviewForm({...interviewForm,timezone:e.target.value})} placeholder="Fuseau IANA (ex. Africa/Abidjan)" className="w-full rounded-lg border border-slate-300 px-2 py-2 text-xs" /><button disabled={busy} onClick={() => void scheduleInterview(app.id)} className="rounded-lg bg-[#102D3A] text-white px-3 py-2 text-xs font-bold disabled:opacity-50">Envoyer l’invitation</button></div>{app.status === 'HIRED' && <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 space-y-2">
                  <div className="text-xs font-bold text-slate-700">Préparer le contrat de travail</div>
                  {approvedContractTemplates.filter(t => t.contractType === app.contractType || t.contractType === 'ALL').length === 0
                    ? <p className="text-[11px] text-slate-600">Aucun modèle approuvé correspondant au type de contrat et au pays de l’entreprise.</p>
                    : <><select value={contractTemplateByApplication[app.id] || ''} onChange={e => setContractTemplateByApplication({...contractTemplateByApplication,[app.id]:e.target.value})} className="w-full rounded-lg border border-slate-300 px-2 py-2 text-xs"><option value="">Choisir un modèle approuvé</option>{approvedContractTemplates.filter(t => t.contractType === app.contractType || t.contractType === 'ALL').map(t => <option key={t.id} value={t.id}>{t.title} · {t.language.toUpperCase()} · v{t.version}</option>)}</select><button disabled={busy || !contractTemplateByApplication[app.id]} onClick={() => void createEmploymentContractDraft(app.id)} className="rounded-lg bg-[#102D3A] text-white px-3 py-2 text-xs font-bold disabled:opacity-50">Créer le brouillon</button></>}
                  <p className="text-[10px] text-amber-800">Le brouillon reprend les conditions de l’offre acceptée. Il ne sera ni signé ni activé automatiquement.</p>
                </div>}
                {app.status === 'OFFER' && <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3 space-y-2">
                  <div className="text-xs font-bold text-slate-700">Proposition d’embauche</div>
                  <div className="grid sm:grid-cols-2 gap-2">
                    <label className="text-[11px] text-slate-600">Salaire proposé<input type="number" min="0.01" step="0.01" value={offerDraft.salaryAmount} onChange={e => setOfferDraft({...offerDraft,salaryAmount:e.target.value})} placeholder="Montant" className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-xs" /></label>
                    <label className="text-[11px] text-slate-600">Base salariale<select value={offerDraft.salaryBasis} onChange={e => setOfferDraft({...offerDraft,salaryBasis:e.target.value})} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-xs"><option value="GROSS">Brut</option><option value="NET">Net</option></select></label>
                    <label className="text-[11px] text-slate-600">Périodicité<select value={offerDraft.payFrequency} onChange={e => setOfferDraft({...offerDraft,payFrequency:e.target.value})} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-xs"><option value="HOUR">Par heure</option><option value="WEEK">Par semaine</option><option value="MONTH">Par mois</option><option value="YEAR">Par an</option></select></label>
                    <label className="text-[11px] text-slate-600">Date de début<input type="date" value={offerDraft.startDate} onChange={e => setOfferDraft({...offerDraft,startDate:e.target.value})} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-xs" /></label>
                    <label className="text-[11px] text-slate-600">Lieu de travail<input maxLength={240} value={offerDraft.workLocation} onChange={e => setOfferDraft({...offerDraft,workLocation:e.target.value})} placeholder="Ville / adresse / télétravail" className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-xs" /></label>
                    <label className="text-[11px] text-slate-600">Heures par semaine<input type="number" min="1" max="168" step="0.5" value={offerDraft.weeklyHours} onChange={e => setOfferDraft({...offerDraft,weeklyHours:e.target.value})} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-xs" /></label>
                    <label className="text-[11px] text-slate-600">Période d’essai (jours)<input type="number" min="0" max="365" value={offerDraft.probationDays} onChange={e => setOfferDraft({...offerDraft,probationDays:e.target.value})} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-xs" /></label>
                    <label className="text-[11px] text-slate-600">Délai de réponse (jours)<input type="number" min="1" max="30" value={offerDraft.expiresInDays} onChange={e => setOfferDraft({...offerDraft,expiresInDays:e.target.value})} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-xs" /></label>
                  </div>
                  <textarea maxLength={3000} rows={2} value={offerDraft.benefits} onChange={e => setOfferDraft({...offerDraft,benefits:e.target.value})} placeholder="Avantages" className="w-full rounded-lg border border-slate-300 px-2 py-2 text-xs" />
                  <textarea maxLength={5000} rows={2} value={offerDraft.additionalConditions} onChange={e => setOfferDraft({...offerDraft,additionalConditions:e.target.value})} placeholder="Conditions particulières" className="w-full rounded-lg border border-slate-300 px-2 py-2 text-xs" />
                  <textarea maxLength={3000} rows={2} value={offerDraft.localLawNotice} onChange={e => setOfferDraft({...offerDraft,localLawNotice:e.target.value})} placeholder="Précisions réglementaires vérifiées pour le pays (facultatif)" className="w-full rounded-lg border border-slate-300 px-2 py-2 text-xs" />
                  <p className="text-[10px] text-amber-800">La devise est définie par le pays de l’offre. Vérifiez les conditions au regard du droit local. Cette proposition n’est pas un contrat signé.</p>
                  <button disabled={busy} onClick={() => void sendEmploymentOffer(app.id)} className="rounded-lg bg-[#087F70] text-white px-3 py-2 text-xs font-bold disabled:opacity-50">Envoyer la proposition</button>
                </div>}
<div className="flex flex-wrap gap-2">{(app.status === 'SUBMITTED' ? ['REVIEWING','REJECTED'] : app.status === 'REVIEWING' ? ['SHORTLISTED','INTERVIEW','REJECTED'] : app.status === 'SHORTLISTED' ? ['INTERVIEW','OFFER','REJECTED'] : app.status === 'INTERVIEW' ? ['OFFER','REJECTED'] : app.status === 'OFFER' ? ['REJECTED'] : []).map(next => <button key={next} onClick={() => void changeApplicationStatus(app.id,next)} className="rounded-lg bg-[#087F70] text-white px-3 py-2 text-xs font-bold">{next === 'REVIEWING' ? 'Examiner' : next === 'SHORTLISTED' ? 'Présélectionner' : next === 'INTERVIEW' ? 'Entretien' : next === 'OFFER' ? 'Proposer embauche' : next === 'HIRED' ? 'Recruté' : 'Refuser'}</button>)}</div></article>)}</div>}
      </section>}

      {view === 'adminVerifications' && <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-7 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold text-lg text-[#102D3A]">Contrôle des entreprises</h2><p className="text-sm text-slate-500">File de validation réservée aux administrateurs plateforme et administrateurs locaux de leur pays.</p></div><button onClick={() => void loadAdminVerificationQueue()} className="text-xs font-bold text-[#087F70]">Actualiser</button></div>
        {adminQueueLoading ? <p className="text-sm text-slate-500">Chargement de la file sécurisée…</p> : adminVerifications.length === 0 ? <p className="text-sm text-slate-500">Aucun dossier à afficher. Si votre compte n’a pas le rôle administrateur requis, l’API refusera l’accès.</p> : <div className="space-y-3">{adminVerifications.map(item => {
          const draft = adminReviewDrafts[item.id] || { note: '', evidenceReference: '' };
          return <article key={item.id} className="rounded-xl border border-slate-200 p-4 space-y-3">
            <div className="flex flex-wrap justify-between gap-2"><div><h3 className="font-bold text-sm text-[#102D3A]">{item.organizationName || item.legalName}</h3><p className="text-xs text-slate-500">{item.legalName} · {item.countryIso2} · {item.registrationNumber}</p><p className="text-xs text-slate-500">{item.contactName} · {item.contactEmail}</p></div><span className="h-fit rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800">{item.status}</span></div>
            <textarea rows={2} maxLength={2000} value={draft.note} onChange={e => setAdminReviewDrafts({...adminReviewDrafts,[item.id]:{...draft,note:e.target.value}})} placeholder="Note de décision / informations demandées" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs" />
            <input maxLength={300} value={draft.evidenceReference} onChange={e => setAdminReviewDrafts({...adminReviewDrafts,[item.id]:{...draft,evidenceReference:e.target.value}})} placeholder="Référence du registre officiel ou justificatif consulté (obligatoire pour valider)" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs" />
            <div className="flex flex-wrap gap-2"><button disabled={busy} onClick={() => void reviewEmployerVerification(item.id,'VERIFY')} className="rounded-lg bg-emerald-700 text-white px-3 py-2 text-xs font-bold disabled:opacity-50">Valider avec preuve</button><button disabled={busy} onClick={() => void reviewEmployerVerification(item.id,'REQUEST_INFO')} className="rounded-lg border border-amber-400 text-amber-800 px-3 py-2 text-xs font-bold disabled:opacity-50">Demander des infos</button><button disabled={busy} onClick={() => void reviewEmployerVerification(item.id,'REJECT')} className="rounded-lg border border-rose-300 text-rose-700 px-3 py-2 text-xs font-bold disabled:opacity-50">Refuser</button></div>
          </article>;
        })}</div>}
        <p className="text-xs text-slate-500">La validation est une décision humaine. La référence de preuve est conservée dans le journal interne et n’est pas exposée à l’entreprise.</p>
      </section>}
      {view === 'employerVerification' && <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-7 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-bold text-lg text-[#102D3A]">Vérification de l’entreprise</h2><p className="text-sm text-slate-500 mt-1">La vérification protège les candidats contre les offres publiées par des entreprises non contrôlées.</p></div><button onClick={() => void loadEmployerVerification()} className="text-xs font-bold text-[#087F70] inline-flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5" /> Actualiser</button></div>
        {!organization ? <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">Vous devez d’abord disposer d’un espace entreprise pour déposer un dossier.</div> : <>
          <div className="rounded-xl border border-slate-200 p-4 flex items-center justify-between gap-3"><div><div className="text-xs text-slate-500">Statut du dossier</div><div className="font-bold text-sm mt-1">{employerVerification?.status === 'VERIFIED' ? 'Entreprise vérifiée' : employerVerification?.status === 'REJECTED' ? 'Dossier refusé' : employerVerification?.status === 'MORE_INFO_REQUIRED' ? 'Informations complémentaires requises' : employerVerification?.status === 'PENDING' ? 'En cours de vérification' : 'Non soumis'}</div></div><span className={'rounded-full px-3 py-1 text-xs font-bold ' + (employerVerification?.status === 'VERIFIED' ? 'bg-emerald-100 text-emerald-800' : employerVerification?.status === 'REJECTED' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800')}>{employerVerification?.status || 'NOT_SUBMITTED'}</span></div>
          {employerVerification?.reviewNote && <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700"><strong>Retour de l’administration :</strong> {employerVerification.reviewNote}</div>}
          {employerVerification?.status === 'VERIFIED' ? <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-sm text-emerald-800">Votre entreprise est vérifiée. Vous pouvez publier des offres d’emploi sous réserve de l’activation du module dans votre pays.</div> : <form onSubmit={submitEmployerVerification} className="grid sm:grid-cols-2 gap-3">
            <label className="text-xs font-semibold text-slate-600">Raison sociale<input required minLength={2} maxLength={180} value={verificationForm.legalName} onChange={e => setVerificationForm({...verificationForm,legalName:e.target.value})} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal" placeholder="Nom légal de l’entreprise" /></label>
            <label className="text-xs font-semibold text-slate-600">Numéro d’immatriculation<input required minLength={3} maxLength={100} value={verificationForm.registrationNumber} onChange={e => setVerificationForm({...verificationForm,registrationNumber:e.target.value})} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal" placeholder="RCCM, registre national, etc." /></label>
            <label className="text-xs font-semibold text-slate-600">Nom du contact<input required minLength={2} maxLength={120} value={verificationForm.contactName} onChange={e => setVerificationForm({...verificationForm,contactName:e.target.value})} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal" placeholder="Responsable légal ou RH" /></label>
            <label className="text-xs font-semibold text-slate-600">E-mail professionnel<input required type="email" maxLength={254} value={verificationForm.contactEmail} onChange={e => setVerificationForm({...verificationForm,contactEmail:e.target.value})} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal" placeholder="contact@entreprise.com" /></label>
            <div className="sm:col-span-2 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">Ce formulaire transmet les informations déclaratives. Les justificatifs officiels et le contrôle auprès des registres nationaux seront traités dans une étape sécurisée distincte. Une déclaration seule ne constitue pas une validation légale.</div>
            <button disabled={busy || verificationLoading} type="submit" className="sm:col-span-2 rounded-xl bg-[#087F70] text-white py-3 font-bold text-sm disabled:opacity-50">{busy ? 'Transmission…' : employerVerification?.status ? 'Mettre à jour mon dossier' : 'Soumettre pour vérification'}</button>
          </form>}
        </>}
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
