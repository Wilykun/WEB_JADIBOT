import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_CONSECUTIVE_RECONNECT_FAILURES, classifyDisconnectCode } from '../server/pairing-manager.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function read(file) {
  return fs.readFile(path.join(ROOT, file), 'utf8');
}

test('auto-reconnect berhenti setelah 5 kali gagal berturut-turut, bukan berputar selamanya', () => {
  // Kode 408 (timeout/retry) dari WhatsApp untuk sesi yang sudah dicabut
  // tidak pernah menjadi 401, jadi tanpa batas panel menampilkan sesi mati
  // sebagai "tertaut" selamanya (kasus BangWily: percobaan ke-27+ tiap 60 detik).
  assert.equal(classifyDisconnectCode(408), 'retry');
  assert.equal(MAX_CONSECUTIVE_RECONNECT_FAILURES, 5);
});

test('pairing manager menandai sesi tidak valid setelah batas gagal tercapai', async () => {
  const manager = await read('server/pairing-manager.js');
  assert.ok(manager.includes('function registerReconnectFailure(state)'), 'registerReconnectFailure must exist');
  assert.ok(manager.includes('state.consecutiveReconnectFailures = (state.consecutiveReconnectFailures || 0) + 1'), 'failures must be counted per session');
  assert.ok(manager.includes('await markSessionInvalid(state, reasonCode);'), 'close handlers must invalidate after the cap');
  assert.ok(manager.includes('void markSessionInvalid(state, null);'), 'scheduleAutoReconnect must not schedule past the cap');
  assert.ok(manager.includes('reconnectFailures: state.consecutiveReconnectFailures || 0'), 'public state must expose the failure count for the panel');
});

test('tombol Sambungkan ulang manual benar-benar memulai percobaan baru saat reconnecting', async () => {
  const manager = await read('server/pairing-manager.js');
  assert.ok(manager.includes('const manualReconnect = !auto && state?.status === \'reconnecting\';'), 'manual resume must be detected');
  assert.ok(manager.includes('state.consecutiveReconnectFailures = 0;'), 'manual resume must reset the failure count');
});

test('member bisa Hapus sesi saat status reconnecting, recovering, dan invalid', async () => {
  const js = await read('public/app.js');
  const reconnecting = js.slice(js.indexOf("if (pairing.status === 'reconnecting')"), js.indexOf("if (pairing.status === 'stopped')"));
  assert.ok(reconnecting.includes("sessionActions.classList.remove('hidden')"), 'reconnecting must show session actions');
  assert.ok(reconnecting.includes("resumeButton.classList.remove('hidden')"), 'reconnecting must show Sambungkan ulang');
  assert.ok(reconnecting.includes('reconnectFailures'), 'reconnecting must show how many attempts failed');
  const recovering = js.slice(js.indexOf("if (pairing.status === 'recovering')"), js.indexOf("if (pairing.status === 'reconnecting')"));
  assert.ok(recovering.includes("sessionActions.classList.remove('hidden')"), 'recovering must show session actions');
  const invalidBlock = js.slice(js.indexOf("if (pairing.status === 'invalid')"), js.indexOf("if (pairing.status === 'recovering')"));
  assert.ok(invalidBlock.includes("sessionActions.classList.remove('hidden')"), 'invalid with saved session must show Hapus sesi');
});

test('kartu status sesi mati tidak memakai centang hijau dan lencana jujur', async () => {
  const js = await read('public/app.js');
  const css = await read('public/style.css');
  assert.ok(js.includes("linkedCard.classList.add('is-warning')"), 'non-linked states must mark the card as warning');
  assert.ok(css.includes('.pairing-linked-card.is-warning'), 'warning card must have amber styling');
  assert.ok(js.includes("reconnecting: ['MENYAMBUNG…', 'MENYAMBUNG']"), 'badge must say MENYAMBUNG while reconnecting');
  assert.ok(js.includes("disconnected: ['WA TERPUTUS', 'TERPUTUS']"), 'badge must say TERPUTUS when disconnected');
});

test('pairing code baru langsung digulir ke layar saat muncul realtime', async () => {
  const js = await read('public/app.js');
  assert.ok(js.includes('let lastPairingStatus = null;'), 'previous pairing status must be tracked');
  assert.ok(js.includes("codeCard.scrollIntoView({ behavior: 'smooth', block: 'center' })"), 'new code must scroll into view');
  assert.ok(js.includes("showToast('Pairing code baru tersedia"), 'new code must toast the member');
});
