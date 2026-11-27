import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function read(file) {
  return fs.readFile(path.join(ROOT, file), 'utf8');
}

test('kotak info Pairing/Worker di menu samping sudah dihapus', async () => {
  const html = await read('public/index.html');

  // Kotak info itu statis dan selalu tampil walau bot sebenarnya sedang jalan,
  // jadi membingungkan — Wily minta dihapus dari menu samping. Teksnya kini
  // hanya boleh muncul sekali, di dalam deskripsi entri Info Update yang
  // menjelaskan penghapusan itu, bukan lagi sebagai kotak di menu samping.
  assert.ok(!html.includes('sidebar-note'), 'menu samping tidak boleh lagi memuat kotak info sidebar-note');
  assert.equal((html.match(/Worker fitur bot belum dijalankan/g) || []).length, 1, 'teks worker belum dijalankan hanya boleh ada di deskripsi Info Update');
  assert.equal((html.match(/Pairing tersedia per akun/g) || []).length, 1, 'teks pairing tersedia per akun hanya boleh ada di deskripsi Info Update');

  // Menu samping tetap utuh: tombol Keluar dan penanda versi tetap ada.
  assert.ok(html.includes('data-action="logout"'), 'tombol Keluar harus tetap ada di menu samping');
  assert.ok(html.includes('READSTORYWA BY WILYKUN'), 'penanda versi panel harus tetap ada di menu samping');
});

test('style.css memakai versi baru agar kartu Member ringkas sampai ke HP', async () => {
  const html = await read('public/index.html');

  // Kartu ringkas (avatar 34px) sudah ada di style.css sejak lama, tapi HP yang
  // pernah membuka panel tetap memakai style.css lama yang di-cache immutable
  // setahun — tanpa bump versi, perbaikan tidak pernah sampai ke HP.
  assert.ok(html.includes('/style.css?v=konfirmasi-kode-sementara-20261128'), 'index.html harus memuat style.css dengan versi membercompact-20261118');
  assert.ok(!html.includes('/style.css?v=fiturbot-v2-20261117'), 'versi style.css lama tidak boleh lagi dipakai');
});

test('tombol kembali ke atas berlatar penuh agar rapih di atas daftar', async () => {
  const css = await read('public/style.css');

  // Tombol ↑ melayang di atas daftar; latarnya dulu tembus pandang (alpha .92)
  // sehingga garis kartu terlihat menembus tombol — kini harus berlatar penuh.
  const rule = css.match(/\.back-to-top\{[^}]*\}/);
  assert.ok(rule, 'aturan .back-to-top harus ada di style.css');
  assert.ok(rule[0].includes('linear-gradient(145deg,#2fd68f,#1f9d63)'), 'latar tombol kembali ke atas harus penuh, bukan tembus pandang');
  assert.ok(!rule[0].includes('rgba(39,191,115,.92)'), 'latar tembus pandang lama tidak boleh lagi dipakai');
  assert.ok(css.includes('.back-to-top.is-visible{opacity:1'), 'tombol tetap muncul setelah halaman di-scroll ke bawah');
});
