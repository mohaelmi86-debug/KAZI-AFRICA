/**
 * Minimal server-side PDF renderer for employment contract drafts.
 * Uses the built-in WinAnsi Helvetica font; Arabic shaping/embedded fonts are
 * intentionally rejected until a proper font pipeline is configured.
 */
const WIN_ANSI_OVERRIDES: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85,
  '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a,
  '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92,
  '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c,
  'ž': 0x9e, 'Ÿ': 0x9f,
};

function toWinAnsiHex(value: string): string {
  return Array.from(value).map((character) => {
    const code = WIN_ANSI_OVERRIDES[character] ?? character.codePointAt(0)!;
    if (code > 255) return '3F';
    return code.toString(16).padStart(2, '0').toUpperCase();
  }).join('');
}

function wrapText(value: string, maxLength = 92): string[] {
  const result: string[] = [];
  for (const paragraph of value.replace(/\r/g, '').split('\n')) {
    if (!paragraph.trim()) { result.push(''); continue; }
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      if (!line) line = word;
      else if ((line + ' ' + word).length <= maxLength) line += ' ' + word;
      else { result.push(line); line = word; }
    }
    if (line) result.push(line);
  }
  return result;
}

function interpolateTemplate(template: string, terms: Record<string, any>): string {
  const values: Record<string, string> = {
    'employer.legalName': String(terms.employer?.legalName || ''),
    'employer.registrationNumber': String(terms.employer?.registrationNumber || ''),
    'candidate.fullName': String(terms.candidate?.fullName || ''),
    'candidate.email': String(terms.candidate?.email || ''),
    'country.name': String(terms.country?.name || ''),
    'country.iso2': String(terms.country?.iso2 || ''),
    'offer.jobTitle': String(terms.offer?.jobTitle || ''),
    'offer.contractType': String(terms.offer?.contractType || ''),
    'offer.salaryAmount': String(terms.offer?.salaryAmount || ''),
    'offer.salaryBasis': String(terms.offer?.salaryBasis || ''),
    'offer.salaryCurrency': String(terms.offer?.salaryCurrency || ''),
    'offer.payFrequency': String(terms.offer?.payFrequency || ''),
    'offer.startDate': String(terms.offer?.startDate || ''),
    'offer.workLocation': String(terms.offer?.workLocation || ''),
    'offer.weeklyHours': String(terms.offer?.weeklyHours ?? ''),
    'offer.probationDays': String(terms.offer?.probationDays ?? ''),
    'offer.benefits': String(terms.offer?.benefits || ''),
    'offer.additionalConditions': String(terms.offer?.additionalConditions || ''),
    'offer.localLawNotice': String(terms.offer?.localLawNotice || ''),
  };
  const rendered = template.replace(/\{\{\s*([a-zA-Z.]+)\s*\}\}/g, (_match, key: string) => {
    if (!(key in values)) throw new Error(`Unsupported template placeholder: ${key}`);
    return values[key];
  });
  if (/\{\{[^}]+\}\}/.test(rendered)) throw new Error('Unresolved template placeholders remain');
  return rendered;
}

export function renderEmploymentContractDraftPdf(terms: Record<string, any>): Buffer {
  const language = String(terms.template?.language || '').toLowerCase();
  if (language === 'ar') throw new Error('Arabic PDF generation requires an embedded Arabic font and text shaping pipeline');
  if (!['fr', 'en', 'pt'].includes(language)) throw new Error('Unsupported contract PDF language');

  const title = String(terms.template?.title || 'Employment contract draft');
  const body = interpolateTemplate(String(terms.template?.body || ''), terms);
  const lines = [
    title,
    '',
    language === 'fr' ? 'BROUILLON — NON SIGNÉ' : language === 'pt' ? 'RASCUNHO — NÃO ASSINADO' : 'DRAFT — NOT SIGNED',
    '',
    ...wrapText(body),
    '',
    language === 'fr'
      ? 'Document de travail généré à partir d’un modèle approuvé. Ce PDF ne constitue pas une signature électronique.'
      : language === 'pt'
        ? 'Documento de trabalho gerado a partir de um modelo aprovado. Este PDF não constitui uma assinatura eletrónica.'
        : 'Working document generated from an approved template. This PDF is not an electronic signature.',
    `Generated: ${new Date().toISOString()}`,
  ];

  const pageLines: string[][] = [];
  for (let index = 0; index < lines.length; index += 48) pageLines.push(lines.slice(index, index + 48));
  const objects: string[] = [];
  const pageIds = pageLines.map((_page, index) => 4 + index * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';

  pageLines.forEach((page, index) => {
    const pageId = pageIds[index];
    const contentId = pageId + 1;
    const commands = ['BT', '/F1 10 Tf', '48 790 Td', '14 TL'];
    page.forEach((line, lineIndex) => {
      if (lineIndex > 0) commands.push('T*');
      commands.push(`<${toWinAnsiHex(line)}> Tj`);
    });
    commands.push('ET');
    const stream = commands.join('\n');
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
  });

  let pdf = '%PDF-1.4\n%âãÏÓ\n';
  const offsets: number[] = [0];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
