// Halaman Rank Bot: peringkat bot teraktif berdasarkan data tiap akun
// (DATA_AKUN) — story dibaca dan reaksi terkirim — dengan tiga kategori
// terpisah (Semua, Read Only, ReadSW + ReactionSW), urutan terbanyak di atas,
// dan level rank di setiap peringkat. Bisa dilihat member, Admin Utama, dan
// admin biasa.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

test('menu Rank Bot ada di posisi atas sidebar dan bisa dilihat semua akun', () => {
  const html = read('public/index.html');
  const navIndex = html.indexOf('id="rankbot-nav"');
  assert.ok(navIndex > -1, 'menu Rank Bot harus ada di sidebar');
  assert.ok(navIndex < html.indexOf('href="#profile"'), 'menu Rank Bot harus di atas Profil akun');
  assert.ok(html.includes('href="#rankbot"'), 'menu Rank Bot harus membuka halaman Rank Bot');
  assert.ok(html.includes('Rank Bot</a>'), 'menu Rank Bot harus bernama Rank Bot');
  const navTag = html.slice(navIndex, html.indexOf('</a>', navIndex));
  const navClasses = navTag.match(/class="([^"]*)"/)?.[1] || '';
  assert.ok(!navClasses.split(/\s+/).includes('hidden'), 'menu Rank Bot tidak boleh tersembunyi');
  assert.ok(!navClasses.split(/\s+/).includes('nav-item-locked'), 'menu Rank Bot tidak boleh terkunci untuk member');
});

test('halaman Rank Bot punya pencarian, pil kategori, dan wadah peringkat', () => {
  const html = read('public/index.html');
  assert.ok(html.includes('<section id="rankbot"'), 'halaman Rank Bot harus ada');
  assert.ok(html.includes('data-page-view="rankbot"'), 'halaman Rank Bot harus ikut sistem halaman workspace');
  assert.ok(html.includes('<h2 id="rankbot-title">Rank Bot</h2>'), 'halaman Rank Bot harus berjudul Rank Bot');
  assert.ok(html.includes('id="rankbot-search"'), 'halaman Rank Bot harus punya pencarian');
  assert.ok(html.includes('data-rankbot-filter="all"'), 'harus ada pil Semua');
  assert.ok(html.includes('data-rankbot-filter="readonly"'), 'harus ada pil Read Only');
  assert.ok(html.includes('data-rankbot-filter="readsw"'), 'harus ada pil ReadSW + ReactionSW');
  assert.ok(html.includes('id="rankbot-users"'), 'halaman Rank Bot harus punya wadah daftar peringkat');
  const js = read('public/app.js');
  assert.ok(js.includes("rankbot: 'Rank Bot'"), 'judul halaman Rank Bot harus terdaftar di workspacePageTitles');
  assert.ok(js.includes("document.querySelector('#rankbot')?.classList.remove('hidden');"), 'halaman Rank Bot harus dibuka setelah login');
});

test('peringkat dihitung dari data tiap akun lewat /api/members', () => {
  const js = read('public/app.js');
  assert.ok(js.includes('function rankCategoryOf(user)'), 'harus ada fungsi penentu kategori rank');
  assert.ok(js.includes("if (modeLabel.startsWith('ReadSW + ReactionSW')) return 'readsw';"), 'mode ReadSW + ReactionSW harus masuk kategori readsw');
  assert.ok(js.includes("if (modeLabel.startsWith('ReadSW')) return 'readonly';"), 'mode Read Only harus masuk kategori readonly');
  assert.ok(js.includes('function rankScoreOf(user, category)'), 'harus ada fungsi penghitung skor rank');
  assert.ok(js.includes("if (category === 'readonly') return reads;"), 'kategori Read Only harus dihitung dari story dibaca');
  assert.ok(js.includes("if (category === 'readsw') return reactions;"), 'kategori ReadSW harus dihitung dari reaksi terkirim');
  assert.ok(js.includes('return reads + reactions;'), 'kategori Semua harus dihitung dari total aktivitas');
  assert.ok(js.includes("const result = await api('/api/members');"), 'peringkat harus dibaca dari /api/members yang bisa dibuka semua akun yang login');
  assert.ok(js.includes('function sortRankBotUsers(users, category)'), 'harus ada fungsi pengurut peringkat');
  assert.ok(js.includes('rankScoreOf(b, category) - rankScoreOf(a, category)'), 'urutan harus terbanyak di atas');
});

