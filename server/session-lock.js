import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const LOCK_FILENAME = '.readsw-whatsapp-session.lock';
const RESTORE_LOCK_FILENAME = '.readsw-restore.lock';

function restoreLockPath(accountRoot) {
  const absoluteRoot = path.resolve(accountRoot);
  return path.join(path.dirname(absoluteRoot), `.${path.basename(absoluteRoot)}${RESTORE_LOCK_FILENAME}`);
}

export class SessionLockError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SessionLockError';
  }
}

async function processStartMarker(pid) {
  try {
    // Linux /proc stat field 22 distinguishes a live PID from a reused PID.
    const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
    const closeParen = stat.lastIndexOf(')');
    if (closeParen < 0) return null;
    const fieldsFromState = stat.slice(closeParen + 1).trim().split(/\s+/);
    return fieldsFromState[19] || null;
  } catch {
    return null;
  }
}

async function sameProcessIsAlive(owner) {
  const pid = Number(owner?.pid);
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  if (owner.hostname !== os.hostname()) return true;
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true;
    return null;
  }
  const currentStart = await processStartMarker(pid);
  if (owner.processStart && currentStart && owner.processStart !== currentStart) return false;
  return true;
}

async function assertRestoreUnlocked(accountRoot) {
  const lockPath = restoreLockPath(accountRoot);
  try {
    const owner = JSON.parse(await fs.readFile(lockPath, 'utf8'));
    const alive = await sameProcessIsAlive(owner);
    if (alive !== false) throw new SessionLockError('Pemulihan data sedang berlangsung; coba lagi setelah selesai.');
    await fs.rm(lockPath, { force: true });
  } catch (error) {
    if (error instanceof SessionLockError) throw error;
    if (error.code !== 'ENOENT') throw new SessionLockError('Lock pemulihan tidak dapat dibaca; koneksi ditolak demi keamanan.');
  }
}

export async function acquireRestoreLock(accountRoot) {
  const absoluteRoot = path.resolve(accountRoot);
  await fs.mkdir(absoluteRoot, { recursive: true, mode: 0o700 });
  const lockPath = restoreLockPath(absoluteRoot);
  const token = randomUUID();
  const record = {
    pid: process.pid,
    hostname: os.hostname(),
    processStart: await processStartMarker(process.pid),
    token,
    acquiredAt: new Date().toISOString(),
  };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let handle;
    try {
      handle = await fs.open(lockPath, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      return {
        path: lockPath,
        token,
        async release() {
          try {
            const current = JSON.parse(await fs.readFile(lockPath, 'utf8'));
            if (current.token === token && current.pid === process.pid) await fs.rm(lockPath, { force: true });
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
          }
        },
      };
    } catch (error) {
      await handle?.close().catch(() => {});
      if (error.code !== 'EEXIST') {
        await fs.rm(lockPath, { force: true }).catch(() => {});
        throw error;
      }
    }
    let owner;
    try { owner = JSON.parse(await fs.readFile(lockPath, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') continue;
      throw new SessionLockError('Lock pemulihan tidak dapat dibaca; pemulihan ditolak demi keamanan.');
    }
    const alive = await sameProcessIsAlive(owner);
    if (alive !== false) throw new SessionLockError('Pemulihan data sedang berlangsung atau lock-nya belum dapat diverifikasi.');
    const stalePath = `${lockPath}.stale.${token}`;
    try {
      await fs.rename(lockPath, stalePath);
      await fs.rm(stalePath, { force: true });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  throw new SessionLockError('Lock pemulihan sedang berubah; coba lagi sebentar.');
}

export async function acquireSessionLock(sessionDir) {
  const absoluteDir = path.resolve(sessionDir);
  await fs.mkdir(absoluteDir, { recursive: true, mode: 0o700 });
  await fs.chmod(absoluteDir, 0o700).catch(() => {});
  const accountRoot = path.dirname(absoluteDir);
  await assertRestoreUnlocked(accountRoot);
  const lockPath = path.join(absoluteDir, LOCK_FILENAME);
  const token = randomUUID();
  const record = {
    pid: process.pid,
    hostname: os.hostname(),
    processStart: await processStartMarker(process.pid),
    token,
    acquiredAt: new Date().toISOString(),
  };

  for (let attempt = 0; attempt < 4; attempt += 1) {
    let handle;
    try {
      handle = await fs.open(lockPath, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      try {
        await assertRestoreUnlocked(accountRoot);
      } catch (error) {
        await fs.rm(lockPath, { force: true }).catch(() => {});
        throw error;
      }
      return {
        path: lockPath,
        token,
        async release() {
          try {
            const current = JSON.parse(await fs.readFile(lockPath, 'utf8'));
            if (current.token === token && current.pid === process.pid) {
              await fs.rm(lockPath, { force: true });
            }
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
          }
        },
      };
    } catch (error) {
      await handle?.close().catch(() => {});
      if (error.code !== 'EEXIST') {
        await fs.rm(lockPath, { force: true }).catch(() => {});
        throw error;
      }
    }

    let owner;
    try {
      owner = JSON.parse(await fs.readFile(lockPath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw new SessionLockError('Lock sesi tidak dapat dibaca; koneksi ditolak demi keamanan.');
    }
    const alive = await sameProcessIsAlive(owner);
    if (alive === true || alive === null) {
      throw new SessionLockError('Sesi WhatsApp akun ini sedang dimiliki proses lain. Matikan proses pemiliknya sebelum menjalankan salinan panel lain.');
    }

    // Rename the stale lock atomically so only one contender can recover it.
    const stalePath = `${lockPath}.stale.${token}`;
    try {
      await fs.rename(lockPath, stalePath);
      await fs.rm(stalePath, { force: true });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  throw new SessionLockError('Lock sesi WhatsApp sedang berubah; coba lagi sebentar.');
}
