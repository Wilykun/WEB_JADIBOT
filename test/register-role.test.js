import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(root, file), 'utf8');

test('formulir daftar punya pilihan Member/Admin dengan ikon SVG dan input peran', async () => {
  const html = await read('public/index.html');
  assert.match(html, /class="register-role-picker"/);
  assert.match(html, /data-register-role="user"/);
  assert.match(html, /data-register-role="admin"/);
  assert.match(html, /<input type="hidden" name="role" value="user" id="register-role">/);
  assert.match(html, /<strong>Member<\/strong>/);
  assert.match(html, /<strong>Admin<\/strong>/);
  assert.match(html, /Butuh kode akses setelah verifikasi/);
  assert.match(html, /id="admin-access-form"/);
  assert.match(html, /id="admin-access-code"/);
  assert.match(html, /Kode akses admin/);
});

test('frontend menangani langkah kode akses setelah verifikasi admin', async () => {
  const js = await read('public/app.js');
  assert.match(js, /showAdminAccessForm/);
  assert.match(js, /needsAccessCode === true/);
  assert.match(js, /\/api\/auth\/admin-access/);
  assert.match(js, /data-register-role/);
  assert.match(js, /register-role/);
});

test('Admin Utama ditandai dengan lencana mahkota di daftar member', async () => {
  const js = await read('public/app.js');
  assert.match(js, /Admin Utama/);
  assert.match(js, /crown: \[/);
  assert.match(js, /isMainAdmin/);
  assert.match(js, /is-main-admin/);
  assert.match(js, /canManageTarget/);
  const css = await read('public/style.css');
  assert.match(css, /\.member-account-chip\.is-main-admin/);
  assert.match(css, /\.member-account-item\.is-main-admin/);
  assert.match(css, /\.register-role-picker/);
  assert.match(css, /\.role-option\.is-selected/);
});

test('server memisah folder akun dan meminta kode akses untuk admin', async () => {
  const server = await read('server/index.js');
  assert.match(server, /ADMIN_ACCESS_CODE/);
  assert.match(server, /\/api\/auth\/admin-access/);
  assert.match(server, /needsAccessCode/);
  assert.match(server, /ADMIN_ACCOUNT_DIR/);
  assert.match(server, /isMainAdmin/);
  assert.match(server, /isMainAdminUser/);
  assert.match(server, /DATA_ADMIN/);
  const policy = await read('server/member-admin-policy.js');
  assert.match(policy, /isMainAdminUser/);
  assert.match(policy, /Admin Utama tidak dapat diubah/);
  const config = JSON.parse(await read('config.json'));
  assert.equal(typeof config.adminAccessCode, 'string');
  assert.ok(config.adminAccessCode.trim().length >= 4, 'kode akses admin harus dikonfigurasi');
});