test('setiap peringkat menampilkan nama, profil, mode, dan level rank', () => {
  const js = read('public/app.js');
  assert.ok(js.includes('function rankLevelFor(count)'), 'harus ada fungsi level rank');
  assert.ok(js.includes("if (value >= 500) return { label: 'Legenda'"), 'level Legenda harus mulai dari 500');
  assert.ok(js.includes("if (value >= 200) return { label: 'Master'"), 'level Master harus mulai dari 200');
  assert.ok(js.includes("if (value >= 50) return { label: 'Rajin'"), 'level Rajin harus mulai dari 50');
  assert.ok(js.includes("if (value >= 1) return { label: 'Aktif'"), 'level Aktif harus mulai dari 1');
  assert.ok(js.includes("return { label: 'Pemula'"), 'level Pemula harus untuk nol aktivitas');
  assert.ok(js.includes("article.className = `rankbot-item${position <= 3 ? ` rank-top-${position}` : ''}${user.isMainAdmin ? ' is-main-admin' : ''}${isSelf ? ' is-self' : ''}`;"), 'tiga besar harus ditandai dan baris akun sendiri harus memakai kelas is-self');
  assert.ok(js.includes("positionBadge.textContent = `#${position}`;"), 'setiap peringkat harus menampilkan nomor urutnya');
  assert.ok(js.includes("avatarImage.className = 'rankbot-avatar';"), 'setiap peringkat harus menampilkan avatar profil');
  assert.ok(js.includes("name.className = 'rankbot-name';"), 'setiap peringkat harus menampilkan nama');
  assert.ok(js.includes("handle.textContent = `@${username}`;"), 'setiap peringkat harus menampilkan @akun');
  assert.ok(js.includes("function rankModeShortLabel(modeLabel)"), 'harus ada fungsi pemendek label mode Rank Bot');
  assert.ok(js.includes("return String(modeLabel).replace('ReadSW + ReactionSW', 'ReadSW + Reaksi');"), 'label ReadSW + ReactionSW harus dipersingkat jadi ReadSW + Reaksi agar muat di HP (termasuk bila ada akhiran + Online 24 Jam)');
  assert.ok(js.includes("modeChip.textContent = rankModeShortLabel(String(user?.featureStats?.modeLabel"), 'setiap peringkat harus menampilkan modenya dengan label pendek');
  assert.ok(js.includes("statsLine.textContent = `${reads} story dibaca · ${reactions} reaksi terkirim`;"), 'setiap peringkat harus menampilkan kedua hitungannya');
  const css = read('public/style.css');
  assert.ok(css.includes('.rankbot-item{'), 'kartu peringkat harus punya gaya sendiri');
  assert.ok(css.includes('.rankbot-item{display:flex;align-items:center'), 'kartu peringkat harus berbentuk baris ringkas dengan ikon kecil di samping');
  assert.ok(css.includes('.rankbot-avatar{flex:0 0 44px'), 'avatar peringkat harus kecil (44px) di samping nama');
  assert.ok(css.includes('.rankbot-position{'), 'nomor peringkat harus punya lencana sendiri');
  assert.ok(css.includes('.rankbot-level{'), 'level rank harus punya lencana sendiri');
  assert.ok(css.includes('.rankbot-mode{font-size:11px;color:var(--soft);line-height:1.45;overflow-wrap:anywhere}'), 'mode peringkat harus membungkus ke baris berikut, bukan dipotong dengan ellipsis');
  assert.ok(css.includes('.rankbot-stats{margin:0;font-size:11px;color:var(--muted);line-height:1.45;overflow-wrap:anywhere}'), 'statistik peringkat harus membungkus ke baris berikut, bukan dipotong dengan ellipsis');
  assert.ok(css.includes('@media(max-width:560px){.rankbot-item{gap:8px;padding:10px 10px'), 'di HP baris peringkat harus makin ringkas agar muat');
  assert.ok(css.includes('.rankbot-avatar{flex-basis:34px;width:34px;height:34px}'), 'di HP avatar peringkat harus makin kecil (34px) agar nama muat');
  assert.ok(css.includes('.rankbot-position{flex-basis:30px}'), 'di HP lencana nomor peringkat harus makin ramping (30px) agar nama muat');
  assert.ok(css.includes('.rankbot-name-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0}'), 'baris nama peringkat harus membungkus chip peran ke baris berikut bila sempit, jadi nama akun tidak terpotong menjadi "W..." di HP (bug 18 Nov 18.46)');
});

