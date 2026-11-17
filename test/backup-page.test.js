import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { createPlainBackupZip } from '../server/admin-backup.js';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
const appJs = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const backupJs = fs.readFileSync(new URL('../server/admin-backup.js', import.meta.url), 'utf8');

test('Backup & pemulihan hidup di halaman sendiri, bukan lagi di halaman Member', () => {
  const backupSection = html.match(/<section id="backup"[^>]*>/);
  assert.ok(backupSection, 'harus ada section #backup');
  assert.match(backupSection[0], /data-page-view="backup"/, '#backup harus punya data-page-view="backup" supaya router menampilkannya');
  assert.match(backupSection[0], /class="[^"]*hidden/, '#backup harus hidden secara default — baru dibuka untuk admin saat login');
  const backupIndex = html.indexOf('<section id="backup"');
  const backupAreaIndex = html.indexOf('id="admin-backup-area"');
  const adminIndex = html.indexOf('<section id="admin"');
  const adminClose = html.indexOf('</section>', adminIndex);
  assert.ok(backupIndex > adminClose, '#backup harus berada setelah section #admin ditutup, bukan di dalamnya');
  assert.ok(backupAreaIndex > backupIndex, '#admin-backup-area harus berada di dalam #backup');
  assert.ok(!(backupAreaIndex > adminIndex && backupAreaIndex < adminClose), '#admin-backup-area tidak boleh lagi berada di dalam #admin (halaman Member)');
  assert.ok(html.includes('aria-labelledby="admin-backup-title"'), '#backup harus menunjuk ke judul Backup & pemulihan');
});

test('menu sidebar punya item Backup setelah Member, dengan lencana Terkunci untuk member', () => {
  const nav = html.match(/<a id="backup-nav"[^>]*>/);
  assert.ok(nav, 'harus ada nav item #backup-nav');
  assert.match(nav[0], /href="#backup"/, 'nav Backup harus menunjuk ke #backup');
  assert.match(nav[0], /class="[^"]*hidden/, 'nav Backup harus hidden secara default — baru ditampilkan saat login');
  const memberNav = html.indexOf('id="admin-nav"');
  const backupNav = html.indexOf('id="backup-nav"');
  assert.ok(backupNav > memberNav, 'nav Backup harus berada setelah nav Member di sidebar');
  assert.ok(html.includes('>Backup<span class="nav-lock"'), 'nav Backup harus berlabel Backup dengan lencana Terkunci');
  const lock = html.match(/<span class="nav-lock"[^>]*>([\s\S]*?)<\/span>/);
  assert.ok(lock, 'lencana Terkunci harus ada di nav Backup');
  assert.match(lock[1], /<svg[^>]*viewBox="0 0 24 24"/, 'lencana Terkunci harus punya ikon gembok SVG');
  assert.ok(lock[1].includes('Terkunci'), 'lencana Terkunci harus bertuliskan Terkunci');
});

test('judul halaman Backup terdaftar di router supaya breadcrumb dan deep-link jalan', () => {
  assert.match(appJs, /backup:\s*'Backup & pemulihan'/, 'workspacePageTitles harus memuat backup: Backup & pemulihan');
});

test('judul halaman Backup punya ikon SVG unduh yang sesuai konteks', () => {
  assert.ok(html.includes('class="admin-backup-page-icon"'), 'judul Backup harus punya wadah ikon .admin-backup-page-icon');
  const icon = html.match(/<span class="admin-backup-page-icon"[^>]*>([\s\S]*?)<\/span>/);
  assert.ok(icon, 'ikon Backup harus ada di HTML');
  assert.match(icon[1], /<svg[^>]*viewBox="0 0 24 24"/, 'ikon Backup harus SVG inline 24x24');
  assert.match(icon[1], /M12 3v11/, 'ikon Backup harus bergambar panah unduh ke bawah');
  assert.ok(html.includes('class="admin-backup-heading-copy"'), 'ikon dan judul harus dibungkus .admin-backup-heading-copy supaya rapi di desktop dan mobile');
});

