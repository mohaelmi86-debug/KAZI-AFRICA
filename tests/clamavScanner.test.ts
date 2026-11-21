import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import test from 'node:test';
import { scanBufferWithClamAv } from '../src/server/clamavScanner.ts';

async function withFakeClamAv(reply: string | null, run: (config: { host: string; port: number; timeoutMs: number }) => Promise<void>) {
  const server = net.createServer((socket) => {
    let request = Buffer.alloc(0);
    socket.on('data', (chunk) => { request = Buffer.concat([request, chunk]); });
    socket.on('end', () => {
      assert.ok(request.subarray(0, 10).equals(Buffer.from('zINSTREAM\0')));
      if (reply !== null) socket.end(reply);
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    await run({ host: '127.0.0.1', port: address.port, timeoutMs: 100 });
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('ClamAV explicit OK verdict returns CLEAN', async () => {
  await withFakeClamAv('stream: OK\0', async (config) => {
    assert.equal(await scanBufferWithClamAv(Buffer.from('%PDF-1.7 test'), config), 'CLEAN');
  });
});

test('ClamAV FOUND verdict returns INFECTED', async () => {
  await withFakeClamAv('stream: Eicar-Test-Signature FOUND\0', async (config) => {
    assert.equal(await scanBufferWithClamAv(Buffer.from('%PDF-1.7 test'), config), 'INFECTED');
  });
});

test('unknown scanner response fails closed', async () => {
  await withFakeClamAv('unexpected response\0', async (config) => {
    await assert.rejects(scanBufferWithClamAv(Buffer.from('%PDF-1.7 test'), config), /ClamAV scan failed/);
  });
});

test('scanner timeout fails closed', async () => {
  await withFakeClamAv(null, async (config) => {
    await assert.rejects(scanBufferWithClamAv(Buffer.from('%PDF-1.7 test'), config), /timed out/);
  });
});

test('empty and oversized documents are rejected before network access', async () => {
  const config = { host: '127.0.0.1', port: 1, timeoutMs: 100 };
  await assert.rejects(scanBufferWithClamAv(Buffer.alloc(0), config), /size is outside/);
  await assert.rejects(scanBufferWithClamAv(Buffer.alloc(8 * 1024 * 1024 + 1), config), /size is outside/);
});
