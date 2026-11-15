import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
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
