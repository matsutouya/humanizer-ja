#!/usr/bin/env node
'use strict';

/**
 * CLI for the colliding-blocks pi calculator.
 *
 *   node pi-blocks.js                 # the headline run: 1 kg vs 100000 kg
 *   node pi-blocks.js --ratio 1000000 # custom mass ratio
 *   node pi-blocks.js --table         # show 100^n ratios reproducing pi
 *
 * Flags:
 *   --small <kg>   small block mass   (default 1)
 *   --big <kg>     big block mass     (default 100000)
 *   --ratio <r>    shortcut for --small 1 --big <r>
 *   --table        print the 100^n -> digits-of-pi table
 */

const { simulate, countForDigits } = require('./physics');

function parseArgs(argv) {
  const args = { table: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--table') args.table = true;
    else if (a === '--small') args.small = Number(argv[++i]);
    else if (a === '--big') args.big = Number(argv[++i]);
    else if (a === '--ratio') args.ratio = Number(argv[++i]);
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

const PI = '3.14159265358979';

function printTable() {
  console.log('Mass ratio M/m = 100^n reproduces the digits of pi:\n');
  console.log('  n |        M / m | collisions | first digits of pi');
  console.log('  --+--------------+------------+-------------------');
  for (let n = 0; n <= 6; n++) {
    const ratio = Math.pow(100, n);
    const c = countForDigits(n);
    const digits = PI.replace('.', '').slice(0, n + 1);
    console.log(
      `  ${n} | ${String(ratio).padStart(12)} | ${String(c).padStart(10)} | ${digits}`
    );
  }
  console.log('\n(pi = 3.14159265358979...)');
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  if (args.help) {
    console.log('Usage: node pi-blocks.js [--ratio R | --small m --big M] [--table]');
    return;
  }

  if (args.table) {
    printTable();
    return;
  }

  const small = args.small ?? 1;
  const big = args.big ?? args.ratio ?? 100000;

  console.log(`Colliding blocks: small = ${small} kg, big = ${big} kg`);
  console.log(`Mass ratio M/m   = ${big / small}\n`);

  const t0 = Date.now();
  const { collisions, cappedOut } = simulate({ smallMass: small, bigMass: big });
  const ms = Date.now() - t0;

  console.log(`Total collisions = ${collisions}${cappedOut ? ' (hit safety cap!)' : ''}`);
  console.log(`Computed in ${ms} ms`);

  // If the ratio is exactly 100^n, the count *is* the leading digits of pi.
  const ratio = big / small;
  let n = 0;
  let power = 1;
  while (power < ratio) {
    power *= 100;
    n += 1;
  }
  if (power === ratio) {
    const piDigits = PI.replace('.', '').slice(0, n + 1);
    console.log(`\nThis ratio is 100^${n}, so the count encodes pi: ${piDigits}`);
  } else {
    // General case: collisions ~= floor(pi / arctan(sqrt(m/M))).
    const approx = Math.floor(Math.PI / Math.atan(Math.sqrt(small / big)));
    console.log(
      `\nNot a power of 100, so this isn't a clean run of pi digits.` +
        `\nClosed form floor(pi / arctan(sqrt(m/M))) = ${approx} (matches the simulation).`
    );
  }
}

main();
