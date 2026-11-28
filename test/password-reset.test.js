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
  assert.ok(forgotSection.includes('Tampilkan sandi sementara'), 'form harus punya tombol tampilkan sandi sementara di web');
  assert.ok(html.includes('id="change-password-overlay"'), 'modal wajib ganti sandi harus ada');
  assert.ok(html.includes('id="change-password-form"'), 'form ganti sandi harus ada');
  assert.ok(!html.includes('id="password-reset-log-list"'), 'kartu Log Reset Sandi sudah dihapus dari halaman Member (ronde 47)');
  assert.ok(!html.includes('id="password-reset-log-title"'), 'judul Log Reset Sandi sudah tidak ada di halaman (ronde 47)');
  assert.ok(html.includes('id="forgot-account"'), 'kartu status akun setelah email cocok harus ada');
  assert.ok(html.includes('id="forgot-account-avatar"'), 'kartu status harus menampilkan avatar');
  assert.ok(html.includes('id="forgot-notfound"'), 'animasi pemberitahuan email tidak ditemukan harus ada');
  assert.ok(html.includes('id="forgot-temp"'), 'sandi sementara harus tampil di web dengan kotak khusus');
  assert.ok(html.includes('id="forgot-temp-code"'), 'sandi sementara harus ditampilkan sebagai kode');
  assert.ok(html.includes('id="forgot-temp-copy"'), 'harus ada tombol Salin untuk sandi sementara');
  assert.ok(html.includes('id="forgot-reset"'), 'harus ada form buat sandi baru langsung di halaman lupa sandi');
  assert.ok(html.includes('id="forgot-reset-submit"'), 'form buat sandi baru harus ada tombol simpan');
  // RONDE 35: ikon mata di kolom sandi + cek cocok realtime + ikon SVG konteks.
  assert.ok(html.includes('id="forgot-new-password-toggle"'), 'kolom sandi baru harus punya tombol ikon mata');
  assert.ok(html.includes('id="forgot-confirm-password-toggle"'), 'kolom ulangi sandi baru harus punya tombol ikon mata');
  assert.ok(html.includes('password-toggle-eye'), 'tombol mata harus punya ikon mata (SVG)');
  assert.ok(html.includes('password-toggle-eye-off'), 'tombol mata harus punya ikon mata tertutup (SVG) saat sandi terlihat');
  assert.ok(html.includes('id="forgot-reset-match"'), 'harus ada petunjuk cocok/tidak cocok sandi baru realtime');
  assert.ok(html.includes('field-with-icon'), 'kolom lupa sandi harus memakai wrapper ikon');
  assert.ok(html.includes('forgot-temp-label-icon'), 'label sandi sementara harus punya ikon kunci (SVG)');
  assert.ok(html.includes('forgot-reset-done-icon'), 'pesan sandi tersimpan harus punya ikon centang (SVG)');
  assert.ok(css.includes('.field-with-icon'), 'wrapper ikon kolom harus punya gaya');
  assert.ok(css.includes('.password-toggle'), 'tombol ikon mata harus punya gaya');
  assert.ok(css.includes('.forgot-reset-match'), 'petunjuk cocok sandi harus punya gaya');
  assert.ok(css.includes('.forgot-reset-match.is-ok'), 'petunjuk sandi cocok harus hijau');
  assert.ok(css.includes('.forgot-reset-match.is-bad'), 'petunjuk sandi belum cocok harus merah');
  assert.ok(css.includes('@keyframes forgot-match-shake'), 'sandi belum cocok harus bergoyang ringan');
  assert.ok(css.includes('.forgot-hint{text-align:center}'), 'petunjuk email harus rata tengah');
  assert.ok(css.includes('.forgot-account-status{text-align:center}'), 'status akun harus rata tengah');
  assert.ok(css.includes('.forgot-temp-note{text-align:center}'), 'catatan sandi sementara harus rata tengah');
  assert.ok(appJs.includes('bindForgotPasswordToggle'), 'harus ada fungsi pasang tombol ikon mata');
  assert.ok(appJs.includes('function updateForgotResetMatch'), 'harus ada fungsi cek cocok sandi realtime');
  assert.ok(appJs.includes("addEventListener('input', updateForgotResetMatch)"), 'cek cocok harus jalan saat mengetik');
  // REGRESI (27 Nov 2026): input sandi baru di dalam #forgot-form TIDAK boleh
  // required — kolom required yang tersembunyi (display:none) memblokir submit
  // form di Chrome sehingga tombol "Tampilkan sandi sementara" diam total
  // (tanpa loading, tanpa pesan, tanpa error). Validasi sudah ditangani JS.
  const resetStart = html.indexOf('id="forgot-reset"');
  const resetEnd = html.indexOf('</form>', resetStart);
  const resetSection = html.slice(resetStart, resetEnd);
  assert.ok(!/id="forgot-(new|confirm)-password"[^>]*required/.test(resetSection), 'input sandi baru TIDAK boleh required (memblokir submit form saat tersembunyi)');
  assert.ok(html.includes('id="profile-email-label"'), 'email harus tampil di kepala halaman Profil, di bawah @username');
  assert.ok(css.includes('.profile-email-line'), 'email di kepala Profil harus punya gaya sendiri');
  assert.ok(css.includes('.forgot-temp'), 'kotak sandi sementara harus punya gaya sendiri');
  assert.ok(appJs.includes("querySelector('#profile-email-label')"), 'email di kepala Profil harus diisi saat login');
  assert.ok(appJs.includes("api('/api/auth/reset-password'"), 'buat sandi baru harus memanggil endpoint reset-password');
  assert.ok(css.includes('.auth-forgot'), 'tautan lupa sandi harus punya gaya');
  assert.ok(css.includes('.change-password-card'), 'modal ganti sandi harus punya gaya');
  assert.ok(!css.includes('.password-reset-log-item'), 'gaya entri log reset sudah dihapus (ronde 47)');
  assert.ok(!css.includes('.password-reset-log-card'), 'gaya kartu log reset sudah dihapus (ronde 47)');
  assert.ok(css.includes('.forgot-account'), 'kartu status akun harus punya gaya');
  assert.ok(css.includes('.forgot-shake'), 'goyang kolom email saat tidak ditemukan harus punya gaya');
  assert.ok(css.includes('@keyframes forgot-account-in'), 'kartu status harus muncul dengan animasi');
  assert.ok(appJs.includes('function showForgotForm'), 'harus ada fungsi tampilkan form lupa sandi');
  assert.ok(appJs.includes("api('/api/auth/forgot-password'"), 'form harus memanggil endpoint lupa sandi');
  assert.ok(appJs.includes("forgot-account"), 'form harus menampilkan kartu status akun saat email cocok');
  assert.ok(appJs.includes("forgot-notfound"), 'form harus menampilkan animasi saat email tidak ditemukan');
  assert.ok(appJs.includes("canSeeEmail"), 'daftar member harus menyembunyikan email orang lain (hanya admin/pemilik yang melihat)');
  assert.ok(appJs.includes('function showChangePasswordModal'), 'harus ada fungsi tampilkan modal ganti sandi');
  assert.ok(appJs.includes("api('/api/auth/change-password'"), 'modal harus memanggil endpoint ganti sandi');
  assert.ok(!appJs.includes("api('/api/admin/password-resets'"), 'klien TIDAK lagi memanggil endpoint log reset (kartu dihapus, ronde 47)');
  assert.ok(!appJs.includes('loadPasswordResetLog'), 'fungsi pemuat log reset sudah dihapus (ronde 47)');
  assert.ok(!appJs.includes('startPasswordResetLogPolling'), 'polling log reset sudah dihapus (ronde 47)');
  assert.ok(appJs.includes('mustChangePassword'), 'login harus memeriksa penanda wajib ganti sandi');
  assert.ok(serverJs.includes("route === 'POST /api/auth/forgot-password'"), 'server harus punya endpoint lupa sandi');
  assert.ok(serverJs.includes("route === 'POST /api/auth/reset-password'"), 'server harus punya endpoint buat sandi baru langsung dari web');
  assert.ok(serverJs.includes("route === 'POST /api/auth/change-password'"), 'server harus punya endpoint ganti sandi');
  assert.ok(serverJs.includes("route === 'GET /api/admin/password-resets'"), 'server harus punya endpoint log reset admin');
  assert.ok(!serverJs.includes('sendDirectMessage(user.id,'), 'sandi sementara TIDAK boleh dikirim lewat WhatsApp lagi — tampil di web supaya akun yang WA-nya belum tertaut tetap bisa reset');
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

    // Reset dengan email yang benar: sandi sementara dibuat dan DITAMPILKAN
    // di web (bukan dikirim WA — akun yang WA-nya belum tertaut tidak akan
    // pernah menerimanya). Log admin berstatus shown.
    const reset = await jsonRequest(base, '/api/auth/forgot-password', { method: 'POST', body: { email: 'fixturemember@example.test' } });
    assert.equal(reset.status, 200, 'reset dengan email benar harus 200');
    assert.ok(typeof reset.payload.tempPassword === 'string' && reset.payload.tempPassword.length >= 10, 'respons harus menyertakan sandi sementara untuk ditampilkan di web');
    assert.ok(reset.payload.message, 'respons harus menjelaskan alur selanjutnya');
    assert.ok(reset.payload.account, 'respons harus menyertakan info akun untuk kartu status');
    assert.equal(reset.payload.account.username, 'fixturemember', 'kartu status harus menampilkan username yang benar');
    assert.equal(reset.payload.account.displayName, 'fixturemember', 'kartu status harus menampilkan nama yang benar');
    assert.equal(reset.payload.account.role, 'member', 'kartu status harus menampilkan peran yang benar');
    assert.equal(reset.payload.account.email, undefined, 'kartu status TIDAK boleh menyertakan email (email hanya di Profil pemilik akun)');
    const resets = JSON.parse(await readFile(path.join(dataDir, 'password-resets.json'), 'utf8'));
    assert.equal(resets.length, 1, 'satu percobaan reset harus tercatat di log');
    assert.equal(resets[0].username, 'fixturemember');
    assert.equal(resets[0].email, 'fixturemember@example.test');
    assert.equal(resets[0].status, 'shown', 'sandi sementara tampil di web, log harus berstatus shown');
    assert.ok(typeof resets[0].tempPassword === 'string' && resets[0].tempPassword.length >= 10, 'log admin harus menyimpan sandi sementara');
    const tempPassword = resets[0].tempPassword;
    assert.equal(reset.payload.tempPassword, tempPassword, 'sandi sementara di respons harus sama dengan yang di log');

    // Buat sandi baru langsung dari web (tanpa login dulu): sandi sementara
    // salah / sandi baru terlalu pendek ditolak; yang benar berhasil.
    const resetWrongTemp = await jsonRequest(base, '/api/auth/reset-password', { method: 'POST', body: { email: 'fixturemember@example.test', tempPassword: 'SalahSekali1', newPassword: 'SandiBaruYangPanjang!' } });
    assert.equal(resetWrongTemp.status, 401, 'sandi sementara yang salah harus ditolak');
    const resetShort = await jsonRequest(base, '/api/auth/reset-password', { method: 'POST', body: { email: 'fixturemember@example.test', tempPassword, newPassword: 'pendek' } });
    assert.equal(resetShort.status, 400, 'sandi baru di bawah 12 karakter harus ditolak');
    const resetSame = await jsonRequest(base, '/api/auth/reset-password', { method: 'POST', body: { email: 'fixturemember@example.test', tempPassword, newPassword: tempPassword } });
    assert.equal(resetSame.status, 400, 'sandi baru tidak boleh sama dengan sandi sementara');
    const resetOk = await jsonRequest(base, '/api/auth/reset-password', { method: 'POST', body: { email: 'fixturemember@example.test', tempPassword, newPassword: 'SandiBaruLangsung!' } });
    assert.equal(resetOk.status, 200, 'buat sandi baru dari web harus berhasil');
    const newLoginDirect = await jsonRequest(base, '/api/auth/login', { method: 'POST', body: { identifier: 'fixturemember', password: 'SandiBaruLangsung!' } });
    assert.equal(newLoginDirect.status, 200, 'login dengan sandi baru harus berhasil');
    assert.equal(newLoginDirect.payload.user.mustChangePassword, false, 'setelah reset langsung, tidak ada lagi kewajiban ganti sandi');
    // RONDE 39: sandi sementara TETAP berlaku sebagai cadangan setelah sandi
    // baru disimpan — masuk bisa pakai keduanya supaya tidak terkunci lagi.
    const tempLoginAlive = await jsonRequest(base, '/api/auth/login', { method: 'POST', body: { identifier: 'fixturemember', password: tempPassword } });
    assert.equal(tempLoginAlive.status, 200, 'sandi sementara harus TETAP berlaku setelah sandi baru disimpan');
    assert.equal(tempLoginAlive.payload.user.mustChangePassword, false, 'sandi sementara yang dipakai setelah reset tidak memaksa ganti lagi');
    // RONDE 39: sandi sementara tercatat per akun di DATA_AKUN masing-masing.
    const accountRecord = JSON.parse(await readFile(path.join(root, 'DATA_AKUN', 'MEMBER', 'fixturemember', 'password-reset.json'), 'utf8'));
    assert.equal(accountRecord.tempPassword, tempPassword, 'catatan per akun harus menyimpan sandi sementara');
    assert.equal(accountRecord.status, 'done', 'catatan per akun harus berstatus done setelah sandi baru disimpan');
    assert.ok(accountRecord.resetAt, 'catatan per akun harus mencatat waktu sandi baru disimpan');
    assert.ok(accountRecord.tempPasswordAt, 'catatan per akun harus mencatat waktu sandi sementara dibuat');

    // Minta sandi sementara kedua untuk menguji alur login + wajib ganti.
    const reset2 = await jsonRequest(base, '/api/auth/forgot-password', { method: 'POST', body: { email: 'fixturemember@example.test' } });
    assert.equal(reset2.status, 200, 'reset kedua harus 200');
    const tempPassword2 = reset2.payload.tempPassword;
    assert.ok(typeof tempPassword2 === 'string' && tempPassword2.length >= 10, 'reset kedua harus mengembalikan sandi sementara baru');

    // RONDE 39: minta sandi sementara TIDAK lagi menimpa sandi utama — sandi
    // utama tetap berlaku, sandi sementara berlaku dan menandai wajib ganti.
    const oldLogin = await jsonRequest(base, '/api/auth/login', { method: 'POST', body: { identifier: 'fixturemember', password: 'SandiBaruLangsung!' } });
    assert.equal(oldLogin.status, 200, 'sandi utama harus TETAP berlaku setelah minta sandi sementara');
    const tempLogin = await jsonRequest(base, '/api/auth/login', { method: 'POST', body: { identifier: 'fixturemember', password: tempPassword2 } });
    assert.equal(tempLogin.status, 200, 'login dengan sandi sementara harus berhasil');
    assert.equal(tempLogin.payload.user.mustChangePassword, true, 'login sandi sementara harus menandai wajib ganti sandi');
    const memberCookie = tempLogin.cookie;

    // Ganti sandi: sandi lama salah / terlalu pendek ditolak; yang benar berhasil.
    const wrongCurrent = await jsonRequest(base, '/api/auth/change-password', { method: 'POST', body: { currentPassword: 'salah-salah', newPassword: 'SandiBaruYangPanjang!1' }, cookie: memberCookie });
    assert.equal(wrongCurrent.status, 401, 'sandi lama yang salah harus 401');
    const tooShort = await jsonRequest(base, '/api/auth/change-password', { method: 'POST', body: { currentPassword: tempPassword2, newPassword: 'pendek' }, cookie: memberCookie });
    assert.equal(tooShort.status, 400, 'sandi baru di bawah 12 karakter harus 400');
    const changed = await jsonRequest(base, '/api/auth/change-password', { method: 'POST', body: { currentPassword: tempPassword2, newPassword: 'SandiBaruYangPanjang!1' }, cookie: memberCookie });
    assert.equal(changed.status, 200, 'ganti sandi dengan data benar harus 200');

    // RONDE 39: setelah ganti sandi, sandi sementara TETAP berlaku sebagai
    // cadangan dan sandi baru berlaku tanpa penanda wajib ganti.
    const tempAlive = await jsonRequest(base, '/api/auth/login', { method: 'POST', body: { identifier: 'fixturemember', password: tempPassword2 } });
    assert.equal(tempAlive.status, 200, 'sandi sementara harus TETAP berlaku setelah diganti');
    const newLogin = await jsonRequest(base, '/api/auth/login', { method: 'POST', body: { identifier: 'fixturemember@example.test', password: 'SandiBaruYangPanjang!1' } });
    assert.equal(newLogin.status, 200, 'login dengan sandi baru harus berhasil');
    assert.equal(newLogin.payload.user.mustChangePassword, false, 'setelah ganti sandi, penanda wajib ganti harus hilang');

    // Log reset: admin boleh baca, member tidak. Ada dua entri (reset
    // pertama via web + reset kedua untuk alur login); yang terbaru duluan.
    const adminLogin = await jsonRequest(base, '/api/auth/login', { method: 'POST', body: { identifier: 'fixtureadmin', password: adminPassword } });
    assert.equal(adminLogin.status, 200);
    const adminLog = await jsonRequest(base, '/api/admin/password-resets', { cookie: adminLogin.cookie });
    assert.equal(adminLog.status, 200, 'admin harus bisa membaca log reset sandi');
    assert.equal(adminLog.payload.resets.length, 2, 'log harus berisi dua entri reset');
    assert.equal(adminLog.payload.resets[0].tempPassword, tempPassword2, 'log admin harus menampilkan sandi sementara terbaru');
    const memberLog = await jsonRequest(base, '/api/admin/password-resets', { cookie: newLogin.cookie });
    assert.equal(memberLog.status, 403, 'member tidak boleh membaca log reset sandi');
    const noAuthLog = await jsonRequest(base, '/api/admin/password-resets');
    assert.equal(noAuthLog.status, 401, 'tanpa login tidak boleh membaca log reset sandi');
  } finally {
    if (child && child.exitCode === null) child.kill('SIGTERM');
    await rm(temp, { recursive: true, force: true });
  }
});

