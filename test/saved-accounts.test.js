// Akun tersimpan per perangkat (ronde 42): pemilih akun di halaman Masuk dan
// Lupa sandi — akun yang pernah masuk dari browser ini tampil dengan avatar
// dan waktu terakhir masuk, ketuk untuk masuk cepat tanpa ketik email/sandi.
// Browser lain tidak melihatnya (cookie perangkat, bukan localStorage).
// Plus notif toast di bawah kalau sandi akun baru diganti (realtime, WIB).
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

test('ronde 42: pemilih akun tersimpan ada di halaman Masuk dan Lupa sandi', () => {
  assert.ok(html.includes('id="saved-accounts"'), 'pemilih akun harus ada di halaman Masuk');
  assert.ok(html.includes('id="saved-accounts-list"'), 'daftar akun tersimpan harus ada');
  assert.ok(html.includes('Pilih akun'), 'pemilih akun harus berjudul Pilih akun');
  assert.ok(html.includes('id="saved-accounts-other"'), 'harus ada tombol Masuk dengan akun lain');
  assert.ok(html.includes('Masuk dengan akun lain'), 'tombol akun lain harus bernama Masuk dengan akun lain');
  assert.ok(html.includes('id="forgot-saved-accounts"'), 'pemilih email harus ada di halaman Lupa sandi');
  assert.ok(html.includes('id="forgot-saved-accounts-list"'), 'daftar email tersimpan harus ada');
  assert.ok(html.includes('Akun tersimpan di browser ini'), 'pemilih email harus menjelaskan akun tersimpan di browser ini');
  assert.ok(css.includes('.saved-accounts-list'), 'daftar akun harus punya gaya');
  assert.ok(css.includes('overflow-y:auto'), 'daftar akun harus bisa di-scroll');
  assert.ok(css.includes('.saved-account-card'), 'kartu akun harus punya gaya');
  assert.ok(css.includes('.saved-account-avatar'), 'avatar akun harus punya gaya');
  assert.ok(css.includes('.saved-account-remove'), 'tombol hapus akun harus punya gaya');
  assert.ok(appJs.includes('function loadSavedAccounts()'), 'fungsi muat akun tersimpan harus ada');
  assert.ok(appJs.includes('function buildSavedAccountCard('), 'fungsi bangun kartu akun harus ada');
  assert.ok(appJs.includes('function quickLoginSavedAccount('), 'fungsi masuk cepat harus ada');
  assert.ok(appJs.includes("api('/api/auth/saved-accounts')"), 'pemilih harus mengambil daftar dari server');
  assert.ok(appJs.includes("api('/api/auth/quick-login'"), 'masuk cepat harus memanggil quick-login');
  assert.ok(appJs.includes("api('/api/auth/saved-accounts/remove'"), 'hapus akun tersimpan harus memanggil endpoint hapus');
  assert.ok(appJs.includes('void loadSavedAccounts();'), 'pemilih harus dimuat saat halaman auth tampil');
  assert.ok(appJs.includes('function maybeShowPasswordChangedToast('), 'fungsi notif sandi baru diganti harus ada');
  assert.ok(appJs.includes('maybeShowPasswordChangedToast(result.user);'), 'login harus memeriksa notif sandi baru diganti');
});

test('ronde 42 server: cookie perangkat + endpoint akun tersimpan + passwordChangedAt', () => {
  assert.ok(serverJs.includes('readsw_device'), 'server harus punya cookie perangkat');
  assert.ok(serverJs.includes('function deviceCookieHeader('), 'server harus bisa membuat cookie perangkat');
  assert.ok(serverJs.includes('function deviceIdFromRequest('), 'server harus bisa membaca cookie perangkat');
  assert.ok(serverJs.includes('function recordDeviceAccount('), 'server harus mencatat akun per perangkat');
  assert.ok(serverJs.includes('function removeDeviceAccount('), 'server harus bisa menghapus akun per perangkat');
  assert.ok(serverJs.includes('function savedAccountsForDevice('), 'server harus bisa mengambil akun per perangkat');
  assert.ok(serverJs.includes("route === 'GET /api/auth/saved-accounts'"), 'endpoint daftar akun tersimpan harus ada');
  assert.ok(serverJs.includes("route === 'POST /api/auth/quick-login'"), 'endpoint masuk cepat harus ada');
  assert.ok(serverJs.includes("route === 'POST /api/auth/saved-accounts/remove'"), 'endpoint hapus akun tersimpan harus ada');
  assert.ok(serverJs.includes('quick-login-ip'), 'masuk cepat harus dibatasi per IP');
  assert.ok(serverJs.includes('device-accounts.json'), 'daftar akun per perangkat harus tersimpan di file sendiri');
  assert.ok(serverJs.includes('passwordChangedAt: user.passwordChangedAt || null'), 'publicUser harus membawa waktu terakhir ganti sandi');
  assert.ok(serverJs.includes('target.passwordChangedAt = new Date().toISOString();'), 'ganti sandi harus mencatat waktunya');
  assert.ok(appJs.includes('Sandi @${user.username} baru diganti'), 'notif harus menyebut sandi baru diganti');
  assert.ok(appJs.includes('24 * 60 * 60 * 1000'), 'notif sandi baru diganti hanya untuk 24 jam terakhir');
});

