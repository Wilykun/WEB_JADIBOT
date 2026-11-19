import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const managerJs = await fs.readFile(path.join(ROOT, 'server', 'pairing-manager.js'), 'utf8');
const appJs = await fs.readFile(path.join(ROOT, 'public', 'app.js'), 'utf8');
const indexHtml = await fs.readFile(path.join(ROOT, 'public', 'index.html'), 'utf8');

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `marker awal tidak ditemukan: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, `marker akhir tidak ditemukan: ${endMarker}`);
  return source.slice(start, end);
}

test('pairing baru dari sesi invalid: cadangan sesi yang ditolak ikut dibersihkan', () => {
  const startFn = sliceBetween(managerJs, 'async function start(', '\n  function getState(');
  const invalidBranch = sliceBetween(startFn, "if (existing?.status === 'invalid')", "if (existing && ['connecting'");
  assert.ok(invalidBranch.includes('GOOD_SNAPSHOT_FILENAME'), 'session.json.good harus ikut dihapus');
  assert.ok(invalidBranch.includes('BACKUP_FILENAME'), 'session.json.bak harus ikut dihapus');
  assert.ok(invalidBranch.includes('removeUserAuth'), 'kredensial utama tetap dibersihkan dulu');
});

test('resume pada sesi invalid: langsung minta pairing ulang, tanpa pemulihan dari cadangan', () => {
  const resumeFn = sliceBetween(managerJs, 'async function resume(', '\n  async function deleteSession(');
  const invalidBranch = sliceBetween(
    resumeFn,
    "if (state?.status === 'invalid')",
    "throw new PairingError('Sesi WhatsApp ditolak. Masukkan nomor dan minta pairing code baru.', 409);",
  );
  assert.ok(!invalidBranch.includes('attemptSessionRecovery'), 'sesi yang sudah mati 5 kali jangan dipulihkan dari cadangan');
  assert.ok(resumeFn.includes("throw new PairingError('Sesi WhatsApp ditolak. Masukkan nomor dan minta pairing code baru.', 409);"));
});

test('kartu pemulihan tidak lagi menelan form: state invalid menampilkan form pairing', () => {
  const invalidBranch = sliceBetween(appJs, "if (pairing.status === 'invalid')", "if (pairing.status === 'recovering')");
  assert.ok(!invalidBranch.includes("recoveryCard.classList.remove('hidden')"), 'kartu pemulihan jangan lagi dimunculkan');
  assert.ok(!invalidBranch.includes("controls.classList.add('hidden')"), 'form pairing jangan lagi disembunyikan');
  assert.ok(invalidBranch.includes('Perlu pairing ulang'), 'status harus jelas minta pairing ulang');
  assert.ok(invalidBranch.includes('tidak bisa dipulihkan'), 'copy harus jujur sesi tidak bisa dipulihkan');
});

test('poll status lama dihentikan saat member menutup kartu pemulihan atau mengirim nomor', () => {
  const dismissHandler = sliceBetween(appJs, "#pairing-recover-dismiss').addEventListener('click'", "setPairingNotice('Pairing ulang dengan nomor baru.");
  assert.ok(dismissHandler.includes('clearInterval(pairingPollTimer)'), 'tutup kartu harus menghentikan poll 5 detik');
  const submitPoll = sliceBetween(appJs, 'clearInterval(pairingPollTimer);', 'const progressPollTimer');
  assert.ok(submitPoll.length >= 0, 'submit harus membersihkan poll lama sebelum poll progres');
  assert.ok(appJs.includes('const progressPollTimer = window.setInterval(() => { void refreshPairing(); }, 1200);'));
});

test('tombol pulihkan sesi tidak lagi tampil di halaman pairing', () => {
  assert.match(indexHtml, /<button class="[^"]*hidden[^"]*"[^>]*id="pairing-recover"/, 'tombol Coba pulihkan sesi harus tersembunyi');
});
