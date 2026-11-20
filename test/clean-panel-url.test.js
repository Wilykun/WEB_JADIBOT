import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const appJs = await fs.readFile(path.join(ROOT, 'public', 'app.js'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `fungsi tidak ditemukan: ${name}`);
  let depth = 0;
  let i = source.indexOf('{', start);
  for (; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`kurung fungsi tidak seimbang: ${name}`);
}

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `penanda tidak ditemukan: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end >= 0, `penanda tidak ditemukan: ${endMarker}`);
  return source.slice(start, end);
}

test('pindah halaman tidak lagi menulis #halaman ke URL', () => {
  assert.ok(!appJs.includes("history.replaceState(null, '', `#${page}`)"), 'URL tidak boleh lagi ditulis #halaman saat pindah halaman');
  assert.match(appJs, /if \(location\.hash\) history\.replaceState\(null, '', location\.pathname \+ location\.search\);/);
  assert.ok(!appJs.includes('updateHash'), 'parameter updateHash sudah tidak dipakai lagi');
});

test('tautan dalam #halaman tetap dibaca sekali saat halaman dimuat', () => {
  assert.match(appJs, /const requestedPage = location\.hash\.slice\(1\);/);
  assert.ok(appJs.includes('restoreWorkspacePageBeforePairing()'), 'halaman terakhir dipulihkan sebelum fetch pairing');
});

test('refresh tidak lagi menampilkan halaman Profil saat pengguna sedang di Rank Bot', () => {
  // Penyebab hantu: halaman terakhir baru dipulihkan renderLinkGate setelah
  // /api/pairing/status kembali, sementara halaman Profil satu-satunya yang
  // terlihat secara default di HTML. Pemulihan harus jalan di showDashboard,
  // sebelum fetch pairing apa pun.
  const show = sliceBetween(appJs, 'async function showDashboard(user) {', '  await Promise.all(');
  const restoreAt = show.indexOf('restoreWorkspacePageBeforePairing();');
  assert.ok(restoreAt >= 0, 'showDashboard harus memulihkan halaman terakhir');
  assert.ok(!show.includes('refreshPairing()') || show.indexOf('refreshPairing()') > restoreAt, 'pemulihan halaman harus sebelum fetch pairing');
  const helper = extractFunction(appJs, 'restoreWorkspacePageBeforePairing');
  assert.ok(helper.includes("window.sessionStorage.getItem(LAST_PAGE_STORAGE_KEY)"), 'pemulihan membaca halaman terakhir dari sessionStorage');
  assert.ok(helper.includes('setWorkspacePage(initialPage, false, { markLogSeen: false, markChatSeen: false })'), 'pemulihan memakai setWorkspacePage tanpa menghapus badge');
  assert.ok(helper.includes("!requestedPage && !rememberedPage && currentUser ? 'admin' : null"), 'tanpa hash dan tanpa halaman terakhir, pemulihan jatuh ke Member');
});

test('pemulihan halaman sebelum pairing memilih hash, lalu halaman terakhir, lalu Member', () => {
  const helper = extractFunction(appJs, 'restoreWorkspacePageBeforePairing');
  const run = ({ hash, remembered, hiddenPages, user }) => {
    let activeWorkspacePage = null;
    let currentUser = user || null;
    const calls = [];
    const nav = (page) => (hiddenPages.includes(page) ? { classList: { contains: () => true } } : { classList: { contains: () => false } });
    const location = { hash };
    const document = { querySelector: (selector) => nav(selector.match(/#(\w+)/)?.[1] || '') };
    const window = { sessionStorage: { getItem: () => remembered } };
    const LAST_PAGE_STORAGE_KEY = 'readsw-console-last-page';
    const setWorkspacePage = (page, smooth, options) => calls.push([page, smooth, options]);
    eval(`${helper}; restoreWorkspacePageBeforePairing();`);
    return calls;
  };
  assert.deepEqual(run({ hash: '', remembered: 'rankbot', hiddenPages: [], user: { id: 'u1' } }), [['rankbot', false, { markLogSeen: false, markChatSeen: false }]], 'halaman terakhir Rank Bot harus dipulihkan');
  assert.deepEqual(run({ hash: '#rankbot', remembered: 'admin', hiddenPages: [], user: { id: 'u1' } }), [['rankbot', false, { markLogSeen: false, markChatSeen: false }]], 'hash harus menang atas halaman terakhir');
  assert.deepEqual(run({ hash: '', remembered: 'dashboard', hiddenPages: ['dashboard'], user: { id: 'u1' } }), [], 'halaman yang menunya masih tersembunyi diserahkan ke renderLinkGate');
  assert.deepEqual(run({ hash: '', remembered: null, hiddenPages: [], user: { id: 'u1' } }), [['admin', false, { markLogSeen: false, markChatSeen: false }]], 'tanpa hash dan tanpa halaman terakhir, pemulihan jatuh ke Member');
  assert.deepEqual(run({ hash: '', remembered: null, hiddenPages: [], user: null }), [], 'tanpa pengguna yang login, pemulihan tidak memaksa halaman');
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
