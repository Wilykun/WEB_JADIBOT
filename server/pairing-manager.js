import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import makeWASocket, { Browsers, DEFAULT_CONNECTION_CONFIG, DisconnectReason, fetchLatestBaileysVersion, jidNormalizedUser } from '@whiskeysockets/baileys';
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import pino from 'pino';
import QRCode from 'qrcode';
import { acquireSessionLock, SessionLockError } from './session-lock.js';
import { useSingleFileAuthState } from './single-file-auth.js';
import { createStoryBacklog } from './story-backlog.js';
import { getWhatsAppProxyAgent } from './proxy-agent.js';

const PAIRING_CODE_TTL_MS = 180_000;
const PAIRING_REQUEST_DELAY_MS = 7_000;
const SOCKET_READY_TIMEOUT_MS = 35_000;
const USER_COOLDOWN_MS = 60_000;
const MAX_PAIRING_SOCKET_RESTARTS = 2;
// Batas percobaan sambung ulang otomatis yang gagal berturut-turut (mis. kode 408).
// Setelah batas ini sesi ditandai tidak valid supaya member bisa pairing ulang.
export const MAX_CONSECUTIVE_RECONNECT_FAILURES = 5;
// Pengaturan koneksi eksplisit untuk mencegah loop Connection Closed 428
// yang muncul berkala pada Baileys/WhatsApp Web.
const WA_KEEP_ALIVE_INTERVAL_MS = 25_000;
const WA_CONNECT_TIMEOUT_MS = 60_000;
const WA_DEFAULT_QUERY_TIMEOUT_MS = 60_000;
const WA_RETRY_REQUEST_DELAY_MS = 2_000;
const RECONNECT_STABLE_WINDOW_MS = 10 * 60_000;
const ONLINE_PRESENCE_INTERVAL_MS = 30_000;
let cachedWaWebVersion = null;
let waWebVersionPromise = null;
async function resolveWaWebVersion() {
  if (cachedWaWebVersion) return cachedWaWebVersion;
  if (waWebVersionPromise) return waWebVersionPromise;
  waWebVersionPromise = (async () => {
    const controller = new AbortController();
    const fallbackVersion = [...(DEFAULT_CONNECTION_CONFIG?.version || [2, 3000, 1043857760])];
    let timeoutHandle;
    const versionTimeout = new Promise((resolve) => {
      timeoutHandle = setTimeout(() => resolve({ version: fallbackVersion, timedOut: true }), 8_000);
    });
    const versionFetch = fetchLatestBaileysVersion({ signal: controller.signal })
      .catch((error) => ({ version: fallbackVersion, error }));
    const result = await Promise.race([versionFetch, versionTimeout]);
    clearTimeout(timeoutHandle);
    controller.abort();
    cachedWaWebVersion = Array.isArray(result?.version) && result.version.length === 3
      ? result.version
      : fallbackVersion;
    if (result?.timedOut) console.warn('[Baileys] Version lookup timed out; using the package default version.');
    else if (result?.error) console.warn('[Baileys] Version lookup failed; using the package default version.');
    console.info(`[Baileys] WhatsApp Web protocol version ${cachedWaWebVersion.join('.')}.`);
    return cachedWaWebVersion;
  })().finally(() => { waWebVersionPromise = null; });
  return waWebVersionPromise;
}
const sensitiveBaileysLogPatterns = [
  'Closing stale open session', 'Closing session', 'Opening session', 'Removing old closed session',
  'Session already closed', 'SessionEntry', 'prekey bundle', 'Closing open session',
  '_chains', 'registrationId', 'currentRatchet', 'pendingPreKey', 'baseKey:',
  'ephemeralKeyPair', 'lastRemoteEphemeralKey', 'indexInfo', 'baseKeyType',
  'Failed to decrypt message', 'Decrypted message with closed session', 'Session error',
  'Bad MAC', 'libsignal/src/crypto.js', 'libsignal/src/session_cipher.js', 'verifyMAC',
  'doDecryptWhisperMessage', 'decryptWithSessions', 'Message absent from node',
  'chainKey', 'chainType', 'messageKeys', 'previousCounter', 'rootKey', 'remoteIdentityKey',
  'signedKeyId', 'preKeyId', '<Buffer', 'Buffer ',
];
const isSensitiveBaileysOutput = (value) => typeof value === 'string'
  && sensitiveBaileysLogPatterns.some((pattern) => value.includes(pattern));
for (const methodName of ['log', 'info', 'warn', 'error']) {
  const originalMethod = console[methodName].bind(console);
  console[methodName] = (...args) => {
    if (args.some((value) => isSensitiveBaileysOutput(value))) return;
    originalMethod(...args);
  };
}
for (const stream of [process.stdout, process.stderr]) {
  const originalWrite = stream.write.bind(stream);
  stream.write = (chunk, encoding, callback) => {
    if (typeof chunk === 'string' && isSensitiveBaileysOutput(chunk)) return true;
    return originalWrite(chunk, encoding, callback);
  };
}
const baileysLogger = pino({
  level: process.env.BOT_LOGGER_LEVEL || 'silent',
  hooks: {
    logMethod(args, method) {
      let serialized;
      try {
        serialized = JSON.stringify(args);
      } catch {
        serialized = String(args);
      }
      if (sensitiveBaileysLogPatterns.some((pattern) => serialized.includes(pattern))) return;
      return method.apply(this, args);
    },
  },
});

export class PairingError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'PairingError';
    this.status = status;
  }
}

export function isValidWhatsAppNumber(value) {
  const digits = String(value || '');
  if (!/^[1-9]\d{6,14}$/.test(digits)) return false;
  try {
    const phone = parsePhoneNumberFromString(`+${digits}`);
    return phone?.isValid() === true;
  } catch {
    return false;
  }
}

export function normalizePairingInput(method, value) {
  const pairingMethod = method === 'qr' ? 'qr' : 'pairing';
  const digits = String(value || '').trim();
  if (pairingMethod === 'pairing' && !isValidWhatsAppNumber(digits)) {
    throw new PairingError('Nomor tidak valid menurut format penomoran internasional. Periksa kode negara dan digitnya.');
  }
  return { method: pairingMethod, phoneNumber: pairingMethod === 'pairing' ? digits : null };
}

export function maskedNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '••••••';
  if (digits.length <= 4) return '•'.repeat(digits.length);
  // Sembunyikan empat digit tengah dengan akhiran selalu empat digit bila nomornya cukup panjang, supaya tampilannya konsisten seperti 62896****8411.
  const prefixLength = digits.length >= 9
    ? Math.min(6, Math.max(1, digits.length - 8))
    : Math.min(6, Math.max(1, digits.length - 5));
  const suffixLength = digits.length - 4 - prefixLength;
  const prefix = digits.slice(0, prefixLength);
  const suffix = suffixLength ? digits.slice(-suffixLength) : '';
  return `${prefix}****${suffix}`;
}

export function maskedEmail(value) {
  const email = String(value || '').trim();
  const atIndex = email.indexOf('@');
  if (atIndex <= 0 || atIndex === email.length - 1) return email;
  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);
  if (!domain) return email;
  // Tampilkan empat karakter awal bagian lokal lalu sensor sisanya dengan empat bintang dan biarkan domain tetap utuh, supaya tampilannya konsisten seperti bang****@gmail.com.
  const visible = local.length > 4 ? local.slice(0, 4) : local.slice(0, 1);
  return `${visible}****@${domain}`;
}

function storyClock(now = new Date()) {
  const zone = 'Asia/Jakarta';
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', hourCycle: 'h23' }).format(now));
  const greeting = hour < 5 ? 'Malam 🌃' : hour < 11 ? 'Pagi ☀️' : hour < 15 ? 'Siang 🌤️' : hour < 18 ? 'Sore 🌇' : 'Malam 🌃';
  return {
    greeting,
    dayName: new Intl.DateTimeFormat('id-ID', { weekday: 'long', timeZone: zone }).format(now),
    date: new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: zone }).format(now),
    time: new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: zone }).format(now).replace(':', '.'),
    dateKey: (() => {
      const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: zone }).formatToParts(now);
      const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
      return `${values.year}-${values.month}-${values.day}`;
    })(),
  };
}

function storyMediaLabel(message) {
  let content = message?.message || {};
  for (let depth = 0; depth < 4; depth += 1) {
    const wrapper = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage']
      .find((key) => content?.[key]?.message);
    if (!wrapper) break;
    content = content[wrapper].message;
  }
  const type = Object.keys(content || {}).find((key) => key !== 'messageContextInfo') || 'unknown';
  const labels = {
    imageMessage: ['Foto', '📷'], videoMessage: ['Video', '🎥'], audioMessage: ['Audio', '🎵'],
    stickerMessage: ['Stiker', '🎨'], documentMessage: ['Dokumen', '📄'],
    extendedTextMessage: ['Teks', '📝'], conversation: ['Teks', '📝'],
    contactMessage: ['Kontak', '👤'], contactsArrayMessage: ['Kontak', '👤'],
    locationMessage: ['Lokasi', '📍'], liveLocationMessage: ['Lokasi live', '📍'],
    pollCreationMessage: ['Polling', '📊'], pollCreationMessageV3: ['Polling', '📊'],
    buttonsMessage: ['Pesan interaktif', '🔘'], listMessage: ['Pesan interaktif', '📋'],
    unknown: ['Story', '📖'],
  };
  return labels[type] || ['Story', '📖'];
}

function minimalHistoricalStory(message) {
  const key = message?.key;
  if (key?.remoteJid !== 'status@broadcast' || key.fromMe || !key.id || !message?.message) return null;
  const contentType = Object.keys(message.message).find((name) => !['messageContextInfo', 'reactionMessage', 'protocolMessage'].includes(name));
  if (!contentType) return null;
  return {
    key: {
      remoteJid: 'status@broadcast',
      id: String(key.id),
      ...(typeof key.participant === 'string' ? { participant: key.participant } : {}),
      ...(typeof key.participantAlt === 'string' ? { participantAlt: key.participantAlt } : {}),
      fromMe: false,
    },
    ...(typeof message.participant === 'string' ? { participant: message.participant } : {}),
    ...(message.pushName ? { pushName: message.pushName } : {}),
    ...(message.verifiedBizName ? { verifiedBizName: message.verifiedBizName } : {}),
    ...(message.messageTimestamp != null ? { messageTimestamp: message.messageTimestamp } : {}),
    message: { [contentType]: {} },
  };
}

function captureEarlyHistoryStories(state, socket) {
  const capture = (messages = []) => {
    if (state.workerStatus === 'running' && state.workerSocket === socket) return;
    state.pendingHistoryStories ||= [];
    state.pendingHistoryStoryIds ||= new Set();
    for (const original of messages) {
      const message = minimalHistoricalStory(original);
      if (!message || state.pendingHistoryStoryIds.has(message.key.id)) continue;
      state.pendingHistoryStoryIds.add(message.key.id);
      state.pendingHistoryStories.push(message);
      if (state.pendingHistoryStories.length > 2000) {
        const dropped = state.pendingHistoryStories.shift();
        state.pendingHistoryStoryIds.delete(dropped.key.id);
      }
    }
  };
  // WhatsApp tidak selalu mengirim ulang messages.upsert setelah worker start.
  // Karena itu event live yang tiba saat worker sengaja berhenti harus ditahan
  // seperti history sampai Start/Restart memasang worker kembali.
  socket.ev.on('messaging-history.set', ({ messages = [] } = {}) => capture(messages));
  socket.ev.on('messages.upsert', ({ type, messages = [] } = {}) => {
    if (type === 'notify' || type === 'append') capture(messages);
  });
}

export function classifyDisconnectCode(code) {
  if ([DisconnectReason.loggedOut, DisconnectReason.badSession, DisconnectReason.forbidden, DisconnectReason.multideviceMismatch].includes(code)) return 'invalid_session';
  if (code === DisconnectReason.connectionReplaced) return 'connection_replaced';
  return 'retry';
}