test('seluruh gaya backup kini memakai scope #backup, bukan #admin', () => {
  assert.ok(css.includes('#backup .admin-backup-card{'), 'kartu backup harus memakai scope #backup');
  assert.ok(!css.includes('#admin .admin-backup-card'), 'tidak boleh ada lagi gaya backup di scope #admin — area backup sudah pindah halaman');
  assert.ok(!css.includes('#admin .admin-backup-heading'), 'gaya judul backup tidak boleh lagi di scope #admin');
  assert.ok(css.includes('#backup .admin-backup-page-icon{'), 'ikon halaman Backup harus punya gaya dasar');
  assert.match(css, /#backup \.admin-backup-page-icon svg\{[^}]*width:\s*24px/, 'SVG ikon Backup harus 24px');
  assert.match(css, /#backup \.admin-backup-heading-copy\{flex-direction:\s*column;align-items:\s*center/, 'di layar kecil (<=560px) ikon harus menumpuk di atas judul yang rata tengah');
});

test('halaman Backup hanya dibuka admin: menu terlihat tapi terkunci untuk member, seksi disembunyikan', () => {
  // Menu Backup kini terlihat untuk semua akun yang login, tapi terkunci untuk member; isi halamannya tetap disembunyikan total.
  assert.match(appJs, /backupNav\?\.classList\.remove\('hidden'\)/, 'showDashboard/loadAdminUsers harus menampilkan nav Backup untuk semua akun yang login');
  assert.match(appJs, /backupNav\?\.classList\.toggle\('nav-item-locked', !isAdmin\)/, 'nav Backup harus dikunci (nav-item-locked) untuk member');
  assert.match(appJs, /backupNav\?\.setAttribute\('aria-disabled', String\(!isAdmin\)\)/, 'nav Backup yang terkunci harus ditandai aria-disabled');
  assert.match(appJs, /document\.querySelector\('#backup'\)\?\.classList\.toggle\('hidden', !isAdmin\)/, 'showDashboard/loadAdminUsers harus menyembunyikan seksi Backup untuk member');
  assert.ok(appJs.includes("if (page === 'backup')"), 'setWorkspacePage harus punya hook khusus halaman backup');
  assert.match(appJs, /\(page === 'backup' && currentUser\?\.role !== 'admin'\)/, 'setWorkspacePage harus menolak halaman Backup untuk member lewat peran, bukan hanya lewat menu yang tersembunyi');
  assert.match(appJs, /if \(page === 'backup'\) \{[\s\S]*?loadAdminBackupTelegramStatus\(\)/, 'membuka halaman Backup harus memuat ulang status Telegram');
  assert.match(appJs, /if \(page === 'backup'\) \{[\s\S]*?loadAdminBackupSnapshots\(\)/, 'membuka halaman Backup harus memuat ulang restore point');
  // Klik menu Backup yang terkunci harus memberi tahu bahwa fitur ini hanya untuk admin, bukan diam-diam mengalihkan.
  assert.match(appJs, /item\.id === 'backup-nav' && item\.classList\.contains\('nav-item-locked'\)/, 'klik nav Backup yang terkunci harus dicegat');
  assert.match(appJs, /showToast\('Backup hanya untuk admin\.'\)/, 'klik nav Backup yang terkunci harus menampilkan pesan Backup hanya untuk admin');
});

test('lencana Terkunci hanya tampil saat nav dikunci dan disembunyikan di rel ikon tertutup', () => {
  assert.match(css, /\.nav-lock\{[^}]*display:\s*none/, 'lencana Terkunci harus tersembunyi secara default');
  assert.match(css, /\.nav-item-locked \.nav-lock\{display:\s*inline-flex\}/, 'lencana Terkunci harus tampil saat nav dikunci (Backup, Kontrol Bot, dan menu terkunci lain)');
  assert.match(css, /\.nav-item-locked\{[^}]*opacity:\s*\.6/, 'nav yang terkunci harus tampak redup');
  assert.match(css, /\.nav-item-locked\{[^}]*cursor:\s*not-allowed/, 'nav yang terkunci harus berkursor tidak bisa diklik');
  assert.match(css, /\.sidebar:not\(\.is-open\) \.nav-lock\{display:\s*none\}/, 'di rel ikon tertutup, lencana Terkunci harus disembunyikan');
  assert.match(css, /html\[data-theme="light"\] \.nav-lock\{/, 'lencana Terkunci harus punya gaya tema terang');
});

function plainZipCompressedSize(archive) {
  const end = archive.length - 22;
  assert.equal(archive.readUInt32LE(end), 0x06054b50);
  const total = archive.readUInt16LE(end + 10);
  const directoryOffset = archive.readUInt32LE(end + 16);
  let size = 0;
  let cursor = directoryOffset;
  for (let i = 0; i < total; i += 1) {
    assert.equal(archive.readUInt32LE(cursor), 0x02014b50);
    assert.equal(archive.readUInt16LE(cursor + 10), 8, 'entri ZIP backup langsung harus memakai metode DEFLATE (8) supaya bisa dibuka aplikasi bawaan HP');
    size += archive.readUInt32LE(cursor + 20);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return size;
}

test('ZIP backup langsung memakai DEFLATE level 9 dan lebih kecil dari level 6', () => {
  assert.match(backupJs, /deflateRawSync\(data, \{ level: 9 \}\)/, 'zipDeflated harus memakai level 9');
  assert.doesNotMatch(backupJs, /deflateRawSync\(data, \{ level: 6 \}\)/, 'tidak boleh ada lagi level 6 di zipDeflated');
  // Data backup asli itu bervariasi (nama, email, kunci sesi, runtime), bukan satu objek yang diulang — di data seragam level 9 justru bisa sedikit lebih besar, jadi uji pakai data bervariasi seperti aslinya.
  const varied = Array.from({ length: 400 }, (_, i) => ({ id: `u${i}`, username: `member${i}_${Math.random().toString(36).slice(2, 10)}`, email: `user${i}@gmail.com`, createdAt: new Date(2026, 10, 16, 8, i % 60).toISOString(), session: `BAK${Math.random().toString(36).slice(2, 18)}${Math.random().toString(36).slice(2, 18)}`, runtime: (i * 217) % 86400 }));
  const repeated = JSON.stringify(varied);
  const payload = {
    files: [{ path: 'panel/store.json', data: Buffer.from(repeated, 'utf8').toString('base64') }],
    sessionSecret: 'rahasia-sesi-uji',
  };
  const archive = createPlainBackupZip(payload);
  assert.equal(archive.readUInt32LE(0), 0x04034b50);
  const level9Size = plainZipCompressedSize(archive);
  const level6Size = deflateRawSync(Buffer.from(repeated, 'utf8'), { level: 6 }).length
    + deflateRawSync(Buffer.from('rahasia-sesi-uji', 'utf8'), { level: 6 }).length;
  assert.ok(level9Size <= level6Size, `ZIP level 9 (${level9Size} byte) harus tidak lebih besar dari level 6 (${level6Size} byte) untuk data JSON yang berulang`);
  assert.ok(level9Size < level6Size, `ZIP level 9 (${level9Size} byte) harus lebih kecil dari level 6 (${level6Size} byte) untuk data JSON yang berulang`);
  const firstEntryData = archive.subarray(30 + 'panel/store.json'.length, 30 + 'panel/store.json'.length + archive.readUInt32LE(18));
  assert.equal(inflateRawSync(firstEntryData).toString('utf8'), repeated, 'ZIP level 9 harus tetap bisa dibuka dan isinya utuh');
});
