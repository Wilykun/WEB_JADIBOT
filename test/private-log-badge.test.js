import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function read(file) {
  return fs.readFile(path.join(ROOT, file), 'utf8');
}

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `marker awal tidak ditemukan: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, `marker akhir tidak ditemukan: ${endMarker}`);
  return source.slice(start, end);
}

// Ambil satu deklarasi `function nama(...) { ... }` utuh dari sumber.
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

test('Log privat berganti nama jadi Log Bot', async () => {
  const html = await read('public/index.html');
  const js = await read('public/app.js');
  assert.ok(html.includes('<span class="nav-icon">▣</span>Log Bot</a>'), 'menu sidebar harus Log Bot');
  assert.ok(!html.includes('>Log privat</a>'), 'menu sidebar tidak boleh lagi Log privat');
  assert.ok(html.includes('<div class="eyebrow">LOG BOT</div>'), 'kartu pratinjau log harus LOG BOT');
  assert.ok(html.includes('<div class="eyebrow">LOG BOT · AKTIVITAS AKUN</div>'), 'halaman log harus LOG BOT · AKTIVITAS AKUN');
  assert.ok(js.includes("activity: 'Log Bot'"), 'judul halaman activity harus Log Bot');
  assert.ok(!js.includes("activity: 'Log privat'"), 'judul halaman tidak boleh lagi Log privat');
  // Entri Info Update lama adalah riwayat: boleh tetap menyebut Log privat.
  const liveHtml = html.replace(/<li class="info-update-item"[\s\S]*?<\/li>/g, '');
  assert.ok(!/Log privat/i.test(liveHtml), 'di luar riwayat Info Update tidak boleh ada lagi Log privat');
});

test('badge Log Bot: hanya story baru yang dihitung, per akun', async () => {
  const js = await read('public/app.js');
  const src = [
    extractFunction(js, 'privateLogEntryIdentity'),
    extractFunction(js, 'isStoryLogEntry'),
    extractFunction(js, 'countNewStoryEntries'),
  ].join('\n');
  const { isStoryLogEntry, countNewStoryEntries } = new Function(`${src}; return { isStoryLogEntry, countNewStoryEntries };`)();
  assert.equal(isStoryLogEntry({ event: 'Story foto · Read + Reaction ✓ · 🐸 · delay 2.5 dtk' }), true);
  assert.equal(isStoryLogEntry({ details: { kind: 'story' }, event: 'Auto Read Story' }), true);
  assert.equal(isStoryLogEntry({ event: 'Bot dimulai pada mode Read Only + ReadSW' }), false);
  assert.equal(isStoryLogEntry({ event: 'Perangkat WhatsApp tertaut' }), false);
  assert.equal(isStoryLogEntry({ event: 'Story gagal dibaca' }), false, 'story gagal masuk kategori perhatian, bukan story');
  const logs = [
    { id: 'a', createdAt: '2026-11-20T00:00:00.000Z', event: 'Story foto · Read + Reaction ✓' },
    { id: 'b', createdAt: '2026-11-20T00:01:00.000Z', event: 'Bot dimulai pada mode Read Only + ReadSW' },
    { id: 'c', createdAt: '2026-11-20T00:02:00.000Z', event: 'Story foto · Read + Reaction ✓ · 💚' },
  ];
  assert.equal(countNewStoryEntries(logs, 'a'), 1, 'hanya story setelah penanda yang dihitung');
  assert.equal(countNewStoryEntries(logs, 'c'), 0, 'tidak ada yang baru setelah entri terakhir');
  assert.equal(countNewStoryEntries(logs, 'tidak-ada'), 0, 'penanda hilang (log bergeser) berarti tidak ditebak — angka tidak melonjak');
  assert.equal(countNewStoryEntries(logs, null), 0, 'tanpa penanda tidak ada yang dihitung');
});

test('badge Log Bot: angka tersimpan per akun dan pulih setelah refresh', async () => {
  const js = await read('public/app.js');
  const src = [
    extractFunction(js, 'privateLogUnreadStorageKey'),
    extractFunction(js, 'privateLogCountedStorageKey'),
    extractFunction(js, 'loadPrivateLogUnreadCount'),
    extractFunction(js, 'savePrivateLogUnreadCount'),
    extractFunction(js, 'loadPrivateLogCountedIdentity'),
    extractFunction(js, 'savePrivateLogCountedIdentity'),
  ].join('\n');
  // Simulasi storage per akun: currentUser bisa berganti, window lokal.
  let currentUser = { id: '02059969-9feb-4e0f-ae09-c70c358704a7' };
  const store = new Map();
  const window = { localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) } };
  const fns = eval(`${src}; ({ privateLogUnreadStorageKey, privateLogCountedStorageKey, loadPrivateLogUnreadCount, savePrivateLogUnreadCount, loadPrivateLogCountedIdentity, savePrivateLogCountedIdentity })`);
  // Angka 1 yang sudah tampil sebelum refresh harus kembali setelah refresh.
  fns.savePrivateLogUnreadCount(1);
  assert.equal(fns.loadPrivateLogUnreadCount(), 1, 'angka 1 sebelum refresh harus pulih setelah refresh');
  // Story bertambah: angka naik dan tetap tersimpan.
  fns.savePrivateLogUnreadCount(3);
  assert.equal(fns.loadPrivateLogUnreadCount(), 3, 'angka bertambah saat story bertambah');
  // Maks 99 saat disimpan.
  fns.savePrivateLogUnreadCount(150);
  assert.equal(fns.loadPrivateLogUnreadCount(), 99, 'angka disimpan maksimal 99');
  fns.savePrivateLogUnreadCount(0);
  assert.equal(fns.loadPrivateLogUnreadCount(), 0, 'angka nol setelah halaman Log Bot dibuka');
  // Penanda terakhir yang dihitung ikut tersimpan (supaya tidak dihitung dua kali).
  fns.savePrivateLogCountedIdentity('entry-123');
  assert.equal(fns.loadPrivateLogCountedIdentity(), 'entry-123', 'penanda terakhir tersimpan');
  // Per akun: akun lain tidak melihat angka akun ini.
  const keyA = fns.privateLogUnreadStorageKey();
  currentUser = { id: 'akun-lain' };
  assert.notEqual(fns.privateLogUnreadStorageKey(), keyA, 'kunci storage berbeda per akun');
  assert.equal(fns.loadPrivateLogUnreadCount(), 0, 'akun lain mulai dari nol');
  assert.notEqual(fns.privateLogCountedStorageKey(), 'readsw-log-bot-counted-02059969-9feb-4e0f-ae09-c70c358704a7', 'kunci penanda berbeda per akun');
});

test('badge Log Bot: tampil saat story masuk di luar halaman, hilang saat halaman dibuka', async () => {
  const js = await read('public/app.js');
  const badge = extractFunction(js, 'renderPrivateLogBadge');
  assert.ok(badge.includes("document.querySelector('#private-log-nav')"), 'badge menempel di menu Log Bot');
  assert.ok(badge.includes("badge.className = 'nav-badge'"), 'badge memakai gaya nav-badge yang sama dengan Info Update');
  assert.ok(badge.includes("'99+'"), 'badge dibatasi 99+');
  assert.ok(badge.includes('badge?.remove()'), 'badge dihapus saat hitungan nol');
  const markSeen = extractFunction(js, 'markPrivateLogSeen');
  assert.ok(markSeen.includes('privateLogUnreadStoryCount = 0'), 'membuka halaman mereset hitungan');
  assert.ok(markSeen.includes('savePrivateLogUnreadCount(0)'), 'membuka halaman menyimpan angka nol');
  assert.ok(markSeen.includes('savePrivateLogCountedIdentity'), 'membuka halaman menyimpan penanda sudah dilihat');
  assert.ok(markSeen.includes('renderPrivateLogBadge(0)'), 'membuka halaman menghapus badge');
  const load = sliceBetween(js, 'async function loadPairingLogs() {', '\ndocument.querySelector(\'.avatar-tabs\')');
  assert.ok(load.includes('loadPrivateLogUnreadCount()'), 'angka badge dipulihkan dari storage per akun sebelum fetch');
  assert.ok(load.includes('loadPrivateLogCountedIdentity()'), 'penanda terakhir dibaca dari storage per akun');
  assert.ok(load.includes('privateLogFirstLoadAfterRestore'), 'muat pertama setelah refresh menghitung story selagi panel tertutup');
  assert.ok(load.includes('countNewStoryEntries(logs, privateLogCountedIdentity)'), 'pemuat log menghitung story baru dari penanda terakhir');
  assert.ok(load.includes("if (activeWorkspacePage === 'activity') {"), 'story hanya menambah angka saat pengguna tidak di halaman Log Bot');
  assert.ok(load.includes('savePrivateLogUnreadCount(privateLogUnreadStoryCount)'), 'angka baru disimpan supaya refresh tidak menghilangkan');
  assert.ok(load.includes('savePrivateLogCountedIdentity(privateLogCountedIdentity)'), 'penanda disimpan tiap pemuatan supaya tidak dihitung dua kali');
  assert.ok(load.includes('privateLogCountedIdentity = latestIdentity;'), 'penanda maju tiap pemuatan supaya tidak dihitung dua kali');
  const page = sliceBetween(js, 'function setWorkspacePage(page', "if (page === 'infoupdate') {");
  assert.ok(page.includes('markPrivateLogSeen();'), 'masuk halaman activity harus menandai log sudah dilihat');
});
