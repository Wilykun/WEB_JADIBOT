import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const managerJs = await fs.readFile(path.join(ROOT, 'server', 'pairing-manager.js'), 'utf8');
const indexJs = await fs.readFile(path.join(ROOT, 'server', 'index.js'), 'utf8');
const appJs = await fs.readFile(path.join(ROOT, 'public', 'app.js'), 'utf8');

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `marker awal tidak ditemukan: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, `marker akhir tidak ditemukan: ${endMarker}`);
  return source.slice(start, end);
}

// Bug 20 Nov 2026: sesi WhatsApp ter-logout sendiri padahal session.json +
// cadangan masih bagus. Akar masalahnya state in-memory yang hilang setelah
// restart panel, lalu minta pairing code baru kena 409 'sudah tertaut' dan
// catch di start() menghapus state itu — akun jatuh ke 'belum_pernah'.

test('start() 409 sesi sudah tertaut: state in-memory dipertahankan, bukan dihapus', () => {
  const startFn = sliceBetween(managerJs, 'async function start(', '\n  function getState(');
  const catchBranch = sliceBetween(startFn, "} catch (error) {\n      if (error instanceof PairingError) {", '\n    return codePromise;');
  const keepBranch = sliceBetween(catchBranch, "if (error.status === 409 && state.status === 'linked')", "if (state.status !== 'linked')");
  assert.ok(!keepBranch.includes('sessions.delete(userId)'), 'cabang 409 linked tidak boleh menghapus state');
  assert.ok(keepBranch.includes('releaseStateLock(state)'), 'lock tetap dilepas');
  assert.ok(keepBranch.includes('Sambungkan ulang'), 'pesan 409 harus mengarahkan ke Sambungkan ulang, bukan pairing code baru');
  assert.ok(managerJs.includes("throw new PairingError('Akun ini sudah memiliki sesi WhatsApp tertaut; tekan Sambungkan ulang, tidak perlu pairing code baru.', 409);"));
});

test('resume() state linked tanpa socket: sambungkan ulang, jangan kembalikan linked palsu', () => {
  const resumeFn = sliceBetween(managerJs, 'async function resume(', '\n  async function deleteSession(');
  assert.ok(resumeFn.includes("const linkedWithoutSocket = state?.status === 'linked' && !state.socket;"), 'resume harus mendeteksi linked tanpa socket');
  assert.ok(resumeFn.includes("state.status = 'reconnecting';"), 'linked tanpa socket diubah jadi reconnecting supaya socket benar-benar disambung');
  assert.ok(resumeFn.includes('&& !linkedWithoutSocket'), 'early return tidak boleh dipakai saat linked tanpa socket');
});

test('isUsableAuthSnapshot: file sesi tanpa kunci ditolak (raptorzz 0 kunci)', () => {
  const fn = sliceBetween(managerJs, 'function countAuthKeys(', '\nasync function readSnapshotFile(');
  assert.ok(fn.includes('countAuthKeys(value.keys) > 0'), 'snapshot harus punya kunci lebih dari 0');
  assert.ok(managerJs.includes('function countAuthKeys(value)'), 'penghitung kunci harus ada');
});

test('resumeStoredAccounts: kegagalan 409/404 dicoba sekali lagi, bukan diam-diam dilewati', () => {
  const fn = sliceBetween(indexJs, 'async function resumeStoredAccounts()', '\nasync function handleApi(');
  assert.ok(fn.includes('setTimeout(resolve, 5000)'), 'resume yang dilewati harus dicoba lagi setelah jeda');
  assert.ok(fn.includes('dilewati saat resume awal'), 'skip yang tetap gagal harus dicatat di log pairing');
  assert.ok(!fn.includes("if (error instanceof PairingError && [404, 409].includes(error.status)) continue;"), 'continue diam-diam tidak boleh ada lagi');
});

test("GET /api/pairing/status: sesi tersimpan di disk dilaporkan 'tersimpan', bukan null", () => {
  const route = sliceBetween(indexJs, "if (route === 'GET /api/pairing/status')", "if (route === 'POST /api/pairing/cancel')");
  assert.ok(route.includes('getSavedSessionInfo'), 'status harus memeriksa file sesi di disk saat tidak ada state in-memory');
  assert.ok(route.includes("status: 'tersimpan'"), "status 'tersimpan' harus dikembalikan untuk sesi yang masih tersimpan");
  assert.ok(managerJs.includes('async function getSavedSessionInfo('), 'helper getSavedSessionInfo harus ada');
  assert.ok(managerJs.includes('getSavedSessionInfo,'), 'helper harus diekspor dari pairing manager');
});

test("frontend: status 'tersimpan' menampilkan Sambungkan ulang, bukan form pairing code", () => {
  const branch = sliceBetween(appJs, "if (pairing.status === 'tersimpan')", "if (pairing.status === 'failed')");
  assert.ok(branch.includes("controls.classList.add('hidden')"), 'form pairing harus disembunyikan');
  assert.ok(branch.includes("resumeButton.classList.remove('hidden')"), 'tombol Sambungkan ulang harus tampil');
  assert.ok(branch.includes('tidak perlu pairing code baru'), 'copy harus jelas tidak perlu pairing code baru');
  assert.ok(appJs.includes("tersimpan: ['SESI TERSIMPAN', 'TERSIMPAN']"), 'badge koneksi harus punya label tersimpan');
  assert.ok(appJs.includes("tersimpan: 'Sesi tersimpan'"), 'label anggota harus punya tersimpan');
});
