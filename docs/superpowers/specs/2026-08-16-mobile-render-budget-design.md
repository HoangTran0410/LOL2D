# Mobile Render Budget Design

## Goal

Keep crowded fights responsive on touch devices without changing simulation, hit detection, spell results, or desktop visual quality.

## Evidence

At 844×390, device scale factor 3, and Chrome 6× CPU throttle:

- 25 champions in view: frame p95 10.7ms, about 60 FPS.
- 25 champions plus 1,000 particles: frame p95 14.1ms.
- 25 champions plus 3,000 particles across 11 systems: frame p95 19.2ms and about 56 FPS.

The extra time was inside `ObjectManager.draw()` and repeated p5 `circle`/`ellipse` calls. The main canvas and fog overlay already use pixel density 1. Fog is already buffered; buffering moving particles would add a full clear and composite without removing their per-frame redraw.

## Design

### Particle rendering

Touch mode gets one global budget of 800 rendered particles per frame. `ObjectManager.draw()` totals particles in visible systems, derives one proportional sampling ratio, and asks each system to draw an evenly distributed subset. Particle updates and stored particles remain unchanged, so effect timing and gameplay are identical. Pointer mode draws every particle.

`ParticleSystem.update()` removes dead particles with in-place compaction instead of repeated `splice()`, avoiding array shifts and garbage-collection spikes during effect expiry.

### Visual culling

The object quadtree must keep allied units indexed by their vision area for fog-of-war. Drawing adds a second exact body check for `AttackableUnit`, against the camera expanded by 100 screen pixels. This stops units whose vision square touches the camera—but whose art and health bar are still offscreen—from issuing draw calls.

### Avatar alpha

`AttackableUnit.drawAvatar()` uses Canvas2D `globalAlpha` instead of p5 `tint()`. `tint()` rebuilds image pixels through a scratch canvas; `globalAlpha` is native compositing and preserves the same transparency.

## Constraints

- No new dependency, WebGL migration, tile renderer, or adaptive quality controller.
- Desktop visuals remain unchanged.
- Mobile degradation applies only above 800 visible particles and samples the full effect spatially.
- All behavior changes receive failing tests before production edits.

## Verification

- Focused Vitest tests for sampling, global budget, compaction, culling, and avatar alpha.
- Full `npm test`, `npm run typecheck`, and `npm run build`.
- Repeat the same 6× CPU stress benchmark before and after; record frame p95 and FPS.
