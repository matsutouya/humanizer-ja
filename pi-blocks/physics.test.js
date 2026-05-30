'use strict';

/**
 * Minimal zero-dependency test runner for the colliding-blocks engine.
 * Run with: node physics.test.js
 */

const assert = require('assert');
const { simulate, elasticVelocities, countForDigits } = require('./physics');

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

// --- elastic collision conserves momentum and kinetic energy ---
test('elastic collision conserves momentum and energy', () => {
  const m1 = 1;
  const m2 = 100000;
  const v1 = 0;
  const v2 = -1;
  const [u1, u2] = elasticVelocities(m1, v1, m2, v2);

  const pBefore = m1 * v1 + m2 * v2;
  const pAfter = m1 * u1 + m2 * u2;
  assert.ok(Math.abs(pBefore - pAfter) < 1e-9, 'momentum conserved');

  const eBefore = 0.5 * m1 * v1 * v1 + 0.5 * m2 * v2 * v2;
  const eAfter = 0.5 * m1 * u1 * u1 + 0.5 * m2 * u2 * u2;
  assert.ok(Math.abs(eBefore - eAfter) < 1e-6, 'kinetic energy conserved');
});

// --- equal masses simply swap velocities ---
test('equal masses swap velocities', () => {
  const [u1, u2] = elasticVelocities(2, 5, 2, -3);
  assert.strictEqual(u1, -3);
  assert.strictEqual(u2, 5);
});

// --- the famous digit counts for ratios 100^n ---
test('mass ratio 1 gives 3 collisions', () => {
  assert.strictEqual(simulate({ smallMass: 1, bigMass: 1 }).collisions, 3);
});

test('100^n ratios reproduce the digits of pi', () => {
  assert.strictEqual(countForDigits(0), 3); // "3"
  assert.strictEqual(countForDigits(1), 31); // "31"
  assert.strictEqual(countForDigits(2), 314); // "314"
  assert.strictEqual(countForDigits(3), 3141); // "3141"
  assert.strictEqual(countForDigits(4), 31415); // "31415"
});

// --- the headline run from the task: 1 kg vs 100000 kg ---
test('1 kg vs 100000 kg gives 993 collisions', () => {
  // 100000 is not a power of 100 (it is 10^5), so this is NOT pi digits.
  // The closed form is floor(pi / arctan(sqrt(1/100000))) = 993.
  const { collisions } = simulate({ smallMass: 1, bigMass: 100000 });
  const closedForm = Math.floor(Math.PI / Math.atan(Math.sqrt(1 / 100000)));
  assert.strictEqual(collisions, 993);
  assert.strictEqual(collisions, closedForm);
});

// --- simulation always terminates with the blocks separating ---
test('blocks separate when the simulation ends', () => {
  const { smallVelocity, bigVelocity, cappedOut } = simulate({
    smallMass: 1,
    bigMass: 10000,
  });
  assert.ok(!cappedOut, 'did not hit the safety cap');
  // Final state: both moving right, big block no slower than small block.
  assert.ok(bigVelocity >= 0, 'big block moving away from wall');
  assert.ok(bigVelocity >= smallVelocity - 1e-9, 'blocks no longer closing');
});

console.log(`\n${passed} tests passed.`);
