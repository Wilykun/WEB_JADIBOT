import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createEncryptedBackup, decryptEncryptedBackup } from '../server/admin-backup.js';

const passphrase = 'kunci-backup-uji-2026';

test('encrypted ZIP round-trips the payload without exposing plaintext', async () => {
  const payload = { marker: 'secret-user-data', files: [{ path: 'panel/store.json', content: 'private-value' }] };
  const archive = await createEncryptedBackup(payload, passphrase);
  assert.equal(archive.readUInt32LE(0), 0x04034b50);
  assert.equal(archive.includes(Buffer.from('secret-user-data')), false);
  const result = await decryptEncryptedBackup(archive, passphrase);
  assert.equal(result.manifest.format, 'ReadSW-Console-Backup');
  assert.deepEqual(result.payload, payload);
});

test('rejects an incorrect passphrase and tampered ZIP bytes', async () => {
  const archive = await createEncryptedBackup({ marker: 'data' }, passphrase);
  await assert.rejects(decryptEncryptedBackup(archive, 'kata-sandi-yang-salah'), /Kata sandi salah|diubah/);
  const tampered = Buffer.from(archive);
  tampered[40] ^= 0x20;
  await assert.rejects(decryptEncryptedBackup(tampered, passphrase));
});

test('backup mengizinkan file pemulihan sesi (.good/.bak) dan melewati sisa sesi mati (.MATI-)', () => {
  const serverJs = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  assert.equal(serverJs.includes('\\.(json|webp|upload|txt|bin|good|bak)$/i'), true);
  assert.equal(serverJs.includes('File pemulihan sesi'), true);
  assert.equal(serverJs.includes("entry.name.includes('.MATI-')"), true);
});

test('rejects archives containing unrecognized path entries', async () => {
  const archive = await createEncryptedBackup({ marker: 'data' }, passphrase);
  const altered = Buffer.from(archive);
  const original = Buffer.from('manifest.json');
  const malicious = Buffer.from('../bad__.json');
  assert.equal(original.length, malicious.length);
  let offset = 0;
  let replaced = 0;
  while ((offset = altered.indexOf(original, offset)) >= 0) {
    malicious.copy(altered, offset);
    offset += malicious.length;
    replaced += 1;
  }
  assert.equal(replaced, 2);
  await assert.rejects(decryptEncryptedBackup(altered, passphrase), /entri tak dikenal/);
});
