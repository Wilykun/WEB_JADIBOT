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
