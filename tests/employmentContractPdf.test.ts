import assert from 'node:assert/strict';
import test from 'node:test';
import { renderEmploymentContractDraftPdf } from '../src/server/employmentContractPdf.ts';

const terms = {
  template: { title: 'Contrat de travail', language: 'fr', body: 'Entre {{employer.legalName}} et {{candidate.fullName}}.\nPoste : {{offer.jobTitle}}.' },
  employer: { legalName: 'Société Étoile', registrationNumber: 'RCCM-001' },
  candidate: { fullName: 'Amélie Martin', email: 'amelie@example.test' },
  country: { name: 'Côte d’Ivoire', iso2: 'CI' },
  offer: { jobTitle: 'Technicienne de laboratoire', contractType: 'PERMANENT', salaryAmount: '500000', salaryBasis: 'GROSS', salaryCurrency: 'XOF', payFrequency: 'MONTH', startDate: '2027-01-01', workLocation: 'Abidjan', weeklyHours: '40', probationDays: 30 },
};

test('renders a valid PDF draft with a non-signature disclaimer and substituted terms', () => {
  const pdf = renderEmploymentContractDraftPdf(terms);
  const text = pdf.toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.ok(text.includes('/Type /Catalog'));
  assert.ok(text.includes(Buffer.from('BROUILLON').toString('hex').toUpperCase()));
  assert.ok(text.includes('Société Étoile') === false); // text is safely encoded as WinAnsi hex
  assert.ok(text.includes('C9')); // É in WinAnsi
  assert.ok(!text.includes(Buffer.from('NOT SIGNED').toString('hex').toUpperCase())); // French disclaimer is used
});

test('rejects Arabic until an embedded Arabic font and shaping engine are configured', () => {
  assert.throws(() => renderEmploymentContractDraftPdf({
    ...terms, template: { ...terms.template, language: 'ar' },
  }), /Arabic PDF generation requires/);
});

test('rejects unresolved or unsupported template placeholders', () => {
  assert.throws(() => renderEmploymentContractDraftPdf({
    ...terms, template: { ...terms.template, body: 'Unknown {{candidate.passportNumber}}' },
  }), /Unsupported template placeholder/);
});
