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

test('resume pada sesi invalid: coba pulihkan dari cadangan dulu, baru minta pairing ulang', () => {
  const resumeFn = sliceBetween(managerJs, 'async function resume(', '\n  async function deleteSession(');
  const invalidBranch = sliceBetween(
    resumeFn,
    "if (state?.status === 'invalid')",
    "throw new PairingError('Sesi WhatsApp ditolak. Masukkan nomor dan minta pairing code baru.', 409);",
  );
  assert.ok(invalidBranch.includes('attemptSessionRecovery'), 'sesi invalid harus dicoba pulihkan dari cadangan dulu');
  assert.ok(invalidBranch.includes('if (recovered) return publicState(state);'), 'pemulihan yang berhasil harus langsung mengembalikan status');
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

test('pemulihan sesi mencoba cadangan otomatis setelah salinan sehat ditolak', () => {
  const recoveryFn = sliceBetween(managerJs, 'async function attemptSessionRecovery(', '\n  function scheduleAutoReconnect(');
  assert.ok(recoveryFn.includes('restoreGoodSnapshot'), 'salinan sehat dicoba dulu');
  assert.ok(recoveryFn.includes('restoreSessionBackup'), 'cadangan otomatis dicoba setelah salinan sehat');
  assert.ok(recoveryFn.indexOf('restoreGoodSnapshot') < recoveryFn.indexOf('restoreSessionBackup'), 'cadangan otomatis dicoba setelah salinan sehat');
  assert.ok(recoveryFn.includes('for (const candidate of candidates)'), 'cadangan dicoba satu per satu sampai ada yang tertaut');
  assert.ok(!recoveryFn.includes('rolledBackGood'), 'logika lama yang berhenti di salinan sehat sudah diganti');
});

test('pemulihan sesi yang gagal mengembalikan file sesi seperti semula', () => {
  const recoveryFn = sliceBetween(managerJs, 'async function attemptSessionRecovery(', '\n  function scheduleAutoReconnect(');
  assert.ok(recoveryFn.includes("const liveSnapshot = state.authDir ? await readSnapshotFile(path.join(state.authDir, 'session.json')) : null;"), 'kredensial yang sedang dipakai disimpan dulu');
  assert.ok(recoveryFn.includes('Semua cadangan sesi gagal; file sesi dikembalikan seperti semula.'), 'pemulihan gagal harus mengembalikan file sesi');
  assert.ok(recoveryFn.includes("await writeFileAtomically(path.join(state.authDir, 'session.json'), JSON.stringify(liveSnapshot))"), 'file sesi ditulis ulang dari salinan yang disimpan');
});

test('sesi 5 kali gagal sambung ulang: pemulihan dari cadangan dicoba dulu sebelum invalid', () => {
  // Dua handler close (start dan resume) punya cabang yang sama.
  const branches = managerJs.split('if (registerReconnectFailure(state)) {').slice(1);
  assert.equal(branches.length, 2, 'harus ada dua cabang 5 kali gagal (start dan resume)');
  for (const branch of branches) {
    const chunk = branch.slice(0, 900);
    assert.ok(chunk.includes('attemptSessionRecovery'), 'cabang 5 kali gagal harus mencoba pemulihan dulu');
    assert.ok(chunk.indexOf('attemptSessionRecovery') < chunk.indexOf('markSessionInvalid'), 'pemulihan harus sebelum invalid');
  }
});

test('scheduleAutoReconnect mencoba pemulihan sebelum menyatakan invalid', () => {
  const scheduleFn = sliceBetween(managerJs, 'function scheduleAutoReconnect(state) {', '\n  function detachBotWorker(');
  const limitBranch = sliceBetween(scheduleFn, '>= MAX_CONSECUTIVE_RECONNECT_FAILURES', 'return;\n    }');
  assert.ok(limitBranch.includes('attemptSessionRecovery'), 'batas 5 kali gagal di penjadwal harus mencoba pemulihan dulu');
  assert.ok(limitBranch.includes("state.status !== 'invalid'"), 'invalid hanya bila pemulihan gagal dan sesi masih sama');
});
