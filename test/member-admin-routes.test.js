import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { cp, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
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

async function login(base, identifier, password) {
  const result = await jsonRequest(base, '/api/auth/login', { method: 'POST', body: { identifier, password } });
  return { ...result, cookie: result.cookie };
}

test('admin can ban/unban a member; sessions are revoked and banned login is notified', { timeout: 30_000 }, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'readsw-member-route-test-'));
  const root = path.join(temp, 'project');
  const dataDir = path.join(root, 'runtime-data');
  const adminPassword = 'FixtureAdmin-Only-Password!';
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
    const admin = fixtureUser('fixtureadmin', 'fixtureadmin@example.test', 'admin', adminPassword);
    const member = fixtureUser('fixturemember', 'fixturemember@example.test', 'member', memberPassword);
    await writeFile(path.join(dataDir, 'store.json'), JSON.stringify({
      users: [admin, member], pendingRegistrations: [], bots: [], sessions: [], pairingLogs: [], loginHistory: [],
    }));

    const port = await unusedPort();
    const base = `http://127.0.0.1:${port}`;
    const env = {
      ...process.env,
      HOST: '127.0.0.1', PORT: String(port), PANEL_DATA_DIR: 'runtime-data', SESSION_SECRET: secret, NODE_ENV: 'test',
    };
    child = spawn(process.execPath, [path.join(root, 'server/index.js')], { cwd: root, env, stdio: 'ignore' });
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

    const adminLogin = await login(base, 'fixtureadmin', adminPassword);
    const memberLogin = await login(base, 'fixturemember', memberPassword);
    assert.equal(adminLogin.status, 200);
    assert.equal(memberLogin.status, 200);
    assert.ok(adminLogin.cookie?.startsWith('readsw_session='));
    assert.ok(memberLogin.cookie?.startsWith('readsw_session='));

    const forbidden = await jsonRequest(base, '/api/admin/users', { cookie: memberLogin.cookie });
    assert.equal(forbidden.status, 403);
    const unlinkedStart = await jsonRequest(base, '/api/admin/users/bot', {
      method: 'POST', cookie: adminLogin.cookie,
      body: { userId: memberLogin.payload.user.id, action: 'start', confirmActivity: true },
    });
    assert.equal(unlinkedStart.status, 409, 'admin cannot start a bot without a member-linked WhatsApp session');

    const unconfirmedBan = await jsonRequest(base, '/api/admin/users/ban', {
      method: 'POST', cookie: adminLogin.cookie,
      body: { userId: memberLogin.payload.user.id, action: 'ban', confirm: false },
    });
    assert.equal(unconfirmedBan.status, 400);

    const banned = await jsonRequest(base, '/api/admin/users/ban', {
      method: 'POST', cookie: adminLogin.cookie,
      body: { userId: memberLogin.payload.user.id, action: 'ban', confirm: true, reason: '  test reason  ' },
    });
    assert.equal(banned.status, 200);
    assert.equal(banned.payload.banned, true);

    const users = await jsonRequest(base, '/api/admin/users', { cookie: adminLogin.cookie });
    const listedMember = users.payload.users.find((user) => user.id === memberLogin.payload.user.id);
    assert.equal(listedMember.banned, true);
    assert.equal(listedMember.panelActive, false);
    assert.equal(listedMember.banReason, 'test reason');

    const revokedSession = await jsonRequest(base, '/api/me', { cookie: memberLogin.cookie });
    assert.equal(revokedSession.status, 401);
    const bannedLogin = await login(base, 'fixturemember', memberPassword);
    assert.equal(bannedLogin.status, 403);
    assert.equal(bannedLogin.payload.banned, true);
    assert.match(bannedLogin.payload.error, /diblokir oleh admin/i);
    const wrongPassword = await login(base, 'fixturemember', 'wrong-password');
    assert.equal(wrongPassword.status, 401, 'ban status is not disclosed before password validation');

    const unbanned = await jsonRequest(base, '/api/admin/users/ban', {
      method: 'POST', cookie: adminLogin.cookie,
      body: { userId: memberLogin.payload.user.id, action: 'unban' },
    });
    assert.equal(unbanned.status, 200);
    assert.equal(unbanned.payload.banned, false);
    assert.equal((await login(base, 'fixturemember', memberPassword)).status, 200);
  } finally {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([new Promise((resolve) => child.once('exit', resolve)), wait(3000)]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    await rm(temp, { recursive: true, force: true });
  }
});
