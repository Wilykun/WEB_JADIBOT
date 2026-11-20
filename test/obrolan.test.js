// Obrolan: chat realtime semua akun (Admin Utama, admin, member) — pesan teks
// + emoji, balas pesan, indikator mengetik, badge notif 99+ per akun. Media
// tidak bisa dikirim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import fs from 'node:fs';
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
const appJs = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const serverJs = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `fungsi tidak ditemukan: ${name}`);
  let depth = 0;
  let i = source.indexOf('{', start);
  for (; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`kurung fungsi tidak seimbang: ${name}`);
}

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `marker awal tidak ditemukan: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, `marker akhir tidak ditemukan: ${endMarker}`);
  return source.slice(start, end);
}

test('Obrolan: menu ada di bawah Profil akun, halaman dan judulnya benar', () => {
  assert.ok(html.includes('<a id="chat-nav" class="nav-item" href="#chat">'), 'menu Obrolan harus ada di sidebar');
  const profilePos = html.indexOf('href="#profile"');
  const chatPos = html.indexOf('href="#chat"');
  assert.ok(profilePos >= 0 && chatPos > profilePos, 'menu Obrolan harus di bawah Profil akun');
  assert.ok(html.includes('>Obrolan</a>'), 'menu harus bernama Obrolan');
  assert.ok(html.includes('<section id="chat" class="chat-page" data-page-view="chat"'), 'halaman Obrolan harus ada');
  assert.ok(html.includes('id="chat-messages"'), 'halaman harus punya daftar pesan');
  assert.ok(html.includes('id="chat-form"'), 'halaman harus punya form kirim');
  assert.ok(html.includes('id="chat-input"'), 'halaman harus punya kolom tulis');
  assert.ok(html.includes('id="chat-send"'), 'halaman harus punya tombol kirim');
  assert.ok(html.includes('id="chat-emoji-toggle"'), 'halaman harus punya tombol emoji');
  assert.ok(html.includes('id="chat-emoji-panel"'), 'halaman harus punya panel emoji');
  assert.ok(html.includes('id="chat-reply-bar"'), 'halaman harus punya bar balasan');
  assert.ok(html.includes('id="chat-typing"'), 'halaman harus punya indikator mengetik');
  assert.ok(html.includes('Media (foto, video, file) tidak bisa dikirim'), 'halaman harus menjelaskan media tidak bisa dikirim');
  const chatSection = html.slice(html.indexOf('<section id="chat"'), html.indexOf('</section>', html.indexOf('<section id="chat"')));
  assert.ok(!chatSection.includes('type="file"'), 'Obrolan tidak boleh punya tombol kirim media');
  assert.ok(appJs.includes("chat: 'Obrolan'"), 'judul halaman chat harus Obrolan');
  assert.ok(css.includes('.chat-bubble'), 'gaya bubble chat harus ada');
  assert.ok(css.includes('.chat-row.is-own'), 'pesan sendiri harus di kanan');
  assert.ok(css.includes('.chat-role-chip.is-main-admin'), 'chip Admin Utama harus ada');
});

test('Obrolan: label peran dan ikon SVG sesuai konteks', () => {
  const src = [
    extractFunction(appJs, 'chatRoleLabel'),
    extractFunction(appJs, 'chatRoleIconName'),
  ].join('\n');
  const { chatRoleLabel, chatRoleIconName } = new Function(`${src}; return { chatRoleLabel, chatRoleIconName };`)();
  assert.equal(chatRoleLabel({ isMainAdmin: true, role: 'admin' }), 'Admin Utama');
  assert.equal(chatRoleLabel({ isMainAdmin: false, role: 'admin' }), 'Admin');
  assert.equal(chatRoleLabel({ isMainAdmin: false, role: 'member' }), 'Member');
  assert.equal(chatRoleIconName({ isMainAdmin: true, role: 'admin' }), 'crown');
  assert.equal(chatRoleIconName({ isMainAdmin: false, role: 'admin' }), 'shield');
  assert.equal(chatRoleIconName({ isMainAdmin: false, role: 'member' }), 'user');
  assert.ok(appJs.includes("createMemberIcon(chatRoleIconName(message))"), 'bubble harus memakai ikon peran SVG yang sama dengan daftar Member');
});

test('Obrolan: hitungan pesan baru hanya dari orang lain setelah penanda dilihat', () => {
  const src = extractFunction(appJs, 'countNewChatMessages');
  // countNewChatMessages membaca currentUser global; setel lewat parameter eval.
  const me = { id: 'aku' };
  const fn = new Function('currentUser', `${src}; return countNewChatMessages;`)(me);
  const messages = [
    { userId: 'orang', createdAt: '2026-11-20T10:00:00.000Z' },
    { userId: 'aku', createdAt: '2026-11-20T10:01:00.000Z' },
    { userId: 'orang', createdAt: '2026-11-20T10:02:00.000Z' },
  ];
  assert.equal(fn(messages, '2026-11-20T09:59:00.000Z'), 2, 'dua pesan orang lain setelah penanda dihitung');
  assert.equal(fn(messages, '2026-11-20T10:00:30.000Z'), 1, 'pesan sendiri tidak dihitung');
  assert.equal(fn(messages, '2026-11-20T10:02:00.000Z'), 0, 'tidak ada yang baru setelah pesan terakhir');
  assert.equal(fn(messages, null), 0, 'tanpa penanda tidak ada yang dihitung');
});

test('Obrolan: jam pesan memakai WIB dan pembatas hari memakai Hari ini/Kemarin', () => {
  const src = [
    extractFunction(appJs, 'formatChatTime'),
    extractFunction(appJs, 'formatChatDay'),
  ].join('\n');
  const { formatChatTime, formatChatDay } = new Function(`${src}; return { formatChatTime, formatChatDay };`)();
  assert.equal(formatChatTime('2026-11-20T10:00:00.000Z'), '17.00', '10.00 UTC harus tampil 17.00 WIB');
  const now = new Date();
  assert.equal(formatChatDay(now.toISOString()), 'Hari ini', 'pesan hari ini harus berlabel Hari ini');
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  assert.equal(formatChatDay(yesterday.toISOString()), 'Kemarin', 'pesan kemarin harus berlabel Kemarin');
});

test('Obrolan: badge notif di menu, hilang saat halaman dibuka, maks 99+', () => {
  const badge = extractFunction(appJs, 'renderChatBadge');
  assert.ok(badge.includes("document.querySelector('#chat-nav')"), 'badge menempel di menu Obrolan');
  assert.ok(badge.includes("badge.className = 'nav-badge'"), 'badge memakai gaya nav-badge yang sama dengan Log Bot');
  assert.ok(badge.includes("'99+'"), 'badge dibatasi 99+');
  assert.ok(badge.includes('badge?.remove()'), 'badge dihapus saat hitungan nol');
  const markSeen = extractFunction(appJs, 'markChatSeen');
  assert.ok(markSeen.includes('chatUnreadCount = 0'), 'membuka halaman mereset hitungan');
  assert.ok(markSeen.includes('saveChatUnreadCount(0)'), 'membuka halaman menyimpan angka nol');
  assert.ok(markSeen.includes('saveChatSeenAt'), 'membuka halaman menyimpan penanda sudah dilihat');
  assert.ok(markSeen.includes('renderChatBadge(0)'), 'membuka halaman menghapus badge');
  const load = sliceBetween(appJs, 'async function loadChatMessages() {', '\nfunction buildChatMessageRow(');
  assert.ok(load.includes('loadChatUnreadCount()'), 'angka badge dipulihkan dari storage per akun sebelum fetch');
  assert.ok(load.includes('loadChatSeenAt()'), 'penanda sudah dilihat dibaca dari storage per akun');
  assert.ok(load.includes('countNewChatMessages(messages, chatSeenAt)'), 'pesan baru dihitung dari penanda terakhir');
  assert.ok(load.includes("activeWorkspacePage === 'chat'"), 'pesan hanya dirender saat di halaman Obrolan');
  assert.ok(load.includes('saveChatUnreadCount(chatUnreadCount)'), 'angka baru disimpan supaya refresh tidak menghilangkan');
  const page = sliceBetween(appJs, 'function setWorkspacePage(page', "if (page === 'infoupdate') {");
  assert.ok(page.includes("if (page === 'chat') {"), 'membuka halaman chat harus punya cabang sendiri');
  assert.ok(page.includes('markChatSeen();'), 'masuk halaman Obrolan harus menandai sudah dibaca');
  assert.ok(page.includes('startChatPolling();'), 'membuka halaman Obrolan harus memulai poll realtime');
  assert.ok(appJs.includes('markChatSeen: false'), 'pemulihan halaman awal setelah reload tidak boleh menghapus badge');
  assert.ok(appJs.includes('startChatPolling();\n  void loadChatMessages();'), 'poll Obrolan jalan sejak login supaya badge bertambah realtime');
  assert.ok(appJs.includes('stopChatPolling();'), 'poll Obrolan berhenti saat keluar');
});

test('Obrolan: kirim, balas, emoji, dan mengetik terpasang di halaman', () => {
  const send = extractFunction(appJs, 'sendChatMessage');
  assert.ok(send.includes("api('/api/chat/messages', { method: 'POST'"), 'kirim harus POST ke /api/chat/messages');
  assert.ok(send.includes('replyToId: chatReplyTo.id'), 'kirim harus menyertakan balasan bila ada');
  assert.ok(send.includes("showToast(error.message || 'Pesan belum terkirim.')"), 'kirim gagal harus memberi tahu');
  const reply = extractFunction(appJs, 'setChatReply');
  assert.ok(reply.includes("document.querySelector('#chat-reply-bar')"), 'balasan harus menampilkan bar balasan');
  assert.ok(reply.includes("document.querySelector('#chat-reply-name')"), 'bar balasan harus menyebut nama yang dibalas');
  assert.ok(appJs.includes("document.querySelector('#chat-emoji-toggle')?.addEventListener('click'"), 'tombol emoji harus membuka panel emoji');
  assert.ok(appJs.includes('initChatEmojiPanel()'), 'panel emoji harus dibangun sekali');
  assert.ok(appJs.includes('CHAT_EMOJIS'), 'daftar emoji harus ada');
  assert.ok(appJs.includes("api('/api/chat/typing', { method: 'POST'"), 'indikator mengetik harus POST ke /api/chat/typing');
  assert.ok(appJs.includes('chatLastTypingSentAt'), 'indikator mengetik harus dibatasi supaya tidak spam');
  assert.ok(appJs.includes("renderChatTyping(Array.isArray(result.typing) ? result.typing : [])"), 'daftar yang sedang mengetik harus dirender dari poll');
  assert.ok(appJs.includes('sedang mengetik'), 'teks indikator mengetik harus ada');
  const row = extractFunction(appJs, 'buildChatMessageRow');
  assert.ok(row.includes('chat-bubble-text'), 'bubble harus punya teks pesan');
  assert.ok(row.includes('textContent = message.text'), 'teks pesan harus lewat textContent (aman dari HTML)');
  assert.ok(row.includes('chat-reply-quote'), 'bubble balasan harus menampilkan kutipan pesan yang dibalas');
  assert.ok(row.includes('↩ Balas'), 'setiap bubble harus punya tombol Balas');
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

test('server Obrolan: kirim + baca + balas + mengetik + batas, hanya untuk yang login', { timeout: 60_000 }, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'readsw-chat-test-'));
  const root = path.join(temp, 'project');
  const dataDir = path.join(root, 'runtime-data');
  const adminPassword = 'FixtureAdmin-Only-Password!';
  const memberPassword = 'FixtureMember-Only-Password!';
  let child;
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
      users: [admin, member], pendingRegistrations: [], bots: [], sessions: [], pairingLogs: [], loginHistory: [], chatMessages: [],
    }));
    const port = await unusedPort();
    const base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [path.join(root, 'server/index.js')], {
      cwd: root,
      env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), PANEL_DATA_DIR: 'runtime-data', SESSION_SECRET: randomBytes(48).toString('base64url'), NODE_ENV: 'test' },
      stdio: 'ignore',
    });
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

    const noAuth = await jsonRequest(base, '/api/chat/messages');
    assert.equal(noAuth.status, 401, 'baca Obrolan tanpa login harus 401');
    const noAuthSend = await jsonRequest(base, '/api/chat/messages', { method: 'POST', body: { text: 'halo' } });
    assert.equal(noAuthSend.status, 401, 'kirim Obrolan tanpa login harus 401');

    const adminLogin = await jsonRequest(base, '/api/auth/login', { method: 'POST', body: { identifier: 'fixtureadmin', password: adminPassword } });
    const memberLogin = await jsonRequest(base, '/api/auth/login', { method: 'POST', body: { identifier: 'fixturemember', password: memberPassword } });
    assert.equal(adminLogin.status, 200);
    assert.equal(memberLogin.status, 200);
    const adminCookie = adminLogin.cookie;
    const memberCookie = memberLogin.cookie;

    const empty = await jsonRequest(base, '/api/chat/messages', { method: 'GET', cookie: memberCookie });
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.payload.messages, [], 'Obrolan awal harus kosong');

    const sendEmpty = await jsonRequest(base, '/api/chat/messages', { method: 'POST', body: { text: '   ' }, cookie: memberCookie });
    assert.equal(sendEmpty.status, 400, 'pesan kosong harus ditolak');
    const sendLong = await jsonRequest(base, '/api/chat/messages', { method: 'POST', body: { text: 'x'.repeat(1001) }, cookie: memberCookie });
    assert.equal(sendLong.status, 400, 'pesan di atas 1000 karakter harus ditolak');
    const sendBadReply = await jsonRequest(base, '/api/chat/messages', { method: 'POST', body: { text: 'halo', replyToId: 'tidak-ada' }, cookie: memberCookie });
    assert.equal(sendBadReply.status, 400, 'balasan ke pesan yang tidak ada harus ditolak');

    const sent = await jsonRequest(base, '/api/chat/messages', { method: 'POST', body: { text: 'Halo semua 👋' }, cookie: memberCookie });
    assert.equal(sent.status, 200, 'member harus bisa mengirim pesan');
    assert.equal(sent.payload.message.text, 'Halo semua 👋', 'emoji harus tersimpan sebagai teks');
    assert.equal(sent.payload.message.displayName, 'fixturemember');
    assert.equal(sent.payload.message.role, 'member');
    assert.equal(sent.payload.message.isMainAdmin, false);
    assert.equal(sent.payload.message.replyTo, null);
    assert.ok(sent.payload.message.id, 'pesan harus punya id');
    assert.ok(sent.payload.message.createdAt, 'pesan harus punya waktu');

    const seenByAdmin = await jsonRequest(base, '/api/chat/messages', { method: 'GET', cookie: adminCookie });
    assert.equal(seenByAdmin.payload.messages.length, 1, 'admin harus melihat pesan member');
    assert.equal(seenByAdmin.payload.messages[0].text, 'Halo semua 👋');

    await wait(1100);
    const reply = await jsonRequest(base, '/api/chat/messages', { method: 'POST', body: { text: 'Halo juga!', replyToId: sent.payload.message.id }, cookie: adminCookie });
    assert.equal(reply.status, 200, 'admin harus bisa membalas pesan member');
    assert.equal(reply.payload.message.replyTo.id, sent.payload.message.id, 'balasan harus menunjuk pesan asli');
    assert.equal(reply.payload.message.replyTo.displayName, 'fixturemember', 'balasan harus menyimpan nama pengirim asli');
    assert.equal(reply.payload.message.replyTo.text, 'Halo semua 👋', 'balasan harus menyimpan teks asli');

    const tooFast = await jsonRequest(base, '/api/chat/messages', { method: 'POST', body: { text: 'terlalu cepat' }, cookie: adminCookie });
    assert.equal(tooFast.status, 429, 'kirim dua kali dalam 1 detik harus ditolak supaya tidak spam');
    await wait(1100);
    const afterWait = await jsonRequest(base, '/api/chat/messages', { method: 'POST', body: { text: 'sudah boleh lagi' }, cookie: adminCookie });
    assert.equal(afterWait.status, 200, 'kirim setelah jeda harus boleh');

    const typingOn = await jsonRequest(base, '/api/chat/typing', { method: 'POST', body: { typing: true }, cookie: memberCookie });
    assert.equal(typingOn.status, 200);
    const typingSeen = await jsonRequest(base, '/api/chat/messages', { method: 'GET', cookie: adminCookie });
    assert.equal(typingSeen.payload.typing.length, 1, 'admin harus melihat member sedang mengetik');
    assert.equal(typingSeen.payload.typing[0].username, 'fixturemember');
    const typingSelf = await jsonRequest(base, '/api/chat/messages', { method: 'GET', cookie: memberCookie });
    assert.equal(typingSelf.payload.typing.length, 0, 'pengetik tidak melihat dirinya sendiri sedang mengetik');
    const typingOff = await jsonRequest(base, '/api/chat/typing', { method: 'POST', body: { typing: false }, cookie: memberCookie });
    assert.equal(typingOff.status, 200);
    const typingGone = await jsonRequest(base, '/api/chat/messages', { method: 'GET', cookie: adminCookie });
    assert.equal(typingGone.payload.typing.length, 0, 'berhenti mengetik harus menghilangkan indikator');

    const all = await jsonRequest(base, '/api/chat/messages', { method: 'GET', cookie: memberCookie });
    assert.equal(all.payload.messages.length, 3, 'semua pesan harus tersimpan berurutan');
    assert.equal(all.payload.messages[2].text, 'sudah boleh lagi');
  } finally {
    if (child && child.exitCode === null) child.kill('SIGTERM');
    await rm(temp, { recursive: true, force: true });
  }
});
