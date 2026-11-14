import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

// Beri waktu tambahan untuk sinkronisasi history/reconnect, tanpa memproses
// status yang sudah terlalu lama melewati masa hidup normalnya.
export const STORY_BACKLOG_TTL_MS = 26 * 60 * 60 * 1000;
const writeLocks = new Map();
const SAFE_NUMBER = /^\d{7,15}$/;

function cleanName(value) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 72);
}

function numberFromJid(value) {
  const raw = String(value || '').trim();
  const bare = raw.split('@')[0].split(':')[0];
  return /^\d{7,15}$/.test(bare) ? bare : null;
}

function contactJidFromMessage(message) {
  const candidates = [
    message?.resolvedPn,
    message?.number ? `${message.number}@s.whatsapp.net` : null,
    message?.key?.participantAlt,
    message?.participant,
    message?.key?.participant,
  ];
  for (const candidate of candidates) {
    const number = numberFromJid(candidate);
    if (number) return `${number}@s.whatsapp.net`;
  }
  return null;
}

function contactHash(jid) {
  return createHash('sha256').update(jid || 'unknown-contact').digest('hex');
}

function minimalKey(message) {
  const key = message?.key || {};
  return {
    remoteJid: 'status@broadcast',
    id: String(key.id || ''),
    ...(typeof key.participant === 'string' ? { participant: key.participant } : {}),
    ...(typeof key.participantAlt === 'string' ? { participantAlt: key.participantAlt } : {}),
    fromMe: false,
  };
}

function accountRoot(getAccountDir, userId) {
  const base = getAccountDir(userId);
  if (!base) throw new Error('Account data directory is unavailable.');
  return path.join(path.resolve(base), 'ReadSwReactionsw');
}

