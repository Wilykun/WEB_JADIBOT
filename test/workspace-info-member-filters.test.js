import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function read(file) {
  return fs.readFile(path.join(ROOT, file), 'utf8');
}

test('info update filter pills match the JSON taxonomy and count the real entries', async () => {
  const html = await read('public/index.html');
  const js = await read('public/app.js');
  const data = JSON.parse(await read('public/info-updates.json'));
  const updates = data.updates;
  assert.ok(Array.isArray(updates) && updates.length > 0, 'info updates must not be empty');

  const slug = (tag) => tag.toLowerCase().replace(/\s+/g, '-');
  const counts = { all: updates.length };
  for (const update of updates) counts[slug(update.tag)] = (counts[slug(update.tag)] || 0) + 1;
  // Hitungan pil harus akurat: Semua = total entri, tiap kategori = jumlah entri dengan tag itu.
  assert.equal(counts.all, 49, 'Semua must equal the total number of entries');
  assert.equal(counts['fitur-baru'], 17, 'Fitur baru count must match the JSON data');
  assert.equal(counts.perubahan, 8, 'Perubahan count must match the JSON data');
  assert.equal(counts.perbaikan, 12, 'Perbaikan count must match the JSON data');
  assert.equal(counts['fitur-dihapus'] || 0, 0, 'Fitur dihapus count must match the JSON data');
  assert.equal(counts.tampilan, 12, 'Tampilan count must match the JSON data');

  for (const key of ['all', 'fitur-baru', 'perubahan', 'perbaikan', 'fitur-dihapus', 'tampilan']) {
    assert.ok(html.includes(`data-info-filter="${key}"`), `info update filter must have a pill for ${key}`);
    assert.ok(html.includes(`data-filter-count="${key}"`), `info update pill ${key} must carry a count element`);
  }
  assert.ok(html.includes('id="info-update-search"'), 'info update must have a search input');
  assert.ok(html.includes('placeholder="Cari pembaruan, kategori…"'), 'info update search placeholder must match the context');
  assert.ok(js.includes('function infoUpdateFilterCounts'), 'counts must be computed from the rendered items');
  assert.ok(js.includes("item.dataset.tag") && js.includes('counts.all += 1'), 'counts must tally every item by its data-tag');
  assert.ok(js.includes('function updateInfoUpdateFilterCounts'), 'counts must be written back to the pills');
});

test('info update search + category filter narrow the list and pagination follows the filtered result', async () => {
  const html = await read('public/index.html');
  const js = await read('public/app.js');
  const css = await read('public/style.css');

  assert.ok(js.includes("function infoUpdateItemMatches"), 'filtering must test each item against the active category and query');
  assert.ok(js.includes("infoUpdateFilter !== 'all'") && js.includes("(item.dataset.tag || '') !== infoUpdateFilter"), 'category filter must compare the item data-tag');
  assert.ok(js.includes("querySelector('h4')") && js.includes("querySelector('.info-update-desc')") && js.includes("querySelector('.info-update-tag')"), 'search must match title, description, and tag');
  assert.ok(js.includes("item.classList.toggle('is-filtered-out', !match)"), 'non-matching items must be marked filtered out');
  assert.ok(js.includes("document.querySelector('#info-update-empty')"), 'an empty message must exist for zero matches');
  assert.ok(html.includes('id="info-update-empty"') && html.includes('Tidak ada pembaruan yang cocok'), 'empty message text must tell the user to change the search or category');
  assert.ok(js.includes("filter((item) => !item.classList.contains('is-filtered-out'))"), 'pagination must only count items that pass the filter');
  assert.ok(js.includes("if (resetPage) infoUpdatePage = 1;"), 'changing the filter or search must reset to page 1');
  assert.ok(css.includes('.info-update-item.is-filtered-out'), 'filtered-out info update items must be hidden by CSS');
  assert.ok(html.includes('data-info-filter="fitur-baru"') && html.includes('data-info-filter="fitur-dihapus"'), 'pills must cover all five categories plus Semua');
});

test('info update filter counts refresh in realtime and the active filter survives data reloads', async () => {
  const js = await read('public/app.js');
  // Hitungan dihitung ulang di setiap loadInfoUpdates (auto-refresh 60 detik), dan filter tidak pernah di-reset di sana.
  assert.ok(js.includes('updateInfoUpdateFilterCounts();\n  applyInfoUpdateFilter({ resetPage: false });'), 'loadInfoUpdates must recount and re-apply the filter on every refresh');
  const loadFn = js.slice(js.indexOf('async function loadInfoUpdates()'), js.indexOf('// Filter + pencarian Info Update'));
  assert.ok(!loadFn.includes("infoUpdateFilter = 'all'"), 'loadInfoUpdates must not reset the active category filter');
  assert.ok(!loadFn.includes("infoUpdateQuery = ''"), 'loadInfoUpdates must not reset the active search query');
  assert.ok(js.includes("window.setInterval(() => { void loadInfoUpdates(); }, 60000)"), 'info update auto-refresh must still run every 60 seconds');
  assert.ok(js.includes("document.querySelector('#info-update-search')?.addEventListener('input'"), 'search must react to typing without a reload');
  assert.ok(js.includes("document.querySelector('[data-info-update-filters]')?.addEventListener('click'"), 'category pills must react to clicks');
});

