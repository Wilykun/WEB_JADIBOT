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
  assert.equal(data.updatedAt, '2026-11-18T05:50:00+07:00', 'updatedAt harus sama dengan waktu entri terbaru');
  assert.equal(data.updates.length, 61, 'daftar harus 61 entri');
  const newest = data.updates[0];
  assert.equal(newest.title, 'Tampilan Member kini lebih ringkas di HP', 'entri terbaru harus soal tampilan Member yang ringkas');
  assert.equal(newest.tag, 'Tampilan', 'entri terbaru harus bertag Tampilan');
  assert.equal(newest.day, 'Rabu, 18 Nov 2026', 'hari entri terbaru harus cocok');
  assert.equal(newest.time, '05.50 WIB', 'waktu entri terbaru harus cocok');
  assert.match(newest.description, /34px/, 'deskripsi harus menyebut ukuran avatar baru 34px');
  assert.match(newest.description, /Kontrol Bot/, 'deskripsi harus menjelaskan kartu Kontrol Bot ikut ringkas');
  assert.ok(html.includes('<li class="info-update-item" data-tag="tampilan">'), 'fallback harus memakai slug tampilan untuk entri terbaru');
  assert.ok(html.includes('<h4>Tampilan Member kini lebih ringkas di HP</h4>'), 'fallback harus memuat judul entri terbaru');
  assert.ok(html.includes('Rabu, 18 Nov 2026 · 05.50 WIB'), 'fallback meta harus cocok dengan hari dan waktu entri terbaru');

  // Entri panel lebih cepat sebelumnya kini di posisi kedua beserta fallback-nya.
  const perf = data.updates[1];
  assert.equal(perf.title, 'Panel kini memuat jauh lebih cepat', 'entri panel lebih cepat kini di posisi kedua');
  assert.equal(perf.tag, 'Perbaikan', 'entri panel lebih cepat harus bertag Perbaikan');
  assert.equal(perf.time, '21.50 WIB', 'waktu entri panel lebih cepat harus cocok');
});
