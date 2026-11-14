import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { acquireRestoreLock, acquireSessionLock, SessionLockError } from '../server/session-lock.js';

async function withTempDir(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'readsw-session-lock-'));
  try {
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('only one process can own the same WhatsApp session directory', async () => {
  await withTempDir(async (dir) => {
    const first = await acquireSessionLock(dir);
    const moduleUrl = pathToFileURL(path.resolve('server/session-lock.js')).href;
    const childSource = `import { acquireSessionLock } from ${JSON.stringify(moduleUrl)};\ntry { await acquireSessionLock(process.argv[1]); process.exit(0); } catch (error) { process.exit(error.name === 'SessionLockError' ? 17 : 1); }`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', childSource, dir], { encoding: 'utf8' });
    assert.equal(child.status, 17, child.stderr || child.stdout);
    await assert.rejects(acquireSessionLock(dir), SessionLockError);
    await first.release();
    const second = await acquireSessionLock(dir);
    await second.release();
  });
});

test('recovers an abandoned lock whose owner PID no longer exists', async () => {
  await withTempDir(async (dir) => {
    const lockPath = path.join(dir, '.readsw-whatsapp-session.lock');
    await fs.writeFile(lockPath, JSON.stringify({
      pid: 2_147_483_647,
      hostname: os.hostname(),
      processStart: 'old-process-marker',
      token: 'stale-test-token',
    }), { mode: 0o600 });
    const lock = await acquireSessionLock(dir);
    await lock.release();
  });
});

test('fails closed when lock metadata is malformed', async () => {
  await withTempDir(async (dir) => {
    const lockPath = path.join(dir, '.readsw-whatsapp-session.lock');
    await fs.writeFile(lockPath, '{not-json', { mode: 0o600 });
    await assert.rejects(acquireSessionLock(dir), SessionLockError);
  });
});

test('global restore lock blocks new account sessions until the restore finishes', async () => {
  await withTempDir(async (root) => {
    const accountDir = path.join(root, 'member-one');
    const restore = await acquireRestoreLock(root);
    await assert.rejects(acquireSessionLock(accountDir), SessionLockError);
    await restore.release();
    const session = await acquireSessionLock(accountDir);
    await session.release();
  });
});
