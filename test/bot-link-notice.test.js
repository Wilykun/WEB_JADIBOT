// Kartu pengingat untuk member biasa yang WhatsApp-nya belum tertaut: fitur bot
// belum aktif, tombolnya membuka halaman Pairing, dan mengetuk tombol mode saat
// terkunci menampilkan lagi kartu itu. Admin tidak pernah melihat kartu ini.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

test('kartu pengingat tautan ada di halaman Fitur Bot dan mengarah ke Pairing', () => {
  const html = read('public/index.html');
  assert.ok(html.includes('<section id="bot-link-notice"'), 'kartu pengingat harus ada');
  assert.ok(html.includes('data-page-view="mode"'), 'kartu harus ikut halaman Fitur Bot');
  assert.ok(html.includes('<h3>WhatsApp belum tertaut</h3>'), 'judul kartu harus menjelaskan WhatsApp belum tertaut');
  assert.ok(html.includes('Read Only + ReadSW dan Online 24 Jam otomatis aktif'), 'kartu harus menjanjikan dua fitur default aktif setelah tertaut');
  assert.ok(html.includes('data-open-pairing'), 'kartu harus punya tombol ke halaman Pairing');
  assert.ok(html.includes('Buka Pairing WhatsApp'), 'tombol kartu harus bernama Buka Pairing WhatsApp');
});

test('kartu hanya untuk member biasa dan mengikuti status tautan realtime', () => {
  const js = read('public/app.js');
  assert.ok(js.includes("function isBotLockedForMember()"), 'harus ada fungsi pengunci khusus member');
  assert.ok(js.includes("currentUser.role !== 'admin'"), 'admin (Admin Utama dan admin biasa) tidak pernah dikunci');
  assert.ok(js.includes("document.body.dataset.whatsappLinked === 'false'"), 'kunci harus membaca penanda status tautan yang sama dengan lencana koneksi');
  assert.ok(js.includes('function syncBotLinkNotice()'), 'harus ada fungsi sinkronisasi kartu');
  assert.ok(js.includes("notice.classList.toggle('hidden', !locked)"), 'kartu harus muncul saat terkunci dan hilang saat tertaut');
  assert.ok(js.includes("control.disabled = locked"), 'pengaturan story harus dinonaktifkan saat terkunci');
  assert.ok(js.includes("button.classList.toggle('is-locked', locked)"), 'tombol mode harus ditandai terkunci secara visual');
  assert.ok(js.includes('syncBotLinkNotice();'), 'sinkronisasi harus dipanggil dari renderLinkGate agar realtime mengikuti poll pairing');
});

test('mengetuk tombol mode saat terkunci menampilkan kartu, bukan mengubah mode', () => {
  const js = read('public/app.js');
  assert.ok(js.includes("if (isBotLockedForMember()) { showBotLinkNotice(); return; }"), 'klik mode dan Online 24 Jam saat terkunci harus menampilkan kartu dan berhenti');
  assert.ok(js.includes("notice.scrollIntoView({ behavior: 'smooth', block: 'center' })"), 'kartu harus digeser ke tengah layar saat ditampilkan ulang');
  assert.ok(js.includes('Tautkan WhatsApp dulu di Pairing WhatsApp'), 'toast harus mengarahkan ke Pairing WhatsApp');
  assert.ok(js.includes("setWorkspacePage('pairing')"), 'tombol kartu harus membuka halaman Pairing');
});

test('tombol Aktifkan di semua kartu mode memakai warna aksi yang sama', () => {
  const js = read('public/app.js');
  assert.ok(js.includes("button.classList.add('button-primary');"), 'tombol mode harus selalu hijau primer');
  assert.ok(!js.includes("button.classList.toggle('button-primary', active || card.dataset.planCard === 'readonly_readsw')"), 'tidak boleh ada lagi tombol mode abu-abu sekunder');
  const html = read('public/index.html');
  assert.ok(html.includes('<button class="button button-primary select-plan" type="button" data-plan="readonly">'), 'kartu Read Only harus hijau sejak HTML awal');
  assert.ok(html.includes('<button class="button button-primary online24-toggle"'), 'kartu Online 24 Jam harus hijau sejak HTML awal');
  assert.ok(!html.includes('button-secondary select-plan'), 'tidak boleh ada lagi tombol mode sekunder di HTML');
  const css = read('public/style.css');
  assert.ok(css.includes('.bot-link-notice{'), 'kartu pengingat harus punya gaya sendiri');
  assert.ok(css.includes('.select-plan.is-locked'), 'tombol terkunci harus tampak redup');
  assert.ok(css.includes('@media(max-width:560px){.bot-link-notice{flex-wrap:wrap}'), 'kartu harus rapi di HP sempit');
});

test('entri Info Update terbaru menjelaskan kartu pengingat member', () => {
  const data = JSON.parse(read('public/info-updates.json'));
  const html = read('public/index.html');
  assert.equal(data.updates.length, 55, 'daftar harus bertambah satu entri');
  const entry = data.updates.find((item) => item.title === 'Member yang belum tertaut kini diarahkan ke Pairing dari Fitur Bot');
  assert.ok(entry, 'entri kartu pengingat harus tetap ada');
  assert.equal(data.updates.indexOf(entry), 1, 'entri kartu pengingat kini di posisi kedua');
  assert.equal(entry.tag, 'Fitur baru', 'entri kartu pengingat harus bertag Fitur baru');
  assert.equal(entry.time, '14.35 WIB', 'waktu entri kartu pengingat harus cocok');
  assert.ok(html.includes('<h4>Member yang belum tertaut kini diarahkan ke Pairing dari Fitur Bot</h4>'), 'fallback harus memuat judul entri terbaru');
});
