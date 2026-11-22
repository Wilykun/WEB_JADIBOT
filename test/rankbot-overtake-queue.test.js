// Antrean notifikasi salip Rank Bot: semua salip baru masuk antrean per akun
// yang disimpan di server (DATA_AKUN masing-masing), bukan cuma satu kartu.
// Kartu notifikasi salip punya layar sendiri dengan tombol Sebelumnya /
// Berikutnya / Terbaru dan Tutup semua, jadi notifikasi tidak menumpuk dan
// yang lama tetap bisa dilihat lagi walau halaman dimuat ulang.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

function sanitizeRankOvertake() {
  const server = read('server/index.js');
  const match = server.match(/function sanitizeRankOvertake\(item\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'fungsi sanitizeRankOvertake harus bisa diekstrak dari server/index.js');
  return eval(`(${match[0].replace('function sanitizeRankOvertake', 'function')})`);
}

test('notifikasi salip disimpan per akun di DATA_AKUN, bukan di memori saja', () => {
  const server = read('server/index.js');
  assert.ok(server.includes("route === 'GET /api/rank-overtakes'"), 'server harus punya endpoint baca antrean salip');
  assert.ok(server.includes("route === 'POST /api/rank-overtakes'"), 'server harus punya endpoint tambah salip ke antrean');
  assert.ok(server.includes("route === 'POST /api/rank-overtakes/dismiss'"), 'server harus punya endpoint tutup salip');
  assert.ok(server.includes("RANK_OVERTAKES_FILE = 'rank-overtakes.json'"), 'antrean salip harus hidup di file sendiri di folder akun');
  assert.ok(server.includes('function readRankOvertakes(user)'), 'antrean salip harus dibaca per akun yang login');
  assert.ok(server.includes('function writeRankOvertakes(user, items)'), 'antrean salip harus ditulis per akun yang login');
  assert.ok(server.includes('function sanitizeRankOvertake(item)'), 'salip yang masuk harus dibersihkan dulu');
  assert.match(server, /readRankOvertakes[\s\S]{0,300}canonicalAccountFolder\(user\)/, 'baca antrean harus lewat folder kanonis akun');
  assert.match(server, /writeRankOvertakes[\s\S]{0,300}canonicalAccountFolder\(user\)/, 'tulis antrean harus lewat folder kanonis akun');
  assert.ok(server.includes('atomicWriteJson(path.join(dir, RANK_OVERTAKES_FILE)'), 'antrean salip harus ditulis atomik');
  assert.ok(server.includes('RANK_OVERTAKES_MAX = 50'), 'antrean salip harus dibatasi supaya tidak membengkak');
  assert.ok(server.includes("allowRateLimit(`rank-overtakes:${user.id}`"), 'endpoint tambah salip harus dibatasi per akun');
  assert.ok(server.includes("allowRateLimit(`rank-overtakes-dismiss:${user.id}`"), 'endpoint tutup salip harus dibatasi per akun');
  assert.ok(server.includes("if (!user) return sendError(res, 401, 'Silakan masuk kembali.');"), 'endpoint salip harus menolak akun yang belum login');
});

test('sanitizeRankOvertake menolak salip yang tidak lengkap atau mustahil', () => {
  const clean = sanitizeRankOvertake();
  const good = {
    id: 'jeffv2>ryobot@2026-11-22T19:43:00.000Z',
    overtaker: 'jeffv2',
    overtaken: 'ryobot',
    newPosition: 3,
    oldPosition: 4,
    overtakenNewPosition: 4,
    overtakenOldPosition: 3,
    isClimb: false,
    createdAt: '2026-11-22T19:43:00.000Z',
  };
  assert.deepEqual(clean(good), good, 'salip lengkap harus lolos apa adanya');
  assert.equal(clean({ ...good, overtaken: 'jeffv2' }), null, 'yang menyalip dan yang kesalip tidak boleh sama');
  assert.equal(clean({ ...good, newPosition: 0 }), null, 'peringkat baru harus minimal 1');
  assert.equal(clean({ ...good, oldPosition: 'x' }), null, 'peringkat lama harus angka');
  assert.equal(clean({ ...good, createdAt: 'bukan tanggal' }), null, 'waktu salip harus tanggal yang sah');
  assert.equal(clean({ ...good, id: '' }), null, 'salip tanpa id tidak boleh disimpan');
  assert.equal(clean(null), null, 'bukan objek harus ditolak');
  assert.equal(clean({ ...good, isClimb: 'ya' }).isClimb, false, 'isClimb harus boolean, bukan string');
  assert.equal(clean({ ...good, overtaker: '  JEFFV2  ' }).overtaker, 'JEFFV2', 'nama akun harus dirapikan spasi depannya');
});

test('POST salip menduplikasi id yang sama dan menutup semua menghapus antrean', () => {
  const server = read('server/index.js');
  const add = server.slice(server.indexOf("route === 'POST /api/rank-overtakes'"), server.indexOf("route === 'POST /api/rank-overtakes/dismiss'"));
  assert.ok(add.includes('const seen = new Set(current.map((item) => item.id));'), 'salip yang sudah ada di antrean tidak boleh diduplikasi');
  assert.ok(add.includes('if (seen.has(item.id)) continue;'), 'id yang sama harus dilewati');
  assert.ok(add.includes("if (!clean.length) return sendError(res, 400, 'Notifikasi salip tidak lengkap.');"), 'salip yang tidak lengkap harus ditolak');
  const dismiss = server.slice(server.indexOf("route === 'POST /api/rank-overtakes/dismiss'"), server.indexOf("if (route === 'POST /api/admin/backup/export')"));
  assert.ok(dismiss.includes('if (body?.all === true) {'), 'tutup semua harus dikenali dari all: true');
  assert.ok(dismiss.includes('items = [];'), 'tutup semua harus mengosongkan antrean');
  assert.ok(dismiss.includes('items = current.filter((item) => !ids.has(item.id));'), 'tutup satu harus membuang id itu saja dari antrean');
});

test('klien memuat antrean salip dari server saat login', () => {
  const js = read('public/app.js');
  assert.ok(js.includes('async function refreshRankOvertakeQueue()'), 'harus ada refreshRankOvertakeQueue');
  const refresh = js.slice(js.indexOf('async function refreshRankOvertakeQueue()'), js.indexOf('async function saveRankOvertakesToServer(items)'));
  assert.ok(refresh.includes("fetch('/api/rank-overtakes'"), 'antrean harus diambil dari server per akun');
  assert.ok(refresh.includes('rankOvertakeQueue = items.map((item) => ({ ...item, event: item }));'), 'antrean dari server harus dipakai sebagai antrean klien');
  assert.ok(refresh.includes('rankOvertakeNoticeIndex = rankOvertakeQueue.length - 1;'), 'antrean yang dimuat harus mulai dari yang terbaru');
  const init = js.slice(js.indexOf('startChatPolling();'), js.indexOf('startInfoUpdateNoticePolling();'));
  assert.ok(init.includes('void refreshRankOvertakeQueue();'), 'antrean salip harus dimuat sejak login, sejajar Obrolan');
});

test('salip baru masuk antrean dan disimpan ke server, bukan cuma ditampilkan sekali', () => {
  const js = read('public/app.js');
  assert.ok(js.includes('let rankOvertakeQueue = [];'), 'harus ada antrean salip di memori');
  assert.ok(js.includes('let rankOvertakeNoticeIndex = 0;'), 'harus ada posisi antrean yang sedang dilihat');
  assert.ok(js.includes('function enqueueRankOvertake(event, isClimb)'), 'harus ada enqueueRankOvertake');
  const enqueue = js.slice(js.indexOf('function enqueueRankOvertake(event, isClimb)'), js.indexOf('function dismissRankOvertakeCurrent()'));
  assert.ok(enqueue.includes('rankOvertakeQueue.push(item);'), 'salip baru harus masuk antrean');
  assert.ok(enqueue.includes("rankOvertakeNotified.set(`${event.overtaker}>${event.overtaken}`, Date.now());"), 'pasangan yang masuk antrean harus dicatat supaya tidak diberitakan lagi dalam 10 menit');
  assert.ok(enqueue.includes('void saveRankOvertakesToServer([stored]);'), 'salip baru harus disimpan ke DATA_AKUN akun ini');
  assert.ok(enqueue.includes("rankOvertakeEventId(event, createdAt)"), 'tiap salip harus punya id unik dari pasangan dan waktunya');
  assert.ok(js.includes('function notifyRankBotOvertake(event)'), 'harus ada notifyRankBotOvertake');
  assert.ok(js.includes('function notifyRankBotClimb(event)'), 'harus ada notifyRankBotClimb');
  const overtake = js.slice(js.indexOf('function notifyRankBotOvertake(event)'), js.indexOf('function notifyRankBotClimb(event)'));
  assert.ok(overtake.includes('enqueueRankOvertake(event, false)'), 'salip orang lain harus masuk antrean sebagai bukan climb');
  const climb = js.slice(js.indexOf('function notifyRankBotClimb(event)'), js.indexOf('function checkRankBotOvertakes()'));
  assert.ok(climb.includes('enqueueRankOvertake(event, true)'), 'naik peringkat sendiri harus masuk antrean sebagai climb');
});

test('kartu salip punya navigasi Sebelumnya / Berikutnya / Terbaru dan penghitung', () => {
  const js = read('public/app.js');
  const html = read('public/index.html');
  const css = read('public/style.css');
  assert.ok(html.includes('data-rank-overtake-notice-prev'), 'kartu salip harus punya tombol Sebelumnya');
  assert.ok(html.includes('data-rank-overtake-notice-next'), 'kartu salip harus punya tombol Berikutnya');
  assert.ok(html.includes('data-rank-overtake-notice-latest'), 'kartu salip harus punya tombol Terbaru');
  assert.ok(html.includes('‹ Sebelumnya'), 'tombol Sebelumnya harus bertuliskan Sebelumnya');
  assert.ok(html.includes('Berikutnya ›'), 'tombol Berikutnya harus bertuliskan Berikutnya');
  assert.ok(html.includes('>Terbaru<'), 'tombol Terbaru harus bertuliskan Terbaru');
  assert.ok(js.includes('function stepRankOvertakeNotice(delta)'), 'harus ada stepRankOvertakeNotice untuk pindah antrean');
  assert.ok(js.includes('function latestRankOvertakeNotice()'), 'harus ada latestRankOvertakeNotice untuk lompat ke yang terbaru');
  const render = js.slice(js.indexOf('function renderRankOvertakeNotice()'), js.indexOf('function showRankOvertakeNotice()'));
  assert.ok(render.includes('`${rankOvertakeNoticeIndex + 1} dari ${rankOvertakeQueue.length}`'), 'penghitung harus menunjukkan posisi dan jumlah salip, misal 1 dari 3');
  assert.ok(render.includes('prev.disabled = rankOvertakeNoticeIndex <= 0;'), 'tombol Sebelumnya harus mati di salip paling lama');
  assert.ok(render.includes('next.disabled = rankOvertakeNoticeIndex >= rankOvertakeQueue.length - 1;'), 'tombol Berikutnya harus mati di salip terbaru');
  assert.ok(render.includes('latest.disabled = rankOvertakeNoticeIndex >= rankOvertakeQueue.length - 1;'), 'tombol Terbaru harus mati bila sedang di salip terbaru');
  assert.ok(css.includes('.rank-overtake-notice-counter{'), 'penghitung harus punya gaya sendiri dan di tengah');
  assert.ok(css.includes('.rank-overtake-notice-nav{display:flex'), 'tombol navigasi harus sebaris dan membungkus di HP');
});

test('Tutup menutup satu salip, Tutup semua mengosongkan antrean', () => {
  const js = read('public/app.js');
  const html = read('public/index.html');
  assert.ok(html.includes('data-rank-overtake-notice-close-all'), 'kartu salip harus punya tombol Tutup semua');
  assert.ok(html.includes('>Tutup semua<'), 'tombol Tutup semua harus bertuliskan Tutup semua');
  const dismissOne = js.slice(js.indexOf('function dismissRankOvertakeCurrent()'), js.indexOf('function dismissAllRankOvertakes()'));
  assert.ok(dismissOne.includes('rankOvertakeQueue = rankOvertakeQueue.filter((entry) => entry.id !== id);'), 'Tutup harus membuang salip yang sedang dilihat dari antrean');
  assert.ok(dismissOne.includes('void dismissRankOvertakesOnServer([id], false);'), 'Tutup harus menghapus salip itu dari DATA_AKUN');
  assert.ok(dismissOne.includes('if (!rankOvertakeQueue.length) { hideRankOvertakeNotice(); return; }'), 'Tutup salip terakhir harus menutup kartu');
  const dismissAll = js.slice(js.indexOf('function dismissAllRankOvertakes()'), js.indexOf('function viewRankOvertakeNoticeCurrent()'));
  assert.ok(dismissAll.includes('rankOvertakeQueue = [];'), 'Tutup semua harus mengosongkan antrean');
  assert.ok(dismissAll.includes('void dismissRankOvertakesOnServer([], true);'), 'Tutup semua harus menghapus seluruh antrean dari DATA_AKUN');
  assert.ok(dismissAll.includes('hideRankOvertakeNotice();'), 'Tutup semua harus menutup kartu');
});

test('Lihat membuka layar detail dan kembali ke antrean saat detail ditutup', () => {
  const js = read('public/app.js');
  const view = js.slice(js.indexOf('function viewRankOvertakeNoticeCurrent()'), js.indexOf('function stepRankOvertakeNotice(delta)'));
  assert.ok(view.includes('hideRankOvertakeNotice();'), 'Lihat harus menyembunyikan kartu salip dulu');
  assert.ok(view.includes('rankOvertakeDetailReturnToNotice = true;'), 'Lihat harus menandai detail dibuka dari kartu salip');
  assert.ok(view.includes('openRankOvertakeDetail(item.event, item.isClimb)'), 'Lihat harus membuka layar detail salip itu');
  const close = js.slice(js.indexOf('function closeRankOvertakeDetail()'), js.indexOf("document.querySelector('#rank-overtake-detail')?.addEventListener"));
  assert.ok(close.includes('if (rankOvertakeDetailReturnToNotice) {'), 'menutup detail harus kembali ke kartu salip bila dibuka dari sana');
  assert.ok(close.includes('if (rankOvertakeQueue.length) showRankOvertakeNotice();'), 'kartu salip harus muncul lagi bila antrean masih ada');
});
