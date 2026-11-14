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

async function login(base, identifier, password) {
  const result = await jsonRequest(base, '/api/auth/login', { method: 'POST', body: { identifier, password } });
  return { ...result, cookie: result.cookie };
}

async function startFixture(users, bots = []) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'readsw-member-delete-test-'));
  const root = path.join(temp, 'project');
  const dataDir = path.join(root, 'runtime-data');
  const adminPassword = 'FixtureAdmin-Only-Password!';
  const memberPassword = 'FixtureMember-Only-Password!';
  const secret = randomBytes(48).toString('base64url');
  await mkdir(root, { recursive: true });
  await cp(path.join(sourceRoot, 'server'), path.join(root, 'server'), { recursive: true });
  await cp(path.join(sourceRoot, 'public'), path.join(root, 'public'), { recursive: true });
  await cp(path.join(sourceRoot, 'package.json'), path.join(root, 'package.json'));
  await symlink(path.join(sourceRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  await mkdir(dataDir, { recursive: true });
  await mkdir(path.join(root, 'DATA_AKUN', 'fixturemember'), { recursive: true });
  await writeFile(path.join(root, 'DATA_AKUN', 'fixturemember', 'marker.txt'), 'akun member yang akan dihapus');
  await writeFile(path.join(dataDir, 'store.json'), JSON.stringify({
    users, pendingRegistrations: [], bots, sessions: [], pairingLogs: [], loginHistory: [],
  }));
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
    } catch { /* Wait briefly for local fixture startup. */ }
    await wait(100);
  }
  assert.equal(ready, true, 'isolated fixture server should start');
  const stop = async () => {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([new Promise((resolve) => child.once('exit', resolve)), wait(3000)]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    await rm(temp, { recursive: true, force: true });
  };
  return { base, root, dataDir, adminPassword, memberPassword, stop };
}

test('admin can permanently delete a member; registry, sessions and DATA_AKUN are removed and login shows the deleted notice', { timeout: 30_000 }, async () => {
  const admin = fixtureUser('fixtureadmin', 'fixtureadmin@example.test', 'admin', 'FixtureAdmin-Only-Password!');
  const member = fixtureUser('fixturemember', 'fixturemember@example.test', 'member', 'FixtureMember-Only-Password!');
  const member2 = fixtureUser('fixturemember2', 'fixturemember2@example.test', 'member', 'FixtureMember-Only-Password!');
  const fixture = await startFixture([admin, member, member2], [
    { id: randomUUID(), userId: member.id, label: null, mode: 'readonly', autoStart: true, online24: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  ]);
  try {
    const adminLogin = await login(fixture.base, 'fixtureadmin', fixture.adminPassword);
    const memberLogin = await login(fixture.base, 'fixturemember', fixture.memberPassword);
    assert.equal(adminLogin.status, 200);
    assert.equal(memberLogin.status, 200);
    assert.ok(memberLogin.cookie?.startsWith('readsw_session='));

    const banned = await jsonRequest(fixture.base, '/api/admin/users/ban', {
      method: 'POST', cookie: adminLogin.cookie,
      body: { userId: member2.id, action: 'ban', confirm: true, reason: 'pelanggaran aturan' },
    });
    assert.equal(banned.status, 200);
    const bannedLogin = await login(fixture.base, 'fixturemember2', fixture.memberPassword);
    assert.equal(bannedLogin.status, 403);
    assert.equal(bannedLogin.payload.banned, true);
    assert.equal(bannedLogin.payload.banReason, 'pelanggaran aturan');

    const deleted = await jsonRequest(fixture.base, '/api/admin/users/delete', {
      method: 'POST', cookie: adminLogin.cookie,
      body: { userId: member.id, confirm: true, reason: 'akun tidak aktif' },
    });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.payload.ok, true);
    assert.equal(deleted.payload.deleted, true);
    assert.equal(deleted.payload.username, 'fixturemember');
    assert.equal(deleted.payload.reason, 'akun tidak aktif');
    assert.equal(deleted.payload.warning, null);

    const stored = JSON.parse(await readFile(path.join(fixture.dataDir, 'store.json'), 'utf8'));
    assert.equal(stored.users.some((item) => item.id === member.id), false, 'deleted user is gone from the registry');
    assert.equal(stored.users.some((item) => item.id === admin.id), true, 'other users are untouched');
    assert.equal(stored.sessions.some((item) => item.userId === member.id), false, 'deleted user sessions are gone');
    assert.equal(stored.loginHistory.some((item) => item.userId === member.id), false, 'deleted user login history is gone');
    assert.equal(stored.bots.some((item) => item.userId === member.id), false, 'deleted user bot record is gone');
    const tombstone = stored.deletedAccounts?.find((item) => item.username === 'fixturemember');
    assert.ok(tombstone, 'a tombstone is written for the deleted account');
    assert.equal(tombstone.email, 'fixturemember@example.test');
    assert.equal(tombstone.deletedBy, admin.id);
    assert.equal(tombstone.reason, 'akun tidak aktif');
    const auditEntry = stored.adminAudit?.find((item) => item.action === 'delete' && item.targetId === member.id);
    assert.ok(auditEntry, 'the deletion is recorded in the admin audit log');
    assert.equal(auditEntry.reason, 'akun tidak aktif');
    const banAuditEntry = stored.adminAudit?.find((item) => item.action === 'ban' && item.targetId === member2.id);
    assert.ok(banAuditEntry, 'earlier audit entries are kept');
    await assert.rejects(readFile(path.join(fixture.root, 'DATA_AKUN', 'fixturemember', 'marker.txt'), 'utf8'), 'the DATA_AKUN folder of the deleted account is removed');

    const revokedSession = await jsonRequest(fixture.base, '/api/me', { cookie: memberLogin.cookie });
    assert.equal(revokedSession.status, 401, 'the deleted member session is revoked');
    const deletedLogin = await login(fixture.base, 'fixturemember', fixture.memberPassword);
    assert.equal(deletedLogin.status, 403);
    assert.equal(deletedLogin.payload.deleted, true);
    assert.equal(deletedLogin.payload.reason, 'akun tidak aktif');
    assert.match(deletedLogin.payload.error, /dihapus oleh admin/i);
    const deletedLoginByEmail = await login(fixture.base, 'fixturemember@example.test', fixture.memberPassword);
    assert.equal(deletedLoginByEmail.status, 403);
    assert.equal(deletedLoginByEmail.payload.deleted, true);
    const unknownLogin = await login(fixture.base, 'tidakada@example.test', fixture.memberPassword);
    assert.equal(unknownLogin.status, 404, 'unknown identifiers still return 404 without leaking the tombstone');
  } finally {
    await fixture.stop();
  }
});

