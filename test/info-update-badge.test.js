import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Info Update unread badge is stored per account on the server, never shared', async () => {
  const server = await fs.readFile(path.join(ROOT, 'server/index.js'), 'utf8');
  const js = await fs.readFile(path.join(ROOT, 'public/app.js'), 'utf8');
  const css = await fs.readFile(path.join(ROOT, 'public/style.css'), 'utf8');

  assert.ok(server.includes("route === 'GET /api/info-updates/seen'"), 'the server must expose the seen-marker read endpoint');
  assert.ok(server.includes("route === 'POST /api/info-updates/seen'"), 'the server must expose the seen-marker write endpoint');
  assert.ok(server.includes('function readInfoUpdateSeen(user)'), 'the seen marker must be read per logged-in user');
  assert.ok(server.includes('function writeInfoUpdateSeen(user, seen)'), 'the seen marker must be written per logged-in user');
  assert.ok(server.includes("INFO_UPDATE_SEEN_FILE = 'info-update-seen.json'"), 'the seen marker must live in its own file inside the account folder');
  assert.ok(server.includes('function canonicalAccountFolder(user)'), 'writes must target the canonical role folder, never a legacy folder');
  assert.ok(server.includes('ADMIN_ACCOUNT_DIR : MEMBER_ACCOUNT_DIR'), 'the canonical folder must split admin and member accounts');
  assert.match(server, /writeInfoUpdateSeen[\s\S]{0,400}canonicalAccountFolder\(user\)/, 'the seen file must be written through the canonical folder helper');
  assert.ok(server.includes('atomicWriteJson(path.join(dir, INFO_UPDATE_SEEN_FILE)'), 'the seen file must be written atomically');
  assert.ok(server.includes('current.day === seen.day && current.time === seen.time && current.title === seen.title'), 'an unchanged marker must not rewrite the file');
  assert.ok(server.includes("allowRateLimit(`info-updates-seen:${user.id}`"), 'the seen endpoint must be rate limited per user');
  assert.ok(server.includes("if (!seen.day || !seen.time || !seen.title) return sendError(res, 400, 'Penanda update tidak lengkap.')"), 'an incomplete marker must be rejected');

  assert.ok(js.includes('function countUnreadInfoUpdates(updates, seen)'), 'the client must count unread updates from the seen marker');
  assert.ok(js.includes('function renderInfoUpdateBadge(count)'), 'the client must render the badge on the Info Update menu item');
  assert.ok(js.includes("document.querySelector('.side-nav .nav-item[href=\"#infoupdate\"]')"), 'the badge must sit on the Info Update nav item');
  assert.ok(js.includes("badge?.remove()"), 'the badge must disappear when nothing is unread');
  assert.ok(js.includes("count > 99 ? '99+'"), 'the badge must cap at 99+');
  assert.ok(js.includes('function refreshInfoUpdateBadge()'), 'the client must refresh the badge from the server');
  assert.ok(js.includes("fetch('/api/info-updates/seen'"), 'the badge must read the per-account marker from the server');
  assert.ok(js.includes('function markInfoUpdatesSeen(updates)'), 'opening the Info Update page must mark everything as read');
  assert.ok(js.includes('void markInfoUpdatesSeen(updates);'), 'the mark-as-read must run after the update list renders');
  assert.ok(js.includes("method: 'POST', credentials: 'same-origin'"), 'the mark-as-read must post the newest entry to the server');
  assert.ok(js.includes('void refreshInfoUpdateBadge();'), 'the badge must refresh after login and when navigating away from Info Update');

  assert.match(css, /\.nav-badge\{[^}]*margin-left:\s*auto;[^}]*min-width:\s*20px;[^}]*background:linear-gradient\(135deg,#3ee69a,#22bd78\)/, 'the badge must be a green pill at the right end of the menu item');
  assert.match(css, /@media\(max-width:820px\)\{[\s\S]*?\.sidebar:not\(\.is-open\) \.nav-badge\{[^}]*width:\s*8px;[^}]*height:\s*8px/, 'the badge must shrink to a dot on the collapsed icon rail');
});

function countUnreadInfoUpdates() {
  const js = readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
  const match = js.match(/function countUnreadInfoUpdates\(updates, seen\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'fungsi countUnreadInfoUpdates harus bisa diekstrak dari app.js');
  return eval(`(${match[0].replace('function countUnreadInfoUpdates', 'function')})`);
}

const TITLE_67 = 'Status pemilik & bot di Rank Bot, plus halaman Aktivitas Akun';
const DAY_67 = 'Rabu, 18 Nov 2026';

test('amandemen entri harus memunculkan badge lagi: jam baru tidak cocok dengan penanda lama', () => {
  const count = countUnreadInfoUpdates();
  const updates = [
    { day: DAY_67, time: '19.46 WIB', title: TITLE_67 },
    { day: DAY_67, time: '13.10 WIB', title: 'Rank Bot kini memberi tahu saat ada yang menyalip' },
  ];
  // Penanda lama dari sebelum amandemen (jam 15.45): entri #67 yang jamnya
  // naik ke 19.46 harus terhitung belum dibaca, supaya tanda seru muncul lagi.
  const seenLama = { day: DAY_67, time: '15.45 WIB', title: TITLE_67 };
  assert.equal(count(updates, seenLama), 1, 'entri yang diamandemen (jam berubah) harus terhitung 1 belum dibaca');
  // Setelah halaman Info Update dibuka, penanda ikut jam baru: badge hilang.
  const seenBaru = { day: DAY_67, time: '19.46 WIB', title: TITLE_67 };
  assert.equal(count(updates, seenBaru), 0, 'penanda yang cocok dengan jam baru harus berarti sudah dibaca');
  // Tanpa penanda sama sekali, semua entri terhitung belum dibaca.
  assert.equal(count(updates, null), 2, 'tanpa penanda, semua entri harus terhitung belum dibaca');
  // Entri di bawah penanda tidak terhitung.
  const seenTengah = { day: DAY_67, time: '13.10 WIB', title: 'Rank Bot kini memberi tahu saat ada yang menyalip' };
  assert.equal(count(updates, seenTengah), 1, 'hanya entri di atas penanda yang terhitung belum dibaca');
});
