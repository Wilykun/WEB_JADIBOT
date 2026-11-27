// Halaman Aktivitas Akun + status realtime di tiap baris Rank Bot:
// - Rank Bot: tiap baris menampilkan "Pemilik · Aktif/Tidak Aktif" dan
//   "Bot WhatsApp · Berjalan/Menunggu/Berhenti" dari /api/members.
// - Aktivitas Akun: halaman baru di bawah Rank Bot yang hanya menampilkan
//   nama, avatar, dan waktu pemilik terakhir login ke web (hari, tanggal,
//   bulan, tahun, jam WIB); urutan baris: akun sendiri paling atas (lencana
//   Kamu), lalu pemilik yang sedang aktif di panel, baru yang paling baru login.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import fs from 'node:fs';
import { cp, mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');
const html = read('public/index.html');
const css = read('public/style.css');
const appJs = read('public/app.js');
const serverJs = read('server/index.js');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('menu Aktivitas Akun ada tepat di bawah Rank Bot dan bisa dilihat semua akun', () => {
  const rankIndex = html.indexOf('id="rankbot-nav"');
  const navIndex = html.indexOf('id="accountactivity-nav"');
  assert.ok(navIndex > -1, 'menu Aktivitas Akun harus ada di sidebar');
  assert.ok(navIndex > rankIndex, 'menu Aktivitas Akun harus berada di bawah Rank Bot');
  assert.ok(navIndex < html.indexOf('href="#profile"'), 'menu Aktivitas Akun harus tetap di kelompok Utama');
  assert.ok(html.includes('href="#accountactivity"'), 'menu Aktivitas Akun harus membuka halaman Aktivitas Akun');
  assert.ok(html.includes('Aktivitas Akun</a>'), 'menu Aktivitas Akun harus bernama Aktivitas Akun');
  const navTag = html.slice(navIndex, html.indexOf('</a>', navIndex));
  assert.ok(navTag.includes('<svg'), 'menu Aktivitas Akun harus punya ikon SVG sesuai konteks');
  const navClasses = navTag.match(/class="([^"]*)"/)?.[1] || '';
  assert.ok(!navClasses.split(/\s+/).includes('hidden'), 'menu Aktivitas Akun tidak boleh tersembunyi');
  assert.ok(!navClasses.split(/\s+/).includes('nav-item-locked'), 'menu Aktivitas Akun tidak boleh terkunci untuk member');
});

test('halaman Aktivitas Akun hanya menampilkan nama, avatar, dan waktu login web tiap pemilik', () => {
  assert.ok(html.includes('<section id="accountactivity"'), 'halaman Aktivitas Akun harus ada');
  assert.ok(html.includes('data-page-view="accountactivity"'), 'halaman Aktivitas Akun harus ikut sistem halaman workspace');
  assert.ok(html.includes('<h2 id="accountactivity-title">Aktivitas Akun</h2>'), 'halaman Aktivitas Akun harus berjudul Aktivitas Akun');
  assert.ok(html.includes('id="accountactivity-users"'), 'halaman Aktivitas Akun harus punya wadah daftar akun');
  assert.ok(html.includes('id="accountactivity-updated"'), 'halaman Aktivitas Akun harus punya penanda waktu diperbarui');
  assert.ok(appJs.includes("accountactivity: 'Aktivitas Akun'"), 'judul halaman Aktivitas Akun harus terdaftar di workspacePageTitles');
  assert.ok(appJs.includes("document.querySelector('#accountactivity')?.classList.remove('hidden');"), 'halaman Aktivitas Akun harus dibuka setelah login supaya klik menu tidak tertahan');
  assert.ok(appJs.includes('function loadAccountActivity()'), 'harus ada pemuat daftar Aktivitas Akun');
  assert.ok(appJs.includes("const result = await api('/api/members');"), 'Aktivitas Akun harus dibaca dari /api/members yang bisa dibuka semua akun yang login');
  assert.ok(appJs.includes('function renderAccountActivity()'), 'harus ada perender daftar Aktivitas Akun');
  assert.ok(appJs.includes("article.className = `accountactivity-item${isSelf ? ' is-self' : ''}`;"), 'setiap baris harus berbentuk kartu akun, baris sendiri dibedakan');
  assert.ok(appJs.includes("avatarImage.className = 'accountactivity-avatar';"), 'setiap baris harus menampilkan avatar profil');
  assert.ok(appJs.includes("name.className = 'accountactivity-name';"), 'setiap baris harus menampilkan nama pemilik');
  assert.ok(appJs.includes("loginLine.className = 'accountactivity-login';"), 'setiap baris harus menampilkan baris waktu login');
  assert.ok(appJs.includes("`Pemilik Login Ke Web · ${timeLabel} WIB · ${daypart}`"), 'baris waktu harus bernama Pemilik Login Ke Web dengan jam WIB dan label Pagi/Siang/Sore/Malam');
  assert.ok(appJs.includes("'Pemilik Login Ke Web · Belum pernah login'"), 'akun yang belum pernah login harus tertulis Belum pernah login');
  assert.ok(appJs.includes("loginLine.append(createMemberIcon('clock'));"), 'baris waktu harus memakai ikon jam SVG sesuai konteks');
});

