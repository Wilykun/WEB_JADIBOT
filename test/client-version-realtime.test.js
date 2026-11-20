import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fixtureUser(username, email, role, password) {
  const salt = randomBytes(16).toString('hex');
  const passwordHash = scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex');
  return { id: randomUUID(), username, email, displayName: username, avatar: 'avatar-01', role, salt, passwordHash, verified: true, createdAt: new Date().toISOString() };
}

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function jsonRequest(base, route, { method = 'GET', body, cookie } = {}) {
  const headers = { Origin: base, Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`${base}${route}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5000),
  });
  const payload = await response.json();
  return { status: response.status, payload, cookie: response.headers.get('set-cookie')?.split(';')[0] || null };
}

test('heartbeat mengembalikan versi klien dari index.html dan berubah tanpa restart', { timeout: 30_000 }, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'readsw-client-version-test-'));
  const root = path.join(temp, 'project');
  const dataDir = path.join(root, 'runtime-data');
  const memberPassword = 'FixtureMember-Only-Password!';
  const secret = randomBytes(48).toString('base64url');
  let child;
  try {
    await mkdir(root, { recursive: true });
    await cp(path.join(sourceRoot, 'server'), path.join(root, 'server'), { recursive: true });
    await cp(path.join(sourceRoot, 'public'), path.join(root, 'public'), { recursive: true });
    await cp(path.join(sourceRoot, 'package.json'), path.join(root, 'package.json'));
    await symlink(path.join(sourceRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir');
    await mkdir(dataDir, { recursive: true });
    const member = fixtureUser('fixturemember', 'fixturemember@example.test', 'member', memberPassword);
    await writeFile(path.join(dataDir, 'store.json'), JSON.stringify({
      users: [member], pendingRegistrations: [], bots: [], sessions: [], pairingLogs: [], loginHistory: [],
    }));
    const port = await unusedPort();
    const base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [path.join(root, 'server/index.js')], {
      cwd: root,
      env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), PANEL_DATA_DIR: 'runtime-data', SESSION_SECRET: secret, NODE_ENV: 'test' },
      stdio: 'ignore',
    });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`fixture server exited with code ${child.exitCode}`);
      try {
        const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) });
        if (response.ok) { ready = true; break; }
      } catch { /* Wait briefly for local fixture startup. */ }
      await wait(100);
    }
    assert.equal(ready, true, 'isolated fixture server should start');
    const login = await jsonRequest(base, '/api/auth/login', { method: 'POST', body: { identifier: 'fixturemember', password: memberPassword } });
    assert.equal(login.status, 200, 'login member harus berhasil');
    const indexHtml = await readFile(path.join(root, 'public', 'index.html'), 'utf8');
    const deployedVersion = indexHtml.match(/\/app\.js\?v=([^"'\s&]+)/)[1];
    const first = await jsonRequest(base, '/api/me/heartbeat', { method: 'POST', body: {}, cookie: login.cookie });
    assert.equal(first.status, 200, 'heartbeat harus 200');
    assert.equal(first.payload.ok, true, 'heartbeat harus ok');
    assert.equal(first.payload.version, deployedVersion, 'heartbeat harus mengembalikan versi dari ?v= app.js');

    // Mengubah ?v= di index.html (seperti deploy checkout) harus langsung
    // terbaca heartbeat berikutnya tanpa restart server. Ganti kemunculan
    // app.js-nya saja: nilai ?v= yang sama juga dipakai style.css.
    const bumpedHtml = indexHtml.replace(`/app.js?v=${deployedVersion}`, '/app.js?v=sim-version-bump-1');
    await writeFile(path.join(root, 'public', 'index.html'), bumpedHtml);
    const second = await jsonRequest(base, '/api/me/heartbeat', { method: 'POST', body: {}, cookie: login.cookie });
    assert.equal(second.payload.version, 'sim-version-bump-1', 'heartbeat harus membaca versi baru dari disk tanpa restart');
  } finally {
    if (child) child.kill('SIGTERM');
    await rm(temp, { recursive: true, force: true });
  }
});

test('klien memeriksa versi tiap heartbeat dan memuat ulang sendiri bila tidak dipakai', async () => {
  const js = await readFile(path.join(sourceRoot, 'public', 'app.js'), 'utf8');
  const server = await readFile(path.join(sourceRoot, 'server', 'index.js'), 'utf8');
  assert.ok(server.includes('function getClientVersion()'), 'server harus punya penolong versi klien');
  assert.ok(server.includes("return sendJson(res, 200, { ok: true, version: getClientVersion(), latestLoginAt });"), 'heartbeat harus mengembalikan versi klien dan login terbaru akun lain');
  assert.ok(js.includes('const loadedClientVersion'), 'klien harus membaca versinya sendiri dari tag script');
  assert.ok(js.includes('function checkClientVersion(serverVersion)'), 'klien harus punya pemeriksa versi');
  assert.ok(js.includes('checkClientVersion(result?.version)'), 'heartbeat harus memanggil pemeriksa versi');
  assert.ok(js.includes('function isClientIdleForReload()'), 'klien harus memeriksa sedang tidak dipakai sebelum muat ulang');
  assert.ok(js.includes("title: 'Versi baru tersedia'"), 'tawaran versi baru harus berjudul Versi baru tersedia');
  assert.ok(js.includes("addLabel: 'Muat ulang'"), 'tawaran versi baru harus punya tombol Muat ulang');
  assert.ok(js.includes('onAdd: () => location.reload()'), 'tombol Muat ulang harus memuat ulang halaman');
  assert.ok(js.includes("} else if (noticeContext?.kind === 'version') {"), 'dismiss harus punya cabang khusus untuk tawaran versi');
  assert.ok(js.includes('newVersionPrompted = noticeContext.version'), 'tawaran versi yang ditutup harus diingat per versi');
  // Kondisi tidak dipakai: tidak ada overlay terbuka dan tidak sedang mengetik.
  assert.ok(js.includes("if (!document.querySelector('#emoji-notice-overlay')?.classList.contains('hidden')) return false;"), 'overlay terbuka berarti tidak boleh muat ulang otomatis');
  assert.ok(js.includes("if (document.querySelector('.confirm-overlay')) return false;"), 'dialog konfirmasi terbuka berarti tidak boleh muat ulang otomatis');
  assert.ok(js.includes("active.tagName === 'INPUT'"), 'kolom input yang fokus berarti tidak boleh muat ulang otomatis');
});

test('menu tetap terbuka setelah notifikasi menu terkunci ditutup', async () => {
  const js = await readFile(path.join(sourceRoot, 'public', 'app.js'), 'utf8');
  // Penutup menu lewat klik di luar menu harus mengabaikan ketukan di atas overlay modal.
  assert.ok(js.includes("if (event.target.closest?.('#emoji-notice-overlay, .confirm-overlay')) return;"), 'klik di atas overlay tidak boleh menutup menu');
  // Escape saat overlay terbuka hanya menutup overlay, bukan menunya.
  assert.ok(js.includes("document.querySelector('#emoji-notice-overlay:not(.hidden)')"), 'Escape harus memeriksa overlay notifikasi sebelum menutup menu');
});

test('entri Info Update terbaru kini soal angka notif tanpa batas', async () => {
  const data = JSON.parse(await readFile(path.join(sourceRoot, 'public', 'info-updates.json'), 'utf8'));
  const html = await readFile(path.join(sourceRoot, 'public', 'index.html'), 'utf8');
  assert.equal(data.updates.length, 81, 'daftar harus 78 entri');
  const newest = data.updates[0];
  assert.equal(newest.title, 'Angka notif Log Bot dan Obrolan kini tanpa batas', 'entri terbaru harus soal perbaikan kolom ketik Obrolan');
  assert.equal(newest.tag, 'Perbaikan', 'entri terbaru harus bertag Perbaikan');
  assert.equal(newest.day, 'Jumat, 20 Nov 2026', 'hari entri terbaru harus cocok');
  assert.ok(html.includes('<li class="info-update-item" data-tag="perbaikan">'), 'fallback harus memakai slug perbaikan untuk entri terbaru');
  assert.ok(html.includes('<h4>Angka notif Log Bot dan Obrolan kini tanpa batas</h4>'), 'fallback harus memuat judul entri terbaru');

  // Entri notifikasi menu terkunci sebelumnya kini di posisi kedua puluh; deskripsinya
  // menyebut menunya tetap terbuka setelah notifikasi ditutup.
  const locked = data.updates[19];
  assert.equal(locked.title, 'Member yang mengetuk menu terkunci kini melihat notifikasi di layar', 'entri notifikasi menu terkunci kini di posisi kedua puluh');
  assert.match(locked.description, /Menunya tetap terbuka setelah notifikasi ditutup/, 'deskripsi harus menyebut menu tetap terbuka');
});
