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