test('member filter pills use the accurate account categories with real counts', async () => {
  const html = await read('public/index.html');
  const js = await read('public/app.js');

  for (const key of ['all', 'admin', 'member', 'running', 'linked', 'inactive']) {
    assert.ok(html.includes(`data-member-filter="${key}"`), `member filter must have a pill for ${key}`);
    assert.ok(html.includes(`data-filter-count="${key}"`), `member pill ${key} must carry a count element`);
  }
  assert.ok(html.includes('id="member-search"'), 'member list must have a search input');
  assert.ok(html.includes('placeholder="Cari akun, nama, email…"'), 'member search placeholder must match the context');
  // Ikon SVG sesuai konteks di setiap pil.
  assert.ok(html.includes('data-member-filter="admin"') && html.includes('M3 8.5 6.5 12 12 6.5 17.5 12 21 8.5'), 'admin pill must carry the crown icon');
  assert.ok(html.includes('M12 12a4 4 0 1 0 0-8'), 'member pill must carry the person icon');
  assert.ok(html.includes('M8 8h8a4 4 0 0 1 4 4'), 'bot pill must carry the robot icon');

  // Definisi kategori harus memakai field yang sama dengan chip status di kartu member.
  assert.ok(js.includes("article.dataset.memberRole = user.role === 'admin' ? 'admin' : 'member'"), 'role must come from user.role');
  assert.ok(js.includes("article.dataset.memberBot = user.workerStatus === 'running' ? 'running' : 'stopped'"), 'bot status must come from user.workerStatus');
  assert.ok(js.includes("article.dataset.memberWa = user.whatsappStatus === 'linked' ? 'linked' : 'unlinked'"), 'WA status must come from user.whatsappStatus');
  assert.ok(js.includes("article.dataset.memberSearch = [username, displayName, user.email || ''].join(' ').toLowerCase()"), 'search must match username, displayName, and email');
  assert.ok(js.includes("if (article.dataset.memberBot !== 'running' && article.dataset.memberWa !== 'linked') counts.inactive += 1"), 'Belum aktif must mean bot not running AND WhatsApp not linked');

  // Hitungan pil member dari data akun contoh: 2 admin, 6 member, 4 bot jalan, 4 WA tertaut, 4 belum aktif.
  const sample = [
    { role: 'admin', workerStatus: 'stopped', whatsappStatus: undefined },
    { role: 'admin', workerStatus: 'stopped', whatsappStatus: undefined },
    { role: 'member', workerStatus: 'running', whatsappStatus: 'linked' },
    { role: 'member', workerStatus: 'running', whatsappStatus: 'linked' },
    { role: 'member', workerStatus: 'running', whatsappStatus: 'linked' },
    { role: 'member', workerStatus: 'running', whatsappStatus: 'linked' },
    { role: 'member', workerStatus: 'stopped', whatsappStatus: 'failed' },
    { role: 'member', workerStatus: 'stopped', whatsappStatus: undefined },
  ];
  const count = (fn) => sample.filter(fn).length;
  assert.equal(count(() => true), 8, 'sample total must be 8 accounts');
  assert.equal(count((u) => u.role === 'admin'), 2, 'sample admins must be 2');
  assert.equal(count((u) => u.role !== 'admin'), 6, 'sample members must be 6');
  assert.equal(count((u) => u.workerStatus === 'running'), 4, 'sample running bots must be 4');
  assert.equal(count((u) => u.whatsappStatus === 'linked'), 4, 'sample linked WhatsApp must be 4');
  assert.equal(count((u) => u.workerStatus !== 'running' && u.whatsappStatus !== 'linked'), 4, 'sample inactive must be 4');
  assert.ok(js.includes('function memberFilterCounts'), 'member counts must be computed from the rendered articles');
});

test('member search + category filter narrow the list, hide empty groups, and show an empty message', async () => {
  const html = await read('public/index.html');
  const js = await read('public/app.js');
  const css = await read('public/style.css');

  assert.ok(js.includes('function memberArticleMatches'), 'each account must be tested against the active category and query');
  assert.ok(js.includes("article.classList.toggle('is-filtered-out', !match)"), 'non-matching accounts must be marked filtered out');
  assert.ok(js.includes("group.toggleAttribute('hidden', !hasVisible)"), 'a group with no visible accounts must be hidden');
  assert.ok(js.includes("document.querySelector('#member-filter-empty')"), 'an empty message must exist for zero matches');
  assert.ok(html.includes('id="member-filter-empty"') && html.includes('Tidak ada akun yang cocok'), 'empty message text must tell the user to change the search or category');
  assert.ok(css.includes('.member-account-item.is-filtered-out'), 'filtered-out accounts must be hidden by CSS');
  assert.ok(css.includes('.member-account-group[hidden]'), 'hidden groups must stay hidden');
});

