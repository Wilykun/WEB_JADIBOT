import http from 'node:http';
import { gzipSync } from 'node:zlib';
import os from 'node:os';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createPairingManager, maskedEmail, normalizePairingInput, PairingError } from './pairing-manager.js';
import { sanitizeStoryLogDetails } from './story-log.js';
import { readAvatarUpload } from './avatar-upload.js';
import { BANNED_LOGIN_NOTICE, DELETED_LOGIN_NOTICE, botControlPolicyError, isBannedAccount, isMainAdminUser, memberAdminPolicyError, normalizeBanReason, withMemberLifecycleLock } from './member-admin-policy.js';
import { BackupArchiveError, createEncryptedBackup, createPlainBackupZip, decryptEncryptedBackup, MAX_ARCHIVE_BYTES, MAX_PLAINTEXT_BYTES } from './admin-backup.js';
import { createDefaultBotRecord } from './default-bot.js';
import { TELEGRAM_API_BASE, readStoredTelegramConfig, validateTelegramChat, validateTelegramConfig } from './telegram-config.js';
import { acquireRestoreLock } from './session-lock.js';
import {
  randomBytes,
  randomUUID,
  randomInt,
  scrypt as scryptCallback,
  createHmac,
  createHash,
  timingSafeEqual,
} from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadConfigJson() {
  let config;
  try {
    config = JSON.parse(fsSync.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw new Error(`config.json tidak valid atau tidak dapat dibaca: ${error.message}`);
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('config.json harus berupa objek JSON.');
  }
  const values = {
    PORT: config.port,
    HOST: config.host,
    PANEL_DATA_DIR: config.panelDataDir,
    SESSION_SECRET: config.sessionSecret,
    BOOTSTRAP_ADMIN_EMAIL: config.admin?.email,
    BOOTSTRAP_ADMIN_USERNAME: config.admin?.username,
    BOOTSTRAP_ADMIN_NAME: config.admin?.name,
    BOOTSTRAP_ADMIN_PASSWORD: config.admin?.password,
    ADMIN_ACCESS_CODE: config.adminAccessCode,
  };
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && process.env[key] === undefined) process.env[key] = String(value);
  }
}

loadConfigJson();
process.umask(0o077);

const scrypt = promisify(scryptCallback);
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.resolve(ROOT, process.env.PANEL_DATA_DIR || 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const SECRET_FILE = path.join(DATA_DIR, '.session-secret');
const RESTORE_SECRET_FILE = path.join(DATA_DIR, '.restore-session-secret');
const BACKUP_SNAPSHOT_DIR = path.join(DATA_DIR, 'backup-snapshots');
const TELEGRAM_CONFIG_FILE = path.join(DATA_DIR, 'telegram.json');
const CHAT_FILE = path.join(DATA_DIR, 'Obrolan.json');
const UPTIME_FILE = path.join(DATA_DIR, 'uptime.json');
const CHAT_MAX_MESSAGES = 200;
const CHAT_TYPING_WINDOW_MS = 12000;
const TELEGRAM_MAX_BYTES = 50 * 1024 * 1024;
const STALKER_DIR = path.join(ROOT, 'DATA_STALKER');
const STALKER_FILE = path.join(STALKER_DIR, 'visitors.json');
const VISIT_DIR = path.join(ROOT, 'DATA_KUNJUNGAN');
const VISIT_FILE = path.join(VISIT_DIR, 'visitors.json');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_AVATAR_BYTES = 100 * 1024;
const MAX_BACKUP_UPLOAD_BYTES = MAX_ARCHIVE_BYTES;
const MAX_BACKUP_DATA_BYTES = MAX_PLAINTEXT_BYTES;
const PASSWORD_MIN = 12;
const PENDING_REGISTRATION_TTL_MS = 24 * 60 * 60 * 1000;
const ADMIN_ACCESS_CODE = String(process.env.ADMIN_ACCESS_CODE || '').trim();
const ADMIN_ACCESS_MAX_ATTEMPTS = 5;
const plans = new Set(['readonly', 'readonly_readsw', 'online24']);
const AVATAR_PRESETS = new Set(Array.from({ length: 48 }, (_, index) => `avatar-${String(index + 1).padStart(2, '0')}`));
const MAX_STORY_EMOJIS = 30;
const emojiGraphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });

let sessionSecret;
let store = { users: [], pendingRegistrations: [], bots: [], sessions: [], pairingLogs: [], loginHistory: [] };
let stalkerStore = { visitors: [] };
let visitStore = { visitors: [] };
let writeQueue = Promise.resolve();
let stalkerWriteQueue = Promise.resolve();
let visitWriteQueue = Promise.resolve();
let restoreInProgress = false;
const rateLimits = new Map();
// Obrolan: siapa sedang mengetik (userId -> { ..., until }) dan kapan terakhir
// tiap akun mengirim pesan (batas 1 pesan/detik supaya tidak spam).
const chatTyping = new Map();
const chatSendTimes = new Map();
// Obrolan: semua pesan chat tersimpan rapi di data/Obrolan.json
// ({ messages: [...] }), bukan di store.json. Ditulis berurutan lewat antrean.
let chatStore = { messages: [] };
let chatWriteQueue = Promise.resolve();
function saveChatMessages() {
  const operation = chatWriteQueue.then(async () => {
    await atomicWriteJson(CHAT_FILE, chatStore);
  });
  chatWriteQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.displayName,
    avatar: user.avatar === 'uploaded' ? 'uploaded' : AVATAR_PRESETS.has(user.avatar) ? user.avatar : 'avatar-01',
    avatarUpdatedAt: user.avatarUpdatedAt || null,
    avatarMime: user.avatar === 'uploaded' ? (user.avatarMime || null) : null,
    role: user.role,
    isMainAdmin: isMainAdmin(user),
    mustChangePassword: Boolean(user.mustChangePassword),
    passwordChangedAt: user.passwordChangedAt || null,
    createdAt: user.createdAt,
  };
}

// Admin Utama = admin yang username-nya sama dengan admin di config.json
// (env BOOTSTRAP_ADMIN_USERNAME, yaitu WILYKUN). Admin biasa tidak sama.
function isMainAdmin(user) {
  return isMainAdminUser(user, process.env.BOOTSTRAP_ADMIN_USERNAME);
}

function createVerificationChallenge() {
  const uppercase = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lowercase = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const alphabet = uppercase + lowercase + digits;
  const characters = [
    uppercase[randomInt(uppercase.length)],
    lowercase[randomInt(lowercase.length)],
    digits[randomInt(digits.length)],
    alphabet[randomInt(alphabet.length)],
    alphabet[randomInt(alphabet.length)],
  ];
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]];
  }
  const answer = characters.join('');
  return {
    prompt: answer,
    answerHash: createHmac('sha256', sessionSecret).update(answer).digest('hex'),
    caseSensitive: true,
    expiresAt: Date.now() + 15 * 60 * 1000,
    attempts: 0,
    cooldownUntil: 0,
  };
}

function clone(value) {
  return structuredClone(value);
}

async function atomicWriteJson(file, value) {
  const temp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temp, file);
  await fs.chmod(file, 0o600).catch(() => {});
}

// Uptime panel yang tidak reset saat restart: total detik berjalan disimpan
// di data/uptime.json lalu ditambah waktu proses ini berjalan. Disimpan
// berkala (tiap 60 dtk) dan saat shutdown, jadi kalaupun VM mati mendadak
// paling banyak ~60 dtk yang hilang.
let uptimeBaseSeconds = 0;
let uptimeProcessStartedAt = Date.now();
let uptimeFirstStartedAt = null;
let uptimeSaveTimer = null;

function currentUptimeSeconds() {
  return uptimeBaseSeconds + Math.max(0, Math.floor((Date.now() - uptimeProcessStartedAt) / 1000));
}

