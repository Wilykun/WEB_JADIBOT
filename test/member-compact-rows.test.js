import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function read(file) {
  return fs.readFile(path.join(ROOT, file), 'utf8');
}

test('kartu Member ringkas di HP: avatar kecil di samping nama, bukan di atas nama', async () => {
  const css = await read('public/style.css');

  // Aturan ringkas harus ada di blok media HP dan mengalahkan tumpukan tengah lama.
  const compact = css.match(/@media \(max-width: 560px\), \(max-width: 1100px\) and \(hover: none\) \{[\s\S]*?\.member-page \.member-account-avatar\{flex-basis:34px;width:34px;height:34px\}/);
  assert.ok(compact, 'harus ada blok ringkas HP untuk kartu Member');
  assert.ok(css.includes('.member-page .member-account-avatar{flex-basis:34px;width:34px;height:34px}'), 'di HP avatar harus 34px, bukan 42px');
  assert.ok(css.includes('.member-page .member-account-top-row{flex-direction:row;align-items:center;justify-content:space-between;gap:10px;text-align:left}'), 'di HP baris atas kartu harus mendatar, bukan menumpuk ke bawah');
  assert.ok(css.includes('.member-page .member-account-identity{flex-direction:row;align-items:center;justify-content:flex-start;width:auto;min-width:0;text-align:left}'), 'di HP foto harus di samping nama, rata kiri');
  assert.ok(css.includes('.member-page .member-account-statuses{justify-content:flex-start}'), 'di HP chip status harus rata kiri');

  // Desktop tetap memakai avatar 44px seperti sebelumnya.
  assert.ok(css.includes('.member-page .member-account-avatar{display:block;flex:0 0 44px;width:44px;height:44px;'), 'di desktop avatar tetap 44px');
});

test('entri Info Update terbaru menjelaskan tampilan Member yang ringkas', async () => {
  const data = JSON.parse(await read('public/info-updates.json'));
  const html = await read('public/index.html');
  assert.equal(data.updatedAt, '2026-11-18T11:15:00+07:00', 'updatedAt harus sama dengan waktu entri terbaru');
  assert.equal(data.updates.length, 64, 'daftar harus 64 entri');
  const newest = data.updates[0];
  assert.equal(newest.title, 'Kotak info di menu samping dihapus; tombol kembali ke atas lebih rapih', 'entri terbaru harus soal kotak info yang dihapus dan tombol kembali ke atas');
  assert.equal(newest.tag, 'Tampilan', 'entri terbaru harus bertag Tampilan');
  assert.equal(newest.day, 'Rabu, 18 Nov 2026', 'hari entri terbaru harus cocok');
  assert.equal(newest.time, '11.15 WIB', 'waktu entri terbaru harus cocok');
  assert.match(newest.description, /menu samping/, 'deskripsi harus menyebut menu samping');
  assert.ok(html.includes('<li class="info-update-item" data-tag="tampilan">'), 'fallback harus memakai slug tampilan untuk entri terbaru');
  assert.ok(html.includes('<h4>Kotak info di menu samping dihapus; tombol kembali ke atas lebih rapih</h4>'), 'fallback harus memuat judul entri terbaru');
  assert.ok(html.includes('Rabu, 18 Nov 2026 · 11.15 WIB'), 'fallback meta harus cocok dengan hari dan waktu entri terbaru');

  // Entri notifikasi menu terkunci sebelumnya kini di posisi ketiga beserta fallback-nya.
  const locked = data.updates[2];
  assert.equal(locked.title, 'Member yang mengetuk menu terkunci kini melihat notifikasi di layar', 'entri notifikasi menu terkunci kini di posisi ketiga');
  assert.equal(locked.tag, 'Tampilan', 'entri notifikasi menu terkunci harus bertag Tampilan');
  assert.equal(locked.time, '07.25 WIB', 'waktu entri notifikasi menu terkunci harus cocok');
  assert.match(locked.description, /Menunya tetap terbuka setelah notifikasi ditutup/, 'deskripsi harus menyebut menu tetap terbuka');

  // Entri kartu Member ringkas sebelumnya kini di posisi keempat beserta fallback-nya.
  const compact = data.updates[3];
  assert.equal(compact.title, 'Tampilan Member kini lebih ringkas di HP', 'entri kartu Member ringkas kini di posisi keempat');
  assert.equal(compact.tag, 'Tampilan', 'entri kartu Member ringkas harus bertag Tampilan');
  assert.equal(compact.time, '05.50 WIB', 'waktu entri kartu Member ringkas harus cocok');
  assert.match(compact.description, /34px/, 'deskripsi harus menyebut ukuran avatar baru 34px');
  assert.match(compact.description, /Kontrol Bot/, 'deskripsi harus menjelaskan kartu Kontrol Bot ikut ringkas');

  // Entri panel lebih cepat sebelumnya kini di posisi kelima beserta fallback-nya.
  const perf = data.updates[4];
  assert.equal(perf.title, 'Panel kini memuat jauh lebih cepat', 'entri panel lebih cepat kini di posisi kelima');
  assert.equal(perf.tag, 'Perbaikan', 'entri panel lebih cepat harus bertag Perbaikan');
  assert.equal(perf.time, '21.50 WIB', 'waktu entri panel lebih cepat harus cocok');
});