test('ikon mata + cek cocok sandi baru realtime di halaman lupa sandi', () => {
  const pick = (re, msg) => {
    const m = appJs.match(re);
    assert.ok(m, msg);
    return m[0];
  };
  const toggleFn = pick(/function bindForgotPasswordToggle\(toggleId, inputId, label\) \{[\s\S]*?\n\}/, 'fungsi bindForgotPasswordToggle harus bisa diekstrak');
  const matchFn = pick(/function updateForgotResetMatch\(\) \{[\s\S]*?\n\}/, 'fungsi updateForgotResetMatch harus bisa diekstrak');
  const program = `
    function makeEl() {
      const el = {
        classList: { _s: new Set(['hidden']), contains(c) { return this._s.has(c); }, add(c) { this._s.add(c); }, remove(...cs) { for (const c of cs) this._s.delete(c); }, toggle(c, f) { if (f) this._s.add(c); else this._s.delete(c); } },
        textContent: '', value: '', type: 'password',
        listeners: {},
        addEventListener(name, fn) { this.listeners[name] = fn; },
        setAttribute() {}, focus() {},
      };
      return el;
    }
    const matchEl = makeEl();
    const newInput = makeEl();
    const confirmInput = makeEl();
    const newToggle = makeEl();
    const confirmToggle = makeEl();
    const document = { querySelector(sel) {
      if (sel === '#forgot-reset-match') return matchEl;
      if (sel === '#forgot-new-password') return newInput;
      if (sel === '#forgot-confirm-password') return confirmInput;
      if (sel === '#forgot-new-password-toggle') return newToggle;
      if (sel === '#forgot-confirm-password-toggle') return confirmToggle;
      return null;
    } };
    ${toggleFn}
    ${matchFn}
    const out = {};
    bindForgotPasswordToggle('#forgot-new-password-toggle', '#forgot-new-password', 'sandi baru');
    newToggle.listeners.click();
    out.afterFirstClickType = newInput.type;
    out.afterFirstClickShowing = newToggle.classList.contains('is-showing');
    newToggle.listeners.click();
    out.afterSecondClickType = newInput.type;
    out.afterSecondClickShowing = newToggle.classList.contains('is-showing');
    updateForgotResetMatch();
    out.emptyHidden = matchEl.classList.contains('hidden');
    newInput.value = 'abc';
    updateForgotResetMatch();
    out.shortWarn = matchEl.classList.contains('is-warn');
    out.shortText = matchEl.textContent;
    newInput.value = 'sandi-baru-yang-panjang';
    confirmInput.value = '';
    updateForgotResetMatch();
    out.confirmEmptyWarn = matchEl.classList.contains('is-warn');
    confirmInput.value = 'sandi-baru-yang-salah';
    updateForgotResetMatch();
    out.mismatchBad = matchEl.classList.contains('is-bad');
    out.mismatchText = matchEl.textContent;
    confirmInput.value = 'sandi-baru-yang-panjang';
    updateForgotResetMatch();
    out.matchOk = matchEl.classList.contains('is-ok');
    out.matchText = matchEl.textContent;
    out;
  `;
  const out = eval(program);
  assert.equal(out.afterFirstClickType, 'text', 'klik pertama ikon mata harus menampilkan sandi');
  assert.equal(out.afterFirstClickShowing, true, 'klik pertama harus menandai ikon mata aktif');
  assert.equal(out.afterSecondClickType, 'password', 'klik kedua ikon mata harus menyembunyikan sandi lagi');
  assert.equal(out.afterSecondClickShowing, false, 'klik kedua harus melepas tanda ikon mata aktif');
  assert.equal(out.emptyHidden, true, 'petunjuk harus tersembunyi saat kedua kolom kosong');
  assert.equal(out.shortWarn, true, 'sandi baru kurang dari 12 karakter harus memberi peringatan');
  assert.ok(out.shortText.includes('12 karakter'), 'peringatan harus menyebut minimal 12 karakter');
  assert.equal(out.confirmEmptyWarn, true, 'ulangi yang masih kosong harus memberi peringatan');
  assert.equal(out.mismatchBad, true, 'sandi yang belum cocok harus merah');
  assert.equal(out.mismatchText, 'Sandi baru belum cocok.', 'teks belum cocok harus tepat');
  assert.equal(out.matchOk, true, 'sandi yang cocok harus hijau');
  assert.equal(out.matchText, 'Sandi baru cocok.', 'teks cocok harus tepat');
});
test('api(): gagal jaringan coba lagi 1x, lalu pesan ramah', async () => {
  const pick = (re, msg) => {
    const m = appJs.match(re);
    assert.ok(m, msg);
    return m[0];
  };
  const apiFn = pick(/async function api\(url, options = \{\}\) \{[\s\S]*?\n\}/, 'fungsi api harus bisa diekstrak');
  assert.ok(apiFn.includes('Tidak ada koneksi internet. Periksa jaringanmu lalu coba lagi.'), 'api harus menerjemahkan gagal jaringan ke pesan ramah');
  assert.ok(apiFn.includes('setTimeout(resolve, 1500)'), 'api harus menunggu 1,5 detik sebelum mencoba lagi');
  const program = `
    let fetch;
    let calls = 0;
    ${apiFn}
    (async () => {
      const out = {};
      const failOnce = async () => { calls++; if (calls === 1) throw new TypeError('Failed to fetch'); return { ok: true, status: 200, json: async () => ({ ok: true }) }; };
      // Lupa sandi: gagal sekali lalu berhasil -> percobaan kedua mengembalikan payload.
      calls = 0;
      fetch = failOnce;
      out.forgotRetry = await api('/api/auth/forgot-password', { method: 'POST', body: '{}' });
      out.forgotRetryCalls = calls;
      // Lupa sandi: gagal terus -> pesan ramah setelah 2 percobaan.
      calls = 0;
      fetch = async () => { calls++; throw new TypeError('Failed to fetch'); };
      try { await api('/api/auth/forgot-password', { method: 'POST', body: '{}' }); out.forgotFail = 'TIDAK MELEMPAR'; }
      catch (e) { out.forgotFail = e.message; }
      out.forgotFailCalls = calls;
      // GET: gagal sekali lalu berhasil -> diulang juga.
      calls = 0;
      fetch = failOnce;
      out.getRetry = await api('/api/members');
      out.getRetryCalls = calls;
      // Reset sandi: gagal sekali -> TIDAK diulang (1 percobaan saja).
      calls = 0;
      fetch = async () => { calls++; throw new TypeError('Failed to fetch'); };
      try { await api('/api/auth/reset-password', { method: 'POST', body: '{}' }); out.resetFail = 'TIDAK MELEMPAR'; }
      catch (e) { out.resetFail = e.message; }
      out.resetFailCalls = calls;
      // fetch berhasil + HTTP 404 -> error tetap membawa status.
      fetch = async () => ({ ok: false, status: 404, json: async () => ({ error: 'Email tidak terdaftar.' }) });
      try { await api('/api/auth/forgot-password', { method: 'POST', body: '{}' }); out.httpMessage = 'TIDAK MELEMPAR'; }
      catch (e) { out.httpMessage = e.message; out.httpStatus = e.status; }
      // fetch berhasil + HTTP 200 -> payload dikembalikan.
      fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
      out.okPayload = await api('/api/auth/forgot-password', { method: 'POST', body: '{}' });
      return out;
    })()
  `;
  const out = await eval(program);
  assert.deepEqual(out.forgotRetry, { ok: true }, 'lupa sandi harus berhasil di percobaan kedua');
  assert.equal(out.forgotRetryCalls, 2, 'lupa sandi harus mencoba 2 kali');
  assert.equal(out.forgotFail, 'Tidak ada koneksi internet. Periksa jaringanmu lalu coba lagi.', 'lupa sandi yang gagal terus harus menampilkan pesan ramah');
  assert.equal(out.forgotFailCalls, 2, 'lupa sandi yang gagal terus harus mencoba 2 kali');
  assert.deepEqual(out.getRetry, { ok: true }, 'GET harus berhasil di percobaan kedua');
  assert.equal(out.getRetryCalls, 2, 'GET harus mencoba 2 kali');
  assert.equal(out.resetFail, 'Tidak ada koneksi internet. Periksa jaringanmu lalu coba lagi.', 'reset sandi yang gagal harus menampilkan pesan ramah');
  assert.equal(out.resetFailCalls, 1, 'reset sandi TIDAK boleh diulang');
  assert.equal(out.httpMessage, 'Email tidak terdaftar.', 'kesalahan HTTP harus tetap menampilkan pesan server');
  assert.equal(out.httpStatus, 404, 'kesalahan HTTP harus tetap membawa status');
  assert.deepEqual(out.okPayload, { ok: true }, 'respons sukses harus tetap dikembalikan');
});

