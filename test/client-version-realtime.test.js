// RONDE 45: notifikasi "Versi baru tersedia" (cek versi tiap heartbeat +
// tawaran muat ulang) SUDAH DIHAPUS atas permintaan Wily — notif Pembaruan
// baru (Info Update, ronde 32) sudah lebih bagus: menampilkan isi update-nya.
// File ini dulu menguji mekanisme cek versi; kini hanya tersisa tes yang
// tidak terkait versi (menu/overlay + entri Info Update terbaru).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('menu tetap terbuka setelah notifikasi menu terkunci ditutup', async () => {
  const js = await readFile(path.join(sourceRoot, 'public', 'app.js'), 'utf8');
  // Penutup menu lewat klik di luar menu harus mengabaikan ketukan di atas overlay modal.
  assert.ok(js.includes("if (event.target.closest?.('#emoji-notice-overlay, .confirm-overlay')) return;"), 'klik di atas overlay tidak boleh menutup menu');
  // Escape saat overlay terbuka hanya menutup overlay, bukan menunya.
  assert.ok(js.includes("document.querySelector('#emoji-notice-overlay:not(.hidden)')"), 'Escape harus memeriksa overlay notifikasi sebelum menutup menu');
});

test('entri Info Update terbaru', async () => {
  const data = JSON.parse(await readFile(path.join(sourceRoot, 'public', 'info-updates.json'), 'utf8'));
  const html = await readFile(path.join(sourceRoot, 'public', 'index.html'), 'utf8');
  assert.equal(data.updates.length, 142, 'jumlah entri harus cocok');
  const newest = data.updates[0];
  assert.equal(newest.title, 'Masuk dan Lupa sandi tidak lagi terpental ke Pilih akun', 'judul entri terbaru harus cocok');
  assert.equal(newest.tag, 'Bug', 'tag entri terbaru harus cocok');
  assert.equal(newest.day, 'Sabtu, 28 Nov 2026', 'hari entri terbaru harus cocok');
  assert.ok(html.includes(`<h4>${newest.title}</h4>`), 'fallback harus memuat judul entri terbaru');

  // Entri notifikasi menu terkunci; deskripsinya menyebut menunya tetap
  // terbuka setelah notifikasi ditutup.
  const locked = data.updates[80];
  assert.equal(locked.title, 'Member yang mengetuk menu terkunci kini melihat notifikasi di layar', 'entri notifikasi menu terkunci harus di posisi yang benar');
  assert.match(locked.description, /Menunya tetap terbuka setelah notifikasi ditutup/, 'deskripsi harus menyebut menu tetap terbuka');
});

test('ronde 45: notifikasi Versi baru tersedia sudah dihapus total', async () => {
  const js = await readFile(path.join(sourceRoot, 'public', 'app.js'), 'utf8');
  const server = await readFile(path.join(sourceRoot, 'server', 'index.js'), 'utf8');
  assert.ok(!js.includes('Versi baru tersedia'), 'klien TIDAK boleh lagi menyebut Versi baru tersedia');
  assert.ok(!js.includes('checkClientVersion'), 'klien TIDAK boleh lagi punya pemeriksa versi');
  assert.ok(!js.includes('newVersionPrompted'), 'klien TIDAK boleh lagi mengingat tawaran versi');
  assert.ok(!js.includes('loadedClientVersion'), 'klien TIDAK boleh lagi membaca versinya sendiri');
  assert.ok(!js.includes('isClientIdleForReload'), 'klien TIDAK boleh lagi memeriksa idle untuk muat ulang');
  assert.ok(!js.includes("noticeContext?.kind === 'version'"), 'dismiss TIDAK boleh lagi punya cabang versi');
  assert.ok(!server.includes('function getClientVersion()'), 'server TIDAK boleh lagi punya penolong versi klien');
  assert.ok(!server.includes('version: getClientVersion()'), 'heartbeat TIDAK boleh lagi mengembalikan versi');
  assert.ok(server.includes('return sendJson(res, 200, { ok: true, latestLoginAt });'), 'heartbeat harus tetap mengembalikan login terbaru akun lain');
  // Notifikasi Pembaruan baru (yang lebih bagus) harus tetap ada.
  assert.ok(js.includes('showInfoUpdateNoticeModal'), 'notif Pembaruan baru harus tetap ada');
});
