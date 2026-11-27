// Obrolan: chat realtime semua akun (Admin Utama, admin, member) — pesan teks
// + emoji, balas pesan, indikator mengetik, badge notif tanpa batas per akun. Media
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
  assert.equal(fn(messages, null), 2, 'belum pernah membuka Obrolan: semua pesan orang lain belum dibaca, pesan pertama pun memunculkan notif');
});

test('Obrolan: jam pesan memakai WIB dan pembatas hari memakai Hari ini/Kemarin', () => {
  const src = [
    extractFunction(appJs, 'formatChatTime'),
    extractFunction(appJs, 'formatChatDay'),
  ].join('\n');
  const { formatChatTime, formatChatDay } = new Function(`${src}; return { formatChatTime, formatChatDay };`)();
  assert.equal(formatChatTime('2026-11-20T10:00:00.000Z'), '05.00 PM', '10.00 UTC harus tampil 05.00 PM WIB');
  assert.equal(formatChatTime('2026-11-20T01:00:00.000Z'), '08.00 AM', '01.00 UTC harus tampil 08.00 AM WIB');
  assert.equal(formatChatTime('2026-11-20T17:00:00.000Z'), '12.00 AM', '17.00 UTC harus tampil 12.00 AM WIB');
  const now = new Date();
  assert.equal(formatChatDay(now.toISOString()), 'Hari ini', 'pesan hari ini harus berlabel Hari ini');
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  assert.equal(formatChatDay(yesterday.toISOString()), 'Kemarin', 'pesan kemarin harus berlabel Kemarin');
});

