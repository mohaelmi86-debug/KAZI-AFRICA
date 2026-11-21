import net from 'node:net';

export const MAX_EMPLOYMENT_DOCUMENT_BYTES = 8 * 1024 * 1024;
const CHUNK_BYTES = 64 * 1024;

export interface ClamAvConfig {
  host: string;
  port: number;
  timeoutMs: number;
}

export type ClamAvVerdict = 'CLEAN' | 'INFECTED';

export function scanBufferWithClamAv(buffer: Buffer, config: ClamAvConfig): Promise<ClamAvVerdict> {
  if (!buffer.length || buffer.length > MAX_EMPLOYMENT_DOCUMENT_BYTES) {
    return Promise.reject(new Error('Document size is outside the accepted range'));
  }

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: config.host, port: config.port });
    let response = '';
    let settled = false;

    const finish = (error?: Error, verdict?: ClamAvVerdict) => {
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
      if (!response.includes('\\0') && !response.endsWith('\\n')) return;
      const result = response.replace(/\\0/g, '').trim();
      if (result.endsWith(' OK')) return finish(undefined, 'CLEAN');
      if (result.includes(' FOUND')) return finish(undefined, 'INFECTED');
      finish(new Error(`ClamAV scan failed: ${result.slice(0, 300)}`));
    });

    socket.once('connect', () => {
      socket.write(Buffer.from('zINSTREAM\\0', 'ascii'));
      for (let offset = 0; offset < buffer.length; offset += CHUNK_BYTES) {
        const chunk = buffer.subarray(offset, Math.min(offset + CHUNK_BYTES, buffer.length));
        const length = Buffer.allocUnsafe(4);
        length.writeUInt32BE(chunk.length, 0);
        socket.write(length);
        socket.write(chunk);
      }
      socket.end(Buffer.alloc(4));
    });
  });
}
