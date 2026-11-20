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

test('kartu salip menampilkan nama, posisi, dan waktu WIB dengan kata kocak', () => {
  const js = read('public/app.js');
  assert.ok(js.includes("context: { kind: 'rankovertake'"), 'kartu salip harus memakai konteks rankovertake sendiri');
  assert.ok(js.includes("title: 'Ada yang menyalip di Rank Bot!'"), 'judul kartu salip harus jelas');
  assert.ok(js.includes('menyalaip') === false, 'teks kartu tidak boleh mengandung salah ketik "menyalaip"');
  assert.ok(js.includes('${overtakerName} menyalip ${overtakenName}'), 'teks kartu harus menyebut siapa menyalip siapa');
  assert.ok(js.includes('dan kini #${event.newPosition}'), 'teks kartu harus menyebut posisi baru yang menyalip');
  assert.ok(js.includes('turun ke #${event.overtakenNewPosition}'), 'teks kartu harus menyebut posisi baru yang kesalip');
  assert.ok(js.includes('Sejak terakhir kamu lihat,'), 'salip yang terjadi selagi halaman ditinggal harus dijelaskan begitu');
  assert.ok(js.includes("weekday: 'long', day: 'numeric', month: 'short', year: 'numeric'"), 'waktu kartu harus memuat hari, tanggal, bulan, dan tahun');
  assert.ok(js.includes("hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta'"), 'waktu kartu harus jam WIB');
  assert.ok(js.includes('${when} WIB.'), 'waktu kartu harus diakhiri WIB');
  assert.ok(js.includes("const openers = ['Wush!', 'Ngebut!', 'Salip menyalip!'];"), 'kartu salip harus punya kata pembuka kocak yang bergilir');
  assert.ok(js.includes("addLabel: null,"), 'kartu salip tidak perlu tombol aksi, cukup Tutup');
  assert.ok(js.includes("icon: '🏆',"), 'kartu salip harus memakai ikon trofi di atas judul');
});

test('kartu salip memakai ikon sendiri dan menutupnya tidak mematikan pengingat lain', () => {
  const js = read('public/app.js');
  assert.ok(js.includes('function showNoticeOverlay({ title, text, context, addTarget, addLabel, onAdd, icon })'), 'showNoticeOverlay harus menerima ikon per notifikasi');
  assert.ok(js.includes("if (iconElement) iconElement.textContent = icon || '!';"), 'ikon kartu harus mengikuti parameter, bawaan tetap tanda seru');
  const dismiss = js.slice(js.indexOf('function dismissNoticeOverlay()'), js.indexOf('function syncStoryEmojiNotice()'));
  assert.ok(dismiss.includes("noticeContext?.kind === 'rankovertake'"), 'dismiss harus punya cabang sendiri untuk rankovertake');
  const branch = dismiss.slice(dismiss.indexOf("kind === 'rankovertake'"));
  assert.ok(!branch.slice(0, branch.indexOf('} else')).includes('emojiNoticeDismissed = true'), 'menutup kartu salip tidak boleh mematikan pengingat reaksi emoji');
});

test('notifikasi naik peringkat: kartunya beda dari kartu salip (judul, ikon, kata pembuka khusus)', () => {
  const js = read('public/app.js');
  assert.ok(js.includes('function notifyRankBotClimb(event, live)'), 'harus ada fungsi notifikasi naik peringkat sendiri');
  assert.ok(js.includes("context: { kind: 'rankclimb'"), 'kartu naik peringkat harus memakai konteks rankclimb sendiri, bukan rankovertake');
  assert.ok(js.includes("title: isTop ? 'Kamu nomor 1 di Rank Bot!' : 'Kamu naik peringkat!'"), 'judul kartu harus merayakan yang login: nomor 1 atau naik peringkat');
  assert.ok(js.includes("icon: isTop ? '👑' : '🚀'"), 'ikon kartu harus mahkota untuk nomor 1 dan roket untuk naik peringkat, bukan trofi salip');
  assert.ok(js.includes("const openers = isTop ? ['Puncak!', 'Juara!', 'Nomor satu!'] : ['Gas!', 'Naik terus!', 'Makin dekat ke puncak!'];"), 'kata pembuka kartu harus beda dari kata kocak kartu salip');
  assert.ok(js.includes('Kamu menyalip ${overtakenName} dan kini #${event.newPosition} (dari #${event.oldPosition})'), 'teks kartu harus menyebut siapa yang disalip dan posisi lama ke baru');
  assert.ok(js.includes('Sejak terakhir kamu lihat, kamu menyalip'), 'naik peringkat selagi halaman ditinggal harus dijelaskan begitu');
  assert.ok(js.includes("addLabel: null,"), 'kartu naik peringkat tidak perlu tombol aksi, cukup Tutup');
});

test('naik peringkat sendiri didahulukan dari salip orang lain dan menutupnya tidak mematikan pengingat lain', () => {
  const js = read('public/app.js');
  const checker = js.slice(js.indexOf('function checkRankBotOvertakes()'), js.indexOf('function renderRankBot()'));
  assert.ok(checker.includes("const climb = viewer ? fresh.find((item) => item.overtaker === viewer) : null;"), 'salip oleh yang login harus dikenali sebagai naik peringkat sendiri');
  assert.ok(checker.includes('if (climb) notifyRankBotClimb(climb, rankOvertakeSeen);'), 'naik peringkat sendiri harus didahulukan dari kartu salip biasa');
  assert.ok(checker.includes('else if (fresh[0]) notifyRankBotOvertake(fresh[0], rankOvertakeSeen);'), 'salip orang lain tetap memakai kartu salip biasa bila yang login tidak naik');
  const dismiss = js.slice(js.indexOf('function dismissNoticeOverlay()'), js.indexOf('function syncStoryEmojiNotice()'));
  assert.ok(dismiss.includes("noticeContext?.kind === 'rankclimb'"), 'dismiss harus punya cabang sendiri untuk rankclimb');
  const branch = dismiss.slice(dismiss.indexOf("kind === 'rankclimb'"));
  assert.ok(!branch.slice(0, branch.indexOf('} else')).includes('emojiNoticeDismissed = true'), 'menutup kartu naik peringkat tidak boleh mematikan pengingat reaksi emoji');
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

test('entri Info Update notifikasi salip Rank Bot kini di posisi kedua puluh', () => {
  const data = JSON.parse(read('public/info-updates.json'));
  const html = read('public/index.html');
  assert.equal(data.updatedAt, '2026-11-21T05:41:00+07:00', 'updatedAt harus sama dengan waktu entri terbaru');
  assert.equal(data.updates.length, 87, 'daftar harus bertambah lima entri');
  const newest = data.updates[21];
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
