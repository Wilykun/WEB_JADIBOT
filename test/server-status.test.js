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

test('account stats count active from running bots, and server status exposes full detail without any IP or host field', { timeout: 30_000 }, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'readsw-server-status-test-'));
  const root = path.join(temp, 'project');
  const dataDir = path.join(root, 'runtime-data');
  const secret = randomBytes(48).toString('base64url');
  let child;
  try {
    await mkdir(root, { recursive: true });
    await cp(path.join(sourceRoot, 'server'), path.join(root, 'server'), { recursive: true });
    await cp(path.join(sourceRoot, 'public'), path.join(root, 'public'), { recursive: true });
    await cp(path.join(sourceRoot, 'package.json'), path.join(root, 'package.json'));
    await symlink(path.join(sourceRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir');
    await mkdir(dataDir, { recursive: true });
    const admin = fixtureUser('fixtureadmin', 'fixtureadmin@example.test', 'admin', 'FixtureAdmin-Only-Password!');
    const member = fixtureUser('fixturemember', 'fixturemember@example.test', 'member', 'FixtureMember-Only-Password!');
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

    const statsResponse = await fetch(`${base}/api/public/account-stats`, { signal: AbortSignal.timeout(5000) });
    assert.equal(statsResponse.status, 200);
    const stats = await statsResponse.json();
    assert.equal(stats.total, 2);
    assert.equal(stats.admin, 1);
    assert.equal(stats.member, 1);
    assert.equal(stats.active, 0, 'verified accounts with no running bot must not count as active');
    assert.equal(stats.inactive, 2, 'accounts whose bot is not running must count as inactive');
    assert.equal(stats.botOnline, 0);
    assert.equal(stats.whatsappConnected, 0);
    assert.equal(stats.workersRunning, 0);

    const statusResponse = await fetch(`${base}/api/public/server-status`, { signal: AbortSignal.timeout(5000) });
    assert.equal(statusResponse.status, 200);
    const status = await statusResponse.json();
    assert.equal(status.status, 'online');
    assert.equal(typeof status.uptimeSeconds, 'number');
    assert.equal(typeof status.systemUptimeSeconds, 'number');
    assert.ok(!Number.isNaN(Date.parse(status.serverStartedAt)), 'serverStartedAt must be a valid ISO date');
    assert.ok(status.cpuModel === null || typeof status.cpuModel === 'string');
    assert.equal(typeof status.cpuCount, 'number');
    assert.equal(typeof status.loadAverage1m, 'number');
    assert.equal(typeof status.loadAverage5m, 'number');
    assert.equal(typeof status.loadAverage15m, 'number');
    assert.ok(status.diskTotalBytes === null || typeof status.diskTotalBytes === 'number');
    assert.ok(status.diskFreeBytes === null || typeof status.diskFreeBytes === 'number');
    assert.ok(status.diskUsedPercent === null || typeof status.diskUsedPercent === 'number');
    for (const key of Object.keys(status)) {
      assert.doesNotMatch(key, /ip|host/i, `server status must never expose an IP or host field (found ${key})`);
    }
  } finally {
    if (child && child.exitCode === null) child.kill('SIGTERM');
    await rm(temp, { recursive: true, force: true });
  }
});
