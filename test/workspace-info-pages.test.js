import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('workspace Server and List Bot pages exist in the sidebar for admin and member alike', async () => {
  const html = await fs.readFile(path.join(ROOT, 'public/index.html'), 'utf8');
  const js = await fs.readFile(path.join(ROOT, 'public/app.js'), 'utf8');
  const css = await fs.readFile(path.join(ROOT, 'public/style.css'), 'utf8');

  for (const [page, label] of [['server', 'Server'], ['bots', 'List Bot']]) {
    const nav = html.match(new RegExp(`<a class="nav-item" href="#${page}">`));
    assert.ok(nav, `sidebar must link to #${page} without a hidden class so both roles see it`);
    assert.ok(html.includes(`data-page-view="${page}"`), `workspace page ${page} must exist`);
    assert.ok(js.includes(`${page}: '${label}'`), `workspacePageTitles must include ${page}`);
  }

  assert.ok(html.includes('id="workspace-server-status-value"'), 'server page must have a status value element');
  assert.ok(html.includes('id="workspace-public-stat-total"'), 'bots page must have an account stats element');
  assert.ok(js.includes('function refreshWorkspaceServerStatus'), 'workspace server status must be refreshed from the public endpoint');
  assert.ok(js.includes("page === 'server'"), 'opening the server page must start its auto-refresh');
  assert.ok(js.includes('stopWorkspaceServerAutoRefresh'), 'leaving the server page must stop its auto-refresh');
  assert.ok(js.includes('#workspace-public-stat-total'), 'public stats poller must also update the workspace stats');
  assert.match(css, /\.workspace-server-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3/);
  assert.match(css, /\.workspace-stats-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4/);

  const adminOnlyNav = [...html.matchAll(/<a[^>]*class="nav-item hidden"[^>]*href="#([^"]+)"/g)].map((m) => m[1]);
  assert.ok(!adminOnlyNav.includes('server') && !adminOnlyNav.includes('bots'), 'server and bots must not be hidden nav items');
  assert.ok(!js.includes("href=\"#server\"]')?.classList.add('hidden'"), 'no code may hide the server nav item');
  assert.ok(!js.includes("href=\"#bots\"]')?.classList.add('hidden'"), 'no code may hide the bots nav item');
});

test('workspace server page shows the full detail set, and info updates use the accurate five-category taxonomy with SVG posters', async () => {
  const html = await fs.readFile(path.join(ROOT, 'public/index.html'), 'utf8');
  const js = await fs.readFile(path.join(ROOT, 'public/app.js'), 'utf8');
  const css = await fs.readFile(path.join(ROOT, 'public/style.css'), 'utf8');
  const updates = JSON.parse(await fs.readFile(path.join(ROOT, 'public/info-updates.json'), 'utf8'));

  for (const id of ['workspace-server-cpu-model-value', 'workspace-server-cpu-cores-value', 'workspace-server-cpu-load-value', 'workspace-server-ram-free-value', 'workspace-server-ram-used-value', 'workspace-server-heap-value', 'workspace-server-disk-total-value', 'workspace-server-disk-used-value', 'workspace-server-disk-free-value', 'workspace-server-started-value', 'workspace-server-system-uptime-value', 'workspace-server-clock-value']) {
    assert.ok(html.includes(`id="${id}"`), `workspace server page must have #${id}`);
    assert.ok(js.includes(`#${id}`), `workspace server refresh must fill #${id}`);
  }
  assert.match(css, /\.workspace-server-subhead/);
  assert.match(css, /\.workspace-server-grid > div\.is-wide\s*\{\s*grid-column:\s*1 \/ -1/);

  const allowedTags = ['Fitur baru', 'Perubahan', 'Perbaikan', 'Fitur dihapus', 'Tampilan'];
  const slug = (tag) => tag.toLowerCase().replace(/\s+/g, '-');
  assert.ok(Array.isArray(updates.updates) && updates.updates.length > 0, 'info updates must not be empty');
  for (const update of updates.updates) {
    assert.ok(allowedTags.includes(update.tag), `tag "${update.tag}" of "${update.title}" must be one of ${allowedTags.join(', ')}`);
  }
  const fallbackItems = [...html.matchAll(/<li class="info-update-item" data-tag="([^"]+)"><div class="info-update-poster"><span class="info-update-poster-mark">([\s\S]*?)<\/span><\/div><div class="info-update-body"><h4>([^<]+)<\/h4>/g)];
  assert.equal(fallbackItems.length, updates.updates.length, 'static fallback must list the same entries as info-updates.json');
  fallbackItems.forEach((match, index) => {
    const update = updates.updates[index];
    assert.equal(match[1], slug(update.tag), `fallback item ${index + 1} data-tag must match the JSON tag of "${update.title}"`);
    assert.match(match[2], /<svg[^>]*>/, `fallback item ${index + 1} poster must contain an SVG icon, not a text glyph`);
    assert.equal(match[3].replace(/&amp;/g, '&'), update.title, `fallback item ${index + 1} title must match the JSON title`);
  });
  for (const tagSlug of ['perubahan', 'perbaikan', 'fitur-dihapus', 'tampilan']) {
    assert.ok(css.includes(`[data-tag="${tagSlug}"]`), `style.css must style the ${tagSlug} poster and tag pill`);
    assert.ok(js.includes(tagSlug), `app.js must know the ${tagSlug} tag icon`);
  }
  assert.match(css, /\.info-update-poster\{[^}]*background:linear-gradient\(160deg,#3ee69a,#1d9e63\)/, 'fitur-baru uses the default green poster');
  assert.ok(js.includes(`'fitur-baru'`), 'app.js must know the fitur-baru tag icon');
  assert.match(css, /\.info-update-poster-mark svg\s*\{[^}]*width:\s*44px/);
});

test('every server stat cell shows a contextual SVG icon next to its label', async () => {
  const html = await fs.readFile(path.join(ROOT, 'public/index.html'), 'utf8');
  const css = await fs.readFile(path.join(ROOT, 'public/style.css'), 'utf8');
  const icons = [...html.matchAll(/<span class="server-cell-icon" aria-hidden="true"><svg[^>]*>/g)];
  assert.equal(icons.length, 24, 'every server stat cell (6 login preview + 18 workspace) must have an SVG icon');
  for (const label of ['Status', 'Uptime panel', 'RAM proses', 'RAM sistem', 'Node.js', 'CPU / load', 'Model CPU', 'Core', 'Load 1 / 5 / 15 mnt', 'RAM sistem bebas', 'RAM sistem terpakai', 'Heap proses (pakai / total)', 'Total', 'Terpakai', 'Bebas', 'Server mulai', 'Uptime sistem', 'Jam server']) {
    assert.ok(html.includes(`</span>${label}</span>`), `server cell "${label}" must keep its label right after the icon`);
  }
  const workspaceIcons = [...html.matchAll(/<section id="server"[\s\S]*?<\/section>/g)][0][0].match(/server-cell-icon/g) || [];
  assert.equal(workspaceIcons.length, 18, 'workspace server page must have 18 icons');
  const loginIcons = [...html.matchAll(/<section class="mobile-info-panel mobile-server-panel"[\s\S]*?<\/section>/g)][0][0].match(/server-cell-icon/g) || [];
  assert.equal(loginIcons.length, 6, 'login server preview must have 6 icons');
  assert.match(css, /\.server-cell-icon svg\s*\{[^}]*width:\s*13px/);
});