test('Obrolan: badge notif di menu, hilang saat halaman dibuka, tanpa batas', () => {
  const badge = extractFunction(appJs, 'renderChatBadge');
  assert.ok(badge.includes("document.querySelector('#chat-nav')"), 'badge menempel di menu Obrolan');
  assert.ok(badge.includes("badge.className = 'nav-badge'"), 'badge memakai gaya nav-badge yang sama dengan Log Bot');
  assert.ok(badge.includes('badge.textContent = String(chatUnreadCount);'), 'badge menampilkan angka asli tanpa batas');
  assert.ok(!badge.includes("'99+'"), 'badge tidak lagi dibatasi 99+');
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

test('Obrolan: angka badge tersimpan tanpa batas 99', () => {
  const load = extractFunction(appJs, 'loadChatUnreadCount');
  assert.ok(!load.includes('Math.min(99'), 'angka yang dipulihkan tidak dipotong 99');
  const save = extractFunction(appJs, 'saveChatUnreadCount');
  assert.ok(!save.includes('Math.min(99'), 'angka yang disimpan tidak dipotong 99');
  assert.ok(save.includes('Math.max(0, count)'), 'angka nol ke bawah tetap disimpan sebagai nol');
});

test('Obrolan: bar Balas kosong tidak boleh tampil dan kolom ketik harus selalu terlihat di HP', () => {
  // Bar Balas dan panel emoji memakai display:flex/grid — tanpa aturan
  // [hidden], atribut hidden di HTML kalah dan keduanya tampil padahal
  // belum dipakai (bar Balas kosong menutupi kolom ketik di HP).
  assert.ok(css.includes('.chat-reply-bar[hidden]'), 'bar Balas harus punya aturan [hidden]');
  assert.ok(css.includes('.chat-emoji-panel[hidden]'), 'panel emoji harus punya aturan [hidden]');
  assert.ok(css.includes('.chat-typing[hidden]'), 'indikator mengetik harus punya aturan [hidden]');
  assert.match(css, /\.chat-reply-bar\[hidden\][^{]*\{[^}]*display:\s*none\s*!important/, 'aturan [hidden] harus memaksa display:none');
  assert.ok(html.includes('<div id="chat-reply-bar" class="chat-reply-bar" hidden>'), 'bar Balas harus hidden di awal');
  assert.ok(html.includes('<div id="chat-emoji-panel" class="chat-emoji-panel" hidden>'), 'panel emoji harus hidden di awal');
  assert.ok(html.includes('<div id="chat-typing" class="chat-typing" aria-live="polite" hidden>'), 'indikator mengetik harus hidden di awal');
  // Daftar pesan desktop tetap dibatasi supaya hero + daftar + kolom ketik muat.
  // Tingginya dipegang pembungkus (.chat-messages-wrap) supaya tombol @ bisa
  // mengambang di pojok kanan bawah daftar, ala WhatsApp.
  const desktop = css.match(/\.chat-messages-wrap\{[^}]*height:clamp\((\d+)px,(\d+)vh,(\d+)px\)/);
  assert.ok(desktop, 'tinggi daftar pesan desktop harus ada di pembungkusnya');
  assert.ok(Number(desktop[2]) <= 55, `daftar pesan desktop maksimal 55vh, dapat ${desktop[2]}vh`);
  assert.match(css, /\.chat-messages\{[^}]*height:\s*100%/, 'daftar pesan harus mengisi penuh pembungkusnya');
  // Di HP halaman Obrolan setinggi layar (topbar 60px + padding konten 24+20px
  // sudah dikurangi) dan daftar pesan mengisi sisa ruang dengan flex — luas,
  // tapi kolom ketik tetap terlihat karena daftar yang menyusut, bukan halaman
  // yang memanjang.
  assert.match(css, /@media\(max-width:560px\)\{[\s\S]*?\.chat-page\{[^}]*height:calc\(100dvh - 104px\)/, 'halaman Obrolan HP harus setinggi layar dikurangi topbar dan padding');
  assert.match(css, /@media\(max-width:560px\)\{[\s\S]*?\.chat-messages-wrap\{[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0/, 'pembungkus daftar pesan HP harus mengisi sisa ruang dengan min-height 0 supaya bisa menyusut');
  assert.ok(css.includes('.chat-hero-copy p{display:none}'), 'deskripsi hero disembunyikan di HP supaya daftar lebih luas');
  // Kolom ketik menempel di bawah layar supaya selalu terjangkau.
  assert.match(css, /\.chat-composer\{[^}]*position:\s*sticky;bottom:\s*0/, 'kolom ketik harus sticky di bawah layar');
});

test('Obrolan: scroll tidak macet — daftar hanya dirender ulang bila pesan berubah dan posisi scroll dipertahankan', () => {
  const src = extractFunction(appJs, 'chatMessagesSignature');
  const { chatMessagesSignature } = new Function(`${src}; return { chatMessagesSignature };`)();
  const a = [{ id: '1', createdAt: '2026-11-20T10:00:00.000Z' }];
  const b = [{ id: '1', createdAt: '2026-11-20T10:00:00.000Z' }];
  const c = [...a, { id: '2', createdAt: '2026-11-20T10:01:00.000Z' }];
  assert.equal(chatMessagesSignature(a), chatMessagesSignature(b), 'pesan yang sama harus punya tanda yang sama');
  assert.notEqual(chatMessagesSignature(a), chatMessagesSignature(c), 'pesan baru harus mengubah tanda');
  assert.equal(chatMessagesSignature([]), '0:none', 'daftar kosong harus punya tanda sendiri');
  // Ganti avatar saja (tanpa pesan baru) harus mengubah tanda supaya daftar
  // dirender ulang dan foto baru tampil — kalau tidak, pesan lama tetap
  // memakai avatar lama di layar walau profilnya sudah berubah.
  const beforeAvatar = [{ id: '1', userId: 'u1', avatar: 'avatar-01', displayName: 'A', createdAt: '2026-11-20T10:00:00.000Z' }];
  const afterAvatar = [{ id: '1', userId: 'u1', avatar: 'uploaded', displayName: 'A', createdAt: '2026-11-20T10:00:00.000Z' }];
  assert.notEqual(chatMessagesSignature(beforeAvatar), chatMessagesSignature(afterAvatar), 'ganti avatar harus mengubah tanda supaya daftar dirender ulang');
  const afterName = [{ id: '1', userId: 'u1', avatar: 'avatar-01', displayName: 'B', createdAt: '2026-11-20T10:00:00.000Z' }];
  assert.notEqual(chatMessagesSignature(beforeAvatar), chatMessagesSignature(afterName), 'ganti nama tampilan harus mengubah tanda supaya daftar dirender ulang');
  const load = sliceBetween(appJs, 'async function loadChatMessages() {', '\nfunction buildChatMessageRow(');
  assert.ok(load.includes('chatMessagesSignature(messages)'), 'poll harus menghitung tanda daftar pesan');
  assert.ok(load.includes('if (signature !== chatLastRenderedSignature) {'), 'poll hanya merender ulang bila tandanya berubah');
  assert.ok(load.includes('renderChatTyping('), 'indikator mengetik tetap diperbarui walau daftar tidak berubah');
  const render = extractFunction(appJs, 'renderChatMessages');
  assert.ok(render.includes('const previousScrollTop = list.scrollTop;'), 'render harus menyimpan posisi scroll sebelum membangun ulang');
  assert.ok(render.includes('else list.scrollTop = previousScrollTop;'), 'render harus mengembalikan posisi scroll bila pengguna tidak di bawah');
  assert.ok(render.includes('if (wasAtBottom) list.scrollTop = list.scrollHeight;'), 'render tetap menggulir ke bawah bila pengguna sudah di bawah');
});

test('Obrolan: scroll ke bawah tidak macet — daftar mengalir ke halaman dan bubble lebih lebar di HP', () => {
  // overscroll-behavior:contain mematikan scroll halaman saat daftar mencapai
  // ujungnya: pengguna yang scroll di tengah daftar tidak bisa lanjut ke bawah.
  assert.match(css, /\.chat-messages\{[^}]*overscroll-behavior:\s*auto/, 'scroll daftar harus mengalir ke halaman saat mencapai ujung');
  assert.match(css, /@media\(max-width:560px\)\{[\s\S]*?\.chat-row\{max-width:96%/, 'bubble HP harus hampir selebar layar supaya luas');
});

test('Obrolan: avatar pesan diambil dari data akun saat ini, bukan foto lama saat pesan dikirim', () => {
  // GET /api/chat/messages harus menyelesaikan identitas pengirim dari
  // store.users supaya pesan lama ikut ganti foto saat pemiliknya ganti
  // avatar di Profil akun — kalau tidak, Obrolan tetap memakai avatar lama.
  const get = sliceBetween(serverJs, "if (route === 'GET /api/chat/messages') {", "if (route === 'POST /api/chat/messages') {");
  assert.ok(get.includes('store.users.find((item) => item.id === message.userId)'), 'GET pesan harus mencari pengirim di data akun saat ini');
  assert.ok(get.includes("avatar: sender.avatar === 'uploaded' ? 'uploaded'"), 'GET pesan harus memakai avatar akun saat ini');
  assert.ok(get.includes('displayName: sender.displayName || sender.username'), 'GET pesan harus memakai nama akun saat ini');
  // Tanda daftar harus ikut berubah saat avatar/nama berubah supaya poll
  // merender ulang daftarnya (kalau tidak, foto baru tidak tampil di layar
  // walau server sudah mengembalikannya).
  const signature = extractFunction(appJs, 'chatMessagesSignature');
  assert.ok(signature.includes('message.avatar'), 'tanda daftar harus menghitung avatar tiap pesan');
  assert.ok(signature.includes('message.displayName'), 'tanda daftar harus menghitung nama tiap pesan');
});

test('Obrolan: bubble ala grup WA — nama warna, jam di dalam bubble kanan bawah', () => {
  assert.match(css, /\.chat-row\{[^}]*align-items:\s*flex-start/, 'baris pesan sejajar atas');
  assert.match(css, /\.chat-bubble-meta\{[^}]*justify-content:\s*space-between/, 'jam di pojok kanan, tombol Balas/Hapus di kiri');
  assert.ok(css.includes('.chat-bubble.is-first'), 'bubble pertama satu pengirim berurutan dapat ekor ala WA');
  assert.ok(appJs.includes('function chatNameColor('), 'nama pengirim harus diwarnai per anggota ala grup WA');
  assert.ok(appJs.includes('name.style.color = chatNameColor('), 'warna nama harus dipasang di bubble');
  assert.ok(appJs.includes("ticks.className = 'chat-ticks'"), 'pesan sendiri harus punya centang terkirim ala WA');
  assert.ok(css.includes('.chat-wa-subtitle'), 'header grup harus punya subjudul anggota/mengetik');
  assert.ok(html.includes('id="chat-wa-subtitle"'), 'subjudul header grup harus ada di HTML');
  assert.ok(appJs.includes("mainAdmin: '#f5c542'"), 'nama admin utama harus emas');
  assert.ok(appJs.includes("admin: '#3ee69a'"), 'nama admin biasa harus hijau, beda dari admin utama');
  assert.ok(appJs.includes('function chatNameColor(name, message)'), 'warna nama harus mempertimbangkan peran pengirim');
  assert.ok(appJs.includes('message?.isMainAdmin'), 'admin utama dikenali dari isMainAdmin');
  assert.ok(appJs.includes("message?.role === 'admin'"), 'admin biasa dikenali dari role admin');
  assert.ok(css.includes('color:#8696a0'), 'chip member biasa harus abu normal');
  assert.ok(css.includes('@keyframes chat-chip-shimmer'), 'chip admin utama harus punya animasi shimmer emas');
  assert.ok(css.includes('@keyframes chat-chip-pulse'), 'chip admin biasa harus punya animasi pulse hijau');
  assert.ok(css.includes('.chat-role-chip.is-main-admin{') && css.includes('animation:chat-chip-shimmer'), 'animasi shimmer harus menempel di chip admin utama');
  assert.ok(css.includes('.chat-role-chip.is-admin{') && css.includes('animation:chat-chip-pulse'), 'animasi pulse harus menempel di chip admin biasa');
});

test('Obrolan: panel emoji menutup begitu satu emoji dipilih', () => {
  const init = extractFunction(appJs, 'initChatEmojiPanel');
  assert.ok(init.includes('panel.hidden = true'), 'memilih emoji harus menyembunyikan panel');
  assert.ok(init.includes("document.querySelector('#chat-emoji-toggle')?.setAttribute('aria-expanded', 'false')"), 'memilih emoji harus mengembalikan tombol emoji ke tertutup');
});

test('Obrolan: kutipan balasan bisa diklik untuk lompat ke pesan asli', () => {
  const build = extractFunction(appJs, 'buildChatMessageRow');
  assert.ok(build.includes("document.createElement('button')"), 'kutipan balasan harus berupa tombol yang bisa diklik');
  assert.ok(build.includes("quote.className = 'chat-reply-quote'"), 'tombol kutipan memakai gaya kutipan');
  assert.ok(build.includes('jumpToChatMessage(message.replyTo.id)'), 'klik kutipan harus melompat ke pesan asli');
  const jump = extractFunction(appJs, 'jumpToChatMessage');
  assert.ok(jump.includes("scrollIntoView({ behavior: 'smooth', block: 'center' })"), 'lompatan harus menggulir halus ke tengah daftar');
  assert.ok(jump.includes('flashChatMessageRow(row)'), 'pesan tujuan harus diberi tanda warna');
  assert.ok(jump.includes('return false'), 'lompatan harus gagal rapi bila pesan asli tidak ada di daftar');
  assert.ok(css.includes('@keyframes chatRowFlash'), 'tanda lompatan harus punya animasi warna hijau');
  assert.ok(css.includes('.chat-row-flash .chat-bubble'), 'tanda lompatan harus menempel di bubble pesan tujuan');
});

test('Obrolan: @ balasan — badge di menu + tombol @ di pojok, persisten, klik kurangi satu', () => {
  // Predikat murni: balasan ke pesan sendiri, bukan pesan sendiri.
  const src = extractFunction(appJs, 'isChatMentionFor');
  const { isChatMentionFor } = new Function(`${src}; return { isChatMentionFor };`)();
  const me = 'user-me';
  const other = 'user-other';
  assert.equal(isChatMentionFor({ userId: other, replyTo: { userId: me } }, me), true, 'balasan orang lain ke pesanku adalah @');
  assert.equal(isChatMentionFor({ userId: me, replyTo: { userId: other } }, me), false, 'balasanku sendiri bukan @');
  assert.equal(isChatMentionFor({ userId: other, replyTo: { userId: other } }, me), false, 'balasan ke orang lain bukan @');
  assert.equal(isChatMentionFor({ userId: other, replyTo: null }, me), false, 'pesan tanpa balasan bukan @');
  assert.equal(isChatMentionFor({ userId: other }, me), false, 'pesan tanpa replyTo bukan @');
  // Penyimpanan per akun, berupa daftar id pesan — refresh tidak menghilangkan.
  const key = extractFunction(appJs, 'chatMentionsStorageKey');
  assert.ok(key.includes('readsw-chat-mentions-'), 'kunci storage @ harus per akun');
  const load = extractFunction(appJs, 'loadChatMentionIds');
  assert.ok(load.includes('JSON.parse'), '@ yang belum dibaca harus dimuat sebagai daftar id');
  const save = extractFunction(appJs, 'saveChatMentionIds');
  assert.ok(save.includes('JSON.stringify'), '@ yang belum dibaca harus disimpan sebagai daftar id');
  // Badge di menu Obrolan (di luar halaman) dan tombol @ mengambang di pojok
  // kanan bawah daftar pesan, ala WhatsApp.
  const render = extractFunction(appJs, 'renderChatMentionBadge');
  assert.ok(render.includes("document.querySelector('#chat-nav')"), '@ di menu menempel di menu Obrolan');
  assert.ok(render.includes("badge.className = 'nav-mention-badge'"), '@ di menu memakai badge sendiri, bukan badge pesan');
  assert.ok(render.includes('badge.textContent = `@${count}`'), '@ di menu menampilkan @ dan angka');
  assert.ok(render.includes("document.querySelector('#chat-mention-jump')"), 'tombol @ mengambang harus dirender');
  assert.ok(render.includes('jump.hidden = !count'), 'tombol @ hanya tampil bila ada balasan belum dibaca');
  assert.ok(html.includes('<div class="chat-messages-wrap">'), 'daftar pesan harus dibungkus supaya tombol @ bisa mengambang di dalamnya');
  assert.ok(html.indexOf('id="chat-mention-jump"') > html.indexOf('id="chat-messages"'), 'tombol @ harus ada di dalam pembungkus daftar pesan');
  assert.ok(html.indexOf('id="chat-mention-jump"') < html.indexOf('id="chat-typing"'), 'tombol @ harus tetap di atas bar ketik');
  assert.ok(html.includes('<button id="chat-mention-jump" class="chat-mention-jump" type="button" hidden>'), 'tombol @ harus tersembunyi di awal');
  assert.ok(html.includes('<span id="chat-mention-count">0</span>'), 'tombol @ harus membawa angka');
  // Satu klik menandai satu balasan sudah dilihat: angka berkurang satu.
  const next = extractFunction(appJs, 'jumpToNextChatMention');
  assert.ok(next.includes('chatMentionIds.slice(1)'), 'satu klik hanya menghapus satu balasan dari daftar');
  assert.ok(next.includes('saveChatMentionIds(chatMentionIds)'), 'satu klik harus menyimpan daftar yang sudah berkurang');
  assert.ok(next.includes('chatMentionsSeenIds'), 'satu klik harus mencatat balasan itu ke daftar sudah-dilihat');
  assert.ok(next.includes('saveChatMentionSeenIds(chatMentionsSeenIds)'), 'satu klik harus menyimpan daftar sudah-dilihat');
  assert.ok(next.includes('renderChatMentionBadge()'), 'satu klik harus memperbarui badge dan tombol @');
  assert.ok(next.includes('jumpToChatMessage(id)'), 'klik @ harus melompat ke balasan yang belum dibaca');
  // Balasan yang sudah diklik tidak boleh muncul lagi: poll berikutnya tetap
  // melihat pesan yang sama, jadi id yang sudah dilihat dicatat terpisah
  // dan dilewati saat menghitung @ baru.
  const collect = extractFunction(appJs, 'collectChatMentions');
  assert.ok(collect.includes('!seen.has(message.id)'), 'poll harus melewati balasan yang sudah diklik');
  assert.ok(collect.includes('new Set(chatMentionsSeenIds)'), 'poll harus memakai daftar sudah-dilihat');
  const seenKey = extractFunction(appJs, 'chatMentionsSeenStorageKey');
  assert.ok(seenKey.includes('readsw-chat-mentions-seen-'), 'kunci storage sudah-dilihat harus per akun');
  const loadMessages = sliceBetween(appJs, 'async function loadChatMessages() {', '\nfunction buildChatMessageRow(');
  assert.ok(loadMessages.includes('loadChatMentionIds()'), '@ harus dipulihkan dari storage per akun sebelum fetch');
  assert.ok(loadMessages.includes('loadChatMentionSeenIds()'), 'daftar sudah-dilihat harus dipulihkan bersama @');
  assert.ok(loadMessages.includes('collectChatMentions(messages)'), 'poll harus menghitung balasan baru ke pesanku');
  assert.ok(loadMessages.includes('renderChatMentionBadge()'), 'poll harus memperbarui @ realtime');
  const markSeen = extractFunction(appJs, 'markChatSeen');
  assert.ok(!markSeen.includes('chatMention'), 'membuka halaman Obrolan tidak boleh menghapus @');
});

test('Obrolan: tombol @ mengambang di pojok kanan bawah daftar, ala WhatsApp', () => {
  assert.match(css, /\.chat-messages-wrap\{[^}]*position:\s*relative/, 'pembungkus daftar harus jadi acuan posisi tombol mengambang');
  assert.match(css, /\.chat-mention-jump\{[^}]*position:\s*absolute;[^}]*right:\s*12px;[^}]*bottom:\s*12px/, 'tombol @ harus mengambang di pojok kanan bawah daftar');
  assert.ok(!html.includes('<div class="chat-hero-actions"><button id="chat-mention-jump"'), 'tombol @ tidak boleh lagi di bar atas hero');
  assert.ok(css.includes('.chat-mention-jump[hidden]{display:none!important}'), 'tombol @ yang tersembunyi harus benar-benar hilang');
});

test('Obrolan: bar atas bisa diciutkan supaya ruang daftar lebih luas, tersimpan per akun', () => {
  assert.ok(html.includes('<button id="chat-hero-toggle" class="chat-hero-toggle" type="button"'), 'bar atas harus punya tombol ciutkan');
  assert.ok(html.includes('aria-label="Ciutkan bar atas Obrolan"'), 'tombol ciutkan harus punya label yang jelas');
  assert.ok(css.includes('.chat-page.is-hero-collapsed .chat-hero-copy{display:none}'), 'bar atas yang diciutkan harus menyembunyikan judul dan deskripsi');
  assert.ok(css.includes('.chat-page.is-hero-collapsed .chat-hero-toggle svg{transform:rotate(180deg)}'), 'tombol ciutkan harus membalik arah saat bar atas tertutup');
  const apply = extractFunction(appJs, 'applyChatHeroCollapsed');
  assert.ok(apply.includes("classList.toggle('is-hero-collapsed'"), 'ciutkan harus mengaktifkan kelas bar tertutup di halaman Obrolan');
  assert.ok(apply.includes("setAttribute('aria-expanded'"), 'ciutkan harus memperbarui status tombol');
  const toggle = extractFunction(appJs, 'toggleChatHeroCollapsed');
  assert.ok(toggle.includes('saveChatHeroCollapsed(collapsed)'), 'ciutkan harus menyimpan pilihan');
  const key = extractFunction(appJs, 'chatHeroCollapsedStorageKey');
  assert.ok(key.includes('readsw-chat-hero-collapsed-'), 'pilihan bar atas harus tersimpan per akun');
  const loadMessages = sliceBetween(appJs, 'async function loadChatMessages() {', '\nfunction buildChatMessageRow(');
  assert.ok(loadMessages.includes('applyChatHeroCollapsed(loadChatHeroCollapsed())'), 'pilihan bar atas harus dipulihkan saat halaman dimuat');
  assert.ok(appJs.includes("document.querySelector('#chat-hero-toggle')?.addEventListener('click'"), 'tombol ciutkan harus terhubung ke aksi');
});

test('Obrolan: bar atas yang diciutkan jadi bar ramping — label Obrolan kiri, tombol panah lebar di kanan', () => {
  assert.ok(html.includes('<span class="chat-hero-collapsed-label">Obrolan</span>'), 'bar atas yang diciutkan harus punya label Obrolan');
  assert.ok(css.includes('.chat-hero-collapsed-label{display:none'), 'label bar ciut harus tersembunyi saat bar atas terbuka');
  assert.ok(css.includes('.chat-page.is-hero-collapsed .chat-hero-collapsed-label{display:block}'), 'label bar ciut harus tampil saat bar atas tertutup');
  assert.ok(css.includes('.chat-page.is-hero-collapsed .chat-hero{align-items:center}'), 'bar atas yang diciutkan harus jadi bar ramping sejajar tengah');
  assert.ok(css.includes('.chat-page.is-hero-collapsed .chat-hero-toggle{width:44px}'), 'tombol panah harus lebih lebar saat bar atas tertutup supaya pas, tidak kecil');
});

test('Obrolan: indikator mengetik menampilkan avatar + nama kecil, banyak orang digabung realtime', () => {
  const render = extractFunction(appJs, 'renderChatTyping');
  assert.ok(render.includes("avatars.className = 'chat-typing-avatars'"), 'indikator mengetik harus punya wadah avatar');
  assert.ok(render.includes("avatar.className = 'chat-typing-avatar'"), 'setiap orang yang mengetik harus tampil avatar kecilnya');
  assert.ok(render.includes('chatAvatarSrc(entry)'), 'avatar mengetik harus memakai sumber avatar yang sama dengan bubble pesan');
  assert.ok(render.includes("entries.slice(0, 3)"), 'avatar mengetik dibatasi tiga supaya bar tetap kecil');
  assert.ok(render.includes("`${names[0]}, ${names[1]} dan ${names.length - 2} lainnya sedang mengetik`"), 'tiga orang atau lebih harus disebut namanya, bukan cuma "beberapa orang"');
  assert.ok(render.includes('bar.replaceChildren(avatars,'), 'avatar, nama, dan titik harus dirender bersamaan tiap poll supaya realtime');
  assert.ok(css.includes('.chat-typing{display:flex;align-items:center;gap:6px'), 'indikator mengetik harus sebaris kecil di bawah daftar');
  assert.ok(css.includes('.chat-typing-avatar{width:18px;height:18px;border-radius:50%'), 'avatar mengetik harus kecil dan bulat');
  assert.ok(serverJs.includes("avatar: user.avatar === 'uploaded' ? 'uploaded' : (AVATAR_PRESETS.has(user.avatar) ? user.avatar : 'avatar-01')"), 'server harus menyimpan avatar orang yang mengetik');
  assert.ok(serverJs.includes('displayName, avatar, role, isMainAdmin'), 'server harus mengirim avatar lewat daftar mengetik');
});

test('Obrolan: semua pesan tersimpan rapi di data/Obrolan.json, bukan di store.json', () => {
  assert.ok(serverJs.includes("const CHAT_FILE = path.join(DATA_DIR, 'Obrolan.json');"), 'server harus memakai file Obrolan.json di folder data');
  assert.ok(serverJs.includes('let chatStore = { messages: [] };'), 'pesan chat harus dimuat ke memori dari Obrolan.json');
  assert.ok(serverJs.includes('function saveChatMessages()'), 'penyimpanan Obrolan.json harus berurutan lewat antrean');
  assert.ok(serverJs.includes('atomicWriteJson(CHAT_FILE, chatStore)'), 'pesan harus ditulis atomik ke Obrolan.json');
  assert.ok(serverJs.includes('chatStore.messages = [...chatStore.messages, message].slice(-CHAT_MAX_MESSAGES);'), 'pesan baru harus ditambahkan ke Obrolan.json dengan batas 200');
  assert.ok(serverJs.includes('const messages = chatStore.messages.slice(-100)'), 'baca pesan harus dari Obrolan.json');
  assert.ok(serverJs.includes('store.chatMessages'), 'migrasi harus membaca pesan lama dari store.chatMessages');
  assert.ok(serverJs.includes('delete store.chatMessages;'), 'field lama harus dibersihkan dari store.json setelah migrasi');
  assert.ok(!/next\.chatMessages\s*=/.test(serverJs), 'server tidak boleh lagi menulis pesan ke store.json');
});

test('Obrolan: Enter di keyboard HP dan desktop mengirim pesan, Shift+Enter baris baru', () => {
  assert.ok(html.includes('enterkeyhint="send"'), 'kolom ketik harus memberi tahu keyboard HP untuk menampilkan tombol Kirim');
  assert.ok(appJs.includes("if (event.key === 'Enter') {"), 'harus ada penanganan tombol Enter');
  assert.ok(appJs.includes('chatEnterWasShifted = event.shiftKey;'), 'Enter harus mencatat apakah Shift ikut ditekan');
  assert.ok(appJs.includes("if (!event.shiftKey) {\n      event.preventDefault();\n      void sendChatMessage();"), 'Enter tanpa Shift harus mengirim pesan');
  assert.ok(appJs.includes("event.inputType === 'insertLineBreak'"), 'keyboard HP yang tidak mengirim keydown Enter harus tetap bisa mengirim lewat baris baru');
  assert.ok(appJs.includes("input.value = input.value.slice(0, -1);"), 'baris baru dari Enter harus dibuang sebelum pesan dikirim');
  const send = extractFunction(appJs, 'sendChatMessage');
  assert.ok(send.indexOf("input.value = '';") < send.indexOf("await api('/api/chat/messages'"), 'kolom ketik harus dikosongkan sebelum menunggu server supaya Enter ganda tidak mengirim dua kali');
  assert.ok(send.includes('input.value = text;'), 'kirim yang gagal harus mengembalikan teks ke kolom ketik');
});

test('Obrolan: kirim, balas, emoji, dan mengetik terpasang di halaman', () => {
  const send = extractFunction(appJs, 'sendChatMessage');
  assert.ok(send.includes("api('/api/chat/messages', { method: 'POST'"), 'kirim harus POST ke /api/chat/messages');
  assert.ok(send.includes('const replyTo = chatReplyTo;'), 'kirim harus menangkap balasan sebelum kolom dikosongkan');
  assert.ok(send.includes('replyToId: replyTo.id'), 'kirim harus menyertakan balasan bila ada');
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


test('Obrolan: menekan Balas tidak boleh menggulir daftar ke bawah', () => {
  const reply = extractFunction(appJs, 'setChatReply');
  assert.ok(reply.includes("document.querySelector('#chat-input')?.focus({ preventScroll: true })"), 'fokus kolom ketik saat membalas harus tanpa menggulir');
  assert.ok(reply.includes('previousScrollTop'), 'posisi scroll daftar harus disimpan sebelum bar Balas muncul');
  assert.ok(reply.includes('list.scrollTop = previousScrollTop'), 'posisi scroll daftar harus dikembalikan setelah fokus');
});

test('Obrolan: halaman full layar mengikuti layar yang terlihat walau keyboard HP terbuka', () => {
  assert.ok(appJs.includes('function fitChatPageToVisibleViewport()'), 'harus ada penyesuai tinggi halaman Obrolan ke layar yang terlihat');
  const fit = extractFunction(appJs, 'fitChatPageToVisibleViewport');
  assert.ok(fit.includes('window.visualViewport'), 'tinggi halaman harus mengikuti visualViewport');
  assert.ok(fit.includes("window.matchMedia('(max-width: 560px)')"), 'penyesuai hanya berlaku di HP');
  assert.ok(fit.includes('visible - 104'), 'tinggi halaman harus dikurangi topbar dan padding');
  assert.ok(appJs.includes("window.visualViewport.addEventListener('resize'"), 'keyboard yang membuka/menutup harus memicu penyesuaian');
  assert.ok(appJs.includes('fitChatPageToVisibleViewport();'), 'pindah halaman harus menyesuaikan tinggi Obrolan');
});

test('Obrolan: tinggi halaman diperbarui saat keyboard buka/tutup dan layar berubah', () => {
  assert.ok(appJs.includes("window.addEventListener('resize', () => fitChatPageToVisibleViewport());"), 'perubahan ukuran layar harus memicu penyesuaian tinggi Obrolan');
  assert.ok(appJs.includes("window.addEventListener('orientationchange', () => window.setTimeout(() => fitChatPageToVisibleViewport(), 250));"), 'putar layar harus memicu penyesuaian tinggi Obrolan');
  assert.ok(appJs.includes("addEventListener('blur', () => { void sendChatTyping(false); window.setTimeout(() => fitChatPageToVisibleViewport(), 250); })"), 'keyboard yang menutup harus memicu penyesuaian setelah animasinya selesai');
  assert.ok(appJs.includes("addEventListener('focus', () => { window.setTimeout(() => fitChatPageToVisibleViewport(), 250); })"), 'keyboard yang membuka harus memicu penyesuaian setelah animasinya selesai');
});

test('Obrolan: kembali ke tab langsung poll supaya typing tidak keburu hilang', () => {
  assert.ok(appJs.includes("document.addEventListener('visibilitychange'"), 'kembali ke tab harus memicu poll Obrolan');
  assert.ok(appJs.includes("if (document.visibilityState === 'visible' && currentUser) void loadChatMessages();"), 'poll saat kembali terlihat harus memuat pesan dan typing');
});

test('Obrolan: hapus pesan — sendiri boleh, orang lain hanya Admin Utama', () => {
  const row = appJs.slice(appJs.indexOf('function buildChatMessageRow'));
  assert.ok(row.includes("if (isOwn || currentUser?.isMainAdmin)"), 'tombol hapus hanya untuk pesan sendiri atau Admin Utama');
  assert.ok(row.includes("deleteButton.className = 'chat-delete-btn'"), 'tombol hapus harus ada di baris pesan');
  assert.ok(row.includes("await showConfirm({ title: 'Hapus pesan ini?'"), 'hapus pesan harus minta konfirmasi dulu');
  assert.ok(row.includes("api('/api/chat/messages/delete', { method: 'POST'"), 'hapus pesan harus POST ke /api/chat/messages/delete');
  assert.ok(row.includes("if (chatReplyTo?.id === message.id) setChatReply(null);"), 'balasan ke pesan yang dihapus harus dibersihkan');
  assert.ok(css.includes('.chat-bubble-actions{display:flex;align-items:center;gap:2px}'), 'tombol Balas dan Hapus harus sebaris di kanan meta');
  assert.ok(css.includes('.chat-delete-btn{'), 'tombol hapus harus punya gaya sendiri');
});

test('Info Update: kategori Bug dan Fitur Error terdaftar dengan warna sendiri', () => {
  assert.ok(appJs.includes("bug: 'Bug'"), 'kategori Bug harus terdaftar di peta label Info Update');
  assert.ok(appJs.includes("'fitur-error': 'Fitur Error'"), 'kategori Fitur Error harus terdaftar di peta label Info Update');
  assert.ok(css.includes('.info-update-item[data-tag="bug"]'), 'kategori Bug harus punya warna poster/tag sendiri');
  assert.ok(css.includes('.info-update-item[data-tag="fitur-error"]'), 'kategori Fitur Error harus punya warna poster/tag sendiri');
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
    const migratedMessage = {
      id: randomUUID(), userId: member.id, username: 'fixturemember', displayName: 'fixturemember',
      avatar: 'avatar-01', role: 'member', isMainAdmin: false, text: 'Pesan lama dari migrasi',
      replyTo: null, createdAt: '2026-11-20T10:00:00.000Z',
    };
    await writeFile(path.join(dataDir, 'store.json'), JSON.stringify({
      users: [admin, member], pendingRegistrations: [], bots: [], sessions: [], pairingLogs: [], loginHistory: [],
      chatMessages: [migratedMessage],
    }));
    const port = await unusedPort();
    const base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [path.join(root, 'server/index.js')], {
      cwd: root,
      env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), PANEL_DATA_DIR: 'runtime-data', SESSION_SECRET: randomBytes(48).toString('base64url'), NODE_ENV: 'test', BOOTSTRAP_ADMIN_USERNAME: 'fixtureadmin' },
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
    assert.equal(empty.payload.messages.length, 1, 'pesan lama dari store.json harus ikut pindah ke Obrolan.json');
    assert.equal(empty.payload.messages[0].text, 'Pesan lama dari migrasi');
    const chatFile = JSON.parse(await readFile(path.join(dataDir, 'Obrolan.json'), 'utf8'));
    assert.equal(chatFile.messages.length, 1, 'Obrolan.json harus berisi pesan hasil migrasi');
    assert.equal(chatFile.messages[0].text, 'Pesan lama dari migrasi');
    const storeAfterStart = JSON.parse(await readFile(path.join(dataDir, 'store.json'), 'utf8'));
    assert.equal(storeAfterStart.chatMessages, undefined, 'field chatMessages lama harus dibersihkan dari store.json');

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
    assert.equal(seenByAdmin.payload.messages.length, 2, 'admin harus melihat pesan migrasi dan pesan member');
    assert.equal(seenByAdmin.payload.messages[1].text, 'Halo semua 👋');

    await wait(1100);
    const reply = await jsonRequest(base, '/api/chat/messages', { method: 'POST', body: { text: 'Halo juga!', replyToId: sent.payload.message.id }, cookie: adminCookie });
    assert.equal(reply.status, 200, 'admin harus bisa membalas pesan member');
    assert.equal(reply.payload.message.replyTo.id, sent.payload.message.id, 'balasan harus menunjuk pesan asli');
    assert.equal(reply.payload.message.replyTo.displayName, 'fixturemember', 'balasan harus menyimpan nama pengirim asli');
    assert.equal(reply.payload.message.replyTo.text, 'Halo semua 👋', 'balasan harus menyimpan teks asli');
    assert.equal(reply.payload.message.replyTo.role, 'member', 'kutipan harus menyimpan peran pengirim asli supaya warnanya pas');
    assert.equal(reply.payload.message.replyTo.isMainAdmin, false, 'kutipan harus menyimpan status admin utama pengirim asli');

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

    // Regresi: jendela typing 12 detik — satu poll penerima yang terlewat
    // (6 detik tanpa poll) tidak boleh menghilangkan indikator; setelah
    // 12 detik berlalu indikator harus hilang sendiri.
    const typingAgain = await jsonRequest(base, '/api/chat/typing', { method: 'POST', body: { typing: true }, cookie: memberCookie });
    assert.equal(typingAgain.status, 200);
    await wait(6000);
    const typingAfterMissedPoll = await jsonRequest(base, '/api/chat/messages', { method: 'GET', cookie: adminCookie });
    assert.equal(typingAfterMissedPoll.payload.typing.length, 1, 'typing harus tetap terlihat setelah satu poll terlewat (6 detik)');
    await wait(7000);
    const typingExpired = await jsonRequest(base, '/api/chat/messages', { method: 'GET', cookie: adminCookie });
    assert.equal(typingExpired.payload.typing.length, 0, 'typing harus hilang setelah jendela 12 detik berlalu');

    // Tanpa batas durasi: mengetik terus (POST tiap 2 detik) harus membuat
    // indikator tetap tampil realtime walau sudah lewat 10 detik sejak mulai —
    // tiap ketikan memperbarui jendela 12 detiknya.
    for (let i = 0; i < 6; i += 1) {
      const keepTyping = await jsonRequest(base, '/api/chat/typing', { method: 'POST', body: { typing: true }, cookie: memberCookie });
      assert.equal(keepTyping.status, 200);
      await wait(2000);
    }
    const typingStillThere = await jsonRequest(base, '/api/chat/messages', { method: 'GET', cookie: adminCookie });
    assert.equal(typingStillThere.payload.typing.length, 1, 'typing harus tetap tampil walau mengetik lebih dari 10 detik');

    // Avatar realtime: pesan lama harus ikut ganti foto saat pengirimnya
    // ganti avatar di Profil akun — foto tidak boleh beku di avatar lama.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const memberUpload = await fetch(`${base}/api/me/avatar`, { method: 'POST', body: png, headers: { Cookie: memberCookie, 'Content-Type': 'image/png' }, signal: AbortSignal.timeout(5000) });
    assert.equal(memberUpload.status, 200, 'member harus bisa mengunggah foto profilnya sendiri');
    const afterAvatarChange = await jsonRequest(base, '/api/chat/messages', { method: 'GET', cookie: adminCookie });
    const memberMessages = afterAvatarChange.payload.messages.filter((item) => item.userId === member.id);
    assert.ok(memberMessages.length > 0, 'harus ada pesan member untuk diperiksa avatarnya');
    assert.ok(memberMessages.every((item) => item.avatar === 'uploaded'), 'semua pesan lama member harus memakai foto barunya, bukan avatar lama');
    const adminMessages = afterAvatarChange.payload.messages.filter((item) => item.userId === admin.id);
    assert.ok(adminMessages.every((item) => item.avatar === 'avatar-01'), 'pesan admin yang tidak ganti avatar harus tetap memakai avatarnya sendiri');

    // Hapus pesan: pemilik boleh hapus pesannya sendiri, member tidak boleh
    // hapus pesan orang lain, Admin Utama boleh hapus pesan siapa pun.
    const deleteOwn = await jsonRequest(base, '/api/chat/messages/delete', { method: 'POST', body: { id: sent.payload.message.id }, cookie: memberCookie });
    assert.equal(deleteOwn.status, 200, 'member harus bisa menghapus pesannya sendiri');
    const deleteOther = await jsonRequest(base, '/api/chat/messages/delete', { method: 'POST', body: { id: afterWait.payload.message.id }, cookie: memberCookie });
    assert.equal(deleteOther.status, 403, 'member tidak boleh menghapus pesan admin');
    const deleteByMainAdmin = await jsonRequest(base, '/api/chat/messages/delete', { method: 'POST', body: { id: empty.payload.messages[0].id }, cookie: adminCookie });
    assert.equal(deleteByMainAdmin.status, 200, 'Admin Utama harus bisa menghapus pesan member');
    const deleteMissing = await jsonRequest(base, '/api/chat/messages/delete', { method: 'POST', body: { id: 'tidak-ada' }, cookie: adminCookie });
    assert.equal(deleteMissing.status, 404, 'hapus pesan yang tidak ada harus 404');
    const deleteNoAuth = await jsonRequest(base, '/api/chat/messages/delete', { method: 'POST', body: { id: afterWait.payload.message.id } });
    assert.equal(deleteNoAuth.status, 401, 'hapus pesan tanpa login harus 401');
    const afterDelete = await jsonRequest(base, '/api/chat/messages', { method: 'GET', cookie: adminCookie });
    assert.equal(afterDelete.payload.messages.length, 2, 'dua pesan yang dihapus harus hilang dari daftar');
    assert.equal(afterDelete.payload.messages[0].text, 'Halo juga!', 'balasan yang mengutip pesan terhapus harus tetap ada');

    // Hapus pesan tidak boleh merusak typing: setelah hapus, mengetik tetap muncul.
    const typingAfterDelete = await jsonRequest(base, '/api/chat/typing', { method: 'POST', body: { typing: true }, cookie: memberCookie });
    assert.equal(typingAfterDelete.status, 200);
    const typingSeenAfterDelete = await jsonRequest(base, '/api/chat/messages', { method: 'GET', cookie: adminCookie });
    assert.equal(typingSeenAfterDelete.payload.typing.length, 1, 'typing harus tetap muncul setelah hapus pesan');

    const all = await jsonRequest(base, '/api/chat/messages', { method: 'GET', cookie: memberCookie });
    assert.equal(all.payload.messages.length, 2, 'semua pesan harus tersimpan berurutan');
    assert.equal(all.payload.messages[1].text, 'sudah boleh lagi');
    const chatFileFinal = JSON.parse(await readFile(path.join(dataDir, 'Obrolan.json'), 'utf8'));
    assert.equal(chatFileFinal.messages.length, 2, 'Obrolan.json di disk harus berisi semua pesan');
    assert.equal(chatFileFinal.messages[1].text, 'sudah boleh lagi');
  } finally {
    if (child && child.exitCode === null) child.kill('SIGTERM');
    await rm(temp, { recursive: true, force: true });
  }
});
