// Notifikasi salip Rank Bot: saat ada akun yang menyalip akun lain di peringkat
// "Semua", muncul kartu notifikasi realtime (nama yang menyalip dan yang
// kesalip, posisi baru, hari/tanggal/waktu WIB) — juga saat Rank Bot dibuka
// setelah ditinggal, berdasarkan urutan terakhir yang dilihat (DATA_AKUN
// realtime lewat /api/members). Baris akun sendiri ditandai warna emas +
// lencana "Kamu" supaya langsung ketemu di daftar.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

function findRankBotOvertakes() {
  const js = read('public/app.js');
  const match = js.match(/function findRankBotOvertakes\(previousOrder, currentOrder\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'fungsi findRankBotOvertakes harus bisa diekstrak dari app.js');
  return eval(`(${match[0].replace('function findRankBotOvertakes', 'function')})`);
}

test('deteksi salip: akun yang naik melewati akun lain dilaporkan sekali per pasangan', () => {
  const find = findRankBotOvertakes();
  const events = find(['dlyzn', 'ryobot', 'bangwily'], ['ryobot', 'dlyzn', 'bangwily']);
  assert.equal(events.length, 1, 'satu salip harus menghasilkan satu kejadian');
  assert.equal(events[0].overtaker, 'ryobot', 'yang menyalip harus ryobot');
  assert.equal(events[0].overtaken, 'dlyzn', 'yang kesalip harus dlyzn');
  assert.equal(events[0].newPosition, 1, 'ryobot kini di peringkat 1');
  assert.equal(events[0].oldPosition, 2, 'ryobot sebelumnya di peringkat 2');
  assert.equal(events[0].overtakenNewPosition, 2, 'dlyzn turun ke peringkat 2');
});

test('deteksi salip: tidak ada perubahan berarti tidak ada kejadian', () => {
  const find = findRankBotOvertakes();
  assert.deepEqual(find(['dlyzn', 'ryobot'], ['dlyzn', 'ryobot']), [], 'urutan sama tidak boleh memicu notifikasi');
  assert.deepEqual(find(['dlyzn', 'ryobot'], ['dlyzn', 'ryobot', 'bangwily']), [], 'akun baru yang muncul di bawah bukan salip');
  assert.deepEqual(find(['dlyzn', 'ryobot', 'bangwily'], ['dlyzn', 'ryobot']), [], 'akun yang hilang bukan salip dan tidak boleh memicu kartu palsu');
});

test('deteksi salip: lompatan dua peringkat melaporkan yang paling dekat ke puncak dulu', () => {
  const find = findRankBotOvertakes();
  const events = find(['a', 'b', 'c', 'd'], ['c', 'a', 'b', 'd']);
  assert.equal(events.length, 2, 'c melewati a dan b sekaligus');
  assert.equal(events[0].overtaken, 'a', 'kejadian pertama harus yang dilewati paling atas');
  assert.equal(events[0].newPosition, 1, 'c kini di peringkat 1');
  assert.equal(events[1].overtaken, 'b', 'kejadian kedua harus yang dilewati berikutnya');
});

test('peringkat diperiksa tiap muat ulang dari urutan terakhir yang dilihat', () => {
  const js = read('public/app.js');
  assert.ok(js.includes('checkRankBotOvertakes();'), 'loadRankBot harus memeriksa salip setelah merender peringkat');
  assert.ok(js.includes('let rankOvertakeSnapshot = null;'), 'harus ada snapshot urutan di memori untuk deteksi live');
  assert.ok(js.includes("`rankbot-last-seen:${String(currentUser?.username || 'anon')}`"), 'urutan terakhir harus disimpan per akun yang login di localStorage');
  assert.ok(js.includes('readRankBotLastSeenOrder()'), 'membuka Rank Bot harus membaca urutan terakhir yang dilihat');
  assert.ok(js.includes('writeRankBotLastSeenOrder(current);'), 'setiap muat ulang harus menyimpan urutan terbaru');
  assert.ok(js.includes('rankOvertakeNotified'), 'harus ada ingatan pasangan yang sudah diberitakan supaya tidak spam');
  assert.ok(js.includes('10 * 60 * 1000'), 'pasangan yang sama tidak diberitakan lagi dalam 10 menit');
});

test('kartu salip menampilkan siapa menyalip siapa, posisi, dan waktu WIB', () => {
  const js = read('public/app.js');
  const html = read('public/index.html');
  // Kartu notifikasi salip kini layar sendiri (#rank-overtake-notice), bukan
  // kartu teks umum: avatar + nama + peringkat + skor total tiap sisi,
  // seperti layar detail salip.
  assert.ok(html.includes('id="rank-overtake-notice"'), 'harus ada kartu notifikasi salip sendiri');
  assert.ok(html.includes('id="rank-overtake-notice-counter"'), 'kartu salip harus punya penghitung antrean');
  assert.ok(html.includes('data-rank-overtake-notice-view'), 'kartu salip harus punya tombol Lihat');
  assert.ok(html.includes('data-rank-overtake-notice-close-all'), 'kartu salip harus punya tombol Tutup semua');
  for (const side of ['overtaker', 'overtaken']) {
    assert.ok(html.includes(`id="rank-overtake-notice-${side}-avatar"`), `kartu salip harus punya avatar yang ${side}`);
    assert.ok(html.includes(`id="rank-overtake-notice-${side}-name"`), `kartu salip harus punya nama yang ${side}`);
    assert.ok(html.includes(`id="rank-overtake-notice-${side}-rank"`), `kartu salip harus punya peringkat baru yang ${side}`);
    assert.ok(html.includes(`id="rank-overtake-notice-${side}-score"`), `kartu salip harus punya skor total yang ${side}`);
  }
  // Render memakai helper yang sama dengan layar detail, supaya data akurat.
  assert.ok(js.includes('function renderRankOvertakeNotice()'), 'harus ada renderRankOvertakeNotice');
  const render = js.slice(js.indexOf('function renderRankOvertakeNotice()'), js.indexOf('function showRankOvertakeNotice()'));
  assert.ok(render.includes("'Ada yang menyalip di Rank Bot!'"), 'judul kartu salip harus jelas');
  assert.ok(render.includes("fillRankOvertakeSides(modal, 'rank-overtake-notice', event)"), 'kartu salip harus mengisi kedua sisi lewat helper yang sama dengan layar detail');
  assert.ok(render.includes('formatRankOvertakeWhen(item.createdAt)'), 'waktu kartu harus waktu salip itu sendiri, bukan waktu kartu dibuka');
  assert.ok(js.includes("weekday: 'long', day: 'numeric', month: 'short', year: 'numeric'"), 'waktu kartu harus memuat hari, tanggal, bulan, dan tahun');
  assert.ok(js.includes("hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta'"), 'waktu kartu harus jam WIB');
  // Tombol Lihat langsung membuka halaman Rank Bot.
  assert.ok(js.includes('function viewRankOvertakeNoticeCurrent()'), 'harus ada viewRankOvertakeNoticeCurrent');
  const view = js.slice(js.indexOf('function viewRankOvertakeNoticeCurrent()'), js.indexOf('function stepRankOvertakeNotice(delta)'));
  assert.ok(view.includes("setWorkspacePage('rankbot')"), 'tombol Lihat kartu salip harus membuka halaman Rank Bot');
  assert.ok(!view.includes('openRankOvertakeDetail'), 'tombol Lihat tidak boleh lagi membuka layar detail');
});

test('kartu salip memakai ikon sendiri dan menutupnya tidak mematikan pengingat lain', () => {
  const js = read('public/app.js');
  const render = js.slice(js.indexOf('function renderRankOvertakeNotice()'), js.indexOf('function showRankOvertakeNotice()'));
  assert.ok(render.includes("? (isTop ? '👑' : '🚀')"), 'ikon kartu harus mahkota untuk nomor 1 dan roket untuk naik peringkat');
  assert.ok(render.includes("viewerIsOvertaken ? '⬇️' : '🏆'"), 'ikon kartu harus panah bawah bila yang login yang disalip, trofi bila akun lain');
  // Menutup kartu salip memakai fungsi sendiri, bukan dismissNoticeOverlay:
  // tidak menyentuh pengingat reaksi emoji.
  assert.ok(js.includes('function dismissRankOvertakeCurrent()'), 'harus ada dismissRankOvertakeCurrent');
  const dismiss = js.slice(js.indexOf('function dismissRankOvertakeCurrent()'), js.indexOf('function dismissAllRankOvertakes()'));
  assert.ok(!dismiss.includes('emojiNoticeDismissed'), 'menutup kartu salip tidak boleh mematikan pengingat reaksi emoji');
  assert.ok(js.includes('function dismissAllRankOvertakes()'), 'harus ada dismissAllRankOvertakes');
});

test('notifikasi naik peringkat: kartunya beda dari kartu salip (judul, ikon)', () => {
  const js = read('public/app.js');
  assert.ok(js.includes('function notifyRankBotClimb(event)'), 'harus ada fungsi notifikasi naik peringkat sendiri');
  const notify = js.slice(js.indexOf('function notifyRankBotClimb(event)'), js.indexOf('function checkRankBotOvertakes()'));
  assert.ok(notify.includes('enqueueRankOvertake(event, true)'), 'naik peringkat harus masuk antrean sebagai climb');
  const render = js.slice(js.indexOf('function renderRankOvertakeNotice()'), js.indexOf('function showRankOvertakeNotice()'));
  assert.ok(render.includes("'Kamu nomor 1 di Rank Bot!'"), 'judul kartu harus merayakan nomor 1');
  assert.ok(render.includes("'Kamu menyalip!'"), 'judul kartu harus merayakan naik peringkat');
  assert.ok(render.includes("'👑'"), 'ikon kartu harus mahkota untuk nomor 1');
  assert.ok(render.includes("'🚀'"), 'ikon kartu harus roket untuk naik peringkat');
  // Kartu naik peringkat juga punya tombol Lihat ke halaman Rank Bot.
  assert.ok(js.includes('function viewRankOvertakeNoticeCurrent()'), 'kartu naik peringkat harus bisa dibuka ke halaman Rank Bot');
});

test('naik peringkat sendiri didahulukan dari salip orang lain dan semua salip baru masuk antrean', () => {
  const js = read('public/app.js');
  const checker = js.slice(js.indexOf('function checkRankBotOvertakes()'), js.indexOf('function renderRankBot()'));
  assert.ok(checker.includes("const involved = viewer ? fresh.filter((item) => item.overtaker === viewer || item.overtaken === viewer) : [];"), 'hanya salip yang melibatkan akun yang login yang boleh diberitakan');
  assert.ok(checker.includes("const climbs = involved.filter((item) => item.overtaker === viewer);"), 'salip oleh yang login harus dikenali sebagai naik peringkat sendiri');
  assert.ok(checker.includes("const others = involved.filter((item) => item.overtaker !== viewer);"), 'salip yang menimpa yang login harus dipisah dari naik peringkat sendiri');
  assert.ok(checker.includes('for (const item of climbs) notifyRankBotClimb(item);'), 'naik peringkat sendiri harus didahulukan');
  assert.ok(checker.includes('for (const item of others) notifyRankBotOvertake(item);'), 'semua salip yang melibatkan yang login harus masuk antrean, bukan cuma satu');
  assert.ok(!checker.includes('fresh[0]'), 'tidak boleh lagi cuma satu kartu per muat ulang');
});

test('baris akun sendiri dibedakan warna emas dan lencana Kamu di Rank Bot', () => {
  const js = read('public/app.js');
  assert.ok(js.includes("const isSelf = Boolean(currentUser && String(currentUser.username || '') === username);"), 'baris sendiri harus dikenali dari akun yang sedang login');
  assert.ok(js.includes("${isSelf ? ' is-self' : ''}"), 'baris sendiri harus memakai kelas is-self');
  assert.ok(js.includes("selfBadge.className = 'rankbot-self-badge';"), 'baris sendiri harus punya lencana sendiri');
  assert.ok(js.includes("selfBadge.textContent = 'Kamu';"), 'lencana baris sendiri harus bertuliskan Kamu');
  const css = read('public/style.css');
  assert.ok(css.includes('.rankbot-item.is-self{border-color:rgba(245,197,66,.7)'), 'baris sendiri harus punya bingkai emas');
  assert.ok(css.includes('.rankbot-item.is-self .rankbot-avatar{border-color:#f5c542'), 'avatar baris sendiri harus bercincin emas');
  assert.ok(css.includes('.rankbot-self-badge{'), 'lencana Kamu harus punya gaya sendiri');
  assert.ok(css.includes('background:linear-gradient(135deg,#f5c542,#d99a1f)'), 'lencana Kamu harus berwarna emas seperti lencana peringkat pertama');
});

test('salip dipantau realtime sejak login, bukan hanya saat halaman Rank Bot dibuka', () => {
  const js = read('public/app.js');
  // Pemisah data dan render: refreshRankBotData mengambil /api/members,
  // merender hanya bila sedang di halaman Rank Bot, tapi selalu memeriksa salip.
  assert.ok(js.includes('async function refreshRankBotData()'), 'harus ada refreshRankBotData yang memisahkan ambil data dari render');
  const refresh = js.slice(js.indexOf('async function refreshRankBotData()'), js.indexOf('async function loadRankBot()'));
  assert.ok(refresh.includes("await api('/api/members')"), 'refresh harus mengambil peringkat dari /api/members');
  assert.ok(refresh.includes("if (activeWorkspacePage === 'rankbot')"), 'render dan jam diperbarui hanya bila sedang di halaman Rank Bot');
  assert.ok(refresh.includes('checkRankBotOvertakes();'), 'cek salip harus jalan di tiap refresh, di halaman mana pun');
  // Pantau global: interval 15 detik sejak login, tanpa syarat halaman Rank Bot.
  assert.ok(js.includes('function startRankBotOvertakeWatch()'), 'harus ada startRankBotOvertakeWatch global');
  const watch = js.slice(js.indexOf('function startRankBotOvertakeWatch()'), js.indexOf('function startRankBotPolling()'));
  assert.ok(watch.includes('window.setInterval'), 'pantau global harus memakai interval');
  assert.ok(watch.includes('15000'), 'pantau global harus tiap 15 detik');
  assert.ok(watch.includes("if (document.visibilityState === 'visible') void refreshRankBotData();"), 'pantau global harus refresh tiap tab terlihat');
  assert.ok(!watch.includes("activeWorkspacePage === 'rankbot'"), 'pantau global tidak boleh mensyaratkan halaman Rank Bot');
  assert.ok(js.includes('startRankBotOvertakeWatch();'), 'pantau global harus dijalankan');
  // Dijalankan sejak login, sejajar dengan Obrolan yang poll sejak login.
  const init = js.slice(js.indexOf('startChatPolling();'), js.indexOf('startInfoUpdateNoticePolling();'));
  assert.ok(init.includes('startRankBotOvertakeWatch();'), 'pantau salip harus dimulai sejak login, sejajar Obrolan');
  assert.ok(init.includes('void refreshRankBotData();'), 'peringkat harus langsung diambil sekali saat login');
});

test('layar detail salip menampilkan avatar, nama, dan peringkat lama ke baru keduanya', () => {
  const js = read('public/app.js');
  const html = read('public/index.html');
  const css = read('public/style.css');
  // Kejadian salip kini membawa peringkat lama yang kesalip (akurat, bukan tebakan).
  const find = findRankBotOvertakes();
  const events = find(['dlyzn', 'ryobot', 'bangwily'], ['ryobot', 'dlyzn', 'bangwily']);
  assert.equal(events[0].overtakenOldPosition, 1, 'dlyzn sebelumnya di peringkat 1');
  assert.equal(events[0].overtakenNewPosition, 2, 'dlyzn kini di peringkat 2');
  // Modal detail ada di halaman dengan kolom avatar + nama + peringkat tiap sisi.
  assert.ok(html.includes('id="rank-overtake-detail"'), 'harus ada modal layar detail salip');
  for (const side of ['overtaker', 'overtaken']) {
    assert.ok(html.includes(`id="rank-overtake-detail-${side}-avatar"`), `detail harus punya avatar yang ${side}`);
    assert.ok(html.includes(`id="rank-overtake-detail-${side}-name"`), `detail harus punya nama yang ${side}`);
    assert.ok(html.includes(`id="rank-overtake-detail-${side}-handle"`), `detail harus punya @akun yang ${side}`);
    assert.ok(html.includes(`id="rank-overtake-detail-${side}-rank"`), `detail harus punya peringkat baru yang ${side}`);
    assert.ok(html.includes(`id="rank-overtake-detail-${side}-from"`), `detail harus punya peringkat lama yang ${side}`);
  }
  assert.ok(html.includes('id="rank-overtake-detail-when"'), 'detail harus punya waktu salip');
  assert.ok(html.includes('data-rank-overtake-detail-close'), 'detail harus bisa ditutup');
  // openRankOvertakeDetail mengisi modal lewat helper yang sama dengan kartu
  // notifikasi salip, dan menampilkannya.
  assert.ok(js.includes('function openRankOvertakeDetail(event, isClimb)'), 'harus ada openRankOvertakeDetail');
  const open = js.slice(js.indexOf('function openRankOvertakeDetail(event, isClimb)'), js.indexOf('function closeRankOvertakeDetail()'));
  assert.ok(open.includes("modal.classList.remove('hidden')"), 'membuka detail harus menampilkan modal');
  assert.ok(open.includes("fillRankOvertakeSides(modal, 'rank-overtake-detail', event)"), 'detail harus mengisi kedua sisi lewat helper yang sama dengan kartu salip');
  const fill = js.slice(js.indexOf('function fillRankOvertakeSides(modal, idPrefix, event)'), js.indexOf('// Layar detail salip:'));
  assert.ok(fill.includes('rankBotAvatarSrc(user)'), 'avatar detail harus memakai helper yang sama dengan baris peringkat');
  assert.ok(fill.includes('event.overtakenOldPosition'), 'detail harus memakai peringkat lama yang kesalip dari kejadian');
  assert.ok(js.includes('function closeRankOvertakeDetail()'), 'harus ada closeRankOvertakeDetail');
  assert.ok(js.includes('function rankBotAvatarSrc(user)'), 'harus ada helper URL avatar Rank Bot');
  // Gaya detail: avatar di tengah di atas nama, teks rapi di tengah, rapih di HP.
  assert.ok(css.includes('.rank-overtake-detail-row{display:flex;flex-direction:column;align-items:center'), 'baris detail harus kolom di tengah: avatar di atas, nama dan teks di bawahnya');
  assert.ok(css.includes('.rank-overtake-detail-avatar{'), 'avatar detail harus punya gaya sendiri');
  assert.ok(css.includes('.rank-overtake-detail-avatar{flex:0 0 auto;width:52px;height:52px'), 'avatar detail harus cukup besar dan di tengah');
  assert.ok(css.includes('.rank-overtake-detail-identity{flex:0 0 auto;width:100%;min-width:0;display:flex;flex-direction:column;align-items:center;gap:1px;text-align:center}'), 'nama, handle, dan peringkat harus di tengah di bawah avatar');
  assert.ok(css.includes('.rank-overtake-detail-row{gap:4px;padding:10px}'), 'detail harus dirapikan untuk layar HP');
});

test('layar detail salip menampilkan skor total aktivitas tiap akun, realtime', () => {
  const js = read('public/app.js');
  const html = read('public/index.html');
  const css = read('public/style.css');
  // Tiap sisi detail punya skor total + rincian story dibaca dan reaksi.
  for (const side of ['overtaker', 'overtaken']) {
    assert.ok(html.includes(`id="rank-overtake-detail-${side}-score"`), `detail harus punya skor total yang ${side}`);
    assert.ok(html.includes(`id="rank-overtake-detail-${side}-reads"`), `detail harus punya jumlah story dibaca yang ${side}`);
    assert.ok(html.includes(`id="rank-overtake-detail-${side}-reactions"`), `detail harus punya jumlah reaksi yang ${side}`);
  }
  assert.ok(html.includes('skor total aktivitas'), 'detail harus melabeli skor total aktivitas');
  assert.ok(html.includes('story dibaca'), 'detail harus melabeli jumlah story yang dibaca');
  // Ikon SVG sesuai konteks: bintang untuk skor total, mata untuk story dibaca, hati untuk reaksi.
  assert.ok(html.includes('<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>'), 'skor total harus memakai ikon bintang');
  assert.ok(html.includes('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'), 'story dibaca harus memakai ikon mata');
  assert.ok(html.includes('<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>'), 'reaksi harus memakai ikon hati');
  // Skor diisi dari data Rank Bot terbaru saat layar dibuka (realtime), totalnya
  // skor peringkat yang sama dengan yang menentukan salip.
  const fill = js.slice(js.indexOf('function fillRankOvertakeSides(modal, idPrefix, event)'), js.indexOf('// Layar detail salip:'));
  assert.ok(fill.includes("rankScoreOf(user, 'all')"), 'skor total harus memakai skor peringkat yang sama dengan Rank Bot');
  assert.ok(fill.includes('storyReadCount'), 'skor harus membaca jumlah story yang dibaca dari data akun');
  assert.ok(fill.includes('reactionCount'), 'skor harus membaca jumlah reaksi dari data akun');
  assert.ok(fill.includes("toLocaleString('id-ID')"), 'skor harus diformat dengan pemisah ribuan Indonesia');
  for (const key of ['score', 'reads', 'reactions']) {
    assert.ok(fill.includes(`#\${idPrefix}-\${prefix}-${key}`), `skor ${key} harus diisi lewat fillSide saat layar dibuka`);
  }
  // Gaya skor: blok tengah di bawah identitas, angka besar, rapih di HP.
  assert.ok(css.includes('.rank-overtake-detail-row{display:flex;flex-direction:column;align-items:center'), 'baris detail harus kolom di tengah supaya avatar, nama, dan skor tersusun rapi ke bawah');
  assert.ok(css.includes('.rank-overtake-detail-score{flex:0 0 auto;width:100%'), 'skor harus selebar baris supaya teksnya bisa di tengah');
  assert.ok(css.includes('.rank-overtake-detail-score-total b{font-size:20px'), 'skor total harus tampil besar dan tebal');
  assert.ok(css.includes('.rank-overtake-detail-score-total svg{width:16px;height:16px;color:#f5c542'), 'ikon bintang skor total harus berwarna emas');
  assert.ok(css.includes('.rank-overtake-detail-score-parts{display:flex;flex-wrap:wrap;justify-content:center'), 'rincian skor harus di tengah dan membungkus di HP');
  assert.ok(css.includes('.rank-overtake-detail-score-total b{font-size:18px}'), 'skor total harus sedikit lebih kecil di HP');
});

test('entri Info Update notifikasi salip Rank Bot kini di posisi kedua puluh', () => {
  const data = JSON.parse(read('public/info-updates.json'));
  const html = read('public/index.html');
  assert.equal(data.updatedAt, '2026-11-28T05:45:00+07:00', 'updatedAt harus sama dengan waktu entri terbaru');
  assert.equal(data.updates.length, 125, 'daftar harus bertambah lima entri');
  const newest = data.updates[59];
  assert.equal(newest.title, 'Rank Bot kini memberi tahu saat ada yang menyalip', 'entri salip harus menjelaskan notifikasi salip Rank Bot');
  assert.equal(newest.tag, 'Fitur baru', 'entri terbaru harus bertag Fitur baru');
  assert.equal(newest.day, 'Rabu, 18 Nov 2026', 'hari entri terbaru harus cocok');
  assert.equal(newest.time, '13.10 WIB', 'waktu entri terbaru harus cocok');
  assert.ok(newest.description.includes('kartu notifikasi di tengah layar'), 'entri terbaru harus menjelaskan kartu notifikasi salip');
  assert.ok(newest.description.includes('Wush!'), 'entri terbaru harus menyebut kata kocak kartu salip');
  assert.ok(newest.description.includes('lencana Kamu'), 'entri terbaru harus menjelaskan lencana Kamu di baris akun sendiri');
  assert.ok(html.includes('<h4>Rank Bot kini memberi tahu saat ada yang menyalip</h4>'), 'fallback harus memuat judul entri salip');
  assert.ok(html.includes('Rabu, 18 Nov 2026 · 13.10 WIB'), 'fallback meta harus cocok dengan hari dan waktu entri salip');
  assert.ok(html.includes('kartu notifikasi di tengah layar'), 'fallback harus memuat penjelasan kartu notifikasi salip');
});

test('judul kartu salip ditentukan dari akun yang login saat ini, bukan penanda tersimpan', () => {
  const js = read('public/app.js');
  const render = js.slice(js.indexOf('function renderRankOvertakeNotice()'), js.indexOf('function showRankOvertakeNotice()'));
  // Judul harus dihitung dari event + akun yang login saat render, supaya
  // tidak tertukar: yang disalip harus melihat "Kamu tersalip!", bukan
  // "Kamu menyalip!" dan bukan judul umum "Ada yang menyalip di Rank Bot!".
  assert.ok(render.includes('const viewerIsOvertaker = Boolean(viewer) && event.overtaker === viewer;'), 'judul harus dihitung dari apakah yang login adalah yang menyalip');
  assert.ok(render.includes('const viewerIsOvertaken = Boolean(viewer) && event.overtaken === viewer;'), 'judul harus dihitung juga dari apakah yang login adalah yang disalip');
  assert.ok(render.includes("textContent = viewerIsOvertaker"), 'judul kartu harus memakai sudut pandang akun yang login saat ini');
  assert.ok(!render.includes('const { event, isClimb } = item;'), 'judul kartu tidak boleh lagi memakai penanda isClimb yang tersimpan');
  // Simulasi logika judul untuk tiga sudut pandang pada kejadian yang sama
  // (bangwily menyalip ryupler kuda ke #3): yang menyalip melihat
  // "Kamu menyalip!", yang disalip melihat "Kamu tersalip!", akun lain
  // yang tidak terlibat melihat "Ada yang menyalip di Rank Bot!".
  const titleFor = (viewerUsername, event) => {
    const viewer = String(viewerUsername || '');
    const viewerIsOvertaker = Boolean(viewer) && event.overtaker === viewer;
    const viewerIsOvertaken = Boolean(viewer) && event.overtaken === viewer;
    const isTop = viewerIsOvertaker && event.newPosition === 1;
    return viewerIsOvertaker
      ? (isTop ? 'Kamu nomor 1 di Rank Bot!' : 'Kamu menyalip!')
      : viewerIsOvertaken ? 'Kamu tersalip!' : 'Ada yang menyalip di Rank Bot!';
  };
  const event = { overtaker: 'bangwily', overtaken: 'ryuplerkuda', newPosition: 3, oldPosition: 4 };
  assert.equal(titleFor('bangwily', event), 'Kamu menyalip!', 'yang menyalip harus melihat "Kamu menyalip!"');
  assert.equal(titleFor('ryuplerkuda', event), 'Kamu tersalip!', 'yang disalip harus melihat "Kamu tersalip!", bukan "Kamu menyalip!" dan bukan judul umum');
  assert.equal(titleFor('wilykun', event), 'Ada yang menyalip di Rank Bot!', 'akun lain yang tidak terlibat melihat judul umum "Ada yang menyalip di Rank Bot!"');
  // Ikon yang disalip harus panah bawah, bukan trofi.
  assert.ok(render.includes("viewerIsOvertaken ? '⬇️' : '🏆'"), 'ikon kartu harus panah bawah bila yang login yang disalip');
  // Layar detail memakai logika yang sama.
  const open = js.slice(js.indexOf('function openRankOvertakeDetail(event, isClimb)'), js.indexOf('function closeRankOvertakeDetail()'));
  assert.ok(open.includes('const viewerIsOvertaker = Boolean(viewer) && event.overtaker === viewer;'), 'judul layar detail harus dihitung dari akun yang login saat ini');
  assert.ok(open.includes('const viewerIsOvertaken = Boolean(viewer) && event.overtaken === viewer;'), 'judul layar detail harus membedakan yang disalip');
  assert.ok(open.includes("viewerIsOvertaken ? 'Kamu tersalip!' : 'Ada yang menyalip!';"), 'judul layar detail harus "Kamu tersalip!" bila yang login yang disalip');
});