export const GOOD_SNAPSHOT_FILENAME = 'session.json.good';
const RECOVERY_WAIT_MS = 45_000;
const RECOVERY_POLL_MS = 500;
const RUNTIME_CHECKPOINT_MS = 60_000;

function snapshotMeId(value) {
  return typeof value?.creds?.me?.id === 'string' ? value.creds.me.id : null;
}

function countAuthKeys(value) {
  if (!value || typeof value !== 'object') return 0;
  let total = 0;
  for (const item of Object.values(value)) {
    total += typeof item === 'object' && item !== null ? countAuthKeys(item) : 1;
  }
  return total;
}

function isUsableAuthSnapshot(value) {
  // File sesi tanpa kunci sama sekali (mis. raptorzz: 1.223 byte, 0 kunci)
  // lolos cek lama karena creds.registered=true, lalu pemulihan membuang
  // waktu mencoba cadangan yang pasti ditolak WhatsApp 401. Tolak sejak awal
  // supaya panel langsung bilang pemilik akun harus pairing ulang.
  return Boolean(value && typeof value.creds === 'object' && value.creds
    && value.creds.registered === true && typeof value.keys === 'object' && value.keys
    && countAuthKeys(value.keys) > 0);
}

async function readSnapshotFile(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    return null;
  }
}

async function writeFileAtomically(file, payload) {
  const tempFile = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tempFile, payload, { mode: 0o600, flag: 'wx' });
    await fs.rename(tempFile, file);
    await fs.chmod(file, 0o600).catch(() => {});
  } catch (error) {
    await fs.rm(tempFile, { force: true }).catch(() => {});
    throw error;
  }
}

// Menyimpan salinan sesi terakhir yang terbukti bisa tersambung, supaya penolakan sesi oleh WhatsApp bisa dipulihkan tanpa pairing ulang.
export async function saveGoodSnapshot(authDir) {
  if (!authDir) return false;
  try {
    const sessionFile = path.join(authDir, 'session.json');
    const current = await readSnapshotFile(sessionFile);
    if (!isUsableAuthSnapshot(current)) return false;
    await writeFileAtomically(
      path.join(authDir, GOOD_SNAPSHOT_FILENAME),
      JSON.stringify(current),
    );
    return true;
  } catch {
    return false;
  }
}

export const BACKUP_FILENAME = 'session.json.bak';
export const BACKUP_MIN_INTERVAL_MS = 15 * 60 * 1000;
const sessionBackupLastWrite = new Map();

// Menyalin session.json ke cadangan otomatis secara berkala, supaya file sesi yang hilang atau rusak bisa dipulihkan tanpa pairing ulang.
export async function saveSessionBackup(authDir, { force = false } = {}) {
  if (!authDir) return false;
  try {
    const lastWrite = sessionBackupLastWrite.get(authDir) || 0;
    if (!force && Date.now() - lastWrite < BACKUP_MIN_INTERVAL_MS) return false;
    const current = await readSnapshotFile(path.join(authDir, 'session.json'));
    if (!isUsableAuthSnapshot(current) || !snapshotMeId(current)) return false;
    await writeFileAtomically(
      path.join(authDir, BACKUP_FILENAME),
      JSON.stringify(current),
    );
    sessionBackupLastWrite.set(authDir, Date.now());
    return true;
  } catch {
    return false;
  }
}

export const RUNTIME_FILENAME = 'runtime.json';

function normalizeBotRuntime(value) {
  if (!value || typeof value !== 'object') return null;
  const totalMs = Number(value.totalMs);
  const startedAt = value.startedAt === null || value.startedAt === undefined ? null : Number(value.startedAt);
  if (!Number.isFinite(totalMs) || totalMs < 0) return null;
  if (startedAt !== null && (!Number.isFinite(startedAt) || startedAt <= 0)) return null;
  return { totalMs: Math.floor(totalMs), startedAt };
}

// Membaca akumulasi runtime bot per akun; mengembalikan null bila belum ada atau filenya rusak.
export async function loadBotRuntime(authDir) {
  if (!authDir) return null;
  const parsed = await readSnapshotFile(path.join(authDir, RUNTIME_FILENAME));
  return normalizeBotRuntime(parsed);
}

// Menyimpan akumulasi runtime bot per akun secara atomik; tidak pernah melempar.
export async function saveBotRuntime(authDir, runtime) {
  if (!authDir) return false;
  const normalized = normalizeBotRuntime(runtime);
  if (!normalized) return false;
  try {
    await writeFileAtomically(path.join(authDir, RUNTIME_FILENAME), JSON.stringify(normalized));
    return true;
  } catch {
    return false;
  }
}

// Menghapus catatan runtime bot per akun; dipakai saat perangkat ditautkan ulang atau sesi dihapus.
export async function deleteBotRuntime(authDir) {
  if (!authDir) return false;
  try {
    await fs.rm(path.join(authDir, RUNTIME_FILENAME), { force: true });
    return true;
  } catch {
    return false;
  }
}