test('foto unggahan boleh dilihat semua akun yang login, bukan cuma admin', () => {
  // Server: endpoint foto unggahan tidak boleh lagi menolak member.
  const userAvatarFn = serverJs.slice(serverJs.indexOf("if (route === 'GET /api/admin/user-avatar')"), serverJs.indexOf("if (route === 'POST /api/admin/users/bot')"));
  assert.ok(userAvatarFn.includes("if (!user) return sendError(res, 401, 'Silakan masuk kembali.');"), 'foto unggahan tetap harus menolak tanpa login');
  assert.ok(!userAvatarFn.includes("if (user.role !== 'admin')"), 'foto unggahan tidak boleh lagi menolak member');
  // Client: semua halaman yang menampilkan avatar tidak boleh lagi
  // memeriksa peran admin sebelum memakai foto unggahan.
  assert.ok(!appJs.includes("selectedAvatar === 'uploaded' && currentUser?.role === 'admin'"), 'Daftar Member, Rank Bot, dan Aktivitas Akun harus memakai foto unggahan untuk semua akun');
  assert.ok(!appJs.includes("message.avatar === 'uploaded' && currentUser?.role === 'admin'"), 'Obrolan harus memakai foto unggahan untuk semua akun');
  // Teks profil harus jujur: foto unggahan kini terlihat semua akun yang login.
  assert.ok(html.includes('Avatar unggahan tersimpan di folder akunmu dan terlihat oleh semua akun yang login.'), 'halaman Profil akun harus menyebut foto unggahan terlihat semua akun yang login');
});

test('foto unggahan tampil di Aktivitas Akun dan Rank Bot, bukan jatuh ke preset avatar-01', () => {
  // Server: /api/members harus meneruskan 'uploaded' apa adanya, bukan
  // menukarnya ke avatar-01 seperti sebelumnya — kalau tidak, klien tidak
  // pernah tahu akun itu punya foto unggahan.
  assert.ok(serverJs.includes("avatar: item.avatar === 'uploaded' ? 'uploaded' : AVATAR_PRESETS.has(item.avatar) ? item.avatar : 'avatar-01',"), '/api/members harus meneruskan avatar unggahan apa adanya');
  assert.ok(serverJs.includes('avatarUpdatedAt: item.avatarUpdatedAt || null,'), '/api/members harus mengembalikan avatarUpdatedAt untuk cache-busting foto unggahan');
  // Client: kedua halaman harus memuat foto unggahan lewat /api/admin/user-avatar.
  const activityFn = appJs.slice(appJs.indexOf('function renderAccountActivity()'), appJs.indexOf('async function loadAccountActivity()'));
  assert.ok(activityFn.includes("selectedAvatar === 'uploaded'"), 'Aktivitas Akun harus membedakan foto unggahan dari preset');
  assert.ok(activityFn.includes('/api/admin/user-avatar?userId='), 'Aktivitas Akun harus memuat foto unggahan lewat /api/admin/user-avatar');
  const rankFn = appJs.slice(appJs.indexOf('function renderRankBot()'), appJs.indexOf('async function loadRankBot()'));
  assert.ok(rankFn.includes('avatarImage.src = rankBotAvatarSrc(user);'), 'Rank Bot harus memakai helper avatar yang sama dengan layar detail salip');
  const avatarSrc = appJs.slice(appJs.indexOf('function rankBotAvatarSrc(user)'), appJs.indexOf('function openRankOvertakeDetail'));
  assert.ok(avatarSrc.includes("selectedAvatar === 'uploaded'"), 'helper avatar Rank Bot harus membedakan foto unggahan dari preset');
  assert.ok(avatarSrc.includes('/api/admin/user-avatar?userId='), 'helper avatar Rank Bot harus memuat foto unggahan lewat /api/admin/user-avatar');
});

test('urutan Aktivitas Akun: akun sendiri paling atas, lalu pemilik aktif, baru yang paling baru login', () => {
  assert.ok(appJs.includes("const viewer = String(currentUser?.username || '');"), 'perender harus tahu akun yang sedang login');
  assert.ok(appJs.includes("const aSelf = viewer && String(a.username || '') === viewer ? 0 : 1;"), 'baris sendiri harus diutamakan dalam urutan');
  assert.ok(appJs.includes('if (aSelf !== bSelf) return aSelf - bSelf;'), 'baris sendiri harus selalu paling atas');
  assert.ok(appJs.includes('const aActive = a.panelActive ? 0 : 1;'), 'pemilik aktif harus diutamakan setelah baris sendiri');
  assert.ok(appJs.includes('if (aActive !== bActive) return aActive - bActive;'), 'pemilik yang sedang aktif di panel harus di atas pemilik yang tidak aktif');
  assert.ok(appJs.includes('return bMs - aMs;'), 'sisanya tetap diurutkan dari yang paling baru login');
  assert.ok(appJs.includes("const isSelf = Boolean(viewer && username === viewer);"), 'baris sendiri harus dikenali dari username yang login');
  assert.ok(appJs.includes("nameRow.className = 'accountactivity-namerow';"), 'nama dan lencana harus sebaris');
  assert.ok(appJs.includes("selfBadge.className = 'rankbot-self-badge';"), 'baris sendiri harus memakai lencana Kamu yang sama dengan Rank Bot');
  assert.ok(appJs.includes("selfBadge.textContent = 'Kamu';"), 'lencana baris sendiri harus berbunyi Kamu');
  assert.ok(css.includes('.accountactivity-item.is-self{'), 'baris sendiri harus punya latar emas');
  assert.ok(css.includes('.accountactivity-item.is-self .accountactivity-avatar{'), 'avatar baris sendiri harus bercincin emas');
  assert.ok(css.includes('.accountactivity-namerow{'), 'baris nama harus punya gaya sendiri');
  assert.ok(css.includes('.accountactivity-namerow{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0}'), 'baris nama harus membungkus chip peran ke baris berikut bila sempit, jadi nama akun tidak terpotong seperti di Rank Bot (bug 18 Nov 18.46)');
});

