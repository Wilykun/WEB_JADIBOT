// Titik online di avatar halaman Member (ala Facebook): hijau bila pemilik
// akun sedang membuka panel (panelActive), tidak ada bila tidak aktif —
// realtime tiap 15 detik lewat polling daftar member. Hanya halaman Member
// (loadAdminUsers); kartu Kontrol Bot tidak ikut berubah.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function read(file) {
  return fs.readFile(path.join(ROOT, file), 'utf8');
}

function memberSection(js) {
  const start = js.indexOf('async function loadAdminUsers()');
  const end = js.indexOf('\nfunction ', start + 10);
  assert.ok(start !== -1 && end !== -1, 'fungsi loadAdminUsers harus ditemukan di app.js');
  return js.slice(start, end);
}

function botControlSection(js) {
  const start = js.indexOf('function buildBotControlCard(user)');
  const end = js.indexOf('\nfunction ', start + 10);
  assert.ok(start !== -1 && end !== -1, 'fungsi buildBotControlCard harus ditemukan di app.js');
  return js.slice(start, end);
}

test('avatar Member dibungkus dan diberi titik online hijau bila pemilik sedang online', async () => {
  const js = await read('public/app.js');
  const member = memberSection(js);
  const botcontrol = botControlSection(js);

  assert.ok(member.includes("avatarWrap.className = 'member-account-avatar-wrap'"), 'avatar Member harus dibungkus span avatar-wrap');
  assert.ok(member.includes('avatarWrap.append(avatarImage)'), 'avatar harus masuk ke dalam wrap');
  assert.ok(member.includes("if (user.panelActive) {"), 'titik hanya boleh dibuat bila pemilik sedang aktif');
  assert.ok(member.includes("onlineDot.className = 'member-account-online-dot'"), 'titik online harus memakai class member-account-online-dot');
  assert.ok(member.includes("onlineDot.title = 'Online'"), 'titik harus berlabel Online');
  assert.ok(member.includes('identity.append(avatarWrap, identityText);'), 'identity harus memakai wrap, bukan gambar langsung');
  assert.ok(!member.includes('identity.append(avatarImage, identityText);'), 'Member tidak boleh lagi memakai gambar langsung');

  // Kontrol Bot tidak ikut: avatarnya tetap gambar langsung tanpa titik.
  assert.ok(botcontrol.includes('identity.append(avatarImage, identityText);'), 'Kontrol Bot tetap memakai gambar langsung');
  assert.ok(!botcontrol.includes('member-account-online-dot'), 'Kontrol Bot tidak boleh mendapat titik online');
  assert.ok(!botcontrol.includes('member-account-avatar-wrap'), 'Kontrol Bot tidak boleh mendapat wrap avatar');
});

test('CSS titik online Member: hijau FB, cincin latar, ukuran ikut avatar', async () => {
  const css = await read('public/style.css');
  assert.ok(css.includes('.member-account-avatar-wrap{position:relative;flex:0 0 44px;width:44px;height:44px}'), 'wrap harus 44px di desktop');
  assert.ok(css.includes('.member-account-avatar-wrap .member-account-avatar{width:100%;height:100%;flex:none}'), 'avatar di dalam wrap harus mengisi wrap');
  assert.match(css, /\.member-account-online-dot\{[^}]*width:12px;[^}]*background:#3ee69a;[^}]*border:2px solid #08110e/, 'titik harus hijau 12px dengan cincin warna latar');
  assert.ok(css.includes('.member-account-avatar-wrap{flex-basis:42px;width:42px;height:42px}'), 'wrap harus 42px di HP kecil');
  assert.ok(css.includes('.member-account-avatar-wrap{flex-basis:34px;width:34px;height:34px}'), 'wrap harus 34px di HP sentuh');
  assert.ok(css.includes('.member-account-online-dot{width:10px;height:10px}'), 'titik harus 10px di HP kecil');
});

test('titik online Member diperbarui realtime lewat polling daftar member', async () => {
  const js = await read('public/app.js');
  assert.match(js, /adminUsersTimer = setInterval\(\(\) => \{[\s\S]*?void loadAdminUsers\(\);[\s\S]*?\}, 15000\)/, 'daftar member harus dimuat ulang tiap 15 detik');
  assert.ok(js.includes('startAdminUsersPolling();'), 'polling daftar member harus jalan setelah login');
  assert.ok(js.includes("text: user.panelActive ? 'Pemilik · Online' : 'Pemilik · Tidak aktif'"), 'chip status pemilik harus tetap memakai panelActive yang sama dengan titik');
});
