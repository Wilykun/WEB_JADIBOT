// Performa muat halaman: file statis dikirim terkompres (gzip), aset yang
// sudah berversi (?v=...) boleh disimpan browser selama setahun, halaman HTML
// tidak pernah di-cache, dan pustaka nomor telepon (252 KB) hanya dimuat saat
// halaman Pairing dibuka — bukan di halaman login.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

test('pustaka nomor telepon tidak dimuat di halaman login, hanya saat Pairing dibuka', () => {
  const html = read('public/index.html');
  assert.ok(!html.includes('<script src="/vendor/libphonenumber-max.js"'), 'halaman login tidak boleh memuat libphonenumber di awal');
  const js = read('public/app.js');
  assert.ok(js.includes('function ensureLibphonenumber()'), 'harus ada pemuat malas pustaka nomor telepon');
  assert.ok(js.includes("script.src = '/vendor/libphonenumber-max.js?v=libphone-20261117';"), 'pustaka harus dimuat malas dengan nomor versi agar bisa di-cache');
  assert.ok(js.includes("if (page === 'pairing') {\n    void ensureLibphonenumber();\n  }"), 'membuka Pairing harus memicu muat pustaka nomor telepon');
  assert.ok(!js.includes('function updatePhoneNumberPreview(value) {\n  void ensureLibphonenumber();'), 'pratinjau nomor tidak boleh memicu muat pustaka sendiri — fungsi itu juga dipanggil sekali saat boot halaman login');
  assert.ok(js.includes('window.libphonenumber?.parsePhoneNumberFromString'), 'parsing nomor harus tetap aman bila pustaka belum selesai dimuat');
});

test('server mengompres aset statis dan meng-cache aset berversi', () => {
  const server = read('server/index.js');
  assert.ok(server.includes("import { gzipSync } from 'node:zlib';"), 'server harus memakai gzip dari node:zlib');
  assert.ok(server.includes("res.setHeader('Cache-Control', !isHtmlPage && url.searchParams.has('v') ? 'public, max-age=31536000, immutable' : 'no-store');"), 'aset berversi harus immutable setahun, sisanya no-store');
  assert.ok(server.includes("const isHtmlPage = ['/', '/privacy', '/dmca', '/terms'].includes(url.pathname);"), 'halaman HTML tidak boleh ikut immutable walau ada ?v=');
  assert.ok(server.includes("res.setHeader('Content-Encoding', 'gzip');"), 'jawaban gzip harus menandai Content-Encoding');
  assert.ok(server.includes("res.setHeader('Vary', 'Accept-Encoding');"), 'jawaban gzip harus menandai Vary');
});