test('titik online di sudut avatar: hijau bila pemilik sedang membuka panel (ala Facebook)', () => {
  const appJs = read('public/app.js');
  assert.ok(appJs.includes("avatarWrap.className = 'accountactivity-avatar-wrap';"), 'avatar harus dibungkus supaya titik online bisa menempel di sudutnya');
  assert.ok(appJs.includes("if (user.panelActive) {"), 'titik online hanya untuk pemilik yang sedang aktif di panel');
  assert.ok(appJs.includes("onlineDot.className = 'accountactivity-online-dot';"), 'titik online harus memakai kelas sendiri');
  assert.ok(appJs.includes("onlineDot.title = 'Online';"), 'titik online harus berlabel Online');
  assert.ok(appJs.includes('article.append(avatarWrap, body);'), 'baris harus memakai pembungkus avatar, bukan gambarnya langsung');
  const css = read('public/style.css');
  assert.ok(css.includes('.accountactivity-avatar-wrap{position:relative;flex:0 0 40px;width:40px;height:40px}'), 'pembungkus avatar harus jadi jangkar posisi titik online');
  assert.ok(css.includes('.accountactivity-online-dot{position:absolute;right:0;bottom:0;width:12px;height:12px;border-radius:50%;background:#3ee69a;border:2px solid #08110e;box-shadow:0 0 6px rgba(62,230,154,.55)}'), 'titik online harus hijau di sudut kanan bawah avatar dengan cincin sewarna latar');
  assert.ok(css.includes('.accountactivity-avatar-wrap{flex-basis:34px;width:34px;height:34px}.accountactivity-online-dot{width:10px;height:10px}'), 'di HP pembungkus avatar dan titik online harus mengecil');
});

test('waktu login diambil dari riwayat login, diurutkan dari yang paling baru', () => {
  assert.ok(appJs.includes('function accountActivityLoginValue(user)'), 'harus ada fungsi pengambil waktu login tiap akun');
  assert.ok(appJs.includes('const loginMs = user?.lastLoginAt ? Date.parse(String(user.lastLoginAt)) : NaN;'), 'waktu login harus dibaca dari riwayat login (lastLoginAt)');
  assert.ok(appJs.includes('const seenMs = user?.lastSeen ? Number(user.lastSeen) : NaN;'), 'aktivitas panel terakhir (lastSeen) harus dibaca dari sesi yang hidup');
  assert.ok(appJs.includes('const latestMs = Math.max(Number.isNaN(loginMs) ? -Infinity : loginMs, Number.isNaN(seenMs) ? -Infinity : seenMs);'), 'yang dipakai harus yang paling baru di antara login terakhir dan aktivitas panel terakhir');
  assert.ok(appJs.includes('if (latestMs === -Infinity) return null;'), 'bila tidak ada keduanya harus menghasilkan null supaya tampil Belum pernah login');
  assert.ok(appJs.includes('function accountActivityTimeLabel(value)'), 'harus ada fungsi pemformat waktu login');
  const timeFn = appJs.match(/function accountActivityTimeLabel\(value\) \{[\s\S]*?\n\}/);
  assert.ok(timeFn, 'fungsi accountActivityTimeLabel harus bisa diekstrak dari app.js');
  const label = eval(`(${timeFn[0].replace('function accountActivityTimeLabel', 'function')})`);
  assert.equal(label('2026-11-18T08:24:00.000Z'), 'Rabu, 18 Nov 2026, 15.24', 'waktu login harus berformat hari, tanggal, bulan, tahun, jam WIB');
  assert.equal(label(null), null, 'waktu kosong harus menghasilkan null supaya tampil Belum pernah login');
  assert.equal(label('bukan-tanggal'), null, 'waktu tidak valid harus menghasilkan null');
  assert.ok(appJs.includes('return bMs - aMs;'), 'daftar harus diurutkan dari yang paling baru login');
});

