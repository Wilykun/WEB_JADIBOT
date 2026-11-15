import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { access, cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ACCESS_CODE = 'KONTIL';

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

async function pathExists(file) {
  try { await access(file); return true; } catch { return false; }
}

async function waitForPath(file, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await pathExists(file)) return true;
    await wait(100);
  }
  return pathExists(file);
}

// Server fixture: config.json membawa adminAccessCode; admin fixture adalah
// Admin Utama (username-nya sama dengan BOOTSTRAP_ADMIN_USERNAME dari config).
async function startFixture({ adminAccessCode = ACCESS_CODE, preCreate = [] } = {}) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'readsw-admin-reg-test-'));
  const root = path.join(temp, 'project');
  const dataDir = path.join(root, 'runtime-data');
  const adminPassword = 'FixtureAdmin-Only-Password!';
  const secret = randomBytes(48).toString('base64url');
  await mkdir(root, { recursive: true });
  await cp(path.join(sourceRoot, 'server'), path.join(root, 'server'), { recursive: true });
  await cp(path.join(sourceRoot, 'public'), path.join(root, 'public'), { recursive: true });
  await cp(path.join(sourceRoot, 'package.json'), path.join(root, 'package.json'));
  await symlink(path.join(sourceRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  await mkdir(dataDir, { recursive: true });
  const admin = fixtureUser('fixtureadmin', 'fixtureadmin@example.test', 'admin', adminPassword);
  await writeFile(path.join(dataDir, 'store.json'), JSON.stringify({
    users: [admin], pendingRegistrations: [], bots: [], sessions: [], pairingLogs: [], loginHistory: [],
  }));
  const config = {
    port: 3000, host: '127.0.0.1',
    ...(adminAccessCode === null ? {} : { adminAccessCode }),
    admin: { email: admin.email, username: admin.username, name: 'Fixture Admin', password: adminPassword },
  };
  await writeFile(path.join(root, 'config.json'), JSON.stringify(config));
  for (const [dir, file] of preCreate) {
    await mkdir(path.join(root, dir), { recursive: true });
    await writeFile(path.join(root, dir, file), 'penanda folder lama');
  }
  const port = await unusedPort();
  const base = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    HOST: '127.0.0.1', PORT: String(port), PANEL_DATA_DIR: 'runtime-data', SESSION_SECRET: secret, NODE_ENV: 'test',
  };
  const child = spawn(process.execPath, [path.join(root, 'server/index.js')], { cwd: root, env, stdio: 'ignore' });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`fixture server exited with code ${child.exitCode}`);
    try {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) { ready = true; break; }
    } catch { /* Server belum siap. */ }
    await wait(100);
  }
  if (!ready) throw new Error('fixture server did not become ready');
  const login = await jsonRequest(base, '/api/auth/login', { method: 'POST', body: { identifier: admin.username, password: adminPassword } });
  assert.equal(login.status, 200, `login Admin Utama gagal: ${JSON.stringify(login.payload)}`);
  assert.equal(login.payload.user.isMainAdmin, true);
  return {
    base, root, admin, adminCookie: login.cookie,
    cleanup: async () => {
      child.kill('SIGTERM');
      await wait(200);
      await rm(temp, { recursive: true, force: true });
    },
  };
}

async function registerAndVerify(base, { username, email, password, role }) {
  const reg = await jsonRequest(base, '/api/auth/register', { method: 'POST', body: { username, email, password, role } });
  assert.equal(reg.status, 201, `register gagal: ${JSON.stringify(reg.payload)}`);
  const verify = await jsonRequest(base, '/api/auth/verify-registration', {
    method: 'POST', body: { identifier: username, code: reg.payload.verification.prompt },
  });
  return { reg, verify };
}

async function registerAdminWithCode(base, { username, email, password, code = ACCESS_CODE }) {
  const { verify } = await registerAndVerify(base, { username, email, password, role: 'admin' });
  assert.equal(verify.status, 200, `verify admin gagal: ${JSON.stringify(verify.payload)}`);
  assert.equal(verify.payload.needsAccessCode, true);
  const access = await jsonRequest(base, '/api/auth/admin-access', {
    method: 'POST', body: { identifier: username, accessCode: code },
  });
  return access;
}

