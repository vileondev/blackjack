// Rode com: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { createShoe, handValue, handLabel, isBlackjack, hiLo, settle, dealerShouldHit, basicStrategy } from '../js/engine.js';

const C = (s) => s.split(' ').map((x) => ({ r: x.slice(0, -1), s: x.slice(-1) }));

test('sapato tem 52 cartas por baralho e composição correta', () => {
  for (const n of [1, 2, 6, 8]) {
    const shoe = createShoe(n);
    assert.equal(shoe.length, 52 * n);
    const aces = shoe.filter((c) => c.r === 'A').length;
    assert.equal(aces, 4 * n);
    assert.equal(new Set(shoe.map((c) => c.r + c.s)).size, 52);
  }
});

test('Hi-Lo do sapato completo soma zero', () => {
  assert.equal(createShoe(6).reduce((a, c) => a + hiLo(c), 0), 0);
});

test('valores de mão, soft e blackjack', () => {
  assert.deepEqual(handValue(C('As 6h')), { total: 17, soft: true });
  assert.deepEqual(handValue(C('As 6h Kd')), { total: 17, soft: false });
  assert.deepEqual(handValue(C('As Ad 9c')), { total: 21, soft: true });
  assert.deepEqual(handValue(C('Kd Qs 5h')), { total: 25, soft: false });
  assert.ok(isBlackjack(C('As Kd')));
  assert.ok(!isBlackjack(C('7s 7d 7h')));
  assert.equal(handLabel(C('As 6h')), '7/17');
  assert.equal(handLabel(C('As Kd')), 'Blackjack');
  assert.equal(handLabel(C('10s 6h')), '16');
});

test('mesa para em todo 17', () => {
  assert.ok(dealerShouldHit(C('10s 6h')));
  assert.ok(!dealerShouldHit(C('As 6h')));
  assert.ok(!dealerShouldHit(C('10s 7h')));
});

test('pagamentos', () => {
  assert.deepEqual(settle(C('As Kd'), C('10s 9h'), 10), { outcome: 'blackjack', payout: 25 });
  assert.deepEqual(settle(C('As Kd'), C('Ad Qh'), 10), { outcome: 'push', payout: 10 });
  assert.deepEqual(settle(C('10s 9h'), C('Ad Qh'), 10), { outcome: 'lose', payout: 0 });
  assert.deepEqual(settle(C('10s 9h'), C('10d 8h'), 10), { outcome: 'win', payout: 20 });
  assert.deepEqual(settle(C('10s 9h'), C('10d 9c'), 10), { outcome: 'push', payout: 10 });
  assert.deepEqual(settle(C('10s 9h 5c'), C('10d 6c 9h'), 10), { outcome: 'lose', payout: 0 });
  assert.deepEqual(settle(C('10s 7h'), C('10d 6c 9h'), 10), { outcome: 'win', payout: 20 });
});

test('estratégia básica', () => {
  assert.equal(basicStrategy(C('5s 6h'), C('6d')[0], true), 'double');
  assert.equal(basicStrategy(C('5s 6h'), C('Ad')[0], true), 'hit');
  assert.equal(basicStrategy(C('10s 6h'), C('10d')[0], true), 'hit');
  assert.equal(basicStrategy(C('10s 6h'), C('5d')[0], true), 'stand');
  assert.equal(basicStrategy(C('As 7h'), C('5d')[0], true), 'double');
  assert.equal(basicStrategy(C('As 7h'), C('5d')[0], false), 'stand');
  assert.equal(basicStrategy(C('As 7h'), C('9d')[0], true), 'hit');
  assert.equal(basicStrategy(C('10s 2h'), C('2d')[0], true), 'hit');
});
