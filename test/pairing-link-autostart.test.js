import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function read(file) {
  return fs.readFile(path.join(ROOT, file), 'utf8');
}

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `marker awal tidak ditemukan: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, `marker akhir tidak ditemukan: ${endMarker}`);
  return source.slice(start, end);
}

test('tautan baru (pairing code/QR): bot langsung jalan tanpa tekan Start bot', async () => {
  const managerJs = await read('server/pairing-manager.js');
  // Handler tautan di start() (bukan resume): dari "connection === 'open'"
  // sampai log "WhatsApp aktif".
  const startFn = sliceBetween(managerJs, 'async function start(', '\n  function getState(');
  const openIdx = startFn.indexOf("if (connection === 'open') {");
  assert.ok(openIdx >= 0, 'handler connection open di start() harus ada');
  const openBlock = startFn.slice(openIdx, startFn.indexOf('} else if (connection === ', openIdx));
  // autoStart yang sempat dimatikan sistem saat sesi invalid harus
  // dikembalikan dulu, baru workerDesired dibaca.
  const setIdx = openBlock.indexOf('await setWorkerAutoStart(userId, true);');
  const readIdx = openBlock.indexOf('state.workerDesired = getWorkerAutoStart(userId) === true;');
  assert.ok(setIdx >= 0, 'tautan baru harus mengembalikan autoStart jadi true');
  assert.ok(readIdx > setIdx, 'workerDesired harus dibaca setelah autoStart dikembalikan');
  assert.ok(openBlock.includes('attachBotWorker(state);'), 'bot harus dipasang saat tautan baru');
  assert.ok(openBlock.includes("'Perangkat WhatsApp tertaut; bot masih dihentikan.'"), 'log saat bot tidak jalan harus pakai kata bot');
  assert.ok(!openBlock.includes('bot worker masih dihentikan'), 'log tidak boleh lagi pakai kata worker');
});

test('kata worker di layar diganti bot / start bot', async () => {
  const html = await read('public/index.html');
  const js = await read('public/app.js');
  const managerJs = await read('server/pairing-manager.js');
  // Judul kartu + status + label hitungan di layar.
  assert.ok(!html.includes('Worker aktivitas'), 'judul kartu Kontrol Bot tidak boleh lagi Worker aktivitas');
  assert.ok(html.includes('<h2 id="bot-worker-title">Start bot</h2>'), 'judul kartu Kontrol Bot harus Start bot');
  assert.ok(!html.includes('WORKER BERHENTI'), 'status runner tidak boleh lagi WORKER BERHENTI');
  assert.ok(html.includes('<span id="runner-status">BOT BERHENTI</span>'), 'status runner harus BOT BERHENTI');
  assert.ok(!html.includes('<span>Worker aktif'), 'label hitungan tidak boleh lagi Worker aktif');
  assert.ok(html.includes('<span>Bot jalan'), 'label hitungan harus Bot jalan');
  assert.ok(!html.includes('Hentikan worker kapan saja'), 'kartu tertaut tidak boleh lagi Hentikan worker');
  // Teks bot yang tampil di app.js.
  assert.ok(!js.includes('Bot worker aktif'), 'deskripsi runner tidak boleh lagi Bot worker aktif');
  assert.ok(js.includes('Bot aktif dan mencatat event status'), 'deskripsi runner harus Bot aktif');
  assert.ok(!js.includes('Worker bot bisa dinyalakan'), 'kartu tertaut tidak boleh lagi Worker bot');
  assert.ok(js.includes('Bot bisa dinyalakan dari panel Kontrol Bot'), 'kartu tertaut harus Bot bisa dinyalakan');
  assert.ok(!js.includes('Bot worker dimulai'), 'toast aksi bot tidak boleh lagi Bot worker');
  assert.ok(js.includes("'Bot dimulai.'"), 'toast start bot harus Bot dimulai');
  assert.ok(!js.includes('Matikan worker'), 'dialog tidak boleh lagi Matikan worker');
  // Pesan log server yang tampil di panel.
  assert.ok(!managerJs.includes('worker otomatis belum dapat dimulai'), 'log server tidak boleh lagi worker otomatis');
  assert.ok(!managerJs.includes('worker default menunggu'), 'log server tidak boleh lagi worker default');
});

test('baru tertaut dari pairing: notif di layar mengarahkan ke kartu Start bot', async () => {
  const js = await read('public/app.js');
  const linked = sliceBetween(
    js,
    "if (pairing.status === 'linked') {",
    "if (pairing.status === 'expired') {",
  );
  assert.ok(
    linked.includes("['awaiting_code', 'linking', 'connecting', 'checking_number', 'awaiting_qr'].includes(previousPairingStatus)"),
    'notif hanya muncul saat baru selesai dari alur pairing, bukan saat panel dibuka dalam keadaan sudah tertaut',
  );
  assert.ok(linked.includes("showNoticeOverlay({"), 'notif harus memakai kartu notifikasi tengah layar');
  assert.ok(linked.includes("context: { kind: 'linked' }"), 'notif harus berkind linked');
  assert.ok(linked.includes("addLabel: 'Lihat Start bot'"), 'notif harus punya tombol Lihat Start bot');
  assert.ok(linked.includes("setWorkspacePage('dashboard')"), 'tombol harus pindah ke dashboard');
  assert.ok(linked.includes("document.querySelector('.bot-worker-card')?.scrollIntoView"), 'tombol harus menggulir ke kartu Start bot');
  assert.ok(linked.includes('bot jalan otomatis'), 'judul notif harus menyebut bot jalan otomatis');
  // Menutup notif ini tidak boleh mematikan pengingat emoji.
  const dismiss = sliceBetween(js, 'function dismissNoticeOverlay() {', '\nfunction syncStoryEmojiNotice() {');
  assert.ok(dismiss.includes("noticeContext?.kind === 'linked'"), 'dismiss harus kenal kind linked');
  const linkedBranch = sliceBetween(dismiss, "kind === 'linked'", "kind === 'rankovertake'");
  assert.ok(!linkedBranch.includes('emojiNoticeDismissed'), 'menutup notif tautan tidak boleh mematikan pengingat emoji');
});
