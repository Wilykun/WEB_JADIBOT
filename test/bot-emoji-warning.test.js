// Peringatan saat mode Read Only + ReadSW tidak bisa mengirim reaksi: tidak ada
// emoji dan reaksi otomatis mati, jadi bot hanya menandai story sebagai dibaca.
// Peringatan muncul di halaman Fitur Bot member sendiri dan di editor Kontrol Bot
// saat admin memantau member; di mode Read Only biasa tidak muncul.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

test('peringatan ada di halaman Fitur Bot dengan isi yang menjelaskan ReadSW biasa', () => {
  const html = read('public/index.html');
  assert.ok(html.includes('<div id="story-emoji-warning"'), 'peringatan harus ada di halaman Fitur Bot');
  assert.ok(html.includes('<strong>Reaksi emoji tidak aktif</strong>'), 'peringatan harus berjudul Reaksi emoji tidak aktif');
  assert.ok(html.includes('bot hanya menandai story sebagai dibaca, tanpa mengirim reaksi'), 'peringatan harus menjelaskan bot hanya menandai story sebagai dibaca');
  assert.ok(html.includes('Tambahkan emoji dan nyalakan reaksi otomatis'), 'peringatan harus memberi jalan keluarnya');
});

test('peringatan halaman sendiri hanya muncul saat mode ReadSW tanpa emoji dan tanpa reaksi', () => {
  const js = read('public/app.js');
  assert.ok(js.includes('function syncStoryEmojiWarning()'), 'harus ada fungsi sinkronisasi peringatan halaman sendiri');
  assert.ok(js.includes("selectedMode === 'readonly_readsw' && !reacting && pool === 0"), 'syaratnya harus: mode ReadSW, reaksi mati, dan tidak ada emoji aktif');
  assert.ok(js.includes("warning.classList.toggle('hidden', !(selectedMode === 'readonly_readsw' && !reacting && pool === 0))"), 'peringatan harus muncul dan hilang mengikuti syarat itu');
  // Dipanggil di semua jalur yang mengubah state: muat pengaturan, hapus/pilih
  // emoji, tambah emoji, dan ubah ceklis reaksi.
  assert.ok(js.includes('renderEmojiPool(options, Array.isArray(values.emojiPool) ? values.emojiPool : DEFAULT_STORY_SETTINGS.emojiPool);\n  syncStoryEmojiWarning();'), 'peringatan harus diperbarui saat pengaturan dimuat');
  const gridSyncs = (js.match(/syncStoryEmojiWarning\(\);/g) || []).length;
  assert.ok(gridSyncs >= 5, `peringatan harus disinkronkan di semua jalur ubah emoji/reaksi, ditemukan ${gridSyncs}`);
});

test('editor Kontrol Bot membuat peringatan yang sama dan menyinkronkannya dari draf', () => {
  const js = read('public/app.js');
  assert.ok(js.includes("emojiWarning.className = 'emoji-warning botcontrol-emoji-warning hidden'"), 'editor Kontrol Bot harus membuat elemen peringatan');
  assert.ok(js.includes("warningTitle.textContent = 'Reaksi emoji tidak aktif'"), 'peringatan editor harus memakai judul yang sama');
  assert.ok(js.includes("warning.classList.toggle('hidden', !(draft.mode === 'readonly_readsw' && !draft.autoReaction && draft.emojiPool.length === 0))"), 'peringatan editor harus mengikuti draf: mode ReadSW, reaksi mati, dan tidak ada emoji aktif');
  assert.ok(js.includes('function syncBotControlSettingsCard(article, draft)'), 'sinkronisasi harus lewat fungsi yang sama dengan semua perubahan draf');
  const css = read('public/style.css');
  assert.ok(css.includes('.emoji-warning{'), 'peringatan harus punya gaya amber sendiri');
  assert.ok(css.includes('#botcontrol .emoji-warning{justify-content:center}'), 'peringatan di editor Kontrol Bot harus rata tengah mengikuti editornya');
});

test('entri Info Update terbaru menjelaskan peringatan reaksi', () => {
  const data = JSON.parse(read('public/info-updates.json'));
  const html = read('public/index.html');
  assert.equal(data.updatedAt, '2026-11-17T14:55:00+07:00', 'updatedAt harus sama dengan waktu entri terbaru');
  assert.equal(data.updates.length, 55, 'daftar harus bertambah satu entri');
  const newest = data.updates[0];
  assert.equal(newest.title, 'Peringatan bila ReadSW tidak bisa mengirim reaksi emoji', 'entri terbaru harus menjelaskan peringatan reaksi');
  assert.equal(newest.tag, 'Fitur baru', 'entri terbaru harus bertag Fitur baru');
  assert.equal(newest.time, '14.55 WIB', 'waktu entri terbaru harus cocok');
  assert.ok(html.includes('<h4>Peringatan bila ReadSW tidak bisa mengirim reaksi emoji</h4>'), 'fallback harus memuat judul entri terbaru');
});
