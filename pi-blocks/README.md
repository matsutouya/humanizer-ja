# π by colliding blocks

A tiny, exact physics engine that **computes the digits of π by smashing two
blocks together** — Galperin's billiard, popularised by 3Blue1Brown.

> Self-contained demo living alongside the Humanizer JP skill. It has no
> dependencies and does not touch the rest of the repo.

## The idea

Put a small block (mass `m`) between a wall and a big block (mass `M`). Shove the
big block toward the wall. Every block-block and block-wall impact is perfectly
elastic (kinetic energy and momentum conserved). Count the collisions:

```
      |                  ┌──────┐
      |        ┌──┐      │      │  ← big block (M), moving left
      |        │m │      │  M   │
   ───┴────────┴──┴──────┴──────┴────────►  x
     wall      small block (m, at rest)
```

When `M / m = 100ⁿ`, the **total number of collisions is the first `n + 1`
digits of π**:

| M / m         | collisions | digits of π |
|---------------|-----------:|-------------|
| 1             | 3          | `3`         |
| 100           | 31         | `31`        |
| 10 000        | 314        | `314`       |
| 1 000 000     | 3 141      | `3141`      |
| 100 000 000   | 31 415     | `31415`     |

## Run it

```bash
cd pi-blocks
node pi-blocks.js                 # headline run: 1 kg vs 100000 kg
node pi-blocks.js --ratio 1000000 # any mass ratio
node pi-blocks.js --table         # the 100ⁿ → π table above
npm test                          # run the test suite
```

## About the "1 kg vs 100 000 kg" run

The viral prompt asks for **1 kg vs 100 000 kg**. Note that `100 000 = 10⁵`,
which is *not* a power of 100, so this particular ratio does **not** spell out a
clean run of π's digits. It produces **993** collisions, matching the closed
form `floor(π / arctan(√(m/M)))`. To actually read off π's digits you need a
power of 100 (1, 100, 10 000, 1 000 000, …) — use `--table` or `--ratio`.

## How it works

`physics.js` is an **event-driven** simulator: rather than stepping time in
fixed ticks (which would miss or double-count impacts), it solves for the exact
time of the next collision, jumps there, applies the elastic-collision
equations, and repeats until the blocks separate forever. That keeps the
collision count exact at any scale.

- `simulate(opts)` — run a simulation, returns the collision count and final state
- `elasticVelocities(m1, v1, m2, v2)` — the 1-D elastic collision solver
- `countForDigits(n)` — collisions for `M/m = 100ⁿ` (= first `n + 1` digits of π)
