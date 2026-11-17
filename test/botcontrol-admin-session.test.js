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

test('admin dapat mengatur mode dan preferensi story member; Admin Utama tidak dapat diubah siapa pun', { timeout: 30_000 }, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'readsw-botcontrol-settings-test-'));
  const root = path.join(temp, 'project');
  const dataDir = path.join(root, 'runtime-data');
  const mainPassword = 'FixtureMain-Only-Password!';
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
    const mainAdmin = fixtureUser('fixturemain', 'fixturemain@example.test', 'admin', mainPassword);
    const admin = fixtureUser('fixtureadmin', 'fixtureadmin@example.test', 'admin', adminPassword);
    const member = fixtureUser('fixturemember', 'fixturemember@example.test', 'member', memberPassword);
    await writeFile(path.join(dataDir, 'store.json'), JSON.stringify({
      users: [mainAdmin, admin, member], pendingRegistrations: [], bots: [], sessions: [], pairingLogs: [], loginHistory: [],
    }));

    const port = await unusedPort();
    const base = `http://127.0.0.1:${port}`;
    const env = {
      ...process.env,
      HOST: '127.0.0.1', PORT: String(port), PANEL_DATA_DIR: 'runtime-data', SESSION_SECRET: secret, NODE_ENV: 'test',
      BOOTSTRAP_ADMIN_USERNAME: 'fixturemain',
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

    const mainLogin = await login(base, 'fixturemain', mainPassword);
    const adminLogin = await login(base, 'fixtureadmin', adminPassword);
    const memberLogin = await login(base, 'fixturemember', memberPassword);
    assert.equal(mainLogin.status, 200);
    assert.equal(adminLogin.status, 200);
    assert.equal(memberLogin.status, 200);
    const mainId = mainLogin.payload.user.id;
    const adminId = adminLogin.payload.user.id;
    const memberId = memberLogin.payload.user.id;
    const settingsBody = (userId, overrides = {}) => ({
      userId, label: 'Bot fixturemember', mode: 'readonly_readsw', online24: true,
      storySettings: { autoReaction: true, delayMinSeconds: 2, delayMaxSeconds: 10, randomDelay: true, emojiPoolVersion: 2, emojiOptions: ['💚', '🔥'], emojiPool: ['💚'] },
      ...overrides,
    });

    // Tanpa login: 401.
    const anonymous = await jsonRequest(base, '/api/admin/users/bot-settings', { method: 'PUT', body: settingsBody(memberId) });
    assert.equal(anonymous.status, 401);

    // Member tidak boleh mengatur bot siapa pun: 403.
    const memberAttempt = await jsonRequest(base, '/api/admin/users/bot-settings', { method: 'PUT', cookie: memberLogin.cookie, body: settingsBody(memberId) });
    assert.equal(memberAttempt.status, 403);

    // Admin biasa tidak bisa mengatur bot Admin Utama: 400.
    const mainTarget = await jsonRequest(base, '/api/admin/users/bot-settings', { method: 'PUT', cookie: adminLogin.cookie, body: settingsBody(mainId) });
    assert.equal(mainTarget.status, 400);
    assert.match(mainTarget.payload.error, /Admin Utama tidak dapat diubah/i);

    // Admin biasa tidak bisa mengatur bot admin biasa lain: 400.
    const adminTarget = await jsonRequest(base, '/api/admin/users/bot-settings', { method: 'PUT', cookie: adminLogin.cookie, body: settingsBody(adminId) });
    assert.equal(adminTarget.status, 400);

    // Mode tidak valid: 400.
    const badMode = await jsonRequest(base, '/api/admin/users/bot-settings', { method: 'PUT', cookie: mainLogin.cookie, body: settingsBody(memberId, { mode: 'semua' }) });
    assert.equal(badMode.status, 400);

    // Delay minimum melebihi maksimum: 400.
    const badDelay = await jsonRequest(base, '/api/admin/users/bot-settings', { method: 'PUT', cookie: mainLogin.cookie, body: settingsBody(memberId, { storySettings: { autoReaction: true, delayMinSeconds: 15, delayMaxSeconds: 5, randomDelay: true, emojiPoolVersion: 2, emojiOptions: ['💚'], emojiPool: ['💚'] } }) });
    assert.equal(badDelay.status, 400);

    // Emoji bukan emoji tunggal: 400.
    const badEmoji = await jsonRequest(base, '/api/admin/users/bot-settings', { method: 'PUT', cookie: mainLogin.cookie, body: settingsBody(memberId, { storySettings: { autoReaction: true, delayMinSeconds: 2, delayMaxSeconds: 10, randomDelay: true, emojiPoolVersion: 2, emojiOptions: ['abc'], emojiPool: ['abc'] } }) });
    assert.equal(badEmoji.status, 400);

    // Admin Utama mengatur bot member yang belum punya profil: 200, profil dibuat.
    const saved = await jsonRequest(base, '/api/admin/users/bot-settings', { method: 'PUT', cookie: mainLogin.cookie, body: settingsBody(memberId) });
    assert.equal(saved.status, 200);
    assert.equal(saved.payload.ok, true);
    assert.equal(saved.payload.bot.mode, 'readonly_readsw');
    assert.equal(saved.payload.bot.online24, true);
    assert.equal(saved.payload.bot.storySettings.delayMinSeconds, 2);
    assert.equal(saved.payload.bot.storySettings.delayMaxSeconds, 10);
    assert.deepEqual(saved.payload.bot.storySettings.emojiOptions, ['💚', '🔥']);
    assert.deepEqual(saved.payload.bot.storySettings.emojiPool, ['💚']);

    // Admin biasa boleh mengatur bot member: 200, mode berubah.
    const adminSaved = await jsonRequest(base, '/api/admin/users/bot-settings', { method: 'PUT', cookie: adminLogin.cookie, body: settingsBody(memberId, { mode: 'readonly', online24: false, storySettings: { autoReaction: false, delayMinSeconds: 1, delayMaxSeconds: 20, randomDelay: true, emojiPoolVersion: 2, emojiOptions: ['💚'], emojiPool: ['💚'] } }) });
    assert.equal(adminSaved.status, 200);
    assert.equal(adminSaved.payload.bot.mode, 'readonly');
    assert.equal(adminSaved.payload.bot.online24, false);
    assert.equal(adminSaved.payload.bot.storySettings.autoReaction, false);

    // Pengaturan tersimpan di store dan tercatat di audit.
    const store = JSON.parse(await readFile(path.join(dataDir, 'store.json'), 'utf8'));
    const memberBot = (store.bots || []).find((bot) => bot.userId === memberId);
    assert.equal(memberBot?.mode, 'readonly');
    assert.equal(memberBot?.storySettings.delayMaxSeconds, 20);
    const updates = (store.adminAudit || []).filter((entry) => entry.action === 'bot_settings_update');
    assert.equal(updates.length, 2);
    assert.deepEqual(updates.map((entry) => entry.targetId).sort(), [memberId, memberId].sort());

    // Daftar admin memuat botSettings hanya untuk target yang bisa dikelola.
    const users = await jsonRequest(base, '/api/admin/users', { cookie: adminLogin.cookie });
    assert.equal(users.status, 200);
    const mainEntry = users.payload.users.find((entry) => entry.id === mainId);
    const memberEntry = users.payload.users.find((entry) => entry.id === memberId);
    assert.equal(mainEntry.botSettings, null);
    assert.equal(memberEntry.botSettings.mode, 'readonly');
    assert.equal(memberEntry.botSettings.online24, false);
    assert.equal(memberEntry.botSettings.storySettings.delayMinSeconds, 1);
  } finally {
    if (child && child.exitCode === null) child.kill('SIGTERM');
    await rm(temp, { recursive: true, force: true });
  }
});