test('formatLastLoginAt: baru saja, menit, jam, hari, tanggal', async () => {
  const m = appJs.match(/function formatLastLoginAt\(iso\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'fungsi formatLastLoginAt harus bisa diekstrak');
  const fn = m[0].replace('function formatLastLoginAt', 'function f');
  const now = Date.now();
  const out = await eval(`${fn}
[f(new Date(now - 30_000).toISOString()), f(new Date(now - 5 * 60_000).toISOString()), f(new Date(now - 3 * 3_600_000).toISOString()), f(new Date(now - 2 * 86_400_000).toISOString()), f('2026-11-14T04:06:05.387Z'), f(''), f('bukan-tanggal')]`);
  assert.equal(out[0], 'baru saja', 'di bawah 1 menit harus "baru saja"');
  assert.equal(out[1], '5 mnt lalu', '5 menit lalu harus "5 mnt lalu"');
  assert.equal(out[2], '3 jam lalu', '3 jam lalu harus "3 jam lalu"');
  assert.equal(out[3], '2 hari lalu', '2 hari lalu harus "2 hari lalu"');
  assert.ok(out[4].includes('14 Nov 2026'), 'lebih dari 7 hari harus tanggal lengkap');
  assert.equal(out[5], '', 'kosong harus kosong');
  assert.equal(out[6], '', 'tanggal tidak valid harus kosong');
});

test('savedAccountAvatarSrc: avatar upload, preset, dan preset tidak valid', async () => {
  const m = appJs.match(/function savedAccountAvatarSrc\(account\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'fungsi savedAccountAvatarSrc harus bisa diekstrak');
  const fn = m[0].replace('function savedAccountAvatarSrc', 'function f');
  const out = await eval(`${fn}
[f({ id: 'abc-123', avatar: 'uploaded' }), f({ id: 'abc-123', avatar: 'avatar-06' }), f({ id: 'abc-123', avatar: 'avatar-99' }), f({ id: 'abc-123', avatar: '' })]`);
  assert.equal(out[0], '/api/admin/user-avatar?userId=abc-123', 'avatar upload harus pakai endpoint avatar');
  assert.equal(out[1], '/avatars/avatar-06.webp', 'preset harus pakai file webp');
  assert.equal(out[2], '/avatars/avatar-01.webp', 'preset tidak valid harus jatuh ke avatar-01');
  assert.equal(out[3], '/avatars/avatar-01.webp', 'avatar kosong harus jatuh ke avatar-01');
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
  const parts = [];
  for (const setCookie of response.headers.getSetCookie()) {
    parts.push(setCookie.split(';')[0]);
  }
  return parts.join('; ');
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

test('server akun tersimpan: login mencatat perangkat, quick-login tanpa sandi, hapus, dan passwordChangedAt', { timeout: 60_000 }, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'readsw-saved-accounts-test-'));
  const root = path.join(temp, 'project');
  const dataDir = path.join(root, 'runtime-data');
  const memberPassword = 'FixtureMember-Only-Password!';
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

    // Tanpa cookie perangkat, daftar akun tersimpan kosong (browser lain).
    const empty = await jsonRequest(base, '/api/auth/saved-accounts');
    assert.equal(empty.status, 200, 'daftar akun tersimpan harus 200');
    assert.deepEqual(empty.payload.accounts, [], 'tanpa cookie perangkat daftar harus kosong');

    // Masuk cepat tanpa cookie perangkat harus ditolak.
    const quickNoDevice = await jsonRequest(base, '/api/auth/quick-login', { method: 'POST', body: { username: 'fixturemember' } });
    assert.equal(quickNoDevice.status, 404, 'masuk cepat tanpa cookie perangkat harus 404');

    // Login biasa dengan sandi: cookie perangkat + sesi harus diset.
    const login = await jsonRequest(base, '/api/auth/login', { method: 'POST', body: { identifier: 'fixturemember', password: memberPassword } });
    assert.equal(login.status, 200, 'login biasa harus 200');
    assert.ok(login.cookie.includes('readsw_session='), 'login harus menyetel cookie sesi');
    assert.ok(login.cookie.includes('readsw_device='), 'login harus menyetel cookie perangkat');
    const deviceCookie = login.cookie.split('; ').find((part) => part.startsWith('readsw_device='));
    assert.ok(deviceCookie, 'cookie perangkat harus bisa dipisahkan');

    // Daftar akun tersimpan di perangkat ini kini berisi akun itu.
    const saved = await jsonRequest(base, '/api/auth/saved-accounts', { cookie: deviceCookie });
    assert.equal(saved.status, 200, 'daftar akun tersimpan harus 200');
    assert.equal(saved.payload.accounts.length, 1, 'satu akun harus tersimpan di perangkat ini');
    assert.equal(saved.payload.accounts[0].username, 'fixturemember', 'akun tersimpan harus username yang benar');
    assert.equal(saved.payload.accounts[0].email, 'fixturemember@example.test', 'akun tersimpan harus membawa email untuk Lupa sandi');
    assert.equal(saved.payload.accounts[0].avatar, 'avatar-06', 'akun tersimpan harus membawa avatar untuk foto profil');
    assert.ok(saved.payload.accounts[0].lastLoginAt, 'akun tersimpan harus membawa waktu terakhir masuk');

    // Masuk cepat dengan cookie perangkat: tanpa sandi, sesi baru dibuat.
    const quick = await jsonRequest(base, '/api/auth/quick-login', { method: 'POST', body: { username: 'fixturemember' }, cookie: deviceCookie });
    assert.equal(quick.status, 200, 'masuk cepat harus 200');
    assert.equal(quick.payload.user.username, 'fixturemember', 'masuk cepat harus mengembalikan user yang benar');
    assert.ok(quick.cookie.includes('readsw_session='), 'masuk cepat harus menyetel cookie sesi baru');

    // Ganti sandi lewat change-password: passwordChangedAt tercatat dan
    // dikembalikan saat login berikutnya (untuk notif toast).
    const sessionCookie = quick.cookie.split('; ').find((part) => part.startsWith('readsw_session='));
    const change = await jsonRequest(base, '/api/auth/change-password', { method: 'POST', body: { currentPassword: memberPassword, newPassword: 'SandiBaruYangPanjang!' }, cookie: sessionCookie });
    assert.equal(change.status, 200, 'ganti sandi harus 200');
    const storeAfter = JSON.parse(await readFile(path.join(dataDir, 'store.json'), 'utf8'));
    const changedUser = storeAfter.users.find((item) => item.username === 'fixturemember');
    assert.ok(changedUser.passwordChangedAt, 'ganti sandi harus mencatat passwordChangedAt');
    const loginAgain = await jsonRequest(base, '/api/auth/login', { method: 'POST', body: { identifier: 'fixturemember', password: 'SandiBaruYangPanjang!' } });
    assert.equal(loginAgain.status, 200, 'login dengan sandi baru harus 200');
    assert.equal(loginAgain.payload.user.passwordChangedAt, changedUser.passwordChangedAt, 'login harus mengembalikan passwordChangedAt yang sama');

    // Hapus akun tersimpan dari perangkat ini, lalu daftar kosong lagi.
    const removed = await jsonRequest(base, '/api/auth/saved-accounts/remove', { method: 'POST', body: { username: 'fixturemember' }, cookie: deviceCookie });
    assert.equal(removed.status, 200, 'hapus akun tersimpan harus 200');
    assert.equal(removed.payload.removed, true, 'hapus harus melaporkan removed true');
    const savedAfter = await jsonRequest(base, '/api/auth/saved-accounts', { cookie: deviceCookie });
    assert.deepEqual(savedAfter.payload.accounts, [], 'setelah dihapus daftar harus kosong');
    const quickAfter = await jsonRequest(base, '/api/auth/quick-login', { method: 'POST', body: { username: 'fixturemember' }, cookie: deviceCookie });
    assert.equal(quickAfter.status, 404, 'masuk cepat setelah dihapus harus 404');
  } finally {
    if (child) child.kill();
    await rm(temp, { recursive: true, force: true });
  }
});

test('ronde 44: loadSavedAccounts tidak boleh memunculkan formulir Masuk saat di Lupa sandi', () => {
  const m = appJs.match(/async function loadSavedAccounts\(\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'fungsi loadSavedAccounts harus bisa diekstrak');
  const fn = m[0];
  assert.ok(fn.includes('onForgotPage'), 'loadSavedAccounts harus memeriksa apakah sedang di Lupa sandi');
  assert.ok(fn.includes("forgotForm?.classList.contains('hidden')"), 'pemeriksaan harus melihat formulir Lupa sandi');
  assert.ok(fn.includes('accounts.length && !onForgotPage'), 'pemilih akun hanya tampil kalau ada akun DAN bukan di Lupa sandi');
  assert.ok(fn.includes('if (!onForgotPage) loginForm?.classList.remove'), 'formulir Masuk hanya dimunculkan kalau bukan di Lupa sandi');
  assert.ok(fn.includes('RONDE 44'), 'perbaikan harus ditandai ronde 44');
});
