import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const appJs = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
const infoUpdates = JSON.parse(fs.readFileSync(new URL('../public/info-updates.json', import.meta.url), 'utf8'));

test('menu Kontrol Bot ada di grup Admin dengan lencana Terkunci untuk member', () => {
  assert.ok(html.includes('id="botcontrol-nav" class="nav-item hidden" href="#botcontrol"'), 'nav Kontrol Bot harus hidden secara default dan menunjuk ke #botcontrol');
  assert.ok(html.includes('id="botcontrol-nav"'), 'nav Kontrol Bot harus ada');
  const nav = html.match(/id="botcontrol-nav"[^>]*>([\s\S]*?)<\/a>/);
  assert.ok(nav, 'nav Kontrol Bot harus bisa dibaca');
  assert.match(nav[1], /Kontrol Bot/, 'nav Kontrol Bot harus bernama Kontrol Bot');
  assert.match(nav[1], /nav-lock/, 'nav Kontrol Bot harus punya lencana Terkunci seperti Backup');
  assert.match(nav[1], /Terkunci/, 'lencana nav Kontrol Bot harus bertuliskan Terkunci');
  assert.match(nav[1], /<svg[^>]*viewBox="0 0 24 24"/, 'ikon nav Kontrol Bot harus SVG sesuai konteks, bukan huruf biasa');
});

test('halaman Kontrol Bot punya pencarian dan pil kategori seperti halaman Member', () => {
  assert.ok(html.includes('id="botcontrol"'), 'seksi #botcontrol harus ada');
  assert.match(html, /<section id="botcontrol"[^>]*data-page-view="botcontrol"/, 'seksi Kontrol Bot harus terdaftar sebagai page view botcontrol');
  assert.ok(html.includes('id="botcontrol-search"'), 'pencarian Kontrol Bot harus ada');
  assert.ok(html.includes('data-botcontrol-filters'), 'pil kategori Kontrol Bot harus ada');
  for (const key of ['all', 'running', 'stopped', 'linked', 'inactive']) {
    assert.ok(html.includes(`data-botcontrol-filter="${key}"`), `pil kategori ${key} harus ada`);
    assert.ok(html.includes(`data-filter-count="${key}"`), `hitungan pil ${key} harus ada`);
  }
  assert.ok(html.includes('id="botcontrol-users"'), 'daftar bot Kontrol Bot harus ada');
  assert.ok(html.includes('id="botcontrol-filter-empty"'), 'pesan kosong filter Kontrol Bot harus ada');
  assert.ok(html.includes('id="botcontrol-updated"'), 'penanda waktu pembaruan Kontrol Bot harus ada');
});

test('halaman Kontrol Bot dijaga perannya seperti Backup: member tidak bisa membukanya', () => {
  assert.match(appJs, /botcontrol: 'Kontrol Bot'/, 'judul halaman Kontrol Bot harus terdaftar di workspacePageTitles');
  assert.match(appJs, /\(page === 'botcontrol' && currentUser\?\.role !== 'admin'\)/, 'setWorkspacePage harus mengalihkan member yang membuka #botcontrol');
  assert.match(appJs, /botControlNav\?\.classList\.toggle\('nav-item-locked', !isAdmin\)/, 'nav Kontrol Bot harus terkunci untuk member');
  assert.match(appJs, /document\.querySelector\('#botcontrol'\)\?\.classList\.toggle\('hidden', !isAdmin\)/, 'isi halaman Kontrol Bot harus disembunyikan total untuk member');
  assert.match(appJs, /item\.id === 'botcontrol-nav' && item\.classList\.contains\('nav-item-locked'\)/, 'klik nav Kontrol Bot yang terkunci harus dicegat');
  assert.ok(appJs.includes("showLockedNotice('Kontrol Bot')"), 'klik nav Kontrol Bot yang terkunci harus menampilkan notifikasi di tengah layar');
});