test('konfirmasi kode sementara muncul sebelum form sandi baru (ronde 39)', () => {
  assert.ok(html.includes('id="forgot-confirm"'), 'blok konfirmasi kode harus ada');
  assert.ok(html.includes('id="forgot-confirm-code"'), 'kolom kode sementara harus ada');
  assert.ok(html.includes('Masukkan kode sementara di sini untuk melanjutkan'), 'label konfirmasi harus sesuai permintaan');
  assert.ok(html.includes('id="forgot-confirm-submit"'), 'tombol Lanjutkan harus ada');
  assert.ok(html.includes('id="forgot-confirm-loading"'), 'animasi loading konfirmasi harus ada');
  assert.ok(html.includes('Memeriksa kode sementara...'), 'teks loading konfirmasi harus ada');
  assert.ok(html.includes('id="forgot-confirm-error"'), 'pesan salah kode harus ada');
  assert.ok(css.includes('.forgot-confirm-error'), 'CSS pesan salah kode harus ada');
  assert.ok(css.includes('.forgot-confirm-loading'), 'CSS loading konfirmasi harus ada');
  assert.ok(css.includes('.forgot-confirm-spinner'), 'CSS spinner loading harus ada');
  assert.ok(css.includes('@keyframes forgot-confirm-spin'), 'animasi putar spinner harus ada');
  assert.ok(appJs.includes('forgotConfirmCodeMatches'), 'fungsi pencocokan kode harus ada');
  assert.ok(appJs.includes("const confirmBox = document.querySelector('#forgot-confirm');"), 'sukses lupa sandi harus menyiapkan blok konfirmasi');
  assert.ok(appJs.includes("confirmBox?.classList.remove('hidden')"), 'sukses lupa sandi harus menampilkan blok konfirmasi');
  assert.ok(appJs.includes("document.querySelector('#forgot-confirm')?.classList.add('hidden')"), 'konfirmasi yang lolos harus menyembunyikan blok konfirmasi');
  assert.ok(appJs.includes('setTimeout(resolve, 900)'), 'konfirmasi harus menampilkan loading sebentar sebelum lanjut');
  assert.ok(appJs.includes('Kode sementara tidak cocok. Periksa lagi kode di atas.'), 'kode salah harus menampilkan pesan yang jelas');
});