async function loadUptimeState() {
  try {
    const parsed = JSON.parse(await fs.readFile(UPTIME_FILE, 'utf8'));
    if (parsed && typeof parsed === 'object') {
      uptimeBaseSeconds = Math.max(0, Math.floor(Number(parsed.accumulatedSeconds) || 0));
      if (typeof parsed.firstStartedAt === 'string' && !Number.isNaN(Date.parse(parsed.firstStartedAt))) uptimeFirstStartedAt = parsed.firstStartedAt;
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') console.warn('[panel] Gagal membaca uptime.json, mulai dari nol:', error?.message || error);
  }
  if (!uptimeFirstStartedAt) uptimeFirstStartedAt = new Date().toISOString();
  uptimeProcessStartedAt = Date.now();
}

async function saveUptimeState() {
  try {
    await atomicWriteJson(UPTIME_FILE, {
      accumulatedSeconds: currentUptimeSeconds(),
      firstStartedAt: uptimeFirstStartedAt,
      updatedAt: new Date().toISOString(),
    });
  } catch { /* Gagal menyimpan uptime bukan alasan panel berhenti. */ }
}

function startUptimeSaver() {
  if (uptimeSaveTimer) return;
  uptimeSaveTimer = setInterval(() => { void saveUptimeState(); }, 60 * 1000);
  uptimeSaveTimer.unref();
}

function mutate(fn, { requireAccountSync = false } = {}) {
  const operation = writeQueue.then(async () => {
    const before = new Map();
    for (const user of store.users || []) {
      try { before.set(user.id, JSON.stringify(buildAccountFiles(store, user))); } catch { /* sync paksa */ }
    }
    const next = clone(store);
    const result = await fn(next);
    await atomicWriteJson(STORE_FILE, next);
    store = next;
    try {
      await syncChangedAccounts(before, next);
    } catch (error) {
      // Operasi biasa hanya mencatat kegagalan cermin; avatar memakai mode wajib.
      console.warn('[panel] Gagal menulis cermin DATA_AKUN:', error?.message || error);
      if (requireAccountSync) throw error;
    }
    return result;
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

function stalkerCookieHeader(value, maxAgeSeconds = 60 * 60 * 24 * 30) {
  return `readsw_visitor=${encodeURIComponent(value)}; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function liveOnlineCount() {
  const activeSince = Date.now() - 75_000;
  return new Set((store.sessions || [])
    .filter((session) => session.expiresAt > Date.now() && session.lastSeen >= activeSince)
    .map((session) => session.userId)).size;
}

function liveStalkerCount() {
  const activeSince = Date.now() - 75_000;
  return (stalkerStore.visitors || []).filter((visitor) => visitor.lastSeen >= activeSince).length;
}
function uniqueVisitCount() {
  return Array.isArray(visitStore.visitors) ? visitStore.visitors.length : 0;
}
function normalizeVisitIp(value) {
  const ip = String(value || '').trim().toLowerCase();
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}
async function trackVisit(req) {
  const ip = normalizeVisitIp(clientIp(req));
  if (!ip || ip === 'unknown' || ip === 'unknown-client') return;
  const now = Date.now();
  const device = parseDevice(String(req.headers['user-agent'] || '').slice(0, 512));
  const operation = visitWriteQueue.then(async () => {
    const next = clone(visitStore);
    const existing = next.visitors.find((visitor) => visitor.ip === ip);
    if (existing) {
      existing.lastSeen = now;
      existing.hits = Number(existing.hits || 0) + 1;
      existing.device = device;
    } else {
      next.visitors.push({ ip, firstSeen: now, lastSeen: now, hits: 1, device });
    }
    await atomicWriteJson(VISIT_FILE, next);
    visitStore = next;
  });
  visitWriteQueue = operation.then(() => undefined, () => undefined);
  return operation;
}
function touchStalker(req, visitorId) {
  if (!/^[a-f0-9]{36,64}$/i.test(visitorId)) return;
  const now = Date.now();
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 512);
  const device = parseDevice(userAgent);
  const operation = stalkerWriteQueue.then(async () => {
    const next = clone(stalkerStore);
    const existing = next.visitors.find((visitor) => visitor.id === visitorId);
    if (existing) {
      existing.lastSeen = now;
      existing.hits = Number(existing.hits || 0) + 1;
      existing.device = device;
    } else {
      next.visitors.push({ id: visitorId, firstSeen: now, lastSeen: now, hits: 1, device });
    }
    const cutoff = now - 30 * 24 * 60 * 60 * 1000;
    next.visitors = next.visitors.filter((visitor) => visitor.lastSeen >= cutoff).slice(-2000);
    await atomicWriteJson(STALKER_FILE, next);
    stalkerStore = next;
  });
  stalkerWriteQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

async function removeStalker(visitorId) {
  if (!/^[a-f0-9]{36,64}$/i.test(visitorId)) return;
  const operation = stalkerWriteQueue.then(async () => {
    const next = clone(stalkerStore);
    next.visitors = next.visitors.filter((visitor) => visitor.id !== visitorId);
    await atomicWriteJson(STALKER_FILE, next);
    stalkerStore = next;
  });
  stalkerWriteQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

// Cermin metadata per-akun: admin di DATA_AKUN/ADMIN/<username>/, member di
// DATA_AKUN/MEMBER/<username>/. File JSON ditulis dari store.json untuk satu
// akun; store.json tetap sumber kebenaran metadata. Auth WhatsApp privat
// memakai session.json; login panel dicerminkan terpisah. Avatar unggahan
// dibaca pemilik atau admin terautentikasi melalui endpoint terbatas.
const ACCOUNT_DIR = path.join(ROOT, 'DATA_AKUN');
const ADMIN_ACCOUNT_DIR = path.join(ACCOUNT_DIR, 'ADMIN');
const MEMBER_ACCOUNT_DIR = path.join(ACCOUNT_DIR, 'MEMBER');
// Folder akun lama (dipakai sebelum restrukturisasi ADMIN/MEMBER):
// DATA_AKUN/DATA_ADMIN dari layout b91ff1f, DATA_ADMIN di luar dari layout
// c89287b, dan akun langsung di DATA_AKUN — hanya dibaca sebagai fallback,
// tidak pernah ditulis baru.
const LEGACY_ADMIN_ACCOUNT_DIR = path.join(ACCOUNT_DIR, 'DATA_ADMIN');
const LEGACY_TOP_ADMIN_ACCOUNT_DIR = path.join(ROOT, 'DATA_ADMIN');
const WIB_FORMAT = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long',
  year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});

function formatWIB(iso) {
  if (!iso) return null;
  try { return `${WIB_FORMAT.format(new Date(iso))} WIB`; } catch { return null; }
}

// Nama folder akun = username lowercase yang sudah tervalidasi
// [a-z0-9][a-z0-9._-]{2,23}. Kembalikan null bila tidak valid.
// Peran dibaca dari registry: admin ke DATA_AKUN/ADMIN, member ke
// DATA_AKUN/MEMBER. Bila folder kanonis belum ada tapi folder lama ada —
// akun langsung di DATA_AKUN, di DATA_AKUN/DATA_ADMIN, atau di DATA_ADMIN
// luar — folder lama dipakai, agar sesi dan bot tidak putus.
function accountFolder(username, role) {
  const name = String(username || '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,23}$/.test(name)) return null;
  const resolvedRole = role || store.users.find((item) => item.username === name)?.role;
  const canonical = path.join(resolvedRole === 'admin' ? ADMIN_ACCOUNT_DIR : MEMBER_ACCOUNT_DIR, name);
  if (fsSync.existsSync(canonical)) return canonical;
  for (const candidate of [path.join(ACCOUNT_DIR, name), path.join(LEGACY_ADMIN_ACCOUNT_DIR, name), path.join(LEGACY_TOP_ADMIN_ACCOUNT_DIR, name)]) {
    if (candidate !== canonical && fsSync.existsSync(candidate)) return candidate;
  }
  return canonical;
}

// Folder kanonis akun untuk penulisan baru: admin ke DATA_AKUN/ADMIN, member ke DATA_AKUN/MEMBER. Folder lama tidak pernah ditulis baru.
function canonicalAccountFolder(user) {
  const name = String(user.username || '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,23}$/.test(name)) return null;
  return path.join(user.role === 'admin' ? ADMIN_ACCOUNT_DIR : MEMBER_ACCOUNT_DIR, name);
}

const INFO_UPDATE_SEEN_FILE = 'info-update-seen.json';

// Badge Info Update: penanda terakhir dibaca disimpan per akun di folder DATA_AKUN masing-masing, jadi akun lain tidak ikut terpengaruh.
// RONDE 46: file yang sama juga menyimpan penanda "sudah ditutup" (dismissed)
// untuk modal Pembaruan baru — supaya "Tutup" tidak hanya diingat di memori
// halaman (hilang saat refresh), tapi tersimpan per akun dan modal tidak
// muncul lagi untuk entri yang sama sampai ada update yang lebih baru.
async function readInfoUpdateSeen(user) {
  const dir = canonicalAccountFolder(user);
  if (!dir) return null;
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(dir, INFO_UPDATE_SEEN_FILE), 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    const seen = {
      day: String(parsed.day || '').trim().slice(0, 60),
      time: String(parsed.time || '').trim().slice(0, 20),
      title: String(parsed.title || '').trim().slice(0, 200),
      dismissed: null,
    };
    const rawDismissed = parsed.dismissed;
    if (rawDismissed && typeof rawDismissed === 'object') {
      const dismissed = {
        day: String(rawDismissed.day || '').trim().slice(0, 60),
        time: String(rawDismissed.time || '').trim().slice(0, 20),
        title: String(rawDismissed.title || '').trim().slice(0, 200),
      };
      if (dismissed.day && dismissed.time && dismissed.title) seen.dismissed = dismissed;
    }
    return seen;
  } catch { return null; }
}

async function writeInfoUpdateSeen(user, seen) {
  const dir = canonicalAccountFolder(user);
  if (!dir) throw new Error('Folder akun tidak valid.');
  const current = await readInfoUpdateSeen(user);
  if (current && current.day === seen.day && current.time === seen.time && current.title === seen.title) return current;
  await fs.mkdir(dir, { recursive: true });
  const record = { ...seen, seenAt: new Date().toISOString() };
  if (current?.dismissed) record.dismissed = current.dismissed;
  await atomicWriteJson(path.join(dir, INFO_UPDATE_SEEN_FILE), record);
  return { ...seen, dismissed: current?.dismissed || null };
}

// RONDE 46: simpan penanda "modal sudah ditutup" tanpa mengubah penanda
// dibaca (badge tetap), supaya modal tidak muncul lagi setelah refresh.
async function writeInfoUpdateDismissed(user, dismissed) {
  const dir = canonicalAccountFolder(user);
  if (!dir) throw new Error('Folder akun tidak valid.');
  const current = await readInfoUpdateSeen(user);
  if (current?.dismissed && current.dismissed.day === dismissed.day && current.dismissed.time === dismissed.time && current.dismissed.title === dismissed.title) return current;
  await fs.mkdir(dir, { recursive: true });
  const record = {
    day: current?.day || '',
    time: current?.time || '',
    title: current?.title || '',
    seenAt: current?.seenAt || null,
    dismissed: { ...dismissed, dismissedAt: new Date().toISOString() },
  };
  await atomicWriteJson(path.join(dir, INFO_UPDATE_SEEN_FILE), record);
  return { ...record, dismissed: record.dismissed };
}

const MEMBER_LIST_SEEN_FILE = 'member-list-seen.json';

// Badge Member: penanda akun terbaru yang sudah dilihat, disimpan per akun di
// folder DATA_AKUN masing-masing, jadi angka badge tiap akun berbeda.
async function readMemberListSeen(user) {
  const dir = canonicalAccountFolder(user);
  if (!dir) return null;
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(dir, MEMBER_LIST_SEEN_FILE), 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    const createdAt = String(parsed.createdAt || '').trim();
    const username = String(parsed.username || '').trim().slice(0, 24);
    if (!createdAt || Number.isNaN(Date.parse(createdAt)) || !username) return null;
    return { createdAt, username };
  } catch { return null; }
}

async function writeMemberListSeen(user, seen) {
  const dir = canonicalAccountFolder(user);
  if (!dir) throw new Error('Folder akun tidak valid.');
  const current = await readMemberListSeen(user);
  if (current && current.createdAt === seen.createdAt && current.username === seen.username) return current;
  await fs.mkdir(dir, { recursive: true });
  await atomicWriteJson(path.join(dir, MEMBER_LIST_SEEN_FILE), { ...seen, seenAt: new Date().toISOString() });
  return seen;
}

const RANK_OVERTAKES_FILE = 'rank-overtakes.json';
const RANK_OVERTAKES_MAX = 50;

// Notifikasi salip Rank Bot: daftar salip yang belum ditutup, disimpan per
// akun di folder DATA_AKUN masing-masing, jadi tiap akun (Admin Utama, admin
// biasa, member) punya antrean sendiri yang tidak hilang saat halaman
// dimuat ulang atau ganti perangkat. Antrean diurutkan dari yang paling lama
// ke yang terbaru; bila melebihi batas, yang paling lama dibuang.
function sanitizeRankOvertake(item) {
  if (!item || typeof item !== 'object') return null;
  const username = (value) => String(value || '').trim().slice(0, 24);
  const overtaker = username(item.overtaker);
  const overtaken = username(item.overtaken);
  const position = (value) => {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) && n >= 1 && n <= 10000 ? n : null;
  };
  const newPosition = position(item.newPosition);
  const oldPosition = position(item.oldPosition);
  const overtakenNewPosition = position(item.overtakenNewPosition);
  const overtakenOldPosition = position(item.overtakenOldPosition);
  const createdAt = String(item.createdAt || '').trim();
  const id = String(item.id || '').trim().slice(0, 120);
  if (!overtaker || !overtaken || overtaker === overtaken) return null;
  if (!newPosition || !oldPosition || !overtakenNewPosition || !overtakenOldPosition) return null;
  if (!createdAt || Number.isNaN(Date.parse(createdAt)) || !id) return null;
  return {
    id,
    overtaker,
    overtaken,
    newPosition,
    oldPosition,
    overtakenNewPosition,
    overtakenOldPosition,
    isClimb: item.isClimb === true,
    createdAt,
  };
}

async function readRankOvertakes(user) {
  const dir = canonicalAccountFolder(user);
  if (!dir) return [];
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(dir, RANK_OVERTAKES_FILE), 'utf8'));
    const items = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.items) ? parsed.items : []);
    return items.map(sanitizeRankOvertake).filter(Boolean);
  } catch { return []; }
}

async function writeRankOvertakes(user, items) {
  const dir = canonicalAccountFolder(user);
  if (!dir) throw new Error('Folder akun tidak valid.');
  const clean = items.map(sanitizeRankOvertake).filter(Boolean).slice(-RANK_OVERTAKES_MAX);
  await fs.mkdir(dir, { recursive: true });
  await atomicWriteJson(path.join(dir, RANK_OVERTAKES_FILE), { items: clean, updatedAt: new Date().toISOString() });
  return clean;
}

function buildAccountFiles(snapshot, user) {
  const userId = user.id;
  const logins = (snapshot.loginHistory || []).filter((entry) => entry.userId === userId);
  const lastLogin = logins.at(-1) || null;
  const sessions = (snapshot.sessions || [])
    .filter((session) => session.userId === userId && session.expiresAt > Date.now())
    .map((session) => {
      const login = logins.find((entry) => entry.sid === session.sid);
      return {
        sid: String(session.sid).slice(0, 8),
        ip: login ? login.ip : null,
        device: login ? deviceLabel(login.device) : null,
        dibuat: login ? login.createdAt : null,
        dibuatWIB: login ? formatWIB(login.createdAt) : null,
        terakhirAktif: session.lastSeen ? new Date(session.lastSeen).toISOString() : (login ? login.createdAt : null),
        terakhirAktifWIB: formatWIB(session.lastSeen ? new Date(session.lastSeen).toISOString() : (login ? login.createdAt : null)),
        berakhir: new Date(session.expiresAt).toISOString(),
      };
    });
  const bot = (snapshot.bots || []).find((item) => item.userId === userId) || null;
  const logs = (snapshot.pairingLogs || []).filter((entry) => entry.userId === userId);
  const lastLog = logs.at(-1) || null;
  const pairing = pairingManager.getState(userId);
  return {
    'akun.json': {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.displayName,
      avatar: user.avatar === 'uploaded' ? 'uploaded' : AVATAR_PRESETS.has(user.avatar) ? user.avatar : 'avatar-01',
      avatarUpdatedAt: user.avatarUpdatedAt || null,
      role: user.role,
      verified: user.verified !== false,
      banned: isBannedAccount(user),
      bannedAt: user.bannedAt || null,
      banReason: user.banReason || null,
      createdAt: user.createdAt,
    },
    'panel-sessions.json': {
      username: user.username,
      sesiAktif: sessions,
      loginTerakhir: lastLogin ? {
        waktu: lastLogin.createdAt,
        waktuWIB: formatWIB(lastLogin.createdAt),
        ip: lastLogin.ip,
        device: deviceLabel(lastLogin.device),
      } : null,
    },
    'bot.json': bot ? {
      id: bot.id,
      label: bot.label ?? null,
      mode: bot.mode,
      storySettings: bot.storySettings ?? null,
      autoStart: bot.autoStart === true,
      runnerStatus: bot.runnerStatus ?? null,
      createdAt: bot.createdAt ?? null,
      updatedAt: bot.updatedAt ?? null,
    } : null,
    'riwayat-login.json': logins.map((entry) => ({
      waktu: entry.createdAt,
      waktuWIB: formatWIB(entry.createdAt),
      ip: entry.ip,
      device: deviceLabel(entry.device),
    })),
    'pairing.json': {
      username: user.username,
      status: pairing ? pairing.status : 'belum_pernah',
      nomorTertaut: pairing && pairing.maskedPhone ? pairing.maskedPhone : null,
      workerStatus: pairing ? pairing.workerStatus : 'stopped',
      terakhirUpdate: lastLog ? lastLog.createdAt : null,
      logTerakhir: lastLog ? {
        event: lastLog.event,
        ...(lastLog.details ? { details: lastLog.details } : {}),
        waktu: lastLog.createdAt,
        waktuWIB: formatWIB(lastLog.createdAt),
      } : null,
    },
  };
}

// Tulis ulang folder akun yang sidik-jarinya berubah (atau baru). Hanya
// folder akun yang berubah yang disentuh; akun lain tidak ditulis ulang.
async function syncChangedAccounts(before, snapshot) {
  for (const user of snapshot.users || []) {
    if (user.verified === false) continue;
    let files;
    try {
      files = buildAccountFiles(snapshot, user);
    } catch {
      continue;
    }
    if (before.get(user.id) === JSON.stringify(files)) continue;
    const dir = accountFolder(user.username);
    if (!dir) continue;
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.chmod(dir, 0o700).catch(() => {});
    for (const [name, value] of Object.entries(files)) {
      await atomicWriteJson(path.join(dir, name), value);
    }
  }
}

const ACCOUNT_MIRROR_FILES = ['akun.json', 'panel-sessions.json', 'bot.json', 'riwayat-login.json', 'pairing.json'];

async function removePendingAccountMirror(username) {
  const name = String(username || '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,23}$/.test(name)) return;
  // Pendaftaran pending belum punya peran di registry, jadi bersihkan
  // semua lokasi kandidat (DATA_AKUN/ADMIN, DATA_AKUN/MEMBER, DATA_AKUN
  // langsung, DATA_AKUN/DATA_ADMIN, dan DATA_ADMIN lama di luar) agar
  // tidak ada sisa mirror.
  const dirs = [...new Set([path.join(ADMIN_ACCOUNT_DIR, name), path.join(MEMBER_ACCOUNT_DIR, name), path.join(ACCOUNT_DIR, name), path.join(LEGACY_ADMIN_ACCOUNT_DIR, name), path.join(LEGACY_TOP_ADMIN_ACCOUNT_DIR, name)])];
  for (const dir of dirs) {
    for (const file of ACCOUNT_MIRROR_FILES) {
      try {
        await fs.rm(path.join(dir, file), { force: true });
      } catch (error) {
        console.warn('[panel] Tidak dapat membersihkan satu mirror pendaftaran pending:', error?.message || error);
      }
    }
    try {
      await fs.rm(dir, { recursive: false });
    } catch (error) {
      if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error?.code)) {
        console.warn('[panel] Folder pendaftaran pending masih berisi file lain; file tersebut dipertahankan.');
      }
    }
  }
}

async function migrateLegacyUnverifiedRegistrations() {
  const now = Date.now();
  const legacy = (store.users || []).filter((user) => user.verified === false);
  const pending = Array.isArray(store.pendingRegistrations) ? store.pendingRegistrations : [];
  const pendingIds = new Set(pending.map((user) => user.id));
  let changed = !Array.isArray(store.pendingRegistrations) || legacy.length > 0;

  for (const user of legacy) {
    if (!pendingIds.has(user.id)) {
      pending.push({ ...user, pendingExpiresAt: now + PENDING_REGISTRATION_TTL_MS });
      pendingIds.add(user.id);
    }
  }

  for (const user of pending) {
    if (!Number.isFinite(Number(user.pendingExpiresAt))) {
      user.pendingExpiresAt = now + PENDING_REGISTRATION_TTL_MS;
      changed = true;
    }
    if (!user.verification) {
      user.verification = createVerificationChallenge();
      changed = true;
    }
  }

  const expired = pending.filter((user) => Number(user.pendingExpiresAt) <= now);
  const activePending = pending.filter((user) => Number(user.pendingExpiresAt) > now);
  if (expired.length) changed = true;

  store.users = (store.users || []).filter((user) => user.verified !== false);
  store.pendingRegistrations = activePending;
  if (changed) await atomicWriteJson(STORE_FILE, store);
  for (const user of [...legacy, ...expired]) await removePendingAccountMirror(user.username);
}

async function initializeStore() {
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  await fs.chmod(DATA_DIR, 0o700).catch(() => {});
  await fs.mkdir(ACCOUNT_DIR, { recursive: true, mode: 0o700 });
  await fs.chmod(ACCOUNT_DIR, 0o700).catch(() => {});
  await fs.writeFile(path.join(ACCOUNT_DIR, '.gitkeep'), '', { flag: 'a' }).catch(() => {});
  await fs.mkdir(STALKER_DIR, { recursive: true, mode: 0o700 });
  await fs.chmod(STALKER_DIR, 0o700).catch(() => {});
  await fs.mkdir(VISIT_DIR, { recursive: true, mode: 0o700 });
  await fs.chmod(VISIT_DIR, 0o700).catch(() => {});
  try {
    const rawStalkers = await fs.readFile(STALKER_FILE, 'utf8');
    const parsedStalkers = JSON.parse(rawStalkers);
    if (parsedStalkers && Array.isArray(parsedStalkers.visitors)) stalkerStore = parsedStalkers;
    await fs.chmod(STALKER_FILE, 0o600).catch(() => {});
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await atomicWriteJson(STALKER_FILE, stalkerStore);
  }
  try {
    const rawVisits = await fs.readFile(VISIT_FILE, 'utf8');
    const parsedVisits = JSON.parse(rawVisits);
    if (parsedVisits && Array.isArray(parsedVisits.visitors)) visitStore = parsedVisits;
    await fs.chmod(VISIT_FILE, 0o600).catch(() => {});
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await atomicWriteJson(VISIT_FILE, visitStore);
  }
  try {
    const raw = await fs.readFile(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.users) || !Array.isArray(parsed.bots) || !Array.isArray(parsed.sessions)) {
      throw new Error('Persistent store format is invalid. Refusing to overwrite it.');
    }
    if (!Array.isArray(parsed.pairingLogs)) parsed.pairingLogs = [];
    if (!Array.isArray(parsed.loginHistory)) parsed.loginHistory = [];
    if (!Array.isArray(parsed.pendingRegistrations)) parsed.pendingRegistrations = [];
    if (!Array.isArray(parsed.deletedAccounts)) parsed.deletedAccounts = [];
    store = parsed;
    await fs.chmod(STORE_FILE, 0o600).catch(() => {});
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await atomicWriteJson(STORE_FILE, store);
  }

  // Obrolan: semua pesan chat tersimpan rapi di data/Obrolan.json (bukan di
  // store.json). Migrasi sekali saat file belum ada: pesan lama dari
  // store.chatMessages dipindah ke file ini.
  try {
    const rawChat = await fs.readFile(CHAT_FILE, 'utf8');
    const parsedChat = JSON.parse(rawChat);
    if (!parsedChat || !Array.isArray(parsedChat.messages)) throw new Error('Format Obrolan.json tidak valid.');
    chatStore = { messages: parsedChat.messages };
    await fs.chmod(CHAT_FILE, 0o600).catch(() => {});
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    chatStore = { messages: Array.isArray(store.chatMessages) ? store.chatMessages.slice(-CHAT_MAX_MESSAGES) : [] };
    await atomicWriteJson(CHAT_FILE, chatStore);
  }
  // Bersihkan field lama dari store.json bila masih ada (pesan sudah pindah ke Obrolan.json).
  if (Array.isArray(store.chatMessages)) {
    delete store.chatMessages;
    await atomicWriteJson(STORE_FILE, store);
  }

  const configuredSecret = process.env.SESSION_SECRET;
  let restoredSecret = null;
  try {
    restoredSecret = (await fs.readFile(RESTORE_SECRET_FILE, 'utf8')).trim();
    if (restoredSecret.length < 32 || restoredSecret.length > 512) throw new Error('Restored session secret is invalid.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (process.env.NODE_ENV === 'production' && !restoredSecret && (!configuredSecret || configuredSecret.length < 32)) {
    throw new Error('SESSION_SECRET must be set to at least 32 characters in production.');
  }
  if (restoredSecret) {
    sessionSecret = restoredSecret;
    process.env.SESSION_SECRET = restoredSecret;
  } else if (configuredSecret && configuredSecret.length >= 32) {
    sessionSecret = configuredSecret;
  } else {
    try {
      sessionSecret = (await fs.readFile(SECRET_FILE, 'utf8')).trim();
      if (sessionSecret.length < 32) throw new Error('Development session key is invalid.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      sessionSecret = randomBytes(48).toString('base64url');
      await fs.writeFile(SECRET_FILE, `${sessionSecret}\n`, { mode: 0o600, flag: 'wx' });
    }
  }
  await migrateLegacyUnverifiedRegistrations();
  await bootstrapAdmin();
}

async function bootstrapAdmin() {
  const email = normalizeEmail(process.env.BOOTSTRAP_ADMIN_EMAIL);
  const username = normalizeUsername(process.env.BOOTSTRAP_ADMIN_USERNAME);
  const displayName = String(process.env.BOOTSTRAP_ADMIN_NAME || 'Administrator').trim().slice(0, 40);
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || '';
  if (!email && !username && !password) return;
  if (!email || !username || password.length < PASSWORD_MIN) {
    console.warn('[panel] Admin bootstrap dilewati: isi BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_USERNAME, dan password minimal 12 karakter.');
    return;
  }

  const existingByEmail = store.users.find((u) => u.email === email);
  const existingByUsername = store.users.find((u) => u.username === username);
  if (existingByEmail || existingByUsername) {
    const exact = existingByEmail && existingByUsername && existingByEmail.id === existingByUsername.id;
    if (exact && existingByEmail.role !== 'admin') {
      const candidateHash = (await scrypt(password, existingByEmail.salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })).toString('hex');
      const passwordsMatch = constantTimeHexEqual(
        createHmac('sha256', sessionSecret).update(candidateHash).digest('hex'),
        createHmac('sha256', sessionSecret).update(existingByEmail.passwordHash).digest('hex'),
      );
      if (!passwordsMatch) {
        console.warn('[panel] Admin bootstrap tidak menaikkan akun lama karena kata sandi bootstrap tidak cocok.');
        return;
      }
      await mutate((next) => {
        const user = next.users.find((u) => u.id === existingByEmail.id);
        if (user) user.role = 'admin';
      });
    } else if (!exact) {
      console.warn('[panel] Admin bootstrap tidak mengubah akun karena email/username sudah dipakai akun berbeda.');
    }
    return;
  }

  const salt = randomBytes(16).toString('hex');
  const passwordHash = (await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })).toString('hex');
  await mutate((next) => {
    if (next.users.some((u) => u.email === email || u.username === username)) return;
      next.users.push({
        id: randomUUID(), username, email, displayName, avatar: 'avatar-01', role: 'admin', salt, passwordHash,
        createdAt: new Date().toISOString(), verified: true,
      });
  });
}

function setHeaders(res, isApi = false) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'");
  if (isApi) res.setHeader('Cache-Control', 'no-store');
}

function sendJson(res, status, body, extraHeaders = {}) {
  setHeaders(res, true);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders });
  res.end(JSON.stringify(body));
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}
function sendZip(res, status, archive, filename) {
  setHeaders(res, true);
  res.writeHead(status, {
    'Content-Type': 'application/zip',
    'Content-Length': archive.length,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store, private',
    Pragma: 'no-cache',
  });
  res.end(archive);
}
function parseCookies(req) {
  const result = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try { result[key] = decodeURIComponent(value); } catch { /* ignore malformed cookie */ }
  }
  return result;
}

function signatureFor(sid, userId, expiresAt) {
  return createHmac('sha256', sessionSecret).update(`${sid}.${userId}.${expiresAt}`).digest('hex');
}

function constantTimeHexEqual(a, b) {
  if (!/^[a-f0-9]{64}$/i.test(a) || !/^[a-f0-9]{64}$/i.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

function cookieHeader(value, maxAgeSeconds, req) {
  const forwardedProto = String(req?.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const secure = forwardedProto === 'https' || process.env.COOKIE_SECURE === 'true';
  return `readsw_session=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=${secure ? 'None' : 'Lax'}; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}

// RONDE 42: akun tersimpan per perangkat (browser). Cookie perangkat
// (readsw_device, HttpOnly, 1 tahun) mengenali browser ini; server menyimpan
// daftar akun yang pernah masuk dari perangkat itu di data/device-accounts.json
// (bukan di localStorage, supaya avatar + waktu terakhir masuk selalu akurat
// dan browser lain tidak ikut melihatnya). Cookie sesi tetap HttpOnly dan
// logout tetap mencabut sesi — yang tersimpan hanya "akun ini pernah masuk
// dari perangkat ini", bukan sandi atau token sesi.
const DEVICE_ACCOUNTS_FILE = path.join(DATA_DIR, 'device-accounts.json');
const DEVICE_COOKIE_TTL_SECONDS = 365 * 24 * 60 * 60;
const MAX_SAVED_ACCOUNTS = 5;

function deviceCookieHeader(value, maxAgeSeconds, req) {
  const forwardedProto = String(req?.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const secure = forwardedProto === 'https' || process.env.COOKIE_SECURE === 'true';
  return `readsw_device=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=${secure ? 'None' : 'Lax'}; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}

function deviceIdFromRequest(req) {
  const id = parseCookies(req).readsw_device || '';
  return /^[a-f0-9]{48}$/i.test(id) ? id : null;
}

function ensureDeviceId(req) {
  return deviceIdFromRequest(req) || randomBytes(24).toString('hex');
}

async function readDeviceAccounts() {
  try {
    const parsed = JSON.parse(await fs.readFile(DEVICE_ACCOUNTS_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

async function recordDeviceAccount(deviceId, userId) {
  if (!deviceId || !userId) return;
  const all = await readDeviceAccounts();
  const list = (all[deviceId] || []).filter((item) => item.userId !== userId);
  list.unshift({ userId, lastLoginAt: new Date().toISOString() });
  all[deviceId] = list.slice(0, MAX_SAVED_ACCOUNTS);
  await atomicWriteJson(DEVICE_ACCOUNTS_FILE, all);
}

async function removeDeviceAccount(deviceId, userId) {
  if (!deviceId || !userId) return false;
  const all = await readDeviceAccounts();
  const before = (all[deviceId] || []).length;
  const list = (all[deviceId] || []).filter((item) => item.userId !== userId);
  if (list.length === before) return false;
  if (list.length) all[deviceId] = list; else delete all[deviceId];
  await atomicWriteJson(DEVICE_ACCOUNTS_FILE, all);
  return true;
}

async function savedAccountsForDevice(deviceId) {
  if (!deviceId) return [];
  const all = await readDeviceAccounts();
  const accounts = [];
  for (const item of all[deviceId] || []) {
    const user = store.users.find((entry) => entry.id === item.userId);
    if (!user || isBannedAccount(user)) continue;
    accounts.push({ ...publicUser(user), lastLoginAt: item.lastLoginAt || null });
  }
  return accounts;
}

async function createSession(userId) {
  const sid = randomBytes(24).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  await mutate((next) => {
    next.sessions = next.sessions.filter((session) => session.expiresAt > Date.now());
    next.sessions.push({ sid, userId, expiresAt, lastSeen: Date.now() });
  });
  return `${sid}.${expiresAt}.${signatureFor(sid, userId, expiresAt)}`;
}

async function authenticatedUser(req) {
  const cookie = parseCookies(req).readsw_session || '';
  const parts = cookie.split('.');
  if (parts.length !== 3) return null;
  const [sid, expiresText, signature] = parts;
  const expiresAt = Number(expiresText);
  if (!/^[a-f0-9]{48}$/i.test(sid) || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) return null;
  const session = store.sessions.find((item) => item.sid === sid && item.expiresAt === expiresAt);
  if (!session) return null;
  if (!constantTimeHexEqual(signatureFor(sid, session.userId, expiresAt), signature)) return null;
  const user = store.users.find((item) => item.id === session.userId);
  return user && !isBannedAccount(user) ? user : null;
}

function clientKey(req) {
  return req.socket.remoteAddress || 'unknown-client';
}

// IP klien: entri pertama X-Forwarded-For (saat di belakang proxy), kalau tidak ada pakai alamat socket.
function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (forwarded) return forwarded.slice(0, 45);
  return req.socket.remoteAddress || 'unknown';
}

// Parser User-Agent kecil tanpa dependensi baru. Merek laptop (mis. Dell)
// umumnya TIDAK ada di User-Agent — jangan pernah ditebak; model hanya diisi
// bila UA memang membawanya (mis. kode model Android / iPhone / iPad).
function parseDevice(userAgent) {
  const ua = String(userAgent || '');
  let category = 'Desktop';
  if (/ipad|tablet|playbook|silk|kindle/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua))) category = 'Tablet';
  else if (/mobile|iphone|ipod|android.*mobile|blackberry|iemobile|opera mini/i.test(ua)) category = 'HP';
  let os = 'Tidak diketahui';
  let m;
  if ((m = ua.match(/Android\s+([\d.]+)/i))) os = `Android ${m[1]}`;
  else if (/iphone|ipad|ipod/i.test(ua) && (m = ua.match(/OS\s+([\d_]+)/i))) os = `iOS ${m[1].replace(/_/g, '.')}`;
  else if ((m = ua.match(/Windows NT\s+([\d.]+)/i))) os = `Windows ${m[1]}`;
  else if ((m = ua.match(/Mac OS X\s+([\d_]+)/i))) os = `macOS ${m[1].replace(/_/g, '.')}`;
  else if (/linux/i.test(ua)) os = 'Linux';
  let browser = 'Tidak diketahui';
  if ((m = ua.match(/Edg\/([\d.]+)/i))) browser = `Edge ${m[1]}`;
  else if ((m = ua.match(/OPR\/([\d.]+)/i))) browser = `Opera ${m[1]}`;
  else if ((m = ua.match(/SamsungBrowser\/([\d.]+)/i))) browser = `Samsung Internet ${m[1]}`;
  else if ((m = ua.match(/Chrome\/([\d.]+)/i))) browser = `Chrome ${m[1]}`;
  else if ((m = ua.match(/Firefox\/([\d.]+)/i))) browser = `Firefox ${m[1]}`;
  else if ((m = ua.match(/Version\/([\d.]+).*Safari/i))) browser = `Safari ${m[1]}`;
  let model = null;
  if (/iphone/i.test(ua)) model = 'iPhone';
  else if (/ipad/i.test(ua)) model = 'iPad';
  else if ((m = ua.match(/Android\s+[\d.]+;\s*([^;]+)/i))) {
    const candidate = m[1].split(/\s+Build\//i)[0].trim();
    if (candidate && !/^linux$/i.test(candidate)) model = candidate;
  }
  return { category, os, browser, model };
}

function deviceLabel(device) {
  if (!device || typeof device !== 'object') return 'Perangkat tidak diketahui';
  const parts = [device.category || 'Perangkat'];
  if (device.model) parts.push(device.model);
  if (device.os) parts.push(device.os);
  if (device.browser) parts.push(device.browser);
  return parts.join(' · ');
}

// Catat login berhasil: hanya IP + User-Agent + perangkat turunan. Kata sandi tidak pernah dicatat.
async function recordLogin(userId, req, sid = null) {
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 512);
  const device = parseDevice(userAgent);
  await mutate((next) => {
    if (!Array.isArray(next.loginHistory)) next.loginHistory = [];
    next.loginHistory.push({
      id: randomUUID(),
      userId,
      sid,
      ip: clientIp(req),
      userAgent,
      device,
      createdAt: new Date().toISOString(),
    });
    if (next.loginHistory.length > 500) next.loginHistory.splice(0, next.loginHistory.length - 500);
  });
}

function allowRateLimit(key, max, windowMs) {
  const now = Date.now();
  if (rateLimits.size > 5000) {
    for (const [name, entry] of rateLimits) if (entry.resetAt <= now) rateLimits.delete(name);
  }
  const old = rateLimits.get(key);
  if (!old || old.resetAt <= now) {
    rateLimits.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  old.count += 1;
  return old.count <= max;
}

function checkOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (String(req.headers['sec-fetch-site'] || '').toLowerCase() === 'same-origin') return true;
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || (req.socket.encrypted ? 'https' : 'http');
  const forwardedHosts = [req.headers['x-forwarded-host'], req.headers.host, req.headers['x-original-host']]
    .flatMap((value) => String(value || '').split(','))
    .map((value) => value.trim())
    .filter(Boolean);
  try {
    const parsed = new URL(origin);
    return [protocol, 'https'].includes(parsed.protocol.slice(0, -1)) && forwardedHosts.includes(parsed.host);
  } catch {
    return false;
  }
}

async function readJson(req) {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    const error = new Error('Permintaan harus menggunakan JSON.');
    error.status = 415;
    throw error;
  }
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      const error = new Error('Isi permintaan terlalu besar.');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    const error = new Error('Format JSON tidak valid.');
    error.status = 400;
    throw error;
  }
}

async function readBinaryBody(req, maxBytes = MAX_BACKUP_UPLOAD_BYTES) {
  const declaredLength = Number(req.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    const error = new Error('Arsip backup melewati batas ukuran maksimum 80 MiB.');
    error.status = 413;
    throw error;
  }
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      const error = new Error('Arsip backup melewati batas ukuran maksimum 80 MiB.');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!total) {
    const error = new Error('File ZIP kosong.');
    error.status = 400;
    throw error;
  }
  return Buffer.concat(chunks, total);
}

function validateRegistration(body) {
  const username = normalizeUsername(body.username);
  const displayName = String(body.displayName || username).trim();
  const email = normalizeEmail(body.email);
  const password = String(body.password || '');
  if (displayName.length < 2 || displayName.length > 40) return { error: 'Nama tampilan harus 2–40 karakter.' };
  if (!/^[a-z0-9][a-z0-9._-]{2,23}$/.test(username)) return { error: 'Username harus 3–24 karakter: huruf, angka, titik, garis bawah, atau tanda hubung.' };
  if (['admin', 'administrator', 'root', 'support', 'system'].includes(username)) return { error: 'Username tersebut tidak tersedia.' };
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { error: 'Alamat email tidak valid.' };
  if (password.length < PASSWORD_MIN || password.length > 128) return { error: `Kata sandi harus ${PASSWORD_MIN}–128 karakter.` };
  // Peran dipilih di formulir daftar; selain 'admin' selalu jadi member.
  // 'admin' saja belum cukup — kode akses tetap diminta setelah verifikasi.
  const role = body.role === 'admin' ? 'admin' : 'user';
  return { displayName, username, email, password, role };
}

function normalizeStorySettings(value, mode, fallback = null) {
  const defaults = {
    autoReaction: mode === 'readonly_readsw',
    delayMinSeconds: 1,
    delayMaxSeconds: 20,
    randomDelay: true,
    emojiPoolVersion: 2,
    emojiOptions: ['💚'],
    emojiPool: ['💚'],
  };
  if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) {
    return { error: 'Pengaturan story tidak valid.' };
  }
  const saved = { ...(fallback && typeof fallback === 'object' ? fallback : {}), ...(value || {}) };
  const isLegacyDefaultHeart = saved.emojiPoolVersion !== 2
    && !Array.isArray(saved.emojiOptions)
    && Array.isArray(saved.emojiPool)
    && saved.emojiPool.length === 1
    && saved.emojiPool[0] === '❤️';
  const source = { ...defaults, ...saved };
  const min = Number(source.delayMinSeconds);
  const max = Number(source.delayMaxSeconds);
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max > 20 || min > max) {
    return { error: 'Delay harus angka bulat 1–20 detik; minimum tidak boleh melebihi maksimum.' };
  }
  if (typeof source.autoReaction !== 'boolean') return { error: 'Pilihan reaksi otomatis tidak valid.' };
  const rawOptions = isLegacyDefaultHeart ? ['💚'] : Array.isArray(source.emojiOptions) ? source.emojiOptions : source.emojiPool;
  const rawPool = isLegacyDefaultHeart ? ['💚'] : source.emojiPool;
  const isSingleEmoji = (emoji) => {
    if (typeof emoji !== 'string' || emoji.length > 32 || emoji.trim() !== emoji || /[\p{Letter}\p{White_Space}]/u.test(emoji)) return false;
    const parts = [...emojiGraphemes.segment(emoji)];
    return parts.length === 1 && /[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\u20e3]/u.test(emoji);
  };
  if (!Array.isArray(rawOptions) || rawOptions.length > MAX_STORY_EMOJIS || rawOptions.some((emoji) => !isSingleEmoji(emoji))) {
    return { error: `Tambahkan maksimal ${MAX_STORY_EMOJIS} emoji Unicode yang valid, satu emoji per item.` };
  }
  if (!Array.isArray(rawPool) || rawPool.length > MAX_STORY_EMOJIS || rawPool.some((emoji) => !isSingleEmoji(emoji))) {
    return { error: 'Daftar emoji reaksi tidak valid.' };
  }
  const emojiOptions = [...new Set(rawOptions)];
  const emojiPool = [...new Set(rawPool)];
  if (emojiPool.some((emoji) => !emojiOptions.includes(emoji))) return { error: 'Emoji aktif harus berasal dari daftar akun ini.' };
  const autoReaction = mode === 'readonly_readsw' && source.autoReaction;
  if (autoReaction && emojiPool.length === 0) return { error: 'Pilih minimal satu emoji untuk mengaktifkan reaksi.' };
  return { autoReaction, delayMinSeconds: min, delayMaxSeconds: max, randomDelay: true, emojiPoolVersion: 2, emojiOptions, emojiPool };
}

function validateBotSettings(body) {
  const requestedMode = String(body.mode || '');
  const label = String(body.label || 'Bot saya').trim();
  const legacyOnline24 = requestedMode === 'online24';
  const mode = legacyOnline24 ? 'readonly' : requestedMode;
  const online24 = legacyOnline24 || body.online24 === true;
  if (!['readonly', 'readonly_readsw'].includes(mode)) return { error: 'Pilih mode Read Only atau Read Only + ReadSW.' };
  if (label.length < 2 || label.length > 32) return { error: 'Nama bot harus 2–32 karakter.' };
  const storySettings = body.storySettings === undefined ? undefined : normalizeStorySettings(body.storySettings, mode);
  if (storySettings?.error) return storySettings;
  return { mode, online24, label, storySettings };
}

function botForUser(userId) {
  return store.bots.find((bot) => bot.userId === userId) || null;
}

function botModeLabel(bot) {
  if (!bot) return 'Mode belum dipilih';
  const base = bot.mode === 'readonly_readsw'
    ? 'ReadSW + ReactionSW'
    : bot.mode === 'readonly' || bot.mode === 'online24'
      ? 'ReadSW'
      : 'Mode belum dipilih';
  return bot.online24 === true && base !== 'Mode belum dipilih' ? `${base} + Online 24 Jam` : base;
}

async function readAccountFeatureStats(user) {
  const bot = botForUser(user.id);
  const storyModeEnabled = Boolean(bot && ['readonly', 'readonly_readsw', 'online24'].includes(bot.mode));
  const result = {
    modeLabel: botModeLabel(bot),
    storyReadCount: 0,
    reactionCount: 0,
    features: {
      readSW: storyModeEnabled,
      reactionSW: Boolean(bot && bot.mode === 'readonly_readsw' && bot.storySettings?.autoReaction !== false),
      online24: Boolean(bot && bot.online24 === true),
    },
  };
  const folder = accountFolder(user.username);
  if (!folder) return result;
  const statsFile = path.join(folder, 'ReadSwReactionsw', 'ceksw', 'swstats.json');
  try {
    const stats = JSON.parse(await fs.readFile(statsFile, 'utf8'));
    for (const [key, value] of Object.entries(stats || {})) {
      if (key === '_emojiStats' || !value || typeof value !== 'object') continue;
      result.storyReadCount += Math.max(0, Number(value.reads) || 0);
      result.reactionCount += Math.max(0, Number(value.reactions) || 0);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn(`[panel] Gagal membaca statistik ReadSW ${user.username}:`, error?.message || error);
  }
  return result;
}

async function appendPairingLog(userId, event, details = null) {
  await mutate((next) => {
    if (!Array.isArray(next.pairingLogs)) next.pairingLogs = [];
    const safeDetails = sanitizeStoryLogDetails(details);
    next.pairingLogs.push({ id: randomUUID(), userId, event: String(event || '').slice(0, 240), ...(safeDetails ? { details: safeDetails } : {}), createdAt: new Date().toISOString() });
    if (next.pairingLogs.length > 5000) next.pairingLogs.splice(0, next.pairingLogs.length - 5000);
  });
}

const pairingManager = createPairingManager({
  dataDir: DATA_DIR,
  appendLog: appendPairingLog,
  getAuthDir: (userId) => accountFolder(store.users.find((user) => user.id === userId)?.username),
  ensureDefaultBot: async (userId) => {
    if (botForUser(userId)) return false;
    const storySettings = normalizeStorySettings(undefined, 'readonly_readsw');
    return mutate((next) => createDefaultBotRecord(next.bots, userId, storySettings) !== null);
  },
  getStorySettings: (userId) => {
    const bot = botForUser(userId);
    if (!bot) return null;
    const mode = bot.mode === 'online24' ? 'readonly' : bot.mode;
    const storySettings = normalizeStorySettings(bot.storySettings, mode);
    return { mode, storySettings: storySettings.error ? normalizeStorySettings(undefined, mode) : storySettings };
  },
  getOnline24: (userId) => botForUser(userId)?.online24 === true || botForUser(userId)?.mode === 'online24',
  getWorkerAutoStart: (userId) => botForUser(userId)?.autoStart === true,
  setWorkerAutoStart: async (userId, enabled) => {
    await mutate((next) => {
      const bot = next.bots.find((item) => item.userId === userId);
      if (bot) bot.autoStart = enabled === true;
    });
  },
});

const ACCOUNT_FOLDER_PATTERN = /^[a-z0-9][a-z0-9._-]{2,23}$/;
const ACCOUNT_DATA_SEGMENT_PATTERN = /^[A-Za-z0-9._-]{1,180}$/;
function readTelegramConfig() {
  // Urutan sumber: env var, lalu data/telegram.json (tidak masuk git),
  // lalu bagian telegram di config.json. Token bot TIDAK disimpan di
  // config.json karena repo ini publik — token di sana bisa dipakai
  // siapa pun untuk mengirim pesan sebagai bot.
  const fromEnv = {
    botToken: (process.env.TELEGRAM_BOT_TOKEN || '').trim(),
    chatId: (process.env.TELEGRAM_CHAT_ID || '').trim(),
  };
  if (fromEnv.botToken && fromEnv.chatId) return fromEnv;
  try {
    const parsed = JSON.parse(fsSync.readFileSync(TELEGRAM_CONFIG_FILE, 'utf8'));
    const botToken = String(parsed?.botToken || '').trim();
    const chatId = String(parsed?.chatId || '').trim();
    if (botToken && chatId) return { botToken, chatId };
  } catch { /* Lanjut ke config.json. */ }
  try {
    const parsed = JSON.parse(fsSync.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
    return {
      botToken: String(parsed?.telegram?.botToken || '').trim(),
      chatId: String(parsed?.telegram?.chatId || '').trim(),
    };
  } catch { return { botToken: '', chatId: '' }; }
}

async function sendBackupToTelegram(archive, filename) {
  const { botToken, chatId } = readTelegramConfig();
  if (!botToken || !chatId) throw backupFailure('Bot Telegram belum diatur. Isi token bot dan chat ID di data/telegram.json di server.', 503);
  if (archive.length > TELEGRAM_MAX_BYTES) throw backupFailure('Ukuran backup melewati batas 50 MB Telegram.', 413);
  const stamp = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('caption', `Backup ReadSW Console — ${stamp} — ${backupBytesLabel(archive.length)} — ${filename}`);
  form.append('document', new Blob([archive], { type: 'application/zip' }), filename);
  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
      method: 'POST', body: form, signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw backupFailure('Tidak dapat menghubungi Telegram. Coba lagi nanti.', 502);
  }
  let body = {};
  try { body = await response.json(); } catch { /* Pakai pesan umum. */ }
  if (!response.ok || !body.ok) {
    const reason = String(body?.description || '');
    if (/chat not found/i.test(reason)) throw backupFailure('Bot belum di-start. Buka bot di Telegram dan kirim /start dulu, lalu coba lagi.', 400);
    if (/blocked/i.test(reason)) throw backupFailure('Bot diblokir di Telegram. Buka blokirnya dulu, lalu coba lagi.', 400);
    if (/unauthorized|not found/i.test(reason)) throw backupFailure('Token bot Telegram tidak valid. Periksa token di data/telegram.json.', 400);
    throw backupFailure(reason ? `Telegram menolak pengiriman: ${reason}` : 'Telegram menolak pengiriman.', 502);
  }
  return { chatId, bytes: archive.length };
}

function backupBytesLabel(bytes) {
  const value = Number(bytes) || 0;
  return value >= 1024 * 1024 ? `${(value / (1024 * 1024)).toFixed(1)} MiB` : `${Math.ceil(value / 1024)} KiB`;
}

function backupFailure(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}
function isAllowedBackupPath(value) {
  if (value === 'panel/store.json' || value === 'DATA_STALKER/visitors.json' || value === 'DATA_KUNJUNGAN/visitors.json') return true;
  if (typeof value !== 'string' || value.includes('\\') || value.includes('\0')) return false;
  const parts = value.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return false;
  if (parts[0] !== 'DATA_AKUN' && parts[0] !== 'DATA_ADMIN') return false;
  if (parts.length === 2 && parts[1] === '.gitkeep') return true;
  // Subfolder peran di dalam DATA_AKUN: ADMIN, MEMBER, atau DATA_ADMIN
  // lama — username ada di segmen ketiga; akun langsung di DATA_AKUN
  // dan admin lama di DATA_ADMIN luar tetap diizinkan.
  const roleFolders = new Set(['ADMIN', 'MEMBER', 'DATA_ADMIN']);
  let userIndex = 1;
  if (parts[0] === 'DATA_AKUN' && roleFolders.has(parts[1])) {
    if (parts.length === 3 && parts[2] === '.gitkeep') return true;
    userIndex = 2;
  }
  if (parts.length < userIndex + 2 || !ACCOUNT_FOLDER_PATTERN.test(parts[userIndex])) return false;
  if (!parts.slice(userIndex + 1).every((part) => ACCOUNT_DATA_SEGMENT_PATTERN.test(part))) return false;
  const filename = parts.at(-1);
  // File pemulihan sesi (.good = sesi terakhir yang bagus, .bak =
  // salinan berkala) adalah bagian dari data akun dan wajib ikut
  // ter-backup; tanpa keduanya, ekspor backup gagal begitu ada akun
  // yang pernah tersambung WhatsApp.
  return filename === '.gitkeep' || /\.(json|webp|upload|txt|bin|good|bak)$/i.test(filename);
}

async function collectBackupPayload() {
  const files = [];
  let totalBytes = 0;
  const addFile = async (archivePath, filename) => {
    const stat = await fs.lstat(filename);
    if (stat.isSymbolicLink() || !stat.isFile()) throw backupFailure('Backup dihentikan karena ditemukan file data non-reguler.', 409);
    if (!isAllowedBackupPath(archivePath)) throw backupFailure('Nama file data akun tidak didukung untuk backup.', 409);
    if (stat.size > MAX_BACKUP_DATA_BYTES || totalBytes + stat.size > MAX_BACKUP_DATA_BYTES) {
      throw backupFailure('Total data melewati batas backup 50 MiB.', 413);
    }
    const data = await fs.readFile(filename);
    totalBytes += data.length;
    files.push({ path: archivePath, data: data.toString('base64') });
    if (files.length > 10_000) throw backupFailure('Jumlah file backup melewati batas maksimum.', 413);
  };
  await addFile('panel/store.json', STORE_FILE);
  const walkAccount = async (directory, prefix, relative = '') => {
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      if (entry.name === '.readsw-whatsapp-session.lock' || entry.name === '.readsw-restore.lock'
        || entry.name.includes('.tmp') || entry.name.includes('.stale.') || entry.name.includes('.MATI-')) continue;
      if (!ACCOUNT_DATA_SEGMENT_PATTERN.test(entry.name)) throw backupFailure('Nama file/folder akun tidak didukung untuk backup.', 409);
      const absolute = path.join(directory, entry.name);
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      const stat = await fs.lstat(absolute);
      if (stat.isSymbolicLink()) throw backupFailure('Backup dihentikan karena ditemukan symlink pada data akun.', 409);
      if (stat.isDirectory()) {
        await walkAccount(absolute, prefix, rel);
      } else if (stat.isFile()) {
        await addFile(`${prefix}/${rel}`, absolute);
      } else {
        throw backupFailure('Backup dihentikan karena ditemukan jenis file akun yang tidak didukung.', 409);
      }
    }
  };
  await walkAccount(ACCOUNT_DIR, 'DATA_AKUN');
  // Folder admin lama di luar DATA_AKUN ikut dibackup bila masih ada
  // (transisi restrukturisasi); semua susunan bersarang di dalam
  // DATA_AKUN sudah tercakup oleh walk di atas.
  await walkAccount(LEGACY_TOP_ADMIN_ACCOUNT_DIR, 'DATA_ADMIN');
  for (const [archivePath, filename, fallback] of [
    ['DATA_STALKER/visitors.json', STALKER_FILE, { visitors: [] }],
    ['DATA_KUNJUNGAN/visitors.json', VISIT_FILE, { visitors: [] }],
  ]) {
    try { await addFile(archivePath, filename); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const data = Buffer.from(`${JSON.stringify(fallback)}\n`);
      totalBytes += data.length;
      files.push({ path: archivePath, data: data.toString('base64') });
    }
  }
  return {
    format: 'ReadSW-Console-Data',
    version: 1,
    createdAt: new Date().toISOString(),
    sessionSecret,
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

function validateBackupPayload(payload) {
  if (!payload || payload.format !== 'ReadSW-Console-Data' || payload.version !== 1 || !Array.isArray(payload.files)) {
    throw backupFailure('Isi backup bukan data ReadSW Console yang didukung.');
  }
  if (typeof payload.sessionSecret !== 'string' || payload.sessionSecret.length < 32 || payload.sessionSecret.length > 512
    || /[\u0000-\u001f\u007f]/.test(payload.sessionSecret)) {
    throw backupFailure('Backup tidak memiliki session secret yang valid.');
  }
  if (payload.files.length < 1 || payload.files.length > 10_000) throw backupFailure('Jumlah file dalam backup tidak valid.');
  const files = new Map();
  let totalBytes = 0;
  for (const entry of payload.files) {
    if (!entry || !isAllowedBackupPath(entry.path) || typeof entry.data !== 'string' || files.has(entry.path)) {
      throw backupFailure('Backup mengandung path atau entri file yang tidak valid.');
    }
    const data = Buffer.from(entry.data, 'base64');
    if (data.toString('base64') !== entry.data || data.length > MAX_BACKUP_DATA_BYTES || totalBytes + data.length > MAX_BACKUP_DATA_BYTES) {
      throw backupFailure('Encoding atau ukuran file dalam backup tidak valid.');
    }
    totalBytes += data.length;
    files.set(entry.path, data);
  }
  const storeBytes = files.get('panel/store.json');
  if (!storeBytes) throw backupFailure('Backup tidak memiliki database akun panel.');
  let restoredStore;
  try { restoredStore = JSON.parse(storeBytes.toString('utf8')); }
  catch { throw backupFailure('Database akun dalam backup rusak.'); }
  if (!restoredStore || !Array.isArray(restoredStore.users) || !Array.isArray(restoredStore.bots)
    || !Array.isArray(restoredStore.sessions) || !Array.isArray(restoredStore.loginHistory)
    || !Array.isArray(restoredStore.pairingLogs) || restoredStore.users.length > 10_000) {
    throw backupFailure('Struktur database akun dalam backup tidak valid.');
  }
  if (!Array.isArray(restoredStore.pendingRegistrations)) restoredStore.pendingRegistrations = [];
  const userIds = new Set();
  const usernames = new Set();
  let adminCount = 0;
  for (const user of restoredStore.users) {
    if (!user || typeof user.id !== 'string' || !user.id || user.id.length > 200
      || typeof user.username !== 'string' || !ACCOUNT_FOLDER_PATTERN.test(user.username)
      || typeof user.role !== 'string' || user.role.length > 32
      || userIds.has(user.id) || usernames.has(user.username)) {
      throw backupFailure('Backup memiliki akun dengan identitas tidak valid atau duplikat.');
    }
    userIds.add(user.id);
    usernames.add(user.username);
    if (user.role === 'admin') adminCount += 1;
  }
  if (!adminCount) throw backupFailure('Pemulihan ditolak karena backup tidak memiliki akun admin.');
  const readVisitorStore = (name) => {
    const bytes = files.get(name);
    if (!bytes) return { visitors: [] };
    let value;
    try { value = JSON.parse(bytes.toString('utf8')); }
    catch { throw backupFailure(`File ${name} di dalam backup rusak.`); }
    if (!value || !Array.isArray(value.visitors)) throw backupFailure(`Struktur ${name} tidak valid.`);
    return value;
  };
  return {
    files,
    store: restoredStore,
    sessionSecret: payload.sessionSecret,
    stalkerStore: readVisitorStore('DATA_STALKER/visitors.json'),
    visitStore: readVisitorStore('DATA_KUNJUNGAN/visitors.json'),
  };
}

async function savePreRestoreArchive(archive) {
  await fs.mkdir(BACKUP_SNAPSHOT_DIR, { recursive: true, mode: 0o700 });
  await fs.chmod(BACKUP_SNAPSHOT_DIR, 0o700).catch(() => {});
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `pre-restore-${stamp}-${randomUUID().slice(0, 8)}.zip`;
  await fs.writeFile(path.join(BACKUP_SNAPSHOT_DIR, filename), archive, { mode: 0o600, flag: 'wx' });
  const snapshots = [];
  for (const name of await fs.readdir(BACKUP_SNAPSHOT_DIR)) {
    if (!/^pre-restore-[0-9T-]+-[a-f0-9]{8}\.zip$/.test(name)) continue;
    const stat = await fs.stat(path.join(BACKUP_SNAPSHOT_DIR, name));
    snapshots.push({ name, mtimeMs: stat.mtimeMs });
  }
  snapshots.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const old of snapshots.slice(3)) await fs.rm(path.join(BACKUP_SNAPSHOT_DIR, old.name), { force: true });
  return filename;
}

async function assertNoOtherAccountSessionLocks() {
  const inspect = async (directory) => {
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await inspect(absolute);
      else if (entry.name === '.readsw-whatsapp-session.lock') {
        let owner;
        try { owner = JSON.parse(await fs.readFile(absolute, 'utf8')); }
        catch { throw backupFailure('Pemulihan ditolak: ditemukan lock sesi yang tidak dapat diverifikasi.', 409); }
        const pid = Number(owner.pid);
        if (owner.hostname !== os.hostname() || !Number.isSafeInteger(pid) || pid <= 0) {
          throw backupFailure('Hentikan server panel lain yang mungkin memakai folder sesi WhatsApp ini, lalu ulangi restore.', 409);
        }
        try { process.kill(pid, 0); }
        catch (error) {
          if (error.code === 'ESRCH') { await fs.rm(absolute, { force: true }); continue; }
          throw backupFailure('Hentikan server panel lain yang mungkin memakai folder sesi WhatsApp ini, lalu ulangi restore.', 409);
        }
        throw backupFailure('Hentikan server panel lain yang masih memakai sesi WhatsApp sebelum memulihkan backup.', 409);
      }
    }
  };
  await inspect(ACCOUNT_DIR);
  // inspect(ACCOUNT_DIR) sudah menelusuri semua subfolder bersarang;
  // folder admin lama di luar DATA_AKUN diperiksa terpisah.
  await inspect(LEGACY_TOP_ADMIN_ACCOUNT_DIR);
}

async function installBackupPayload(validated, restoreLock) {
  const id = randomUUID();
  const stageAccount = await fs.mkdtemp(path.join(ROOT, `.DATA_AKUN-stage-${id}-`));
  await fs.chmod(stageAccount, 0o700).catch(() => {});
  const stageAdminAccount = await fs.mkdtemp(path.join(ROOT, `.DATA_ADMIN-stage-${id}-`));
  await fs.chmod(stageAdminAccount, 0o700).catch(() => {});
  let stagedAdminFiles = 0;
  const stagedFiles = [];
  const targets = [];
  try {
    let storeStage;
    let stalkerStage;
    let visitStage;
    let secretStage;
    for (const [archivePath, data] of validated.files) {
      let target;
      if (archivePath === 'panel/store.json') {
        storeStage = path.join(DATA_DIR, `.store.restore-${id}`);
        target = storeStage;
      } else if (archivePath === 'DATA_STALKER/visitors.json') {
        stalkerStage = path.join(STALKER_DIR, `.visitors.restore-${id}`);
        target = stalkerStage;
      } else if (archivePath === 'DATA_KUNJUNGAN/visitors.json') {
        visitStage = path.join(VISIT_DIR, `.visitors.restore-${id}`);
        target = visitStage;
      } else if (archivePath.startsWith('DATA_ADMIN/')) {
        stagedAdminFiles += 1;
        target = path.join(stageAdminAccount, ...archivePath.split('/').slice(1));
      } else if (archivePath.startsWith('DATA_AKUN/DATA_ADMIN/')) {
        // Arsip dari layout bersarang b91ff1f — pulihkan ke folder ADMIN
        // yang baru, bukan ke lokasi lama.
        stagedAdminFiles += 1;
        target = path.join(stageAdminAccount, ...archivePath.split('/').slice(2));
      } else {
        target = path.join(stageAccount, ...archivePath.split('/').slice(1));
      }
      await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await fs.writeFile(target, data, { mode: 0o600, flag: 'wx' });
      stagedFiles.push(target);
    }
    if (!storeStage) throw backupFailure('Database akun tidak dapat dipentaskan.');
    if (!stalkerStage) {
      stalkerStage = path.join(STALKER_DIR, `.visitors.restore-${id}`);
      await fs.writeFile(stalkerStage, '{"visitors":[]}\n', { mode: 0o600, flag: 'wx' });
      stagedFiles.push(stalkerStage);
    }
    if (!visitStage) {
      visitStage = path.join(VISIT_DIR, `.visitors.restore-${id}`);
      await fs.writeFile(visitStage, '{"visitors":[]}\n', { mode: 0o600, flag: 'wx' });
      stagedFiles.push(visitStage);
    }
    try { await fs.access(path.join(stageAccount, '.gitkeep')); }
    catch { await fs.writeFile(path.join(stageAccount, '.gitkeep'), '', { mode: 0o600, flag: 'wx' }); }
    if (stagedAdminFiles > 0) {
      try { await fs.access(path.join(stageAdminAccount, '.gitkeep')); }
      catch { await fs.writeFile(path.join(stageAdminAccount, '.gitkeep'), '', { mode: 0o600, flag: 'wx' }); }
    }
    secretStage = path.join(DATA_DIR, `.restore-secret.restore-${id}`);
    await fs.writeFile(secretStage, `${validated.sessionSecret}\n`, { mode: 0o600, flag: 'wx' });
    stagedFiles.push(secretStage);
    targets.push(
      { target: ACCOUNT_DIR, staged: stageAccount, directory: true },
      { target: STORE_FILE, staged: storeStage },
      { target: STALKER_FILE, staged: stalkerStage },
      { target: VISIT_FILE, staged: visitStage },
      { target: RESTORE_SECRET_FILE, staged: secretStage },
    );
    // Backup lama tidak punya entri DATA_ADMIN — jangan sentuh folder admin
    // yang sedang berjalan bila arsip tidak membawanya.
    if (stagedAdminFiles > 0) {
      targets.push({ target: ADMIN_ACCOUNT_DIR, staged: stageAdminAccount, directory: true });
    }
    const changed = [];
    try {
      for (const item of targets) {
        await fs.mkdir(path.dirname(item.target), { recursive: true, mode: 0o700 });
        item.previous = `${item.target}.before-restore-${id}`;
        try {
          await fs.rename(item.target, item.previous);
          item.hadPrevious = true;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        changed.push(item);
        await fs.rename(item.staged, item.target);
        item.installed = true;
      }
    } catch (error) {
      for (const item of changed.reverse()) {
        if (item.installed) await fs.rm(item.target, { recursive: true, force: true }).catch(() => {});
        if (item.hadPrevious) await fs.rename(item.previous, item.target).catch(() => {});
      }
      throw error;
    }
    for (const item of targets) if (item.hadPrevious) await fs.rm(item.previous, { recursive: true, force: true });
  } finally {
    for (const staged of stagedFiles) await fs.rm(staged, { recursive: true, force: true }).catch(() => {});
    await fs.rm(stageAccount, { recursive: true, force: true }).catch(() => {});
    await fs.rm(stageAdminAccount, { recursive: true, force: true }).catch(() => {});
  }
}

async function drainDataWrites() {
  await Promise.all([writeQueue, stalkerWriteQueue, visitWriteQueue]);
}

async function resumeStoredAccounts() {
  let attempted = 0;
  let errors = 0;
  for (const account of store.users) {
    try {
      const result = await pairingManager.resume(account.id);
      if (result && result.status !== 'stopped') attempted += 1;
    } catch (error) {
      if (error instanceof PairingError && [404, 409].includes(error.status)) {
        // Jangan diam-diam lewati: resume 20:39 WIB pernah melewati jeffv2
        // tanpa jejak, padahal sesinya masih bagus. Kemungkinan lock akun
        // masih dipegang proses panel lama yang sedang mati — coba sekali
        // lagi setelah jeda singkat, dan catat kalau tetap dilewati.
        await new Promise((resolve) => setTimeout(resolve, 5000));
        try {
          const retry = await pairingManager.resume(account.id);
          if (retry && retry.status !== 'stopped') attempted += 1;
          continue;
        } catch (retryError) {
          if (retryError instanceof PairingError && [404, 409].includes(retryError.status)) {
            await appendPairingLog(account.id, `Sesi WhatsApp tersimpan dilewati saat resume awal (kode ${retryError.status}); tekan Sambungkan ulang untuk mencoba lagi.`).catch(() => {});
            continue;
          }
          errors += 1;
          await appendPairingLog(account.id, 'Sesi WhatsApp tersimpan belum dapat dipulihkan setelah restore.').catch(() => {});
          continue;
        }
      }
      errors += 1;
      await appendPairingLog(account.id, 'Sesi WhatsApp tersimpan belum dapat dipulihkan setelah restore.').catch(() => {});
    }
  }
  return { resumed: attempted, errors };
}

async function handleApi(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  if (req.method !== 'GET' && !checkOrigin(req)) return sendError(res, 403, 'Asal permintaan tidak diizinkan.');
  if (restoreInProgress && route !== 'POST /api/admin/backup/restore') {
    return sendError(res, 503, 'Pemulihan backup sedang berlangsung. Coba lagi setelah selesai.');
  }
  if (restoreInProgress && route === 'POST /api/admin/backup/restore') {
    return sendError(res, 409, 'Pemulihan backup lain sedang berjalan.');
  }

  if (route === 'GET /api/health') return sendJson(res, 200, { ok: true, name: 'ReactionSw', pairing: 'enabled', botRunner: 'per_account' });

  if (route === 'GET /api/public/account-stats') {
    const users = Array.isArray(store.users) ? store.users : [];
    const botStats = pairingManager.getPublicStats();
    // Aktif artinya bot akun itu sedang berjalan, bukan sekadar akun terverifikasi; sebelumnya hitungan memakai verified sehingga Belum aktif selalu 0 walau ada bot yang berhenti.
    const active = users.filter((item) => pairingManager.getState(item.id)?.workerStatus === 'running').length;
    const inactive = users.length - active;
    const admin = users.filter((item) => item.role === 'admin').length;
    const member = users.length - admin;
    return sendJson(res, 200, { total: users.length, active, inactive, admin, member, ...botStats, updatedAt: new Date().toISOString() });
  }

  if (route === 'GET /api/public/live-stats') {
    return sendJson(res, 200, {
      online: liveOnlineCount(),
      stalker: liveStalkerCount(),
      visits: uniqueVisitCount(),
      updatedAt: new Date().toISOString(),
    });
  }

  if (route === 'POST /api/visitor/heartbeat') {
    await trackVisit(req);
    const cookies = parseCookies(req);
    const visitorId = cookies.readsw_visitor || randomBytes(24).toString('hex');
    const user = await authenticatedUser(req);
    if (user) await removeStalker(visitorId);
    else await touchStalker(req, visitorId);
    return sendJson(res, 200, {
      online: liveOnlineCount(),
      stalker: liveStalkerCount(),
      visits: uniqueVisitCount(),
    }, cookies.readsw_visitor ? {} : { 'Set-Cookie': stalkerCookieHeader(visitorId) });
  }

  if (route === 'GET /api/public/server-status') {
    const processMemory = process.memoryUsage();
    const systemTotal = os.totalmem();
    const systemFree = os.freemem();
    const systemUsed = Math.max(0, systemTotal - systemFree);
    const loadAverages = os.loadavg();
    const cpuModelRaw = os.cpus()[0]?.model?.trim() || null;
    const cpuModel = cpuModelRaw && cpuModelRaw.toLowerCase() !== 'unknown' ? cpuModelRaw : null;
    let disk = null;
    try {
      const diskStats = fsSync.statfsSync('/');
      const blockSize = Number(diskStats.bsize || 0);
      const diskTotal = Number(diskStats.blocks || 0) * blockSize;
      const diskFree = Number(diskStats.bavail || 0) * blockSize;
      if (diskTotal > 0) disk = { totalBytes: diskTotal, freeBytes: diskFree, usedPercent: Number(((1 - diskFree / diskTotal) * 100).toFixed(1)) };
    } catch { /* Disk tidak terbaca di host ini; kolom tampil strip. */ }
    return sendJson(res, 200, {
      status: 'online',
      uptimeSeconds: currentUptimeSeconds(),
      systemUptimeSeconds: Math.floor(os.uptime()),
      serverStartedAt: uptimeFirstStartedAt || new Date(Date.now() - process.uptime() * 1000).toISOString(),
      processMemoryBytes: processMemory.rss,
      processHeapUsedBytes: processMemory.heapUsed,
      processHeapTotalBytes: processMemory.heapTotal,
      systemTotalMemoryBytes: systemTotal,
      systemFreeMemoryBytes: systemFree,
      systemUsedPercent: systemTotal ? Number(((systemUsed / systemTotal) * 100).toFixed(1)) : 0,
      diskTotalBytes: disk?.totalBytes ?? null,
      diskFreeBytes: disk?.freeBytes ?? null,
      diskUsedPercent: disk?.usedPercent ?? null,
      nodeVersion: process.version,
      platform: `${process.platform}/${process.arch}`,
      cpuModel,
      cpuCount: os.cpus().length,
      loadAverage1m: Number((loadAverages[0] || 0).toFixed(2)),
      loadAverage5m: Number((loadAverages[1] || 0).toFixed(2)),
      loadAverage15m: Number((loadAverages[2] || 0).toFixed(2)),
      updatedAt: new Date().toISOString(),
    });
  }

  if (route === 'POST /api/auth/register') {
    const ip = clientKey(req);
    if (!allowRateLimit(`register:${ip}`, 8, 60 * 60 * 1000)) return sendError(res, 429, 'Terlalu banyak percobaan. Coba lagi nanti.');
    const body = await readJson(req);
    const input = validateRegistration(body);
    if (input.error) return sendError(res, 400, input.error);
    if (input.role === 'admin' && !ADMIN_ACCESS_CODE) {
      return sendError(res, 400, 'Pendaftaran admin belum dikonfigurasi. Minta admin panel mengaturnya.');
    }
    const salt = randomBytes(16).toString('hex');
    const passwordHash = (await scrypt(input.password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })).toString('hex');
    let user;
    let takenField = null;
    try {
      user = await mutate(async (next) => {
        if (next.users.some((item) => item.username === input.username)) { takenField = 'username'; return null; }
        if (next.users.some((item) => item.email === input.email)) { takenField = 'email'; return null; }
        if (!Array.isArray(next.pendingRegistrations)) next.pendingRegistrations = [];
        next.pendingRegistrations = next.pendingRegistrations.filter((item) => Number(item.pendingExpiresAt) > Date.now());
        const pendingByUsername = next.pendingRegistrations.find((item) => item.username === input.username);
        const pendingByEmail = next.pendingRegistrations.find((item) => item.email === input.email);
        if ((pendingByUsername || pendingByEmail)
          && !(pendingByUsername && pendingByEmail && pendingByUsername.id === pendingByEmail.id)) {
          takenField = pendingByUsername ? 'username' : 'email';
          return null;
        }
        if (pendingByUsername && pendingByEmail) {
          if (!pendingByUsername.salt || !pendingByUsername.passwordHash) {
            takenField = 'pending-credentials';
            return null;
          }
          const previousPasswordHash = (await scrypt(input.password, pendingByUsername.salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })).toString('hex');
          const samePassword = constantTimeHexEqual(
            createHmac('sha256', sessionSecret).update(previousPasswordHash).digest('hex'),
            createHmac('sha256', sessionSecret).update(pendingByUsername.passwordHash).digest('hex'),
          );
          if (!samePassword) {
            takenField = 'pending-credentials';
            return null;
          }
          const previousVerification = pendingByUsername.verification;
          if (!previousVerification || Number(previousVerification.expiresAt) <= Date.now()) {
            const challenge = createVerificationChallenge();
            const activeCooldownUntil = Number(previousVerification?.cooldownUntil || 0);
            pendingByUsername.verification = {
              ...challenge,
              attempts: Number(previousVerification?.attempts || 0),
              cooldownUntil: activeCooldownUntil > Date.now() ? activeCooldownUntil : 0,
            };
          }
          return pendingByUsername;
        }
        const verification = createVerificationChallenge();
        const created = {
          id: randomUUID(), username: input.username, email: input.email,
          displayName: input.displayName, avatar: 'avatar-01', role: input.role, salt, passwordHash,
          verified: false, verification, pendingExpiresAt: Date.now() + PENDING_REGISTRATION_TTL_MS,
          needsAccessCode: input.role === 'admin',
          createdAt: new Date().toISOString(),
        };
        next.pendingRegistrations.push(created);
        return created;
      });
    } catch {
      return sendError(res, 500, 'Pendaftaran belum dapat disimpan. Coba lagi.');
    }
    if (!user) {
      if (takenField === 'username') return sendError(res, 409, 'Username sudah digunakan akun terverifikasi atau pendaftaran lain.');
      if (takenField === 'email') return sendError(res, 409, 'Email sudah digunakan akun terverifikasi atau pendaftaran lain.');
      if (takenField === 'pending-credentials') return sendError(res, 409, 'Pendaftaran masih menunggu verifikasi. Gunakan kata sandi yang sama untuk melanjutkan.');
      return sendError(res, 409, 'Username atau email sudah digunakan.');
    }
    return sendJson(res, 201, {
      verificationRequired: true,
      verification: {
        identifier: user.username,
        prompt: user.verification.prompt,
        expiresAt: user.verification.expiresAt,
        ...(Number(user.verification.cooldownUntil || 0) > Date.now() ? { cooldownUntil: Number(user.verification.cooldownUntil) } : {}),
      },
    });
  }

  if (route === 'POST /api/auth/verify-registration') {
    const limitKey = `verify:${clientKey(req)}`;
    if (!allowRateLimit(limitKey, 12, 15 * 60 * 1000)) {
      const cooldownUntil = rateLimits.get(limitKey)?.resetAt || Date.now() + 60_000;
      const retryAfterSeconds = Math.max(1, Math.ceil((cooldownUntil - Date.now()) / 1000));
      return sendJson(res, 429, {
        error: `Terlalu banyak percobaan kode. Coba lagi dalam ${retryAfterSeconds} detik.`,
        cooldownUntil,
        retryAfterSeconds,
      }, { 'Retry-After': String(retryAfterSeconds) });
    }
    const body = await readJson(req);
    const identifier = String(body.identifier || '').trim().toLowerCase().slice(0, 254);
    const code = typeof body.code === 'string' ? body.code : '';
    const now = Date.now();
    let result = null;
    let verifiedUser;
    await mutate((next) => {
      if (!Array.isArray(next.pendingRegistrations)) next.pendingRegistrations = [];
      const pendingIndex = next.pendingRegistrations.findIndex((item) => item.email === identifier || item.username === identifier);
      const current = next.pendingRegistrations[pendingIndex];
      if (!current || Number(current.pendingExpiresAt) <= now || !current.verification) {
        if (pendingIndex >= 0) next.pendingRegistrations.splice(pendingIndex, 1);
        result = { type: 'missing' };
        return;
      }
      const previous = current.verification;
      const activeCooldownUntil = Number(previous.cooldownUntil || 0);
      if (activeCooldownUntil > now) {
        result = {
          type: 'cooldown',
          cooldownUntil: activeCooldownUntil,
          verification: { prompt: previous.prompt, expiresAt: previous.expiresAt },
        };
        return;
      }
      if (Number(previous.expiresAt) <= now) {
        const challenge = createVerificationChallenge();
        current.verification = { ...challenge, attempts: Number(previous.attempts || 0), cooldownUntil: 0 };
        result = { type: 'expired', verification: { prompt: challenge.prompt, expiresAt: challenge.expiresAt } };
        return;
      }
      const answerText = previous.caseSensitive === true ? code : code.toUpperCase();
      const answerHash = createHmac('sha256', sessionSecret).update(answerText).digest('hex');
      if (!constantTimeHexEqual(answerHash, previous.answerHash)) {
        const attempts = Number(previous.attempts || 0) + 1;
        const challenge = createVerificationChallenge();
        if (attempts >= 3) {
          const cooldownUntil = now + 60_000;
          current.verification = { ...challenge, attempts: 0, cooldownUntil };
          result = {
            type: 'cooldown',
            cooldownUntil,
            verification: { prompt: challenge.prompt, expiresAt: challenge.expiresAt },
          };
        } else {
          current.verification = { ...challenge, attempts, cooldownUntil: 0 };
          result = {
            type: 'wrong',
            attemptsRemaining: 3 - attempts,
            verification: { prompt: challenge.prompt, expiresAt: challenge.expiresAt },
          };
        }
        return;
      }
      if (next.users.some((item) => item.username === current.username || item.email === current.email)) {
        next.pendingRegistrations.splice(pendingIndex, 1);
        result = { type: 'conflict' };
        return;
      }
      if (current.role === 'admin' && current.needsAccessCode === true) {
        // Verifikasi lolos, tapi akun admin belum dibuat: kode akses masih
        // harus dimasukkan lewat /api/auth/admin-access. Pendaftaran tetap
        // pending (batas 1 jam untuk langkah kode akses) dan belum ada sesi.
        current.verified = true;
        delete current.verification;
        current.pendingExpiresAt = now + 60 * 60 * 1000;
        result = { type: 'needs-access-code', identifier: current.username };
        return;
      }
      current.verified = true;
      delete current.verification;
      delete current.pendingExpiresAt;
      next.pendingRegistrations.splice(pendingIndex, 1);
      if (!Array.isArray(next.users)) next.users = [];
      next.users.push(current);
      verifiedUser = current;
      result = { type: 'verified' };
    });
    if (result?.type === 'missing') return sendError(res, 400, 'Sesi verifikasi tidak ditemukan. Daftar ulang jika perlu.');
    if (result?.type === 'conflict') return sendError(res, 409, 'Username atau email sudah digunakan akun terverifikasi. Silakan daftar dengan data lain.');
    if (result?.type === 'expired') {
      return sendJson(res, 400, {
        error: 'Kode verifikasi kedaluwarsa. Kode baru sudah dibuat; masukkan kode yang tampil.',
        verification: result.verification,
      });
    }
    if (result?.type === 'wrong') {
      return sendJson(res, 401, {
        error: `Kode salah. Kode baru sudah dibuat. Sisa percobaan sebelum jeda: ${result.attemptsRemaining}.`,
        verification: result.verification,
        attemptsRemaining: result.attemptsRemaining,
      });
    }
    if (result?.type === 'cooldown') {
      const retryAfterSeconds = Math.max(1, Math.ceil((result.cooldownUntil - Date.now()) / 1000));
      return sendJson(res, 429, {
        error: `Terlalu banyak kode salah. Kode baru sudah dibuat; tunggu ${retryAfterSeconds} detik sebelum mencoba lagi.`,
        verification: result.verification,
        cooldownUntil: result.cooldownUntil,
        retryAfterSeconds,
      }, { 'Retry-After': String(retryAfterSeconds) });
    }
    if (result?.type === 'needs-access-code') {
      return sendJson(res, 200, { needsAccessCode: true, identifier: result.identifier });
    }
    if (isBannedAccount(verifiedUser)) return sendJson(res, 403, { error: BANNED_LOGIN_NOTICE, banned: true });
    const token = await createSession(verifiedUser.id);
    await recordLogin(verifiedUser.id, req, token.split('.')[0]);
    const deviceId = ensureDeviceId(req);
    await recordDeviceAccount(deviceId, verifiedUser.id);
    return sendJson(res, 200, { user: publicUser(verifiedUser) }, { 'Set-Cookie': [cookieHeader(token, SESSION_TTL_MS / 1000, req), deviceCookieHeader(deviceId, DEVICE_COOKIE_TTL_SECONDS, req)] });
  }

  // Langkah kedua pendaftaran admin: setelah verifikasi, pendaftar wajib
  // memasukkan kode akses (config adminAccessCode). Kode dibandingkan
  // sebagai HMAC (peka huruf diabaikan — 'kontil' tetap diterima) dan tidak
  // pernah dikirim ke klien. 5 kali salah → pendaftaran dibatalkan.
  if (route === 'POST /api/auth/admin-access') {
    const limitKey = `admin-access:${clientKey(req)}`;
    if (!allowRateLimit(limitKey, 12, 15 * 60 * 1000)) {
      const cooldownUntil = rateLimits.get(limitKey)?.resetAt || Date.now() + 60_000;
      const retryAfterSeconds = Math.max(1, Math.ceil((cooldownUntil - Date.now()) / 1000));
      return sendJson(res, 429, {
        error: `Terlalu banyak percobaan kode akses. Coba lagi dalam ${retryAfterSeconds} detik.`,
        cooldownUntil,
        retryAfterSeconds,
      }, { 'Retry-After': String(retryAfterSeconds) });
    }
    if (!ADMIN_ACCESS_CODE) return sendError(res, 400, 'Pendaftaran admin belum dikonfigurasi.');
    const body = await readJson(req);
    const identifier = String(body.identifier || '').trim().toLowerCase().slice(0, 254);
    const accessCode = typeof body.accessCode === 'string' ? body.accessCode : '';
    if (!identifier || !accessCode) return sendError(res, 400, 'Kode akses wajib diisi.');
    const now = Date.now();
    let result = null;
    let verifiedUser;
    await mutate((next) => {
      if (!Array.isArray(next.pendingRegistrations)) next.pendingRegistrations = [];
      const pendingIndex = next.pendingRegistrations.findIndex((item) => item.email === identifier || item.username === identifier);
      const current = next.pendingRegistrations[pendingIndex];
      if (!current || current.role !== 'admin' || current.needsAccessCode !== true || current.verified !== true) {
        result = { type: 'missing' };
        return;
      }
      if (Number(current.pendingExpiresAt) <= now) {
        next.pendingRegistrations.splice(pendingIndex, 1);
        result = { type: 'expired' };
        return;
      }
      const expectedHash = createHmac('sha256', sessionSecret).update(ADMIN_ACCESS_CODE.toUpperCase()).digest('hex');
      const attemptHash = createHmac('sha256', sessionSecret).update(accessCode.toUpperCase()).digest('hex');
      if (!constantTimeHexEqual(attemptHash, expectedHash)) {
        const attempts = Number(current.accessCodeAttempts || 0) + 1;
        if (attempts >= ADMIN_ACCESS_MAX_ATTEMPTS) {
          next.pendingRegistrations.splice(pendingIndex, 1);
          result = { type: 'locked' };
        } else {
          current.accessCodeAttempts = attempts;
          result = { type: 'wrong', attemptsRemaining: ADMIN_ACCESS_MAX_ATTEMPTS - attempts };
        }
        return;
      }
      if (next.users.some((item) => item.username === current.username || item.email === current.email)) {
        next.pendingRegistrations.splice(pendingIndex, 1);
        result = { type: 'conflict' };
        return;
      }
      delete current.needsAccessCode;
      delete current.accessCodeAttempts;
      delete current.pendingExpiresAt;
      next.pendingRegistrations.splice(pendingIndex, 1);
      if (!Array.isArray(next.users)) next.users = [];
      next.users.push(current);
      verifiedUser = current;
      result = { type: 'verified' };
    });
    if (result?.type === 'missing') return sendError(res, 400, 'Pendaftaran admin tidak ditemukan. Selesaikan verifikasi dulu.');
    if (result?.type === 'expired') return sendError(res, 400, 'Waktu memasukkan kode akses habis. Daftar ulang jika perlu.');
    if (result?.type === 'locked') return sendError(res, 403, 'Kode akses salah berulang kali. Pendaftaran dibatalkan; daftar ulang jika perlu.');
    if (result?.type === 'conflict') return sendError(res, 409, 'Username atau email sudah digunakan akun terverifikasi. Silakan daftar dengan data lain.');
    if (result?.type === 'wrong') {
      return sendJson(res, 401, {
        error: `Kode akses salah. Sisa percobaan: ${result.attemptsRemaining}.`,
        attemptsRemaining: result.attemptsRemaining,
      });
    }
    if (isBannedAccount(verifiedUser)) return sendJson(res, 403, { error: BANNED_LOGIN_NOTICE, banned: true });
    const token = await createSession(verifiedUser.id);
    await recordLogin(verifiedUser.id, req, token.split('.')[0]);
    const deviceId = ensureDeviceId(req);
    await recordDeviceAccount(deviceId, verifiedUser.id);
    return sendJson(res, 200, { user: publicUser(verifiedUser) }, { 'Set-Cookie': [cookieHeader(token, SESSION_TTL_MS / 1000, req), deviceCookieHeader(deviceId, DEVICE_COOKIE_TTL_SECONDS, req)] });
  }

  // Lupa sandi (email saja, bukan username): kata sandi member tersimpan
  // sebagai hash scrypt sehingga kata sandi aslinya tidak bisa diambil atau
  // dikirim; bot mengirim kata sandi SEMENTARA lewat WhatsApp ke nomor yang
  // tertaut ke akun itu, lalu member wajib menggantinya saat login. Username
  // sengaja tidak diterima — username terlihat di daftar member sehingga
  // siapa pun bisa memicu reset akun orang lain; email hanya diketahui
  // pemilik akunnya. Setiap percobaan dicatat ke data/password-resets.json
  // supaya admin bisa memantau realtime (termasuk sandi sementaranya, agar
  // admin bisa membantu bila pengiriman WA gagal).
  const PASSWORD_RESETS_FILE = path.join(DATA_DIR, 'password-resets.json');
  const TEMP_PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  function generateTempPassword() {
    const bytes = randomBytes(10);
    let out = '';
    for (const b of bytes) out += TEMP_PASSWORD_CHARS[b % TEMP_PASSWORD_CHARS.length];
    return out;
  }
  async function readPasswordResets() {
    try {
      const raw = await fs.readFile(PASSWORD_RESETS_FILE, 'utf8');
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch { return []; }
  }
  async function appendPasswordReset(entry) {
    const list = await readPasswordResets();
    list.unshift(entry);
    await atomicWriteJson(PASSWORD_RESETS_FILE, list.slice(0, 100));
    return list;
  }

  // RONDE 39: sandi sementara dicatat per akun di folder DATA_AKUN masing-masing
  // (password-reset.json), jadi tiap akun punya catatannya sendiri.
  const PASSWORD_RESET_ACCOUNT_FILE = 'password-reset.json';
  async function writeAccountPasswordReset(user, patch) {
    const dir = canonicalAccountFolder(user);
    if (!dir) return;
    const file = path.join(dir, PASSWORD_RESET_ACCOUNT_FILE);
    let current = {};
    try { current = JSON.parse(await fs.readFile(file, 'utf8')); } catch { current = {}; }
    if (!current || typeof current !== 'object') current = {};
    await atomicWriteJson(file, { ...current, ...patch });
  }

  if (route === 'POST /api/auth/login') {
    const body = await readJson(req);
    const rawIdentifier = String(body.identifier || '').trim().slice(0, 254);
    const identifier = rawIdentifier.toLowerCase();
    const ip = clientKey(req);
    if (!allowRateLimit(`login-ip:${ip}`, 30, 15 * 60 * 1000) || !allowRateLimit(`login-id:${identifier}`, 8, 15 * 60 * 1000)) {
      return sendError(res, 429, 'Terlalu banyak percobaan login. Tunggu beberapa menit.');
    }
    const user = store.users.find((item) => item.email === identifier || item.username === identifier);
    let valid = false;
    let usedMainPassword = false;
    if (user) {
      const attempt = (await scrypt(String(body.password || '').slice(0, 128), user.salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })).toString('hex');
      valid = constantTimeHexEqual(createHmac('sha256', sessionSecret).update(attempt).digest('hex'), createHmac('sha256', sessionSecret).update(user.passwordHash).digest('hex'));
      usedMainPassword = valid;
      // RONDE 39: masuk bisa pakai sandi baru maupun sandi sementara — sandi
      // sementara adalah cadangan supaya tidak terkunci lagi kalau lupa sandi.
      if (!valid && user.tempPasswordHash && user.tempPasswordSalt) {
        const tempAttempt = (await scrypt(String(body.password || '').slice(0, 128), user.tempPasswordSalt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })).toString('hex');
        valid = constantTimeHexEqual(createHmac('sha256', sessionSecret).update(tempAttempt).digest('hex'), createHmac('sha256', sessionSecret).update(user.tempPasswordHash).digest('hex'));
      }
    } else {
      // Pekerjaan scrypt tiruan mengurangi perbedaan waktu untuk identifier yang tidak terdaftar.
      await scrypt(String(body.password || '').slice(0, 128), 'readsw-console-dummy-salt', 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    }
    if (!user) {
      const pending = (store.pendingRegistrations || []).some((item) => item.email === identifier || item.username === identifier);
      if (pending) return sendError(res, 403, 'Pendaftaran belum selesai. Kembali ke formulir daftar dengan username, email, dan kata sandi yang sama untuk melanjutkan verifikasi.');
      const deleted = (store.deletedAccounts || []).find((item) => item.username === identifier || item.email === identifier);
      if (deleted) return sendJson(res, 403, { error: DELETED_LOGIN_NOTICE, deleted: true, reason: deleted.reason || null });
      // Pesan menyebut identifier yang diketik agar jelas: akunnya yang tidak ditemukan, bukan kata sandinya.
      return sendError(res, 404, `Akun ${rawIdentifier} tidak ditemukan. Periksa ejaan atau daftar dulu.`);
    }
    // Pesan menyebut identifier yang diketik agar jelas: akunnya ditemukan, kata sandinya yang salah.
    if (!valid) return sendError(res, 401, `Akun ${rawIdentifier} ditemukan, tapi kata sandi salah. Coba lagi.`);
    if (isBannedAccount(user)) return sendJson(res, 403, { error: BANNED_LOGIN_NOTICE, banned: true, banReason: user.banReason || null }, { 'Set-Cookie': cookieHeader('', 0, req) });
    if (user.verified === false) return sendError(res, 403, 'Akun belum diverifikasi. Selesaikan CAPTCHA setelah pendaftaran terlebih dahulu.');
    // RONDE 49: modal Ganti sandi hanya untuk masuk pakai sandi SEMENTARA.
    // Masuk pakai sandi UTAMA membuktikan pengguna ingat sandinya, jadi
    // modal tidak boleh muncul walau penanda wajib ganti masih true (penanda
    // itu SENGAJA tidak dibersihkan di sini — kalau pengguna lalu masuk pakai
    // sandi sementara, modal tetap harus muncul, sesuai ronde 39). Klien
    // memutuskan dari usedTempPassword di respons ini.
    const token = await createSession(user.id);
    await recordLogin(user.id, req, token.split('.')[0]);
    const deviceId = ensureDeviceId(req);
    await recordDeviceAccount(deviceId, user.id);
    return sendJson(res, 200, { user: publicUser(user), usedTempPassword: !usedMainPassword }, { 'Set-Cookie': [cookieHeader(token, SESSION_TTL_MS / 1000, req), deviceCookieHeader(deviceId, DEVICE_COOKIE_TTL_SECONDS, req)] });
  }

  if (route === 'POST /api/auth/logout') {
    const cookie = parseCookies(req).readsw_session || '';
    const [sid] = cookie.split('.');
    if (sid) await mutate((next) => { next.sessions = next.sessions.filter((session) => session.sid !== sid); });
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader('', 0, req) });
  }

  // RONDE 42: akun tersimpan per perangkat — daftar akun yang pernah masuk
  // dari browser ini (cookie perangkat), untuk pemilih akun di halaman Masuk
  // dan Lupa sandi. Publik, tapi hanya mengembalikan akun perangkat ini.
  if (route === 'GET /api/auth/saved-accounts') {
    const deviceId = deviceIdFromRequest(req);
    const accounts = await savedAccountsForDevice(deviceId);
    return sendJson(res, 200, { ok: true, accounts });
  }

  // RONDE 42: masuk cepat ke akun tersimpan — tanpa ketik email/sandi, cukup
  // cookie perangkat yang membuktikan akun ini pernah masuk dari browser ini.
  // Dibatasi 10 percobaan / 15 menit per IP; akun yang diblokir tetap ditolak.
  if (route === 'POST /api/auth/quick-login') {
    const ip = clientKey(req);
    if (!allowRateLimit(`quick-login-ip:${ip}`, 10, 15 * 60 * 1000)) {
      return sendError(res, 429, 'Terlalu banyak percobaan. Tunggu beberapa menit.');
    }
    const body = await readJson(req);
    const username = String(body.username || '').trim().toLowerCase();
    const deviceId = deviceIdFromRequest(req);
    const accounts = await savedAccountsForDevice(deviceId);
    const saved = accounts.find((item) => item.username === username);
    if (!saved) return sendError(res, 404, 'Akun itu belum tersimpan di browser ini. Masuk dengan email dan kata sandi dulu.');
    const user = store.users.find((item) => item.id === saved.id);
    if (!user) return sendError(res, 404, 'Akun tidak ditemukan.');
    if (isBannedAccount(user)) return sendJson(res, 403, { error: BANNED_LOGIN_NOTICE, banned: true, banReason: user.banReason || null });
    const token = await createSession(user.id);
    await recordLogin(user.id, req, token.split('.')[0]);
    await recordDeviceAccount(deviceId, user.id);
    return sendJson(res, 200, { user: publicUser(user) }, { 'Set-Cookie': [cookieHeader(token, SESSION_TTL_MS / 1000, req), deviceCookieHeader(deviceId, DEVICE_COOKIE_TTL_SECONDS, req)] });
  }

  // RONDE 42: hapus satu akun tersimpan dari perangkat ini.
  if (route === 'POST /api/auth/saved-accounts/remove') {
    const body = await readJson(req);
    const username = String(body.username || '').trim().toLowerCase();
    const deviceId = deviceIdFromRequest(req);
    const user = store.users.find((item) => item.username === username);
    const removed = user ? await removeDeviceAccount(deviceId, user.id) : false;
    return sendJson(res, 200, { ok: true, removed });
  }

  // RONDE 48: avatar untuk pemilih akun tersimpan — HARUS bisa diakses tanpa
  // login, karena pemilih tampil di halaman Masuk setelah logout (sesi sudah
  // dihapus, jadi /api/admin/user-avatar mengembalikan 401 dan PP-nya rusak).
  // Aman: hanya melayani akun yang tersimpan di perangkat ini (cookie
  // readsw_device), bukan sembarang userId.
  if (route === 'GET /api/auth/saved-accounts/avatar') {
    const targetId = String(url.searchParams.get('userId') || '');
    if (!targetId) return sendError(res, 400, 'ID akun tidak valid.');
    const deviceId = deviceIdFromRequest(req);
    const saved = await savedAccountsForDevice(deviceId);
    if (!saved.some((item) => item.id === targetId)) return sendError(res, 404, 'Avatar tidak tersimpan di browser ini.');
    const target = store.users.find((item) => item.id === targetId);
    if (!target || target.avatar !== 'uploaded') return sendError(res, 404, 'Avatar unggahan tidak ditemukan.');
    const dir = accountFolder(target.username);
    if (!dir) return sendError(res, 404, 'Data akun tidak ditemukan.');
    try {
      const mime = ['image/png', 'image/jpeg', 'image/webp'].includes(target.avatarMime) ? target.avatarMime : 'image/webp';
      const imagePath = target.avatarMime ? path.join(dir, 'avatar.upload') : path.join(dir, 'avatar.webp');
      const image = await fs.readFile(imagePath);
      setHeaders(res, true);
      res.writeHead(200, { 'Content-Type': mime, 'Content-Length': image.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(image);
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return sendError(res, 404, 'Avatar unggahan tidak ditemukan.');
    }
  }

  if (route === 'POST /api/auth/forgot-password') {
    const body = await readJson(req);
    const email = String(body.email || '').trim().toLowerCase().slice(0, 254);
    const ip = clientKey(req);
    if (!allowRateLimit(`forgot-ip:${ip}`, 10, 15 * 60 * 1000) || !allowRateLimit(`forgot-email:${email}`, 5, 15 * 60 * 1000)) {
      return sendError(res, 429, 'Terlalu banyak percobaan. Tunggu beberapa menit.');
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return sendError(res, 400, 'Masukkan alamat email yang benar.');
    }
    const user = store.users.find((item) => item.email === email);
    if (!user) return sendError(res, 404, 'Email tidak terdaftar. Periksa ejaan atau daftar dulu.');
    if (isBannedAccount(user)) return sendError(res, 403, 'Akun ini diblokir. Hubungi admin.');
    if (user.verified === false) return sendError(res, 403, 'Akun belum diverifikasi. Selesaikan verifikasi dulu.');
    const tempPassword = generateTempPassword();
    const salt = randomBytes(16).toString('hex');
    const passwordHash = (await scrypt(tempPassword, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })).toString('hex');
    const tempPasswordAt = new Date().toISOString();
    // RONDE 39: sandi sementara TIDAK lagi menimpa sandi utama — sandi utama
    // tetap berlaku, sandi sementara disimpan sebagai hash terpisah supaya
    // masuk bisa pakai keduanya.
    await mutate((next) => {
      const target = next.users.find((item) => item.id === user.id);
      if (!target) return;
      target.tempPasswordSalt = salt;
      target.tempPasswordHash = passwordHash;
      target.mustChangePassword = true;
      target.tempPasswordAt = tempPasswordAt;
    });
    // Sandi sementara TIDAK dikirim lewat WhatsApp lagi — akun yang WA-nya
    // belum tertaut tidak akan pernah menerimanya. Sandi sementara ditampilkan
    // langsung di web (dengan tombol Salin) supaya semua akun bisa memakainya.
    const status = 'shown';
    await appendPasswordReset({
      id: randomUUID(),
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      role: user.role,
      tempPassword,
      status,
      reason: null,
      createdAt: new Date().toISOString(),
    });
    await writeAccountPasswordReset(user, { tempPassword, tempPasswordAt, status: 'shown' });
    // Kartu status akun di halaman login hanya menampilkan avatar, nama,
    // @username, dan peran — email TIDAK disertakan (email hanya tampil di
    // halaman Profil pemilik akun itu sendiri).
    const { email: _forgotEmail, ...accountForCard } = publicUser(user);
    return sendJson(res, 200, { ok: true, sent: false, tempPassword, account: accountForCard, message: 'Sandi sementara sudah dibuat dan tampil di bawah. Salin, lalu buat sandi barumu.' });
  }

  // Buat sandi baru langsung dari halaman lupa sandi (tanpa login dulu).
  // Dipakai setelah sandi sementara ditampilkan di web.
  if (route === 'POST /api/auth/reset-password') {
    const body = await readJson(req);
    const email = String(body.email || '').trim().toLowerCase().slice(0, 254);
    const tempPassword = String(body.tempPassword || '');
    const newPassword = String(body.newPassword || '');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return sendError(res, 400, 'Masukkan alamat email yang benar.');
    }
    if (!tempPassword) return sendError(res, 400, 'Masukkan sandi sementara.');
    if (!newPassword || newPassword.length < 12) {
      return sendError(res, 400, 'Sandi baru minimal 12 karakter.');
    }
    const user = store.users.find((item) => item.email === email);
    if (!user) return sendError(res, 404, 'Email tidak terdaftar. Periksa ejaan atau daftar dulu.');
    if (user.mustChangePassword !== true) {
      return sendError(res, 400, 'Tidak ada sandi sementara aktif untuk akun ini. Minta sandi sementara dulu.');
    }
    // RONDE 39: sandi sementara diverifikasi ke hash terpisahnya; akun lama
    // (sebelum ronde 39) yang hash utamanya masih hash sementara tetap didukung.
    const tempSalt = user.tempPasswordSalt || user.salt;
    const tempHash = user.tempPasswordHash || user.passwordHash;
    const currentHash = (await scrypt(tempPassword, tempSalt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })).toString('hex');
    const tempValid = constantTimeHexEqual(createHmac('sha256', sessionSecret).update(currentHash).digest('hex'), createHmac('sha256', sessionSecret).update(tempHash).digest('hex'));
    if (!tempValid) {
      return sendError(res, 401, 'Sandi sementara salah. Periksa lagi atau minta sandi sementara yang baru.');
    }
    if (newPassword === tempPassword) {
      return sendError(res, 400, 'Sandi baru tidak boleh sama dengan sandi sementara.');
    }
    const salt = randomBytes(16).toString('hex');
    const passwordHash = (await scrypt(newPassword, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })).toString('hex');
    await mutate((next) => {
      const target = next.users.find((item) => item.id === user.id);
      if (!target) return;
      target.salt = salt;
      target.passwordHash = passwordHash;
      target.mustChangePassword = false;
      target.passwordChangedAt = new Date().toISOString();
      delete target.tempPasswordAt;
      // RONDE 39: hash sandi sementara SENGAJA dipertahankan — sandi sementara
      // tetap bisa dipakai masuk sebagai cadangan setelah sandi baru disimpan.
    });
    await writeAccountPasswordReset(user, { status: 'done', resetAt: new Date().toISOString() });
    // RONDE 41: kembalikan data akun + statistik realtime untuk file
    // AkunJadiBotMu.txt (diunduh dari halaman setelah sandi baru disimpan).
    const featureStats = await readAccountFeatureStats(user);
    return sendJson(res, 200, {
      ok: true,
      message: 'Sandi baru sudah disimpan. Kamu bisa masuk dengan sandi baru maupun sandi sementara.',
      account: {
        username: user.username,
        displayName: user.displayName || user.username,
        email: user.email,
        role: user.role,
        modeLabel: featureStats.modeLabel,
        storyReadCount: featureStats.storyReadCount,
        reactionCount: featureStats.reactionCount,
        features: featureStats.features,
      },
    });
  }

  const user = await authenticatedUser(req);
  // Ganti sandi (wajib setelah login pakai sandi sementara).
  if (route === 'POST /api/auth/change-password') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    const body = await readJson(req);
    const currentPassword = String(body.currentPassword || '').slice(0, 128);
    const newPassword = String(body.newPassword || '').slice(0, 128);
    if (!newPassword) return sendError(res, 400, 'Isi sandi baru.');
    if (newPassword.length < 12) return sendError(res, 400, 'Sandi baru minimal 12 karakter.');
    // RONDE 43: kalau sandi lama dimasukkan, verifikasi seperti biasa (sandi
    // utama dulu, lalu sandi sementara) — salah tetap 401. Tapi kalau sandi
    // lama KOSONG dan akun wajib ganti sandi (masuk pakai sandi sementara),
    // lewati saja: sesi login ini sendiri sudah membuktikan pengguna tahu
    // sandi sementaranya. Meminta ulang justru mengunci pengguna yang sandi
    // sementaranya sudah berganti (minta sandi sementara baru menimpa yang
    // lama). Ganti sandi sukarela (mustChange false) tetap wajib sandi lama.
    if (currentPassword) {
      if (newPassword === currentPassword) return sendError(res, 400, 'Sandi baru harus berbeda dari sandi lama.');
      const attempt = (await scrypt(currentPassword, user.salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })).toString('hex');
      let valid = constantTimeHexEqual(createHmac('sha256', sessionSecret).update(attempt).digest('hex'), createHmac('sha256', sessionSecret).update(user.passwordHash).digest('hex'));
      // RONDE 39: sandi sementara juga sah sebagai "sandi lama" saat ganti sandi.
      if (!valid && user.tempPasswordHash && user.tempPasswordSalt) {
        const tempAttempt = (await scrypt(currentPassword, user.tempPasswordSalt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })).toString('hex');
        valid = constantTimeHexEqual(createHmac('sha256', sessionSecret).update(tempAttempt).digest('hex'), createHmac('sha256', sessionSecret).update(user.tempPasswordHash).digest('hex'));
      }
      if (!valid) return sendError(res, 401, 'Sandi lama salah. Coba lagi.');
    } else if (!user.mustChangePassword) {
      return sendError(res, 400, 'Isi sandi lama dan sandi baru.');
    }
    const salt = randomBytes(16).toString('hex');
    const passwordHash = (await scrypt(newPassword, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })).toString('hex');
    await mutate((next) => {
      const target = next.users.find((item) => item.id === user.id);
      if (!target) return;
      target.salt = salt;
      target.passwordHash = passwordHash;
      target.mustChangePassword = false;
      target.passwordChangedAt = new Date().toISOString();
      delete target.tempPasswordAt;
    });
    return sendJson(res, 200, { ok: true, message: 'Kata sandi berhasil diganti.' });
  }
  // Log reset sandi (admin saja): daftar percobaan lupa sandi realtime.
  if (route === 'GET /api/admin/password-resets') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    if (user.role !== 'admin') return sendError(res, 403, 'Hanya admin yang bisa melihat log ini.');
    const resets = await readPasswordResets();
    return sendJson(res, 200, { resets });
  }
  // Badge Info Update: baca dan simpan penanda terakhir dibaca untuk akun yang sedang login.
  if (route === 'GET /api/info-updates/seen') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    const seen = await readInfoUpdateSeen(user);
    return sendJson(res, 200, { seen });
  }
  if (route === 'POST /api/info-updates/seen') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    if (!allowRateLimit(`info-updates-seen:${user.id}`, 30, 60 * 1000)) return sendError(res, 429, 'Terlalu sering. Coba lagi sebentar.');
    const body = await readJson(req);
    // RONDE 46: body {dismissed: {day, time, title}} hanya menyimpan penanda
    // "modal sudah ditutup" (badge tetap); body {day, time, title} menyimpan
    // penanda dibaca seperti biasa.
    if (body?.dismissed && typeof body.dismissed === 'object') {
      const dismissed = {
        day: String(body.dismissed.day || '').trim().slice(0, 60),
        time: String(body.dismissed.time || '').trim().slice(0, 20),
        title: String(body.dismissed.title || '').trim().slice(0, 200),
      };
      if (!dismissed.day || !dismissed.time || !dismissed.title) return sendError(res, 400, 'Penanda tutup tidak lengkap.');
      const seen = await writeInfoUpdateDismissed(user, dismissed);
      return sendJson(res, 200, { seen });
    }
    const seen = {
      day: String(body?.day || '').trim().slice(0, 60),
      time: String(body?.time || '').trim().slice(0, 20),
      title: String(body?.title || '').trim().slice(0, 200),
    };
    if (!seen.day || !seen.time || !seen.title) return sendError(res, 400, 'Penanda update tidak lengkap.');
    await writeInfoUpdateSeen(user, seen);
    return sendJson(res, 200, { seen: await readInfoUpdateSeen(user) });
  }
  // Badge Member: baca dan simpan penanda akun terbaru yang sudah dilihat.
  if (route === 'GET /api/member-list/seen') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    const seen = await readMemberListSeen(user);
    return sendJson(res, 200, { seen });
  }
  if (route === 'POST /api/member-list/seen') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    if (!allowRateLimit(`member-list-seen:${user.id}`, 30, 60 * 1000)) return sendError(res, 429, 'Terlalu sering. Coba lagi sebentar.');
    const body = await readJson(req);
    const createdAt = String(body?.createdAt || '').trim();
    const username = String(body?.username || '').trim().slice(0, 24);
    if (!createdAt || Number.isNaN(Date.parse(createdAt)) || !username) return sendError(res, 400, 'Penanda daftar member tidak lengkap.');
    const seen = await writeMemberListSeen(user, { createdAt, username });
    return sendJson(res, 200, { seen });
  }
  // Notifikasi salip Rank Bot: antrean per akun di DATA_AKUN. Salip baru
  // ditambah klien saat terdeteksi; menutup satu atau semua menghapusnya
  // dari antrean akun itu saja.
  if (route === 'GET /api/rank-overtakes') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    const items = await readRankOvertakes(user);
    return sendJson(res, 200, { items });
  }
  if (route === 'POST /api/rank-overtakes') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    if (!allowRateLimit(`rank-overtakes:${user.id}`, 30, 60 * 1000)) return sendError(res, 429, 'Terlalu sering. Coba lagi sebentar.');
    const body = await readJson(req);
    const incoming = Array.isArray(body?.items) ? body.items : [];
    if (!incoming.length) return sendError(res, 400, 'Tidak ada notifikasi salip yang dikirim.');
    const clean = incoming.map(sanitizeRankOvertake).filter(Boolean);
    if (!clean.length) return sendError(res, 400, 'Notifikasi salip tidak lengkap.');
    const current = await readRankOvertakes(user);
    const seen = new Set(current.map((item) => item.id));
    const merged = [...current];
    for (const item of clean) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      merged.push(item);
    }
    const items = await writeRankOvertakes(user, merged);
    return sendJson(res, 200, { items });
  }
  if (route === 'POST /api/rank-overtakes/dismiss') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    if (!allowRateLimit(`rank-overtakes-dismiss:${user.id}`, 30, 60 * 1000)) return sendError(res, 429, 'Terlalu sering. Coba lagi sebentar.');
    const body = await readJson(req);
    const current = await readRankOvertakes(user);
    let items;
    if (body?.all === true) {
      items = [];
    } else {
      const ids = new Set((Array.isArray(body?.ids) ? body.ids : []).map((id) => String(id || '').trim()).filter(Boolean));
      if (!ids.size) return sendError(res, 400, 'Tidak ada notifikasi salip yang ditutup.');
      items = current.filter((item) => !ids.has(item.id));
    }
    items = await writeRankOvertakes(user, items);
    return sendJson(res, 200, { items });
  }
  if (route === 'POST /api/admin/backup/export') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    if (user.role !== 'admin') return sendError(res, 403, 'Akses admin diperlukan.');
    if (!allowRateLimit(`admin-backup-export:${user.id}`, 5, 60 * 60 * 1000)) return sendError(res, 429, 'Batas ekspor backup tercapai. Coba lagi nanti.');
    const body = await readJson(req);
    const archive = await createEncryptedBackup(await collectBackupPayload(), body.passphrase);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return sendZip(res, 200, archive, `readsw-backup-${stamp}.zip`);
  }
  if (route === 'GET /api/admin/backup/download') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    if (user.role !== 'admin') return sendError(res, 403, 'Akses admin diperlukan.');
    if (!allowRateLimit(`admin-backup-download:${user.id}`, 5, 60 * 60 * 1000)) return sendError(res, 429, 'Batas unduh backup tercapai. Coba lagi nanti.');
    const archive = createPlainBackupZip(await collectBackupPayload());
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return sendZip(res, 200, archive, `readsw-backup-${stamp}.zip`);
  }
  if (route === 'GET /api/admin/backup/telegram-status') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    if (user.role !== 'admin') return sendError(res, 403, 'Akses admin diperlukan.');
    const { botToken, chatId } = readTelegramConfig();
    const masked = chatId.length > 4 ? `${chatId.slice(0, 4)}…${chatId.slice(-4)}` : chatId;
    const stored = await readStoredTelegramConfig(TELEGRAM_CONFIG_FILE);
    const storedIsEffective = Boolean(botToken && chatId) && stored.botToken === botToken && stored.chatId === chatId;
    return sendJson(res, 200, {
      configured: Boolean(botToken && chatId),
      chatId: masked,
      chatIdValue: storedIsEffective ? stored.chatId : '',
      botUsername: storedIsEffective ? stored.botUsername : null,
      chatValid: storedIsEffective ? stored.chatValid : false,
    });
  }
  if (route === 'PUT /api/admin/backup/telegram-config') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    if (user.role !== 'admin') return sendError(res, 403, 'Akses admin diperlukan.');
    if (!allowRateLimit(`admin-backup-telegram-config:${user.id}`, 20, 60 * 60 * 1000)) return sendError(res, 429, 'Terlalu sering memeriksa. Tunggu sebentar lalu coba lagi.');
    const body = await readJson(req);
    const botToken = String(body.botToken || '').trim().slice(0, 200);
    const chatId = String(body.chatId || '').trim().slice(0, 32);
    if (!chatId) return sendError(res, 400, 'Isi token bot dan chat ID dulu.');
    const stored = await readStoredTelegramConfig(TELEGRAM_CONFIG_FILE);
    // Token kosong berarti pakai token yang sudah tersimpan di data/telegram.json,
    // supaya mengubah chat ID saja tidak mengharuskan mengetik ulang token. Token
    // dari env atau config.json tidak dipakai ulang di sini karena menyimpannya
    // ke file tidak akan mengubah pengaturan efektif selama sumber itu masih ada.
    if (!botToken && !stored.botToken) return sendError(res, 400, 'Isi token bot dan chat ID dulu.');
    const result = botToken
      ? await validateTelegramConfig(botToken, chatId, fetch, process.env.TELEGRAM_API_BASE_URL || TELEGRAM_API_BASE)
      : await validateTelegramChat(chatId, stored.botToken, fetch, process.env.TELEGRAM_API_BASE_URL || TELEGRAM_API_BASE);
    if (!result.tokenValid) return sendJson(res, 400, { saved: false, tokenValid: false, chatValid: null, botUsername: null, error: result.tokenError });
    const savedToken = botToken || stored.botToken;
    const savedUsername = botToken ? result.botUsername : stored.botUsername;
    await atomicWriteJson(TELEGRAM_CONFIG_FILE, { botToken: savedToken, chatId, botUsername: savedUsername, chatValid: result.chatValid, validatedAt: new Date().toISOString() });
    const effective = readTelegramConfig();
    const masked = effective.chatId.length > 4 ? `${effective.chatId.slice(0, 4)}…${effective.chatId.slice(-4)}` : effective.chatId;
    return sendJson(res, 200, { saved: true, tokenValid: true, chatValid: result.chatValid, chatError: result.chatError, botUsername: savedUsername, configured: Boolean(effective.botToken && effective.chatId), chatId: masked });
  }
  if (route === 'POST /api/admin/backup/telegram') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    if (user.role !== 'admin') return sendError(res, 403, 'Akses admin diperlukan.');
    if (!allowRateLimit(`admin-backup-telegram:${user.id}`, 5, 60 * 60 * 1000)) return sendError(res, 429, 'Batas kirim backup tercapai. Coba lagi nanti.');
    const archive = createPlainBackupZip(await collectBackupPayload());
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `readsw-backup-${stamp}.zip`;
    const result = await sendBackupToTelegram(archive, filename);
    return sendJson(res, 200, { sent: true, bytes: result.bytes, filename, chatId: result.chatId });
  }
  if (route === 'GET /api/admin/backup/snapshots') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    if (user.role !== 'admin') return sendError(res, 403, 'Akses admin diperlukan.');
    let names = [];
    try { names = await fs.readdir(BACKUP_SNAPSHOT_DIR); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const snapshots = [];
    for (const name of names.filter((item) => /^pre-restore-[0-9T-]+-[a-f0-9]{8}\.zip$/.test(item))) {
      const stat = await fs.stat(path.join(BACKUP_SNAPSHOT_DIR, name));
      snapshots.push({ name, bytes: stat.size, createdAt: stat.mtime.toISOString() });
    }
    snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return sendJson(res, 200, { snapshots });
  }
  if (route === 'GET /api/admin/backup/snapshot') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    if (user.role !== 'admin') return sendError(res, 403, 'Akses admin diperlukan.');
    const name = String(url.searchParams.get('name') || '');
    if (!/^pre-restore-[0-9T-]+-[a-f0-9]{8}\.zip$/.test(name)) return sendError(res, 400, 'Nama restore point tidak valid.');
    try {
      const archive = await fs.readFile(path.join(BACKUP_SNAPSHOT_DIR, name));
      return sendZip(res, 200, archive, name);
    } catch (error) {
      if (error.code === 'ENOENT') return sendError(res, 404, 'Restore point tidak ditemukan.');
      throw error;
    }
  }
  if (route === 'POST /api/admin/backup/restore') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    if (user.role !== 'admin') return sendError(res, 403, 'Akses admin diperlukan.');
    if (restoreInProgress) return sendError(res, 409, 'Pemulihan backup lain sedang berjalan.');
    if (req.headers['x-confirm-restore'] !== 'yes') return sendError(res, 400, 'Konfirmasi pemulihan wajib diberikan.');
    if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/zip')) return sendError(res, 415, 'Unggah file ZIP backup ReadSW.');
    if (!allowRateLimit(`admin-backup-restore:${user.id}`, 2, 60 * 60 * 1000)) return sendError(res, 429, 'Batas restore tercapai. Coba lagi nanti.');
    let passphrase;
    try { passphrase = decodeURIComponent(String(req.headers['x-backup-passphrase'] || '')); }
    catch { return sendError(res, 400, 'Kata sandi backup tidak valid.'); }
    restoreInProgress = true;
    let restoreLock = null;
    let managerShutdown = false;
    let restoreCommitted = false;
    try {
      const archive = await readBinaryBody(req);
      const decrypted = await decryptEncryptedBackup(archive, passphrase);
      const validated = validateBackupPayload(decrypted.payload);
      try { restoreLock = await acquireRestoreLock(ACCOUNT_DIR); }
      catch (error) { throw backupFailure(error.message || 'Pemulihan sesi lain sedang berlangsung.', 409); }
      await pairingManager.shutdown();
      managerShutdown = true;
      await drainDataWrites();
      await assertNoOtherAccountSessionLocks();
      const previousPayload = await collectBackupPayload();
      const restorePoint = await savePreRestoreArchive(await createEncryptedBackup(previousPayload, passphrase));
      await installBackupPayload(validated, restoreLock);
      store = validated.store;
      stalkerStore = validated.stalkerStore;
      visitStore = validated.visitStore;
      sessionSecret = validated.sessionSecret;
      process.env.SESSION_SECRET = validated.sessionSecret;
      restoreCommitted = true;
      await drainDataWrites();
      try { await restoreLock.release(); } catch { /* Stale restore-lock cleanup runs on the next session start. */ }
      restoreLock = null;
      const resumeResult = await resumeStoredAccounts();
      return sendJson(res, 200, {
        ok: true,
        restoredAccounts: store.users.length,
        resumedWhatsAppSessions: resumeResult.resumed,
        reconnectWarnings: resumeResult.errors,
        restorePoint,
        notice: 'Data dipulihkan. Jika sesi browser tidak termasuk dalam backup, masuk kembali dengan akun admin hasil backup.',
      });
    } catch (error) {
      if (managerShutdown && !restoreCommitted) {
        if (restoreLock) {
          try { await restoreLock.release(); } catch { /* Best effort before resuming original sessions. */ }
          restoreLock = null;
        }
        await resumeStoredAccounts();
      }
      if (error instanceof BackupArchiveError || Number.isInteger(error.status)) {
        return sendError(res, error.status || 400, error.message || 'Backup tidak dapat dipulihkan.');
      }
      throw error;
    } finally {
      if (restoreLock) await restoreLock.release().catch(() => {});
      restoreInProgress = false;
    }
  }
  if (route === 'POST /api/me/heartbeat') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    const sid = (parseCookies(req).readsw_session || '').split('.')[0];
    await mutate((next) => {
      const session = next.sessions.find((item) => item.sid === sid && item.userId === user.id);
      if (session) session.lastSeen = Date.now();
    });
    // Login terbaru akun lain (bukan diri sendiri) untuk titik merah menu Aktivitas Akun.
    const latestLoginAt = (store.loginHistory || [])
      .filter((entry) => entry.userId !== user.id)
      .reduce((max, entry) => (!max || String(entry.createdAt || '') > max ? String(entry.createdAt) : max), null);
    return sendJson(res, 200, { ok: true, latestLoginAt });
  }
  if (route === 'GET /api/pairing/status') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    const pairing = await pairingManager.getStatusWithUnlink(user.id);
    if (pairing) return sendJson(res, 200, { pairing });
    // Tidak ada state in-memory tapi file sesi masih tersimpan di disk:
    // bedakan dari 'belum pernah taut' supaya member tidak disuruh pairing
    // ulang — yang benar adalah Sambungkan ulang.
    const saved = await pairingManager.getSavedSessionInfo(user.id);
    if (saved?.usable) {
      const lastUnlink = await pairingManager.getLastUnlink(user.id).catch(() => null);
      return sendJson(res, 200, { pairing: {
        status: 'tersimpan', method: 'pairing', code: null, qrDataUrl: null,
        maskedPhone: saved.maskedPhone, phoneNumber: null, expiresAt: null,
        reconnectAttempts: 0, reconnectFailures: 0, lastUnlink, workerStatus: 'stopped', workerStartedAt: null,
      } });
    }
    return sendJson(res, 200, { pairing: null });
  }
  if (route === 'POST /api/pairing/cancel') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    try {
      const result = await pairingManager.cancelPending(user.id);
      return sendJson(res, 200, result);
    } catch (error) {
      const status = error instanceof PairingError ? error.status : 502;
      const message = error instanceof PairingError ? error.message : 'Pairing code belum dapat dibatalkan.';
      return sendError(res, status, message);
    }
  }
  if (route === 'POST /api/pairing/stop') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    const pairing = await pairingManager.stop(user.id);
    return sendJson(res, 200, { pairing });
  }
  if (route === 'POST /api/pairing/resume') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    try {
      return await withMemberLifecycleLock(user.id, async () => {
        const freshUser = store.users.find((item) => item.id === user.id);
        if (!freshUser) return sendError(res, 401, 'Silakan masuk kembali.');
        if (isBannedAccount(freshUser)) return sendJson(res, 403, { error: BANNED_LOGIN_NOTICE, banned: true });
        const pairing = await pairingManager.resume(user.id);
        return sendJson(res, 200, { pairing });
      });
    } catch (error) {
      const status = error instanceof PairingError ? error.status : 502;
      const message = error instanceof PairingError ? error.message : 'Sesi belum dapat disambungkan ulang.';
      return sendError(res, status, message);
    }
  }
  if (route === 'DELETE /api/pairing/session') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    try {
      // Kunci lifecycle yang sama dengan resume/start: hapus sesi tidak boleh
      // bentrok dengan sambung ulang atau start bot yang sedang berjalan.
      return await withMemberLifecycleLock(user.id, async () => {
        const freshUser = store.users.find((item) => item.id === user.id);
        if (!freshUser) return sendError(res, 401, 'Silakan masuk kembali.');
        const pairing = await pairingManager.deleteSession(user.id);
        return sendJson(res, 200, { pairing });
      });
    } catch (error) {
      const status = error instanceof PairingError ? error.status : 502;
      const message = error instanceof PairingError ? error.message : 'Sesi WhatsApp belum dapat dihapus.';
      return sendError(res, status, message);
    }
  }
  if (['POST /api/bot/start', 'POST /api/bot/restart', 'POST /api/bot/stop'].includes(route)) {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    try {
      const action = route.split('/').at(-1);
      return await withMemberLifecycleLock(user.id, async () => {
        const freshUser = store.users.find((item) => item.id === user.id);
        if (!freshUser) return sendError(res, 401, 'Silakan masuk kembali.');
        if (isBannedAccount(freshUser)) return sendJson(res, 403, { error: BANNED_LOGIN_NOTICE, banned: true });
        const pairing = action === 'start'
          ? await pairingManager.startBot(user.id)
          : action === 'restart'
            ? await pairingManager.restartBot(user.id)
            : await pairingManager.stopBot(user.id);
        await mutate((next) => {
          const bot = next.bots.find((item) => item.userId === user.id);
          if (bot) { bot.autoStart = action !== 'stop'; bot.updatedAt = new Date().toISOString(); }
        });
        return sendJson(res, 200, { pairing, autoStart: action !== 'stop' });
      });
    } catch (error) {
      const status = error instanceof PairingError ? error.status : 502;
      const message = error instanceof PairingError ? error.message : 'Bot worker belum dapat diubah.';
      return sendError(res, status, message);
    }
  }
  if (route === 'GET /api/pairing/logs') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    const logs = (store.pairingLogs || []).filter((entry) => entry.userId === user.id).slice(-100).map(({ id, event, details, createdAt }) => ({ id, event, ...(details?.kind === 'story' ? { details } : {}), createdAt }));
    return sendJson(res, 200, { logs });
  }
  // --- Obrolan: chat realtime semua akun (Admin Utama, admin, member) ---
  // Pesan hanya teks + emoji (tanpa media). Disimpan rapi di data/Obrolan.json,
  // maksimal 200 pesan terakhir; GET mengembalikan 100 terakhir + siapa yang
  // sedang mengetik.
  if (route === 'GET /api/chat/messages') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    // Avatar (dan nama) pengirim diambil dari data akun saat ini, bukan dari
    // foto yang tersimpan saat pesan dikirim — kalau tidak, pesan lama tetap
    // memakai avatar lama walau pemiliknya sudah ganti foto di Profil akun.
    const messages = chatStore.messages.slice(-100).map((message) => {
      const sender = store.users.find((item) => item.id === message.userId);
      if (!sender) return message;
      return {
        ...message,
        displayName: sender.displayName || sender.username,
        avatar: sender.avatar === 'uploaded' ? 'uploaded' : (AVATAR_PRESETS.has(sender.avatar) ? sender.avatar : 'avatar-01'),
        role: sender.role,
        isMainAdmin: isMainAdmin(sender),
      };
    });
    const now = Date.now();
    const typing = [...chatTyping.values()]
      // Selama orang terus mengetik, tiap ketikan memperbarui jendela 12
      // detiknya, jadi indikator tampil realtime selama mengetik dan hilang
      // sendiri 12 detik setelah berhenti (atau langsung saat pesannya terkirim).
      .filter((entry) => entry.userId !== user.id && entry.until > now)
      .map(({ userId, username, displayName, avatar, role, isMainAdmin }) => ({ userId, username, displayName, avatar, role, isMainAdmin }));
    return sendJson(res, 200, { messages, typing });
  }
  if (route === 'POST /api/chat/messages') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    const freshUser = store.users.find((item) => item.id === user.id);
    if (!freshUser) return sendError(res, 401, 'Silakan masuk kembali.');
    if (isBannedAccount(freshUser)) return sendJson(res, 403, { error: BANNED_LOGIN_NOTICE, banned: true });
    const body = await readJson(req);
    const text = String(body.text || '').trim();
    if (!text) return sendError(res, 400, 'Tulis pesan dulu.');
    if (text.length > 1000) return sendError(res, 400, 'Pesan maksimal 1000 karakter.');
    const lastSend = chatSendTimes.get(user.id) || 0;
    if (Date.now() - lastSend < 1000) return sendError(res, 429, 'Terlalu cepat, tunggu sebentar.');
    let replyTo = null;
    if (body.replyToId) {
      const original = chatStore.messages.find((item) => item.id === String(body.replyToId));
      if (!original) return sendError(res, 400, 'Pesan yang dibalas tidak ditemukan.');
      replyTo = { id: original.id, userId: original.userId, username: original.username, displayName: original.displayName, text: String(original.text || '').slice(0, 200), role: original.role || 'member', isMainAdmin: Boolean(original.isMainAdmin) };
    }
    const message = {
      id: randomUUID(),
      userId: freshUser.id,
      username: freshUser.username,
      displayName: freshUser.displayName || freshUser.username,
      avatar: freshUser.avatar === 'uploaded' ? 'uploaded' : (AVATAR_PRESETS.has(freshUser.avatar) ? freshUser.avatar : 'avatar-01'),
      role: freshUser.role,
      isMainAdmin: isMainAdmin(freshUser),
      text,
      replyTo,
      createdAt: new Date().toISOString(),
    };
    chatStore.messages = [...chatStore.messages, message].slice(-CHAT_MAX_MESSAGES);
    await saveChatMessages();
    chatSendTimes.set(user.id, Date.now());
    chatTyping.delete(user.id);
    return sendJson(res, 200, { message });
  }
  if (route === 'POST /api/chat/messages/delete') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    const body = await readJson(req);
    const id = String(body.id || '');
    const index = chatStore.messages.findIndex((item) => item.id === id);
    if (index === -1) return sendError(res, 404, 'Pesan tidak ditemukan.');
    const target = chatStore.messages[index];
    // Pesan sendiri boleh dihapus siapa pun; pesan orang lain hanya Admin Utama.
    if (target.userId !== user.id && !isMainAdmin(user)) return sendError(res, 403, 'Hanya pemilik pesan atau Admin Utama yang bisa menghapus pesan ini.');
    chatStore.messages.splice(index, 1);
    await saveChatMessages();
    return sendJson(res, 200, { ok: true });
  }
  if (route === 'POST /api/chat/typing') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    const body = await readJson(req);
    if (body.typing === true) {
      // Jendela typing 12 detik, bukan 5: poll penerima tiap 5 detik dan
      // satu poll yang terlewat (permintaan masih jalan / panel sibuk) tidak
      // boleh menghilangkan indikator — dengan 5 detik, sekali poll kelewat
      // saja typing sudah tidak pernah terlihat walau orangnya masih mengetik.
      // Tiap ketikan memperbarui jendela ini, jadi indikator tampil realtime
      // selama orang mengetik tanpa batas durasi dari mulai mengetik.
      const now = Date.now();
      chatTyping.set(user.id, { userId: user.id, username: user.username, displayName: user.displayName || user.username, avatar: user.avatar === 'uploaded' ? 'uploaded' : (AVATAR_PRESETS.has(user.avatar) ? user.avatar : 'avatar-01'), role: user.role, isMainAdmin: isMainAdmin(user), until: now + CHAT_TYPING_WINDOW_MS });
    } else {
      chatTyping.delete(user.id);
    }
    return sendJson(res, 200, { ok: true });
  }
  if (route === 'POST /api/pairing/start') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    const body = await readJson(req);
    if (body.confirmOwnership !== true) return sendError(res, 400, 'Konfirmasikan bahwa kamu menguasai akun WhatsApp tersebut.');
    if (body.confirmAutoReaction !== true) return sendError(res, 400, 'Setujui pemberitahuan mode otomatis ReadSW sebelum pairing.');
    let pairingInput;
    try {
      pairingInput = normalizePairingInput(body.method, body.phoneNumber);
    } catch (error) {
      const status = error instanceof PairingError ? error.status : 400;
      return sendError(res, status, error.message);
    }
    const { method, phoneNumber } = pairingInput;
    try {
      return await withMemberLifecycleLock(user.id, async () => {
        const freshUser = store.users.find((item) => item.id === user.id);
        if (!freshUser) return sendError(res, 401, 'Silakan masuk kembali.');
        if (isBannedAccount(freshUser)) return sendJson(res, 403, { error: BANNED_LOGIN_NOTICE, banned: true });
        const pairing = await pairingManager.start(user.id, phoneNumber, method);
        return sendJson(res, 200, { pairing });
      });
    } catch (error) {
      const status = error instanceof PairingError ? error.status : 502;
      const message = error instanceof PairingError ? error.message : 'Pairing belum dapat dimulai. Coba lagi nanti.';
      return sendError(res, status, message);
    }
  }
  if (route === 'GET /api/me') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    return sendJson(res, 200, { user: publicUser(user) });
  }
  if (route === 'GET /api/me/avatar') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    if (user.avatar !== 'uploaded') return sendError(res, 404, 'Avatar unggahan belum tersedia.');
    const dir = accountFolder(user.username);
    if (!dir) return sendError(res, 404, 'Data akun tidak ditemukan.');
    try {
      const mime = ['image/png', 'image/jpeg', 'image/webp'].includes(user.avatarMime) ? user.avatarMime : 'image/webp';
      const imagePath = user.avatarMime ? path.join(dir, 'avatar.upload') : path.join(dir, 'avatar.webp');
      const image = await fs.readFile(imagePath);
      setHeaders(res, true);
      res.writeHead(200, { 'Content-Type': mime, 'Content-Length': image.length, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' });
      res.end(image);
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return sendError(res, 404, 'Avatar unggahan belum tersedia.');
    }
  }
  if (route === 'POST /api/me/avatar') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    if (!allowRateLimit(`avatar:${user.id}`, 12, 60 * 60 * 1000)) return sendError(res, 429, 'Terlalu banyak mengganti avatar. Coba lagi nanti.');
    const upload = await readAvatarUpload(req, MAX_AVATAR_BYTES);
    const dir = accountFolder(user.username);
    if (!dir) return sendError(res, 400, 'Nama folder akun tidak valid.');
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.chmod(dir, 0o700).catch(() => {});
    const destination = path.join(dir, 'avatar.upload');
    const temporary = `${destination}.${randomBytes(6).toString('hex')}.tmp`;
    await fs.writeFile(temporary, upload.image, { mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, destination);
    await fs.chmod(destination, 0o600).catch(() => {});
    await fs.rm(path.join(dir, 'avatar.webp'), { force: true }).catch(() => {});
    const updated = await mutate((next) => {
      const record = next.users.find((item) => item.id === user.id);
      if (!record) return null;
      record.avatar = 'uploaded';
      record.avatarMime = upload.mime;
      record.avatarUpdatedAt = new Date().toISOString();
      return publicUser(record);
    }, { requireAccountSync: true });
    if (!updated) return sendError(res, 401, 'Silakan masuk kembali.');
    return sendJson(res, 200, { user: updated });
  }
  if (route === 'GET /api/me/logins') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    const sid = (parseCookies(req).readsw_session || '').split('.')[0] || null;
    const logins = (store.loginHistory || [])
      .filter((entry) => entry.userId === user.id)
      .slice(-20)
      .reverse()
      .map((entry) => ({
        id: entry.id,
        ip: entry.ip,
        device: entry.device,
        deviceLabel: deviceLabel(entry.device),
        createdAt: entry.createdAt,
        current: Boolean(sid && entry.sid && entry.sid === sid),
      }));
    return sendJson(res, 200, { logins });
  }
  if (route === 'PATCH /api/me') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    const body = await readJson(req);
    const displayName = body.displayName === undefined ? user.displayName : String(body.displayName || '').trim();
    if (displayName.length < 2 || displayName.length > 40) return sendError(res, 400, 'Nama tampilan harus 2–40 karakter.');
    const avatar = body.avatar === undefined ? (user.avatar || 'avatar-01') : String(body.avatar);
    if (body.avatar !== undefined && !AVATAR_PRESETS.has(avatar)) return sendError(res, 400, 'Pilih salah satu avatar bawaan yang tersedia.');
    const updated = await mutate((next) => {
      const record = next.users.find((item) => item.id === user.id);
      if (!record) return null;
      record.displayName = displayName;
      record.avatar = avatar;
      if (body.avatar !== undefined) delete record.avatarMime;
      record.avatarUpdatedAt = new Date().toISOString();
      return publicUser(record);
    }, { requireAccountSync: body.avatar !== undefined });
    if (!updated) return sendError(res, 401, 'Silakan masuk kembali.');
    if (body.avatar !== undefined && user.avatar === 'uploaded') {
      const dir = accountFolder(user.username);
      if (dir) {
        await fs.rm(path.join(dir, 'avatar.webp'), { force: true }).catch(() => {});
        await fs.rm(path.join(dir, 'avatar.upload'), { force: true }).catch(() => {});
      }
    }
    return sendJson(res, 200, { user: updated });
  }
  if (route === 'GET /api/bot') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    const bot = botForUser(user.id);
    const storyMode = bot?.mode === 'online24' ? 'readonly' : bot?.mode;
    const storySettings = bot ? normalizeStorySettings(bot.storySettings, storyMode) : null;
    return sendJson(res, 200, { bot: bot ? { ...bot, mode: storyMode, online24: bot.online24 === true || bot.mode === 'online24', storySettings: storySettings?.error ? normalizeStorySettings(undefined, storyMode) : storySettings } : null });
  }
  if (route === 'PUT /api/bot') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    const input = validateBotSettings(await readJson(req));
    if (input.error) return sendError(res, 400, input.error);
    return await withMemberLifecycleLock(user.id, async () => {
      const freshUser = store.users.find((item) => item.id === user.id);
      if (!freshUser) return sendError(res, 401, 'Silakan masuk kembali.');
      if (isBannedAccount(freshUser)) return sendJson(res, 403, { error: BANNED_LOGIN_NOTICE, banned: true });
      const bot = await mutate((next) => {
        let record = next.bots.find((item) => item.userId === user.id);
        const storySettings = input.storySettings || normalizeStorySettings(record?.storySettings, input.mode);
        if (storySettings.error) return { error: storySettings.error };
        if (!record) {
          record = { id: randomUUID(), userId: user.id, createdAt: new Date().toISOString(), runnerStatus: 'not_connected', autoStart: false };
          next.bots.push(record);
        }
        record.label = input.label;
        record.mode = input.mode;
        record.online24 = input.online24 === true;
        record.storySettings = storySettings;
        record.autoStart = record.autoStart === true;
        record.updatedAt = new Date().toISOString();
        // This prototype saves preferences only; it never claims that WhatsApp is connected.
        record.runnerStatus = 'not_connected';
        return { id: record.id, label: record.label, mode: record.mode, online24: record.online24, storySettings: record.storySettings, autoStart: record.autoStart === true, runnerStatus: record.runnerStatus, updatedAt: record.updatedAt };
      });
      if (bot.error) return sendError(res, 400, bot.error);
      const pairing = await pairingManager.setOnline24(user.id, input.online24);
      return sendJson(res, 200, { bot, pairing });
    });
  }
  if (route === 'GET /api/admin/user-avatar') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    // Foto unggahan boleh dilihat semua akun yang login (admin maupun
    // member), bukan cuma admin — jadi foto profil tiap akun tampil apa
    // adanya di Daftar Member, Aktivitas Akun, Rank Bot, dan Obrolan.
    const targetId = String(url.searchParams.get('userId') || '');
    if (!targetId) return sendError(res, 400, 'ID akun tidak valid.');
    const target = store.users.find((item) => item.id === targetId);
    if (!target || target.avatar !== 'uploaded') return sendError(res, 404, 'Avatar unggahan tidak ditemukan.');
    const dir = accountFolder(target.username);
    if (!dir) return sendError(res, 404, 'Data akun tidak ditemukan.');
    try {
      const mime = ['image/png', 'image/jpeg', 'image/webp'].includes(target.avatarMime) ? target.avatarMime : 'image/webp';
      const imagePath = target.avatarMime ? path.join(dir, 'avatar.upload') : path.join(dir, 'avatar.webp');
      const image = await fs.readFile(imagePath);
      setHeaders(res, true);
      res.writeHead(200, { 'Content-Type': mime, 'Content-Length': image.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(image);
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return sendError(res, 404, 'Avatar unggahan tidak ditemukan.');
    }
  }
  if (route === 'POST /api/admin/users/bot') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    if (user.role !== 'admin') return sendError(res, 403, 'Akses admin diperlukan.');
    const body = await readJson(req);
    const targetId = String(body.userId || '').slice(0, 128);
    const target = store.users.find((item) => item.id === targetId);
    const permissionError = botControlPolicyError(user, target, process.env.BOOTSTRAP_ADMIN_USERNAME);
    if (permissionError) return sendError(res, permissionError.status, permissionError.message);
    const action = String(body.action || '');
    if (!['start', 'restart', 'stop'].includes(action)) return sendError(res, 400, 'Aksi bot tidak dikenal.');
    if (action !== 'stop' && body.confirmActivity !== true) return sendError(res, 400, 'Konfirmasikan bahwa Anda berwenang menjalankan bot untuk member ini.');
    try {
      return await withMemberLifecycleLock(targetId, async () => {
        const freshTarget = store.users.find((item) => item.id === targetId);
        const currentPermissionError = botControlPolicyError(user, freshTarget, process.env.BOOTSTRAP_ADMIN_USERNAME);
        if (currentPermissionError) return sendError(res, currentPermissionError.status, currentPermissionError.message);
        if (isBannedAccount(freshTarget) && action !== 'stop') return sendError(res, 409, 'Akun member sedang diblokir. Buka blokir dahulu sebelum menjalankan bot.');
        const current = pairingManager.getState(targetId);
        if (action !== 'stop' && current?.status !== 'linked') return sendError(res, 409, 'Member harus menautkan WhatsApp sendiri sebelum bot dapat dijalankan.');
        let pairing = current;
        if (action === 'start') pairing = await pairingManager.startBot(targetId);
        else if (action === 'restart') pairing = await pairingManager.restartBot(targetId);
        else if (current) pairing = await pairingManager.stopBot(targetId);
        const autoStart = action !== 'stop';
        const workerStatus = pairing?.workerStatus || (autoStart ? 'running' : 'stopped');
        const updatedAt = new Date().toISOString();
        await mutate((next) => {
          if (!Array.isArray(next.bots)) next.bots = [];
          let bot = next.bots.find((item) => item.userId === targetId);
          if (!bot && autoStart) {
            bot = {
              id: randomUUID(), userId: targetId, label: `${freshTarget.displayName || freshTarget.username} bot`,
              mode: 'readonly_readsw', storySettings: normalizeStorySettings(undefined, 'readonly_readsw'),
              autoStart: true, runnerStatus: workerStatus, createdAt: updatedAt, updatedAt,
            };
            next.bots.push(bot);
          } else if (bot) {
            bot.autoStart = autoStart;
            bot.runnerStatus = workerStatus;
            bot.updatedAt = updatedAt;
          }
          if (!Array.isArray(next.adminAudit)) next.adminAudit = [];
          next.adminAudit.push({ id: randomUUID(), actorId: user.id, targetId, action: `bot_${action}`, createdAt: updatedAt });
          if (next.adminAudit.length > 500) next.adminAudit.splice(0, next.adminAudit.length - 500);
        });
        const state = pairingManager.getState(targetId) || pairing;
        return sendJson(res, 200, {
          ok: true, action, autoStart,
          workerStatus: state?.workerStatus || 'stopped',
          workerStartedAt: state?.workerStartedAt || null,
        });
      });
    } catch (error) {
      const status = error instanceof PairingError ? error.status : 502;
      const message = error instanceof PairingError ? error.message : 'Kontrol bot member belum dapat diterapkan.';
      return sendError(res, status, message);
    }
  }

  if (route === 'POST /api/admin/users/session/delete') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    if (user.role !== 'admin') return sendError(res, 403, 'Akses admin diperlukan.');
    const body = await readJson(req);
    const targetId = String(body.userId || '').slice(0, 128);
    const target = store.users.find((item) => item.id === targetId);
    const permissionError = botControlPolicyError(user, target, process.env.BOOTSTRAP_ADMIN_USERNAME);
    if (permissionError) return sendError(res, permissionError.status, permissionError.message);
    if (body.confirm !== true) return sendError(res, 400, 'Konfirmasi hapus sesi diperlukan.');
    try {
      return await withMemberLifecycleLock(targetId, async () => {
        const freshTarget = store.users.find((item) => item.id === targetId);
        const currentPermissionError = botControlPolicyError(user, freshTarget, process.env.BOOTSTRAP_ADMIN_USERNAME);
        if (currentPermissionError) return sendError(res, currentPermissionError.status, currentPermissionError.message);
        await pairingManager.deleteSession(targetId);
        await mutate((next) => {
          if (!Array.isArray(next.adminAudit)) next.adminAudit = [];
          next.adminAudit.push({ id: randomUUID(), actorId: user.id, targetId, action: 'bot_session_delete', createdAt: new Date().toISOString() });
          if (next.adminAudit.length > 500) next.adminAudit.splice(0, next.adminAudit.length - 500);
        });
        return sendJson(res, 200, { ok: true, pairing: pairingManager.getState(targetId) || null });
      });
    } catch (error) {
      const status = error instanceof PairingError ? error.status : 502;
      const message = error instanceof PairingError ? error.message : 'Sesi WhatsApp member belum dapat dihapus.';
      return sendError(res, status, message);
    }
  }

  if (route === 'PUT /api/admin/users/bot-settings') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    if (user.role !== 'admin') return sendError(res, 403, 'Akses admin diperlukan.');
    const body = await readJson(req);
    const targetId = String(body.userId || '').slice(0, 128);
    const target = store.users.find((item) => item.id === targetId);
    const permissionError = botControlPolicyError(user, target, process.env.BOOTSTRAP_ADMIN_USERNAME);
    if (permissionError) return sendError(res, permissionError.status, permissionError.message);
    if (!String(body.label || '').trim()) {
      const existing = botForUser(targetId);
      body.label = existing?.label || `${target.displayName || target.username} bot`;
    }
    const input = validateBotSettings(body);
    if (input.error) return sendError(res, 400, input.error);
    return await withMemberLifecycleLock(targetId, async () => {
      const freshTarget = store.users.find((item) => item.id === targetId);
      const currentPermissionError = botControlPolicyError(user, freshTarget, process.env.BOOTSTRAP_ADMIN_USERNAME);
      if (currentPermissionError) return sendError(res, currentPermissionError.status, currentPermissionError.message);
      if (isBannedAccount(freshTarget)) return sendJson(res, 403, { error: BANNED_LOGIN_NOTICE, banned: true });
      const bot = await mutate((next) => {
        let record = next.bots.find((item) => item.userId === targetId);
        const storySettings = input.storySettings || normalizeStorySettings(record?.storySettings, input.mode);
        if (storySettings.error) return { error: storySettings.error };
        if (!record) {
          record = { id: randomUUID(), userId: targetId, createdAt: new Date().toISOString(), runnerStatus: 'not_connected', autoStart: false };
          next.bots.push(record);
        }
        record.label = input.label;
        record.mode = input.mode;
        record.online24 = input.online24 === true;
        record.storySettings = storySettings;
        record.autoStart = record.autoStart === true;
        record.updatedAt = new Date().toISOString();
        record.runnerStatus = 'not_connected';
        if (!Array.isArray(next.adminAudit)) next.adminAudit = [];
        next.adminAudit.push({ id: randomUUID(), actorId: user.id, targetId, action: 'bot_settings_update', createdAt: new Date().toISOString() });
        if (next.adminAudit.length > 500) next.adminAudit.splice(0, next.adminAudit.length - 500);
        return { id: record.id, label: record.label, mode: record.mode, online24: record.online24, storySettings: record.storySettings, autoStart: record.autoStart === true, runnerStatus: record.runnerStatus, updatedAt: record.updatedAt };
      });
      if (bot.error) return sendError(res, 400, bot.error);
      const pairing = await pairingManager.setOnline24(targetId, input.online24);
      return sendJson(res, 200, { ok: true, bot, pairing });
    });
  }

  if (route === 'POST /api/admin/users/ban') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    if (user.role !== 'admin') return sendError(res, 403, 'Akses admin diperlukan.');
    const body = await readJson(req);
    const targetId = String(body.userId || '').slice(0, 128);
    const target = store.users.find((item) => item.id === targetId);
    const permissionError = memberAdminPolicyError(user, target, process.env.BOOTSTRAP_ADMIN_USERNAME);
    if (permissionError) return sendError(res, permissionError.status, permissionError.message);
    const action = String(body.action || '');
    if (!['ban', 'unban'].includes(action)) return sendError(res, 400, 'Pilih aksi blokir atau buka blokir.');
    if (action === 'ban' && body.confirm !== true) return sendError(res, 400, 'Konfirmasikan pemblokiran akun member.');
    const reason = normalizeBanReason(body.reason);
    return await withMemberLifecycleLock(targetId, async () => {
      const freshTarget = store.users.find((item) => item.id === targetId);
      const currentPermissionError = memberAdminPolicyError(user, freshTarget, process.env.BOOTSTRAP_ADMIN_USERNAME);
      if (currentPermissionError) return sendError(res, currentPermissionError.status, currentPermissionError.message);
      const now = new Date().toISOString();
      const updated = await mutate((next) => {
        const member = (next.users || []).find((item) => item.id === targetId);
        if (!member) return false;
        // Lapisan kedua di balik memberAdminPolicyError: admin biasa tidak
        // bisa diblokir kecuali oleh Admin Utama; Admin Utama tidak bisa.
        if (member.role === 'admin' && (isMainAdmin(member) || !isMainAdmin(user))) return false;
        if (action === 'ban') {
          member.banned = true;
          member.bannedAt = now;
          member.bannedBy = user.id;
          member.banReason = reason || null;
          next.sessions = (next.sessions || []).filter((session) => session.userId !== targetId);
          const bot = (next.bots || []).find((item) => item.userId === targetId);
          if (bot) { bot.autoStart = false; bot.online24 = false; bot.updatedAt = now; }
        } else {
          member.banned = false;
          member.bannedAt = null;
          member.bannedBy = null;
          member.banReason = null;
          member.unbannedAt = now;
          member.unbannedBy = user.id;
        }
        if (!Array.isArray(next.adminAudit)) next.adminAudit = [];
        next.adminAudit.push({ id: randomUUID(), actorId: user.id, targetId, action, ...(action === 'ban' && reason ? { reason } : {}), createdAt: now });
        if (next.adminAudit.length > 500) next.adminAudit.splice(0, next.adminAudit.length - 500);
        return true;
      });
      if (!updated) return sendError(res, 409, 'Status akun berubah. Muat ulang daftar Member lalu coba lagi.');
      let warning = null;
      if (action === 'ban') {
        const stateBeforeStop = pairingManager.getState(targetId);
        if (stateBeforeStop) {
          try {
            if (['awaiting_code', 'connecting', 'linking'].includes(stateBeforeStop.status)) await pairingManager.stop(targetId);
            else await pairingManager.stopBot(targetId);
          }
          catch { warning = 'Akun sudah diblokir, tetapi worker belum dapat dihentikan otomatis. Periksa status bot member.'; }
        }
        try { await pairingManager.setOnline24(targetId, false); }
        catch { warning = 'Akun sudah diblokir, tetapi status Online 24 Jam belum dapat dihentikan. Periksa status bot member.'; }
      }
      const state = pairingManager.getState(targetId);
      return sendJson(res, 200, {
        ok: true, banned: action === 'ban', bannedAt: action === 'ban' ? now : null,
        banReason: action === 'ban' ? reason || null : null,
        workerStatus: state?.workerStatus || 'stopped', warning,
      });
    });
  }

  if (route === 'POST /api/admin/users/delete') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    if (user.role !== 'admin') return sendError(res, 403, 'Akses admin diperlukan.');
    const body = await readJson(req);
    const targetId = String(body.userId || '').slice(0, 128);
    const target = store.users.find((item) => item.id === targetId);
    if (target && target.id === user.id) return sendError(res, 400, 'Tidak dapat menghapus akun sendiri.');
    const permissionError = memberAdminPolicyError(user, target, process.env.BOOTSTRAP_ADMIN_USERNAME);
    if (permissionError) return sendError(res, permissionError.status, permissionError.message);
    if (body.confirm !== true) return sendError(res, 400, 'Konfirmasikan penghapusan permanen akun member.');
    const reason = normalizeBanReason(body.reason);
    return await withMemberLifecycleLock(targetId, async () => {
      const freshTarget = store.users.find((item) => item.id === targetId);
      if (freshTarget && freshTarget.id === user.id) return sendError(res, 400, 'Tidak dapat menghapus akun sendiri.');
      const currentPermissionError = memberAdminPolicyError(user, freshTarget, process.env.BOOTSTRAP_ADMIN_USERNAME);
      if (currentPermissionError) return sendError(res, currentPermissionError.status, currentPermissionError.message);
      const now = new Date().toISOString();
      const username = freshTarget.username;
      let warning = null;
      const stateBeforeStop = pairingManager.getState(targetId);
      if (stateBeforeStop) {
        try {
          if (['awaiting_code', 'connecting', 'linking'].includes(stateBeforeStop.status)) await pairingManager.stop(targetId);
          else await pairingManager.stopBot(targetId);
        }
        catch { warning = 'Akun sudah dihapus, tetapi worker belum dapat dihentikan otomatis. Periksa status bot member.'; }
      }
      try { await pairingManager.setOnline24(targetId, false); }
      catch { warning = 'Akun sudah dihapus, tetapi status Online 24 Jam belum dapat dihentikan. Periksa status bot member.'; }
      const removed = await mutate((next) => {
        const memberIndex = (next.users || []).findIndex((item) => item.id === targetId);
        if (memberIndex < 0) return false;
        const member = next.users[memberIndex];
        // Lapisan kedua di balik memberAdminPolicyError: admin biasa hanya
        // bisa dihapus oleh Admin Utama; Admin Utama tidak bisa dihapus.
        if (member.role === 'admin' && (isMainAdmin(member) || !isMainAdmin(user))) return false;
        next.users.splice(memberIndex, 1);
        next.sessions = (next.sessions || []).filter((session) => session.userId !== targetId);
        next.bots = (next.bots || []).filter((bot) => bot.userId !== targetId);
        next.loginHistory = (next.loginHistory || []).filter((entry) => entry.userId !== targetId);
        if (!Array.isArray(next.deletedAccounts)) next.deletedAccounts = [];
        next.deletedAccounts.push({
          username: String(member.username || '').toLowerCase(),
          email: String(member.email || '').toLowerCase(),
          deletedAt: now, deletedBy: user.id, reason: reason || null,
        });
        if (next.deletedAccounts.length > 500) next.deletedAccounts.splice(0, next.deletedAccounts.length - 500);
        if (!Array.isArray(next.adminAudit)) next.adminAudit = [];
        next.adminAudit.push({ id: randomUUID(), actorId: user.id, targetId, action: 'delete', ...(reason ? { reason } : {}), createdAt: now });
        if (next.adminAudit.length > 500) next.adminAudit.splice(0, next.adminAudit.length - 500);
        return true;
      });
      if (!removed) return sendError(res, 409, 'Status akun berubah. Muat ulang daftar Member lalu coba lagi.');
      const folder = accountFolder(username);
      if (folder) {
        try { await fs.rm(folder, { recursive: true, force: true }); }
        catch { warning = 'Akun sudah dihapus dari registry, tetapi folder akun belum dapat dihapus. Periksa folder akun member.'; }
      }
      return sendJson(res, 200, { ok: true, deleted: true, username, deletedAt: now, reason: reason || null, warning });
    });
  }

  if (route === 'GET /api/admin/users') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    if (user.role !== 'admin') return sendError(res, 403, 'Akses admin diperlukan.');
    const activeSince = Date.now() - 75_000;
    const users = await Promise.all(store.users.map(async (item) => {
      const last = (store.loginHistory || []).filter((entry) => entry.userId === item.id).at(-1);
      const userSessions = (store.sessions || []).filter((session) => session.userId === item.id);
      const latestPanelSession = [...userSessions]
        .sort((a, b) => Number(b.lastSeen || 0) - Number(a.lastSeen || 0))[0];
      const activeSession = userSessions
        .filter((session) => session.expiresAt > Date.now() && session.lastSeen >= activeSince)
        .sort((a, b) => b.lastSeen - a.lastSeen)[0];
      const lastSeen = latestPanelSession?.lastSeen || (last ? Date.parse(last.createdAt) : null);
      const pairing = pairingManager.getState(item.id);
      const featureStats = await readAccountFeatureStats(item);
      return {
        id: item.id, username: item.username, email: maskedEmail(item.email),
        displayName: item.displayName, role: item.role, verified: item.verified !== false, createdAt: item.createdAt,
        avatar: item.avatar === 'uploaded' ? 'uploaded' : AVATAR_PRESETS.has(item.avatar) ? item.avatar : 'avatar-01',
        avatarUpdatedAt: item.avatarUpdatedAt || null,
        hasBotProfile: (store.bots || []).some((bot) => bot.userId === item.id),
        panelActive: Boolean(activeSession), lastSeen,
        lastSeenSource: latestPanelSession?.lastSeen ? 'panel' : last ? 'login' : null,
        lastLoginAt: last?.createdAt || null,
        whatsappStatus: pairing?.status || 'not_connected',
        whatsappNumberMasked: pairing?.maskedPhone || null,
        workerStatus: pairing?.workerStatus || 'stopped',
        workerStartedAt: pairing?.workerStartedAt || null,
        botAutoStart: (store.bots || []).some((bot) => bot.userId === item.id && bot.autoStart === true),
        botSettings: (() => {
          if (botControlPolicyError(user, item, process.env.BOOTSTRAP_ADMIN_USERNAME)) return null;
          const bot = botForUser(item.id);
          if (!bot) return null;
          const mode = bot.mode === 'online24' ? 'readonly' : bot.mode;
          const storySettings = normalizeStorySettings(bot.storySettings, mode);
          return { label: bot.label ?? null, mode, online24: bot.online24 === true || bot.mode === 'online24', storySettings: storySettings.error ? normalizeStorySettings(undefined, mode) : storySettings };
        })(),
        featureStats,
        banned: isBannedAccount(item),
        bannedAt: item.bannedAt || null,
        banReason: item.banReason || null,
        isMainAdmin: isMainAdmin(item),
      };
    }));
    return sendJson(res, 200, { users });
  }

  if (route === 'GET /api/members') {
    if (!user) return sendError(res, 401, 'Silakan masuk kembali.');
    const activeSince = Date.now() - 75_000;
    const users = await Promise.all((store.users || []).map(async (item) => {
      const last = (store.loginHistory || []).filter((entry) => entry.userId === item.id).at(-1);
      const userSessions = (store.sessions || []).filter((session) => session.userId === item.id);
      const latestPanelSession = [...userSessions]
        .sort((a, b) => Number(b.lastSeen || 0) - Number(a.lastSeen || 0))[0];
      const activeSession = userSessions
        .filter((session) => session.expiresAt > Date.now() && session.lastSeen >= activeSince)
        .sort((a, b) => b.lastSeen - a.lastSeen)[0];
      const pairing = pairingManager.getState(item.id);
      const featureStats = await readAccountFeatureStats(item);
      return {
        id: item.id,
        username: item.username,
        email: maskedEmail(item.email),
        displayName: item.displayName,
        role: item.role === 'admin' ? 'admin' : 'member',
        isMainAdmin: isMainAdmin(item),
        verified: item.verified !== false,
        createdAt: item.createdAt,
        avatar: item.avatar === 'uploaded' ? 'uploaded' : AVATAR_PRESETS.has(item.avatar) ? item.avatar : 'avatar-01',
        avatarUpdatedAt: item.avatarUpdatedAt || null,
        panelActive: Boolean(activeSession),
        lastSeen: latestPanelSession?.lastSeen || null,
        lastSeenSource: latestPanelSession?.lastSeen ? 'panel' : null,
        lastLoginAt: last?.createdAt || null,
        hasBotProfile: (store.bots || []).some((bot) => bot.userId === item.id),
        whatsappStatus: pairing?.status || 'not_connected',
        whatsappNumberMasked: pairing?.maskedPhone || null,
        workerStatus: pairing?.workerStatus || 'stopped',
        workerStartedAt: pairing?.workerStartedAt || null,
        botAutoStart: (store.bots || []).some((bot) => bot.userId === item.id && bot.autoStart === true),
        featureStats,
      };
    }));
    return sendJson(res, 200, { users });
  }

  return sendError(res, 404, 'Endpoint tidak ditemukan.');
}

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml; charset=utf-8']],
  ['/og-image.png', ['og-image.png', 'image/png']],
  ['/fonts/inter-latin.woff2', ['fonts/inter-latin.woff2', 'font/woff2']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/footer.js', ['footer.js', 'text/javascript; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/privacy', ['privacy.html', 'text/html; charset=utf-8']],
  ['/dmca', ['dmca.html', 'text/html; charset=utf-8']],
  ['/terms', ['terms.html', 'text/html; charset=utf-8']],
  ['/vendor/libphonenumber-max.js', ['vendor/libphonenumber-max.js', 'text/javascript; charset=utf-8']],
  ['/manus-routes.json', ['manus-routes.json', 'application/json; charset=utf-8']],
  ['/info-updates.json', ['info-updates.json', 'application/json; charset=utf-8']],
  ['/avatars/avatar-01.webp', ['avatars/avatar-01.webp', 'image/webp']],
  ['/avatars/avatar-02.webp', ['avatars/avatar-02.webp', 'image/webp']],
  ['/avatars/avatar-03.webp', ['avatars/avatar-03.webp', 'image/webp']],
  ['/avatars/avatar-04.webp', ['avatars/avatar-04.webp', 'image/webp']],
  ['/avatars/avatar-05.webp', ['avatars/avatar-05.webp', 'image/webp']],
  ...Array.from({ length: 43 }, (_, index) => {
    const id = `avatar-${String(index + 6).padStart(2, '0')}`;
    return [`/avatars/${id}.webp`, [`avatars/${id}.webp`, 'image/webp']];
  }),
]);

async function handle(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  const asset = assets.get(url.pathname);
  if (!asset || req.method !== 'GET' && req.method !== 'HEAD') {
    setHeaders(res);
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  const [filename, contentType] = asset;
  const content = await fs.readFile(path.join(PUBLIC_DIR, filename));
  let visitorCookie;
  if (req.method === 'GET' && ['/', '/privacy', '/dmca', '/terms'].includes(url.pathname)) {
    await trackVisit(req);
    const cookies = parseCookies(req);
    visitorCookie = cookies.readsw_visitor || randomBytes(24).toString('hex');
    await touchStalker(req, visitorCookie);
  }
  // Aset statis dikirim terkompres (gzip) bila browser memintanya, dan aset
  // yang sudah berversi (?v=...) boleh disimpan browser selama setahun —
  // nomor versinya ganti tiap rilis, jadi deploy baru tetap langsung sampai.
  // Halaman HTML tidak pernah di-cache (titik masuk harus selalu baru).
  const isHtmlPage = ['/', '/privacy', '/dmca', '/terms'].includes(url.pathname);
  const compressible = /^(text\/|application\/(json|javascript))/.test(contentType) || contentType.startsWith('image/svg+xml');
  const acceptsGzip = req.method === 'GET' && compressible && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const body = acceptsGzip ? gzipSync(content) : content;
  setHeaders(res);
  res.setHeader('Cache-Control', !isHtmlPage && url.searchParams.has('v') ? 'public, max-age=31536000, immutable' : 'no-store');
  if (acceptsGzip) {
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
  }
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': body.length,
    ...(visitorCookie ? { 'Set-Cookie': stalkerCookieHeader(visitorCookie) } : {}),
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

await initializeStore();
await loadUptimeState();
startUptimeSaver();
for (const account of store.users) {
  try {
    await pairingManager.resume(account.id);
  } catch (error) {
    if (!(error instanceof PairingError && [404, 409].includes(error.status))) {
      await appendPairingLog(account.id, 'Sesi WhatsApp tersimpan belum dapat dipulihkan otomatis.');
    }
  }
}
const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    if (!res.headersSent) {
      const status = Number(error.status) || 500;
      if (status >= 500) console.error(`[panel] Request failed: ${req.method} ${new URL(req.url || '/', 'http://localhost').pathname}`);
      sendError(res, status, status >= 500 ? 'Terjadi kesalahan server.' : error.message);
    } else {
      res.destroy();
    }
  });
});
server.requestTimeout = 60_000;
server.headersTimeout = 35_000;
server.listen(PORT, HOST, () => {
  console.log(`[panel] ReadSW Console berjalan pada http://${HOST}:${PORT}`);
  console.log('[panel] Sesi WhatsApp dipulihkan per akun; bot worker dikendalikan dari panel akun.');
});

let shutdownStarted = false;
async function shutdown() {
  if (shutdownStarted) return;
  shutdownStarted = true;
  try { await saveUptimeState(); } catch { /* Simpan uptime terakhir sebelum mati. */ }
  try { await pairingManager.shutdown(); } catch { /* Close the panel even if a socket shutdown fails. */ }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