test('server menyajikan aset terkompres dan ter-cache sesuai aturan', { timeout: 60_000 }, async () => {
  const { spawn } = await import('node:child_process');
  const { mkdtemp, mkdir, cp, symlink, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { randomBytes } = await import('node:crypto');
  const temp = await mkdtemp(path.join(tmpdir(), 'readsw-perf-test-'));
  const project = path.join(temp, 'project');
  const dataDir = path.join(project, 'runtime-data');
  let child;
  try {
    await mkdir(project, { recursive: true });
    await cp(path.join(root, 'server'), path.join(project, 'server'), { recursive: true });
    await cp(path.join(root, 'public'), path.join(project, 'public'), { recursive: true });
    await cp(path.join(root, 'package.json'), path.join(project, 'package.json'));
    await symlink(path.join(root, 'node_modules'), path.join(project, 'node_modules'), 'dir');
    await mkdir(dataDir, { recursive: true });
    await writeFile(path.join(dataDir, 'store.json'), JSON.stringify({
      users: [], pendingRegistrations: [], bots: [], sessions: [], pairingLogs: [], loginHistory: [],
    }));
    const port = 31000 + Math.floor(Math.random() * 1000);
    const base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [path.join(project, 'server/index.js')], {
      cwd: project,
      env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), PANEL_DATA_DIR: 'runtime-data', SESSION_SECRET: randomBytes(48).toString('base64url'), NODE_ENV: 'test' },
      stdio: 'ignore',
    });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`fixture server exited with code ${child.exitCode}`);
      try {
        const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) });
        if (response.ok) { ready = true; break; }
      } catch { /* Tunggu server fixture sebentar. */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(ready, true, 'isolated fixture server should start');

    const { get } = await import('node:http');
    // fetch bawaan Node otomatis membuka gzip dan menyembunyikan header
    // Content-Encoding — pakai http.get mentah supaya jawaban yang diukur
    // adalah yang benar-benar dikirim server.
    const rawGet = (requestPath, headers = {}, method = 'GET') => new Promise((resolve, reject) => {
      const request = get(`${base}${requestPath}`, { headers, method }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
        response.on('error', reject);
      });
      request.on('error', reject);
    });

    const appJs = readFileSync(path.join(root, 'public', 'app.js'));

    const gzipped = await rawGet('/app.js', { 'Accept-Encoding': 'gzip' });
    assert.equal(gzipped.status, 200, 'app.js harus 200');
    assert.equal(gzipped.headers['content-encoding'], 'gzip', 'app.js harus dikirim sebagai gzip bila browser memintanya');
    assert.equal(gzipped.headers.vary, 'Accept-Encoding', 'jawaban gzip harus menandai Vary');
    assert.match(gzipped.headers['cache-control'] || '', /no-store/, 'app.js tanpa versi harus tetap no-store');
    assert.ok(gzipped.body.length < appJs.length * 0.6, 'app.js terkompres harus jauh lebih kecil dari aslinya');
    assert.deepEqual(gunzipSync(gzipped.body), appJs, 'isi gzip harus sama persis dengan file aslinya');

    const plain = await rawGet('/app.js', { 'Accept-Encoding': 'identity' });
    assert.equal(plain.headers['content-encoding'], undefined, 'tanpa Accept-Encoding gzip, jawaban tidak boleh gzip');
    assert.equal(plain.body.length, appJs.length, 'isi tanpa gzip harus utuh');

    const versioned = await rawGet('/app.js?v=log-bot-badge-20261120', { 'Accept-Encoding': 'gzip' });
    assert.match(versioned.headers['cache-control'] || '', /public, max-age=31536000, immutable/, 'app.js berversi harus immutable setahun');
    assert.equal(versioned.headers['content-encoding'], 'gzip', 'app.js berversi tetap boleh gzip');

    const versionedCss = await rawGet('/style.css?v=log-bot-badge-20261120');
    assert.match(versionedCss.headers['cache-control'] || '', /immutable/, 'style.css berversi harus immutable');

    const home = await rawGet('/?v=rankbotovertake-20261118', { 'Accept-Encoding': 'gzip' });
    assert.match(home.headers['cache-control'] || '', /no-store/, 'halaman utama tidak boleh immutable walau ada ?v=');
    assert.equal(home.headers['content-encoding'], 'gzip', 'halaman utama tetap boleh gzip');

    const image = await rawGet('/og-image.png', { 'Accept-Encoding': 'gzip' });
    assert.equal(image.headers['content-encoding'], undefined, 'gambar PNG tidak boleh gzip (sudah terkompres)');
    assert.match(image.headers['cache-control'] || '', /no-store/, 'gambar tanpa versi harus tetap no-store');

    const head = await rawGet('/app.js', { 'Accept-Encoding': 'gzip' }, 'HEAD');
    assert.equal(head.headers['content-encoding'], undefined, 'HEAD tidak boleh gzip');
    assert.equal(Number(head.headers['content-length']), appJs.length, 'HEAD harus melaporkan panjang asli');

    const phoneLib = await rawGet('/vendor/libphonenumber-max.js?v=libphone-20261117');
    assert.equal(phoneLib.status, 200, 'pustaka nomor telepon malas harus tetap bisa diunduh');
    assert.match(phoneLib.headers['cache-control'] || '', /immutable/, 'pustaka nomor telepon berversi harus immutable');

    const api = await rawGet('/api/health', { 'Accept-Encoding': 'gzip' });
    assert.equal(api.headers['content-encoding'], undefined, 'jawaban API tidak ikut gzip');
    assert.match(api.headers['cache-control'] || '', /no-store/, 'jawaban API harus tetap no-store');
  } finally {
    if (child && child.exitCode === null) child.kill('SIGTERM');
    await rm(temp, { recursive: true, force: true });
  }
});

test('entri Info Update panel lebih cepat ada di posisi keenam belas', () => {
  const data = JSON.parse(read('public/info-updates.json'));
  const html = read('public/index.html');
  const entry = data.updates.find((item) => item.title === 'Panel kini memuat jauh lebih cepat');
  assert.ok(entry, 'entri panel lebih cepat harus tetap ada');
  assert.equal(data.updates.indexOf(entry), 44, 'entri panel lebih cepat kini di posisi ketujuh belas');
  assert.equal(entry.title, 'Panel kini memuat jauh lebih cepat', 'entri terbaru harus soal panel yang lebih cepat');
  assert.equal(entry.tag, 'Perbaikan', 'entri harus bertag Perbaikan');
  assert.equal(entry.time, '21.50 WIB', 'waktu entri harus 21.50 WIB');
  assert.match(entry.description, /gzip/, 'deskripsi harus menyebut gzip');
  assert.match(entry.description, /200 KB/, 'deskripsi harus menyebut unduhan awal sekitar 200 KB');
  assert.match(entry.description, /Tidak ada fitur yang berubah/, 'deskripsi harus menegaskan fitur tidak berubah');
  assert.equal(data.updates.length, 104, 'daftar harus 74 entri');
  assert.equal(data.updatedAt, '2026-11-22T22:00:30+07:00', 'updatedAt harus sama dengan waktu entri terbaru');
  assert.ok(html.includes('<h4>Panel kini memuat jauh lebih cepat</h4>'), 'fallback HTML harus memuat entri panel lebih cepat');
  assert.ok(html.includes('Selasa, 17 Nov 2026 · 21.50 WIB'), 'fallback meta harus cocok dengan entri terbaru');
});
