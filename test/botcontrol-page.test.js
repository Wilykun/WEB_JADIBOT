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
  assert.ok(appJs.includes("showToast('Kontrol Bot hanya untuk admin.')"), 'klik nav Kontrol Bot yang terkunci harus menampilkan pesan hanya untuk admin');
});

test('kartu Kontrol Bot memakai aturan yang sama dengan server: admin biasa tidak bisa mengontrol Admin Utama', () => {
  assert.match(appJs, /const canManageTarget = currentUser\?\.role === 'admin'\s*\n\s*&& \(user\.role !== 'admin' \|\| \(currentUser\.isMainAdmin === true && user\.isMainAdmin !== true\)\)/, 'aturan kelola target harus sama dengan halaman Member');
  assert.ok(appJs.includes('Akun Admin Utama tidak dapat dikontrol dari sini'), 'kartu Admin Utama harus menjelaskan bahwa ia tidak bisa dikontrol dari sini');
  assert.ok(appJs.includes("data-botcontrol-action"), 'tombol aksi Kontrol Bot harus memakai data-botcontrol-action');
  for (const action of ['bot-start', 'bot-restart', 'bot-stop', 'bot-session-delete']) {
    assert.ok(appJs.includes(`'${action}'`), `aksi ${action} harus ada di panel kontrol`);
  }
  assert.match(appJs, /api\('\/api\/admin\/users\/bot'/, 'aksi bot harus memanggil endpoint admin yang sama dengan halaman Member');
  assert.match(appJs, /api\('\/api\/admin\/users\/session\/delete'/, 'hapus sesi harus memanggil endpoint hapus sesi admin');
  assert.match(appJs, /body: JSON\.stringify\(\{ userId, confirm: true \}\)/, 'hapus sesi harus mengirim konfirmasi eksplisit');
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

test('entri Info Update terbaru menjelaskan halaman Kontrol Bot', () => {
  const newest = infoUpdates.updates[0];
  assert.equal(newest.title, 'Halaman Kontrol Bot untuk admin');
  assert.equal(newest.tag, 'Fitur baru');
  assert.match(newest.description, /Admin Utama dan admin biasa/);
  assert.match(newest.description, /admin biasa tidak bisa mengontrol Admin Utama/);
  assert.match(newest.description, /Nyalakan bot|Restart bot|Matikan bot|Hapus sesi/);
  assert.equal(infoUpdates.updatedAt, '2026-11-17T13:30:00+07:00', 'updatedAt harus sama dengan waktu entri terbaru');
  assert.ok(html.includes('data-tag="fitur-baru"') && html.includes('Halaman Kontrol Bot untuk admin'), 'fallback HTML Info Update harus memuat entri Kontrol Bot');
});
