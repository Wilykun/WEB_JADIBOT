import test from 'node:test';
import assert from 'node:assert/strict';
import { DisconnectReason } from '@whiskeysockets/baileys';
import { classifyDisconnectCode, normalizePairingInput } from '../server/pairing-manager.js';

test('connection replaced (440) pauses automatic reconnect instead of looping', () => {
  assert.equal(classifyDisconnectCode(DisconnectReason.connectionReplaced), 'connection_replaced');
});

test('invalid WhatsApp credentials remain distinct from connection replacement', () => {
  assert.equal(classifyDisconnectCode(DisconnectReason.loggedOut), 'invalid_session');
  assert.equal(classifyDisconnectCode(DisconnectReason.badSession), 'invalid_session');
});

test('ordinary transient disconnects remain eligible for automatic reconnect', () => {
  assert.equal(classifyDisconnectCode(408), 'retry');
  assert.equal(classifyDisconnectCode(null), 'retry');
});


test('QR pairing accepts an empty phone and discards any supplied number', () => {
  assert.deepEqual(normalizePairingInput('qr', ''), { method: 'qr', phoneNumber: null });
  assert.deepEqual(normalizePairingInput('qr', 'not-a-phone'), { method: 'qr', phoneNumber: null });
});

test('Pairing Code requires and preserves a valid international number', () => {
  const result = normalizePairingInput('pairing', '6289681008412');
  assert.deepEqual(result, { method: 'pairing', phoneNumber: '6289681008412' });
  assert.throws(() => normalizePairingInput('pairing', ''), /Nomor tidak valid/);
});