// Mengembalikan satu salinan sesi ke session.json, menolak bila nomor perangkatnya berbeda dari sesi yang sedang dipakai.
async function restoreSnapshotFile(authDir, filename) {
  if (!authDir) return false;
  try {
    const snapshot = await readSnapshotFile(path.join(authDir, filename));
    if (!isUsableAuthSnapshot(snapshot)) return false;
    const live = await readSnapshotFile(path.join(authDir, 'session.json'));
    if (live && snapshotMeId(live) && snapshotMeId(snapshot) && snapshotMeId(live) !== snapshotMeId(snapshot)) return false;
    await writeFileAtomically(path.join(authDir, 'session.json'), JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

// Mengembalikan salinan sesi sehat ke session.json, menolak bila nomor perangkatnya berbeda dari sesi yang sedang dipakai.
export async function restoreGoodSnapshot(authDir) {
  return restoreSnapshotFile(authDir, GOOD_SNAPSHOT_FILENAME);
}

// Mengembalikan cadangan sesi otomatis ke session.json, menolak bila nomor perangkatnya berbeda dari sesi yang sedang dipakai.
export async function restoreSessionBackup(authDir) {
  return restoreSnapshotFile(authDir, BACKUP_FILENAME);
}

export const UNLINK_FILENAME = 'unlink.json';

// Alasan sesi terputus untuk notifikasi "WhatsApp belum tertaut": kode 401
// berarti WhatsApp mengeluarkan sesi ini (biasanya logout dari HP), kode
// sesi tidak valid berarti ditolak WhatsApp, tanpa kode berarti koneksi
// terputus berulang kali sampai batas percobaan.
function unlinkReasonForCode(code) {
  if (code === DisconnectReason.loggedOut) return 'manual';
  if ([DisconnectReason.badSession, DisconnectReason.forbidden, DisconnectReason.multideviceMismatch].includes(code)) return 'rejected';
  return 'unreachable';
}

export async function saveLastUnlink(authDir, lastUnlink) {
  if (!authDir || !lastUnlink) return false;
  try {
    await writeFileAtomically(path.join(authDir, UNLINK_FILENAME), JSON.stringify(lastUnlink));
    return true;
  } catch {
    return false;
  }
}

export async function loadLastUnlink(authDir) {
  if (!authDir) return null;
  const parsed = await readSnapshotFile(path.join(authDir, UNLINK_FILENAME));
  if (!parsed || !['manual', 'rejected', 'unreachable'].includes(parsed.reason)) return null;
  const at = new Date(parsed.at);
  if (Number.isNaN(at.getTime())) return null;
  return { reason: parsed.reason, code: typeof parsed.code === 'number' ? parsed.code : null, at: at.toISOString() };
}

export function createPairingManager({ dataDir, appendLog, getAuthDir = () => null, getStorySettings = () => null, getOnline24 = () => false, getWorkerAutoStart = () => false, setWorkerAutoStart = async () => {}, ensureDefaultBot = async () => false }) {
  const sessions = new Map();
  const cooldowns = new Map();
  const runtimeCheckpointTimer = setInterval(checkpointRuntimes, RUNTIME_CHECKPOINT_MS);
  runtimeCheckpointTimer.unref?.();
  const authRoot = path.join(dataDir, 'whatsapp-auth');
  function accountAuthDir(userId) {
    const preferredDir = getAuthDir(userId);
    return path.resolve(preferredDir || path.join(authRoot, userId));
  }
  async function acquireAccountLock(userId) {
    try {
      return await acquireSessionLock(accountAuthDir(userId));
    } catch (error) {
      if (error instanceof SessionLockError) {
        throw new PairingError(error.message, 409);
      }
      throw error;
    }
  }
  async function releaseStateLock(state) {
    if (!state?.sessionLock) return;
    const lock = state.sessionLock;
    state.sessionLock = null;
    try { await lock.release(); } catch {
      try { await log(state.userId, 'Lock sesi lokal belum dapat dilepas; lock stale akan diperiksa saat server berikutnya mulai.'); } catch { /* Keep cleanup independent of log storage. */ }
    }
  }
  const storyBacklog = createStoryBacklog({
    getAccountDir: (userId) => getAuthDir(userId) || path.join(authRoot, userId),
  });

  const authKeyPrefixes = ['lid-mapping-', 'device-list-', 'identity-key-', 'pre-key-', 'sender-key-', 'session-', 'tctoken-', 'app-state-sync-key-', 'app-state-sync-version-', 'sender-key-memory-'];

  function isAuthSnapshot(value) {
    return Boolean(value && typeof value.creds === 'object' && value.creds
      && typeof value.keys === 'object' && value.keys);
  }

  async function readAuthSnapshot(file) {
    try {
      const value = JSON.parse(await fs.readFile(file, 'utf8'));
      return isAuthSnapshot(value) ? value : null;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async function removeAuthArtifacts(authDir) {
    if (!authDir) return;
    let names;
    try { names = await fs.readdir(authDir); } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    const artifacts = names.filter((name) => name === 'session.json' || name === 'creds.json'
      || (name.endsWith('.json') && authKeyPrefixes.some((prefix) => name.startsWith(prefix))));
    await Promise.all(artifacts.map((name) => fs.rm(path.join(authDir, name), { force: true })));
  }

  async function removeUserAuth(userId, authDir) {
    const dirs = new Set([authDir, path.join(authRoot, userId)].filter(Boolean).map((dir) => path.resolve(dir)));
    for (const dir of dirs) await removeAuthArtifacts(dir);
  }

  async function resolveAuthDir(userId) {
    const authDir = accountAuthDir(userId);
    await fs.mkdir(authDir, { recursive: true, mode: 0o700 });
    await fs.chmod(authDir, 0o700).catch(() => {});
    const targetFile = path.join(authDir, 'session.json');

    try {
      const current = JSON.parse(await fs.readFile(targetFile, 'utf8'));
      if (isAuthSnapshot(current)) return authDir;
      const isPanelSession = typeof current?.username === 'string'
        && Array.isArray(current?.sesiAktif) && Object.hasOwn(current, 'loginTerakhir');
      if (!isPanelSession) throw new Error('Existing session.json is neither panel metadata nor Baileys auth.');
      const panelFile = path.join(authDir, 'panel-sessions.json');
      try {
        await fs.access(panelFile);
        await fs.rm(targetFile, { force: true });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        await fs.rename(targetFile, panelFile);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    const migratedMarker = path.join(authDir, '.whatsapp-auth-migrated');
    try { await fs.access(migratedMarker); return authDir; } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    const legacyDir = path.join(authRoot, userId);
    if (path.resolve(legacyDir) === path.resolve(authDir)) return authDir;
    const legacyFile = path.join(legacyDir, 'session.json');
    let legacyAuth = await readAuthSnapshot(legacyFile);
    if (!legacyAuth) {
      try { await fs.access(path.join(legacyDir, 'creds.json')); } catch (error) {
        if (error.code === 'ENOENT') return authDir;
        throw error;
      }
      const migrated = await useSingleFileAuthState(legacyDir);
      await migrated.flush();
      legacyAuth = await readAuthSnapshot(legacyFile);
    }
    if (!legacyAuth) return authDir;

    const tempFile = `${targetFile}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await fs.writeFile(tempFile, await fs.readFile(legacyFile), { mode: 0o600, flag: 'wx' });
      await fs.rename(tempFile, targetFile);
      await fs.chmod(targetFile, 0o600).catch(() => {});
      await fs.writeFile(migratedMarker, `${new Date().toISOString()}\n`, { mode: 0o600, flag: 'wx' }).catch((error) => {
        if (error.code !== 'EEXIST') throw error;
      });
      await fs.rm(legacyDir, { recursive: true, force: true });
    } catch (error) {
      await fs.rm(tempFile, { force: true }).catch(() => {});
      throw error;
    }
    return authDir;
  }

  async function log(userId, event, details = null) {
    try { await appendLog(userId, event, details); } catch { /* Never let logging break socket lifecycle. */ }
  }

  function publicState(state) {
    if (!state) return null;
    const expired = state.status === 'awaiting_code' && state.expiresAt <= Date.now();
    const qrExpired = state.status === 'awaiting_qr' && state.expiresAt <= Date.now();
    return {
      status: expired || qrExpired ? 'expired' : state.status,
      method: state.method || 'pairing',
      code: expired ? null : state.code,
      qrDataUrl: qrExpired ? null : state.qrDataUrl,
      maskedPhone: state.maskedPhone,
      phoneNumber: ['checking_number', 'awaiting_code', 'linking'].includes(state.status) ? state.displayPhone || null : null,
      expiresAt: expired ? null : state.expiresAt,
      reconnectAttempts: state.reconnectAttempts || 0,
      reconnectFailures: state.consecutiveReconnectFailures || 0,
      lastUnlink: state.lastUnlink || null,
      workerStatus: state.workerStatus || 'stopped',
      workerStartedAt: state.workerStatus === 'running' ? state.workerStartedAt || null : null,
    };
  }

  async function removeUnregisteredAuth(state) {
    if (state?.authState?.state?.creds?.registered) return;
    try { await removeUserAuth(state.userId, state.authDir); } catch { /* best effort */ }
  }

  function endSocket(state) {
    clearTimeout(state.readyTimer);
    clearTimeout(state.expiryTimer);
    clearTimeout(state.reconnectTimer);
    clearReconnectStableTimer(state);
    clearTimeout(state.onlinePresenceTimer);
    state.readyTimer = null;
    state.expiryTimer = null;
    state.reconnectTimer = null;
    state.onlinePresenceTimer = null;
    try { state.socket?.end(new Error('Pairing session closed.')); } catch { /* best effort */ }
  }

  function stopOnlinePresence(state) {
    clearTimeout(state.onlinePresenceTimer);
    state.onlinePresenceTimer = null;
  }

  function safeSendPresence(socket, presence) {
    try {
      const result = socket?.sendPresenceUpdate?.(presence);
      result?.catch?.(() => {});
    } catch { /* Socket may close between the state check and the send. */ }
  }

  function enableOnlinePrivacy(socket) {
    try {
      const result = socket?.updateOnlinePrivacy?.('all');
      result?.catch?.(() => {});
    } catch { /* Best effort; reconnect lifecycle will retry. */ }
  }

  function scheduleOnlinePresence(state) {
    stopOnlinePresence(state);
    if (!state.onlineDesired || state.status !== 'linked' || !state.socket) return;
    const socket = state.socket;
    const send = async () => {
      if (sessions.get(state.userId) !== state || state.socket !== socket || state.status !== 'linked' || !state.onlineDesired) return;
      safeSendPresence(socket, 'available');
      state.onlinePresenceTimer = setTimeout(send, ONLINE_PRESENCE_INTERVAL_MS);
      state.onlinePresenceTimer.unref?.();
    };
    void send();
  }

  function disconnectStatusCode(lastDisconnect) {
    const error = lastDisconnect?.error;
    const code = error?.output?.statusCode ?? error?.data?.statusCode ?? error?.statusCode;
    return Number.isFinite(Number(code)) ? Number(code) : null;
  }

  function clearReconnectStableTimer(state) {
    clearTimeout(state.reconnectStableTimer);
    state.reconnectStableTimer = null;
  }

  function scheduleReconnectStableReset(state, socket) {
    clearReconnectStableTimer(state);
    state.reconnectStableTimer = setTimeout(() => {
      state.reconnectStableTimer = null;
      if (state.socket === socket && state.status === 'linked') { state.reconnectAttempts = 0; state.consecutiveReconnectFailures = 0; }
    }, RECONNECT_STABLE_WINDOW_MS);
    state.reconnectStableTimer.unref?.();
  }

  function isInvalidSessionCode(code) {
    return classifyDisconnectCode(code) === 'invalid_session';
  }

  function registerReconnectFailure(state) {
    // Sesi yang kredensialnya sudah dicabut WhatsApp (mis. logout dari HP)
    // ditutup WhatsApp berulang kali dengan kode 408 (retry), bukan 401.
    // Tanpa batas, auto-reconnect berputar selamanya dan panel terus
    // menampilkan sesi itu sebagai "tertaut". Setelah batas tercapai,
    // hentikan dan tandai sesi tidak valid supaya member bisa minta
    // pairing code baru secara realtime.
    state.consecutiveReconnectFailures = (state.consecutiveReconnectFailures || 0) + 1;
    return state.consecutiveReconnectFailures >= MAX_CONSECUTIVE_RECONNECT_FAILURES;
  }

  async function pauseAfterConnectionReplaced(state, reasonCode) {
    clearTimeout(state.readyTimer);
    clearTimeout(state.reconnectTimer);
    clearReconnectStableTimer(state);
    clearTimeout(state.workerWatchdogTimer);
    state.readyTimer = null;
    state.reconnectTimer = null;
    state.workerWatchdogTimer = null;
    state.status = 'disconnected';
    state.reconnectAttempts = 0;
    stopOnlinePresence(state);
    detachBotWorker(state, state.workerDesired ? 'waiting' : 'stopped');
    state.socket = null;
    await log(state.userId, `WhatsApp melaporkan koneksi digantikan (kode ${reasonCode}). Auto-reconnect dijeda untuk mencegah loop; pastikan hanya satu proses memakai sesi ini, lalu sambungkan ulang manual.`);
  }

  async function markSessionInvalid(state, code) {
    clearTimeout(state.readyTimer);
    clearTimeout(state.expiryTimer);
    clearTimeout(state.reconnectTimer);
    clearReconnectStableTimer(state);
    clearTimeout(state.workerWatchdogTimer);
    state.readyTimer = null;
    state.expiryTimer = null;
    state.reconnectTimer = null;
    state.workerWatchdogTimer = null;
    state.status = 'invalid';
    state.code = null;
    state.expiresAt = null;
    state.phoneNumber = null;
    // Catat kapan dan kenapa sesi terputus untuk notifikasi "WhatsApp belum
    // tertaut": alasan + waktunya tampil realtime di notifikasi, dan
    // tersimpan di unlink.json supaya tidak hilang saat panel restart.
    state.lastUnlink = { reason: unlinkReasonForCode(code), code: code ?? null, at: new Date().toISOString() };
    void saveLastUnlink(state.authDir, state.lastUnlink);
    state.consecutiveReconnectFailures = 0;
    state.workerDesired = false;
    state.autoStartBeforeInvalid = getWorkerAutoStart(state.userId) === true;
    await setWorkerAutoStart(state.userId, false);
    detachBotWorker(state);
    resetRuntime(state);
    const socket = state.socket;
    state.socket = null;
    try { socket?.end(new Error('WhatsApp session credentials were rejected.')); } catch { /* best effort */ }
    await log(state.userId, `WhatsApp menolak sesi tersimpan${code ? ` (kode ${code})` : ''}; tautkan ulang diperlukan.`);
    await releaseStateLock(state);
  }

  function snapshotGoodSession(state) {
    if (!state?.authDir) return;
    void saveGoodSnapshot(state.authDir);
    void saveSessionBackup(state.authDir);
  }

  async function loadRuntimeIntoState(state) {
    if (!state || state.runtimeLoaded) return;
    state.runtimeLoaded = true;
    const saved = await loadBotRuntime(state.authDir);
    state.runtimeTotalMs = saved?.totalMs || 0;
    state.runtimeStartedAt = null;
  }

  function saveRuntime(state) {
    if (!state?.authDir) return;
    void saveBotRuntime(state.authDir, {
      totalMs: state.runtimeTotalMs || 0,
      startedAt: state.runtimeStartedAt || null,
    });
  }

  function resetRuntime(state) {
    if (!state) return;
    state.runtimeTotalMs = 0;
    state.runtimeStartedAt = null;
    if (state.authDir) void deleteBotRuntime(state.authDir);
  }

  function checkpointRuntimes() {
    const now = Date.now();
    for (const state of sessions.values()) {
      if (state.workerStatus !== 'running' || !state.runtimeStartedAt) continue;
      state.runtimeTotalMs = (state.runtimeTotalMs || 0) + (now - state.runtimeStartedAt);
      state.runtimeStartedAt = now;
      saveRuntime(state);
    }
  }

  async function tryResumeAndWait(state) {
    try {
      await resume(state.userId, { auto: true });
    } catch {
      return false;
    }
    const deadline = Date.now() + RECOVERY_WAIT_MS;
    while (Date.now() < deadline) {
      const current = sessions.get(state.userId);
      if (!current || current !== state) return false;
      if (current.status === 'linked') return true;
      if (['invalid', 'disconnected', 'failed', 'stopped'].includes(current.status)) return false;
      await new Promise((resolve) => setTimeout(resolve, RECOVERY_POLL_MS));
    }
    return sessions.get(state.userId)?.status === 'linked';
  }

  // Memulihkan sesi yang ditolak WhatsApp tanpa meminta nomor baru: coba dulu kredensial yang tersimpan, lalu salinan sesi terakhir yang sehat.
  async function attemptSessionRecovery(state, code) {
    if (!state || state.recoveryInProgress) return false;
    state.recoveryInProgress = true;
    const wasAutoStart = state.autoStartBeforeInvalid ?? (getWorkerAutoStart(state.userId) === true);
    // Simpan kredensial yang sedang dipakai: kalau semua cadangan gagal,
    // file sesi dikembalikan seperti semula, supaya pemulihan yang gagal
    // tidak menghancurkan kredensial yang masih hidup dengan salinan lama.
    const liveSnapshot = state.authDir ? await readSnapshotFile(path.join(state.authDir, 'session.json')) : null;
    const liveSnapshotUsable = isUsableAuthSnapshot(liveSnapshot);
    try {
      await log(state.userId, 'Sesi WhatsApp ditolak; mencoba pulihkan otomatis dari sesi tersimpan.');
      clearTimeout(state.readyTimer);
      clearTimeout(state.expiryTimer);
      clearTimeout(state.reconnectTimer);
      clearReconnectStableTimer(state);
      state.readyTimer = null;
      state.expiryTimer = null;
      state.reconnectTimer = null;
      const deadSocket = state.socket;
      state.socket = null;
      try { deadSocket?.end(new Error('Session recovery: replacing rejected socket.')); } catch { /* best effort */ }
      detachBotWorker(state, state.workerDesired ? 'waiting' : 'stopped');
      state.status = 'recovering';
      if (await tryResumeAndWait(state)) {
        if (wasAutoStart) await setWorkerAutoStart(state.userId, true);
        state.autoStartBeforeInvalid = undefined;
        await log(state.userId, 'Sesi WhatsApp pulih otomatis tanpa pairing ulang.');
        return true;
      }
      // Coba cadangan satu per satu: salinan sehat dulu, lalu cadangan
      // otomatis. Dulu hanya salinan sehat yang dicoba — kalau kredensial
      // di salinan itu ikut ditolak WhatsApp, cadangan otomatis yang
      // lebih segar tidak pernah disentuh.
      const candidates = [
        { restore: restoreGoodSnapshot, restoredLog: 'Cadangan sesi terakhir yang sehat dipulihkan; mencoba sambung ulang.', successLog: 'Sesi WhatsApp pulih otomatis dari cadangan terakhir yang sehat.' },
        { restore: restoreSessionBackup, restoredLog: 'Cadangan sesi otomatis dipulihkan; mencoba sambung ulang.', successLog: 'Sesi WhatsApp pulih otomatis dari cadangan sesi otomatis.' },
      ];
      let triedAny = false;
      for (const candidate of candidates) {
        const restored = await candidate.restore(state.authDir);
        if (!restored) continue;
        triedAny = true;
        await log(state.userId, candidate.restoredLog);
        state.authState = null;
        state.status = 'recovering';
        clearTimeout(state.reconnectTimer);
        state.reconnectTimer = null;
        if (wasAutoStart) await setWorkerAutoStart(state.userId, true);
        if (await tryResumeAndWait(state)) {
          state.autoStartBeforeInvalid = undefined;
          await log(state.userId, candidate.successLog);
          return true;
        }
      }
      if (!triedAny) {
        await log(state.userId, 'Tidak ada cadangan sesi untuk dipulihkan; pairing ulang diperlukan.');
      }
      // Semua cadangan gagal: kembalikan file sesi seperti semula supaya
      // percobaan berikutnya tidak memakai salinan lama yang sudah ditolak.
      if (liveSnapshotUsable) {
        await writeFileAtomically(path.join(state.authDir, 'session.json'), JSON.stringify(liveSnapshot)).catch(() => {});
        state.authState = null;
        await log(state.userId, 'Semua cadangan sesi gagal; file sesi dikembalikan seperti semula.');
      }
      return false;
    } finally {
      state.recoveryInProgress = false;
    }
  }

  function scheduleAutoReconnect(state) {
    if (sessions.get(state.userId) !== state || !state.authState?.state?.creds?.registered || state.status === 'invalid') return;
    if ((state.consecutiveReconnectFailures || 0) >= MAX_CONSECUTIVE_RECONNECT_FAILURES) {
      // Batas tercapai bukan berarti kredensial mati: kegagalan beruntun
      // bisa karena jaringan/proxy atau restart panel. Coba pulihkan dari
      // cadangan dulu sebelum menyatakan sesi invalid.
      void attemptSessionRecovery(state, null).then(async (recovered) => {
        if (!recovered && sessions.get(state.userId) === state && state.status !== 'invalid') await markSessionInvalid(state, null);
      }).catch(() => {});
      return;
    }
    clearTimeout(state.reconnectTimer);
    const attempt = (state.reconnectAttempts || 0) + 1;
    state.reconnectAttempts = attempt;
    const delay = Math.min(2_000 * (2 ** Math.min(attempt - 1, 5)), 60_000);
    state.status = 'reconnecting';
    void log(state.userId, `Sesi WhatsApp masih tersimpan; sambung ulang otomatis percobaan ${attempt} dalam ${Math.ceil(delay / 1000)} detik.`);
    state.reconnectTimer = setTimeout(async () => {
      state.reconnectTimer = null;
      if (sessions.get(state.userId) !== state || state.status !== 'reconnecting') return;
      try {
        await resume(state.userId, { auto: true });
      } catch {
        if (sessions.get(state.userId) !== state || state.status === 'invalid') return;
        if (!state.authState?.state?.creds?.registered) {
          await markSessionInvalid(state, null);
          return;
        }
        state.status = 'disconnected';
        await log(state.userId, 'Percobaan sambung ulang gagal; akan dijadwalkan kembali.');
        scheduleAutoReconnect(state);
      }
    }, delay);
  }

  function detachBotWorker(state, nextStatus = 'stopped') {
    if (state.workerSocket && state.workerHandler) {
      try { state.workerSocket.ev.off('messages.upsert', state.workerHandler); } catch { /* best effort */ }
    }
    if (state.workerSocket && state.workerHistoryHandler) {
      try { state.workerSocket.ev.off('messaging-history.set', state.workerHistoryHandler); } catch { /* best effort */ }
    }
    state.workerSocket = null;
    state.workerHandler = null;
    state.workerHistoryHandler = null;
    state.workerStatus = nextStatus;
    if (state.runtimeStartedAt) {
      state.runtimeTotalMs = (state.runtimeTotalMs || 0) + (Date.now() - state.runtimeStartedAt);
      state.runtimeStartedAt = null;
      saveRuntime(state);
    }
    state.workerStartedAt = null;
    state.workerGeneration = (state.workerGeneration || 0) + 1;
  }

  function scheduleWorkerWatchdog(state) {
    clearTimeout(state.workerWatchdogTimer);
    if (!state.workerDesired || state.status === 'invalid') {
      state.workerWatchdogTimer = null;
      return;
    }
    const retryDelay = Math.min(5_000 * (2 ** Math.min(state.workerWatchdogAttempts || 0, 3)), 40_000);
    state.workerWatchdogTimer = setTimeout(() => {
      state.workerWatchdogTimer = null;
      if (!state.workerDesired || sessions.get(state.userId) !== state) return;
      const workerAttached = state.workerStatus === 'running'
        && state.workerSocket === state.socket
        && typeof state.workerHandler === 'function';
      if (state.status === 'linked' && state.socket && !workerAttached) {
        try {
          if (state.workerStatus === 'running') detachBotWorker(state, 'waiting');
          attachBotWorker(state);
          state.workerWatchdogAttempts = 0;
          void log(state.userId, 'Watchdog memulihkan listener worker pada koneksi WhatsApp aktif.');
        } catch {
          state.workerStatus = 'waiting';
          state.workerWatchdogAttempts = (state.workerWatchdogAttempts || 0) + 1;
          if (state.workerWatchdogAttempts === 1 || state.workerWatchdogAttempts % 4 === 0) {
            void log(state.userId, 'Watchdog belum dapat mengaktifkan worker; percobaan ulang otomatis dijadwalkan.');
          }
        }
      }
      scheduleWorkerWatchdog(state);
    }, retryDelay);
    state.workerWatchdogTimer.unref?.();
  }

  function isSupportedStoryMode(mode) {
    return mode === 'readonly' || mode === 'readonly_readsw';
  }

  function normalizeJid(value) {
    const raw = String(value || '').trim();
    if (!raw || raw.endsWith('@lid')) return null;
    const bare = raw.split('@')[0].split(':')[0];
    if (!/^\d+$/.test(bare)) return null;
    return `${bare}@s.whatsapp.net`;
  }

  function storySettingsFor(userId) {
    const profile = getStorySettings(userId);
    if (!profile || !isSupportedStoryMode(profile.mode)) return null;
    const settings = profile.storySettings || {};
    const min = Number(settings.delayMinSeconds ?? 1);
    const max = Number(settings.delayMaxSeconds ?? 20);
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max > 20 || min > max) return null;
    return {
      mode: profile.mode,
      autoReaction: profile.mode === 'readonly_readsw' && settings.autoReaction === true,
      delayMinSeconds: min,
      delayMaxSeconds: max,
      emojiPool: Array.isArray(settings.emojiPool) ? settings.emojiPool.filter((emoji) => typeof emoji === 'string').slice(0, 12) : [],
    };
  }

  function storyMessageFromBacklog(entry) {
    return {
      key: entry.key,
      participant: entry.participants?.[0],
      resolvedPn: entry.resolvedPn || entry.contactJid || (entry.number ? `${entry.number}@s.whatsapp.net` : null),
      pushName: entry.name,
      message: { [entry.contentType || 'unknown']: {} },
    };
  }

  async function processStory(state, socket, message, generation, backlogEntry = null) {
    const isCurrent = () => state.workerStatus === 'running'
      && state.workerSocket === socket
      && state.workerGeneration === generation;
    try {
      const initial = storySettingsFor(state.userId);
      if (!initial || !isCurrent()) return;
      if (backlogEntry) {
        await storyBacklog.update(state.userId, backlogEntry, {
          attempts: Number(backlogEntry.attempts || 0) + 1,
          lastAttemptAt: new Date().toISOString(),
          lastError: null,
        });
      }
      const minDelayUnits = initial.delayMinSeconds * 10;
      const maxDelayUnits = initial.delayMaxSeconds * 10;
      const delaySeconds = (Math.floor(Math.random() * (maxDelayUnits - minDelayUnits + 1)) + minDelayUnits) / 10;
      await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
      if (!isCurrent()) return;
      const currentBeforeRead = storySettingsFor(state.userId);
      if (!currentBeforeRead) return;

      const candidates = [message.key?.participant, message.participant, message.key?.participantAlt]
        .filter((value) => typeof value === 'string' && value.length > 0);
      const selfJid = normalizeJid(socket.user?.id);
      let contactJid = candidates.map(normalizeJid).find((jid) => jid && jid !== selfJid) || null;
      let resolveLabel = contactJid ? 'PN langsung ✓' : candidates.some((value) => value.endsWith('@lid')) ? 'LID belum resolve ⚠️' : 'PN tidak tersedia ⚠️';
      if (!contactJid) {
        const lid = candidates.find((value) => value.endsWith('@lid'));
        if (lid) {
          try {
            const mapped = normalizeJid(await socket.signalRepository?.lidMapping?.getPNForLID?.(lid));
            if (mapped && mapped !== selfJid) {
              contactJid = mapped;
              resolveLabel = 'LID → PN ✓';
            }
          } catch { /* Keep the author unresolved instead of guessing an identity. */ }
        }
      }
      if (contactJid && contactJid === selfJid) return;
      const receiptKeys = [];
      const seenParticipants = new Set();
      for (const participant of candidates) {
        let normalized;
        try { normalized = jidNormalizedUser(participant); } catch { normalized = participant; }
        if (!normalized || seenParticipants.has(normalized)) continue;
        seenParticipants.add(normalized);
        receiptKeys.push({ ...message.key, remoteJid: 'status@broadcast', participant: normalized, fromMe: false });
      }

      let readOk = backlogEntry?.read === true;
      if (!readOk) {
        const readResults = await Promise.all(receiptKeys.map(async (key) => {
          let marked = false;
          try {
            if (typeof socket.readMessages === 'function') {
              await socket.readMessages([key]);
              marked = true;
            }
          } catch { /* Fall back to the lower-level receipt API. */ }
          try {
            if (typeof socket.sendReceipts === 'function') {
              await socket.sendReceipts([key], 'read-self');
              marked = true;
            }
          } catch {
            try {
              if (typeof socket.sendReceipts === 'function') {
                await socket.sendReceipts([key], 'read');
                marked = true;
              }
            } catch { /* The socket may close during reconnect. */ }
          }
          return marked;
        }));
        readOk = readResults.some(Boolean);
      }
      if (!isCurrent()) return;

      let reaction = '';
      let attemptedReaction = '';
      let reactionError = false;
      const latest = storySettingsFor(state.userId);
      const reactionEnabled = latest?.mode === 'readonly_readsw'
        && latest.autoReaction
        && latest.emojiPool.length > 0
        && (!backlogEntry || backlogEntry.reactionExpected === true);
      if (readOk && reactionEnabled) {
        if (contactJid && selfJid && isCurrent()) {
          attemptedReaction = latest.emojiPool[Math.floor(Math.random() * latest.emojiPool.length)];
          try {
            await socket.sendMessage('status@broadcast', { react: { key: message.key, text: attemptedReaction } }, {
              statusJidList: [...new Set([selfJid, contactJid])],
            });
            reaction = attemptedReaction;
          } catch {
            reactionError = true;
          }
        }
      }

      const current = latest || currentBeforeRead;
      const modeLabel = reactionEnabled ? 'Read+Reaction ✓' : 'Read Only';
      const [mediaName, mediaEmoji] = storyMediaLabel(message);
      const clock = storyClock();
      const name = String(message.pushName || message.verifiedBizName || 'Tidak tersedia').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 72) || 'Tidak tersedia';
      const number = contactJid ? contactJid.split('@')[0] : '';
      state.storyCounts ||= new Map();
      const countKey = contactJid || candidates[0] || '';
      let storyCount = 1;
      if (countKey) {
        const previous = state.storyCounts.get(countKey);
        storyCount = previous?.dateKey === clock.dateKey ? previous.count + 1 : 1;
        state.storyCounts.set(countKey, { dateKey: clock.dateKey, count: storyCount });
        if (state.storyCounts.size > 2000) state.storyCounts.delete(state.storyCounts.keys().next().value);
      }
      const details = {
        kind: 'story',
        mode: modeLabel,
        mediaType: `${mediaName} ${mediaEmoji}`,
        storyId: String(message.key?.id || ''),
        ...clock,
        name,
        number,
        storyCount,
        emojiMode: reactionEnabled ? 'Custom 🟢' : '—',
        success: readOk ? (reaction ? 'Read + Reaction ✓' : reactionError ? 'Read ✓ / Reaction ❌' : 'Dilihat ✓') : 'Read gagal ❌',
        reaction: reaction || (reactionError ? `${attemptedReaction} gagal ❌` : reactionEnabled ? 'Dilewati ⚠️' : 'Off ❌'),
        resolve: resolveLabel,
        delaySeconds,
      };
      if (backlogEntry) {
        if (readOk) {
          await storyBacklog.update(state.userId, backlogEntry, {
            read: true,
            readAt: new Date().toISOString(),
            reactionExpected: reactionEnabled && !reaction,
            reacted: Boolean(reaction),
            ...(reaction ? { emoji: reaction, reactedAt: new Date().toISOString(), lastError: null }
              : reactionError ? { lastError: 'reaction_failed' }
                : reactionEnabled ? { lastError: 'reaction_unresolved' } : { lastError: null }),
          });
          await storyBacklog.recordOutcome(state.userId, backlogEntry, { read: true, reacted: Boolean(reaction), emoji: reaction });
        } else {
          await storyBacklog.update(state.userId, backlogEntry, { lastError: 'read_failed' });
        }
      }
      const event = `Story ${mediaName.toLowerCase()} · ${details.success}${reaction ? ` · ${reaction}` : ''} · delay ${delaySeconds.toFixed(1)} dtk`;
      await log(state.userId, event, details);
    } catch {
      if (backlogEntry) {
        await storyBacklog.update(state.userId, backlogEntry, { lastError: 'processing_failed' }).catch(() => {});
      }
      if (isCurrent()) await log(state.userId, 'Story/status diterima, tetapi pemrosesan gagal; detail story dan kredensial tidak dicatat.');
    }
  }

  function attachBotWorker(state) {
    if (state.status !== 'linked' || !state.socket) {
      throw new PairingError('WhatsApp belum online; sambungkan sesi sebelum memulai bot.', 409);
    }
    const profile = getStorySettings(state.userId);
    if (profile?.mode === 'online24') {
      throw new PairingError('Mode Online 24 Jam belum mendukung worker story. Pilih mode Read Only atau Read Only + ReadSW terlebih dahulu.', 409);
    }
    if (!profile || !isSupportedStoryMode(profile.mode)) {
      throw new PairingError('Pilih mode Read Only atau Read Only + ReadSW sebelum memulai bot.', 409);
    }
    detachBotWorker(state);
    const socket = state.socket;
    const generation = state.workerGeneration;
    state.processedStoryIds ||= new Set();
    const resolveStoryMessage = async (message) => {
      const candidates = [message.key?.participantAlt, message.participant, message.key?.participant]
        .filter((value) => typeof value === 'string' && value.length > 0);
      const selfJid = normalizeJid(socket.user?.id);
      let resolvedPn = candidates.map(normalizeJid).find((jid) => jid && jid !== selfJid) || null;
      if (!resolvedPn) {
        const lid = candidates.find((value) => value.endsWith('@lid'));
        if (lid) {
          try {
            const mapped = normalizeJid(await socket.signalRepository?.lidMapping?.getPNForLID?.(lid));
            if (mapped && mapped !== selfJid) resolvedPn = mapped;
          } catch { /* Do not guess a phone number when WhatsApp cannot resolve the LID. */ }
        }
      }
      return resolvedPn ? { ...message, resolvedPn } : null;
    };
    const rememberStoryId = (id) => {
      state.processedStoryIds.add(id);
      if (state.processedStoryIds.size > 1000) state.processedStoryIds.delete(state.processedStoryIds.values().next().value);
    };
    const runStoryMessage = async (message) => {
      if (!isCurrentWorker(state, socket, generation)) return;
      const settings = storySettingsFor(state.userId);
      const resolvedMessage = await resolveStoryMessage(message);
      if (!resolvedMessage) {
        state.processedStoryIds.delete(message.key.id);
        return;
      }
      const entry = await storyBacklog.enqueue(state.userId, resolvedMessage, settings || {});
      if (!entry) {
        state.processedStoryIds.delete(message.key.id);
        return;
      }
      const reactionEnabled = settings?.mode === 'readonly_readsw' && settings.autoReaction && settings.emojiPool.length > 0;
      if (entry.read === true && !(reactionEnabled && entry.reactionExpected === true && entry.reacted !== true)) return;
      await processStory(state, socket, resolvedMessage, generation, entry);
    };
    const queueStoryMessage = (message) => {
      if (message?.key?.remoteJid !== 'status@broadcast' || message.key?.fromMe || !message.key?.id || !message.message) return;
      const contentTypes = Object.keys(message.message);
      if (!contentTypes.length || contentTypes.includes('reactionMessage') || contentTypes.includes('protocolMessage')) return;
      if (state.processedStoryIds.has(message.key.id)) return;
      // Tandai sebelum async dimulai agar duplicate event tidak membuat task ganda.
      // processStory menghitung delay masing-masing Story secara independen.
      rememberStoryId(message.key.id);
      void runStoryMessage(message).catch(() => {});
    };
    const handler = ({ type, messages = [] }) => {
      if (type !== 'notify' && type !== 'append') return;
      for (const message of messages) queueStoryMessage(message);
    };
    const historyHandler = ({ messages = [] } = {}) => {
      for (const message of messages) queueStoryMessage(message);
    };
    state.workerDesired = true;
    state.workerSocket = socket;
    state.workerHandler = handler;
    state.workerHistoryHandler = historyHandler;
    state.workerStatus = 'running';
    state.runtimeStartedAt = Date.now();
    state.workerStartedAt = state.runtimeStartedAt - (state.runtimeTotalMs || 0);
    state.processedStoryIds = new Set();
    socket.ev.on('messages.upsert', handler);
    socket.ev.on('messaging-history.set', historyHandler);
    const isCurrentWorker = (currentState, currentSocket, currentGeneration) => currentState.workerStatus === 'running'
      && currentState.workerSocket === currentSocket
      && currentState.workerGeneration === currentGeneration;
    const earlyHistory = state.pendingHistoryStories?.splice(0) || [];
    state.pendingHistoryStoryIds?.clear();
    for (const message of earlyHistory) queueStoryMessage(message);
    void (async () => {
      if (!isCurrentWorker(state, socket, generation)) return;
      const settings = storySettingsFor(state.userId);
      const pending = await storyBacklog.listPending(state.userId, {
        reactionEnabled: settings?.mode === 'readonly_readsw' && settings.autoReaction && settings.emojiPool.length > 0,
      });
      const tasks = [];
      for (const entry of pending) {
        if (!isCurrentWorker(state, socket, generation)) break;
        if (state.processedStoryIds.has(entry.id)) continue;
        rememberStoryId(entry.id);
        // Satu delay panjang tidak boleh menahan Story lain yang delay-nya lebih pendek.
        tasks.push(processStory(state, socket, storyMessageFromBacklog(entry), generation, entry).catch(() => {}));
      }
      if (pending.length && isCurrentWorker(state, socket, generation)) {
        void Promise.allSettled(tasks).then(() => log(state.userId, `Pemulihan ${pending.length} story tertunda dari penyimpanan akun selesai diproses paralel.`));
      }
    })().catch(() => {});
  }

  async function expire(state) {
    if (!['awaiting_code', 'awaiting_qr'].includes(state.status)) return;
    state.status = 'expired';
    state.code = null;
    state.qrDataUrl = null;
    state.expiresAt = null;
    state.phoneNumber = null;
    endSocket(state);
    await removeUnregisteredAuth(state);
    await log(state.userId, 'Kode pairing kedaluwarsa; sesi sementara ditutup.');
    await releaseStateLock(state);
  }

  async function fail(state, message, status = 502) {
    detachBotWorker(state, 'stopped');
    state.workerDesired = false;
    state.status = 'failed';
    state.code = null;
    state.expiresAt = null;
    state.phoneNumber = null;
    endSocket(state);
    await removeUnregisteredAuth(state);
    const safeMessage = String(message || 'Permintaan pairing gagal.')
      .replace(/\+?\d{7,15}/g, '[nomor disamarkan]')
      .replace(/\s+/g, ' ')
      .slice(0, 220);
    await log(state.userId, `Permintaan pairing gagal (HTTP ${status}): ${safeMessage}; kode/kredensial tidak dicatat.`);
    // Nomor yang ditolak tidak menghasilkan pairing code yang bisa dipakai.
    // Bersihkan state in-memory dan izinkan retry dengan nomor valid lain.
    if ([401, 404, 422].includes(status)) cooldowns.delete(state.userId);
    if (sessions.get(state.userId) === state) sessions.delete(state.userId);
    await releaseStateLock(state);
    if (!state.startSettled) {
      state.startSettled = true;
      state.rejectStart(new PairingError(message, status));
    }
  }

  async function start(userId, phoneNumber, method = 'pairing') {
    const normalizedPairing = normalizePairingInput(method, phoneNumber);
    const pairingMethod = normalizedPairing.method;
    phoneNumber = normalizedPairing.phoneNumber;
    let existing = sessions.get(userId);
    let sessionLock = existing?.sessionLock || null;
    let acquiredLockHere = false;
    let invalidLockDetached = false;
    if (existing?.status === 'invalid') {
      if (!sessionLock) {
        sessionLock = await acquireAccountLock(userId);
        acquiredLockHere = true;
      }
      clearTimeout(existing.reconnectTimer);
      const oldSocket = existing.socket;
      existing.socket = null;
      try { oldSocket?.end(new Error('Invalid session replaced by account owner.')); } catch { /* best effort */ }
      try {
        const invalidAuthDir = existing.authDir || await resolveAuthDir(userId);
        await removeUserAuth(userId, invalidAuthDir);
        // Cadangan sesi yang ditolak ikut dibersihkan: kalau tidak,
        // pemulihan otomatis bisa membangkitkan lagi sesi yang sama
        // dari session.json.good/.bak saat pemilik akun pairing ulang.
        await fs.rm(path.join(invalidAuthDir, GOOD_SNAPSHOT_FILENAME), { force: true }).catch(() => {});
        await fs.rm(path.join(invalidAuthDir, BACKUP_FILENAME), { force: true }).catch(() => {});
        await fs.rm(path.join(invalidAuthDir, UNLINK_FILENAME), { force: true }).catch(() => {});
      } catch (error) {
        if (acquiredLockHere) {
          try { await sessionLock.release(); } catch { /* Stale-lock recovery handles cleanup. */ }
        }
        throw error;
      }
      sessions.delete(userId);
      invalidLockDetached = true;
      try { await log(userId, 'Kredensial sesi yang ditolak dibersihkan saat pemilik akun memulai pairing baru.'); }
      catch (error) {
        if (acquiredLockHere || invalidLockDetached) {
          try { await sessionLock.release(); } catch { /* Stale-lock recovery handles cleanup. */ }
        }
        throw error;
      }
      existing = null;
    }
    if (existing && ['connecting', 'awaiting_code', 'awaiting_qr', 'linked', 'reconnecting', 'recovering', 'disconnected', 'stopped'].includes(existing.status)) {
      throw new PairingError('Sesi pairing akun ini masih aktif.', 409);
    }
    const now = Date.now();
    const cooldownUntil = cooldowns.get(userId) || 0;
    if (cooldownUntil > now) {
      if (acquiredLockHere || invalidLockDetached) {
        try { await sessionLock.release(); } catch { /* Stale-lock recovery handles cleanup. */ }
      }
      const seconds = Math.ceil((cooldownUntil - now) / 1000);
      throw new PairingError(`Tunggu ${seconds} detik sebelum meminta pairing code lagi.`, 429);
    }
    if (!sessionLock) {
      sessionLock = await acquireAccountLock(userId);
      acquiredLockHere = true;
    }
    let authDir;
    try {
      authDir = await resolveAuthDir(userId);
    } catch (error) {
      if (acquiredLockHere || invalidLockDetached) {
        try { await sessionLock.release(); } catch { /* The stale-lock recovery handles cleanup. */ }
      }
      throw error;
    }
    cooldowns.set(userId, now + USER_COOLDOWN_MS);
    await fs.rm(path.join(authDir, RUNTIME_FILENAME), { force: true }).catch(() => {});
    const state = {
      userId,
      authDir,
      sessionLock,
      socket: null,
      authState: null,
      waVersion: null,
      status: 'connecting',
      method: pairingMethod,
      code: null,
      qrDataUrl: null,
      expiresAt: null,
      maskedPhone: maskedNumber(phoneNumber),
      displayPhone: phoneNumber,
      phoneNumber,
      codeRequested: false,
      workerStatus: 'stopped',
      workerDesired: false,
      onlineDesired: getOnline24(userId) === true,
      workerSocket: null,
      workerHandler: null,
      startSettled: false,
      readyTimer: null,
      expiryTimer: null,
      reconnectTimer: null,
      reconnectAttempts: 0,
      pairingSocketRestarts: 0,
      workerWatchdogTimer: null,
      onlinePresenceTimer: null,
      resolveStart: null,
      rejectStart: null,
      runtimeTotalMs: 0,
      runtimeStartedAt: null,
      runtimeLoaded: true,
    };
    sessions.set(userId, state);
    try {
      await log(userId, 'Permintaan pairing dimulai untuk akun ini.');
    } catch (error) {
      sessions.delete(userId);
      await releaseStateLock(state);
      throw new PairingError('Layanan pairing belum dapat dimulai. Coba lagi nanti.', 503);
    }

    let resolveStart;
    let rejectStart;
    const codePromise = new Promise((resolve, reject) => {
      resolveStart = resolve;
      rejectStart = reject;
    });
    state.resolveStart = resolveStart;
    state.rejectStart = rejectStart;

    try {
      await fs.mkdir(authDir, { recursive: true, mode: 0o700 });
      await fs.chmod(authDir, 0o700).catch(() => {});
      state.authState = await useSingleFileAuthState(authDir);
      if (state.authState.state.creds.registered) {
        state.status = 'linked';
        state.phoneNumber = null;
        snapshotGoodSession(state);
        throw new PairingError('Akun ini sudah memiliki sesi WhatsApp tertaut; tekan Sambungkan ulang, tidak perlu pairing code baru.', 409);
      }
      state.waVersion = await resolveWaWebVersion();
      const attachSocket = () => {
          const socket = makeWASocket({
            auth: state.authState.state,
            logger: baileysLogger,
            // WhatsApp WebSocket harus lewat egress proxy VM, kalau tidak
            // koneksi langsung diblokir dan mati instan kode 408.
            agent: getWhatsAppProxyAgent(),
            ...(state.waVersion ? { version: state.waVersion } : {}),
            browser: Browsers.macOS('Chrome'),
            keepAliveIntervalMs: WA_KEEP_ALIVE_INTERVAL_MS,
            defaultQueryTimeoutMs: WA_DEFAULT_QUERY_TIMEOUT_MS,
            connectTimeoutMs: WA_CONNECT_TIMEOUT_MS,
            retryRequestDelayMs: WA_RETRY_REQUEST_DELAY_MS,
            maxMsgRetryCount: 5,
            syncFullHistory: true,
            markOnlineOnConnect: state.onlineDesired,
        });
        state.socket = socket;
        captureEarlyHistoryStories(state, socket);
        socket.ev.on('creds.update', () => {
          void state.authState.saveCreds().then(() => {
            void saveSessionBackup(state.authDir);
          }).catch(() => {
            void log(userId, 'Peringatan: perubahan kredensial WhatsApp gagal tersimpan ke disk.');
          });
        });
        socket.ev.on('connection.update', async ({ qr, connection, isNewLogin, lastDisconnect }) => {
          try {
            if (socket !== state.socket) return;

            if (isNewLogin) {
              state.status = 'linking';
              state.code = null;
              state.expiresAt = null;
              clearTimeout(state.readyTimer);
              clearTimeout(state.expiryTimer);
              state.readyTimer = null;
              state.expiryTimer = null;
              state.socket = null;
              await state.authState.saveCreds();
              await new Promise((resolve) => setTimeout(resolve, 500));
              if (state.status !== 'linking' || sessions.get(userId) !== state) return;
              try { socket.end(new Error('Restarting after successful pairing.')); } catch { /* best effort */ }
              attachSocket();
              state.readyTimer = setTimeout(() => {
                void fail(state, 'WhatsApp belum menyelesaikan tautan. Periksa koneksi lalu coba lagi nanti.', 504);
              }, SOCKET_READY_TIMEOUT_MS);
              await log(userId, 'Kode diterima; koneksi WhatsApp dimulai ulang untuk menyelesaikan tautan.');
              return;
            }

            if (qr && !state.codeRequested && !state.authState.state.creds.registered) {
              if (state.method === 'qr') {
                state.codeRequested = true;
                state.status = 'awaiting_qr';
                state.qrDataUrl = await QRCode.toDataURL(qr, {
                  errorCorrectionLevel: 'M',
                  margin: 2,
                  width: 280,
                });
                state.expiresAt = Date.now() + PAIRING_CODE_TTL_MS;
                state.expiryTimer = setTimeout(() => { void expire(state); }, PAIRING_CODE_TTL_MS);
                await log(userId, 'QR pairing dibuat dan menunggu pemindaian di aplikasi WhatsApp.');
                if (!state.startSettled) {
                  state.startSettled = true;
                  resolveStart(publicState(state));
                }
                return;
              }
              state.codeRequested = true;
              // WhatsApp/Baileys needs a short handshake window after the QR event.
              // Requesting immediately is known to produce 401/428 on pairing flows.
              await new Promise((resolve) => setTimeout(resolve, PAIRING_REQUEST_DELAY_MS));
              if (socket !== state.socket || state.status !== 'connecting' || state.startSettled) return;
              const phone = state.phoneNumber;
              state.status = 'checking_number';
              let code;
              try {
                code = await socket.requestPairingCode(phone);
              } catch (error) {
                const requestCode = disconnectStatusCode({ error });
                if ([401, 404].includes(requestCode)) {
                  await fail(state, 'Nomor ini belum terdaftar di WhatsApp atau ditolak oleh WhatsApp. Periksa kembali kode negara dan digit nomor, lalu coba lagi.', 422);
                  return;
                }
                throw error;
              }
              if (state.status !== 'checking_number' || state.startSettled) return;
              state.phoneNumber = null;
              state.status = 'awaiting_code';
              state.code = String(code);
              state.expiresAt = Date.now() + PAIRING_CODE_TTL_MS;
              clearTimeout(state.readyTimer);
              state.readyTimer = null;
              state.expiryTimer = setTimeout(() => { void expire(state); }, PAIRING_CODE_TTL_MS);
              await log(userId, 'Pairing code dibuat dan menunggu konfirmasi di aplikasi WhatsApp.');
              if (!state.startSettled) {
                state.startSettled = true;
                resolveStart(publicState(state));
              }
            }

            if (connection === 'open') {
              clearTimeout(state.readyTimer);
              clearTimeout(state.expiryTimer);
              clearTimeout(state.reconnectTimer);
              state.readyTimer = null;
              state.expiryTimer = null;
              state.reconnectTimer = null;
              scheduleReconnectStableReset(state, socket);
              state.status = 'linked';
              state.consecutiveReconnectFailures = 0;
              state.reconnectAttempts = 0;
              snapshotGoodSession(state);
              const linkedDigits = String(state.authState?.state?.creds?.me?.id || socket?.user?.id || '').split('@')[0].split(':')[0].replace(/\D/g, '');
              if (linkedDigits) state.maskedPhone = maskedNumber(linkedDigits);
              state.code = null;
              state.expiresAt = null;
              state.phoneNumber = null;
              if (state.onlineDesired) enableOnlinePrivacy(state.socket);
              scheduleOnlinePresence(state);
              try { await ensureDefaultBot(userId); } catch {
                await log(userId, 'Profil bot default belum tersimpan; bot otomatis belum dapat dimulai.');
              }
              // Tautan baru (pairing code/QR): bot langsung jalan (npm start
              // otomatis) tanpa perlu menekan Start bot. autoStart sempat
              // dimatikan sistem saat sesi ditandai invalid; tautan baru
              // mengembalikannya supaya bot tidak diam setelah tertaut.
              if (getWorkerAutoStart(userId) !== true) {
                await setWorkerAutoStart(userId, true);
              }
              state.workerDesired = getWorkerAutoStart(userId) === true;
              if (state.workerDesired) {
                try {
                  attachBotWorker(state);
                  scheduleWorkerWatchdog(state);
                } catch {
                  state.workerStatus = 'waiting';
                  await log(userId, 'WhatsApp tertaut; bot menunggu konfigurasi mode yang valid.');
                }
              }
              await log(userId, state.workerStatus === 'running'
                ? 'WhatsApp aktif; mode Read Only + ReadSW mulai otomatis memantau event story/status.'
                : 'Perangkat WhatsApp tertaut; bot masih dihentikan.');
              if (!state.startSettled) {
                state.startSettled = true;
                rejectStart(new PairingError('Perangkat sudah tertaut; pairing code baru tidak diperlukan.', 409));
              }
            } else if (connection === 'close' && ['connecting', 'checking_number', 'awaiting_code'].includes(state.status)) {
              const reasonCode = disconnectStatusCode(lastDisconnect);
              if (reasonCode === DisconnectReason.restartRequired
                && state.status === 'connecting'
                && !state.codeRequested
                && state.pairingSocketRestarts < MAX_PAIRING_SOCKET_RESTARTS) {
                state.pairingSocketRestarts += 1;
                state.socket = null;
                try { socket.end(new Error('WhatsApp requested a pairing socket restart.')); } catch { /* best effort */ }
                await state.authState.saveCreds().catch(() => {});
                await log(userId, `WhatsApp meminta koneksi pairing dimulai ulang (kode ${reasonCode}; percobaan ${state.pairingSocketRestarts}).`);
                if (sessions.get(userId) === state && state.status === 'connecting') attachSocket();
                return;
              }
              if ([401, 404].includes(reasonCode)) {
                await fail(state, 'Nomor ini belum terdaftar di WhatsApp atau ditolak oleh WhatsApp. Periksa kembali kode negara dan digit nomor, lalu coba lagi.', 422);
                return;
              }
              await fail(state, `Koneksi pairing terputus${reasonCode ? ` (kode ${reasonCode})` : ''}. Pastikan jaringan tersedia dan coba lagi nanti.`, 502);
            } else if (connection === 'close' && state.status === 'linked') {
              const reasonCode = disconnectStatusCode(lastDisconnect);
              clearReconnectStableTimer(state);
              if (isInvalidSessionCode(reasonCode)) {
                if (state.recoveryInProgress) {
                  await markSessionInvalid(state, reasonCode);
                  return;
                }
                const recovered = await attemptSessionRecovery(state, reasonCode);
                if (!recovered) await markSessionInvalid(state, reasonCode);
                return;
              }
              if (classifyDisconnectCode(reasonCode) === 'connection_replaced') {
                await pauseAfterConnectionReplaced(state, reasonCode);
                return;
              }
              clearTimeout(state.readyTimer);
              state.readyTimer = null;
              if (registerReconnectFailure(state)) {
                // Batas tercapai bukan berarti kredensial mati: coba pulihkan
                // dari cadangan dulu sebelum menyatakan sesi invalid.
                const recovered = await attemptSessionRecovery(state, reasonCode);
                if (!recovered) {
                  await markSessionInvalid(state, reasonCode);
                  await log(userId, `Sesi WhatsApp tidak dapat dipulihkan setelah ${MAX_CONSECUTIVE_RECONNECT_FAILURES} kali percobaan sambung ulang gagal (kode ${reasonCode || 'timeout'}); pairing ulang diperlukan.`);
                }
                return;
              }
              state.status = 'disconnected';
              state.code = null;
              state.expiresAt = null;
              state.socket = null;
              detachBotWorker(state, state.workerDesired ? 'waiting' : 'stopped');
              await log(userId, `Koneksi WhatsApp terputus sementara${reasonCode ? ` (kode ${reasonCode})` : ''}; auto-reconnect dijadwalkan.`);
              scheduleAutoReconnect(state);
            }
          } catch (error) {
            const reasonCode = disconnectStatusCode({ error });
            const detail = reasonCode ? ` (kode ${reasonCode})` : '';
            await fail(state, `Pairing belum dapat diselesaikan${detail}. Pastikan nomor aktif di WhatsApp dan coba lagi nanti.`, 502);
          }
        });
      };
      attachSocket();
      state.readyTimer = setTimeout(() => {
        void fail(state, 'WhatsApp belum siap mengeluarkan pairing code. Coba lagi nanti.', 504);
      }, SOCKET_READY_TIMEOUT_MS);
    } catch (error) {
      if (error instanceof PairingError) {
        if (error.status === 409 && state.status === 'linked') {
          // Sesi sudah tertaut tapi state in-memory baru dibuat (mis. habis
          // restart panel): JANGAN hapus state-nya. Dulu catch ini selalu
          // sessions.delete, jadi akun yang sebenarnya masih tertaut malah
          // jatuh ke 'belum_pernah' dan disuruh pairing ulang padahal file
          // session.json + cadangan masih bagus (bug jeffv2, 20 Nov 2026).
          // State dipertahankan supaya status tetap 'linked' dan tombol
          // Sambungkan ulang bisa menyambungkan socket-nya lagi.
          await releaseStateLock(state);
          throw new PairingError('Akun ini sudah memiliki sesi WhatsApp tertaut; tekan Sambungkan ulang, tidak perlu pairing code baru.', 409);
        }
        if (state.status !== 'linked') {
          state.status = 'failed';
          await removeUnregisteredAuth(state);
        }
        sessions.delete(userId);
        await releaseStateLock(state);
        throw error;
      }
      await removeUnregisteredAuth(state);
      sessions.delete(userId);
      await releaseStateLock(state);
      await log(userId, 'Pairing tidak dapat dimulai; tidak ada detail rahasia yang dicatat.');
      throw new PairingError('Layanan pairing belum dapat dimulai. Coba lagi nanti.', 503);
    }

    return codePromise;
  }

  function getState(userId) {
    return publicState(sessions.get(userId));
  }

  // Status pairing untuk notifikasi "WhatsApp belum tertaut": kalau sesi
  // belum sempat dicoba lagi di proses panel ini (panel baru restart dan
  // antrean resume belum sampai ke akun ini), ambil catatan terputus
  // terakhir dari file supaya alasan + waktunya langsung tampil.
  async function getLastUnlink(userId) {
    try { return await loadLastUnlink(accountAuthDir(userId)); } catch { return null; }
  }

  async function getStatusWithUnlink(userId) {
    const pairing = publicState(sessions.get(userId));
    if (pairing?.lastUnlink) return pairing;
    const lastUnlink = await getLastUnlink(userId);
    if (!lastUnlink) return pairing;
    if (!pairing) {
      return {
        status: 'invalid',
        method: 'pairing',
        code: null,
        qrDataUrl: null,
        maskedPhone: null,
        phoneNumber: null,
        expiresAt: null,
        reconnectAttempts: 0,
        reconnectFailures: 0,
        lastUnlink,
        workerStatus: 'stopped',
        workerStartedAt: null,
      };
    }
    return { ...pairing, lastUnlink };
  }

  // Sesi tersimpan di disk tapi belum ada state in-memory (mis. habis restart
  // panel sebelum resume jalan): laporkan sebagai 'tersimpan' supaya panel
  // tidak menampilkan 'Belum tertaut' dan tidak menyuruh pairing ulang —
  // yang ditawarkan adalah Sambungkan ulang, bukan kode baru.
  async function getSavedSessionInfo(userId) {
    try {
      const authDir = accountAuthDir(userId);
      for (const name of ['session.json', 'creds.json']) {
        const snapshot = await readSnapshotFile(path.join(authDir, name));
        if (!snapshot) continue;
        if (!isUsableAuthSnapshot(snapshot)) return { saved: true, registered: Boolean(snapshot?.creds?.registered), usable: false, maskedPhone: null };
        const meId = String(snapshot?.creds?.me?.id || '').split('@')[0].split(':')[0].replace(/\D/g, '');
        return { saved: true, registered: true, usable: true, maskedPhone: meId ? maskedNumber(meId) : null };
      }
      return null;
    } catch {
      return null;
    }
  }

  async function setOnline24(userId, enabled) {
    const state = sessions.get(userId);
    if (!state) return null;
    state.onlineDesired = enabled === true;
    if (state.onlineDesired && state.status === 'linked') {
      enableOnlinePrivacy(state.socket);
      scheduleOnlinePresence(state);
    } else if (!state.onlineDesired) {
      stopOnlinePresence(state);
      try {
        const result = state.socket?.updateOnlinePrivacy?.('match_last_seen');
        result?.catch?.(() => {});
      } catch { /* Best effort. */ }
      try { await state.socket?.sendPresenceUpdate('unavailable'); } catch { /* best effort */ }
    }
    return publicState(state);
  }

  function getPublicStats() {
    const states = [...sessions.values()];
    const whatsappConnected = states.filter((state) => state.status === 'linked').length;
    const reconnecting = states.filter((state) => state.status === 'reconnecting').length;
    const workersRunning = states.filter((state) => state.workerStatus === 'running').length;
    return { botOnline: whatsappConnected + reconnecting, whatsappConnected, workersRunning };
  }

  async function startBot(userId) {
    const state = sessions.get(userId);
    if (!state) throw new PairingError('Belum ada sesi WhatsApp aktif untuk akun ini.', 409);
    if (state.workerStatus === 'running'
      && state.workerSocket === state.socket
      && typeof state.workerHandler === 'function') {
      state.workerDesired = true;
      await setWorkerAutoStart(userId, true);
      scheduleWorkerWatchdog(state);
      return publicState(state);
    }
    if (state.workerStatus === 'running') detachBotWorker(state, 'waiting');
    attachBotWorker(state);
    await setWorkerAutoStart(userId, true);
    scheduleWorkerWatchdog(state);
    const settings = storySettingsFor(userId);
    await log(userId, `Bot dimulai pada mode ${settings.mode === 'readonly_readsw' ? 'Read Only + ReadSW' : 'Read Only'}; membaca status dengan delay acak ${settings.delayMinSeconds}–${settings.delayMaxSeconds} detik${settings.autoReaction ? ' dan reaksi emoji otomatis aktif' : ' tanpa reaksi otomatis'}.`);
    return publicState(state);
  }

  async function restartBot(userId) {
    const state = sessions.get(userId);
    if (!state) throw new PairingError('Belum ada sesi WhatsApp aktif untuk akun ini.', 409);
    detachBotWorker(state);
    attachBotWorker(state);
    await setWorkerAutoStart(userId, true);
    scheduleWorkerWatchdog(state);
    const settings = storySettingsFor(userId);
    await log(userId, `Bot dimulai ulang pada mode ${settings.mode === 'readonly_readsw' ? 'Read Only + ReadSW' : 'Read Only'}; delay acak ${settings.delayMinSeconds}–${settings.delayMaxSeconds} detik.`);
    return publicState(state);
  }

  async function stopBot(userId) {
    const state = sessions.get(userId);
    if (!state) throw new PairingError('Belum ada sesi WhatsApp aktif untuk akun ini.', 409);
    state.workerDesired = false;
    await setWorkerAutoStart(userId, false);
    clearTimeout(state.workerWatchdogTimer);
    state.workerWatchdogTimer = null;
    detachBotWorker(state);
    await log(userId, 'Bot dihentikan dari panel; auto-start dinonaktifkan sampai bot dimulai lagi. Koneksi WhatsApp tetap terjaga.');
    return publicState(state);
  }

  async function cancelPending(userId) {
    const state = sessions.get(userId);
    if (!state || state.status !== 'awaiting_code' || state.authState?.state?.creds?.registered) {
      throw new PairingError('Pairing code tidak lagi menunggu atau sesi WhatsApp sudah mulai tertaut.', 409);
    }
    const cooldownSeconds = Math.max(0, Math.ceil(((cooldowns.get(userId) || 0) - Date.now()) / 1000));
    clearTimeout(state.readyTimer);
    clearTimeout(state.expiryTimer);
    state.readyTimer = null;
    state.expiryTimer = null;
    state.status = 'expired';
    state.code = null;
    state.expiresAt = null;
    state.phoneNumber = null;
    state.workerDesired = false;
    stopOnlinePresence(state);
    detachBotWorker(state);
    const socket = state.socket;
    state.socket = null;
    try { socket?.end(new Error('Pairing code cancelled by account owner.')); } catch { /* best effort */ }
    await removeUnregisteredAuth(state);
    sessions.delete(userId);
    await log(userId, 'Pairing code dibatalkan pemilik akun; nomor baru dapat dipilih.');
    await releaseStateLock(state);
    return { pairing: null, cooldownSeconds };
  }

  async function stop(userId) {
    const state = sessions.get(userId);
    if (!state) return null;
    clearTimeout(state.readyTimer);
    clearTimeout(state.expiryTimer);
    clearTimeout(state.reconnectTimer);
    clearTimeout(state.workerWatchdogTimer);
    state.readyTimer = null;
    state.expiryTimer = null;
    state.reconnectTimer = null;
    state.workerWatchdogTimer = null;
    state.code = null;
    state.expiresAt = null;
    state.workerDesired = false;
    stopOnlinePresence(state);
    detachBotWorker(state);
    const socket = state.socket;
    state.socket = null;
    state.status = 'stopped';
    try { socket?.end(new Error('Stopped by account owner.')); } catch { /* best effort */ }
    await removeUnregisteredAuth(state);
    await log(userId, 'Koneksi WhatsApp dihentikan dari panel akun.');
    await releaseStateLock(state);
    return publicState(state);
  }

  async function resume(userId, { auto = false } = {}) {
    let state = sessions.get(userId);
    if (state?.status === 'invalid') {
      if (state.recoveryInProgress) return publicState(state);
      // Sesi invalid bisa berasal dari kegagalan sambung ulang beruntun
      // (jaringan/proxy/restart panel), bukan penolakan WhatsApp — cadangannya
      // mungkin masih hidup. Coba pulihkan sekali dari cadangan sebelum
      // meminta pairing ulang; kalau semua cadangan ditolak, baru 409.
      const recovered = await attemptSessionRecovery(state, null);
      if (recovered) return publicState(state);
      throw new PairingError('Sesi WhatsApp ditolak. Masukkan nomor dan minta pairing code baru.', 409);
    }
    const manualReconnect = !auto && state?.status === 'reconnecting';
    const linkedWithoutSocket = state?.status === 'linked' && !state.socket;
    if (state && ['connecting', 'awaiting_code', 'linking', 'linked', 'reconnecting'].includes(state.status)
      && !(auto && state.status === 'reconnecting' && !state.socket)
      && !manualReconnect && !linkedWithoutSocket) {
      return publicState(state);
    }
    if (linkedWithoutSocket) {
      // State 'linked' tanpa socket (mis. habis restart panel lalu minta
      // pairing code dan kena 409 'sudah tertaut'): statusnya bohong, socket
      // belum tersambung. Jangan langsung kembalikan 'linked' — sambungkan
      // ulang seperti reconnecting, supaya akun benar-benar online lagi.
      state.status = 'reconnecting';
      state.consecutiveReconnectFailures = 0;
      state.reconnectAttempts = 0;
    }
    if (manualReconnect) {
      // Tombol "Sambungkan ulang" ditekan member saat sesi macet di
      // reconnecting: batalkan timer lama dan mulai percobaan baru,
      // bukan diam saja seperti sebelumnya.
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
      state.consecutiveReconnectFailures = 0;
      state.reconnectAttempts = 0;
    }
    const hadSessionLock = Boolean(state?.sessionLock);
    const sessionLock = state?.sessionLock || await acquireAccountLock(userId);
    if (state) state.sessionLock = sessionLock;
    let authDir;
    let authState = state?.authState;
    try {
      authDir = await resolveAuthDir(userId);
      if (!authState) {
        let foundAuth = false;
        for (const name of ['session.json', 'creds.json']) {
          try { await fs.access(path.join(authDir, name)); foundAuth = true; break; } catch { /* Try legacy filename. */ }
        }
        if (!foundAuth) throw new Error('No saved WhatsApp auth state.');
        authState = await useSingleFileAuthState(authDir);
      }
    } catch {
      if (!hadSessionLock) {
        if (state) state.sessionLock = null;
        try { await sessionLock.release(); } catch { /* Stale-lock recovery handles cleanup. */ }
      }
      throw new PairingError('Sesi WhatsApp tersimpan tidak ditemukan. Minta pairing code baru.', 404);
    }
    if (!authState.state.creds.registered) {
      if (auto && state) {
        await markSessionInvalid(state, null);
        return publicState(state);
      }
      if (!hadSessionLock) {
        if (state) state.sessionLock = null;
        try { await sessionLock.release(); } catch { /* Stale-lock recovery handles cleanup. */ }
      }
      throw new PairingError('Belum ada sesi WhatsApp tertaut untuk disambungkan ulang.', 409);
    }
    const linkedId = authState?.state?.creds?.me?.id;
    const linkedDigits = String(linkedId || '').split('@')[0].split(':')[0].replace(/\D/g, '');
    const resumedMaskedPhone = linkedDigits ? maskedNumber(linkedDigits) : (state?.maskedPhone || '••••••');
    const stateWasPresent = Boolean(state);
    if (state?.socket) {
      detachBotWorker(state, state.workerDesired ? 'waiting' : 'stopped');
      try { state.socket.end(new Error('Replacing stopped socket.')); } catch { /* best effort */ }
    }
    state = state || {
      userId,
      authDir,
      sessionLock,
      socket: null,
      authState,
      waVersion: null,
      status: 'reconnecting',
      code: null,
      expiresAt: null,
      maskedPhone: resumedMaskedPhone,
      phoneNumber: null,
      codeRequested: true,
      workerStatus: 'stopped',
      workerDesired: false,
      onlineDesired: getOnline24(userId) === true,
      workerSocket: null,
      workerHandler: null,
      startSettled: true,
      readyTimer: null,
      expiryTimer: null,
      reconnectTimer: null,
      reconnectAttempts: 0,
      workerWatchdogTimer: null,
      onlinePresenceTimer: null,
      resolveStart: null,
      rejectStart: null,
      runtimeTotalMs: 0,
      runtimeStartedAt: null,
      runtimeLoaded: false,
    };
    if (!state.lastUnlink) state.lastUnlink = await loadLastUnlink(state.authDir);
    state.authState = authState;
    await loadRuntimeIntoState(state);
    state.waVersion = await resolveWaWebVersion();
    state.maskedPhone = resumedMaskedPhone;
    state.onlineDesired = getOnline24(userId) === true;
    if (getWorkerAutoStart(userId)) {
      state.workerDesired = true;
      state.workerStatus = 'waiting';
    }
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
    state.status = 'reconnecting';
    state.code = null;
    state.expiresAt = null;
    state.phoneNumber = null;
    clearReconnectStableTimer(state);
    clearTimeout(state.readyTimer);
    clearTimeout(state.expiryTimer);
    let socket;
	    try {
	      socket = makeWASocket({
	        auth: authState.state,
	        logger: baileysLogger,
	        // WhatsApp WebSocket harus lewat egress proxy VM, kalau tidak
	        // koneksi langsung diblokir dan mati instan kode 408.
	        agent: getWhatsAppProxyAgent(),
	        ...(state.waVersion ? { version: state.waVersion } : {}),
	        browser: Browsers.macOS('Chrome'),
	        keepAliveIntervalMs: WA_KEEP_ALIVE_INTERVAL_MS,
	        defaultQueryTimeoutMs: WA_DEFAULT_QUERY_TIMEOUT_MS,
	        connectTimeoutMs: WA_CONNECT_TIMEOUT_MS,
	        retryRequestDelayMs: WA_RETRY_REQUEST_DELAY_MS,
	        maxMsgRetryCount: 5,
	        // Reconnect hanya memulihkan sesi dan event status/story yang baru.
	        // Full-history pada setiap reconnect memperberat handshake dan dapat
	        // memicu penutupan 428 pada kombinasi WhatsApp Web/Baileys tertentu.
	        syncFullHistory: false,
	        markOnlineOnConnect: state.onlineDesired,
	      });
    } catch (error) {
      state.socket = null;
      state.status = 'disconnected';
      if (!stateWasPresent) sessions.delete(userId);
      if (!hadSessionLock) await releaseStateLock(state);
      throw error;
    }
    state.socket = socket;
    captureEarlyHistoryStories(state, socket);
    sessions.set(userId, state);
    socket.ev.on('creds.update', () => {
      void authState.saveCreds().then(() => {
        void saveSessionBackup(state.authDir);
      }).catch(() => {
        void log(userId, 'Peringatan: perubahan kredensial WhatsApp gagal tersimpan ke disk.');
      });
    });
    socket.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
      if (socket !== state.socket) return;
      if (connection === 'open') {
        clearTimeout(state.readyTimer);
        clearTimeout(state.reconnectTimer);
        state.readyTimer = null;
        state.reconnectTimer = null;
        scheduleReconnectStableReset(state, socket);
        state.status = 'linked';
        state.consecutiveReconnectFailures = 0;
        state.reconnectAttempts = 0;
        snapshotGoodSession(state);
        const linkedDigits = String(state.authState?.state?.creds?.me?.id || socket?.user?.id || '').split('@')[0].split(':')[0].replace(/\D/g, '');
        if (linkedDigits) state.maskedPhone = maskedNumber(linkedDigits);
        if (state.onlineDesired) enableOnlinePrivacy(state.socket);
        scheduleOnlinePresence(state);
        if (state.workerDesired) {
          try {
            attachBotWorker(state);
          } catch {
            state.workerStatus = 'waiting';
            await log(userId, 'WhatsApp aktif kembali; worker menunggu konfigurasi mode yang valid sebelum dijalankan.');
          }
          scheduleWorkerWatchdog(state);
        }
        await log(userId, 'Koneksi WhatsApp aktif kembali dari panel akun.');
      } else if (connection === 'close' && ['reconnecting', 'linked'].includes(state.status)) {
        stopOnlinePresence(state);
        clearReconnectStableTimer(state);
        clearTimeout(state.readyTimer);
        state.readyTimer = null;
        const reasonCode = disconnectStatusCode(lastDisconnect);
        if (isInvalidSessionCode(reasonCode)) {
          if (state.recoveryInProgress) {
            await markSessionInvalid(state, reasonCode);
            return;
          }
          const recovered = await attemptSessionRecovery(state, reasonCode);
          if (!recovered) await markSessionInvalid(state, reasonCode);
          return;
        }
        if (classifyDisconnectCode(reasonCode) === 'connection_replaced') {
          await pauseAfterConnectionReplaced(state, reasonCode);
          return;
        }
        if (registerReconnectFailure(state)) {
          // Batas tercapai bukan berarti kredensial mati: coba pulihkan
          // dari cadangan dulu sebelum menyatakan sesi invalid.
          const recovered = await attemptSessionRecovery(state, reasonCode);
          if (!recovered) {
            await markSessionInvalid(state, reasonCode);
            await log(userId, `Sesi WhatsApp tidak dapat dipulihkan setelah ${MAX_CONSECUTIVE_RECONNECT_FAILURES} kali percobaan sambung ulang gagal (kode ${reasonCode || 'timeout'}); pairing ulang diperlukan.`);
          }
          return;
        }
        state.status = 'disconnected';
        detachBotWorker(state, state.workerDesired ? 'waiting' : 'stopped');
        state.socket = null;
        await log(userId, `Koneksi WhatsApp terputus setelah sesi dipulihkan${reasonCode ? ` (kode ${reasonCode})` : ''}; auto-reconnect dijadwalkan.`);
        scheduleAutoReconnect(state);
      }
    });
    state.readyTimer = setTimeout(() => {
      if (state.status !== 'reconnecting') return;
      state.status = 'disconnected';
      state.socket = null;
      try { socket.end(new Error('Reconnect timed out.')); } catch { /* best effort */ }
      void log(userId, 'Waktu tunggu sambung ulang habis.');
      scheduleAutoReconnect(state);
    }, SOCKET_READY_TIMEOUT_MS);
    await log(userId, 'Permintaan sambung ulang sesi WhatsApp dimulai.');
    return publicState(state);
  }

  async function deleteSession(userId) {
    const state = sessions.get(userId);
    const hadSessionLock = Boolean(state?.sessionLock);
    const sessionLock = state?.sessionLock || await acquireAccountLock(userId);
    if (state) state.sessionLock = sessionLock;
    try {
      const authDir = await resolveAuthDir(userId);
      if (state) {
        clearTimeout(state.readyTimer);
        clearTimeout(state.expiryTimer);
        clearTimeout(state.reconnectTimer);
        clearTimeout(state.workerWatchdogTimer);
        state.readyTimer = null;
        state.expiryTimer = null;
        state.reconnectTimer = null;
        state.workerWatchdogTimer = null;
        const socket = state.socket;
        state.socket = null;
        state.status = 'deleted';
        state.workerDesired = false;
        detachBotWorker(state);
        if (socket && state.authState?.state?.creds?.registered && typeof socket.logout === 'function') {
          try { await socket.logout(); } catch { try { socket.end(new Error('Session removed by account owner.')); } catch { /* best effort */ } }
        } else {
          try { socket?.end(new Error('Session removed by account owner.')); } catch { /* best effort */ }
        }
      }
      await removeUserAuth(userId, authDir);
      await fs.rm(path.join(authDir, GOOD_SNAPSHOT_FILENAME), { force: true }).catch(() => {});
      await fs.rm(path.join(authDir, BACKUP_FILENAME), { force: true }).catch(() => {});
      await fs.rm(path.join(authDir, UNLINK_FILENAME), { force: true }).catch(() => {});
      resetRuntime(state);
      sessions.delete(userId);
      cooldowns.delete(userId);
      await log(userId, 'Sesi WhatsApp lokal dihapus dari panel akun.');
      return null;
    } finally {
      if (state) await releaseStateLock(state);
      else if (!hadSessionLock) {
        try { await sessionLock.release(); } catch { /* Stale-lock recovery handles cleanup. */ }
      }
    }
  }

  async function shutdown() {
    for (const state of sessions.values()) {
      state.status = 'stopped';
      state.code = null;
      state.workerDesired = false;
      clearTimeout(state.workerWatchdogTimer);
      state.workerWatchdogTimer = null;
      detachBotWorker(state);
      try { await state.authState?.flush?.(); } catch {
        await log(state.userId, 'Peringatan: penulisan sesi WhatsApp belum selesai saat server dihentikan.');
      }
      endSocket(state);
      state.socket = null;
      if (!state.authState?.state?.creds?.registered) await removeUnregisteredAuth(state);
      await releaseStateLock(state);
    }
    sessions.clear();
  }

  return { start, getState, getStatusWithUnlink, getLastUnlink, getSavedSessionInfo, setOnline24, getPublicStats, startBot, restartBot, stopBot, cancelPending, stop, resume, deleteSession, shutdown };
}
