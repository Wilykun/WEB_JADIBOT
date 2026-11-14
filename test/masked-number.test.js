import test from 'node:test';
import assert from 'node:assert/strict';
import { maskedNumber } from '../server/pairing-manager.js';

test('keeps a short prefix and suffix while masking the middle with four stars', () => {
  assert.equal(maskedNumber('62898700004324'), '628987****4324');
});

test('normalizes punctuation and keeps at least four hidden digits', () => {
  assert.equal(maskedNumber('+62 (812) 3456-7890'), '628123****890');
  assert.equal(maskedNumber('6281234'), '62****4');
});

test('does not expose short or empty values', () => {
  assert.equal(maskedNumber('1234'), '••••');
  assert.equal(maskedNumber(''), '••••••');
});
