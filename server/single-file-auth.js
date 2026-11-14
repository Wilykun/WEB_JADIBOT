import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';

const KEY_TYPES = [
  'lid-mapping',
  'device-list',
  'identity-key',
  'pre-key',
  'sender-key',
  'session',
  'tctoken',
  'app-state-sync-key',
  'app-state-sync-version',
  'sender-key-memory',
];
const MEMORY_ONLY_TYPES = new Set(['sender-key-memory']);

function filenameSafe(name) {
  return name.replaceAll('/', '__').replaceAll(':', '-');
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'), BufferJSON.reviver);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function useSingleFileAuthState(authDir) {
  await fs.mkdir(authDir, { recursive: true, mode: 0o700 });
  await fs.chmod(authDir, 0o700).catch(() => {});
  const sessionFile = path.join(authDir, 'session.json');
  const keyStore = new Map(KEY_TYPES.map((type) => [type, new Map()]));
  const memoryStore = new Map([['sender-key-memory', new Map()]]);
  let creds;

  const single = await readJson(sessionFile);
  if (single) {
    if (!single.creds || typeof single.creds !== 'object' || !single.keys || typeof single.keys !== 'object') {
      throw new Error('WhatsApp session.json has an invalid auth-state structure.');
    }
    creds = single.creds;
    for (const [type, entries] of Object.entries(single.keys)) {
      if (!keyStore.has(type)) keyStore.set(type, new Map());
      for (const [id, value] of Object.entries(entries || {})) keyStore.get(type).set(id, value);
    }
  } else {
    // One-time migration from the project's previous useMultiFileAuthState folder.
    creds = await readJson(path.join(authDir, 'creds.json')) || initAuthCreds();
    const files = await fs.readdir(authDir);
    for (const type of KEY_TYPES) {
      if (MEMORY_ONLY_TYPES.has(type)) continue;
      const prefix = `${filenameSafe(type)}-`;
      for (const file of files) {
        if (!file.startsWith(prefix) || !file.endsWith('.json')) continue;
        const id = file.slice(prefix.length, -5);
        if (!id) continue;
        const value = await readJson(path.join(authDir, file));
        if (value !== null) keyStore.get(type).set(id, value);
      }
    }
  }

  let writeQueue = Promise.resolve();
  async function persist() {
    const keys = {};
    for (const [type, entries] of keyStore) {
      if (entries.size) keys[type] = Object.fromEntries(entries);
    }
    const payload = JSON.stringify({ creds, keys }, BufferJSON.replacer);
    const tempFile = `${sessionFile}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    const operation = writeQueue.then(async () => {
      try {
        await fs.writeFile(tempFile, payload, { mode: 0o600, flag: 'wx' });
        await fs.rename(tempFile, sessionFile);
        await fs.chmod(sessionFile, 0o600).catch(() => {});
      } catch (error) {
        await fs.rm(tempFile, { force: true }).catch(() => {});
        throw error;
      }
    });
    writeQueue = operation.catch(() => {});
    return operation;
  }

  // Persist the migrated single-file snapshot before removing any legacy files.
  if (!single) {
    await persist();
    const files = await fs.readdir(authDir);
    await Promise.all(files
      .filter((file) => file === 'creds.json' || KEY_TYPES.some((type) => file.startsWith(`${filenameSafe(type)}-`) && file.endsWith('.json')))
      .map((file) => fs.rm(path.join(authDir, file), { force: true })));
  }

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const result = {};
          const source = MEMORY_ONLY_TYPES.has(type) ? memoryStore.get(type) : keyStore.get(type);
          for (const id of ids) {
            let value = source?.get(id) ?? null;
            if (type === 'app-state-sync-key' && value) {
              try { value = proto.Message.AppStateSyncKeyData.fromObject(value); } catch { /* Keep stored data as-is. */ }
            }
            result[id] = value;
          }
          return result;
        },
        set: async (data) => {
          let persistentChange = false;
          for (const [type, entries] of Object.entries(data || {})) {
            if (MEMORY_ONLY_TYPES.has(type)) {
              const target = memoryStore.get(type);
              for (const [id, value] of Object.entries(entries || {})) {
                if (value == null) target.delete(id);
                else target.set(id, value);
              }
              continue;
            }
            if (!keyStore.has(type)) keyStore.set(type, new Map());
            const target = keyStore.get(type);
            for (const [id, value] of Object.entries(entries || {})) {
              if (value == null) target.delete(id);
              else target.set(id, value);
              persistentChange = true;
            }
          }
          if (persistentChange) await persist();
        },
      },
    },
    saveCreds: persist,
    flush: () => writeQueue,
    sessionFile,
  };
}
