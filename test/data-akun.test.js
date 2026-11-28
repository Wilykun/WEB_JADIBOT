// Halaman DATA_AKUN (admin saja): menu di bawah Backup, kartu data akun
// (PP, nama, email, sandi sementara + tanggal, tombol salin, ikon SVG),
// terkunci untuk member (notifikasi di layar), data realtime tiap 15 detik.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import fs from 'node:fs';
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
const appJs = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const serverJs = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('DATA_AKUN: menu di bawah Backup + halaman dengan kartu akun dan pencarian', () => {
  const backupIdx = html.indexOf('id="backup-nav"');
  const dataAkunIdx = html.indexOf('id="data-akun-nav"');
  const botcontrolIdx = html.indexOf('id="botcontrol-nav"');
  assert.ok(backupIdx > 0 && dataAkunIdx > 0 && botcontrolIdx > 0, 'ketiga menu admin harus ada');
  assert.ok(backupIdx < dataAkunIdx && dataAkunIdx < botcontrolIdx, 'menu DATA_AKUN harus di bawah Backup dan di atas Kontrol Bot');
  assert.ok(html.includes('href="#data-akun"'), 'menu DATA_AKUN harus menaut ke #data-akun');
  assert.ok(html.includes('>DATA_AKUN<'), 'menu harus bernama DATA_AKUN');
  assert.ok(html.includes('id="data-akun"'), 'seksi DATA_AKUN harus ada');
  assert.ok(html.includes('data-page-view="data-akun"'), 'seksi harus punya data-page-view data-akun');
  assert.ok(html.includes('id="data-akun-title"'), 'seksi harus punya judul DATA_AKUN');
  assert.ok(html.includes('id="data-akun-list"'), 'daftar akun harus ada');
  assert.ok(html.includes('id="data-akun-search"'), 'pencarian akun harus ada');
  assert.ok(html.includes('id="data-akun-updated"'), 'penanda waktu pembaruan harus ada');
  assert.ok(html.includes('Sandi utama TIDAK PERNAH bisa ditampilkan'), 'halaman harus menjelaskan sandi utama tidak bisa ditampilkan');
  assert.ok(css.includes('.data-akun-card'), 'kartu akun harus punya gaya');
  assert.ok(css.includes('.data-akun-avatar'), 'avatar akun harus punya gaya');
  assert.ok(css.includes('.data-akun-copy'), 'tombol salin harus punya gaya');
  assert.ok(css.includes('.data-akun-row'), 'baris data harus punya gaya');
  assert.ok(css.includes('@media(max-width:560px){.data-akun-card-head'), 'kartu harus rapi di HP');
});

test('DATA_AKUN klien: judul halaman + kunci member + muat realtime + salin', () => {
  assert.ok(appJs.includes("'data-akun': 'DATA_AKUN'"), 'judul halaman DATA_AKUN harus ada di daftar judul');
  assert.ok(appJs.includes("(page === 'data-akun' && currentUser?.role !== 'admin')"), 'halaman DATA_AKUN harus dijaga lewat peran');
  assert.ok(appJs.includes("showLockedNotice(page === 'backup' ? 'Backup' : page === 'data-akun' ? 'DATA_AKUN' : 'Kontrol Bot')"), 'member yang membuka DATA_AKUN harus melihat notifikasi terkunci');
  assert.ok(appJs.includes("document.querySelector('#data-akun-nav')"), 'menu DATA_AKUN harus diatur saat login');
  assert.ok(appJs.includes("document.querySelector('#data-akun')?.classList.toggle('hidden', !isAdmin)"), 'seksi DATA_AKUN harus disembunyikan total untuk member');
  assert.ok(appJs.includes('function loadDataAkun()'), 'fungsi muat DATA_AKUN harus ada');
  assert.ok(appJs.includes('function buildDataAkunCard('), 'fungsi bangun kartu akun harus ada');
  assert.ok(appJs.includes("api('/api/admin/data-akun')"), 'halaman harus mengambil data dari endpoint admin');
  assert.ok(appJs.includes('function startDataAkunPolling()'), 'fungsi polling DATA_AKUN harus ada');
  assert.ok(appJs.includes("if (page === 'data-akun') {"), 'halaman harus dimuat saat dibuka');
  assert.ok(appJs.includes('void loadDataAkun();'), 'halaman harus dimuat saat dibuka');
  assert.ok(appJs.includes('function applyDataAkunFilter()'), 'fungsi filter pencarian harus ada');
  assert.ok(appJs.includes('navigator.clipboard.writeText(button.dataset.copyText'), 'tombol salin harus menyalin ke clipboard');
  assert.ok(appJs.includes("'Sandi sementara'"), 'kartu harus menampilkan sandi sementara');
  assert.ok(appJs.includes("'Sandi terakhir diganti'"), 'kartu harus menampilkan tanggal sandi diganti');
  assert.ok(appJs.includes("'Sandi utama'"), 'kartu harus menampilkan baris sandi utama');
  assert.ok(appJs.includes('Tidak dapat ditampilkan (tersimpan sebagai hash keamanan)'), 'sandi utama harus dijelaskan hanya hash');
});