test('jam yang tampil mengikuti aktivitas web terbaru, bukan jam login lama (bug 12.55)', () => {
  const valueFn = appJs.match(/function accountActivityLoginValue\(user\) \{[\s\S]*?\n\}/);
  assert.ok(valueFn, 'fungsi accountActivityLoginValue harus bisa diekstrak dari app.js');
  const value = eval(`(${valueFn[0].replace('function accountActivityLoginValue', 'function')})`);
  // Kasus Wily: login autentikasi 12.55 WIB, tapi sesi panel masih hidup
  // dan heartbeat terakhir 16.30 WIB — yang tampil harus 16.30, bukan 12.55.
  assert.equal(value({ lastLoginAt: '2026-11-18T05:55:00.000Z', lastSeen: Date.parse('2026-11-18T09:30:00.000Z') }), '2026-11-18T09:30:00.000Z', 'aktivitas panel yang lebih baru harus menang atas jam login lama');
  assert.equal(value({ lastLoginAt: '2026-11-18T09:30:00.000Z', lastSeen: Date.parse('2026-11-18T05:55:00.000Z') }), '2026-11-18T09:30:00.000Z', 'login yang lebih baru harus menang atas aktivitas panel lama');
  assert.equal(value({ lastLoginAt: null, lastSeen: Date.parse('2026-11-18T09:30:00.000Z') }), '2026-11-18T09:30:00.000Z', 'tanpa riwayat login, aktivitas panel dipakai');
  assert.equal(value({ lastLoginAt: '2026-11-18T05:55:00.000Z', lastSeen: null }), '2026-11-18T05:55:00.000Z', 'tanpa aktivitas panel, riwayat login dipakai');
  assert.equal(value({ lastLoginAt: null, lastSeen: null }), null, 'tanpa keduanya harus null supaya tampil Belum pernah login');
  assert.equal(value({ lastLoginAt: 'bukan-tanggal', lastSeen: null }), null, 'waktu login tidak valid harus diabaikan');
  assert.equal(value({}), null, 'akun tanpa data waktu harus null');
});

test('waktu login dilengkapi label Pagi, Siang, Sore, atau Malam sesuai jam WIB', () => {
  assert.ok(appJs.includes('function accountActivityDaypart(value)'), 'harus ada fungsi penentu label waktu login');
  const daypartFn = appJs.match(/function accountActivityDaypart\(value\) \{[\s\S]*?\n\}/);
  assert.ok(daypartFn, 'fungsi accountActivityDaypart harus bisa diekstrak dari app.js');
  const daypart = eval(`(${daypartFn[0].replace('function accountActivityDaypart', 'function')})`);
  assert.equal(daypart('2026-11-18T02:00:00.000Z'), 'Pagi', '09.00 WIB harus Pagi');
  assert.equal(daypart('2026-11-18T05:00:00.000Z'), 'Siang', '12.00 WIB harus Siang');
  assert.equal(daypart('2026-11-18T09:00:00.000Z'), 'Sore', '16.00 WIB harus Sore');
  assert.equal(daypart('2026-11-18T13:00:00.000Z'), 'Malam', '21.02 WIB harus Malam');
  assert.equal(daypart('2026-11-18T20:00:00.000Z'), 'Malam', '03.00 WIB harus Malam');
  assert.equal(daypart('2026-11-18T11:00:00.000Z'), 'Malam', '18.00 WIB harus Malam');
  assert.equal(daypart(null), null, 'waktu kosong harus menghasilkan null');
  assert.equal(daypart('bukan-tanggal'), null, 'waktu tidak valid harus menghasilkan null');
  assert.ok(appJs.includes("const daypart = accountActivityDaypart(accountActivityLoginValue(user));"), 'label waktu harus dihitung dari waktu login tiap baris');
});

test('setiap baris menandai peran dengan warna khusus: Admin Utama emas, Admin hijau, Member biru', () => {
  assert.ok(appJs.includes("const roleLabel = user.isMainAdmin ? 'Admin Utama' : user.role === 'admin' ? 'Admin' : 'Member';"), 'baris harus memakai label peran yang sama dengan Rank Bot');
  assert.ok(appJs.includes("roleChip.className = `accountactivity-role${user.isMainAdmin ? ' is-main-admin' : user.role === 'admin' ? ' is-admin' : ''}`;"), 'chip peran harus memakai kelas berbeda untuk Admin Utama, Admin, dan Member');
  assert.ok(appJs.includes("roleChip.textContent = roleLabel;"), 'chip peran harus menampilkan label perannya');
  assert.ok(appJs.includes('nameRow.append(name, roleChip);'), 'chip peran harus sebaris dengan nama');
  assert.ok(css.includes('.accountactivity-role{'), 'chip peran harus punya gaya sendiri');
  assert.ok(css.includes('.accountactivity-role.is-main-admin{color:#f5c542;'), 'Admin Utama harus berwarna emas');
  assert.ok(css.includes('.accountactivity-role.is-admin{color:#3ee69a;'), 'Admin biasa harus berwarna hijau');
  assert.ok(css.includes('.accountactivity-role{flex:0 0 auto;font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#7db8ff;'), 'Member harus berwarna biru');
});

test('login baru ke web memunculkan kartu notifikasi realtime selagi halaman Aktivitas Akun dibuka', () => {
  assert.ok(appJs.includes('let accountActivitySeenLogins = null;'), 'harus ada penanda login yang sudah terlihat di sesi ini');
  assert.ok(appJs.includes('function checkAccountActivityLogins(users)'), 'harus ada pemeriksa login baru');
  assert.ok(appJs.includes('checkAccountActivityLogins(accountActivityUsers);'), 'setiap muat daftar harus memeriksa login baru');
  assert.ok(appJs.includes("accountActivitySeenLogins = new Map(users.map((item) => [item.id, item.lastLoginAt || null]));"), 'muatan pertama hanya menandai tanpa notifikasi supaya login lama tidak dianggap baru');
  assert.ok(appJs.includes("String(item.username || '') !== String(currentUser?.username || '')"), 'login sendiri tidak boleh memunculkan notifikasi');
  assert.ok(appJs.includes('Date.parse(item.lastLoginAt) > now - 5 * 60 * 1000'), 'hanya login dalam 5 menit terakhir yang diberitahukan supaya login lama tidak muncul terlambat');
  assert.ok(appJs.includes("title: 'Ada yang baru login ke web panel!'"), 'kartu notifikasi harus berjudul ada yang baru login ke web panel');
  assert.ok(appJs.includes("context: { kind: 'accountactivitylogin', userId: newest.id, feature: newest.lastLoginAt }"), 'kartu notifikasi harus memakai konteks login Aktivitas Akun');
  assert.ok(appJs.includes("icon: '👤'"), 'kartu notifikasi harus memakai ikon orang');
  assert.ok(appJs.includes("} else if (noticeContext?.kind === 'accountactivitylogin') {"), 'menutup kartu login tidak boleh mematikan pengingat reaksi emoji');
});