test('kartu Kontrol Bot memakai aturan yang sama dengan server: Admin Utama bisa mengelola dirinya sendiri, admin biasa tidak bisa mengontrol Admin Utama', () => {
  assert.match(appJs, /const canManageTarget = currentUser\?\.role === 'admin'\s*\n\s*&& \(user\.isMainAdmin !== true \|\| currentUser\.isMainAdmin === true\)/, 'aturan kelola target harus sama dengan kebijakan kontrol bot di server');
  assert.ok(appJs.includes('Akun Admin Utama hanya bisa dikontrol oleh Admin Utama.'), 'kartu Admin Utama harus menjelaskan bahwa hanya Admin Utama yang bisa mengontrolnya');
  assert.ok(appJs.includes("data-botcontrol-action"), 'tombol aksi Kontrol Bot harus memakai data-botcontrol-action');
  for (const action of ['bot-start', 'bot-restart', 'bot-stop', 'bot-session-delete']) {
    assert.ok(appJs.includes(`'${action}'`), `aksi ${action} harus ada di panel kontrol`);
  }
  assert.match(appJs, /api\('\/api\/admin\/users\/bot'/, 'aksi bot harus memanggil endpoint admin yang sama dengan halaman Member');
  assert.match(appJs, /api\('\/api\/admin\/users\/session\/delete'/, 'hapus sesi harus memanggil endpoint hapus sesi admin');
  assert.match(appJs, /body: JSON\.stringify\(\{ userId, confirm: true \}\)/, 'hapus sesi harus mengirim konfirmasi eksplisit');
});

test('daftar Kontrol Bot dipisah Admin dan Member, bot jalan dengan runtime terbaru di atas, teks spoiler rata tengah', () => {
  assert.match(appJs, /const groups = \[\s*\n\s*\{ key: 'admin', title: 'Admin', users: sortAdminUsersByRuntime\(users\.filter\(\(user\) => user\.role === 'admin'\)\) \},/, 'daftar Kontrol Bot harus memakai pemisah Admin seperti halaman Member');
  assert.match(appJs, /\{ key: 'member', title: 'Member', users: sortAdminUsersByRuntime\(users\.filter\(\(user\) => user\.role !== 'admin'\)\) \}/, 'daftar Kontrol Bot harus memakai pemisah Member seperti halaman Member');
  assert.match(appJs, /groupSection\.className = 'member-account-group'/, 'pemisah kelompok harus memakai gaya yang sama dengan halaman Member');
  assert.match(appJs, /groupHeading\.className = 'member-account-group-heading'/, 'judul pemisah harus memakai gaya yang sama dengan halaman Member');
  assert.match(appJs, /groupSection\.toggleAttribute\('hidden', !groupVisible\)/, 'pemisah kelompok harus hilang bila semua kartunya terfilter');
  assert.match(css, /#botcontrol \.member-admin-heading\{justify-content:center;text-align:center\}/, 'judul panel kontrol harus rata tengah');
  assert.match(css, /#botcontrol \.member-admin-note,#botcontrol \.member-admin-hint,#botcontrol \.member-admin-account-state\{text-align:center\}/, 'catatan panel kontrol harus rata tengah');
  assert.match(css, /#botcontrol \.botcontrol-settings-title,#botcontrol \.botcontrol-settings-note,#botcontrol \.botcontrol-field-label\{text-align:center\}/, 'judul dan label pengaturan harus rata tengah');
  assert.match(css, /#botcontrol \.botcontrol-mode-row,#botcontrol \.botcontrol-emoji-grid\{justify-content:center\}/, 'pil mode dan daftar emoji harus rata tengah');
});

test('spoiler kontrol bot membuka satu kartu dan menutup kartu lain secara otomatis', () => {
  assert.match(appJs, /let expandedBotControlUserId = null/, 'spoiler Kontrol Bot harus mengingat kartu yang sedang terbuka');
  assert.match(appJs, /expandedBotControlUserId = shouldOpen \? trigger\.dataset\.userId : null/, 'klik kartu harus membuka atau menutup spoiler-nya');
  assert.match(appJs, /botControlUsersList\.querySelectorAll\('\.member-account-item'\)\.forEach\(\(item\) => \{/, 'klik kartu harus memperbarui semua kartu lain');
  assert.match(appJs, /item\.classList\.toggle\('is-open', isOpen\)/, 'kartu lain harus tertutup saat satu kartu dibuka');
  assert.match(appJs, /if \(panel\) panel\.hidden = !isOpen;/, 'panel kartu lain harus disembunyikan saat satu kartu dibuka');
});

test('daftar Kontrol Bot dimuat dari endpoint admin yang sama dan diperbarui berkala', () => {
  assert.match(appJs, /async function loadBotControlUsers\(\)/, 'daftar Kontrol Bot harus dimuat lewat loadBotControlUsers');
  assert.match(appJs, /await api\('\/api\/admin\/users'\)/, 'daftar Kontrol Bot harus memakai data akun admin yang sama dengan halaman Member');
  assert.match(appJs, /function startBotControlUsersPolling\(\)/, 'daftar Kontrol Bot harus diperbarui berkala seperti daftar Member');
  assert.match(appJs, /activeWorkspacePage === 'botcontrol'/, 'polling Kontrol Bot hanya jalan saat halamannya sedang dibuka');
  assert.match(appJs, /if \(page === 'botcontrol'\) \{\s*\n\s*void loadBotControlUsers\(\);/, 'membuka halaman Kontrol Bot harus langsung memuat daftarnya');
});

test('gaya kartu Member dipakai ulang halaman Kontrol Bot lewat kelas bersama', () => {
  assert.ok(html.includes('class="profile-section member-page hidden" data-page-view="admin"'), 'halaman Member harus memakai kelas member-page agar gayanya tetap sama');
  assert.ok(html.includes('class="profile-section member-page hidden" data-page-view="botcontrol"'), 'halaman Kontrol Bot harus memakai kelas member-page yang sama');
  assert.match(css, /\.member-page \.member-account-item\{/, 'gaya kartu akun harus berlaku lewat kelas member-page, bukan hanya #admin');
  assert.match(css, /\.side-nav \.nav-icon svg\{/, 'ikon SVG di menu sidebar harus punya ukuran yang sama dengan ikon teks');
});

test('lencana Terkunci muncul di semua menu terkunci, bukan hanya Backup', () => {
  assert.match(css, /\.nav-item-locked \.nav-lock\{display:inline-flex\}/, 'aturan tampil lencana harus generik untuk semua menu terkunci');
  assert.doesNotMatch(css, /#backup-nav\.nav-item-locked \.nav-lock/, 'aturan tampil lencana tidak boleh hanya berlaku untuk Backup');
});

test('editor pengaturan fitur ada di dalam spoiler kartu yang bisa dikelola', () => {
  assert.match(appJs, /function buildBotControlSettings\(user, draft\)/, 'editor pengaturan fitur harus dibangun per kartu');
  assert.match(appJs, /const draft = botControlSettingsDrafts\.get\(userId\) \|\| normalizeBotControlSettings\(user\.botSettings\)/, 'editor harus memakai draf per akun supaya editan tidak hilang saat daftar diperbarui');
  assert.match(appJs, /adminPanel\.append\(heading, note, botActions, controlsNote, stateNote, settingsSection\)/, 'editor harus menempel di panel admin kartu yang bisa dikelola');
  assert.match(appJs, /\['readonly', 'Read Only'\]/, 'editor harus punya pilihan mode Read Only');
  assert.match(appJs, /\['readonly_readsw', 'ReadSW \+ ReactionSW'\]/, 'editor harus punya pilihan mode ReadSW + ReactionSW');
  assert.match(appJs, /pill\.dataset\.botcontrolMode = value/, 'pil mode harus membawa nilai modenya');
  assert.match(appJs, /data-botcontrol-online24/, 'editor harus punya tombol Online 24 Jam');
  assert.match(appJs, /botcontrol-delay-min/, 'editor harus punya pilihan delay minimum');
  assert.match(appJs, /botcontrol-delay-max/, 'editor harus punya pilihan delay maksimum');
  assert.match(appJs, /botcontrol-auto-reaction/, 'editor harus punya saklar reaksi emoji otomatis');
  assert.match(appJs, /botcontrol-emoji-grid/, 'editor harus punya daftar emoji reaksi');
  assert.match(appJs, /botcontrol-emoji-new/, 'editor harus punya kolom tambah emoji baru');
  assert.match(appJs, /data-botcontrol-settings-save/, 'editor harus punya tombol Simpan pengaturan');
  assert.match(css, /\.botcontrol-settings\{/, 'editor pengaturan fitur harus punya gaya sendiri');
  assert.match(css, /\.botcontrol-emoji-choice\.selected\{/, 'emoji aktif di editor harus terlihat terpilih');
  assert.match(css, /@media\(max-width:560px\)\{\.botcontrol-delay-row\{grid-template-columns:1fr\}/, 'editor harus menumpuk di layar HP');
});

test('pengaturan fitur disimpan lewat endpoint admin dengan aturan izin yang sama', () => {
  assert.match(appJs, /api\('\/api\/admin\/users\/bot-settings'/, 'simpan pengaturan harus memanggil endpoint admin bot-settings');
  assert.match(appJs, /method: 'PUT'/, 'simpan pengaturan harus memakai PUT');
  assert.match(appJs, /mode: draft\.mode, online24: draft\.online24, storySettings: \{/, 'simpan pengaturan harus mengirim mode, Online 24 Jam, dan preferensi story');
  assert.match(appJs, /autoReaction, delayMinSeconds: draft\.delayMinSeconds, delayMaxSeconds: draft\.delayMaxSeconds/, 'preferensi story harus berisi reaksi otomatis dan rentang delay');
  assert.match(appJs, /emojiOptions: draft\.emojiOptions, emojiPool: draft\.emojiPool/, 'preferensi story harus berisi daftar emoji dan emoji aktif');
  assert.match(appJs, /Pilih mode dulu: Read Only atau Read Only \+ ReadSW\./, 'simpan tanpa mode harus ditolak di sisi klien');
  assert.match(appJs, /Delay minimum harus kurang dari atau sama dengan delay maksimum\./, 'rentang delay terbalik harus ditolak di sisi klien');
});

test('urutan runtime: bot jalan terbaru di atas, bot berhenti di bawah', () => {
  // sortAdminUsersByRuntime dipakai halaman Member dan Kontrol Bot; jalankan
  // fungsi aslinya (bukan tiruan) dengan data buatan supaya urutannya terbukti.
  const match = appJs.match(/function sortAdminUsersByRuntime\(users\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'sortAdminUsersByRuntime harus ada di app.js');
  const sortAdminUsersByRuntime = new Function(`${match[0]}; return sortAdminUsersByRuntime;`)();
  const users = [
    { username: 'berhenti', workerStatus: 'stopped', workerStartedAt: null },
    { username: 'lama', workerStatus: 'running', workerStartedAt: 100 },
    { username: 'tanpa-waktu', workerStatus: 'running', workerStartedAt: null },
    { username: 'terbaru', workerStatus: 'running', workerStartedAt: 200 },
  ];
  const sorted = sortAdminUsersByRuntime(users).map((user) => user.username);
  assert.deepEqual(sorted, ['terbaru', 'lama', 'berhenti', 'tanpa-waktu']);
});

test('entri Info Update terbaru menjelaskan halaman Kontrol Bot', () => {
  const newest = infoUpdates.updates.find((entry) => entry.title === 'Halaman Kontrol Bot untuk admin');
  assert.ok(newest, 'entri Kontrol Bot harus ada di Info Update');
  assert.equal(newest.tag, 'Fitur baru');
  assert.match(newest.description, /Admin Utama kini bisa mengelola botnya sendiri/);
  assert.match(newest.description, /admin biasa tetap tidak bisa mengelola Admin Utama/);
  assert.match(newest.description, /bisa mengelola sesama admin biasa dan member/);
  assert.match(newest.description, /Admin Utama kini bisa mengelola botnya sendiri/);
  assert.match(newest.description, /Daftar akun dipisah Admin dan Member/);
  assert.match(newest.description, /bot yang jalan dengan runtime terbaru selalu di atas/);
  assert.match(newest.description, /tersimpan langsung ke DATA_AKUN akun yang diubah/);
  assert.match(newest.description, /Nyalakan bot|Restart bot|Matikan bot|Hapus sesi/);
  assert.match(newest.description, /Read Only, ReadSW \+ ReactionSW, Online 24 Jam/);
  assert.match(newest.description, /delay 1–20 detik serta emoji reaksi/);
  assert.equal(infoUpdates.updatedAt, '2026-11-23T05:05:44+07:00', 'updatedAt harus sama dengan waktu entri terbaru');
  assert.ok(html.includes('data-tag="fitur-baru"') && html.includes('Halaman Kontrol Bot untuk admin'), 'fallback HTML Info Update harus memuat entri Kontrol Bot');
});