test('DATA_AKUN server: endpoint admin saja + sandi sementara + tanggal, tanpa sandi utama', () => {
  assert.ok(serverJs.includes("route === 'GET /api/admin/data-akun'"), 'endpoint DATA_AKUN harus ada');
  assert.ok(serverJs.includes('function readAccountPasswordReset('), 'server harus bisa membaca catatan sandi sementara per akun');
  const endpoint = serverJs.match(/if \(route === 'GET \/api\/admin\/data-akun'\) \{[\s\S]*?\n  \}/);
  assert.ok(endpoint, 'endpoint DATA_AKUN harus bisa diekstrak');
  assert.ok(endpoint[0].includes("if (user.role !== 'admin') return sendError(res, 403, 'Akses admin diperlukan.')"), 'endpoint harus menolak member (403)');
  assert.ok(endpoint[0].includes('tempPassword:'), 'endpoint harus mengembalikan sandi sementara');
  assert.ok(endpoint[0].includes('passwordChangedAt:'), 'endpoint harus mengembalikan tanggal sandi diganti');
  assert.ok(endpoint[0].includes('tempPasswordAt:'), 'endpoint harus mengembalikan tanggal sandi sementara diminta');
  assert.ok(endpoint[0].includes('resetAt:'), 'endpoint harus mengembalikan tanggal reset selesai');
  assert.ok(!endpoint[0].includes('passwordHash'), 'endpoint TIDAK BOLEH mengembalikan hash sandi utama');
  assert.ok(!endpoint[0].includes('tempPasswordHash'), 'endpoint TIDAK BOLEH mengembalikan hash sandi sementara');
});

function fixtureUser(username, email, role, password) {
  const salt = randomBytes(16).toString('hex');
  const passwordHash = scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex');
  return { id: randomUUID(), username, email, displayName: username, avatar: 'avatar-06', role, salt, passwordHash, verified: true, createdAt: new Date().toISOString() };
}

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function cookiesFrom(response) {
  const setCookie = response.headers.getSetCookie?.() || [];
  return setCookie.map((entry) => entry.split(';')[0]).join('; ');
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
  return { status: response.status, payload, cookie: cookiesFrom(response) };
}

