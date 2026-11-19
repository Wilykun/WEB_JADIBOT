import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function read(file) {
  return fs.readFile(path.join(ROOT, file), 'utf8');
}

test('tombol Hapus sesi ada di kartu Kontrol Bot di Panel, bukan cuma di halaman Pairing', async () => {
  const html = await read('public/index.html');
  const js = await read('public/app.js');
  const card = html.slice(html.indexOf('<section class="bot-worker-card'), html.indexOf('</section>', html.indexOf('<section class="bot-worker-card')));
  assert.ok(card.includes('id="session-actions"'), 'kartu Kontrol Bot harus memuat grup aksi sesi');
  assert.ok(card.includes('id="session-delete"'), 'kartu Kontrol Bot harus memuat tombol Hapus sesi');
  assert.ok(card.includes('class="button button-danger"'), 'tombol Hapus sesi harus memakai gaya bahaya');
  assert.ok(card.includes('>Hapus sesi<'), 'tombol Hapus sesi harus berlabel Hapus sesi');
  assert.ok(js.includes("document.querySelector('#session-delete')"), 'tombol Hapus sesi harus punya handler');
  assert.ok(js.includes("callSessionAction('/api/pairing/session', 'DELETE'"), 'Hapus sesi harus memakai endpoint hapus sesi sendiri');
});

test('sesi ditolak tanpa nomor tersimpan tetap menampilkan Hapus sesi di Panel', async () => {
  const js = await read('public/app.js');
  const invalidBlock = js.slice(js.indexOf("if (pairing.status === 'invalid')"), js.indexOf("if (pairing.status === 'recovering')"));
  assert.ok(invalidBlock.includes("sessionActions.classList.remove('hidden')"), 'cabang invalid harus menampilkan aksi sesi');
  const noPhoneBranch = invalidBlock.slice(invalidBlock.indexOf("statusValue.textContent = 'Sesi tidak valid'"));
  assert.ok(noPhoneBranch.includes("sessionActions.classList.remove('hidden')"), 'invalid tanpa nomor tersimpan harus tetap menampilkan Hapus sesi');
  assert.ok(noPhoneBranch.includes('bukan nomor'), 'alasan harus menjelaskan hapus memakai akun, bukan nomor');
});

test('Start bot yang gagal karena sesi ditolak memuat ulang status pairing', async () => {
  const js = await read('public/app.js');
  const action = js.slice(js.indexOf('async function callBotAction'), js.indexOf("document.querySelector('#bot-start').addEventListener"));
  const errorBranch = action.slice(action.indexOf('} catch (error) {'));
  assert.ok(errorBranch.includes("setControlFeedback('bot-feedback', 'error', 'Aksi tidak berhasil'"), 'gagal Start bot harus tetap menampilkan pesan kesalahan');
  assert.ok(errorBranch.includes('void refreshPairing();'), 'gagal Start bot harus memuat ulang status pairing supaya tombol Hapus sesi muncul');
});

test('hapus sesi sendiri memakai kunci lifecycle supaya tidak bentrok dengan sambung ulang', async () => {
  const server = await read('server/index.js');
  const route = server.slice(server.indexOf("if (route === 'DELETE /api/pairing/session')"), server.indexOf("if (['POST /api/bot/start'"));
  assert.ok(route.includes('withMemberLifecycleLock(user.id'), 'hapus sesi sendiri harus memakai kunci lifecycle yang sama dengan resume/start');
  assert.ok(route.includes('pairingManager.deleteSession(user.id)'), 'hapus sesi harus memanggil deleteSession untuk akun sendiri');
  assert.ok(route.includes("Sesi WhatsApp belum dapat dihapus."), 'gagal hapus harus memberi pesan yang jelas');
});

test('hapus sesi menghapus kredensial dan cadangan sesuai username di DATA_AKUN', async () => {
  const manager = await read('server/pairing-manager.js');
  const server = await read('server/index.js');
  assert.ok(manager.includes('await fs.rm(path.join(authDir, GOOD_SNAPSHOT_FILENAME), { force: true })'), 'hapus sesi harus menghapus salinan sesi sehat');
  assert.ok(manager.includes('await fs.rm(path.join(authDir, BACKUP_FILENAME), { force: true })'), 'hapus sesi harus menghapus cadangan sesi otomatis');
  assert.ok(manager.includes('await removeUserAuth(userId, authDir);'), 'hapus sesi harus menghapus artefak auth dari folder akun');
  assert.ok(manager.includes("name === 'session.json' || name === 'creds.json'"), 'hapus auth harus mencakup session.json dan creds.json');
  assert.ok(server.includes('getAuthDir: (userId) => accountFolder('), 'folder auth harus dipetakan dari username akun');
  assert.ok(manager.includes('clearTimeout(state.reconnectTimer);'), 'hapus sesi harus mematikan timer sambung ulang supaya tidak bentrok');
});
