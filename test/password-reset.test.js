// Lupa sandi (ronde 33): reset hanya lewat EMAIL yang akurat (bukan username,
// karena username terlihat di daftar member sehingga siapa pun bisa memicu
// reset akun orang lain). Bot mengirim kata sandi sementara ke WhatsApp yang
// tertaut; member wajib menggantinya saat login. Admin memantau lewat Log
// Reset Sandi realtime (sandi sementara + status pengiriman + info akun).
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

test('Lupa sandi: form hanya minta email, ada tautan Lupa sandi, dan modal ganti sandi', () => {
  assert.ok(html.includes('data-action="show-forgot"'), 'halaman login harus punya tautan Lupa sandi');
  assert.ok(html.includes('id="forgot-form"'), 'form lupa sandi harus ada');
  const forgotSection = html.slice(html.indexOf('id="forgot-form"'), html.indexOf('</form>', html.indexOf('id="forgot-form"')));
  assert.ok(forgotSection.includes('type="email"'), 'form lupa sandi harus minta email');
  assert.ok(!forgotSection.includes('name="username"'), 'form lupa sandi TIDAK boleh minta username (rawan diambil orang lain)');
  assert.ok(!forgotSection.includes('name="identifier"'), 'form lupa sandi TIDAK boleh minta identifier/username');
  assert.ok(forgotSection.includes('Kirim sandi sementara'), 'form harus punya tombol kirim sandi sementara');
  assert.ok(html.includes('id="change-password-overlay"'), 'modal wajib ganti sandi harus ada');
  assert.ok(html.includes('id="change-password-form"'), 'form ganti sandi harus ada');
  assert.ok(html.includes('id="password-reset-log-list"'), 'log reset sandi admin harus ada');
  assert.ok(html.includes('Log Reset Sandi'), 'log harus berjudul Log Reset Sandi');
  assert.ok(html.includes('id="forgot-account"'), 'kartu status akun setelah email cocok harus ada');
  assert.ok(html.includes('id="forgot-account-avatar"'), 'kartu status harus menampilkan avatar');
  assert.ok(html.includes('id="forgot-notfound"'), 'animasi pemberitahuan email tidak ditemukan harus ada');
  assert.ok(html.includes('id="profile-email-label"'), 'email harus tampil di kepala halaman Profil, di bawah @username');
  assert.ok(css.includes('.profile-email-line'), 'email di kepala Profil harus punya gaya sendiri');
  assert.ok(appJs.includes("querySelector('#profile-email-label')"), 'email di kepala Profil harus diisi saat login');
  assert.ok(css.includes('.auth-forgot'), 'tautan lupa sandi harus punya gaya');
  assert.ok(css.includes('.change-password-card'), 'modal ganti sandi harus punya gaya');
  assert.ok(css.includes('.password-reset-log-item'), 'entri log reset harus punya gaya');
  assert.ok(css.includes('.forgot-account'), 'kartu status akun harus punya gaya');
  assert.ok(css.includes('.forgot-shake'), 'goyang kolom email saat tidak ditemukan harus punya gaya');
  assert.ok(css.includes('@keyframes forgot-account-in'), 'kartu status harus muncul dengan animasi');
  assert.ok(appJs.includes('function showForgotForm'), 'harus ada fungsi tampilkan form lupa sandi');
  assert.ok(appJs.includes("api('/api/auth/forgot-password'"), 'form harus memanggil endpoint lupa sandi');
  assert.ok(appJs.includes("forgot-account"), 'form harus menampilkan kartu status akun saat email cocok');
  assert.ok(appJs.includes("forgot-notfound"), 'form harus menampilkan animasi saat email tidak ditemukan');
  assert.ok(appJs.includes('function showChangePasswordModal'), 'harus ada fungsi tampilkan modal ganti sandi');
  assert.ok(appJs.includes("api('/api/auth/change-password'"), 'modal harus memanggil endpoint ganti sandi');
  assert.ok(appJs.includes("api('/api/admin/password-resets'"), 'log admin harus memanggil endpoint log reset');
  assert.ok(appJs.includes('mustChangePassword'), 'login harus memeriksa penanda wajib ganti sandi');
  assert.ok(serverJs.includes("route === 'POST /api/auth/forgot-password'"), 'server harus punya endpoint lupa sandi');
  assert.ok(serverJs.includes("route === 'POST /api/auth/change-password'"), 'server harus punya endpoint ganti sandi');
  assert.ok(serverJs.includes("route === 'GET /api/admin/password-resets'"), 'server harus punya endpoint log reset admin');
  assert.ok(serverJs.includes('sendDirectMessage'), 'server harus mengirim sandi sementara lewat WhatsApp akun itu');
});

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