test('menu Aktivitas Akun mendapat titik merah realtime bila ada login yang belum dilihat', () => {
  assert.ok(appJs.includes('function accountActivityLastSeenKey()'), 'harus ada kunci penyimpanan login terakhir yang sudah dilihat');
  assert.ok(appJs.includes("return `accountactivity-last-seen:${String(currentUser?.username || 'anon')}`;"), 'penanda sudah dilihat harus disimpan per akun');
  assert.ok(appJs.includes('function syncAccountActivityLoginBadge(latestLoginAt)'), 'harus ada penanda titik merah menu Aktivitas Akun');
  assert.ok(appJs.includes("syncAccountActivityLoginBadge(result?.latestLoginAt);"), 'heartbeat harus memperbarui titik merah tiap 25 detik');
  assert.ok(appJs.includes("if (maxLogin) window.localStorage.setItem(accountActivityLastSeenKey(), maxLogin);"), 'membuka halaman harus menandai semua login sudah dilihat supaya titik merah hilang');
  assert.ok(appJs.includes("dot.className = 'accountactivity-dot';"), 'titik merah harus memakai kelas sendiri');
  assert.match(serverJs, /lastLoginAt: last\?\.createdAt \|\| null,/, '/api/members harus mengembalikan lastLoginAt untuk penanda titik merah');
  assert.ok(serverJs.includes('.filter((entry) => entry.userId !== user.id)'), 'heartbeat harus mengembalikan login terbaru akun lain, bukan diri sendiri');
  assert.ok(serverJs.includes('latestLoginAt });'), 'heartbeat harus mengembalikan latestLoginAt');
  assert.ok(css.includes('.accountactivity-dot{'), 'titik merah harus punya gaya sendiri');
  assert.ok(css.includes('.accountactivity-dot{margin-left:auto;flex:none;width:8px;height:8px;border-radius:50%;background:#ff5a5a;'), 'titik merah harus berupa bulatan merah kecil di ujung menu');
  assert.ok(css.includes('@media(max-width:820px){.sidebar:not(.is-open) .accountactivity-dot{position:absolute;top:5px;right:5px;margin-left:0}}'), 'titik merah harus tetap terlihat saat sidebar menciut di HP');
});

test('Aktivitas Akun diperbarui realtime tiap 15 detik saat halamannya dibuka', () => {
  assert.ok(appJs.includes('function startAccountActivityPolling()'), 'harus ada polling Aktivitas Akun');
  assert.ok(appJs.includes("if (activeWorkspacePage === 'accountactivity' && document.visibilityState === 'visible') void loadAccountActivity();"), 'polling harus berjalan tiap 15 detik saat halaman Aktivitas Akun dibuka');
  assert.ok(appJs.includes("if (page === 'accountactivity') {\n    void loadAccountActivity();\n    startAccountActivityPolling();\n  }"), 'membuka Aktivitas Akun harus langsung memuat daftar');
});

test('setiap baris Rank Bot menampilkan status pemilik dan status bot WhatsApp realtime', () => {
  assert.ok(appJs.includes("statusLine.className = 'rankbot-status';"), 'setiap baris Rank Bot harus punya baris status');
  assert.ok(appJs.includes("ownerItem.append(createMemberIcon('user'));"), 'status pemilik harus memakai ikon orang SVG');
  assert.ok(appJs.includes("`Pemilik · ${ownerActive ? 'Aktif' : 'Tidak Aktif'}`"), 'status pemilik harus berbunyi Pemilik · Aktif atau Pemilik · Tidak Aktif');
  assert.ok(appJs.includes("ownerActive = Boolean(user.panelActive);") || appJs.includes('const ownerActive = Boolean(user.panelActive);'), 'status pemilik harus dibaca dari panelActive /api/members');
  assert.ok(appJs.includes("botItem.append(createMemberIcon('whatsapp'));"), 'status bot harus memakai ikon WhatsApp SVG');
  assert.ok(appJs.includes("`Bot WhatsApp · ${botState === 'running' ? 'Berjalan' : botState === 'waiting' ? 'Menunggu' : 'Berhenti'}`"), 'status bot harus berbunyi Bot WhatsApp · Berjalan/Menunggu/Berhenti');
  assert.ok(appJs.includes("user.workerStatus === 'running' ? 'running' : user.workerStatus === 'waiting' ? 'waiting' : 'stopped'"), 'status bot harus dibaca dari workerStatus /api/members');
  assert.ok(appJs.includes("identity.append(nameRow, handle, modeChip, statsLine, statusLine);"), 'baris status harus berada di bawah statistik peringkat');
  assert.ok(css.includes('.rankbot-status{'), 'baris status Rank Bot harus punya gaya sendiri');
  assert.ok(css.includes('.rankbot-status-item.is-active{'), 'status aktif/berjalan harus berwarna hijau');
  assert.ok(css.includes('.rankbot-status-item.is-waiting{'), 'status menunggu harus berwarna kuning');
  assert.ok(css.includes('.rankbot-status-item.is-muted{'), 'status tidak aktif/berhenti harus berwarna redup');
  assert.ok(css.includes('@media(max-width:560px){.accountactivity-item{gap:10px;padding:10px 10px}'), 'di HP baris Aktivitas Akun harus makin ringkas agar muat');
});

