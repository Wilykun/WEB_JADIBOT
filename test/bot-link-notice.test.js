// Pengingat tautan WhatsApp untuk member biasa kini tampil sebagai notifikasi
// overlay di tengah layar — sama seperti notifikasi reaksi — bukan lagi kartu
// di bawah judul halaman dan bukan notifikasi bawaan browser. Muncul begitu
// member membuka Fitur Bot selagi belum tertaut, dan muncul lagi bila tombol
// mode yang terkunci diketuk. Admin tidak pernah melihat notifikasi ini.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

test('kartu pengingat inline dari ronde sebelumnya sudah tidak ada', () => {
  const html = read('public/index.html');
  assert.ok(!html.includes('id="bot-link-notice"'), 'kartu inline pengingat tautan harus sudah dihapus');
  assert.ok(!html.includes('data-open-pairing'), 'tombol kartu inline harus sudah dihapus');
  const css = read('public/style.css');
  assert.ok(!css.includes('.bot-link-notice'), 'gaya kartu inline harus sudah dihapus');
  const js = read('public/app.js');
  assert.ok(!js.includes('is-flashing'), 'efek kedip kartu inline harus sudah dihapus');
});

test('pengingat tautan memakai komponen notifikasi overlay yang sama', () => {
  const js = read('public/app.js');
  assert.ok(js.includes('function showNoticeOverlay('), 'harus ada fungsi notifikasi overlay bersama');
  assert.ok(js.includes('function syncBotLinkNotice()'), 'harus ada fungsi sinkronisasi pengingat tautan');
  assert.ok(js.includes("title: 'WhatsApp belum tertaut'"), 'pengingat tautan harus berjudul WhatsApp belum tertaut');
  assert.ok(js.includes('Read Only + ReadSW dan Online 24 Jam otomatis aktif'), 'pengingat tautan harus menyebut dua fitur default');
  assert.ok(js.includes("addLabel: 'Buka Pairing WhatsApp'"), 'tombol aksi pengingat tautan harus berlabel Buka Pairing WhatsApp');
  assert.ok(js.includes("onAdd: () => setWorkspacePage('pairing')"), 'tombol aksi harus membuka halaman Pairing');
  assert.ok(js.includes('if (botLinkNoticeDismissed) return;'), 'pengingat tautan harus diam setelah ditutup');
  assert.ok(js.includes('let botLinkNoticeDismissed = false'), 'penutupan pengingat tautan harus diingat');
});

test('pengingat tautan hanya untuk member biasa dan mengikuti status tautan realtime', () => {
  const js = read('public/app.js');
  assert.ok(js.includes('function isBotLockedForMember()'), 'harus ada fungsi pengunci khusus member');
  assert.ok(js.includes("currentUser.role !== 'admin'"), 'admin (Admin Utama dan admin biasa) tidak pernah dikunci');
  assert.ok(js.includes("document.body.dataset.whatsappLinked === 'false'"), 'kunci harus membaca penanda status tautan yang sama dengan lencana koneksi');
  assert.ok(js.includes('function syncBotLinkNotice()'), 'harus ada fungsi sinkronisasi pengingat tautan');
  assert.ok(js.includes('function showBotLinkNotice()'), 'harus ada fungsi menampilkan lagi pengingat tautan');
  assert.ok(js.includes("botLinkNoticeDismissed = false;\n  showLinkNoticeOverlay();"), 'mengetuk tombol mode yang terkunci harus menampilkan lagi notifikasinya');
  assert.ok(js.includes('if (isBotLockedForMember()) { showBotLinkNotice(); return; }'), 'klik mode dan Online 24 Jam saat terkunci harus menampilkan notifikasi dan berhenti');
  assert.ok(js.includes("control.disabled = locked"), 'pengaturan story harus dinonaktifkan saat terkunci');
  assert.ok(js.includes("button.classList.toggle('is-locked', locked)"), 'tombol mode harus ditandai terkunci secara visual');
  assert.ok(js.includes("if (noticeContext?.kind === 'link') hideNoticeOverlay();"), 'notifikasi harus hilang begitu WhatsApp tertaut');
  assert.ok(js.includes('if (isBotLockedForMember()) return;'), 'notifikasi reaksi harus menunggu sampai WhatsApp tertaut');
  assert.ok(js.includes("if (activeWorkspacePage !== 'mode') return;"), 'notifikasi hanya boleh muncul saat member sedang di halaman Fitur Bot, bukan di dashboard');
  assert.ok(js.includes("if (page === 'mode') {\n    syncPlanCarouselPosition();\n    syncBotLinkNotice();\n  }"), 'membuka Fitur Bot harus langsung mengecek pengingat tautan');
  assert.ok(js.includes('syncBotLinkNotice();'), 'sinkronisasi harus dipanggil dari renderLinkGate agar realtime mengikuti poll pairing');
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
  assert.ok(css.includes('.select-plan.is-locked'), 'tombol terkunci harus tampak redup');
});

test('member belum tertaut tidak bisa masuk Fitur Bot, admin tetap bisa', () => {
  const js = read('public/app.js');
  assert.ok(js.includes("if (page === 'mode' && isBotLockedForMember()) {"), 'masuk Fitur Bot harus dicegat untuk member yang belum tertaut');
  assert.ok(js.includes('showBotLinkNotice();\n    page = \'pairing\';'), 'upaya masuk yang dicegat harus menampilkan notifikasi dan mengarahkan ke Pairing');
  assert.ok(js.includes('function showLinkNoticeOverlay()'), 'isi notifikasi harus dipakai bersama oleh sinkronisasi dan tampilan eksplisit');
  assert.ok(js.includes("botLinkNoticeDismissed = false;\n  showLinkNoticeOverlay();"), 'tampilan eksplisit harus menampilkan notifikasi walau sempat ditutup dan walau belum di Fitur Bot');
});

test('entri Info Update terbaru menjelaskan member belum tertaut tidak bisa masuk Fitur Bot', () => {
  const data = JSON.parse(read('public/info-updates.json'));
  const html = read('public/index.html');
  assert.equal(data.updatedAt, '2026-11-18T07:55:00+07:00', 'updatedAt harus sama dengan waktu entri terbaru');
  assert.equal(data.updates.length, 63, 'daftar harus bertambah satu entri');
  const newest = data.updates[0];
  assert.equal(newest.title, 'Tab panel kini ikut diperbarui sendiri saat ada versi baru', 'entri terbaru harus menjelaskan pembaruan tab otomatis');
  assert.equal(newest.tag, 'Fitur baru', 'entri terbaru harus bertag Fitur baru');
  assert.equal(newest.time, '07.55 WIB', 'waktu entri terbaru harus cocok');
  assert.ok(html.includes('<h4>Tab panel kini ikut diperbarui sendiri saat ada versi baru</h4>'), 'fallback harus memuat judul entri terbaru');
  const rankbotEntry = data.updates[4];
  assert.equal(rankbotEntry.title, 'Halaman Rank Bot untuk melihat bot teraktif', 'entri Rank Bot kini di posisi kelima');
  const linkEntry = data.updates.find((item) => item.title === 'Pemberitahuan tautan WhatsApp kini muncul di layar');
  assert.ok(linkEntry, 'entri notifikasi tautan di layar harus tetap ada');
  assert.equal(data.updates.indexOf(linkEntry), 6, 'entri notifikasi tautan di layar kini di posisi ketujuh');
});