test('label mode Rank Bot dipersingkat dengan benar (fungsi asli dijalankan)', () => {
  const js = read('public/app.js');
  const match = js.match(/function rankModeShortLabel\(modeLabel\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'fungsi rankModeShortLabel harus bisa diekstrak dari app.js');
  const short = eval(`(${match[0].replace('function rankModeShortLabel', 'function')})`);
  assert.equal(short('ReadSW + ReactionSW'), 'ReadSW + Reaksi', 'mode panjang harus dipersingkat');
  assert.equal(short('ReadSW + ReactionSW + Online 24 Jam'), 'ReadSW + Reaksi + Online 24 Jam', 'mode panjang dengan akhiran Online 24 Jam harus ikut dipersingkat');
  assert.equal(short('ReadSW'), 'ReadSW', 'mode Read Only tidak berubah');
  assert.equal(short('Mode belum dipilih'), 'Mode belum dipilih', 'mode kosong tidak berubah');
});

test('peringkat diperbarui realtime dan mengikuti pencarian serta pil kategori', () => {
  const js = read('public/app.js');
  assert.ok(js.includes('function startRankBotPolling()'), 'harus ada polling peringkat');
  assert.ok(js.includes("if (document.visibilityState === 'visible') void refreshRankBotData();"), 'pantau salip harus berjalan tiap 15 detik di halaman mana pun, bukan hanya Rank Bot');
  assert.ok(js.includes("if (page === 'rankbot') {\n    void loadRankBot();\n    startRankBotPolling();\n  }"), 'membuka Rank Bot harus langsung memuat peringkat');
  assert.ok(js.includes("document.querySelector('#rankbot-search')?.addEventListener('input'"), 'pencarian harus menyaring peringkat');
  assert.ok(js.includes("document.querySelector('[data-rankbot-filters]')?.addEventListener('click'"), 'pil kategori harus mengganti kategori peringkat');
});

test('entri Info Update terbaru dan halaman Rank Bot', () => {
  const data = JSON.parse(read('public/info-updates.json'));
  const html = read('public/index.html');
  assert.equal(data.updatedAt, '2026-11-27T21:47:00+07:00', 'updatedAt harus sama dengan waktu entri terbaru');
  assert.equal(data.updates.length, 117, 'daftar harus bertambah lima entri');
  const newest = data.updates[0];
  assert.equal(newest.title, 'Nama member di Obrolan kini putih bawaan, hanya admin yang berwarna', 'entri terbaru harus soal batas 10 detik indikator mengetik');
  assert.equal(newest.tag, 'Tampilan', 'entri terbaru harus bertag Perubahan');
  assert.equal(newest.time, '21.47 WIB', 'waktu entri terbaru harus cocok');
  const rankbotEntry = data.updates[58];
  assert.equal(rankbotEntry.title, 'Halaman Rank Bot untuk melihat bot teraktif', 'entri Rank Bot kini di posisi kedua puluh tujuh');
  assert.equal(rankbotEntry.tag, 'Fitur baru', 'entri Rank Bot harus bertag Fitur baru');
  assert.equal(rankbotEntry.time, '17.00 WIB', 'waktu entri Rank Bot harus cocok');
  assert.ok(rankbotEntry.description.includes("label mode dipersingkat jadi 'ReadSW + Reaksi'"), 'entri Rank Bot harus menjelaskan perbaikan nama fitur yang terpotong');
  assert.ok(html.includes("label mode dipersingkat jadi 'ReadSW + Reaksi'"), 'fallback harus memuat perbaikan nama fitur yang terpotong');
  assert.ok(html.includes('<h4>Halaman Rank Bot untuk melihat bot teraktif</h4>'), 'fallback harus memuat judul entri Rank Bot');
});
