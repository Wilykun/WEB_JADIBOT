import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function read(file) {
  return fs.readFile(path.join(ROOT, file), 'utf8');
}

function mediaBlocks(css, query) {
  const blocks = [];
  let from = 0;
  for (;;) {
    const start = css.indexOf(query, from);
    if (start === -1) return blocks;
    let depth = 0;
    let i = start;
    while (i < css.length) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
      i += 1;
    }
    blocks.push(css.slice(start, i + 1));
    from = i + 1;
  }
}

test('whatsapp connection badge stays visible on a 360px phone with a short label', async () => {
  const html = await read('public/index.html');
  const js = await read('public/app.js');
  const css = await read('public/style.css');

  // Markup membawa dua label: panjang untuk layar lebar, ringkas untuk HP.
  assert.ok(html.includes('id="connection-badge"'), 'the full connection badge label must exist');
  assert.ok(html.includes('id="connection-badge-short"'), 'the short connection badge label must exist');
  assert.ok(html.includes('aria-hidden="true">TAUTKAN</span>'), 'the short label must start with the disconnected text');

  // Penyebab hilangnya lencana: blok topbar 360px dulu menyembunyikan .demo-badge.
  const narrowBlocks = mediaBlocks(css, '@media (max-width: 360px)');
  assert.ok(narrowBlocks.length > 0, 'there must be 360px media blocks');
  const badgeBlocks = narrowBlocks.filter((block) => block.includes('.demo-badge'));
  assert.equal(badgeBlocks.length, 1, 'exactly one 360px block styles the badge');
  assert.ok(!badgeBlocks[0].includes('.demo-badge { display: none'), 'the 360px block must no longer hide the connection badge');
  assert.ok(badgeBlocks[0].includes('.topbar-right .demo-badge { padding:'), 'the 360px block must keep the badge compact instead');
  // Nama akun di sebelah avatar memang tetap disembunyikan di 360px; itu bukan keluhan.
  assert.ok(badgeBlocks[0].includes('#top-user-name'), 'the 360px block must still hide the username next to the avatar');

  // Layar sempit memakai label ringkas agar lencana tetap muat dan terbaca.
  assert.ok(css.includes('#connection-badge-short { display: none; }'), 'the short label must stay hidden on wide screens');
  assert.match(css, /\.demo-badge #connection-badge \{\s*display: none;/, 'phones must hide the long label');
  assert.match(css, /\.demo-badge #connection-badge-short \{\s*display: inline;/, 'phones must show the short label instead');

  // Kedua label selalu diisi dari status koneksi yang sama, jadi akurat realtime.
  assert.ok(js.includes("document.querySelector('#connection-badge-short').textContent = badgeShortText"), 'renderLinkGate must fill the short label too');
  assert.ok(js.includes("'WA ONLINE'"), 'the short label must say WA ONLINE when WhatsApp is linked');
  assert.ok(js.includes("'TERTAUT'"), 'the short label must say TERTAUT when a session is linked but not online');
  assert.ok(js.includes("'WHATSAPP ONLINE'"), 'the long label must still say WHATSAPP ONLINE on wide screens');
});

test('info update entry for the badge fix and mode accordion matches the JSON and fallback', async () => {
  const html = await read('public/index.html');
  const data = JSON.parse(await read('public/info-updates.json'));

  assert.equal(data.updatedAt, '2026-11-17T07:33:00+07:00', 'updatedAt must equal the newest entry time');
  const newest = data.updates[0];
  assert.equal(newest.title, 'Lencana WhatsApp Online kembali tampil di HP dan kartu mode jadi spoiler', 'the newest entry must describe both fixes');
  assert.equal(newest.tag, 'Fitur baru', 'the newest entry must use the Fitur baru display tag');
  assert.equal(newest.day, 'Selasa, 17 Nov 2026', 'the newest entry day must match');
  assert.equal(newest.time, '07.33 WIB', 'the newest entry time must match');
  assert.ok(newest.description.includes('360px'), 'the description must name the 360px cause');
  assert.ok(newest.description.includes('WA Online'), 'the description must name the short label');
  assert.ok(newest.description.includes('spoiler'), 'the description must name the accordion change');
  assert.equal(data.updates.length, 49, 'the list must grow by exactly one entry');

  // Fallback statis di index.html harus sama persis dengan entri JSON terbaru.
  assert.ok(html.includes('<li class="info-update-item" data-tag="fitur-baru">'), 'the fallback must carry the fitur-baru slug for the newest entry');
  assert.ok(html.includes('<h4>Lencana WhatsApp Online kembali tampil di HP dan kartu mode jadi spoiler</h4>'), 'the fallback title must match the JSON title');
  assert.ok(html.includes('Selasa, 17 Nov 2026 · 07.33 WIB'), 'the fallback meta must match the JSON day and time');
});
