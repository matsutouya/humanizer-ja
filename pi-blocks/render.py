#!/usr/bin/env python3
"""Render the colliding-blocks pi simulation to an animated GIF.

Runs the SAME exact event-driven simulation as physics.js (analytic next-event
times, perfectly elastic collisions), records the trajectory, then samples it at
even time steps to draw frames with PIL.
"""
import math
from PIL import Image, ImageDraw, ImageFont

def simulate_trajectory(small_mass, big_mass, big_velocity=-1.0):
    """Return list of (t, x_small_left, x_big_left, collisions) at each event,
    plus segment velocities, so we can interpolate positions between events."""
    width = 1.0
    x_small = 4.0
    x_big = 8.0
    v_small = 0.0
    v_big = big_velocity

    t = 0.0
    collisions = 0
    # events: (time, x_small, x_big, v_small_after, v_big_after, collisions_after)
    events = [(0.0, x_small, x_big, v_small, v_big, 0)]
    while True:
        t_wall = -x_small / v_small if v_small < 0 else math.inf
        gap = x_big - (x_small + width)
        closing = v_small - v_big
        t_blocks = gap / closing if closing > 0 else math.inf
        if t_wall == math.inf and t_blocks == math.inf:
            break
        dt = min(t_wall, t_blocks)
        t += dt
        x_small += v_small * dt
        x_big += v_big * dt
        if t_blocks <= t_wall:
            tot = small_mass + big_mass
            nv_small = ((small_mass - big_mass) * v_small + 2 * big_mass * v_big) / tot
            nv_big = ((big_mass - small_mass) * v_big + 2 * small_mass * v_small) / tot
            v_small, v_big = nv_small, nv_big
        else:
            v_small = -v_small
        collisions += 1
        events.append((t, x_small, x_big, v_small, v_big, collisions))
    return events, width

def state_at(events, width, t):
    """Interpolate (x_small, x_big, collisions) at absolute time t."""
    # find segment
    for i in range(len(events) - 1):
        t0 = events[i][0]
        t1 = events[i + 1][0]
        if t0 <= t <= t1:
            _, xs, xb, vs, vb, _ = events[i]
            dt = t - t0
            return xs + vs * dt, xb + vb * dt, events[i][5]
    # after last event: blocks drift with last velocities
    last = events[-1]
    t0, xs, xb, vs, vb, c = last
    dt = t - t0
    return xs + vs * dt, xb + vb * dt, c

def render(small_mass, big_mass, out_path, n_frames=170, scale=70):
    events, width = simulate_trajectory(small_mass, big_mass)
    total_collisions = events[-1][5]
    t_end = events[-1][0] * 1.06  # small tail so it glides off-screen

    W, H = 900, 360
    floor_y = 250
    wall_x = 70

    # world x -> pixel x
    def px(x):
        return wall_x + x * scale

    big_w_units = 2.2  # visual size of big block (mass is huge, keep it sane)
    small_w_units = 0.9

    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 28)
        font_big = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 56)
        font_sm = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 20)
    except Exception:
        font = ImageFont.load_default()
        font_big = font
        font_sm = font

    frames = []
    for f in range(n_frames):
        t = t_end * f / (n_frames - 1)
        xs, xb, collisions = state_at(events, width, t)

        img = Image.new("RGB", (W, H), (17, 18, 24))
        d = ImageDraw.Draw(img)

        # floor + wall
        d.line([(0, floor_y), (W, floor_y)], fill=(70, 74, 92), width=3)
        d.rectangle([wall_x - 14, 70, wall_x, floor_y], fill=(120, 128, 150))

        # small block (its left edge is xs)
        sx0 = px(xs)
        sx1 = px(xs + small_w_units)
        sh = 48
        d.rectangle([sx0, floor_y - sh, sx1, floor_y], fill=(86, 196, 255))
        d.text(((sx0 + sx1) / 2 - 18, floor_y - sh - 26), f"{small_mass}kg",
               fill=(170, 225, 255), font=font_sm)

        # big block (left edge xb)
        bx0 = px(xb)
        bx1 = px(xb + big_w_units)
        bh = 110
        d.rectangle([bx0, floor_y - bh, bx1, floor_y], fill=(255, 138, 92))
        d.text((bx0 + 10, floor_y - bh - 26), f"{big_mass}kg",
               fill=(255, 200, 170), font=font_sm)

        # collision counter (the headline)
        d.text((wall_x, 24), "collisions:", fill=(150, 156, 178), font=font)
        d.text((wall_x + 190, 6), f"{collisions}", fill=(120, 255, 170), font=font_big)

        ratio = big_mass // small_mass if small_mass else big_mass
        d.text((W - 360, 24), f"M/m = {ratio}", fill=(150, 156, 178), font=font)
        d.text((W - 360, 60), f"-> pi digits: {total_collisions}",
               fill=(120, 255, 170), font=font)

        frames.append(img)

    # Hold the final frame a bit longer.
    frames.extend([frames[-1]] * 16)

    frames[0].save(out_path, save_all=True, append_images=frames[1:],
                   duration=45, loop=0, optimize=True)
    print(f"wrote {out_path}: {len(frames)} frames, {total_collisions} collisions")

if __name__ == "__main__":
    render(1, 100, "/home/user/humanizer-ja/pi-blocks/demo.gif")
