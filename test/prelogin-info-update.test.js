import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const appJs = await fs.readFile(path.join(ROOT, 'public', 'app.js'), 'utf8');
const indexHtml = await fs.readFile(path.join(ROOT, 'public', 'index.html'), 'utf8');
const styleCss = await fs.readFile(path.join(ROOT, 'public', 'style.css'), 'utf8');

test('info update sebelum login: kartu menu + tab + panel tersedia', () => {
  assert.match(indexHtml, /data-mobile-info-menu="infoupdate"/);
  assert.match(indexHtml, /mobile-info-menu-card--wide/);
  assert.match(indexHtml, /<strong>Info Update<\/strong>/);
  assert.match(indexHtml, /data-mobile-info-tab="infoupdate">Info Update</);
  assert.match(indexHtml, /data-mobile-info-panel="infoupdate"/);
  assert.match(indexHtml, /id="mobile-info-update-list"/);
  assert.match(indexHtml, /id="mobile-info-update-pagination"/);
});

test('info update sebelum login: setMobileInfoView mengenal infoupdate dan memuat daftar', () => {
  assert.match(appJs, /'menu', 'overview', 'developer', 'server', 'bots', 'infoupdate'/);
  assert.match(appJs, /if \(selected === 'infoupdate'\) void loadMobileInfoUpdates\(\);/);
  assert.match(appJs, /async function loadMobileInfoUpdates\(\)/);
  assert.match(appJs, /document\.querySelector\('#mobile-info-update-list'\)/);
});

test('info update sebelum login: daftar dibaca dari file publik yang sama, tanpa penanda sudah dibaca', () => {
  const start = appJs.indexOf('async function loadMobileInfoUpdates()');
  const end = appJs.indexOf('function renderMobileInfoUpdatePagination()', start);
  assert.ok(start > 0 && end > start, 'fungsi loadMobileInfoUpdates ditemukan');
  const body = appJs.slice(start, end);
  assert.match(body, /fetch\('\/info-updates\.json', \{ cache: 'no-store' \}\)/);
  assert.match(body, /createInfoUpdateItem\(update\)/);
  assert.ok(!body.includes('markInfoUpdatesSeen'), 'sebelum login tidak ada penanda sudah dibaca (butuh akun)');
});

test('info update sebelum login: daftar di dalam panel tetap terpisah dari daftar sebelum login', () => {
  assert.match(appJs, /document\.querySelector\('#infoupdate \.info-update-list'\)/);
  assert.ok(!indexHtml.includes('class="info-update-list" id="mobile-info-update-list"'), 'daftar sebelum login tidak memakai kelas daftar di dalam panel');
  assert.match(appJs, /function createInfoUpdateItem\(update\)/);
  assert.match(appJs, /list\.append\(createInfoUpdateItem\(update\)\)/);
});

test('info update sebelum login: kartu lebar penuh dan tab keenam tertata rapih', () => {
  assert.match(styleCss, /#auth-view\.hide-art \.mobile-info-tabs:not\(\[hidden\]\) \{ display: grid; grid-template-columns: auto repeat\(5, minmax\(0, 1fr\)\);/);
  assert.match(styleCss, /\.mobile-info-menu-card--wide \{ display: flex; align-items: center; gap: 12px; grid-column: 1 \/ -1; min-height: 64px; \}/);
  assert.match(styleCss, /#auth-view\.hide-art \.mobile-info-menu-card--wide \{ display: flex; align-items: center; gap: 12px; grid-column: 1 \/ -1; min-height: 64px; \}/);
  assert.match(styleCss, /\.mobile-info-update-list\{list-style:none;margin:16px 0 0;padding:0;display:grid;gap:10px\}/);
});
