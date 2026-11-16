import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const appJs = await fs.readFile(path.join(ROOT, 'public', 'app.js'), 'utf8');

test('pairing: persetujuan belum dicentang memunculkan gelembung bawaan browser di kotak itu', () => {
  assert.match(appJs, /firstMissing\.setCustomValidity\(firstMissing === ownershipConsent/);
  assert.match(appJs, /Centang Konfirmasi kepemilikan dulu — wajib sebelum pairing\./);
  assert.match(appJs, /Centang Setuju dengan mode otomatis dulu — wajib sebelum pairing\./);
  assert.match(appJs, /firstMissing\.reportValidity\(\);/);
  assert.ok(!appJs.includes('Wajib centang 2 persetujuan terlebih dahulu'), 'kotak notif generik di bawah tombol sudah diganti gelembung');
});

test('pairing: nomor tidak valid memunculkan gelembung bawaan browser di kolom nomor', () => {
  assert.match(appJs, /pairingPhoneInput\.setCustomValidity\('Masukkan 7–15 digit dengan kode negara, tanpa tanda \+ atau pemisah\.'\);/);
  assert.match(appJs, /pairingPhoneInput\.setCustomValidity\('Nomor belum valid menurut format penomoran internasional\. Periksa kode negara dan digitnya\.'\);/);
  assert.ok(appJs.includes('pairingPhoneInput.reportValidity();'), 'gelembung nomor ditampilkan lewat reportValidity');
  assert.ok(!appJs.includes('Untuk Pairing Code, masukkan 7–15 digit'), 'notif kotak untuk format nomor sudah diganti gelembung');
  assert.ok(!appJs.includes('Valid menurut format belum memastikan nomor memiliki akun WhatsApp.'), 'notif kotak untuk nomor tidak valid sudah diganti gelembung');
});

test('pairing: pemilih metode tetap tampil setelah Gasss pertama walau nomor tidak valid', () => {
  assert.match(appJs, /Pemilih metode tampil begitu langkahnya dibuka, apa pun validitas nomornya/);
  assert.match(appJs, /showMethodPicker\(pairingMethodPickerUnlocked\);/);
  assert.ok(!appJs.includes('showMethodPicker(valid)'), 'pemilih metode tidak lagi disembunyikan oleh validitas nomor');
});

test('pairing: pesan validasi kustom dibersihkan begitu isian diperbaiki', () => {
  assert.match(appJs, /input\.setCustomValidity\(''\);/);
  assert.match(appJs, /event\.target\.setCustomValidity\(''\);/);
});
