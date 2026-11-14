import test from 'node:test';
import assert from 'node:assert/strict';
import { maskedEmail } from '../server/pairing-manager.js';

test('masks the local part after four characters and keeps the domain', () => {
  assert.equal(maskedEmail('bangwily@gmail.com'), 'bang****@gmail.com');
  assert.equal(maskedEmail('wilykun1994id@proton.me'), 'wily****@proton.me');
});

test('shows only the first character for a short local part', () => {
  assert.equal(maskedEmail('ab@gmail.com'), 'a****@gmail.com');
  assert.equal(maskedEmail('wily@gmail.com'), 'w****@gmail.com');
  assert.equal(maskedEmail('a@gmail.com'), 'a****@gmail.com');
});

test('returns invalid or empty values unchanged', () => {
  assert.equal(maskedEmail(''), '');
  assert.equal(maskedEmail('notanemail'), 'notanemail');
  assert.equal(maskedEmail('@gmail.com'), '@gmail.com');
  assert.equal(maskedEmail('user@'), 'user@');
});
