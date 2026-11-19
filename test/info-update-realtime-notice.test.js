import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function read(file) {
  return fs.readFile(path.join(ROOT, file), 'utf8');
}

test('panel memeriksa Info Update tiap 60 detik dan memberi toast saat ada entri baru', async () => {
  const js = await read('public/app.js');
  assert.ok(js.includes('function startInfoUpdateNoticePolling()'), 'pemeriksa notifikasi harus ada');
  assert.ok(js.includes('infoUpdateNoticeTimer = window.setInterval(() => { void checkInfoUpdateNotice(); }, 60000);'), 'pemeriksa harus jalan tiap 60 detik');
  assert.ok(js.includes('if (infoUpdateNoticeTimer) return;'), 'pemeriksa tidak boleh jalan ganda');
  assert.ok(js.includes('startInfoUpdateNoticePolling();'), 'pemeriksa harus dimulai setelah login');
  assert.ok(js.includes("fetch('/info-updates.json', { cache: 'no-store' })"), 'pemeriksa harus membaca daftar terbaru tanpa cache');
  assert.ok(js.includes('void refreshInfoUpdateBadge(updates);'), 'pemeriksa harus memperbarui badge dari data yang sama tanpa unduh ulang');
});

test('satu entri Info Update baru hanya diberitahukan sekali lewat toast', async () => {
  const js = await read('public/app.js');
  const markerDecl = js.match(/let lastNotifiedInfoUpdateMarker = null;/)[0];
  const markerFn = js.match(/function infoUpdateMarker\(update\) \{[\s\S]*?\n\}/)[0];
  const fnMatch = js.match(/function notifyNewInfoUpdate\(updates\) \{[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'fungsi notifyNewInfoUpdate harus bisa diekstrak dari app.js');
  const program = `
    ${markerDecl}
    const toasted = [];
    function showToast(text) { toasted.push(text); }
    ${markerFn}
    ${fnMatch[0]}
    const entryA = [{ day: 'Jumat, 20 Nov 2026', time: '06.24 WIB', title: 'Info Update kini memberi notifikasi realtime' }];
    const entryB = [{ day: 'Jumat, 20 Nov 2026', time: '06.30 WIB', title: 'Entri berikutnya' }];
    notifyNewInfoUpdate(entryA);
    notifyNewInfoUpdate(entryA);
    notifyNewInfoUpdate(entryB);
    notifyNewInfoUpdate(entryB);
    notifyNewInfoUpdate([]);
    toasted;
  `;
  const toasted = eval(program);
  assert.deepEqual(toasted, [
    'Info Update baru: Entri berikutnya',
  ], 'entri yang sudah ada saat pertama diperiksa tidak memicu toast, entri baru memicu tepat satu toast');
});

test('badge Info Update bisa memakai daftar yang sudah diunduh pemeriksa notifikasi', async () => {
  const js = await read('public/app.js');
  assert.ok(js.includes('async function refreshInfoUpdateBadge(prefetchedUpdates)'), 'badge harus menerima daftar yang sudah diunduh');
  assert.ok(js.includes("if (updates) {\n      seenResponse = await fetch('/api/info-updates/seen'"), 'daftar yang sudah ada tidak boleh diunduh ulang');
});
