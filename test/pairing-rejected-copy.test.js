import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const appJs = await fs.readFile(path.join(ROOT, 'public', 'app.js'), 'utf8');
const indexHtml = await fs.readFile(path.join(ROOT, 'public', 'index.html'), 'utf8');

test('sesi ditolak: kartu pemulihan menjelaskan pencabutan + hapus perangkat lama + pairing ulang', () => {
  assert.match(appJs, /Kalau pulihkan gagal terus, berarti sesi ini sudah dicabut WhatsApp: hapus perangkat lama di WhatsApp > Perangkat tertaut, lalu pairing ulang dengan nomor baru\./);
  assert.match(appJs, /Coba pulihkan dulu\. Kalau gagal terus, hapus perangkat lama di WhatsApp > Perangkat tertaut lalu pairing ulang\./);
  assert.match(appJs, /Sesi ditolak WhatsApp\. Coba pulihkan dulu; kalau gagal terus, hapus perangkat lama di WhatsApp lalu pairing ulang\./);
  assert.match(indexHtml, /<strong>Sesi ditolak WhatsApp<\/strong>/);
  assert.match(indexHtml, /hapus perangkat lama di WhatsApp &gt; Perangkat tertaut, lalu pairing ulang dengan nomor baru/);
});

test('sesi ditolak: tidak ada lagi kata-kata lama yang menyesatkan', () => {
  assert.ok(!appJs.includes('masih terdaftar tertaut'), 'jangan lagi bilang nomor masih terdaftar tertaut');
  assert.ok(!appJs.includes('perangkatmu masih tertaut'), 'jangan lagi bilang perangkatmu masih tertaut');
  assert.ok(!appJs.includes('Bisa dipulihkan'), 'jangan lagi klaim sesi pasti bisa dipulihkan');
  assert.ok(!appJs.includes('Perangkat masih tertaut di WhatsApp. Coba pulihkan dulu'), 'deskripsi status lama sudah diganti');
  assert.ok(!indexHtml.includes('<strong>Perangkat masih tertaut di WhatsApp</strong>'), 'judul kartu lama sudah diganti');
  assert.ok(!indexHtml.includes('masih terdaftar tertaut'), 'teks statis lama sudah diganti');
});
