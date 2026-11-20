// Peringatan reaksi kini tampil sebagai notifikasi overlay di tengah layar —
// bukan kartu di bawah pengaturan dan bukan notifikasi bawaan browser. Muncul
// saat mode Read Only + ReadSW tidak bisa mengirim reaksi: tidak ada emoji dan
// reaksi otomatis mati, jadi bot hanya menandai story sebagai dibaca.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

test('notifikasi overlay ada di halaman dengan tombol aksi dan tutup', () => {
  const html = read('public/index.html');
  assert.ok(html.includes('<div id="emoji-notice-overlay"'), 'overlay notifikasi harus ada di halaman');
  assert.ok(html.includes('role="alertdialog"'), 'overlay harus memakai peran alertdialog');
  assert.ok(html.includes('aria-modal="true"'), 'overlay harus modal');
  assert.ok(html.includes('<h3 id="emoji-notice-title">Reaksi emoji tidak aktif</h3>'), 'overlay harus berjudul Reaksi emoji tidak aktif');
  assert.ok(html.includes('bot hanya menandai story sebagai dibaca, tanpa mengirim reaksi'), 'overlay harus menjelaskan bot hanya menandai story sebagai dibaca');
  assert.ok(html.includes('data-emoji-notice-add'), 'overlay harus punya tombol Tambah emoji');
  assert.ok(html.includes('>Tambah emoji</button>'), 'tombol aksi harus berlabel Tambah emoji');
  assert.ok(html.includes('>Tutup</button>'), 'overlay harus punya tombol Tutup');
  assert.ok(html.includes('data-emoji-notice-close'), 'overlay harus bisa ditutup dari tombol × dan Tutup');
});

test('kartu peringatan inline dari ronde sebelumnya sudah tidak ada', () => {
  const html = read('public/index.html');
  const js = read('public/app.js');
  assert.ok(!html.includes('story-emoji-warning'), 'kartu inline di Fitur Bot harus sudah dihapus');
  assert.ok(!js.includes('botcontrol-emoji-warning'), 'kartu inline di editor Kontrol Bot harus sudah dihapus');
  assert.ok(!js.includes('syncStoryEmojiWarning'), 'fungsi sinkronisasi kartu inline harus sudah diganti');
});

test('notifikasi halaman sendiri muncul saat mode ReadSW tanpa emoji dan tanpa reaksi', () => {
  const js = read('public/app.js');
  assert.ok(js.includes('function showNoticeOverlay('), 'harus ada fungsi menampilkan notifikasi overlay');
  assert.ok(js.includes('function hideNoticeOverlay()'), 'harus ada fungsi menyembunyikan notifikasi overlay');
  assert.ok(js.includes('function dismissNoticeOverlay()'), 'harus ada fungsi menutup notifikasi dengan mengingat penutupan');
  assert.ok(js.includes('function syncStoryEmojiNotice()'), 'harus ada fungsi sinkronisasi notifikasi halaman sendiri');
  assert.ok(js.includes("selectedMode === 'readonly_readsw'"), 'syaratnya harus mencakup mode Read Only + ReadSW');
  assert.ok(js.includes("document.querySelectorAll('.emoji-choice.selected').length === 0"), 'syaratnya harus mencakup tidak ada emoji aktif');
  const syncs = (js.match(/syncStoryEmojiNotice\(\);/g) || []).length;
  assert.ok(syncs >= 5, `notifikasi harus disinkronkan di semua jalur ubah emoji/reaksi, ditemukan ${syncs}`);
});

test('notifikasi tidak muncul lagi setelah ditutup sampai keadaannya berubah', () => {
  const js = read('public/app.js');
  assert.ok(js.includes('let emojiNoticeDismissed = false'), 'penutupan di halaman sendiri harus diingat');
  assert.ok(js.includes('if (emojiNoticeDismissed) return;'), 'notifikasi harus diam setelah ditutup');
  assert.ok(js.includes('emojiNoticeDismissed = false;'), 'ingatan penutupan harus dihapus begitu keadaannya hilang');
  assert.ok(js.includes('const botControlEmojiNoticeDismissed = new Set()'), 'penutupan di Kontrol Bot harus diingat per akun');
  assert.ok(js.includes('botControlEmojiNoticeDismissed.add(noticeContext.userId)'), 'menutup notifikasi member harus mengingat akunnya');
});

test('notifikasi Kontrol Bot menyebut nama member dan tombolnya membuka kartunya', () => {
  const js = read('public/app.js');
  assert.ok(js.includes("title: `Reaksi emoji @${username} tidak aktif`"), 'notifikasi Kontrol Bot harus menyebut nama member');
  assert.ok(js.includes('function openBotControlCard(userId)'), 'harus ada fungsi membuka kartu Kontrol Bot member');
  assert.ok(js.includes("if (kind === 'botcontrol' && userId) openBotControlCard(userId);"), 'tombol Tambah emoji harus membuka kartu member itu dulu');
  assert.ok(js.includes("target.scrollIntoView({ behavior: 'smooth', block: 'center' })"), 'tombol Tambah emoji harus menggulir ke kolom emoji');
  assert.ok(js.includes("setTimeout(() => target.focus({ preventScroll: true }), 250)"), 'tombol Tambah emoji harus memfokuskan kolom emoji');
});

test('notifikasi bisa ditutup dari latar dan tombol Escape', () => {
  const js = read('public/app.js');
  assert.ok(js.includes("if (event.target === event.currentTarget) dismissNoticeOverlay();"), 'mengetuk latar overlay harus menutup notifikasi');
  assert.ok(js.includes("if (event.key === 'Escape'"), 'tombol Escape harus menutup notifikasi');
  assert.ok(js.includes('addButton?.focus();'), 'fokus harus jatuh ke tombol aksi saat notifikasi muncul');
});

test('gaya notifikasi mengikuti pola overlay panel dan pas di HP', () => {
  const css = read('public/style.css');
  assert.ok(css.includes('.notice-overlay{position:fixed;inset:0;z-index:70'), 'overlay harus menutupi layar dengan z-index di atas konten');
  assert.ok(css.includes('.notice-card{position:relative;width:min(400px,100%)'), 'kartu harus selebar maksimal 400px dan mengikuti lebar layar');
  assert.ok(css.includes('@keyframes notice-pop'), 'kartu harus punya animasi muncul');
  assert.ok(css.includes('@media(max-width:560px){.notice-overlay{padding:12px}.notice-card{padding:18px 16px 16px}.notice-actions{flex-direction:column}'), 'di HP tombol harus bertumpuk penuh lebar');
});

test('entri Info Update notifikasi reaksi di layar tetap ada di posisi kedua puluh satu', () => {
  const data = JSON.parse(read('public/info-updates.json'));
  const html = read('public/index.html');
  assert.equal(data.updates.length, 77, 'daftar harus bertambah lima entri');
  const entry = data.updates.find((item) => item.title === 'Peringatan reaksi kini muncul sebagai notifikasi di layar');
  assert.ok(entry, 'entri notifikasi reaksi di layar harus tetap ada');
  assert.equal(data.updates.indexOf(entry), 21, 'entri notifikasi reaksi di layar kini di posisi kedua puluh satu');
  assert.equal(entry.tag, 'Tampilan', 'entri notifikasi reaksi harus bertag Tampilan');
  assert.equal(entry.time, '15.15 WIB', 'waktu entri notifikasi reaksi harus cocok');
  assert.ok(html.includes('<h4>Peringatan reaksi kini muncul sebagai notifikasi di layar</h4>'), 'fallback harus memuat judul entri terbaru');
});
