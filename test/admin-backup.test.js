import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { createEncryptedBackup, createPlainBackupZip, decryptEncryptedBackup } from '../server/admin-backup.js';

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

function readPlainZipEntries(archive) {
  const end = archive.length - 22;
  assert.equal(archive.readUInt32LE(end), 0x06054b50);
  const total = archive.readUInt16LE(end + 10);
  const directoryOffset = archive.readUInt32LE(end + 16);
  const entries = new Map();
  let cursor = directoryOffset;
  for (let i = 0; i < total; i += 1) {
    assert.equal(archive.readUInt32LE(cursor), 0x02014b50);
    const method = archive.readUInt16LE(cursor + 10);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const plainSize = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const name = archive.toString('ascii', cursor + 46, cursor + 46 + nameLength);
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = archive.subarray(dataStart, dataStart + compressedSize);
    const data = method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
    assert.equal(data.length, plainSize);
    entries.set(name, data);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

test('plain backup ZIP holds the same files uncompressed by password and round-trips', () => {
  const payload = {
    files: [
      { path: 'panel/store.json', data: Buffer.from('{"users":[]}', 'utf8').toString('base64') },
      { path: 'DATA_AKUN/MEMBER/test/session.json', data: Buffer.from('{"creds":{}}', 'utf8').toString('base64') },
    ],
    sessionSecret: 'rahasia-sesi-uji',
  };
  const archive = createPlainBackupZip(payload);
  assert.equal(archive.readUInt32LE(0), 0x04034b50);
  const entries = readPlainZipEntries(archive);
  assert.equal(entries.get('panel/store.json').toString('utf8'), '{"users":[]}');
  assert.equal(entries.get('DATA_AKUN/MEMBER/test/session.json').toString('utf8'), '{"creds":{}}');
  assert.equal(entries.get('panel/session-secret.txt').toString('utf8'), 'rahasia-sesi-uji');
});

test('server punya endpoint unduh langsung + kirim Telegram khusus admin', () => {
  const serverJs = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  assert.equal(serverJs.includes("route === 'GET /api/admin/backup/download'"), true);
  assert.equal(serverJs.includes("route === 'POST /api/admin/backup/telegram'"), true);
  assert.equal(serverJs.includes("route === 'GET /api/admin/backup/telegram-status'"), true);
  assert.equal(serverJs.includes('data/telegram.json'), true);
  assert.equal(serverJs.includes('TELEGRAM_BOT_TOKEN'), true);
  assert.equal(serverJs.includes('sendDocument'), true);
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