test('server: /api/members mengembalikan waktu login terakhir tiap akun', () => {
  assert.match(serverJs, /const last = \(store\.loginHistory \|\| \[\]\)\.filter\(\(entry\) => entry\.userId === item\.id\)\.at\(-1\);/, 'handler /api/members harus membaca riwayat login terakhir tiap akun');
  assert.match(serverJs, /lastLoginAt: last\?\.createdAt \|\| null,/, '/api/members harus mengembalikan lastLoginAt tiap akun');
});

test('versi aset baru terpasang supaya kedua halaman benar-benar sampai ke HP', () => {
  assert.ok(html.includes('/app.js?v=ikon-mata-sandi-baru-20261128'), 'app.js harus memakai ?v=ikon-mata-sandi-baru-20261128');
  assert.ok(html.includes('/style.css?v=ikon-mata-sandi-baru-20261128'), 'style.css harus memakai ?v=ikon-mata-sandi-baru-20261128');
});

test('entri Info Update status Rank Bot dan halaman Aktivitas Akun kini di posisi kedua puluh', () => {
  const data = JSON.parse(read('public/info-updates.json'));
  assert.equal(data.updatedAt, '2026-11-28T00:04:00+07:00', 'updatedAt harus sama dengan waktu entri terbaru');
  assert.equal(data.updates.length, 121, 'daftar harus bertambah lima entri');
  const newest = data.updates[0];
  assert.equal(newest.title, 'Kolom sandi baru kini ada ikon mata dan cek kecocokan realtime', 'entri terbaru harus soal batas 10 detik indikator mengetik');
  assert.equal(newest.tag, 'Fitur baru', 'entri terbaru harus bertag Perubahan');
  assert.equal(newest.day, 'Sabtu, 28 Nov 2026', 'hari entri terbaru harus cocok');
  assert.equal(newest.time, '00.04 WIB', 'waktu entri terbaru harus cocok');
  const status = data.updates[54];
  assert.equal(status.title, 'Status pemilik & bot di Rank Bot, plus halaman Aktivitas Akun', 'entri status Rank Bot kini di posisi kedua puluh');
  assert.equal(status.tag, 'Fitur baru', 'entri status Rank Bot harus bertag Bug');
  assert.equal(status.time, '19.46 WIB', 'waktu entri status Rank Bot harus cocok');
  assert.ok(status.description.includes('Pemilik · Aktif'), 'entri harus menjelaskan status pemilik di Rank Bot');
  assert.ok(status.description.includes('Bot WhatsApp · Berjalan'), 'entri harus menjelaskan status bot di Rank Bot');
  assert.ok(status.description.includes('Aktivitas Akun'), 'entri harus menjelaskan halaman Aktivitas Akun');
  assert.ok(status.description.includes('Pemilik Login Ke Web'), 'entri harus menjelaskan baris waktu login di halaman Aktivitas Akun');
  assert.ok(status.description.includes('Baris akun sendiri kini selalu paling atas dengan lencana Kamu'), 'entri harus menjelaskan baris sendiri paling atas di Aktivitas Akun');
  assert.ok(status.description.includes('pemilik yang sedang aktif di panel'), 'entri harus menjelaskan pemilik aktif di atas sisanya');
  assert.ok(status.description.includes('titik merah'), 'entri harus menjelaskan titik merah menu saat ada login baru');
  assert.ok(status.description.includes('Admin Utama emas'), 'entri harus menjelaskan warna peran Admin Utama');
  assert.ok(status.description.includes('Pagi'), 'entri harus menjelaskan label Pagi/Siang/Sore/Malam di waktu login');
  assert.ok(status.description.includes('selalu menunjukkan jam saat ini, bukan jam login autentikasinya yang sudah lama'), 'entri harus menjelaskan jam yang tampil adalah aktivitas web terbaru');
  assert.ok(html.includes('<h4>Status pemilik &amp; bot di Rank Bot, plus halaman Aktivitas Akun</h4>'), 'fallback harus memuat judul entri status Rank Bot');
  assert.ok(html.includes('Pemilik Login Ke Web'), 'fallback harus memuat baris waktu login');
});

