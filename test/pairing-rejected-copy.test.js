import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const appJs = await fs.readFile(path.join(ROOT, 'public', 'app.js'), 'utf8');
const indexHtml = await fs.readFile(path.join(ROOT, 'public', 'index.html'), 'utf8');

test('sesi ditolak: form pairing langsung tampil, tanpa kartu pemulihan', () => {
  assert.match(appJs, /ditolak WhatsApp dan tidak bisa dipulihkan\. Masukkan nomor untuk pairing ulang\./);
  assert.match(appJs, /Perlu pairing ulang/);
  assert.match(appJs, /sesi lama dibersihkan saat pairing baru dimulai\./);
  assert.match(indexHtml, /<strong>Sesi ditolak WhatsApp<\/strong>/);
  assert.match(indexHtml, /ditolak WhatsApp dan tidak bisa dipulihkan\. Masukkan nomor untuk pairing ulang/);
});

test('sesi ditolak: tidak ada lagi ajakan pemulihan yang pasti gagal', () => {
  assert.ok(!appJs.includes('Coba pulihkan dulu'), 'jangan lagi menyuruh pulihkan sesi yang sudah mati');
  assert.ok(!appJs.includes('masih terdaftar tertaut'), 'jangan lagi bilang nomor masih terdaftar tertaut');
  assert.ok(!appJs.includes('perangkatmu masih tertaut'), 'jangan lagi bilang perangkatmu masih tertaut');
  assert.ok(!appJs.includes('Bisa dipulihkan'), 'jangan lagi klaim sesi pasti bisa dipulihkan');
  assert.ok(!appJs.includes('Perangkat masih tertaut di WhatsApp. Coba pulihkan dulu'), 'deskripsi status lama sudah diganti');
  assert.ok(!indexHtml.includes('<strong>Perangkat masih tertaut di WhatsApp</strong>'), 'judul kartu lama sudah diganti');
  assert.ok(!indexHtml.includes('masih terdaftar tertaut'), 'teks statis lama sudah diganti');
  assert.ok(!indexHtml.includes('Coba pulihkan dulu'), 'teks statis pemulihan sudah diganti');
});