test('member delete rejects non-admins, self-deletion, unknown targets and missing confirmation', { timeout: 30_000 }, async () => {
  const admin = fixtureUser('fixtureadmin', 'fixtureadmin@example.test', 'admin', 'FixtureAdmin-Only-Password!');
  const member = fixtureUser('fixturemember', 'fixturemember@example.test', 'member', 'FixtureMember-Only-Password!');
  const fixture = await startFixture([admin, member]);
  try {
    const adminLogin = await login(fixture.base, 'fixtureadmin', fixture.adminPassword);
    const memberLogin = await login(fixture.base, 'fixturemember', fixture.memberPassword);
    assert.equal(adminLogin.status, 200);
    assert.equal(memberLogin.status, 200);

    const forbidden = await jsonRequest(fixture.base, '/api/admin/users/delete', {
      method: 'POST', cookie: memberLogin.cookie,
      body: { userId: member.id, confirm: true },
    });
    assert.equal(forbidden.status, 403);
    const unauthenticated = await jsonRequest(fixture.base, '/api/admin/users/delete', {
      method: 'POST', body: { userId: member.id, confirm: true },
    });
    assert.equal(unauthenticated.status, 401);
    const selfDelete = await jsonRequest(fixture.base, '/api/admin/users/delete', {
      method: 'POST', cookie: adminLogin.cookie,
      body: { userId: admin.id, confirm: true },
    });
    assert.equal(selfDelete.status, 400);
    assert.match(selfDelete.payload.error, /tidak dapat menghapus akun sendiri/i);
    const unknown = await jsonRequest(fixture.base, '/api/admin/users/delete', {
      method: 'POST', cookie: adminLogin.cookie,
      body: { userId: randomUUID(), confirm: true },
    });
    assert.equal(unknown.status, 404);
    const unconfirmed = await jsonRequest(fixture.base, '/api/admin/users/delete', {
      method: 'POST', cookie: adminLogin.cookie,
      body: { userId: member.id },
    });
    assert.equal(unconfirmed.status, 400);
    const stillThere = await login(fixture.base, 'fixturemember', fixture.memberPassword);
    assert.equal(stillThere.status, 200, 'rejected deletions leave the account intact');
  } finally {
    await fixture.stop();
  }
});