test('member mendaftar lalu masuk; folder akun di DATA_AKUN, bukan DATA_ADMIN', { timeout: 30_000 }, async () => {
  const fixture = await startFixture();
  try {
    const { verify } = await registerAndVerify(fixture.base, {
      username: 'memberbaru', email: 'memberbaru@example.test', password: 'MemberBaru-Sandi123!', role: 'user',
    });
    assert.equal(verify.status, 200, JSON.stringify(verify.payload));
    assert.equal(verify.payload.user.role, 'user');
    assert.equal(verify.payload.user.isMainAdmin, false);
    assert.ok(verify.cookie, 'verifikasi member harus membuat sesi');
    const members = await jsonRequest(fixture.base, '/api/members', { cookie: verify.cookie });
    const created = members.payload.users.find((item) => item.username === 'memberbaru');
    assert.ok(created);
    assert.equal(created.role, 'member');
    assert.equal(created.isMainAdmin, false);
    assert.equal(await waitForPath(path.join(fixture.root, 'DATA_AKUN', 'memberbaru', 'akun.json')), true);
    assert.equal(await pathExists(path.join(fixture.root, 'DATA_ADMIN', 'memberbaru')), false);
  } finally {
    await fixture.cleanup();
  }
});

test('admin mendaftar: verifikasi lalu kode akses; folder akun di DATA_ADMIN', { timeout: 30_000 }, async () => {
  const fixture = await startFixture();
  try {
    const { verify } = await registerAndVerify(fixture.base, {
      username: 'adminbaru', email: 'adminbaru@example.test', password: 'AdminBaru-Sandi123!', role: 'admin',
    });
    assert.equal(verify.status, 200, JSON.stringify(verify.payload));
    assert.equal(verify.payload.needsAccessCode, true);
    assert.equal(verify.cookie, null, 'akun admin belum boleh punya sesi sebelum kode akses');
    const listBefore = await jsonRequest(fixture.base, '/api/admin/users', { cookie: fixture.adminCookie });
    assert.equal(listBefore.payload.users.some((item) => item.username === 'adminbaru'), false);
    const wrong = await jsonRequest(fixture.base, '/api/auth/admin-access', {
      method: 'POST', body: { identifier: 'adminbaru', accessCode: 'SALAH' },
    });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.payload.attemptsRemaining, 4);
    const access = await jsonRequest(fixture.base, '/api/auth/admin-access', {
      method: 'POST', body: { identifier: 'adminbaru', accessCode: 'kontil' },
    });
    assert.equal(access.status, 200, JSON.stringify(access.payload));
    assert.equal(access.payload.user.role, 'admin');
    assert.equal(access.payload.user.isMainAdmin, false);
    assert.ok(access.cookie, 'kode akses benar harus membuat sesi admin');
    assert.equal(await waitForPath(path.join(fixture.root, 'DATA_ADMIN', 'adminbaru', 'akun.json')), true);
    assert.equal(await pathExists(path.join(fixture.root, 'DATA_AKUN', 'adminbaru')), false);
  } finally {
    await fixture.cleanup();
  }
});

test('kode akses salah 5 kali membatalkan pendaftaran admin', { timeout: 30_000 }, async () => {
  const fixture = await startFixture();
  try {
    const { verify } = await registerAndVerify(fixture.base, {
      username: 'admingagal', email: 'admingagal@example.test', password: 'AdminGagal-Sandi123!', role: 'admin',
    });
    assert.equal(verify.payload.needsAccessCode, true);
    let last;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      last = await jsonRequest(fixture.base, '/api/auth/admin-access', {
        method: 'POST', body: { identifier: 'admingagal', accessCode: 'SALAH' },
      });
    }
    assert.equal(last.status, 403);
    assert.match(last.payload.error, /dibatalkan/i);
    const verifyAgain = await jsonRequest(fixture.base, '/api/auth/verify-registration', {
      method: 'POST', body: { identifier: 'admingagal', code: 'AAAAA' },
    });
    assert.equal(verifyAgain.status, 400);
  } finally {
    await fixture.cleanup();
  }
});

