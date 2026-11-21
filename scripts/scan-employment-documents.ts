import 'dotenv/config';
import net from 'node:net';
import crypto from 'node:crypto';
import { and, eq, lt, or } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import { candidateDocuments } from '../src/db/schema.ts';
import { getPrivateEmploymentBucket } from '../src/lib/firebase-admin.ts';

const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const CHUNK_BYTES = 64 * 1024;

type ScanVerdict = 'CLEAN' | 'INFECTED';

function requiredClamAvConfig() {
  const host = process.env.CLAMAV_HOST?.trim();
  const port = Number(process.env.CLAMAV_PORT || 3310);
  const timeoutMs = Number(process.env.CLAMAV_TIMEOUT_MS || 20_000);
  if (!host) throw new Error('CLAMAV_HOST is required; document scanning is disabled');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('CLAMAV_PORT must be a valid TCP port');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120_000) throw new Error('CLAMAV_TIMEOUT_MS must be between 1000 and 120000');
  return { host, port, timeoutMs };
}

/** Sends bytes to a private ClamAV clamd daemon using INSTREAM. No file is sent to a third party. */
export function scanBufferWithClamAv(buffer: Buffer, config = requiredClamAvConfig()): Promise<ScanVerdict> {
  if (!buffer.length || buffer.length > MAX_DOCUMENT_BYTES) return Promise.reject(new Error('Document size is outside the accepted range'));
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: config.host, port: config.port });
    let response = '';
    let settled = false;
    const finish = (error?: Error, verdict?: ScanVerdict) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(verdict!);
    };

    socket.setTimeout(config.timeoutMs);
    socket.once('timeout', () => finish(new Error('ClamAV scan timed out')));
    socket.once('error', (error) => finish(new Error(`ClamAV connection failed: ${error.message}`)));
    socket.on('data', (chunk: Buffer) => {
      response += chunk.toString('utf8');
      if (response.length > 4096) return finish(new Error('ClamAV returned an oversized response'));
      if (!response.includes('\0') && !response.endsWith('\\n')) return;
      const result = response.replace(/\0/g, '').trim();
      if (result.endsWith(' OK')) return finish(undefined, 'CLEAN');
      if (result.includes(' FOUND')) return finish(undefined, 'INFECTED');
      finish(new Error(`ClamAV scan failed: ${result.slice(0, 300)}`));
    });

    socket.once('connect', () => {
      socket.write(Buffer.from('zINSTREAM\0', 'ascii'));
      for (let offset = 0; offset < buffer.length; offset += CHUNK_BYTES) {
        const chunk = buffer.subarray(offset, Math.min(offset + CHUNK_BYTES, buffer.length));
        const length = Buffer.allocUnsafe(4);
        length.writeUInt32BE(chunk.length, 0);
        socket.write(length);
        socket.write(chunk);
      }
      const terminator = Buffer.alloc(4);
      socket.end(terminator);
    });
  });
}

async function processDocument(documentId: string, scannerConfig: ReturnType<typeof requiredClamAvConfig>) {
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
    if (!Buffer.isBuffer(buffer) || buffer.length !== claimed.sizeBytes || buffer.length > MAX_DOCUMENT_BYTES) {
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