test('server: masuk bisa pakai sandi baru maupun sandi sementara (ronde 39)', () => {
  assert.ok(serverJs.includes('target.tempPasswordSalt = salt;'), 'lupa sandi harus menyimpan hash sementara terpisah');
  assert.ok(serverJs.includes('target.tempPasswordHash = passwordHash;'), 'lupa sandi harus menyimpan hash sementara terpisah');
  assert.ok(!serverJs.includes('target.salt = salt;\n      target.passwordHash = passwordHash;\n      target.mustChangePassword = true;'), 'lupa sandi TIDAK boleh lagi menimpa sandi utama');
  assert.ok(serverJs.includes('user.tempPasswordHash && user.tempPasswordSalt'), 'login harus memeriksa hash sementara sebagai cadangan');
  assert.ok(serverJs.includes('const tempSalt = user.tempPasswordSalt || user.salt;'), 'reset sandi harus memakai garam sementara (dengan fallback akun lama)');
  assert.ok(serverJs.includes('const tempHash = user.tempPasswordHash || user.passwordHash;'), 'reset sandi harus memakai hash sementara (dengan fallback akun lama)');
  assert.ok(serverJs.includes("writeAccountPasswordReset(user, { tempPassword, tempPasswordAt, status: 'shown' })"), 'lupa sandi harus mencatat sandi sementara per akun di DATA_AKUN');
  assert.ok(serverJs.includes("writeAccountPasswordReset(user, { status: 'done', resetAt:"), 'reset sandi harus memperbarui catatan per akun di DATA_AKUN');
  assert.ok(serverJs.includes('password-reset.json'), 'catatan per akun harus bernama password-reset.json');
  assert.ok(serverJs.includes('Kamu bisa masuk dengan sandi baru maupun sandi sementara.'), 'pesan sukses reset harus menyebut kedua sandi bisa dipakai masuk');
  const publicUserFn = serverJs.match(/function publicUser\(user\) \{[\s\S]*?\n\}/);
  assert.ok(publicUserFn, 'fungsi publicUser harus bisa diekstrak');
  assert.ok(!publicUserFn[0].includes('tempPasswordHash'), 'publicUser TIDAK boleh membocorkan hash sementara');
  assert.ok(!publicUserFn[0].includes('tempPasswordSalt'), 'publicUser TIDAK boleh membocorkan garam sementara');
});

