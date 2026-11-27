import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function read(file) {
  return fs.readFile(path.join(ROOT, file), 'utf8');
}

test('panel memeriksa Info Update tiap 60 detik dan memberi notifikasi saat ada entri baru', async () => {
  const js = await read('public/app.js');
  assert.ok(js.includes('function startInfoUpdateNoticePolling()'), 'pemeriksa notifikasi harus ada');
  assert.ok(js.includes('infoUpdateNoticeTimer = window.setInterval(() => { void checkInfoUpdateNotice(); }, 60000);'), 'pemeriksa harus jalan tiap 60 detik');
  assert.ok(js.includes('if (infoUpdateNoticeTimer) return;'), 'pemeriksa tidak boleh jalan ganda');
  assert.ok(js.includes('startInfoUpdateNoticePolling();'), 'pemeriksa harus dimulai setelah login');
  assert.ok(js.includes("fetch('/info-updates.json', { cache: 'no-store' })"), 'pemeriksa harus membaca daftar terbaru tanpa cache');
  assert.ok(js.includes('void refreshInfoUpdateBadge(updates);'), 'pemeriksa harus memperbarui badge dari data yang sama tanpa unduh ulang');
  assert.ok(js.includes("fetch('/api/info-updates/seen', { credentials: 'same-origin' })"), 'pemeriksa harus membaca penanda dibaca supaya tahu update mana yang belum dibaca');
});

test('satu entri Info Update baru hanya memunculkan modal sekali, dengan semua update yang belum dibaca', async () => {
  const js = await read('public/app.js');
  const pick = (re, label) => {
    const m = js.match(re);
    assert.ok(m, label);
    return m[0];
  };
  const markerDecl = pick(/let lastNotifiedInfoUpdateMarker = null;/, 'penanda terakhir harus ada');
  const dismissedDecl = pick(/let infoUpdateNoticeDismissedMarker = null;/, 'penanda yang sudah ditutup harus ada');
  const shownDecl = pick(/let infoUpdateNoticeShownMarker = null;/, 'penanda yang sedang tampil harus ada');
  const unseenDecl = pick(/let infoUpdateNoticeUnseen = \[\];/, 'daftar update belum dibaca di modal harus ada');
  const markerFn = pick(/function infoUpdateMarker\(update\) \{[\s\S]*?\n\}/, 'fungsi infoUpdateMarker harus bisa diekstrak');
  const countFn = pick(/function countUnreadInfoUpdates\(updates, seen\) \{[\s\S]*?\n\}/, 'fungsi countUnreadInfoUpdates harus bisa diekstrak');
  const unseenFn = pick(/function unseenInfoUpdates\(updates, seen\) \{[\s\S]*?\n\}/, 'fungsi unseenInfoUpdates harus bisa diekstrak');
  const showFn = pick(/function showInfoUpdateNoticeModal\(unseen\) \{[\s\S]*?\n\}/, 'fungsi showInfoUpdateNoticeModal harus bisa diekstrak');
  const hideFn = pick(/function hideInfoUpdateNoticeModal\(\) \{[\s\S]*?\n\}/, 'fungsi hideInfoUpdateNoticeModal harus bisa diekstrak');
  const notifyFn = pick(/function notifyNewInfoUpdate\(updates, seen\) \{[\s\S]*?\n\}/, 'fungsi notifyNewInfoUpdate harus bisa diekstrak');
  const program = `
    ${markerDecl}
    ${dismissedDecl}
    ${shownDecl}
    ${unseenDecl}
    function makeEl() {
      const el = {
        classList: { _s: new Set(['hidden']), contains(c) { return this._s.has(c); }, add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); } },
        textContent: '', children: [],
        replaceChildren() { this.children = []; },
        append(child) { this.children.push(child); },
        querySelector() { return { focus() {} }; },
      };
      return el;
    }
    const overlay = makeEl();
    const list = makeEl();
    const countEl = makeEl();
    const document = { querySelector(sel) {
      if (sel === '#info-update-notice-overlay') return overlay;
      if (sel === '#info-update-notice-list') return list;
      if (sel === '#info-update-notice-count') return countEl;
      return null;
    } };
    let renders = 0;
    function createInfoUpdateItem(update) { renders += 1; return { title: update.title }; }
    ${markerFn}
    ${countFn}
    ${unseenFn}
    ${showFn}
    ${hideFn}
    ${notifyFn}
    const entryA = [{ day: 'Jumat, 20 Nov 2026', time: '06.24 WIB', title: 'Info Update kini memberi notifikasi realtime' }];
    const entryB = [{ day: 'Jumat, 20 Nov 2026', time: '06.30 WIB', title: 'Entri berikutnya' }, entryA[0]];
    const out = {};
    notifyNewInfoUpdate(entryA, null);
    out.firstShown = !overlay.classList.contains('hidden');
    out.firstCount = countEl.textContent;
    out.firstItems = list.children.length;
    out.firstRenders = renders;
    notifyNewInfoUpdate(entryA, null);
    out.secondRenders = renders;
    notifyNewInfoUpdate(entryB, null);
    out.thirdItems = list.children.length;
    out.thirdRenders = renders;
    hideInfoUpdateNoticeModal();
    out.afterHideHidden = overlay.classList.contains('hidden');
    notifyNewInfoUpdate(entryB, null);
    out.afterDismissRenders = renders;
    out.afterDismissHidden = overlay.classList.contains('hidden');
    out;
  `;
  const out = eval(program);
  assert.equal(out.firstShown, true, 'modal harus muncul saat ada update belum dibaca');
  assert.equal(out.firstCount, '1 pembaruan baru belum dibaca.', 'hitungan modal harus akurat untuk satu update');
  assert.equal(out.firstItems, 1, 'modal harus menampilkan satu update yang belum dibaca');
  assert.equal(out.secondRenders, out.firstRenders, 'entri yang sama tidak boleh memunculkan ulang modal');
  assert.equal(out.thirdItems, 2, 'entri baru harus menampilkan semua update yang belum dibaca, bukan hanya yang terbaru');
  assert.equal(out.thirdRenders, out.firstRenders + 2, 'entri baru harus me-render ulang daftar modal');
  assert.equal(out.afterHideHidden, true, 'Tutup harus menyembunyikan modal');
  assert.equal(out.afterDismissRenders, out.thirdRenders, 'entri yang sudah ditutup tidak boleh memunculkan ulang modal');
  assert.equal(out.afterDismissHidden, true, 'modal tetap tersembunyi setelah ditutup');
});