async function ensureLayout(root) {
  for (const name of ['ceksw', 'swtrack', 'users']) {
    const dir = path.join(root, name);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.chmod(dir, 0o700).catch(() => {});
  }
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function atomicWriteJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await fs.rename(temp, file);
    await fs.chmod(file, 0o600).catch(() => {});
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

async function mutateJson(file, fallback, updater) {
  const previous = writeLocks.get(file) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  const tail = previous.then(() => current);
  writeLocks.set(file, tail);
  await previous;
  try {
    const value = await readJson(file, fallback);
    const result = await updater(value);
    if (result?.write !== false) await atomicWriteJson(file, value);
    return result?.value;
  } finally {
    release();
    if (writeLocks.get(file) === tail) writeLocks.delete(file);
  }
}

function entryAge(entry, now) {
  const at = Date.parse(entry?.arrivedAt || '');
  return Number.isFinite(at) ? now - at : Infinity;
}

function messageTimestampMs(message, fallback) {
  let raw = message?.messageTimestamp;
  try { if (typeof raw?.toNumber === 'function') raw = raw.toNumber(); } catch { raw = null; }
  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
}

export function createStoryBacklog({ getAccountDir, ttlMs = STORY_BACKLOG_TTL_MS, now = () => Date.now() }) {
  if (typeof getAccountDir !== 'function') throw new TypeError('getAccountDir must be a function.');

  function pathsFor(userId, number) {
    if (!SAFE_NUMBER.test(String(number || ''))) throw new Error('A resolved contact number is required.');
    const root = accountRoot(getAccountDir, userId);
    return {
      root,
      track: path.join(root, 'swtrack', `${number}.json`),
      user: path.join(root, 'users', `${number}.json`),
      stats: path.join(root, 'ceksw', 'swstats.json'),
    };
  }

  async function enqueue(userId, message, settings = {}) {
    const key = minimalKey(message);
    if (!key.id || key.remoteJid !== 'status@broadcast') return null;
    const contentTypes = Object.keys(message?.message || {}).filter((name) => name !== 'messageContextInfo');
    if (!contentTypes.length || contentTypes.some((name) => ['reactionMessage', 'protocolMessage'].includes(name))) return null;
    const contactJid = contactJidFromMessage(message);
    const number = numberFromJid(contactJid);
    if (!contactJid || !number) return null;

    const participants = [...new Set([
      message?.key?.participant,
      message?.key?.participantAlt,
      message?.participant,
      contactJid,
    ].filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))].slice(0, 8);
    const currentTime = now();
    const statusTime = messageTimestampMs(message, currentTime);
    if (statusTime < currentTime - ttlMs || statusTime > currentTime + 5 * 60 * 1000) return null;
    const hash = contactHash(contactJid);
    const { root, track, user } = pathsFor(userId, number);
    await ensureLayout(root);
    const receivedAt = new Date(statusTime).toISOString();
    const name = cleanName(message?.pushName || message?.verifiedBizName);
    const reactionExpected = settings.mode === 'readonly_readsw' && settings.autoReaction === true;
    const entry = {
      id: key.id,
      sender: contactJid,
      number,
      storyJid: contactJid,
      resolvedPn: contactJid,
      name,
      type: contentTypes[0].slice(0, 48),
      contentType: contentTypes[0].slice(0, 48),
      source: 'status',
      messageKey: key,
      key,
      participants,
      contactHash: hash,
      arrivedAt: receivedAt,
      modeAtArrival: settings.mode === 'readonly_readsw' ? 'readonly_readsw' : 'readonly',
      reactionExpected,
      read: false,
      reacted: false,
      attempts: 0,
    };

    const stored = await mutateJson(track, {}, (records) => {
      for (const [id, existing] of Object.entries(records)) {
        if (entryAge(existing, now()) >= ttlMs) delete records[id];
      }
      if (records[key.id]) return { write: false, value: { entry: records[key.id], inserted: false } };
      records[key.id] = entry;
      return { value: { entry, inserted: true } };
    });
    await mutateJson(user, {}, (record) => {
      record.number = number;
      record.jid = contactJid;
      record.contactHash = hash;
      if (name) record.name = record.displayName = name;
      record.updatedAt = new Date(currentTime).toISOString();
      record.firstSeen ||= receivedAt;
      record.lastSeen = receivedAt;
      record.statusCount = Math.min(1_000_000, Number(record.statusCount || 0) + (stored?.inserted ? 1 : 0));
      record.aiMemory ||= { style: null, nickname: null, lang: null, lastUpdated: null, msgCount: 0 };
      return { value: record };
    });
    return stored?.entry ? { ...stored.entry, number, contactJid, contactHash: hash } : null;
  }

  async function listPending(userId, { reactionEnabled = true } = {}) {
    const root = accountRoot(getAccountDir, userId);
    const trackDir = path.join(root, 'swtrack');
    await ensureLayout(root);
    let names = [];
    try { names = await fs.readdir(trackDir); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const pending = [];
    const cutoff = now() - ttlMs;
    for (const name of names.filter((item) => SAFE_NUMBER.test(item.slice(0, -5)) && item.endsWith('.json'))) {
      const number = name.slice(0, -5);
      const file = path.join(trackDir, name);
      await mutateJson(file, {}, (records) => {
        for (const [id, entry] of Object.entries(records)) {
          const arrived = Date.parse(entry?.arrivedAt || '');
          if (!Number.isFinite(arrived) || arrived < cutoff || arrived > now()) {
            delete records[id];
            continue;
          }
          const pendingRead = entry.read !== true;
          const pendingReaction = reactionEnabled && entry.reactionExpected === true && entry.reacted !== true;
          if (pendingRead || pendingReaction) pending.push({ ...entry, number, contactJid: entry.resolvedPn || `${number}@s.whatsapp.net` });
        }
        return { value: null };
      });
    }
    pending.sort((a, b) => Date.parse(a.arrivedAt) - Date.parse(b.arrivedAt));
    return pending;
  }

  async function update(userId, entry, patch) {
    const number = entry?.number || numberFromJid(entry?.resolvedPn || entry?.contactJid);
    if (!number) return null;
    const { track } = pathsFor(userId, number);
    let updated = null;
    await mutateJson(track, {}, (records) => {
      const current = records[entry.id];
      if (!current) return { write: false, value: null };
      updated = records[entry.id] = { ...current, ...patch, number, resolvedPn: current.resolvedPn || `${number}@s.whatsapp.net`, updatedAt: new Date(now()).toISOString() };
      return { value: updated };
    });
    return updated;
  }

  async function recordOutcome(userId, entry, { read = false, reacted = false, emoji = '' } = {}) {
    if (!read) return false;
    const number = entry?.number || numberFromJid(entry?.resolvedPn || entry?.contactJid);
    if (!number) return false;
    const { stats } = pathsFor(userId, number);
    const timestamp = now();
    let counted = false;
    await mutateJson(stats, {}, (records) => {
      const row = records[number] ||= { name: cleanName(entry.name) || 'Tidak tersedia', number, jid: `${number}@s.whatsapp.net`, reads: 0, reactions: 0, lastSeen: null, activeSW: {} };
      row.number = number;
      row.jid = `${number}@s.whatsapp.net`;
      row.activeSW ||= {};
      const previous = row.activeSW[entry.id];
      if (!previous) {
        row.reads = Number(row.reads || 0) + 1;
        counted = true;
      }
      if (reacted && previous?.reacted !== true) {
        row.reactions = Number(row.reactions || 0) + 1;
        records._emojiStats ||= {};
        if (emoji) records._emojiStats[emoji] = Number(records._emojiStats[emoji] || 0) + 1;
        counted = true;
      }
      row.name = cleanName(entry.name) || row.name;
      row.lastSeen = new Date(timestamp).toISOString();
      row.activeSW[entry.id] = { at: timestamp, reacted: Boolean(previous?.reacted || reacted) };
      for (const [id, state] of Object.entries(row.activeSW)) {
        const at = typeof state === 'number' ? state : state?.at;
        if (!Number.isFinite(at) || timestamp - at >= ttlMs) delete row.activeSW[id];
      }
      return { value: counted };
    });
    return counted;
  }

  return { enqueue, listPending, update, recordOutcome };
}
