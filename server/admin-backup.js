import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const FORMAT = 'ReadSW-Console-Backup';
const VERSION = 1;
const KDF_N = 32_768;
const KDF_R = 8;
const KDF_P = 1;
export const MAX_ARCHIVE_BYTES = 80 * 1024 * 1024;
export const MAX_PLAINTEXT_BYTES = 70 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 8 * 1024;
const MAX_ZIP_ENTRIES = 2;

export class BackupArchiveError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BackupArchiveError';
    this.status = 400;
  }
}

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let bit = 0; bit < 8; bit += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[n] = c >>> 0;
}
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function dosDateTime(date = new Date()) {
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}
function zipStored(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { time, day } = dosDateTime();
  for (const [name, value] of entries) {
    const nameBytes = Buffer.from(name, 'ascii');
    const data = Buffer.from(value);
    if (!nameBytes.length || nameBytes.toString('ascii') !== name || data.length > 0xffffffff) {
      throw new BackupArchiveError('Isi arsip terlalu besar atau nama entri tidak valid.');
    }
    const checksum = crc32(data);
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    nameBytes.copy(local, 30);
    localParts.push(local, data);

    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBytes.copy(central, 46);
    centralParts.push(central);
    offset += local.length + data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  if (entries.length > 0xffff || offset > 0xffffffff || centralDirectory.length > 0xffffffff) {
    throw new BackupArchiveError('Arsip melewati batas format ZIP yang didukung.');
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}
function unzipStored(archive) {
  const buffer = Buffer.from(archive);
  if (buffer.length < 22 || buffer.length > MAX_ARCHIVE_BYTES) throw new BackupArchiveError('Ukuran file ZIP tidak valid atau melewati batas.');
  const searchStart = Math.max(0, buffer.length - 65_557);
  let endOffset = -1;
  for (let i = buffer.length - 22; i >= searchStart; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { endOffset = i; break; }
  }
  if (endOffset < 0) throw new BackupArchiveError('Struktur ZIP tidak dikenali.');
  const diskNumber = buffer.readUInt16LE(endOffset + 4);
  const directoryDisk = buffer.readUInt16LE(endOffset + 6);
  const diskEntries = buffer.readUInt16LE(endOffset + 8);
  const totalEntries = buffer.readUInt16LE(endOffset + 10);
  const directorySize = buffer.readUInt32LE(endOffset + 12);
  const directoryOffset = buffer.readUInt32LE(endOffset + 16);
  const commentLength = buffer.readUInt16LE(endOffset + 20);
  if (diskNumber || directoryDisk || diskEntries !== totalEntries || totalEntries !== MAX_ZIP_ENTRIES
    || commentLength !== 0 || endOffset + 22 !== buffer.length
    || directoryOffset + directorySize !== endOffset) {
    throw new BackupArchiveError('ZIP harus berisi dua file backup valid tanpa arsip tambahan.');
  }

  const entries = new Map();
  let cursor = directoryOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > endOffset || buffer.readUInt32LE(cursor) !== 0x02014b50) throw new BackupArchiveError('Daftar isi ZIP rusak.');
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const checksum = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const plainSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const entryCommentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const centralEnd = cursor + 46 + nameLength + extraLength + entryCommentLength;
    if (centralEnd > endOffset || flags !== 0 || method !== 0 || compressedSize !== plainSize
      || plainSize > MAX_PLAINTEXT_BYTES + MAX_MANIFEST_BYTES || localOffset + 30 > directoryOffset) {
      throw new BackupArchiveError('ZIP memakai fitur atau ukuran yang tidak didukung.');
    }
    const name = buffer.toString('ascii', cursor + 46, cursor + 46 + nameLength);
    if (!['manifest.json', 'payload.enc'].includes(name) || entries.has(name)) throw new BackupArchiveError('ZIP memuat entri tak dikenal atau duplikat.');
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new BackupArchiveError('Header ZIP lokal rusak.');
    const localFlags = buffer.readUInt16LE(localOffset + 6);
    const localMethod = buffer.readUInt16LE(localOffset + 8);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const localName = buffer.toString('ascii', localOffset + 30, localOffset + 30 + localNameLength);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (localFlags !== flags || localMethod !== method || localName !== name || dataEnd > directoryOffset) {
      throw new BackupArchiveError('Isi ZIP tidak cocok dengan daftar file.');
    }
    const data = buffer.subarray(dataStart, dataEnd);
    if (crc32(data) !== checksum) throw new BackupArchiveError('Pemeriksaan integritas ZIP gagal.');
    entries.set(name, Buffer.from(data));
    cursor = centralEnd;
  }
  if (cursor !== endOffset || !entries.has('manifest.json') || !entries.has('payload.enc')) {
    throw new BackupArchiveError('File backup tidak lengkap.');
  }
  if (entries.get('manifest.json').length > MAX_MANIFEST_BYTES) throw new BackupArchiveError('Manifest backup terlalu besar.');
  return entries;
}
function validatePassphrase(value) {
  const passphrase = String(value ?? '').normalize('NFC');
  const bytes = Buffer.byteLength(passphrase, 'utf8');
  if ([...passphrase].length < 12 || bytes > 512) throw new BackupArchiveError('Kata sandi backup minimal 12 karakter dan maksimal 512 byte.');
  return passphrase;
}
function aad(manifest) {
  return Buffer.from(`${manifest.format}|${manifest.version}|${manifest.kdf}|${manifest.salt}|${manifest.iv}`, 'utf8');
}
async function deriveKey(passphrase, salt) {
  return scrypt(passphrase, salt, 32, { N: KDF_N, r: KDF_R, p: KDF_P, maxmem: 64 * 1024 * 1024 });
}