test('server DATA_AKUN: tanpa login 401, member 403, admin 200 dengan sandi sementara + tanggal', { timeout: 60_000 }, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'readsw-data-akun-test-'));
  const root = path.join(temp, 'project');
  const dataDir = path.join(root, 'runtime-data');
  const adminPassword = 'FixtureAdmin-Only-Password!';
  const memberPassword = 'FixtureMember-Only-Password!';
  let child;
  try {
    await mkdir(root, { recursive: true });
    await cp(path.join(sourceRoot, 'server'), path.join(root, 'server'), { recursive: true });
    await cp(path.join(sourceRoot, 'public'), path.join(root, 'public'), { recursive: true });
    await cp(path.join(sourceRoot, 'package.json'), path.join(root, 'package.json'));
    await symlink(path.join(sourceRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir');
    await mkdir(dataDir, { recursive: true });
    const admin = fixtureUser('fixtureadmin', 'fixtureadmin@example.test', 'admin', adminPassword);
    const member = fixtureUser('fixturemember', 'fixturemember@example.test', 'member', memberPassword);
    member.passwordChangedAt = '2026-11-28T06:00:00.000Z';
    member.tempPasswordAt = '2026-11-28T06:38:34.248Z';
    await writeFile(path.join(dataDir, 'store.json'), JSON.stringify({
      users: [admin, member], pendingRegistrations: [], bots: [], sessions: [], pairingLogs: [], loginHistory: [],
    }));
    // Catatan sandi sementara per akun (seperti yang ditulis Lupa sandi).
    const memberDir = path.join(root, 'DATA_AKUN', 'MEMBER', 'fixturemember');
    await mkdir(memberDir, { recursive: true });
    await writeFile(path.join(memberDir, 'password-reset.json'), JSON.stringify({
      tempPassword: 'TempPass01', tempPasswordAt: '2026-11-28T06:38:34.248Z', status: 'done', resetAt: '2026-11-28T06:40:00.000Z',
    }));
    const port = await unusedPort();
    const base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [path.join(root, 'server/index.js')], {
      cwd: root,
      env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), PANEL_DATA_DIR: 'runtime-data', SESSION_SECRET: randomBytes(48).toString('base64url'), NODE_ENV: 'test', BOOTSTRAP_ADMIN_USERNAME: 'fixtureadmin' },
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

    // Tanpa login -> 401.
    const noAuth = await jsonRequest(base, '/api/admin/data-akun');
    assert.equal(noAuth.status, 401, 'tanpa login harus 401');

    // Login member -> 403.
    const memberLogin = await jsonRequest(base, '/api/auth/login', { method: 'POST', body: { identifier: 'fixturemember', password: memberPassword } });
    assert.equal(memberLogin.status, 200, 'login member harus 200');
    const memberDenied = await jsonRequest(base, '/api/admin/data-akun', { cookie: memberLogin.cookie });
    assert.equal(memberDenied.status, 403, 'member harus 403');

    // Login admin -> 200 dengan data lengkap.
    const adminLogin = await jsonRequest(base, '/api/auth/login', { method: 'POST', body: { identifier: 'fixtureadmin', password: adminPassword } });
    assert.equal(adminLogin.status, 200, 'login admin harus 200');
    const adminOk = await jsonRequest(base, '/api/admin/data-akun', { cookie: adminLogin.cookie });
    assert.equal(adminOk.status, 200, 'admin harus 200');
    assert.ok(Array.isArray(adminOk.payload.accounts), 'harus mengembalikan daftar akun');
    assert.equal(adminOk.payload.accounts.length, 2, 'harus ada 2 akun');
    const memberRow = adminOk.payload.accounts.find((row) => row.username === 'fixturemember');
    assert.ok(memberRow, 'member harus ada di daftar');
    assert.equal(memberRow.email, 'fixturemember@example.test', 'email member harus utuh (bukan disensor)');
    assert.equal(memberRow.tempPassword, 'TempPass01', 'sandi sementara member harus tampil');
    assert.equal(memberRow.tempPasswordAt, '2026-11-28T06:38:34.248Z', 'tanggal sandi sementara diminta harus akurat');
    assert.equal(memberRow.passwordChangedAt, '2026-11-28T06:00:00.000Z', 'tanggal sandi diganti harus akurat');
    assert.equal(memberRow.resetAt, '2026-11-28T06:40:00.000Z', 'tanggal reset selesai harus akurat');
    assert.equal(memberRow.resetStatus, 'done', 'status reset harus tampil');
    assert.ok(!('passwordHash' in memberRow), 'hash sandi utama TIDAK BOLEH bocor');
    assert.ok(!('tempPasswordHash' in memberRow), 'hash sandi sementara TIDAK BOLEH bocor');
    const adminRow = adminOk.payload.accounts.find((row) => row.username === 'fixtureadmin');
    assert.ok(adminRow, 'admin harus ada di daftar');
    assert.equal(adminRow.tempPassword, null, 'admin tanpa catatan reset harus null sandi sementaranya');
    assert.equal(adminRow.isMainAdmin, true, 'admin bootstrap harus ditandai Admin Utama');
  } finally {
    if (child) child.kill();
    await rm(temp, { recursive: true, force: true });
  }
});
