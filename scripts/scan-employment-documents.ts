import 'dotenv/config';
import crypto from 'node:crypto';
import { and, eq, lt, or } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import { candidateDocuments } from '../src/db/schema.ts';
import { getPrivateEmploymentBucket } from '../src/lib/firebase-admin.ts';
import { MAX_EMPLOYMENT_DOCUMENT_BYTES, scanBufferWithClamAv, type ClamAvConfig } from '../src/server/clamavScanner.ts';

function requiredClamAvConfig() {
  const host = process.env.CLAMAV_HOST?.trim();
  const port = Number(process.env.CLAMAV_PORT || 3310);
  const timeoutMs = Number(process.env.CLAMAV_TIMEOUT_MS || 20_000);
  if (!host) throw new Error('CLAMAV_HOST is required; document scanning is disabled');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('CLAMAV_PORT must be a valid TCP port');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120_000) throw new Error('CLAMAV_TIMEOUT_MS must be between 1000 and 120000');
  return { host, port, timeoutMs };
}

async function processDocument(documentId: string, scannerConfig: ClamAvConfig) {
  const [claimed] = await db.update(candidateDocuments)
    .set({ scanStatus: 'SCANNING', updatedAt: new Date() })
    .where(and(
      eq(candidateDocuments.id, documentId),
      or(
        eq(candidateDocuments.scanStatus, 'QUARANTINED'),
        and(eq(candidateDocuments.scanStatus, 'SCANNING'), lt(candidateDocuments.updatedAt, new Date(Date.now() - 15 * 60_000)))
      )
    ))
    .returning();

  if (!claimed) return 'SKIPPED' as const;

  try {
    const [buffer] = await getPrivateEmploymentBucket().file(claimed.storagePath).download();
    if (!Buffer.isBuffer(buffer) || buffer.length !== claimed.sizeBytes || buffer.length > MAX_EMPLOYMENT_DOCUMENT_BYTES) {
      throw new Error('Stored document size does not match trusted metadata');
    }
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    if (sha256 !== claimed.sha256) throw new Error('Stored document SHA-256 mismatch');
    if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
      await db.update(candidateDocuments).set({ scanStatus: 'REJECTED', updatedAt: new Date() })
        .where(and(eq(candidateDocuments.id, claimed.id), eq(candidateDocuments.scanStatus, 'SCANNING')));
      return 'REJECTED' as const;
    }

    const verdict = await scanBufferWithClamAv(buffer, scannerConfig);
    const scanStatus = verdict === 'CLEAN' ? 'CLEAN' : 'REJECTED';
    await db.update(candidateDocuments).set({ scanStatus, updatedAt: new Date() })
      .where(and(eq(candidateDocuments.id, claimed.id), eq(candidateDocuments.scanStatus, 'SCANNING')));
    return scanStatus;
  } catch (error) {
    // Fail closed: a scanner/storage/verification error never promotes a file to CLEAN.
    await db.update(candidateDocuments).set({ scanStatus: 'QUARANTINED', updatedAt: new Date() })
      .where(and(eq(candidateDocuments.id, claimed.id), eq(candidateDocuments.scanStatus, 'SCANNING')));
    throw error;
  }
}

async function main() {
  const scannerConfig = requiredClamAvConfig(); // Validate before claiming any document.
  const batchSize = Math.min(50, Math.max(1, Number(process.env.EMPLOYMENT_SCAN_BATCH_SIZE || 10)));
  if (!Number.isInteger(batchSize)) throw new Error('EMPLOYMENT_SCAN_BATCH_SIZE must be an integer');

  const staleBefore = new Date(Date.now() - 15 * 60_000);
  const candidates = await db.select({ id: candidateDocuments.id })
    .from(candidateDocuments)
    .where(or(
      eq(candidateDocuments.scanStatus, 'QUARANTINED'),
      and(eq(candidateDocuments.scanStatus, 'SCANNING'), lt(candidateDocuments.updatedAt, staleBefore))
    ))
    .limit(batchSize);

  let clean = 0;
  let rejected = 0;
  let errors = 0;
  for (const candidate of candidates) {
    try {
      const result = await processDocument(candidate.id, scannerConfig);
      if (result === 'CLEAN') clean += 1;
      else if (result === 'REJECTED') rejected += 1;
    } catch (error) {
      errors += 1;
      console.error(JSON.stringify({ event: 'EMPLOYMENT_DOCUMENT_SCAN_ERROR', documentId: candidate.id, message: error instanceof Error ? error.message : 'Unknown error' }));
    }
  }
  console.log(JSON.stringify({ event: 'EMPLOYMENT_DOCUMENT_SCAN_BATCH_COMPLETED', selected: candidates.length, clean, rejected, errors }));
  if (errors > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error('Employment document scanner stopped safely:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