function zipDeflated(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { time, day } = dosDateTime();
  for (const [name, value] of entries) {
    const nameBytes = Buffer.from(name, 'ascii');
    const data = Buffer.from(value);
    if (!nameBytes.length || nameBytes.toString('ascii') !== name || data.length > 0xffffffff) {
      throw new BackupArchiveError('Isi arsip terlalu besar atau nama entri tidak valid.');
    }
    const checksum = crc32(data);
    const compressed = deflateRawSync(data, { level: 6 });
    if (compressed.length > 0xffffffff) throw new BackupArchiveError('Isi arsip terlalu besar.');
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    nameBytes.copy(local, 30);
    localParts.push(local, compressed);

    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBytes.copy(central, 46);
    centralParts.push(central);
    offset += local.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  if (entries.length > 0xffff || offset > 0xffffffff || centralDirectory.length > 0xffffffff) {
    throw new BackupArchiveError('Arsip melewati batas format ZIP yang didukung.');
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

// ZIP biasa (tanpa sandi) berisi file backup apa adanya, dikompres
// DEFLATE supaya ukurannya kecil untuk diunduh langsung di HP dan
// dikirim lewat Telegram (batas file bot 50 MB). Berbeda dengan arsip
// terenkripsi, ZIP ini TIDAK memakai passphrase dan bisa dibuka siapa
// pun yang memegang filenya, jadi simpan di tempat aman.
export function createPlainBackupZip(payload) {
  if (!payload || !Array.isArray(payload.files) || typeof payload.sessionSecret !== 'string') {
    throw new BackupArchiveError('Data backup tidak valid.');
  }
  const entries = payload.files.map((file) => [file.path, Buffer.from(file.data, 'base64')]);
  entries.push(['panel/session-secret.txt', Buffer.from(payload.sessionSecret, 'utf8')]);
  const archive = zipDeflated(entries);
  if (archive.length > MAX_ARCHIVE_BYTES) throw new BackupArchiveError('Arsip backup melewati batas ukuran maksimum 80 MiB.');
  return archive;
}

export async function createEncryptedBackup(payload, passphraseValue) {
  const passphrase = validatePassphrase(passphraseValue);
  const plain = Buffer.from(JSON.stringify(payload), 'utf8');
  if (plain.length > MAX_PLAINTEXT_BYTES) throw new BackupArchiveError('Data backup terenkode melewati batas ukuran maksimum 70 MiB.');
  const manifest = {
    format: FORMAT,
    version: VERSION,
    createdAt: new Date().toISOString(),
    cipher: 'aes-256-gcm',
    kdf: 'scrypt-n32768-r8-p1',
    salt: randomBytes(16).toString('hex'),
    iv: randomBytes(12).toString('hex'),
  };
  const key = await deriveKey(passphrase, Buffer.from(manifest.salt, 'hex'));
  const cipher = createCipheriv('aes-256-gcm', key, Buffer.from(manifest.iv, 'hex'));
  cipher.setAAD(aad(manifest));
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  manifest.tag = cipher.getAuthTag().toString('hex');
  const archive = zipStored([
    ['manifest.json', Buffer.from(`${JSON.stringify(manifest)}\n`, 'utf8')],
    ['payload.enc', encrypted],
  ]);
  if (archive.length > MAX_ARCHIVE_BYTES) throw new BackupArchiveError('Arsip backup melewati batas ukuran maksimum 80 MiB.');
  return archive;
}

export async function decryptEncryptedBackup(archive, passphraseValue) {
  const passphrase = validatePassphrase(passphraseValue);
  const entries = unzipStored(archive);
  let manifest;
  try { manifest = JSON.parse(entries.get('manifest.json').toString('utf8')); }
  catch { throw new BackupArchiveError('Manifest backup tidak valid.'); }
  if (!manifest || manifest.format !== FORMAT || manifest.version !== VERSION
    || manifest.cipher !== 'aes-256-gcm' || manifest.kdf !== 'scrypt-n32768-r8-p1'
    || !/^[a-f0-9]{32}$/.test(manifest.salt || '')
    || !/^[a-f0-9]{24}$/.test(manifest.iv || '')
    || !/^[a-f0-9]{32}$/.test(manifest.tag || '')
    || !Number.isFinite(Date.parse(manifest.createdAt))) {
    throw new BackupArchiveError('Format atau versi backup tidak didukung.');
  }
  try {
    const key = await deriveKey(passphrase, Buffer.from(manifest.salt, 'hex'));
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(manifest.iv, 'hex'));
    decipher.setAAD(aad(manifest));
    decipher.setAuthTag(Buffer.from(manifest.tag, 'hex'));
    const plain = Buffer.concat([decipher.update(entries.get('payload.enc')), decipher.final()]);
    if (plain.length > MAX_PLAINTEXT_BYTES) throw new BackupArchiveError('Data backup melewati batas ukuran maksimum.');
    return { manifest, payload: JSON.parse(plain.toString('utf8')) };
  } catch (error) {
    if (error instanceof BackupArchiveError) throw error;
    throw new BackupArchiveError('Kata sandi salah atau isi backup telah diubah.');
  }
}
