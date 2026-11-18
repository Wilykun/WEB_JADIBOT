import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import fs from 'node:fs';
import { cp, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStoredTelegramConfig, validateTelegramChat, validateTelegramConfig } from '../server/telegram-config.js';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
const appJs = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const serverJs = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const VALID_TOKEN = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const UNKNOWN_TOKEN = '999999999:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

function stubFetch(handler) {
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls += 1;
    return handler(String(url), options);
  };
  return { fetchImpl, calls: () => calls };
}

function okJson(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test('validateTelegramConfig: format token buruk tidak menyentuh jaringan', async () => {
  const stub = stubFetch(() => okJson(200, { ok: true, result: { username: 'X' } }));
  const result = await validateTelegramConfig('bukan-token', '123456789', stub.fetchImpl);
  assert.equal(result.tokenValid, false);
  assert.match(result.tokenError, /Format token/);
  assert.equal(stub.calls(), 0, 'token berformat buruk tidak boleh memanggil Telegram sama sekali');
});

test('validateTelegramConfig: format chat ID buruk tetap memeriksa token, tapi getChat dilewati', async () => {
  const stub = stubFetch((url) => {
    assert.match(url, /\/getMe$/, 'hanya getMe yang boleh dipanggil');
    return okJson(200, { ok: true, result: { username: 'FixtureBot' } });
  });
  const result = await validateTelegramConfig(VALID_TOKEN, 'abc', stub.fetchImpl);
  assert.equal(result.tokenValid, true);
  assert.equal(result.botUsername, 'FixtureBot');
  assert.equal(result.chatValid, false);
  assert.match(result.chatError, /Format chat ID/);
  assert.equal(stub.calls(), 1);
});

test('validateTelegramConfig: getMe 401 berarti token tidak valid dan getChat tidak dipanggil', async () => {
  const stub = stubFetch(() => okJson(401, { ok: false, error_code: 401, description: 'Unauthorized' }));
  const result = await validateTelegramConfig(UNKNOWN_TOKEN, '123456789', stub.fetchImpl);
  assert.equal(result.tokenValid, false);
  assert.match(result.tokenError, /Token tidak valid/);
  assert.equal(result.chatValid, false);
  assert.equal(stub.calls(), 1);
});

test('validateTelegramConfig: Telegram tidak terjangkau dilaporkan sebagai token tidak dapat diperiksa', async () => {
  const result = await validateTelegramConfig(VALID_TOKEN, '123456789', async () => { throw new Error('jaringan putus'); });
  assert.equal(result.tokenValid, false);
  assert.match(result.tokenError, /Tidak dapat menghubungi Telegram/);
});

test('validateTelegramConfig: getMe dan getChat ok berarti keduanya valid', async () => {
  const stub = stubFetch((url) => {
    if (url.endsWith('/getMe')) return okJson(200, { ok: true, result: { username: 'FixtureBot' } });
    if (url.includes('/getChat')) return okJson(200, { ok: true, result: { id: 987654321, type: 'private' } });
    throw new Error(`URL tak terduga: ${url}`);
  });
  const result = await validateTelegramConfig(VALID_TOKEN, '987654321', stub.fetchImpl);
  assert.equal(result.tokenValid, true);
  assert.equal(result.chatValid, true);
  assert.equal(result.botUsername, 'FixtureBot');
  assert.equal(stub.calls(), 2);
});

test('validateTelegramConfig: chat not found berarti chat belum valid dengan pesan /start', async () => {
  const stub = stubFetch((url) => {
    if (url.endsWith('/getMe')) return okJson(200, { ok: true, result: { username: 'FixtureBot' } });
    return okJson(400, { ok: false, error_code: 400, description: 'Bad Request: chat not found' });
  });
  const result = await validateTelegramConfig(VALID_TOKEN, '111111111', stub.fetchImpl);
  assert.equal(result.tokenValid, true);
  assert.equal(result.chatValid, false);
  assert.match(result.chatError, /Chat tidak ditemukan/);
  assert.match(result.chatError, /\/start/);
});

test('validateTelegramConfig: bot diblokir berarti chat belum valid dengan pesan buka blokir', async () => {
  const stub = stubFetch((url) => {
    if (url.endsWith('/getMe')) return okJson(200, { ok: true, result: { username: 'FixtureBot' } });
    return okJson(403, { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' });
  });
  const result = await validateTelegramConfig(VALID_TOKEN, '222222222', stub.fetchImpl);
  assert.equal(result.tokenValid, true);
  assert.equal(result.chatValid, false);
  assert.match(result.chatError, /diblokir/);
});

test('validateTelegramChat: chat ok berarti chat valid tanpa memanggil getMe', async () => {
  const stub = stubFetch((url) => {
    assert.match(url, /\/getChat\?chat_id=987654321$/, 'hanya getChat yang boleh dipanggil');
    return okJson(200, { ok: true, result: { id: 987654321, type: 'private' } });
  });
  const result = await validateTelegramChat('987654321', VALID_TOKEN, stub.fetchImpl);
  assert.equal(result.tokenValid, true);
  assert.equal(result.chatValid, true);
  assert.equal(stub.calls(), 1);
});

test('validateTelegramChat: format chat ID buruk tidak menyentuh jaringan', async () => {
  const stub = stubFetch(() => okJson(200, { ok: true, result: {} }));
  const result = await validateTelegramChat('abc', VALID_TOKEN, stub.fetchImpl);
  assert.equal(result.chatValid, false);
  assert.match(result.chatError, /Format chat ID/);
  assert.equal(stub.calls(), 0, 'chat berformat buruk tidak boleh memanggil Telegram sama sekali');
});

test('validateTelegramChat: chat not found dan diblokir dilaporkan sebagai chat belum valid', async () => {
  const notFound = await validateTelegramChat('111111111', VALID_TOKEN, async () => okJson(400, { ok: false, error_code: 400, description: 'Bad Request: chat not found' }));
  assert.equal(notFound.tokenValid, true);
  assert.equal(notFound.chatValid, false);
  assert.match(notFound.chatError, /Chat tidak ditemukan/);
  const blocked = await validateTelegramChat('222222222', VALID_TOKEN, async () => okJson(403, { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }));
  assert.equal(blocked.tokenValid, true);
  assert.equal(blocked.chatValid, false);
  assert.match(blocked.chatError, /diblokir/);
});

test('validateTelegramChat: getChat 401 berarti token tersimpan sudah tidak valid', async () => {
  const result = await validateTelegramChat('987654321', VALID_TOKEN, async () => okJson(401, { ok: false, error_code: 401, description: 'Unauthorized' }));
  assert.equal(result.tokenValid, false);
  assert.match(result.tokenError, /Token tidak valid/);
  assert.equal(result.chatValid, false);
});

test('validateTelegramChat: Telegram tidak terjangkau dilaporkan sebagai chat tidak dapat diperiksa', async () => {
  const result = await validateTelegramChat('987654321', VALID_TOKEN, async () => { throw new Error('jaringan putus'); });
  assert.equal(result.tokenValid, true, 'token tersimpan dianggap masih valid bila jaringannya yang putus');
  assert.equal(result.chatValid, false);
  assert.match(result.chatError, /Tidak dapat menghubungi Telegram/);
});

test('readStoredTelegramConfig: file hilang atau rusak dibaca sebagai kosong', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'readsw-telegram-config-test-'));
  try {
    const missing = await readStoredTelegramConfig(path.join(temp, 'telegram.json'));
    assert.equal(missing.botToken, '');
    assert.equal(missing.chatId, '');
    assert.equal(missing.chatValid, false);
    await writeFile(path.join(temp, 'telegram.json'), '{bukan json');
    const broken = await readStoredTelegramConfig(path.join(temp, 'telegram.json'));
    assert.equal(broken.botToken, '');
    assert.equal(broken.chatValid, false);
    await writeFile(path.join(temp, 'telegram.json'), JSON.stringify({ botToken: VALID_TOKEN, chatId: '987654321', botUsername: 'FixtureBot', chatValid: true, validatedAt: '2026-11-18T00:00:00.000Z' }));
    const stored = await readStoredTelegramConfig(path.join(temp, 'telegram.json'));
    assert.equal(stored.botToken, VALID_TOKEN);
    assert.equal(stored.chatId, '987654321');
    assert.equal(stored.botUsername, 'FixtureBot');
    assert.equal(stored.chatValid, true);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('kartu Kirim ke Telegram punya kolom token + chat ID, pil validasi, dan baris status simpan', () => {
  const card = html.indexOf('Kirim ke Telegram');
  assert.ok(card > -1, 'kartu Kirim ke Telegram harus ada');
  const token = html.match(/<input id="admin-backup-telegram-token"[^>]*>/);
  assert.ok(token, 'harus ada kolom token bot');
  assert.match(token[0], /type="password"/, 'token harus memakai input password supaya tidak terlihat');
  const chat = html.match(/<input id="admin-backup-telegram-chatid"[^>]*>/);
  assert.ok(chat, 'harus ada kolom chat ID');
  assert.match(chat[0], /type="text"/, 'chat ID harus memakai input teks');
  assert.match(chat[0], /inputmode="numeric"/, 'chat ID harus memakai keyboard angka di HP');
  const tokenPill = html.match(/<span id="admin-backup-telegram-token-pill"[^>]*>/);
  const chatPill = html.match(/<span id="admin-backup-telegram-chatid-pill"[^>]*>/);
  assert.ok(tokenPill && chatPill, 'tiap kolom harus punya pil status validasi sendiri');
  assert.match(tokenPill[0], /data-state="idle"/, 'pil token mulai dari Belum diperiksa');
  assert.match(chatPill[0], /data-state="idle"/, 'pil chat mulai dari Belum diperiksa');
  assert.ok(html.includes('id="admin-backup-telegram-save-status"'), 'harus ada baris status simpan otomatis');
  const send = html.indexOf('id="admin-backup-telegram-send"');
  assert.ok(send > html.indexOf('id="admin-backup-telegram-token"'), 'kolom token harus berada sebelum tombol kirim');
  assert.ok(send > html.indexOf('id="admin-backup-telegram-chatid"'), 'kolom chat ID harus berada sebelum tombol kirim');
  const tokenLabel = html.match(/<label for="admin-backup-telegram-token">([\s\S]*?)<\/label>/);
  assert.ok(tokenLabel && tokenLabel[1].includes('@BotFather'), 'label token harus menyebut @BotFather');
});

test('client: token + chat ID tersimpan otomatis (debounce) ke endpoint PUT, tombol kirim hanya aktif bila chat valid', () => {
  assert.match(appJs, /api\/admin\/backup\/telegram-config/, 'client harus memanggil endpoint PUT telegram-config');
  assert.match(appJs, /method:\s*'PUT'/, 'penyimpanan pengaturan harus memakai PUT');
  assert.match(appJs, /setTimeout\(\(\) => void saveTelegramConfig\(botToken, chatId\), 800\)/, 'auto-save harus debounce 800ms setelah berhenti mengetik');
  assert.match(appJs, /initAdminBackupTelegramConfig\(\)/, 'halaman Backup harus memasang auto-save saat dibuka');
  assert.match(appJs, /if \(page === 'backup'\) \{[\s\S]*?initAdminBackupTelegramConfig\(\)/, 'init auto-save harus dipanggil dari hook halaman Backup');
  assert.match(appJs, /button\.disabled = !\(configured && chatValid\)/, 'tombol kirim hanya aktif bila token dan chat sama-sama valid');
  assert.match(appJs, /setTelegramConfigPill\('token', botToken \? 'valid' : 'idle'\)/, 'pil token harus Valid hanya bila kolom token berisi token yang diperiksa');
  assert.match(appJs, /setTelegramConfigPill\('chat', result\.chatValid \? 'valid' : 'invalid'\)/, 'pil chat harus mengikuti hasil validasi chat');
  assert.ok(!appJs.includes("tokenInput.value = "), 'kolom token tidak boleh diisi ulang dari server — token tidak pernah dikembalikan');
});

test('client: status Telegram menampilkan nama bot dan chat tersimpan, dan mengisi ulang chat ID', () => {
  assert.match(appJs, /botUsername/, 'status harus memakai nama bot dari getMe');
  assert.match(appJs, /status\.chatIdValue/, 'status harus memakai chat ID tersimpan untuk mengisi ulang kolom');
  assert.match(appJs, /chatInput\.value = status\.chatIdValue/, 'kolom chat ID harus terisi ulang dari pengaturan tersimpan');
});

test('gaya pil validasi Telegram ada untuk keempat keadaan dan menumpuk rapi di HP', () => {
  assert.ok(css.includes('#backup .telegram-field{'), 'kolom + pil harus dibungkus .telegram-field');
  assert.ok(css.includes('#backup .telegram-pill{'), 'pil status harus punya gaya dasar');
  assert.ok(css.includes('#backup .telegram-pill[data-state="checking"]'), 'pil harus punya keadaan Memeriksa');
  assert.ok(css.includes('#backup .telegram-pill[data-state="valid"]'), 'pil harus punya keadaan Valid');
  assert.ok(css.includes('#backup .telegram-pill[data-state="invalid"]'), 'pil harus punya keadaan Tidak valid');
  assert.match(css, /@media\(max-width:560px\)\{#backup \.telegram-field\{flex-direction:column/, 'di HP kolom dan pil harus menumpuk vertikal');
});

test('kartu Kirim ke Telegram punya tutorial spoiler ambil token + chat ID dan petunjuk token tersimpan', () => {
  const tutorial = html.match(/<details class="telegram-tutorial">([\s\S]*?)<\/details>/);
  assert.ok(tutorial, 'harus ada spoiler tutorial di dalam kartu Kirim ke Telegram');
  const body = tutorial[1];
  assert.match(body, /Cara ambil Token bot &amp; Chat ID/, 'spoiler harus berjudul cara ambil token dan chat ID');
  assert.ok(body.includes('@BotFather'), 'tutorial harus menyebut @BotFather untuk token');
  assert.ok(body.includes('/newbot'), 'tutorial harus menyebut perintah /newbot');
  assert.ok(body.includes('@getmyid_bot'), 'tutorial harus menyebut @getmyid_bot untuk chat ID');
  assert.ok(body.includes('/start'), 'tutorial harus menyebut /start untuk chat ID dan untuk bot backup');
  assert.ok(body.includes('rahasia'), 'tutorial harus mengingatkan token itu rahasia');
  const send = html.indexOf('id="admin-backup-telegram-send"');
  assert.ok(html.indexOf('<details class="telegram-tutorial">') > html.indexOf('id="admin-backup-telegram-save-status"'), 'tutorial harus berada setelah baris status simpan');
  assert.ok(html.indexOf('<details class="telegram-tutorial">') < send, 'tutorial harus berada sebelum tombol kirim');
  const hint = html.match(/<p id="admin-backup-telegram-token-hint"[^>]*>/);
  assert.ok(hint, 'harus ada petunjuk token tersimpan di bawah kolom token');
  assert.match(hint[0], /hidden/, 'petunjuk token tersimpan harus tersembunyi bila belum ada token');
  assert.ok(html.includes('Token sudah tersimpan di server'), 'petunjuk harus menjelaskan token tidak perlu diketik ulang');
});

test('client: mengedit satu kolom hanya mereset pil kolom itu, dan chat saja bisa tersimpan bila token sudah tersimpan', () => {
  assert.match(appJs, /const fields = \[\s*\{\s*input: tokenInput, which: 'token' \}/, 'listener ketik harus membedakan kolom token dan chat');
  assert.match(appJs, /setTelegramConfigPill\(which, 'idle'\)/, 'mengetik harus mereset hanya pil kolom yang diketik');
  assert.match(appJs, /telegramTokenStored/, 'client harus melacak apakah token sudah tersimpan di server');
  assert.match(appJs, /if \(!botToken && !telegramTokenStored\) return;/, 'auto-save boleh jalan dengan chat saja bila token sudah tersimpan');
  assert.match(appJs, /telegramTargetParts/, 'baris status harus dibangun dari potongan supaya nama bot dan chat tidak terpotong');
  assert.match(appJs, /telegram-target-nowrap/, 'nama bot dan chat harus memakai span anti-potong');
  assert.match(appJs, /setTelegramTokenHintVisible\(telegramTokenStored\)/, 'petunjuk token tersimpan harus mengikuti status dari server');
});

test('client: pil token mengikuti isi kolom — kosong berarti Belum diperiksa walau token tersimpan valid', () => {
  const token = html.match(/<input id="admin-backup-telegram-token"[^>]*>/);
  assert.ok(token, 'harus ada kolom token bot');
  const tokenPlaceholder = token[0].match(/placeholder="([^"]*)"/)?.[1] || '';
  assert.ok(!/\d/.test(tokenPlaceholder) && !tokenPlaceholder.includes(':'), 'placeholder token tidak boleh mirip token (angka/titik dua) supaya kolom kosong tidak terlihat terisi');
  const chat = html.match(/<input id="admin-backup-telegram-chatid"[^>]*>/);
  const chatPlaceholder = chat[0].match(/placeholder="([^"]*)"/)?.[1] || '';
  assert.ok(!/\d/.test(chatPlaceholder), 'placeholder chat ID tidak boleh mirip angka supaya kolom kosong tidak terlihat terisi');
  // Saat halaman dimuat, kolom token kosong (tidak pernah diisi ulang) — pil
  // token harus Belum diperiksa walau token tersimpan sudah valid.
  const loadFn = appJs.match(/async function loadAdminBackupTelegramStatus\(\) \{[\s\S]*?\n\}/);
  assert.ok(loadFn, 'fungsi loadAdminBackupTelegramStatus harus bisa diekstrak dari app.js');
  assert.ok(loadFn[0].includes("setTelegramConfigPill('token', 'idle');"), 'saat dimuat pil token harus Belum diperiksa, bukan Valid dari token tersimpan');
  assert.ok(!loadFn[0].includes("setTelegramConfigPill('token', status.configured"), 'pil token saat dimuat tidak boleh mengikuti status tersimpan');
  assert.ok(loadFn[0].includes("setTelegramConfigPill('chat', status.configured ? (status.chatValid ? 'valid' : 'invalid') : 'idle');"), 'pil chat saat dimuat boleh mengikuti chat tersimpan karena kolom chat memang terisi ulang');
  // Setelah simpan berhasil, pil token hanya Valid bila kolom token berisi
  // token yang baru diperiksa; simpan chat saja membuat pil token idle.
  const saveFn = appJs.match(/async function saveTelegramConfig\(botToken, chatId\) \{[\s\S]*?\n\}/);
  assert.ok(saveFn, 'fungsi saveTelegramConfig harus bisa diekstrak dari app.js');
  assert.ok(saveFn[0].includes("setTelegramConfigPill('token', botToken ? 'valid' : 'idle');"), 'pil token setelah simpan harus mengikuti ada tidaknya token di kolom');
});

test('gaya tutorial Telegram dan anti-potong status ada dan muat di HP', () => {
  assert.ok(css.includes('#backup .telegram-target-nowrap{white-space:nowrap}'), 'nama bot dan chat harus dilarang terpotong di tengah');
  assert.ok(css.includes('#backup .telegram-tutorial{'), 'spoiler tutorial harus punya gaya sendiri');
  assert.ok(css.includes('#backup .telegram-tutorial summary{'), 'judul spoiler harus punya gaya sendiri yang menimpa gaya summary global');
  assert.ok(css.includes('#backup .telegram-tutorial ol{'), 'langkah tutorial harus punya gaya daftar sendiri');
  assert.ok(css.includes('#backup .telegram-tutorial code{'), 'perintah Telegram di tutorial harus punya gaya kode sendiri');
  assert.ok(css.includes('#backup .telegram-tutorial[open] .telegram-tutorial-chevron{'), 'panah spoiler harus berputar saat tutorial dibuka');
});

test('versi aset baru terpasang supaya form ini benar-benar sampai ke HP', () => {
  assert.ok(html.includes('/app.js?v=accountactivity-time-20261118'), 'app.js harus memakai ?v=accountactivity-time-20261118');
  assert.ok(html.includes('/style.css?v=accountactivity-time-20261118'), 'style.css harus memakai ?v=accountactivity-time-20261118');
});

test('server: endpoint PUT telegram-config terdaftar dengan batas rate dan auth admin', () => {
  assert.match(serverJs, /route === 'PUT \/api\/admin\/backup\/telegram-config'/, 'endpoint PUT telegram-config harus terdaftar');
  assert.match(serverJs, /admin-backup-telegram-config:\$\{user\.id\}/, 'endpoint harus punya batas rate sendiri');
  assert.match(serverJs, /validateTelegramConfig\(botToken, chatId, fetch/, 'endpoint harus memvalidasi lewat Telegram sebelum menyimpan');
  assert.match(serverJs, /validateTelegramChat\(chatId, stored\.botToken, fetch/, 'endpoint harus bisa memeriksa chat saja dengan token tersimpan');
  assert.match(serverJs, /atomicWriteJson\(TELEGRAM_CONFIG_FILE/, 'pengaturan yang lolos validasi harus disimpan atomik ke data/telegram.json');
  assert.ok(!serverJs.includes('config.json') || !/telegram-config.*config\.json/.test(serverJs), 'endpoint tidak boleh menulis token ke config.json');
});

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

test('server: PUT telegram-config menyimpan hanya bila token valid, dan status mengembalikan nama bot + chatValid', { timeout: 60_000 }, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'readsw-telegram-put-test-'));
  const root = path.join(temp, 'project');
  const dataDir = path.join(root, 'runtime-data');
  const adminPassword = 'FixtureAdmin-Only-Password!';
  const memberPassword = 'FixtureMember-Only-Password!';
  const secret = randomBytes(48).toString('base64url');
  let child;
  let fakeTelegram;
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

    const fakePort = await unusedPort();
    fakeTelegram = http.createServer((req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${fakePort}`);
      const me = url.pathname.match(/^\/bot([^/]+)\/getMe$/);
      const chat = url.pathname.match(/^\/bot([^/]+)\/getChat$/);
      const send = (status, body) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (me) {
        if (me[1] === VALID_TOKEN) return send(200, { ok: true, result: { id: 123456789, username: 'FixtureBackupBot' } });
        return send(401, { ok: false, error_code: 401, description: 'Unauthorized' });
      }
      if (chat) {
        if (chat[1] !== VALID_TOKEN) return send(401, { ok: false, error_code: 401, description: 'Unauthorized' });
        const chatId = url.searchParams.get('chat_id');
        if (chatId === '987654321') return send(200, { ok: true, result: { id: 987654321, type: 'private' } });
        if (chatId === '555555555') return send(200, { ok: true, result: { id: 555555555, type: 'private' } });
        if (chatId === '111111111') return send(400, { ok: false, error_code: 400, description: 'Bad Request: chat not found' });
        if (chatId === '222222222') return send(403, { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' });
        return send(400, { ok: false, error_code: 400, description: 'Bad Request: chat not found' });
      }
      return send(404, { ok: false, description: 'Not Found' });
    });
    await new Promise((resolve) => fakeTelegram.listen(fakePort, '127.0.0.1', resolve));

    const port = await unusedPort();
    const base = `http://127.0.0.1:${port}`;
    const env = {
      ...process.env,
      HOST: '127.0.0.1', PORT: String(port), PANEL_DATA_DIR: 'runtime-data', SESSION_SECRET: secret, NODE_ENV: 'test',
      TELEGRAM_API_BASE_URL: `http://127.0.0.1:${fakePort}`,
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

    const telegramFile = path.join(dataDir, 'telegram.json');
    const adminLogin = await jsonRequest(base, '/api/auth/login', { method: 'POST', body: { identifier: 'fixtureadmin', password: adminPassword } });
    const memberLogin = await jsonRequest(base, '/api/auth/login', { method: 'POST', body: { identifier: 'fixturemember', password: memberPassword } });
    assert.equal(adminLogin.status, 200);
    assert.equal(memberLogin.status, 200);

    const unauthenticated = await jsonRequest(base, '/api/admin/backup/telegram-config', { method: 'PUT', body: { botToken: VALID_TOKEN, chatId: '987654321' } });
    assert.equal(unauthenticated.status, 401);
    const forbidden = await jsonRequest(base, '/api/admin/backup/telegram-config', { method: 'PUT', cookie: memberLogin.cookie, body: { botToken: VALID_TOKEN, chatId: '987654321' } });
    assert.equal(forbidden.status, 403);
    const empty = await jsonRequest(base, '/api/admin/backup/telegram-config', { method: 'PUT', cookie: adminLogin.cookie, body: {} });
    assert.equal(empty.status, 400);
    const emptyToken = await jsonRequest(base, '/api/admin/backup/telegram-config', { method: 'PUT', cookie: adminLogin.cookie, body: { botToken: '', chatId: '987654321' } });
    assert.equal(emptyToken.status, 400, 'token kosong tanpa token tersimpan tetap harus ditolak');
    await assert.rejects(stat(telegramFile), 'token kosong tanpa token tersimpan tidak boleh menulis file');
    const badTokenFormat = await jsonRequest(base, '/api/admin/backup/telegram-config', { method: 'PUT', cookie: adminLogin.cookie, body: { botToken: 'bukan-token', chatId: '987654321' } });
    assert.equal(badTokenFormat.status, 400);
    assert.equal(badTokenFormat.payload.tokenValid, false);
    await assert.rejects(stat(telegramFile), 'token tidak valid tidak boleh menulis file');

    const badChatFormat = await jsonRequest(base, '/api/admin/backup/telegram-config', { method: 'PUT', cookie: adminLogin.cookie, body: { botToken: VALID_TOKEN, chatId: 'abc' } });
    assert.equal(badChatFormat.status, 200, 'token valid + chat berformat buruk tetap tersimpan supaya token tidak perlu diketik ulang');
    assert.equal(badChatFormat.payload.saved, true);
    assert.equal(badChatFormat.payload.chatValid, false);
    let stored = JSON.parse(await readFile(telegramFile, 'utf8'));
    assert.equal(stored.botToken, VALID_TOKEN);
    assert.equal(stored.chatId, 'abc');
    assert.equal(stored.chatValid, false);

    const saved = await jsonRequest(base, '/api/admin/backup/telegram-config', { method: 'PUT', cookie: adminLogin.cookie, body: { botToken: VALID_TOKEN, chatId: '987654321' } });
    assert.equal(saved.status, 200);
    assert.equal(saved.payload.saved, true);
    assert.equal(saved.payload.tokenValid, true);
    assert.equal(saved.payload.chatValid, true);
    assert.equal(saved.payload.botUsername, 'FixtureBackupBot');
    assert.equal(saved.payload.configured, true);
    assert.equal(saved.payload.chatId, '9876…4321');
    stored = JSON.parse(await readFile(telegramFile, 'utf8'));
    assert.equal(stored.botToken, VALID_TOKEN);
    assert.equal(stored.chatId, '987654321');
    assert.equal(stored.botUsername, 'FixtureBackupBot');
    assert.equal(stored.chatValid, true);
    assert.ok(stored.validatedAt, 'waktu validasi harus tersimpan');
    const fileStat = await stat(telegramFile);
    assert.equal(fileStat.mode & 0o777, 0o600, 'file token harus mode 0600');

    const status = await jsonRequest(base, '/api/admin/backup/telegram-status', { cookie: adminLogin.cookie });
    assert.equal(status.status, 200);
    assert.equal(status.payload.configured, true);
    assert.equal(status.payload.chatId, '9876…4321');
    assert.equal(status.payload.chatIdValue, '987654321');
    assert.equal(status.payload.botUsername, 'FixtureBackupBot');
    assert.equal(status.payload.chatValid, true);

    const chatNotFound = await jsonRequest(base, '/api/admin/backup/telegram-config', { method: 'PUT', cookie: adminLogin.cookie, body: { botToken: VALID_TOKEN, chatId: '111111111' } });
    assert.equal(chatNotFound.status, 200);
    assert.equal(chatNotFound.payload.saved, true);
    assert.equal(chatNotFound.payload.chatValid, false);
    assert.match(chatNotFound.payload.chatError, /\/start/);
    stored = JSON.parse(await readFile(telegramFile, 'utf8'));
    assert.equal(stored.chatId, '111111111');
    assert.equal(stored.chatValid, false);

    const blocked = await jsonRequest(base, '/api/admin/backup/telegram-config', { method: 'PUT', cookie: adminLogin.cookie, body: { botToken: VALID_TOKEN, chatId: '222222222' } });
    assert.equal(blocked.status, 200);
    assert.equal(blocked.payload.chatValid, false);
    assert.match(blocked.payload.chatError, /diblokir/);

    const chatOnly = await jsonRequest(base, '/api/admin/backup/telegram-config', { method: 'PUT', cookie: adminLogin.cookie, body: { botToken: '', chatId: '555555555' } });
    assert.equal(chatOnly.status, 200, 'mengubah chat ID saja harus tersimpan tanpa mengetik ulang token');
    assert.equal(chatOnly.payload.saved, true);
    assert.equal(chatOnly.payload.tokenValid, true);
    assert.equal(chatOnly.payload.chatValid, true);
    assert.equal(chatOnly.payload.botUsername, 'FixtureBackupBot');
    stored = JSON.parse(await readFile(telegramFile, 'utf8'));
    assert.equal(stored.botToken, VALID_TOKEN, 'token tersimpan harus dipertahankan saat hanya chat yang diubah');
    assert.equal(stored.chatId, '555555555');
    assert.equal(stored.botUsername, 'FixtureBackupBot');
    assert.equal(stored.chatValid, true);

    const chatOnlyNotFound = await jsonRequest(base, '/api/admin/backup/telegram-config', { method: 'PUT', cookie: adminLogin.cookie, body: { botToken: '', chatId: '111111111' } });
    assert.equal(chatOnlyNotFound.status, 200);
    assert.equal(chatOnlyNotFound.payload.saved, true);
    assert.equal(chatOnlyNotFound.payload.chatValid, false);
    assert.match(chatOnlyNotFound.payload.chatError, /\/start/);
    stored = JSON.parse(await readFile(telegramFile, 'utf8'));
    assert.equal(stored.botToken, VALID_TOKEN);
    assert.equal(stored.chatId, '111111111');
    assert.equal(stored.chatValid, false);

    const unknownToken = await jsonRequest(base, '/api/admin/backup/telegram-config', { method: 'PUT', cookie: adminLogin.cookie, body: { botToken: UNKNOWN_TOKEN, chatId: '987654321' } });
    assert.equal(unknownToken.status, 400);
    assert.equal(unknownToken.payload.saved, false);
    assert.equal(unknownToken.payload.tokenValid, false);
    stored = JSON.parse(await readFile(telegramFile, 'utf8'));
    assert.equal(stored.chatId, '111111111', 'token tidak valid tidak boleh menimpa pengaturan tersimpan');
    assert.equal(stored.botToken, VALID_TOKEN);
  } finally {
    if (child) child.kill();
    if (fakeTelegram) await new Promise((resolve) => fakeTelegram.close(resolve));
    await rm(temp, { recursive: true, force: true });
  }
});
