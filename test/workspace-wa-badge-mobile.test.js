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
  // Lencana harus jujur: sesi yang sedang menyambung ulang bukan "TERTAUT".
  assert.ok(js.includes("'MENYAMBUNG'"), 'the short label must say MENYAMBUNG while reconnecting');
  assert.ok(js.includes("'TERPUTUS'"), 'the short label must say TERPUTUS when disconnected');
  assert.ok(js.includes("'WHATSAPP ONLINE'"), 'the long label must still say WHATSAPP ONLINE on wide screens');
});

test('info update newest entry and positions match the JSON and fallback', async () => {
  const html = await read('public/index.html');
  const data = JSON.parse(await read('public/info-updates.json'));

  assert.equal(data.updatedAt, '2026-11-22T15:50:45+07:00', 'updatedAt must equal the newest entry time');
  const newest = data.updates[0];
  assert.equal(newest.title, 'Salip Rank Bot kini realtime di semua halaman, plus layar detailnya', 'the newest entry must describe the Obrolan mobile fix');
  assert.equal(newest.tag, 'Fitur baru', 'the newest entry must use the Fitur baru display tag');
  assert.equal(newest.day, 'Minggu, 22 Nov 2026', 'the newest entry day must match');
  assert.equal(newest.time, '15.50 WIB', 'the newest entry time must match');
  assert.equal(data.updates.length, 100, 'the list must grow by exactly five entries');

  // Fallback statis di index.html harus sama persis dengan entri JSON terbaru.
  assert.ok(html.includes('<li class="info-update-item" data-tag="fitur-baru">'), 'the fallback must carry the fitur-baru slug for the newest entry');
  assert.ok(html.includes("<h4>Bar atas ciut jadi ramping, typing ada avatar + nama, jam pesan AM/PM</h4>"), 'the fallback title must match the JSON title');
  assert.ok(html.includes('Sabtu, 21 Nov 2026 · 17.56 WIB'), 'the fallback meta must match the JSON day and time');

  // Entri notifikasi menu terkunci sebelumnya kini di posisi kedelapan belas beserta fallback-nya.
  const locked = data.updates[38];
  assert.equal(locked.title, 'Member yang mengetuk menu terkunci kini melihat notifikasi di layar', 'the locked-menu notice entry must stay fourteenth');
  assert.equal(locked.tag, 'Tampilan', 'the locked-menu notice entry must use the Tampilan display tag');
  assert.equal(locked.time, '07.25 WIB', 'the locked-menu notice entry time must match');
  assert.ok(html.includes('<h4>Member yang mengetuk menu terkunci kini melihat notifikasi di layar</h4>'), 'the fallback title must match the JSON title');
  assert.ok(html.includes('Rabu, 18 Nov 2026 · 07.25 WIB'), 'the fallback meta must match the JSON day and time');

  // Entri kartu Member ringkas sebelumnya kini di posisi kesembilan belas beserta fallback-nya.
  const compact = data.updates[39];
  assert.equal(compact.title, 'Tampilan Member kini lebih ringkas di HP', 'the compact Member entry must stay fifteenth');
  assert.equal(compact.tag, 'Tampilan', 'the compact Member entry must use the Tampilan display tag');
  assert.equal(compact.time, '05.50 WIB', 'the compact Member entry time must match');
  assert.ok(html.includes('<h4>Tampilan Member kini lebih ringkas di HP</h4>'), 'the fallback title must match the JSON title');
  assert.ok(html.includes('Rabu, 18 Nov 2026 · 05.50 WIB'), 'the fallback meta must match the JSON day and time');

  // Entri panel lebih cepat sebelumnya kini di posisi kedua puluh beserta fallback-nya.
  const perf = data.updates[40];
  assert.equal(perf.title, 'Panel kini memuat jauh lebih cepat', 'the faster panel entry must stay sixteenth');
  assert.equal(perf.tag, 'Perbaikan', 'the faster panel entry must use the Perbaikan display tag');
  assert.equal(perf.time, '21.50 WIB', 'the faster panel entry time must match');
  assert.ok(html.includes('<h4>Panel kini memuat jauh lebih cepat</h4>'), 'the fallback title must match the JSON title');
  assert.ok(html.includes('Selasa, 17 Nov 2026 · 21.50 WIB'), 'the fallback meta must match the JSON day and time');

  // Entri Rank Bot sebelumnya kini di posisi kedua puluh satu beserta fallback-nya.
  const rankbot = data.updates[41];
  assert.equal(rankbot.title, 'Halaman Rank Bot untuk melihat bot teraktif', 'the Rank Bot entry must stay seventeenth');
  assert.equal(rankbot.tag, 'Fitur baru', 'the Rank Bot entry must use the Fitur baru display tag');
  assert.equal(rankbot.time, '17.00 WIB', 'the Rank Bot entry time must match');
  assert.ok(html.includes('<h4>Halaman Rank Bot untuk melihat bot teraktif</h4>'), 'the fallback title must match the JSON title');
  assert.ok(html.includes('Selasa, 17 Nov 2026 · 17.00 WIB'), 'the fallback meta must match the JSON day and time');

  // Entri gerbang Fitur Bot sebelumnya kini di posisi kedua puluh beserta fallback-nya.
  const gate = data.updates[42];
  assert.equal(gate.title, 'Member belum tertaut tidak bisa masuk Fitur Bot', 'the gate entry must stay eighteenth');
  assert.equal(gate.tag, 'Perubahan', 'the gate entry must use the Perubahan display tag');
  assert.equal(gate.time, '16.45 WIB', 'the gate entry time must match');
  assert.ok(html.includes('<h4>Member belum tertaut tidak bisa masuk Fitur Bot</h4>'), 'the fallback title must match the JSON title');
  assert.ok(html.includes('Selasa, 17 Nov 2026 · 16.45 WIB'), 'the fallback meta must match the JSON day and time');

  // Entri notifikasi tautan di layar sebelumnya kini di posisi kedua puluh satu beserta fallback-nya.
  const linkNotice = data.updates[43];
  assert.equal(linkNotice.title, 'Pemberitahuan tautan WhatsApp kini muncul di layar', 'the link notice entry must stay nineteenth');
  assert.equal(linkNotice.tag, 'Tampilan', 'the link notice entry must use the Tampilan display tag');
  assert.equal(linkNotice.time, '15.50 WIB', 'the link notice entry time must match');
  assert.ok(html.includes('<h4>Pemberitahuan tautan WhatsApp kini muncul di layar</h4>'), 'the fallback title must match the JSON title');
  assert.ok(html.includes('Selasa, 17 Nov 2026 · 15.50 WIB'), 'the fallback meta must match the JSON day and time');

  // Entri notifikasi reaksi di layar sebelumnya kini di posisi kedua puluh satu dua beserta fallback-nya.
  const emojiNotice = data.updates[44];
  assert.equal(emojiNotice.title, 'Peringatan reaksi kini muncul sebagai notifikasi di layar', 'the emoji notice entry must stay twentieth');
  assert.equal(emojiNotice.tag, 'Tampilan', 'the emoji notice entry must use the Tampilan display tag');
  assert.equal(emojiNotice.time, '15.15 WIB', 'the emoji notice entry time must match');
  assert.ok(html.includes('<h4>Peringatan reaksi kini muncul sebagai notifikasi di layar</h4>'), 'the fallback title must match the JSON title');
  assert.ok(html.includes('Selasa, 17 Nov 2026 · 15.15 WIB'), 'the fallback meta must match the JSON day and time');

  // Entri peringatan reaksi sebelumnya kini di posisi kedua puluh satu tiga beserta fallback-nya.
  const emojiWarning = data.updates[45];
  assert.equal(emojiWarning.title, 'Peringatan bila ReadSW tidak bisa mengirim reaksi emoji', 'the emoji warning entry must stay twenty-first');
  assert.equal(emojiWarning.tag, 'Fitur baru', 'the emoji warning entry must use the Fitur baru display tag');
  assert.equal(emojiWarning.time, '14.55 WIB', 'the emoji warning entry time must match');
  assert.ok(html.includes('<h4>Peringatan bila ReadSW tidak bisa mengirim reaksi emoji</h4>'), 'the fallback title must match the JSON title');
  assert.ok(html.includes('Selasa, 17 Nov 2026 · 14.55 WIB'), 'the fallback meta must match the JSON day and time');

  // Entri kartu pengingat member sebelumnya kini di posisi kedua puluh satu empat beserta fallback-nya.
  const memberNotice = data.updates[46];
  assert.equal(memberNotice.title, 'Member yang belum tertaut kini diarahkan ke Pairing dari Fitur Bot', 'the member notice entry must stay twenty-second');
  assert.equal(memberNotice.tag, 'Fitur baru', 'the member notice entry must use the Fitur baru display tag');
  assert.equal(memberNotice.time, '14.35 WIB', 'the member notice entry time must match');
  assert.ok(html.includes('<h4>Member yang belum tertaut kini diarahkan ke Pairing dari Fitur Bot</h4>'), 'the fallback title must match the JSON title');
  assert.ok(html.includes('Selasa, 17 Nov 2026 · 14.35 WIB'), 'the fallback meta must match the JSON day and time');

  // Entri pratinjau tautan sebelumnya kini di posisi kedua puluh satu lima beserta fallback-nya.
  const ogPreview = data.updates[47];
  assert.equal(ogPreview.title, 'Tautan panel kini menampilkan pratinjau bergambar saat dibagikan', 'the link preview entry must stay twenty-third');
  assert.equal(ogPreview.tag, 'Tampilan', 'the link preview entry must use the Tampilan display tag');
  assert.equal(ogPreview.time, '14.15 WIB', 'the link preview entry time must match');
  assert.ok(html.includes('<li class="info-update-item" data-tag="tampilan">'), 'the fallback must carry the tampilan slug for the link preview entry');
  assert.ok(html.includes('<h4>Tautan panel kini menampilkan pratinjau bergambar saat dibagikan</h4>'), 'the fallback title must match the JSON title');
  assert.ok(html.includes('Selasa, 17 Nov 2026 · 14.15 WIB'), 'the fallback meta must match the JSON day and time');

  // Entri Kontrol Bot sebelumnya kini di posisi kedua puluh satu enam beserta fallback-nya.
  const kontrolBot = data.updates[48];
  assert.equal(kontrolBot.title, 'Halaman Kontrol Bot untuk admin', 'the Kontrol Bot entry must stay twenty-fourth');
  assert.equal(kontrolBot.tag, 'Fitur baru', 'the Kontrol Bot entry must use the Fitur baru display tag');
  assert.equal(kontrolBot.time, '13.30 WIB', 'the Kontrol Bot entry time must match');
  assert.ok(html.includes('<li class="info-update-item" data-tag="fitur-baru">'), 'the fallback must carry the fitur-baru slug for the Kontrol Bot entry');
  assert.ok(html.includes('<h4>Halaman Kontrol Bot untuk admin</h4>'), 'the fallback title must match the JSON title');
  assert.ok(html.includes('Selasa, 17 Nov 2026 · 13.30 WIB'), 'the fallback meta must match the JSON day and time');

  // Entri presence sebelumnya kini di posisi kedua puluh satu tujuh beserta fallback-nya.
  const presence = data.updates[49];
  assert.equal(presence.title, 'Status Pemilik kini pulih seketika saat kembali ke tab', 'the presence entry must stay twenty-fifth');
  assert.equal(presence.tag, 'Perbaikan', 'the presence entry must use the Perbaikan display tag');
  assert.equal(presence.day, 'Selasa, 17 Nov 2026', 'the presence entry day must match');
  assert.equal(presence.time, '12.50 WIB', 'the presence entry time must match');
  assert.ok(presence.description.includes('heartbeat'), 'the description must name the heartbeat');
  assert.ok(presence.description.includes('Pemilik'), 'the description must name the Pemilik status');
  assert.ok(presence.description.includes('tanpa muat ulang'), 'the description must promise no reload');
  assert.ok(html.includes('<li class="info-update-item" data-tag="perbaikan">'), 'the fallback must carry the perbaikan slug for the presence entry');
  assert.ok(html.includes('<h4>Status Pemilik kini pulih seketika saat kembali ke tab</h4>'), 'the fallback title must match the JSON title');
  assert.ok(html.includes('Selasa, 17 Nov 2026 · 12.50 WIB'), 'the fallback meta must match the JSON day and time');

  // Entri carousel sebelumnya tetap ada di posisi kedua puluh satu enam beserta fallback-nya.
  assert.equal(data.updates[50].title, 'Kartu mode Fitur Bot bisa digeser ke samping dan dicari di HP', 'the carousel entry must stay thirty-fourth');
  assert.ok(html.includes('<h4>Kartu mode Fitur Bot bisa digeser ke samping dan dicari di HP</h4>'), 'the carousel fallback must stay');
  assert.equal(data.updates[51].title, 'Lencana WhatsApp Online kembali tampil di HP dan kartu mode jadi spoiler', 'the badge fix entry must stay thirty-fifth');
  assert.ok(html.includes('<h4>Lencana WhatsApp Online kembali tampil di HP dan kartu mode jadi spoiler</h4>'), 'the badge fix fallback must stay');
});
