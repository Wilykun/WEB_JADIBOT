import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const managerJs = await fs.readFile(path.join(ROOT, 'server', 'pairing-manager.js'), 'utf8');
const indexJs = await fs.readFile(path.join(ROOT, 'server', 'index.js'), 'utf8');
const appJs = await fs.readFile(path.join(ROOT, 'public', 'app.js'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `fungsi tidak ditemukan: ${name}`);
  let depth = 0;
  let i = source.indexOf('{', start);
  for (; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`kurung fungsi tidak seimbang: ${name}`);
}

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `penanda tidak ditemukan: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end >= 0, `penanda tidak ditemukan: ${endMarker}`);
  return source.slice(start, end);
}

test('sesi invalid mencatat alasan dan waktu terputus untuk notifikasi', () => {
  const invalidFn = sliceBetween(managerJs, 'async function markSessionInvalid(', '\n  function snapshotGoodSession(');
  assert.ok(invalidFn.includes('state.lastUnlink = { reason: unlinkReasonForCode(code), code: code ?? null, at: new Date().toISOString() };'), 'alasan + kode + waktu harus dicatat saat sesi dinyatakan invalid');
  assert.ok(invalidFn.includes('void saveLastUnlink(state.authDir, state.lastUnlink);'), 'catatan terputus harus tersimpan supaya tidak hilang saat panel restart');
  const reasonFn = extractFunction(managerJs, 'unlinkReasonForCode');
  assert.ok(reasonFn.includes("if (code === DisconnectReason.loggedOut) return 'manual';"), 'kode 401 berarti logout dari WhatsApp');
  assert.ok(reasonFn.includes("return 'rejected';"), 'kode sesi tidak valid berarti ditolak WhatsApp');
  assert.ok(reasonFn.includes("return 'unreachable';"), 'tanpa kode berarti koneksi terputus berulang kali');
});

test('status pairing membawa info terputus terakhir dan dimuat lagi setelah restart', () => {
  const publicFn = sliceBetween(managerJs, 'function publicState(state) {', '\n  async function removeUnregisteredAuth(');
  assert.ok(publicFn.includes('lastUnlink: state.lastUnlink || null,'), 'status pairing harus membawa lastUnlink untuk notifikasi');
  assert.ok(managerJs.includes("export const UNLINK_FILENAME = 'unlink.json';"), 'catatan terputus tersimpan di unlink.json');
  assert.ok(managerJs.includes('if (!state.lastUnlink) state.lastUnlink = await loadLastUnlink(state.authDir);'), 'resume harus memuat catatan terputus dari file');
  assert.ok(managerJs.includes('await fs.rm(path.join(authDir, UNLINK_FILENAME), { force: true })'), 'hapus sesi harus menghapus catatan terputus');
});

test('notif belum tertaut menampilkan alasan dan waktu terputus yang rapih', () => {
  const labelFn = extractFunction(appJs, 'accountActivityTimeLabel');
  const detailFn = extractFunction(appJs, 'formatUnlinkDetail');
  const format = eval(`${labelFn}; ${detailFn}; formatUnlinkDetail`);
  assert.equal(
    format({ reason: 'manual', code: 401, at: '2026-11-20T14:07:00.000Z' }),
    'Logout dari WhatsApp — Jumat, 20 Nov 2026, 21.07 WIB.',
    'logout manual harus tampil dengan hari, tanggal, bulan, tahun, dan pukul WIB',
  );
  assert.equal(
    format({ reason: 'rejected', code: 404, at: '2026-11-20T14:07:00.000Z' }),
    'Sesi ditolak WhatsApp — Jumat, 20 Nov 2026, 21.07 WIB.',
    'sesi ditolak harus tampil dengan waktu yang sama',
  );
  assert.equal(
    format({ reason: 'unreachable', code: null, at: '2026-11-20T14:07:00.000Z' }),
    'Koneksi WhatsApp terputus berulang kali — Jumat, 20 Nov 2026, 21.07 WIB.',
    'koneksi terputus harus tampil dengan waktu yang sama',
  );
  assert.equal(format(null), null, 'tanpa info terputus, notif memakai teks umum');
  assert.equal(format({ reason: 'manual' }), null, 'tanpa waktu, notif memakai teks umum');
});

test('status pairing tetap membawa info terputus walau sesi belum dicoba lagi di proses ini', () => {
  const statusFn = sliceBetween(managerJs, 'async function getStatusWithUnlink(', '\n  async function setOnline24(');
  assert.ok(statusFn.includes('await getLastUnlink(userId)'), 'tanpa state in-memory, status harus membaca catatan terputus dari file');
  assert.ok(statusFn.includes("status: 'invalid',"), 'tanpa state sama sekali tapi ada catatan terputus, status harus invalid');
  assert.ok(indexJs.includes('await pairingManager.getStatusWithUnlink(user.id)'), 'endpoint status harus memakai getStatusWithUnlink');
  assert.ok(indexJs.includes('lastUnlink, workerStatus'), 'status tersimpan juga harus membawa lastUnlink untuk notifikasi');
});

test('notif belum tertaut memakai detail terputus dan tampil lagi saat kejadian baru', () => {
  const overlayFn = sliceBetween(appJs, 'function showLinkNoticeOverlay() {', '\nfunction syncBotLinkNotice() {');
  assert.ok(overlayFn.includes('formatUnlinkDetail(lastPairing?.lastUnlink)'), 'notif harus membaca detail terputus dari status pairing');
  assert.ok(overlayFn.includes('context: { kind: \'link\', version }'), 'notif harus membawa versi kejadian supaya tampil ulang saat ada yang baru');
  const syncFn = sliceBetween(appJs, 'function syncBotLinkNotice() {', '\nfunction showBotLinkNotice() {');
  assert.ok(syncFn.includes("if (unlinkVersion && unlinkVersion !== botLinkNoticeVersion) botLinkNoticeDismissed = false;"), 'kejadian terputus baru harus memunculkan lagi notif yang sempat ditutup');
  assert.ok(appJs.includes('lastPairing = pairing || null;'), 'status pairing terakhir harus disimpan untuk notif');
});
