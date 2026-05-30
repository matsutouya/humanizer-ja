'use strict';

/**
 * Galperin's billiard ("colliding blocks compute pi").
 *
 * Setup (1-D, frictionless, perfectly elastic):
 *
 *      |                  ┌──────┐
 *      |        ┌──┐      │      │  <-- big block, mass M, moving LEFT
 *      |        │m │      │  M   │
 *   ───┴────────┴──┴──────┴──────┴────────────►  x
 *     wall      small block (mass m, at rest)
 *
 * A big block slides toward a small block that sits between it and a wall.
 * Every block-block and block-wall impact is perfectly elastic, so kinetic
 * energy and (for block-block hits) momentum are conserved. Galperin proved
 * that when M / m = 100^n the total number of collisions equals the first
 * (n + 1) digits of pi:
 *
 *     M/m = 1          ->            3 collisions   ( "3" )
 *     M/m = 100        ->           31 collisions   ( "31" )
 *     M/m = 10_000     ->          314 collisions   ( "314" )
 *     M/m = 1_000_000  ->        3_141 collisions   ( "3141" )
 *
 * This module is an exact, event-driven simulator: instead of stepping time
 * forward in fixed ticks (which would miss or double-count impacts), it
 * computes the exact time of the next collision, jumps there, resolves it,
 * and repeats. That keeps the collision count exact regardless of step size.
 */

/**
 * Resolve a perfectly elastic 1-D collision between two masses.
 *
 *   u1 = ((m1 - m2) v1 + 2 m2 v2) / (m1 + m2)
 *   u2 = ((m2 - m1) v2 + 2 m1 v1) / (m1 + m2)
 *
 * Conserves both momentum and kinetic energy.
 */
function elasticVelocities(m1, v1, m2, v2) {
  const total = m1 + m2;
  return [
    ((m1 - m2) * v1 + 2 * m2 * v2) / total,
    ((m2 - m1) * v2 + 2 * m1 * v1) / total,
  ];
}

/**
 * Run the simulation.
 *
 * @param {object} [opts]
 * @param {number} [opts.smallMass=1]      mass of the small block (m)
 * @param {number} [opts.bigMass=100000]   mass of the big block (M)
 * @param {number} [opts.bigVelocity=-1]   initial velocity of the big block
 *                                         (negative = moving toward the wall)
 * @param {number} [opts.maxCollisions=1e8] safety cap to avoid runaway loops
 * @param {function} [opts.onCollision]    optional callback invoked on every
 *                                         collision with a snapshot of state
 * @returns {{collisions:number, smallVelocity:number, bigVelocity:number,
 *            cappedOut:boolean}}
 */
function simulate(opts = {}) {
  const {
    smallMass = 1,
    bigMass = 100000,
    bigVelocity = -1,
    maxCollisions = 1e8,
    onCollision = null,
  } = opts;

  if (smallMass <= 0 || bigMass <= 0) {
    throw new Error('masses must be positive');
  }
  if (bigVelocity >= 0) {
    throw new Error('bigVelocity must be negative (block moves toward the wall)');
  }

  // Geometry. The wall sits at x = 0; blocks are tracked by their left edge.
  // Exact positions are irrelevant to the collision *count* (only the ordering
  // of events matters), but tracking them makes the event scheduling rigorous.
  const width = 1;
  let xSmall = 4; // left edge of the small block
  let xBig = 8; // left edge of the big block
  let vSmall = 0;
  let vBig = bigVelocity;

  let collisions = 0;
  let cappedOut = false;

  while (collisions < maxCollisions) {
    // Time until the small block's left edge reaches the wall (x = 0).
    const tWall = vSmall < 0 ? -xSmall / vSmall : Infinity;

    // Time until the small block's right edge meets the big block's left edge.
    const gap = xBig - (xSmall + width);
    const closing = vSmall - vBig; // > 0 means the gap is shrinking
    const tBlocks = closing > 0 ? gap / closing : Infinity;

    // No upcoming collision => the blocks separate forever. We are done.
    if (tWall === Infinity && tBlocks === Infinity) break;

    const t = Math.min(tWall, tBlocks);

    // Advance every body to the moment of impact.
    xSmall += vSmall * t;
    xBig += vBig * t;

    if (tBlocks <= tWall) {
      [vSmall, vBig] = elasticVelocities(smallMass, vSmall, bigMass, vBig);
    } else {
      vSmall = -vSmall; // bounce off the wall
    }

    collisions += 1;
    if (onCollision) {
      onCollision({ collisions, xSmall, xBig, vSmall, vBig });
    }
  }

  if (collisions >= maxCollisions) cappedOut = true;

  return { collisions, smallVelocity: vSmall, bigVelocity: vBig, cappedOut };
}

/**
 * Convenience wrapper: count collisions for a mass ratio of 100^n, which
 * yields the first (n + 1) digits of pi.
 *
 * @param {number} n  exponent (digits returned = n + 1)
 * @returns {number}  collision count
 */
function countForDigits(n) {
  const ratio = Math.pow(100, n);
  return simulate({ smallMass: 1, bigMass: ratio }).collisions;
}

module.exports = { simulate, elasticVelocities, countForDigits };
