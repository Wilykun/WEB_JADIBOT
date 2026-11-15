import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const appJs = await fs.readFile(path.join(ROOT, 'public', 'app.js'), 'utf8');

test('pindah halaman tidak lagi menulis #halaman ke URL', () => {
  assert.ok(!appJs.includes("history.replaceState(null, '', `#${page}`)"), 'URL tidak boleh lagi ditulis #halaman saat pindah halaman');
  assert.match(appJs, /if \(location\.hash\) history\.replaceState\(null, '', location\.pathname \+ location\.search\);/);
  assert.ok(!appJs.includes('updateHash'), 'parameter updateHash sudah tidak dipakai lagi');
});

test('tautan dalam #halaman tetap dibaca sekali saat halaman dimuat', () => {
  assert.match(appJs, /const requestedPage = location\.hash\.slice\(1\);/);
  assert.match(appJs, /if \(requestedPage === 'profile' \|\| requestedPage === 'admin'\)/);
});

test('halaman terakhir disimpan dan dipakai lagi saat refresh', () => {
  assert.match(appJs, /const LAST_PAGE_STORAGE_KEY = 'readsw-console-last-page';/);
  assert.match(appJs, /window\.sessionStorage\.setItem\(LAST_PAGE_STORAGE_KEY, page\)/);
  assert.match(appJs, /window\.sessionStorage\.getItem\(LAST_PAGE_STORAGE_KEY\)/);
  assert.match(appJs, /rememberedNav && !rememberedNav\.classList\.contains\('hidden'\)\s*\n\s*\? rememberedPage/);
});

test('halaman terakhir dihapus saat keluar agar tidak terbawa ke akun lain', () => {
  assert.match(appJs, /window\.sessionStorage\.removeItem\(LAST_PAGE_STORAGE_KEY\)/);
});
