import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const serverJs = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const appJs = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('login gagal membedakan akun tidak ditemukan dan kata sandi salah, dengan menyebut identifier yang diketik', () => {
  // Akun tidak ditemukan (404): pesan harus menyebut identifier yang diketik dan menyatakan akunnya tidak ditemukan.
  assert.match(serverJs, /Akun \$\{rawIdentifier\} tidak ditemukan\. Periksa ejaan atau daftar dulu\./, 'pesan 404 login harus menyebut identifier yang diketik dan menyatakan akun tidak ditemukan');
  // Kata sandi salah (401): pesan harus menyebut identifier yang diketik dan menyatakan akunnya ditemukan tapi kata sandinya salah.
  assert.match(serverJs, /Akun \$\{rawIdentifier\} ditemukan, tapi kata sandi salah\. Coba lagi\./, 'pesan 401 login harus menyebut identifier yang diketik dan menyatakan akun ditemukan tapi kata sandi salah');
  // Identifier yang dipakai di pesan harus yang diketik apa adanya (trim), bukan yang sudah dilowercase untuk pencocokan.
  assert.match(serverJs, /const rawIdentifier = String\(body\.identifier \|\| ''\)\.trim\(\)\.slice\(0, 254\);/, 'login harus menyimpan identifier apa adanya untuk pesan error');
  assert.match(serverJs, /const identifier = rawIdentifier\.toLowerCase\(\);/, 'pencocokan akun tetap memakai identifier lowercase');
  // Pesan lama yang generik tidak boleh lagi dipakai untuk dua kasus ini.
  assert.doesNotMatch(serverJs, /Akun dengan email\/username itu belum terdaftar\. Silakan daftar dulu\./, 'pesan 404 generik lama harus diganti dengan pesan yang menyebut identifier');
  assert.doesNotMatch(serverJs, /return sendError\(res, 401, 'Kata sandi salah\. Coba lagi\.'\)/, 'pesan 401 generik lama harus diganti dengan pesan yang menyebut identifier');
});

test('klien menampilkan pesan error login dari server apa adanya', () => {
  assert.match(appJs, /else setAuthMessage\(error\.message\)/, 'login gagal harus menampilkan pesan error dari server lewat setAuthMessage');
});
