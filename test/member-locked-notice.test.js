import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function read(file) {
  return fs.readFile(path.join(ROOT, file), 'utf8');
}

test('menu Backup dan Kontrol Bot yang terkunci menampilkan notifikasi di tengah layar untuk member', async () => {
  const js = await read('public/app.js');

  // Penolong notifikasi menu terkunci harus ada dan memakai overlay yang sama.
  assert.ok(js.includes('function showLockedNotice(featureName)'), 'harus ada penolong notifikasi menu terkunci');
  assert.ok(js.includes("context: { kind: 'locked', feature: featureName }"), 'notifikasi terkunci harus membawa konteks locked beserta nama fiturnya');
  assert.ok(js.includes('addLabel: null'), 'notifikasi terkunci harus tanpa tombol aksi');
  assert.ok(js.includes("title: `${featureName} hanya untuk admin`"), 'judul harus menyebut nama fitur dan hanya untuk admin');
  assert.ok(js.includes('hanya bisa dibuka Admin Utama dan admin biasa'), 'teks harus menjelaskan hanya admin yang bisa membuka');

  // Klik menu terkunci memakai overlay, bukan toast kecil lagi.
  assert.ok(js.includes("showLockedNotice('Backup')"), 'klik Backup terkunci harus menampilkan notifikasi');
  assert.ok(js.includes("showLockedNotice('Kontrol Bot')"), 'klik Kontrol Bot terkunci harus menampilkan notifikasi');
  assert.ok(!js.includes("showToast('Backup hanya untuk admin.')"), 'klik Backup terkunci tidak boleh lagi memakai toast');
  assert.ok(!js.includes("showToast('Kontrol Bot hanya untuk admin.')"), 'klik Kontrol Bot terkunci tidak boleh lagi memakai toast');

  // Upaya masuk langsung lewat setWorkspacePage juga menampilkan notifikasi yang sama.
  assert.ok(js.includes("showLockedNotice(page === 'backup' ? 'Backup' : 'Kontrol Bot')"), 'upaya masuk langsung ke halaman terkunci harus menampilkan notifikasi');

  // Halaman harus memuat app.js dengan versi baru (cache-busting): versi lama
  // di-cache immutable setahun, jadi tanpa bump ini HP yang pernah buka panel
  // tetap menjalankan kode lama (toast) walau server sudah menyajikan kode baru.
  const html = await read('public/index.html');
  assert.ok(html.includes('/app.js?v=lockednotice-20261118'), 'index.html harus memuat app.js dengan versi lockednotice-20261118');
  assert.ok(!html.includes('/app.js?v=perf-20261117'), 'versi app.js lama tidak boleh lagi dipakai');
});

test('overlay mendukung notifikasi tanpa tombol aksi dan tidak menelan ingatan notifikasi lain', async () => {
  const js = await read('public/app.js');

  // addLabel null menyembunyikan tombol utama dan memindahkan fokus ke tombol Tutup.
  assert.ok(js.includes("addButton.classList.toggle('hidden', addLabel === null)"), 'tombol utama harus disembunyikan bila addLabel null');
  assert.ok(js.includes("if (addLabel === null) overlay.querySelector('[data-emoji-notice-close]')?.focus();"), 'fokus harus pindah ke tombol Tutup bila tanpa tombol aksi');
  // Penjaga notifikasi yang sama harus membedakan fitur terkunci (Backup vs Kontrol Bot).
  assert.ok(js.includes('noticeContext?.feature === nextContext.feature'), 'penjaga notifikasi harus membandingkan nama fitur');

  // Menutup notifikasi terkunci tidak boleh mematikan ingatan notifikasi reaksi.
  assert.ok(js.includes("} else if (noticeContext?.kind === 'locked') {"), 'dismiss harus punya cabang khusus untuk locked');
  const branchStart = js.indexOf("} else if (noticeContext?.kind === 'locked') {");
  const branchEnd = js.indexOf('} else {', branchStart);
  const branchBody = js.slice(branchStart, branchEnd);
  assert.ok(!branchBody.includes('emojiNoticeDismissed'), 'cabang locked tidak boleh menyentuh ingatan notifikasi reaksi');
});

test('entri Info Update terbaru menjelaskan notifikasi menu terkunci', async () => {
  const data = JSON.parse(await read('public/info-updates.json'));
  const html = await read('public/index.html');
  assert.equal(data.updatedAt, '2026-11-18T07:25:00+07:00', 'updatedAt harus sama dengan waktu entri terbaru');
  assert.equal(data.updates.length, 62, 'daftar harus 62 entri');
  const newest = data.updates[0];
  assert.equal(newest.title, 'Member yang mengetuk menu terkunci kini melihat notifikasi di layar', 'entri terbaru harus soal notifikasi menu terkunci');
  assert.equal(newest.tag, 'Tampilan', 'entri terbaru harus bertag Tampilan');
  assert.equal(newest.day, 'Rabu, 18 Nov 2026', 'hari entri terbaru harus cocok');
  assert.equal(newest.time, '07.25 WIB', 'waktu entri terbaru harus cocok');
  assert.match(newest.description, /Admin Utama dan admin biasa tidak melihat/, 'deskripsi harus menjelaskan admin tidak melihat notifikasi ini');
  assert.ok(html.includes('<li class="info-update-item" data-tag="tampilan">'), 'fallback harus memakai slug tampilan untuk entri terbaru');
  assert.ok(html.includes('<h4>Member yang mengetuk menu terkunci kini melihat notifikasi di layar</h4>'), 'fallback harus memuat judul entri terbaru');
  assert.ok(html.includes('Rabu, 18 Nov 2026 · 07.25 WIB'), 'fallback meta harus cocok dengan hari dan waktu entri terbaru');

  // Entri kartu Member ringkas sebelumnya kini di posisi kedua beserta fallback-nya.
  const compact = data.updates[1];
  assert.equal(compact.title, 'Tampilan Member kini lebih ringkas di HP', 'entri kartu Member ringkas kini di posisi kedua');
  assert.equal(compact.tag, 'Tampilan', 'entri kartu Member ringkas harus bertag Tampilan');
  assert.equal(compact.time, '05.50 WIB', 'waktu entri kartu Member ringkas harus cocok');
});