test('server Lupa sandi: email saja, sandi sementara, wajib ganti, log admin', { timeout: 60_000 }, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'readsw-password-reset-test-'));
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
    await writeFile(path.join(dataDir, 'store.json'), JSON.stringify({
      users: [admin, member], pendingRegistrations: [], bots: [], sessions: [], pairingLogs: [], loginHistory: [],
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

    // Email tidak terdaftar / format salah harus ditolak dengan jelas.
    const unknown = await jsonRequest(base, '/api/auth/forgot-password', { method: 'POST', body: { email: 'tidak-ada@example.test' } });
    assert.equal(unknown.status, 404, 'email yang tidak terdaftar harus 404');
    const badFormat = await jsonRequest(base, '/api/auth/forgot-password', { method: 'POST', body: { email: 'bukan-email' } });
    assert.equal(badFormat.status, 400, 'email berformat salah harus 400');
    const noEmail = await jsonRequest(base, '/api/auth/forgot-password', { method: 'POST', body: {} });
    assert.equal(noEmail.status, 400, 'tanpa email harus 400');
    // Username saja TIDAK boleh memicu reset (harus email yang akurat).
    const byUsername = await jsonRequest(base, '/api/auth/forgot-password', { method: 'POST', body: { username: 'fixturemember' } });
    assert.equal(byUsername.status, 400, 'username saja tidak boleh memicu reset; wajib email');

    // Reset dengan email yang benar: sandi sementara dibuat, log tercatat.
    // Di fixture WhatsApp tidak tertaut sehingga pengiriman gagal dengan
    // status failed — alur tetap harus berhasil dan sandi sementara tetap
    // tercatat di log admin supaya admin bisa membantu.
    const reset = await jsonRequest(base, '/api/auth/forgot-password', { method: 'POST', body: { email: 'fixturemember@example.test' } });
    assert.equal(reset.status, 200, 'reset dengan email benar harus 200');
    assert.equal(reset.payload.sent, false, 'tanpa WhatsApp tertaut, pengiriman harus dilaporkan gagal (bukan pura-pura terkirim)');
    assert.ok(reset.payload.message, 'respons harus menjelaskan status pengiriman');
    assert.ok(reset.payload.account, 'respons harus menyertakan info akun untuk kartu status');
    assert.equal(reset.payload.account.username, 'fixturemember', 'kartu status harus menampilkan username yang benar');
    assert.equal(reset.payload.account.displayName, 'fixturemember', 'kartu status harus menampilkan nama yang benar');
    assert.equal(reset.payload.account.role, 'member', 'kartu status harus menampilkan peran yang benar');
    const resets = JSON.parse(await readFile(path.join(dataDir, 'password-resets.json'), 'utf8'));
    assert.equal(resets.length, 1, 'satu percobaan reset harus tercatat di log');
    assert.equal(resets[0].username, 'fixturemember');
    assert.equal(resets[0].email, 'fixturemember@example.test');
    assert.equal(resets[0].status, 'failed', 'tanpa WhatsApp tertaut, log harus berstatus failed');
    assert.ok(resets[0].reason, 'log gagal harus menyimpan alasan');
    assert.ok(typeof resets[0].tempPassword === 'string' && resets[0].tempPassword.length >= 10, 'log admin harus menyimpan sandi sementara');
    const tempPassword = resets[0].tempPassword;

    // Sandi lama sudah tidak berlaku; sandi sementara berlaku dan menandai
    // wajib ganti sandi.
    const oldLogin = await jsonRequest(base, '/api/auth/login', { method: 'POST', body: { identifier: 'fixturemember', password: memberPassword } });
    assert.equal(oldLogin.status, 401, 'sandi lama harus ditolak setelah reset');
    const tempLogin = await jsonRequest(base, '/api/auth/login', { method: 'POST', body: { identifier: 'fixturemember', password: tempPassword } });
    assert.equal(tempLogin.status, 200, 'login dengan sandi sementara harus berhasil');
    assert.equal(tempLogin.payload.user.mustChangePassword, true, 'login sandi sementara harus menandai wajib ganti sandi');
    const memberCookie = tempLogin.cookie;

    // Ganti sandi: sandi lama salah / terlalu pendek ditolak; yang benar berhasil.
    const wrongCurrent = await jsonRequest(base, '/api/auth/change-password', { method: 'POST', body: { currentPassword: 'salah-salah', newPassword: 'SandiBaruYangPanjang!1' }, cookie: memberCookie });
    assert.equal(wrongCurrent.status, 401, 'sandi lama yang salah harus 401');
    const tooShort = await jsonRequest(base, '/api/auth/change-password', { method: 'POST', body: { currentPassword: tempPassword, newPassword: 'pendek' }, cookie: memberCookie });
    assert.equal(tooShort.status, 400, 'sandi baru di bawah 12 karakter harus 400');
    const changed = await jsonRequest(base, '/api/auth/change-password', { method: 'POST', body: { currentPassword: tempPassword, newPassword: 'SandiBaruYangPanjang!1' }, cookie: memberCookie });
    assert.equal(changed.status, 200, 'ganti sandi dengan data benar harus 200');

    // Setelah ganti sandi, sandi sementara mati dan sandi baru berlaku tanpa
    // penanda wajib ganti.
    const tempDead = await jsonRequest(base, '/api/auth/login', { method: 'POST', body: { identifier: 'fixturemember', password: tempPassword } });
    assert.equal(tempDead.status, 401, 'sandi sementara harus mati setelah diganti');
    const newLogin = await jsonRequest(base, '/api/auth/login', { method: 'POST', body: { identifier: 'fixturemember@example.test', password: 'SandiBaruYangPanjang!1' } });
    assert.equal(newLogin.status, 200, 'login dengan sandi baru harus berhasil');
    assert.equal(newLogin.payload.user.mustChangePassword, false, 'setelah ganti sandi, penanda wajib ganti harus hilang');

    // Log reset: admin boleh baca, member tidak.
    const adminLogin = await jsonRequest(base, '/api/auth/login', { method: 'POST', body: { identifier: 'fixtureadmin', password: adminPassword } });
    assert.equal(adminLogin.status, 200);
    const adminLog = await jsonRequest(base, '/api/admin/password-resets', { cookie: adminLogin.cookie });
    assert.equal(adminLog.status, 200, 'admin harus bisa membaca log reset sandi');
    assert.equal(adminLog.payload.resets.length, 1, 'log harus berisi satu entri reset');
    assert.equal(adminLog.payload.resets[0].tempPassword, tempPassword, 'log admin harus menampilkan sandi sementara');
    const memberLog = await jsonRequest(base, '/api/admin/password-resets', { cookie: newLogin.cookie });
    assert.equal(memberLog.status, 403, 'member tidak boleh membaca log reset sandi');
    const noAuthLog = await jsonRequest(base, '/api/admin/password-resets');
    assert.equal(noAuthLog.status, 401, 'tanpa login tidak boleh membaca log reset sandi');
  } finally {
    if (child && child.exitCode === null) child.kill('SIGTERM');
    await rm(temp, { recursive: true, force: true });
  }
});