test('badge Info Update bisa memakai daftar yang sudah diunduh pemeriksa notifikasi', async () => {
  const js = await read('public/app.js');
  assert.ok(js.includes('async function refreshInfoUpdateBadge(prefetchedUpdates)'), 'badge harus menerima daftar yang sudah diunduh');
  assert.ok(js.includes("if (updates) {\n      seenResponse = await fetch('/api/info-updates/seen'"), 'daftar yang sudah ada tidak boleh diunduh ulang');
});

test('modal notifikasi Info Update ada di HTML dan memakai ikon kategori', async () => {
  const html = await read('public/index.html');
  const js = await read('public/app.js');
  const css = await read('public/style.css');
  assert.ok(html.includes('id="info-update-notice-overlay"'), 'modal notifikasi Info Update harus ada di HTML');
  assert.ok(html.includes('id="info-update-notice-list"'), 'daftar update di modal harus ada');
  assert.ok(html.includes('id="info-update-notice-count"'), 'hitungan update belum dibaca harus ada');
  assert.ok(html.includes('data-info-update-notice-reload'), 'tombol Muat ulang harus ada');
  assert.ok(html.includes('data-info-update-notice-dismiss-all'), 'tombol Tutup semua harus ada');
  assert.ok(html.includes('data-info-update-notice-close'), 'tombol Tutup harus ada');
  assert.ok(html.includes('data-info-update-notice-more'), 'tautan Lihat update sebelumnya harus ada');
  assert.ok(js.includes('createInfoUpdateItem(update)'), 'item modal harus memakai renderer Info Update yang sama supaya ikon SVG kategorinya ikut');
  assert.ok(js.includes('function dismissAllInfoUpdateNotice()'), 'Tutup semua harus menandai semua update sebagai dibaca');
  assert.ok(css.includes('.info-update-notice-list'), 'daftar modal harus bisa digulir');
  assert.ok(css.includes('.info-update-notice-card'), 'kartu modal harus punya lebar sendiri');
});
