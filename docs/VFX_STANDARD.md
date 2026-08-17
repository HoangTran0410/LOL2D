# The VFX bar

The whole standard, so a briefing can link here instead of making everyone read
a 400-line spell. `Fizz_E.ts` (`Fizz_E_Object.draw`) is still the worked example
when you want one — read it once, not once per task.

## The five rules

1. **Unique per champion.** Never reuse another champion's geometry or motif.
   Jarvan's walls are earthen crags, not Anivia's ice. If two champions would
   draw the same shape, one of them needs a new shape — adding an `AoePulse`
   style is cheaper than sharing one.
2. **No instant pop-in.** Every effect animates: a windup, a travel, a growth.
   A spell that appears at full opacity on frame one has no telegraph, and the
   player has nothing to react to.
3. **Impacts spawn something.** `PredefinedParticleSystems` from
   `gameObject/helpers/ParticleSystem` for a legacy `onSpellCast` spell;
   `ImpactEffect` from `game/vfx/` *only* from a `castSpec.vfx` factory. Ground
   shockwaves fire on landing, never at cast.
4. **Damage scales to a ~100 HP pool.** Normal 15–35, ultimate 40–60. Ranges and
   missile speeds scale to the canvas (~1600×1600 map, skillshots 350–500), not
   to raw PC wiki values.
5. **Multi-hit protection.** A dash or continuous pass hits each unit at most
   once, tracked in a `Set` or array.

## The shape of a good `draw()`

- One normalized `t = age / lifeTime`, and every value derived from it. No bare
  frame counters deciding sizes.
- Ease, don't lerp linearly: `1 - (1-t)*(1-t)` for a snap-out, `t*t` for a
  wind-in. Linear motion is what makes an effect look like a placeholder.
- Layers, not one shape: a filled body, a hard rim on the *actual* hit radius so
  the hitbox is not a guess, a leading edge that moves, and a flash that is gone
  in the first fifth of the life.
- **Seed randomness once**, in `onAdded()`, into an array field. `random()`
  called inside `draw()` re-rolls every frame and flickers instead of animating.
- Comments say *why the player needs to read this*, not what the code does.

## Two traps that are invisible to `tsc`

**`getDisplayBoundingBox()` is mandatory** on any `SpellObject` that paints past
its own centre. The default derives the box from `visionRadius`, which is `0` —
a zero-area box — and `ObjectManager.draw` picks what to draw by querying the
tree with it. Your 400px cone then vanishes the moment its *centre* leaves the
camera while its damage lands normally.

```ts
getDisplayBoundingBox() {
  const r = this.radius + 40;
  return this.squareDisplayBoundingBox(r * 2);
}
```

The helper takes the full edge length and memoises on `(position, size)`; the
box is read at least three times a frame per object, so a hand-rolled
`new Rectangle` is an allocation on every one of them. Build the `Rectangle`
yourself only when the box is *not* a square around your own centre — a path, a
tether back to the caster, a span over several victims — because those depend on
state the cache key does not watch.

**Never assign `dashBuff.onUpdate`.** `Dash` implements its movement in
`Dash.prototype.onUpdate`, so an instance assignment replaces the frame rather
than hooking it and the champion stands still. Use `onDashUpdate`.

## An effect that rides a body

Use `attachTo(unit, buff)`, open `update()` with
`if (this.dropIfAttachmentLost()) return;`, and sync
`this.position.set(owner.position.x, owner.position.y)` every frame — otherwise
it keeps drawing on the corpse and reappears at the spawn point.

Anything reaching beyond the caster's own body must be a `SpellObject`, not
`castSpec.vfx`: `Champion.draw()` is skipped when the caster is culled or
fogged, so hanging a long effect off it makes the damage land invisibly.
