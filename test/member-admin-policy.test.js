import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BANNED_LOGIN_NOTICE,
  isBannedAccount,
  isMainAdminUser,
  memberAdminPolicyError,
  normalizeBanReason,
  withMemberLifecycleLock,
} from '../server/member-admin-policy.js';

test('only an authenticated admin can manage a member account', () => {
  assert.equal(memberAdminPolicyError(null, { role: 'member' }).status, 401);
  assert.equal(memberAdminPolicyError({ role: 'member' }, { role: 'member' }).status, 403);
  assert.equal(memberAdminPolicyError({ role: 'admin' }, { role: 'member' }), null);
});

test('admin actions reject missing accounts and admin targets', () => {
  assert.equal(memberAdminPolicyError({ role: 'admin' }, null).status, 404);
  assert.equal(memberAdminPolicyError({ role: 'admin' }, { role: 'admin' }).status, 400);
});

test('Admin Utama (config.json) bisa mengelola admin biasa; admin biasa tidak bisa menyentuh admin mana pun', () => {
  const bootstrap = 'wilykun';
  const mainAdmin = { role: 'admin', username: 'WILYKUN' };
  const regularAdmin = { role: 'admin', username: 'adminbaru' };
  const member = { role: 'member', username: 'membera' };
  assert.equal(isMainAdminUser(mainAdmin, bootstrap), true);
  assert.equal(isMainAdminUser(regularAdmin, bootstrap), false);
  assert.equal(isMainAdminUser({ role: 'member', username: 'wilykun' }, bootstrap), false);
  assert.equal(isMainAdminUser(mainAdmin, ''), false);
  assert.equal(memberAdminPolicyError(mainAdmin, regularAdmin, bootstrap), null);
  assert.equal(memberAdminPolicyError(mainAdmin, member, bootstrap), null);
  assert.equal(memberAdminPolicyError(regularAdmin, member, bootstrap), null);
  assert.equal(memberAdminPolicyError(regularAdmin, regularAdmin, bootstrap).status, 400);
  assert.equal(memberAdminPolicyError(regularAdmin, mainAdmin, bootstrap).status, 400);
  assert.equal(memberAdminPolicyError(mainAdmin, mainAdmin, bootstrap).status, 400);
});

test('ban reason removes control characters, collapses whitespace, and is capped', () => {
  assert.equal(normalizeBanReason('  spam\n\tberulang  '), 'spam berulang');
  assert.equal(normalizeBanReason('x'.repeat(300)).length, 240);
  assert.equal(normalizeBanReason(null), '');
});

test('ban state is opt-in and login notice is explicit', () => {
  assert.equal(isBannedAccount({ banned: true }), true);
  assert.equal(isBannedAccount({ banned: false }), false);
  assert.equal(isBannedAccount({}), false);
  assert.match(BANNED_LOGIN_NOTICE, /diblokir oleh admin/i);
});

test('member lifecycle operations for one account run in sequence', async () => {
  const events = [];
  const start = withMemberLifecycleLock('member-a', async () => {
    events.push('start-begin');
    await new Promise((resolve) => setTimeout(resolve, 15));
    events.push('start-end');
  });
  const ban = withMemberLifecycleLock('member-a', async () => { events.push('ban'); });
  await Promise.all([start, ban]);
  assert.deepEqual(events, ['start-begin', 'start-end', 'ban']);
});

test('member lifecycle operations for different accounts do not block each other', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let secondStarted = false;
  const first = withMemberLifecycleLock('member-a', async () => { await gate; });
  const second = withMemberLifecycleLock('member-b', async () => { secondStarted = true; });
  await second;
  assert.equal(secondStarted, true);
  release();
  await first;
});
