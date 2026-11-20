import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProxyAgent, getProxyUrl, getWhatsAppProxyAgent } from '../server/proxy-agent.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Fake proxy lokal: tangkap request CONNECT, jawab 200, lalu tutup koneksi
// (TLS ke server palsu pasti gagal — yang dicek cuma baris CONNECT-nya).
function fakeProxyServer(onRequest) {
  const server = net.createServer((socket) => {
    socket.on('data', (chunk) => {
      onRequest(chunk.toString());
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      socket.destroy();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout: ${label}`)), ms)),
  ]);
}

test('tanpa proxy / URL tidak valid: agent undefined (koneksi langsung buat PC/VPS)', () => {
  assert.equal(createProxyAgent(''), undefined);
  assert.equal(createProxyAgent(null), undefined);
  assert.equal(createProxyAgent('bukan url'), undefined);
  assert.equal(createProxyAgent('http://'), undefined);
});

test('URL proxy tanpa auth: agent terbentuk dengan createConnection', () => {
  const agent = createProxyAgent('http://hatch-egress-proxy:3128');
  assert.ok(agent);
  assert.equal(typeof agent.createConnection, 'function');
});

test('CONNECT ke proxy: kirim host tujuan + auth saat URL punya kredensial', async () => {
  let request = '';
  const server = await fakeProxyServer((text) => { request = text; });
  const port = server.address().port;
  try {
    const agent = createProxyAgent(`http://user:pass@127.0.0.1:${port}`);
    const error = await withTimeout(
      new Promise((resolve) => {
        agent.createConnection(
          { host: 'example.com', port: 443, servername: 'example.com' },
          (err) => resolve(err),
        );
      }),
      10000,
      'createConnection callback',
    );
    assert.ok(request.includes('CONNECT example.com:443 HTTP/1.1'), `baris CONNECT salah: ${request}`);
    assert.ok(request.includes('Host: example.com:443'), `header Host hilang: ${request}`);
    assert.ok(request.includes('Proxy-Authorization: Basic '), `header auth hilang: ${request}`);
    // TLS ke server palsu pasti gagal; yang penting callback terpanggil.
    assert.ok(error instanceof Error, 'callback harus terpanggil dengan error');
  } finally {
    server.close();
  }
});

test('CONNECT ke proxy tanpa auth: tidak ada header Proxy-Authorization', async () => {
  let request = '';
  const server = await fakeProxyServer((text) => { request = text; });
  const port = server.address().port;
  try {
    const agent = createProxyAgent(`http://127.0.0.1:${port}`);
    await withTimeout(
      new Promise((resolve) => {
        agent.createConnection(
          { host: 'example.com', port: 443, servername: 'example.com' },
          () => resolve(),
        );
      }),
      10000,
      'createConnection callback',
    );
    assert.ok(request.includes('CONNECT example.com:443 HTTP/1.1'));
    assert.ok(!request.includes('Proxy-Authorization'), `auth tidak boleh dikirim: ${request}`);
  } finally {
    server.close();
  }
});

test('getWhatsAppProxyAgent: pakai env HTTPS_PROXY kalau ada', () => {
  const saved = process.env.HTTPS_PROXY;
  const savedLower = process.env.https_proxy;
  try {
    process.env.HTTPS_PROXY = 'http://127.0.0.1:3128';
    delete process.env.https_proxy;
    assert.equal(getProxyUrl(), 'http://127.0.0.1:3128');
    const agent = getWhatsAppProxyAgent();
    assert.ok(agent);
    assert.equal(typeof agent.createConnection, 'function');
  } finally {
    if (saved === undefined) delete process.env.HTTPS_PROXY;
    else process.env.HTTPS_PROXY = saved;
    if (savedLower === undefined) delete process.env.https_proxy;
    else process.env.https_proxy = savedLower;
  }
});

test('pairing-manager: kedua makeWASocket pakai agent proxy WhatsApp', async () => {
  const managerJs = await fs.readFile(path.join(ROOT, 'server', 'pairing-manager.js'), 'utf8');
  assert.ok(
    managerJs.includes("import { getWhatsAppProxyAgent } from './proxy-agent.js';"),
    'pairing-manager harus import proxy-agent',
  );
  const hits = managerJs.split('agent: getWhatsAppProxyAgent(),').length - 1;
  assert.equal(hits, 2, `harus ada 2 makeWASocket dengan agent proxy, ketemu ${hits}`);
  assert.ok(managerJs.includes('makeWASocket({'), 'makeWASocket harus tetap dipakai');
});
