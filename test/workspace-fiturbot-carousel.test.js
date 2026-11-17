import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function read(file) {
  return fs.readFile(path.join(ROOT, file), 'utf8');
}

test('mode cards form a horizontal snap carousel on mobile with dot indicators', async () => {
  const html = await read('public/index.html');
  const js = await read('public/app.js');
  const css = await read('public/style.css');

  // Wadah titik indikator ada dengan tepat tiga titik, satu per kartu mode.
  assert.ok(html.includes('<div class="plan-carousel-dots hidden"'), 'the carousel must have a dot indicator container');
  const dots = [...html.matchAll(/<button class="plan-carousel-dot[^"]*" type="button" data-plan-dot="(\d)" aria-label="([^"]+)">/g)];
  assert.equal(dots.length, 3, 'there must be exactly three carousel dots, one per mode card');
  assert.deepEqual(dots.map((dot) => dot[1]), ['0', '1', '2'], 'dots must map to the three cards in order');
  assert.ok(dots[0][2].includes('Read Only') && dots[2][2].includes('Online 24 Jam'), 'each dot must name its card');
  const activeDots = dots.filter((dot) => dot[0].includes('is-active'));
  assert.equal(activeDots.length, 1, 'exactly one dot must start active');
  assert.equal(activeDots[0][1], '1', 'the featured Read Only + ReadSW card must own the active dot by default');

  // Carousel hanya hidup di <=560px: wadah geser horizontal dengan snap, tiap kartu 85%.
  assert.ok(css.includes('.plan-carousel-dots { display: none; }'), 'dots must be hidden by default so desktop never shows them');
  assert.ok(css.includes('@media (max-width: 560px) {\n  .plan-grid[data-page-view="mode"] {\n    display: flex;'), 'the grid must become a flex row only inside the mobile media query');
  assert.ok(css.includes('overflow-x: auto;'), 'the mobile grid must scroll horizontally');
  assert.ok(css.includes('scroll-snap-type: x mandatory;'), 'swiping must snap to a card');
  assert.ok(css.includes('flex: 0 0 85%;'), 'each card must take 85% of the viewport so the next card peeks at the edge');
  assert.ok(css.includes('scroll-snap-align: start;'), 'cards must snap to the start edge');
  assert.ok(css.includes('scrollbar-width: none;'), 'the native scrollbar must be hidden while scrolling still works');
  assert.ok(css.includes('.plan-grid[data-page-view="mode"]::-webkit-scrollbar { display: none; }'), 'the webkit scrollbar must be hidden too');
  assert.ok(css.includes('.plan-grid[data-page-view="mode"]::after'), 'a trailing flex spacer must let the last card snap fully into view');
  assert.ok(css.includes('flex: 0 0 15%;'), 'the spacer must be 15% wide so the last card reaches its snap point');
  assert.ok(css.includes('.plan-carousel-dots.is-hidden { display: none; }'), 'dots must be hideable when they would confuse');

  // Desktop tetap accordion vertikal: grid tiga kolom di CSS dasar, bukan carousel.
  assert.ok(css.includes('.plan-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px}'), 'desktop must keep the three-column grid');
  assert.ok(!css.includes('@media (min-width: 561px)'), 'no desktop media query must touch the carousel');

  // Logika carousel: posisi awal mengikuti kartu aktif, titik mengikuti scroll, kartu terbuka mengikuti kartu terlihat.
  assert.ok(js.includes("window.matchMedia('(max-width: 560px)')"), 'the carousel must only activate at the mobile breakpoint');
  assert.ok(js.includes('function planCarouselActive'), 'carousel activation must be a single check');
  assert.ok(js.includes('function scrollToPlanCard'), 'scrolling to a card must be a single helper');
  assert.ok(js.includes('function planCarouselMostVisibleCard'), 'the most visible card must be computed from scroll position');
  assert.ok(js.includes('function syncPlanCarouselDots'), 'dots must be synced from the visible cards');
  assert.ok(js.includes('function syncPlanCarouselOpenCard'), 'the open card must follow the visible card');
  assert.ok(js.includes('function syncPlanCarouselPosition'), 'the carousel must be positioned when the mode page opens');
  assert.ok(js.includes("planCarouselGrid?.addEventListener('scroll'"), 'dots and open card must update while scrolling');
  assert.ok(js.includes("planCarouselGrid?.addEventListener('scrollend'"), 'dots and open card must settle when scrolling ends');
  assert.ok(js.includes("if (page === 'mode')") && js.includes('syncPlanCarouselPosition();'), 'opening the mode page must position the carousel on the open card');
  assert.ok(js.includes("scrollToPlanCard(openCard, 'auto')"), 'the initial position must be instant, without a jarring animation');
  assert.ok(js.includes("scrollToPlanCard(card, 'smooth')"), 'opening a card from its header must scroll it into view');
  assert.ok(js.includes("dot.setAttribute('aria-current', 'true')"), 'the active dot must be exposed to assistive tech');
  assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'), 'reduced motion must disable the dot transition');
});

test('fitur bot search and category pills count the real items and filter them', async () => {
  const html = await read('public/index.html');
  const js = await read('public/app.js');
  const css = await read('public/style.css');

  // Kotak pencarian + empat pil dengan ikon dan hitungan, memakai class generik yang sama seperti Log privat.
  assert.ok(html.includes('id="fiturbot-search"'), 'fitur bot must have a search input');
  assert.ok(html.includes('placeholder="Cari mode, delay, emoji…"'), 'the search placeholder must match the fitur bot context');
  assert.ok(html.includes('data-filter-scope="fiturbot"'), 'the filter controls must be scoped to fitur bot');
  for (const key of ['all', 'mode', 'delay', 'emoji']) {
    assert.ok(html.includes(`data-fiturbot-filter="${key}"`), `there must be a pill for ${key}`);
    assert.ok(html.includes(`data-filter-count="${key}"`), `the ${key} pill must carry a count element`);
  }
  assert.ok(html.includes('data-fiturbot-filters'), 'the pills must live in one filter group');
  assert.ok(html.includes('>Mode<') && html.includes('>Delay<') && html.includes('>Emoji<'), 'pill labels must name the fitur bot categories');

  // Hitungan pil akurat dan dihitung dari item di DOM: Semua 6, Mode 3, Delay 2, Emoji 1.
  const items = [...html.matchAll(/data-fiturbot-item data-fiturbot-category="(mode|delay|emoji)"/g)];
  assert.equal(items.length, 6, 'there must be exactly six filterable items on the page');
  const byCategory = { mode: 0, delay: 0, emoji: 0 };
  for (const item of items) byCategory[item[1]] += 1;
  assert.equal(byCategory.mode, 3, 'Mode must count the three mode cards');
  assert.equal(byCategory.delay, 2, 'Delay must count the two delay settings');
  assert.equal(byCategory.emoji, 1, 'Emoji must count the single emoji reaction setting');
  assert.ok(js.includes('function fiturbotFilterCounts'), 'counts must be computed from the items in the DOM');
  assert.ok(js.includes('counts.all += 1') && js.includes('counts[item.dataset.fiturbotCategory] += 1'), 'counts must tally every item by its category');
  assert.ok(js.includes('function updateFiturbotFilterCounts'), 'counts must be written back to the pills');

  // Pencarian "delay" hanya cocok dengan dua pengaturan delay, bukan dengan kartu mode.
  const searches = [...html.matchAll(/data-fiturbot-search="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(searches.length, 6, 'every filterable item must carry its own search text');
  const delayMatches = searches.filter((text) => text.includes('delay'));
  assert.equal(delayMatches.length, 2, 'only the two delay settings may match a delay search');
  assert.ok(delayMatches.every((text) => text.includes('delay minimum') || text.includes('delay maksimum')), 'the delay matches must be the delay settings');
  const emojiMatches = searches.filter((text) => text.includes('emoji'));
  assert.ok(emojiMatches.length >= 2, 'an emoji search must match the emoji setting and the emoji-capable modes');

  // Filter kategori + pencarian digabung, item tidak cocok disembunyikan, pesan kosong jelas.
  assert.ok(js.includes('function fiturbotItemMatches'), 'filtering must test each item against the active category and query');
  assert.ok(js.includes("fiturbotFilterCategory !== 'all'") && js.includes("item.dataset.fiturbotCategory !== fiturbotFilterCategory"), 'category filter must compare the item category');
  assert.ok(js.includes("(item.dataset.fiturbotSearch || '').includes(fiturbotFilterQuery)"), 'search must match the item search text');
  assert.ok(js.includes("item.classList.toggle('is-filtered-out', !match)"), 'non-matching items must be marked filtered out');
  assert.ok(html.includes('id="fiturbot-filter-empty"') && html.includes('Tidak ada fitur yang cocok. Ubah kata pencarian atau kategori.'), 'an empty message must exist for zero matches');
  assert.ok(js.includes("document.querySelector('#fiturbot-filter-empty')?.toggleAttribute('hidden', visibleCount !== 0)"), 'the empty message must show only when nothing matches');
  assert.ok(js.includes("document.querySelector('#fiturbot-search')?.addEventListener('input'"), 'typing must filter live');
  assert.ok(js.includes("document.querySelector('[data-fiturbot-filters]')?.addEventListener('click'"), 'tapping a pill must filter');

  // Seksi Delay & emoji dan wadah kartu ikut tersembunyi bila tidak ada isinya yang lolos filter.
  assert.ok(js.includes("storyCard?.classList.toggle('is-filtered-out', !storyVisible)"), 'the story settings section must hide when none of its settings match');
  assert.ok(js.includes("planCarouselGrid?.classList.toggle('is-filtered-out', !cardsVisible)"), 'the card grid must hide when no card matches');
  assert.ok(js.includes("document.querySelector('.emoji-pool-field')?.classList.toggle('is-filtered-out'"), 'the emoji pool must follow the emoji switch');
  assert.ok(css.includes('[data-fiturbot-item].is-filtered-out'), 'filtered-out fitur bot items must be hidden by CSS');
});

test('filtering on mobile keeps the carousel and dots consistent', async () => {
  const html = await read('public/index.html');
  const js = await read('public/app.js');
  const css = await read('public/style.css');

  // Titik indikator hanya menghitung kartu yang terlihat (bukan yang tersembunyi filter).
  assert.ok(js.includes('function planCarouselVisibleCards'), 'visible cards must exclude filtered-out cards');
  assert.ok(js.includes("!card.classList.contains('is-filtered-out')"), 'visibility must be decided by the filter class');
  assert.ok(js.includes('visible.length >= 2'), 'dots must only show when at least two cards are visible');
  assert.ok(js.includes("planCarouselDots.classList.toggle('is-hidden', !showDots)"), 'dots must hide when a single card is left');
  assert.ok(js.includes("dot.toggleAttribute('hidden', !card || card.classList.contains('is-filtered-out'))"), 'each dot must hide with its own card');
  assert.ok(js.includes('applyFiturbotFilter'), 'filtering must exist as one function');
  assert.ok(js.includes('syncPlanCarouselDots();') && js.includes('function applyFiturbotFilter'), 'applying a filter must resync the dots');

  // Bila kartu yang terbuka ikut tersembunyi, kartu pertama yang masih terlihat yang dibuka.
  assert.ok(js.includes("if (openCard?.classList.contains('is-filtered-out'))"), 'a hidden open card must be replaced');
  assert.ok(js.includes('const firstVisible = planCarouselVisibleCards()[0];'), 'the replacement must be the first visible card');
  assert.ok(js.includes('if (firstVisible) setPlanCardOpen(firstVisible, true);'), 'the first visible card must open');

  // Tidak ada scroll horizontal di luar carousel: hanya wadah carousel yang boleh overflow-x.
  assert.ok(css.includes('.plan-grid[data-page-view="mode"] {\n    display: flex;'), 'only the plan grid becomes a horizontal scroller');
  assert.ok(!css.includes('body{overflow-x'), 'the page body must not gain its own horizontal scroll');
  assert.ok(js.includes("planAccordionUserTouched = true;") && js.includes('function syncPlanCarouselOpenCard'), 'swiping to a card must count as user control of the accordion');
  assert.ok(html.includes('data-page-view="mode"'), 'carousel, dots, filter, and empty message must all live on the mode page');
});