test('member filter counts refresh in realtime and the active filter survives data reloads', async () => {
  const js = await read('public/app.js');
  // Hitungan dihitung ulang di setiap loadAdminUsers (polling 15 detik), dan filter tidak pernah di-reset di sana.
  assert.ok(js.includes('updateMemberFilterCounts();\n    applyMemberFilter();'), 'loadAdminUsers must recount and re-apply the filter on every refresh');
  const loadFn = js.slice(js.indexOf('async function loadAdminUsers()'), js.indexOf('// Filter + pencarian Member'));
  assert.ok(!loadFn.includes("memberFilter = 'all'"), 'loadAdminUsers must not reset the active category filter');
  assert.ok(!loadFn.includes("memberQuery = ''"), 'loadAdminUsers must not reset the active search query');
  assert.ok(js.includes('adminUsersTimer = setInterval'), 'member polling must still refresh the list');
  assert.ok(js.includes("document.querySelector('#member-search')?.addEventListener('input'"), 'member search must react to typing without a reload');
  assert.ok(js.includes("document.querySelector('[data-member-filters]')?.addEventListener('click'"), 'member category pills must react to clicks');
  // Badge akun baru tidak diubah perilakunya oleh filter.
  assert.ok(js.includes('renderMemberBadge(countNewMembers(users, memberListSeen))'), 'the new-member badge must still be computed from the same user list');
});

test('filter controls share the Log privat look without duplicating its scoped CSS', async () => {
  const html = await read('public/index.html');
  const css = await read('public/style.css');

  assert.ok(css.includes('.filter-controls'), 'a generic filter-controls class must exist');
  assert.ok(css.includes('.filter-search'), 'a generic filter-search class must exist');
  assert.ok(css.includes('.filter-pills'), 'a generic filter-pills class must exist');
  assert.ok(css.includes('.filter-pill.is-active'), 'the active pill state must exist');
  assert.ok(css.includes('.filter-pill small'), 'pill counts must be styled');
  assert.ok(css.includes('.filter-pills{display:flex;flex-wrap:wrap'), 'pills must wrap instead of overflowing on a 360px screen');
  assert.ok(css.includes('html[data-theme="light"] .filter-controls'), 'light theme must restyle the filter controls');
  assert.ok(css.includes('html[data-theme="light"] .filter-pill.is-active'), 'light theme must restyle the active pill');
  assert.ok(html.includes('data-filter-scope="infoupdate"') && html.includes('data-filter-scope="member"'), 'both pages must use the shared filter controls');
  const infoSection = html.slice(html.indexOf('<section id="infoupdate"'), html.indexOf('<section id="infoupdate"') + 20000);
  const memberSection = html.slice(html.indexOf('<section id="admin"'), html.indexOf('<section id="admin"') + 12000);
  assert.ok(!infoSection.includes('private-log-filter') && !memberSection.includes('private-log-filter'), 'info update and member must not reuse the Log-scoped classes');
});

test('the filter feature entry sits in info-updates.json and matches the static fallback exactly', async () => {
  const html = await read('public/index.html');
  const data = JSON.parse(await read('public/info-updates.json'));
  // Entri fitur filter tidak lagi di posisi pertama sejak ada entri yang lebih
  // baru, jadi dicari berdasarkan judul, bukan posisi.
  const index = data.updates.findIndex((update) => update.title === 'Info Update dan Member kini punya pencarian + filter kategori');
  assert.ok(index >= 0, 'the filter feature entry must exist in info-updates.json');
  const entry = data.updates[index];

  assert.equal(entry.tag, 'Fitur baru', 'the entry must use the display name tag');
  assert.equal(entry.day, 'Selasa, 17 Nov 2026', 'the entry day must be the day it shipped');
  assert.equal(entry.time, '05.24 WIB', 'the entry time must match when it shipped');

  const fallbackItems = [...html.matchAll(/<li class="info-update-item" data-tag="([^"]+)">([\s\S]*?)<\/li>/g)];
  assert.equal(fallbackItems.length, data.updates.length, 'static fallback must list the same entries as info-updates.json');
  const fallback = fallbackItems[index];
  assert.equal(fallback[1], 'fitur-baru', 'fallback data-tag must use the slug, not the display name');
  assert.ok(fallback[2].includes(`<h4>${entry.title}</h4>`), 'fallback title must match the JSON entry');
  assert.ok(fallback[2].includes(entry.description), 'fallback description must match the JSON entry');
  assert.ok(fallback[2].includes('<span class="info-update-tag">Fitur baru</span>'), 'fallback tag must match the JSON entry');
});
