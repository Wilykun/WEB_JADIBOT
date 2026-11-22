import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('workspace topbar stays pinned to the top while the page scrolls', async () => {
  const html = await fs.readFile(path.join(ROOT, 'public/index.html'), 'utf8');
  const css = await fs.readFile(path.join(ROOT, 'public/style.css'), 'utf8');
  assert.ok(html.includes('<header class="topbar">'), 'workspace must have a topbar header');
  for (const marker of ['id="menu-toggle"', 'id="page-breadcrumb"', 'class="user-chip"']) {
    assert.ok(html.includes(marker), `topbar must contain ${marker}`);
  }
  const base = css.match(/\.topbar\{[^}]*\}/);
  assert.ok(base, 'style.css must have a base .topbar rule');
  const rule = base[0];
  assert.match(rule, /position:\s*sticky/, 'topbar must be sticky so it follows the scroll');
  assert.match(rule, /top:\s*0/, 'sticky topbar must pin to the top of the viewport');
  const zIndex = Number(rule.match(/z-index:\s*(\d+)/)?.[1]);
  assert.ok(Number.isFinite(zIndex) && zIndex < 30, `topbar z-index (${zIndex}) must stay below the menu drawer (30)`);
  assert.ok(zIndex > 0, 'sticky topbar needs a z-index so page content slides under it');
  assert.match(rule, /backdrop-filter:\s*blur\(/, 'sticky topbar needs a blur so scrolled content does not bleed through');
  const background = rule.match(/background:\s*([^;}]+)/)?.[1] || '';
  const alpha = background.match(/rgba\([^)]*,\s*([\d.]+)\s*\)/)?.[1];
  assert.ok(!background.includes('rgba') || Number(alpha) >= 0.9, `sticky topbar background (${background}) must be near-opaque so text does not show through`);
  const light = css.match(/html\[data-theme="light"\]\s*\.topbar\s*\{[^}]*\}/);
  assert.ok(light && /background:\s*#[0-9a-f]{3,6}/i.test(light[0]), 'light theme topbar must keep a solid background');
});

test('menu garis tiga muncul di viewport saat diketuk setelah scroll (bukan di atas halaman)', async () => {
  const css = await fs.readFile(path.join(ROOT, 'public', 'style.css'), 'utf8');
  const dropdown = css.match(/\.sidebar\{[^}]*top:\s*76px[^}]*\}/);
  assert.ok(dropdown, 'style.css must have the dropdown sidebar rule (top: 76px)');
  const rule = dropdown[0];
  assert.match(rule, /position:\s*fixed/, 'menu dropdown harus position: fixed supaya nempel di viewport saat halaman di-scroll, bukan absolute yang ikut halaman ke atas');
  assert.doesNotMatch(rule, /position:\s*absolute/, 'menu dropdown tidak boleh absolute — itu yang bikin menu muncul di atas halaman dan tidak kelihatan setelah scroll');
  assert.match(rule, /top:\s*76px/, 'menu dropdown tetap 76px dari atas viewport, tepat di bawah topbar yang nempel');
  assert.match(rule, /max-height:\s*calc\(100vh - 92px\)/, 'menu dropdown tetap dibatasi tingginya supaya muat di layar');
  assert.match(rule, /overflow:\s*auto/, 'menu dropdown tetap bisa di-scroll sendiri bila isinya lebih tinggi dari layar');
  const zIndex = Number(rule.match(/z-index:\s*(\d+)/)?.[1]);
  assert.ok(Number.isFinite(zIndex) && zIndex > 25, `menu dropdown z-index (${zIndex}) must stay above the sticky topbar (25)`);
});

test('tanda seru garis tiga nyala bila ada notifikasi di kategori mana pun, mati bila semua dibaca', async () => {
  const js = await fs.readFile(path.join(ROOT, 'public', 'app.js'), 'utf8');
  const css = await fs.readFile(path.join(ROOT, 'public', 'style.css'), 'utf8');
  const html = await fs.readFile(path.join(ROOT, 'public', 'index.html'), 'utf8');
  // Tombol garis tiga sudah punya ikon tanda seru yang tampil saat has-alert.
  assert.ok(html.includes('class="menu-toggle-alert"'), 'tombol garis tiga harus punya elemen tanda seru');
  assert.ok(css.includes('#menu-toggle.has-alert .menu-toggle-alert{display:block}'), 'tanda seru harus tampil saat tombol punya has-alert');
  // updateMenuToggleAlert harus menggabungkan SEMUA kategori badge menu,
  // bukan cuma Info Update dan Member — Log Bot dan Obrolan juga.
  const fn = js.slice(js.indexOf('function updateMenuToggleAlert()'), js.indexOf('function renderInfoUpdateBadge(count)'));
  assert.ok(fn.includes('infoUpdateUnreadCount'), 'tanda seru harus menghitung Info Update belum dibaca');
  assert.ok(fn.includes('memberNewCount'), 'tanda seru harus menghitung akun baru di Member');
  assert.ok(fn.includes('chatUnreadCount'), 'tanda seru harus menghitung pesan Obrolan belum dibaca');
  assert.ok(fn.includes('privateLogUnreadStoryCount'), 'tanda seru harus menghitung story Log Bot belum dibaca');
  assert.ok(fn.includes("button.classList.toggle('has-alert', hasAlert)"), 'tanda seru harus dipasang lewat kelas has-alert');
  assert.ok(fn.includes("button.setAttribute('aria-label', hasAlert ? 'Buka menu (ada notifikasi)' : 'Buka menu')"), 'label tombol harus menyebut ada notifikasi saat tanda seru nyala');
  // Badge Obrolan dan Log Bot harus memicu pembaruan tanda seru tiap berubah,
  // supaya titiknya nyala realtime saat notif masuk dan mati saat dibaca.
  const chatFn = js.slice(js.indexOf('function renderChatBadge(count)'), js.indexOf('function markChatSeen()'));
  assert.ok(chatFn.includes('updateMenuToggleAlert();'), 'renderChatBadge harus memperbarui tanda seru garis tiga');
  const logFn = js.slice(js.indexOf('function renderPrivateLogBadge(count)'), js.indexOf('function markPrivateLogSeen()'));
  assert.ok(logFn.includes('updateMenuToggleAlert();'), 'renderPrivateLogBadge harus memperbarui tanda seru garis tiga');
  // Kategori yang sudah benar sejak lama tetap memicu pembaruan tanda seru.
  const infoFn = js.slice(js.indexOf('function renderInfoUpdateBadge(count)'), js.indexOf('async function refreshInfoUpdateBadge'));
  assert.ok(infoFn.includes('updateMenuToggleAlert();'), 'renderInfoUpdateBadge harus memperbarui tanda seru garis tiga');
  const memberFn = js.slice(js.indexOf('function renderMemberBadge(count)'), js.indexOf('async function refreshMemberBadge()'));
  assert.ok(memberFn.includes('updateMenuToggleAlert();'), 'renderMemberBadge harus memperbarui tanda seru garis tiga');
});
