import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function read(file) {
  return fs.readFile(path.join(ROOT, file), 'utf8');
}

test('fitur bot mode cards form a single-open accordion with the active mode open by default', async () => {
  const html = await read('public/index.html');
  const js = await read('public/app.js');
  const css = await read('public/style.css');

  // Tiga kartu mode, masing-masing punya tombol header + isi detail.
  const cards = [...html.matchAll(/<article class="plan-card[^"]*" data-(?:plan-card="([^"]+)"|online-addon="true")/g)];
  assert.equal(cards.length, 3, 'there must be exactly three mode cards');
  assert.ok(html.includes('data-plan-card="readonly"'), 'Read Only mode card must exist');
  assert.ok(html.includes('data-plan-card="readonly_readsw"'), 'Read Only + ReadSW mode card must exist');
  assert.ok(html.includes('data-online-addon="true"'), 'Online 24 Jam addon card must exist');

  const toggles = [...html.matchAll(/<button class="plan-card-toggle" type="button" aria-expanded="(true|false)" aria-controls="(plan-body-[a-z0-9-]+)">/g)];
  assert.equal(toggles.length, 3, 'each mode card must have exactly one header toggle button');
  const bodies = [...html.matchAll(/<div class="plan-card-body" id="(plan-body-[a-z0-9-]+)">/g)];
  assert.equal(bodies.length, 3, 'each mode card must have exactly one collapsible body');
  for (const toggle of toggles) {
    assert.ok(bodies.some((body) => body[1] === toggle[2]), `toggle aria-controls ${toggle[2]} must point at a real card body`);
  }
  // Hanya satu kartu terbuka bawaan: kartu unggulan Read Only + ReadSW.
  const openToggles = toggles.filter((toggle) => toggle[1] === 'true');
  assert.equal(openToggles.length, 1, 'exactly one card must be open by default');
  assert.equal(openToggles[0][2], 'plan-body-readonly-readsw', 'the featured Read Only + ReadSW card must be the default open card');
  const collapsedCards = [...html.matchAll(/<article class="plan-card[^"]*is-collapsed"/g)];
  assert.equal(collapsedCards.length, 2, 'the other two cards must start collapsed');

  // Satu terbuka dalam satu waktu: mengetuk header menutup semua kartu lain dulu.
  assert.ok(js.includes('function setPlanCardOpen'), 'accordion must have a single open/close helper');
  assert.ok(js.includes("document.querySelectorAll('.plan-card').forEach((other) => setPlanCardOpen(other, false))"), 'opening a card must close every other card first');
  assert.ok(js.includes('if (card && !wasOpen) setPlanCardOpen(card, true)'), 'tapping the open card must close it again');
  assert.ok(js.includes('planAccordionUserTouched = true'), 'a manual toggle must mark the accordion as user-controlled');
  assert.ok(js.includes("const planToggle = event.target.closest('.plan-card-toggle')"), 'the toggle must be handled in the global click delegation');

  // Mode aktif terbuka bawaan: sinkronisasi memilih kartu yang sedang selected.
  assert.ok(js.includes('function syncPlanAccordionDefault'), 'the default open card must follow the active mode');
  assert.ok(js.includes("cards.find((card) => card.classList.contains('selected'))"), 'the selected card must win the default open slot');
  assert.ok(js.includes('if (planAccordionUserTouched) return'), 'the default sync must never override a manual toggle');
  assert.ok(js.includes('syncPlanAccordionDefault();'), 'applyBot must sync the default open card');
  assert.ok(js.includes('renderPlanCardStatuses();'), 'applyBot must refresh the header status pills');

  // Buka/tutup beranimasi tanpa lompatan layout, dan hormat ke reduced motion.
  assert.ok(css.includes('.plan-card-body { display: grid;'), 'the card body must use the grid-rows collapse pattern');
  assert.ok(css.includes('.plan-card.is-collapsed .plan-card-body { grid-template-rows: 0fr;'), 'a collapsed card must shrink its body to zero rows');
  assert.ok(css.includes('.plan-card.is-collapsed .plan-chevron'), 'the chevron must rotate on the collapsed card');
  assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'), 'reduced motion must disable the accordion transition');
  assert.ok(css.includes('.plan-grid[data-page-view="mode"] .plan-card-title'), 'the card title must keep its mobile font size');
});

test('accordion header status pill reads the same selected state as the activation button', async () => {
  const html = await read('public/index.html');
  const js = await read('public/app.js');
  const css = await read('public/style.css');

  // Setiap header membawa penanda status yang dibaca dari state mode yang sama.
  const pills = [...html.matchAll(/<span class="plan-status" data-plan-status>/g)];
  assert.equal(pills.length, 3, 'each mode card header must carry a status pill');
  assert.ok(js.includes('function renderPlanCardStatuses'), 'status pills must be rendered from one function');
  assert.ok(js.includes("const active = card.classList.contains('selected')"), 'the pill must read the same selected class the activation button uses');
  assert.ok(js.includes("status.textContent = active ? '✓ Aktif' : 'Tidak aktif'"), 'the pill must say Aktif when the mode is active and Tidak aktif otherwise');
  assert.ok(js.includes("status.classList.toggle('is-active', active)"), 'the pill must get the active style only when the mode is active');
  assert.ok(css.includes('.plan-status.is-active'), 'the active pill must have its own green style');

  // Tombol Aktifkan tetap ada di dalam isi detail, dan seksi Delay & emoji tidak masuk accordion.
  assert.ok(html.includes('data-plan="readonly"'), 'Read Only activation button must stay inside the card body');
  assert.ok(html.includes('data-plan="readonly_readsw"'), 'Read Only + ReadSW activation button must stay inside the card body');
  assert.ok(html.includes('data-online24-toggle'), 'Online 24 Jam toggle must stay inside the card body');
  const bodyCount = [...html.matchAll(/<div class="plan-card-body"/g)].length;
  assert.equal(bodyCount, 3, 'only the three mode cards may have an accordion body, not the Delay & emoji section');
  assert.ok(html.includes('id="story-settings-title">Delay &amp; emoji ReadSW</h2>'), 'the Delay & emoji section must still exist unchanged');
});