test('forgotConfirmCodeMatches: cocok persis, salah, kosong', async () => {
  const m = appJs.match(/function forgotConfirmCodeMatches\(entered, expected\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'fungsi forgotConfirmCodeMatches harus bisa diekstrak');
  const fn = m[0].replace('function forgotConfirmCodeMatches', 'function f');
  const out = await eval(`${fn}
[f('7cFWLM6G5z', '7cFWLM6G5z'), f(' 7cFWLM6G5z ', '7cFWLM6G5z'), f('7cfwlm6g5z', '7cFWLM6G5z'), f('7cFWLM6G5y', '7cFWLM6G5z'), f('', '7cFWLM6G5z'), f('7cFWLM6G5z', ''), f('', '')]`);
  assert.deepEqual(out, [true, true, false, false, false, false, false], 'kode harus cocok persis (huruf besar-kecil berpengaruh), spasi di ujung dimaafkan, kosong selalu salah');
});

// Ronde 40: boot() selesai belakangan (mis. /api/me lambat karena WiFi putus
// + retry 1500ms) tidak boleh melempar pengguna yang sudah membuka Lupa
// sandi kembali ke Masuk. Dulu: klik "Lupa sandi?" lalu beberapa detik
// kemudian form hilang dan judul kembali "Masuk ke akunmu".
test('ronde 40: boot() tidak melempar pengguna keluar dari Lupa sandi', async () => {
  assert.ok(appJs.includes('function isAuthSubViewOpen()'), 'helper isAuthSubViewOpen harus ada');
  const boot = appJs.match(/\(async function boot\(\) \{[\s\S]*?\n\}\)\(\);/);
  assert.ok(boot, 'boot IIFE harus bisa diekstrak');
  const bootSrc = boot[0];
  assert.ok(bootSrc.includes('if (isAuthSubViewOpen()) return;'), 'boot harus memeriksa tampilan auth');
  assert.ok(bootSrc.indexOf('isAuthSubViewOpen()') < bootSrc.indexOf('showDashboard(result.user)'), 'cek harus sebelum showDashboard');
  assert.ok(bootSrc.indexOf('isAuthSubViewOpen()') < bootSrc.indexOf('showAuth(savedAuthMode())'), 'cek harus sebelum showAuth');
  const m = appJs.match(/function isAuthSubViewOpen\(\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'fungsi isAuthSubViewOpen harus bisa diekstrak');
  const fn = m[0].replace('function isAuthSubViewOpen', 'function f');
  const out = await eval(`
    const mk = (hidden) => ({ classList: { contains: (c) => c === 'hidden' ? hidden : false } });
    let forgotForm = mk(true), verificationForm = mk(true), adminAccessForm = mk(true);
    ${fn}
    const a = f();
    forgotForm = mk(false);
    const b = f();
    forgotForm = mk(true); verificationForm = mk(false);
    const c = f();
    verificationForm = mk(true); adminAccessForm = mk(false);
    const d = f();
    forgotForm = null; verificationForm = null; adminAccessForm = null;
    const e = f();
    [a, b, c, d, e]`);
  assert.deepEqual(out, [false, true, true, true, true], 'semua tersembunyi -> false; satu tampil (atau form tak ditemukan) -> true');
});

// Ronde 41: unduh AkunJadiBotMu.txt setelah reset sandi — data akun + sandi +
// statistik realtime, UI kartu rapi di HP dan desktop dengan spoiler SVG.
test('ronde 41: unduh AkunJadiBotMu.txt setelah reset sandi (data + statistik realtime)', async () => {
  assert.ok(serverJs.includes('const featureStats = await readAccountFeatureStats(user);'), 'reset sandi harus membaca statistik akun');
  assert.ok(serverJs.includes('storyReadCount: featureStats.storyReadCount'), 'respons reset harus membawa jumlah ReadSW');
  assert.ok(serverJs.includes('reactionCount: featureStats.reactionCount'), 'respons reset harus membawa jumlah ReactionSW');
  assert.ok(serverJs.includes('modeLabel: featureStats.modeLabel'), 'respons reset harus membawa label mode bot');
  assert.ok(html.includes('id="forgot-account-file"'), 'blok unduh data akun harus ada');
  assert.ok(html.includes('id="forgot-account-file-download"'), 'tombol unduh AkunJadiBotMu.txt harus ada');
  assert.ok(html.includes('Unduh AkunJadiBotMu.txt'), 'tombol unduh harus bernama AkunJadiBotMu.txt');
  assert.ok(html.includes('id="forgot-account-file-copy"'), 'tombol salin isi file harus ada');
  assert.ok(html.includes('id="forgot-file-username"'), 'preview harus menampilkan username');
  assert.ok(html.includes('id="forgot-file-email"'), 'preview harus menampilkan email');
  assert.ok(html.includes('id="forgot-file-new-password"'), 'preview harus menampilkan sandi baru');
  assert.ok(html.includes('id="forgot-file-temp-password"'), 'preview harus menampilkan sandi sementara');
  assert.ok(html.includes('id="forgot-file-reads"'), 'preview harus menampilkan jumlah ReadSW');
  assert.ok(html.includes('id="forgot-file-total"'), 'preview harus menampilkan total ReadSW + ReactionSW');
  assert.ok(html.includes('Tidak dapat ditampilkan (tersimpan sebagai hash keamanan)'), 'sandi lama harus dijelaskan tidak bisa ditampilkan');
  const spoilerCount = (html.match(/class="forgot-account-file-spoiler"/g) || []).length;
  assert.equal(spoilerCount, 3, 'harus ada 3 spoiler: Data akun, Sandi, Statistik');
  assert.ok(html.includes('forgot-account-file-spoiler-icon'), 'spoiler harus punya ikon SVG sesuai konteks');
  // Perbaikan laten: pesan selesai TIDAK boleh lagi di dalam div reset yang
  // disembunyikan saat sukses — kalau tidak, pengguna tidak melihat apa-apa.
  const resetDivStart = html.indexOf('id="forgot-reset"');
  const resetDivEnd = html.indexOf('</div>', resetDivStart);
  assert.ok(resetDivStart > -1 && resetDivEnd > resetDivStart, 'div reset harus ditemukan');
  assert.ok(!html.slice(resetDivStart, resetDivEnd).includes('forgot-reset-done'), 'pesan selesai harus di luar div reset');
  assert.ok(html.indexOf('id="forgot-reset-done"') > resetDivEnd, 'pesan selesai harus setelah penutup div reset');
  assert.ok(appJs.includes('showForgotAccountFile(result.account || {}, newPassword, forgotTempPassword);'), 'reset sukses harus membangun file data akun');
  assert.ok(appJs.includes("document.querySelector('#forgot-account-file')?.classList.remove('hidden')"), 'reset sukses harus menampilkan blok unduh');
  assert.ok(appJs.includes("a.download = 'AkunJadiBotMu.txt';"), 'unduhan harus bernama AkunJadiBotMu.txt');
  assert.ok(appJs.includes('navigator.clipboard.writeText(text)'), 'harus ada cadangan salin isi file');
  assert.ok(css.includes('.forgot-account-file{'), 'CSS kartu file harus ada');
  assert.ok(css.includes('.forgot-account-file-spoiler'), 'CSS spoiler harus ada');
  assert.ok(css.includes('.forgot-account-file-list'), 'CSS daftar data harus ada');
  assert.ok(css.includes('@media(min-width:640px)'), 'tombol harus berdampingan di desktop');
  const m = appJs.match(/function buildAccountDataFile\(data\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'fungsi buildAccountDataFile harus bisa diekstrak');
  const fn = m[0].replace('function buildAccountDataFile', 'function f');
  const out = await eval(`${fn}
f({ displayName: 'BangWily', username: 'bangwily', email: 'bangwily@gmail.com', role: 'user', newPassword: 'SandiBaru12345', tempPassword: 'bJAchm4dfJ', modeLabel: 'ReadSW + ReactionSW', storyReadCount: 120, reactionCount: 45, features: { readSW: true, reactionSW: true, online24: false }, generatedAt: '2026-11-28T11:45:00+07:00' })`);
  assert.ok(out.includes('Username      : bangwily'), 'file harus berisi username');
  assert.ok(out.includes('Email         : bangwily@gmail.com'), 'file harus berisi email');
  assert.ok(out.includes('Sandi baru      : SandiBaru12345'), 'file harus berisi sandi baru');
  assert.ok(out.includes('Sandi sementara : bJAchm4dfJ'), 'file harus berisi sandi sementara');
  assert.ok(out.includes('tidak dapat ditampilkan (tersimpan sebagai hash keamanan)'), 'file harus menjelaskan sandi lama');
  assert.ok(out.includes('ReadSW dibaca         : 120'), 'file harus berisi jumlah ReadSW');
  assert.ok(out.includes('ReactionSW            : 45'), 'file harus berisi jumlah ReactionSW');
  assert.ok(out.includes('Total (ReadSW + ReactionSW) : 165'), 'file harus berisi total ReadSW + ReactionSW');
  assert.ok(out.includes('Fitur aktif           : ReadSW, ReactionSW'), 'file harus berisi fitur aktif');
  assert.ok(out.includes('Sabtu, 28 Nov 2026'), 'file harus berisi tanggal pembuatan');
  assert.ok(out.includes('jangan dibagikan ke siapa pun'), 'file harus berisi peringatan privasi');
});

test('ronde 43: modal Ganti sandi tidak lagi minta sandi sementara', () => {
  const modalStart = html.indexOf('id="change-password-overlay"');
  const modalEnd = html.indexOf('</form>', modalStart);
  const modal = html.slice(modalStart, modalEnd);
  assert.ok(!modal.includes('name="currentPassword"'), 'modal TIDAK boleh lagi punya kolom sandi sementara');
  assert.ok(!modal.includes('Sandi sementara dari WhatsApp'), 'modal TIDAK boleh lagi menyebut sandi sementara dari WhatsApp');
  assert.ok(modal.includes('name="newPassword"'), 'modal harus tetap punya kolom sandi baru');
  assert.ok(modal.includes('name="confirmPassword"'), 'modal harus tetap punya kolom ulangi sandi baru');
  assert.ok(modal.includes('Tidak perlu memasukkan sandi sementara lagi'), 'modal harus menjelaskan sandi sementara tidak perlu dimasukkan lagi');
  assert.ok(appJs.includes("JSON.stringify({ newPassword: data.newPassword })"), 'modal harus mengirim hanya sandi baru');
  assert.ok(serverJs.includes('else if (!user.mustChangePassword)'), 'server harus tetap wajib sandi lama untuk ganti sukarela');
  assert.ok(serverJs.includes('RONDE 43'), 'server harus menandai logika ronde 43');
});

test('server ganti sandi ronde 43: tanpa sandi lama lolos saat wajib ganti, tetap wajib saat sukarela', { timeout: 60_000 }, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'readsw-change-password-r43-test-'));
  const root = path.join(temp, 'project');
  const dataDir = path.join(root, 'runtime-data');
  const memberPassword = 'FixtureMember-Only-Password!';
  const tempPassword = 'TempPassR43!';
  let child;
  try {
    await mkdir(root, { recursive: true });
    await cp(path.join(sourceRoot, 'server'), path.join(root, 'server'), { recursive: true });
    await cp(path.join(sourceRoot, 'public'), path.join(root, 'public'), { recursive: true });
    await cp(path.join(sourceRoot, 'package.json'), path.join(root, 'package.json'));
    await symlink(path.join(sourceRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir');
    await mkdir(dataDir, { recursive: true });
    const tempSalt = randomBytes(16).toString('hex');
    const tempHash = scryptSync(tempPassword, tempSalt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex');
    const member = fixtureUser('fixturemember', 'fixturemember@example.test', 'member', memberPassword);
    member.mustChangePassword = true;
    member.tempPasswordSalt = tempSalt;
    member.tempPasswordHash = tempHash;
    member.tempPasswordAt = new Date().toISOString();
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

    // Masuk pakai sandi sementara: wajib ganti sandi.
    const tempLogin = await jsonRequest(base, '/api/auth/login', { method: 'POST', body: { identifier: 'fixturemember', password: tempPassword } });
    assert.equal(tempLogin.status, 200, 'login sandi sementara harus 200');
    assert.equal(tempLogin.payload.user.mustChangePassword, true, 'login sandi sementara harus menandai wajib ganti');
    const memberCookie = tempLogin.cookie;

    // Tanpa sandi lama, ganti sandi HARUS lolos saat wajib ganti (ronde 43).
    const noCurrent = await jsonRequest(base, '/api/auth/change-password', { method: 'POST', body: { newPassword: 'SandiBaruR43Panjang!' }, cookie: memberCookie });
    assert.equal(noCurrent.status, 200, 'ganti sandi tanpa sandi lama harus 200 saat wajib ganti');
    const storeAfter = JSON.parse(await readFile(path.join(dataDir, 'store.json'), 'utf8'));
    const changedUser = storeAfter.users.find((item) => item.username === 'fixturemember');
    assert.equal(changedUser.mustChangePassword, false, 'setelah ganti sandi penanda wajib ganti harus hilang');
    assert.ok(changedUser.passwordChangedAt, 'ganti sandi harus mencatat passwordChangedAt');

    // Login dengan sandi baru berhasil, tanpa penanda wajib ganti.
    const newLogin = await jsonRequest(base, '/api/auth/login', { method: 'POST', body: { identifier: 'fixturemember', password: 'SandiBaruR43Panjang!' } });
    assert.equal(newLogin.status, 200, 'login sandi baru harus 200');
    assert.equal(newLogin.payload.user.mustChangePassword, false, 'login sandi baru tidak boleh menandai wajib ganti');
    const newCookie = newLogin.cookie;

    // Ganti sandi sukarela (tidak wajib): tanpa sandi lama harus 400,
    // sandi lama salah harus 401, sandi lama benar harus 200.
    const noCurrentVoluntary = await jsonRequest(base, '/api/auth/change-password', { method: 'POST', body: { newPassword: 'SandiBaruR43Kedua!' }, cookie: newCookie });
    assert.equal(noCurrentVoluntary.status, 400, 'ganti sukarela tanpa sandi lama harus 400');
    const wrongCurrent = await jsonRequest(base, '/api/auth/change-password', { method: 'POST', body: { currentPassword: 'salah-salah', newPassword: 'SandiBaruR43Kedua!' }, cookie: newCookie });
    assert.equal(wrongCurrent.status, 401, 'ganti sukarela sandi lama salah harus 401');
    const rightCurrent = await jsonRequest(base, '/api/auth/change-password', { method: 'POST', body: { currentPassword: 'SandiBaruR43Panjang!', newPassword: 'SandiBaruR43Kedua!' }, cookie: newCookie });
    assert.equal(rightCurrent.status, 200, 'ganti sukarela sandi lama benar harus 200');
  } finally {
    if (child) child.kill();
    await rm(temp, { recursive: true, force: true });
  }
});