function fixtureUser(username, email, role, password) {
  const salt = randomBytes(16).toString('hex');
  const passwordHash = scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex');
  return { id: randomUUID(), username, email, displayName: username, avatar: 'avatar-01', role, salt, passwordHash, verified: true, createdAt: new Date().toISOString() };
}

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function jsonRequest(base, route, { method = 'GET', body, cookie } = {}) {
  const headers = { Origin: base, Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`${base}${route}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5000),
  });
  const payload = await response.json();
  return { status: response.status, payload, cookie: response.headers.get('set-cookie')?.split(';')[0] || null };
}

test('server: /api/members mengembalikan lastLoginAt dari riwayat login dan panelActive dari sesi yang hidup', { timeout: 60_000 }, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'readsw-account-activity-test-'));
  const root = path.join(temp, 'project');
  const dataDir = path.join(root, 'runtime-data');
  const adminPassword = 'FixtureAdmin-Only-Password!';
  const memberPassword = 'FixtureMember-Only-Password!';
  const secret = randomBytes(48).toString('base64url');
  let child;
  try {
    await mkdir(root, { recursive: true });
    await cp(path.join(repoRoot, 'server'), path.join(root, 'server'), { recursive: true });
    await cp(path.join(repoRoot, 'public'), path.join(root, 'public'), { recursive: true });
    await cp(path.join(repoRoot, 'package.json'), path.join(root, 'package.json'));
    await symlink(path.join(repoRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir');
    await mkdir(dataDir, { recursive: true });
    const admin = fixtureUser('fixtureadmin', 'fixtureadmin@example.test', 'admin', adminPassword);
    const member = fixtureUser('fixturemember', 'fixturemember@example.test', 'member', memberPassword);
    await writeFile(path.join(dataDir, 'store.json'), JSON.stringify({
      users: [admin, member], pendingRegistrations: [], bots: [], sessions: [], pairingLogs: [],
      loginHistory: [{ id: randomUUID(), userId: member.id, sid: null, ip: '127.0.0.1', userAgent: 'test', device: 'unknown', createdAt: '2026-11-18T06:00:00.000Z' }],
    }));

    const port = await unusedPort();
    const base = `http://127.0.0.1:${port}`;
    const env = {
      ...process.env,
      HOST: '127.0.0.1', PORT: String(port), PANEL_DATA_DIR: 'runtime-data', SESSION_SECRET: secret, NODE_ENV: 'test',
    };
    child = spawn(process.execPath, [path.join(root, 'server/index.js')], { cwd: root, env, stdio: 'ignore' });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`fixture server exited with code ${child.exitCode}`);
      try {
        const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) });
        if (response.ok) { ready = true; break; }
      } catch { /* Wait briefly for local fixture startup. */ }
      await wait(100);
    }
    assert.equal(ready, true, 'isolated fixture server should start');

    const unauthenticated = await jsonRequest(base, '/api/members');
    assert.equal(unauthenticated.status, 401, '/api/members harus menolak tanpa login');
    const adminLogin = await jsonRequest(base, '/api/auth/login', { method: 'POST', body: { identifier: 'fixtureadmin', password: adminPassword } });
    assert.equal(adminLogin.status, 200, 'admin fixture harus bisa login');
    const members = await jsonRequest(base, '/api/members', { cookie: adminLogin.cookie });
    assert.equal(members.status, 200, 'admin harus bisa membaca /api/members');
    const byName = Object.fromEntries(members.payload.users.map((item) => [item.username, item]));
    assert.equal(byName.fixturemember.lastLoginAt, '2026-11-18T06:00:00.000Z', 'member dengan riwayat login harus mengembalikan waktu login terakhirnya');
    assert.equal(byName.fixturemember.panelActive, false, 'member yang tidak punya sesi hidup harus tertulis tidak aktif');
    assert.equal(byName.fixturemember.workerStatus, 'stopped', 'member tanpa worker harus tertulis berhenti');
    assert.ok(byName.fixtureadmin.lastLoginAt, 'admin yang baru login harus punya waktu login terakhir');
    assert.ok(Math.abs(Date.parse(byName.fixtureadmin.lastLoginAt) - Date.now()) < 60_000, 'waktu login admin harus baru saja (dari login di tes ini)');
    assert.equal(byName.fixtureadmin.panelActive, true, 'admin yang baru login harus tertulis aktif');
    assert.equal(byName.fixtureadmin.workerStatus, 'stopped', 'admin tanpa worker harus tertulis berhenti');
    const heartbeat = await jsonRequest(base, '/api/me/heartbeat', { method: 'POST', body: {}, cookie: adminLogin.cookie });
    assert.equal(heartbeat.status, 200, 'heartbeat harus menjawab');
    assert.equal(heartbeat.payload.latestLoginAt, '2026-11-18T06:00:00.000Z', 'heartbeat harus mengembalikan login terbaru akun lain (bukan login diri sendiri)');
  } finally {
    if (child && child.exitCode === null) child.kill('SIGTERM');
    await fs.promises.rm(temp, { recursive: true, force: true });
  }
});