test('daftar admin ditolak bila kode akses belum dikonfigurasi', { timeout: 30_000 }, async () => {
  const fixture = await startFixture({ adminAccessCode: null });
  try {
    const reg = await jsonRequest(fixture.base, '/api/auth/register', {
      method: 'POST',
      body: { username: 'admintanpakode', email: 'admintanpakode@example.test', password: 'AdminTanpa-Sandi123!', role: 'admin' },
    });
    assert.equal(reg.status, 400);
    assert.match(reg.payload.error, /belum dikonfigurasi/i);
    const memberReg = await jsonRequest(fixture.base, '/api/auth/register', {
      method: 'POST',
      body: { username: 'memberok', email: 'memberok@example.test', password: 'MemberOk-Sandi123!', role: 'user' },
    });
    assert.equal(memberReg.status, 201);
  } finally {
    await fixture.cleanup();
  }
});

test('folder admin lama di DATA_AKUN tetap dipakai sebagai fallback', { timeout: 30_000 }, async () => {
  const fixture = await startFixture({ preCreate: [[path.join('DATA_AKUN', 'adminlama'), 'penanda.txt']] });
  try {
    const access = await registerAdminWithCode(fixture.base, {
      username: 'adminlama', email: 'adminlama@example.test', password: 'AdminLama-Sandi123!',
    });
    assert.equal(access.status, 200, JSON.stringify(access.payload));
    assert.equal(await waitForPath(path.join(fixture.root, 'DATA_AKUN', 'adminlama', 'akun.json')), true);
    assert.equal(await pathExists(path.join(fixture.root, 'DATA_AKUN', 'adminlama', 'penanda.txt')), true);
    assert.equal(await pathExists(path.join(fixture.root, 'DATA_ADMIN', 'adminlama')), false);
  } finally {
    await fixture.cleanup();
  }
});

test('Admin Utama bisa mengelola admin biasa; admin biasa tidak bisa menyentuh Admin Utama', { timeout: 30_000 }, async () => {
  const fixture = await startFixture();
  try {
    const access = await registerAdminWithCode(fixture.base, {
      username: 'adminbiasa', email: 'adminbiasa@example.test', password: 'AdminBiasa-Sandi123!',
    });
    assert.equal(access.status, 200, JSON.stringify(access.payload));
    const list = await jsonRequest(fixture.base, '/api/admin/users', { cookie: fixture.adminCookie });
    const regular = list.payload.users.find((item) => item.username === 'adminbiasa');
    const main = list.payload.users.find((item) => item.username === 'fixtureadmin');
    assert.ok(regular && main);
    assert.equal(main.isMainAdmin, true);
    assert.equal(regular.isMainAdmin, false);
    const banByRegular = await jsonRequest(fixture.base, '/api/admin/users/ban', {
      method: 'POST', body: { userId: main.id, action: 'ban', confirm: true, reason: 'tes' }, cookie: access.cookie,
    });
    assert.equal(banByRegular.status, 400);
    const banByMain = await jsonRequest(fixture.base, '/api/admin/users/ban', {
      method: 'POST', body: { userId: regular.id, action: 'ban', confirm: true, reason: 'tes' }, cookie: fixture.adminCookie,
    });
    assert.equal(banByMain.status, 200, JSON.stringify(banByMain.payload));
    const unban = await jsonRequest(fixture.base, '/api/admin/users/ban', {
      method: 'POST', body: { userId: regular.id, action: 'unban' }, cookie: fixture.adminCookie,
    });
    assert.equal(unban.status, 200, JSON.stringify(unban.payload));
  } finally {
    await fixture.cleanup();
  }
});