test('admin dapat menghapus sesi WhatsApp member; Admin Utama tidak dapat dihapus siapa pun', { timeout: 30_000 }, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'readsw-botcontrol-route-test-'));
  const root = path.join(temp, 'project');
  const dataDir = path.join(root, 'runtime-data');
  const mainPassword = 'FixtureMain-Only-Password!';
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
    const mainAdmin = fixtureUser('fixturemain', 'fixturemain@example.test', 'admin', mainPassword);
    const admin = fixtureUser('fixtureadmin', 'fixtureadmin@example.test', 'admin', adminPassword);
    const member = fixtureUser('fixturemember', 'fixturemember@example.test', 'member', memberPassword);
    await writeFile(path.join(dataDir, 'store.json'), JSON.stringify({
      users: [mainAdmin, admin, member], pendingRegistrations: [], bots: [], sessions: [], pairingLogs: [], loginHistory: [],
    }));

    const port = await unusedPort();
    const base = `http://127.0.0.1:${port}`;
    const env = {
      ...process.env,
      HOST: '127.0.0.1', PORT: String(port), PANEL_DATA_DIR: 'runtime-data', SESSION_SECRET: secret, NODE_ENV: 'test',
      BOOTSTRAP_ADMIN_USERNAME: 'fixturemain',
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

    const mainLogin = await login(base, 'fixturemain', mainPassword);
    const adminLogin = await login(base, 'fixtureadmin', adminPassword);
    const memberLogin = await login(base, 'fixturemember', memberPassword);
    assert.equal(mainLogin.status, 200);
    assert.equal(adminLogin.status, 200);
    assert.equal(memberLogin.status, 200);
    const mainId = mainLogin.payload.user.id;
    const adminId = adminLogin.payload.user.id;
    const memberId = memberLogin.payload.user.id;

    // Tanpa login: 401.
    const anonymous = await jsonRequest(base, '/api/admin/users/session/delete', {
      method: 'POST', body: { userId: memberId, confirm: true },
    });
    assert.equal(anonymous.status, 401);

    // Member tidak boleh menghapus sesi siapa pun: 403.
    const memberAttempt = await jsonRequest(base, '/api/admin/users/session/delete', {
      method: 'POST', cookie: memberLogin.cookie, body: { userId: memberId, confirm: true },
    });
    assert.equal(memberAttempt.status, 403);

    // Tanpa konfirmasi: 400.
    const unconfirmed = await jsonRequest(base, '/api/admin/users/session/delete', {
      method: 'POST', cookie: adminLogin.cookie, body: { userId: memberId, confirm: false },
    });
    assert.equal(unconfirmed.status, 400);

    // Akun tidak ditemukan: 404.
    const unknown = await jsonRequest(base, '/api/admin/users/session/delete', {
      method: 'POST', cookie: adminLogin.cookie, body: { userId: randomUUID(), confirm: true },
    });
    assert.equal(unknown.status, 404);

    // Admin biasa tidak bisa menghapus sesi Admin Utama: 400.
    const mainTarget = await jsonRequest(base, '/api/admin/users/session/delete', {
      method: 'POST', cookie: adminLogin.cookie, body: { userId: mainId, confirm: true },
    });
    assert.equal(mainTarget.status, 400);
    assert.match(mainTarget.payload.error, /Admin Utama tidak dapat diubah/i);

    // Admin biasa tidak bisa menghapus sesi admin biasa lain: 400.
    const adminTarget = await jsonRequest(base, '/api/admin/users/session/delete', {
      method: 'POST', cookie: adminLogin.cookie, body: { userId: adminId, confirm: true },
    });
    assert.equal(adminTarget.status, 400);

    // Admin Utama pun tidak bisa menghapus sesinya sendiri lewat endpoint ini: 400.
    const selfTarget = await jsonRequest(base, '/api/admin/users/session/delete', {
      method: 'POST', cookie: mainLogin.cookie, body: { userId: mainId, confirm: true },
    });
    assert.equal(selfTarget.status, 400);

    // Aturan yang sama berlaku untuk kontrol bot: admin biasa tidak bisa start bot Admin Utama.
    const mainBot = await jsonRequest(base, '/api/admin/users/bot', {
      method: 'POST', cookie: adminLogin.cookie, body: { userId: mainId, action: 'start', confirmActivity: true },
    });
    assert.equal(mainBot.status, 400);

    // Admin Utama boleh menghapus sesi admin biasa: 200.
    const adminDeleted = await jsonRequest(base, '/api/admin/users/session/delete', {
      method: 'POST', cookie: mainLogin.cookie, body: { userId: adminId, confirm: true },
    });
    assert.equal(adminDeleted.status, 200);
    assert.equal(adminDeleted.payload.ok, true);

    // Admin biasa boleh menghapus sesi member yang belum pernah tertaut: 200.
    const memberDeleted = await jsonRequest(base, '/api/admin/users/session/delete', {
      method: 'POST', cookie: adminLogin.cookie, body: { userId: memberId, confirm: true },
    });
    assert.equal(memberDeleted.status, 200);
    assert.equal(memberDeleted.payload.ok, true);

    // Audit tercatat untuk kedua penghapusan.
    const users = await jsonRequest(base, '/api/admin/users', { cookie: mainLogin.cookie });
    assert.equal(users.status, 200);
    const store = JSON.parse(await readFile(path.join(dataDir, 'store.json'), 'utf8'));
    const deletions = (store.adminAudit || []).filter((entry) => entry.action === 'bot_session_delete');
    assert.equal(deletions.length, 2);
    assert.deepEqual(deletions.map((entry) => entry.targetId).sort(), [adminId, memberId].sort());
  } finally {
    if (child && child.exitCode === null) child.kill('SIGTERM');
    await rm(temp, { recursive: true, force: true });
  }
});