test('server: /api/members meneruskan avatar unggahan dan /api/admin/user-avatar mengembalikannya', { timeout: 60_000 }, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'readsw-account-activity-avatar-test-'));
  const root = path.join(temp, 'project');
  const dataDir = path.join(root, 'runtime-data');
  const adminPassword = 'FixtureAdmin-Only-Password!';
  const memberPassword = 'FixtureMember-Only-Password!';
  const secret = randomBytes(48).toString('base64url');
  let child;
  try {
    await mkdir(root, { recursive: true });
    await cp(path.join(repoRoot, 'server'), path.join(root, 'server'), { recursive: true });
    await cp(path.join(repoRoot, 'public'), path.join(root, 'public'), { recursive: true });
    await cp(path.join(repoRoot, 'package.json'), path.join(root, 'package.json'));
    await symlink(path.join(repoRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir');
    await mkdir(dataDir, { recursive: true });
    const admin = fixtureUser('fixtureadmin', 'fixtureadmin@example.test', 'admin', adminPassword);
    admin.avatar = 'uploaded';
    admin.avatarMime = 'image/png';
    admin.avatarUpdatedAt = new Date().toISOString();
    const member = fixtureUser('fixturemember', 'fixturemember@example.test', 'member', memberPassword);
    await writeFile(path.join(dataDir, 'store.json'), JSON.stringify({
      users: [admin, member], pendingRegistrations: [], bots: [], sessions: [], pairingLogs: [], loginHistory: [],
    }));
    // Foto unggahan admin di folder kanonis akunnya.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    await mkdir(path.join(root, 'DATA_AKUN', 'ADMIN', 'fixtureadmin'), { recursive: true });
    await writeFile(path.join(root, 'DATA_AKUN', 'ADMIN', 'fixtureadmin', 'avatar.upload'), png);

    const port = await unusedPort();
    const base = `http://127.0.0.1:${port}`;
    const env = {
      ...process.env,
      HOST: '127.0.0.1', PORT: String(port), PANEL_DATA_DIR: 'runtime-data', SESSION_SECRET: secret, NODE_ENV: 'test',
    };
    child = spawn(process.execPath, [path.join(root, 'server/index.js')], { cwd: root, env, stdio: 'ignore' });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`fixture server exited with code ${child.exitCode}`);
      try {
        const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) });
        if (response.ok) { ready = true; break; }
      } catch { /* Wait briefly for local fixture startup. */ }
      await wait(100);
    }
    assert.equal(ready, true, 'isolated fixture server should start');

    const adminLogin = await jsonRequest(base, '/api/auth/login', { method: 'POST', body: { identifier: 'fixtureadmin', password: adminPassword } });
    assert.equal(adminLogin.status, 200, 'admin fixture harus bisa login');
    const members = await jsonRequest(base, '/api/members', { cookie: adminLogin.cookie });
    assert.equal(members.status, 200, 'admin harus bisa membaca /api/members');
    const byName = Object.fromEntries(members.payload.users.map((item) => [item.username, item]));
    assert.equal(byName.fixtureadmin.avatar, 'uploaded', '/api/members harus meneruskan avatar unggahan, bukan avatar-01');
    assert.ok(byName.fixtureadmin.avatarUpdatedAt, '/api/members harus mengembalikan avatarUpdatedAt');
    assert.equal(byName.fixturemember.avatar, 'avatar-01', 'member preset harus tetap avatar-01');

    const avatarResponse = await fetch(`${base}/api/admin/user-avatar?userId=${encodeURIComponent(admin.id)}`, { headers: { Cookie: adminLogin.cookie }, signal: AbortSignal.timeout(5000) });
    assert.equal(avatarResponse.status, 200, 'admin harus bisa memuat foto unggahan akun lain');
    assert.equal(avatarResponse.headers.get('content-type'), 'image/png', 'foto unggahan harus dikembalikan sebagai PNG');
    assert.deepEqual(Buffer.from(await avatarResponse.arrayBuffer()), png, 'isi foto unggahan harus sama dengan yang diunggah');

    const memberLogin = await jsonRequest(base, '/api/auth/login', { method: 'POST', body: { identifier: 'fixturemember', password: memberPassword } });
    assert.equal(memberLogin.status, 200, 'member fixture harus bisa login');
    const memberAvatar = await fetch(`${base}/api/admin/user-avatar?userId=${encodeURIComponent(admin.id)}`, { headers: { Cookie: memberLogin.cookie }, signal: AbortSignal.timeout(5000) });
    assert.equal(memberAvatar.status, 200, 'member juga harus bisa memuat foto unggahan akun lain');
    assert.equal(memberAvatar.headers.get('content-type'), 'image/png', 'member harus menerima foto unggahan sebagai PNG');
    assert.deepEqual(Buffer.from(await memberAvatar.arrayBuffer()), png, 'member harus menerima isi foto yang sama');

    // Member juga bisa mengunggah foto profilnya sendiri di akunnya.
    const memberUpload = await fetch(`${base}/api/me/avatar`, { method: 'POST', body: png, headers: { Cookie: memberLogin.cookie, 'Content-Type': 'image/png' }, signal: AbortSignal.timeout(5000) });
    assert.equal(memberUpload.status, 200, 'member harus bisa mengunggah foto profilnya sendiri');
    const memberUploadPayload = await memberUpload.json();
    assert.equal(memberUploadPayload.user.avatar, 'uploaded', 'foto member harus tercatat sebagai unggahan');
    const membersAfterUpload = await jsonRequest(base, '/api/members', { cookie: memberLogin.cookie });
    const byNameAfterUpload = Object.fromEntries(membersAfterUpload.payload.users.map((item) => [item.username, item]));
    assert.equal(byNameAfterUpload.fixturemember.avatar, 'uploaded', 'foto unggahan member harus diteruskan /api/members');
    const memberOwnAvatar = await fetch(`${base}/api/admin/user-avatar?userId=${encodeURIComponent(member.id)}`, { headers: { Cookie: adminLogin.cookie }, signal: AbortSignal.timeout(5000) });
    assert.equal(memberOwnAvatar.status, 200, 'foto unggahan member harus bisa dimuat akun lain');
  } finally {
    if (child && child.exitCode === null) child.kill('SIGTERM');
    await fs.promises.rm(temp, { recursive: true, force: true });
  }
});
