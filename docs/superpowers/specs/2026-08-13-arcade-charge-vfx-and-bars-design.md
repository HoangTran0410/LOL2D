# Arcade Charge VFX and Health Bar Design

**Date:** 2026-08-13  
**Status:** Awaiting written-spec review

## Goal

Make charged and channeled abilities readable and satisfying in motion, bring
outlier cooldowns and Janna Q dimensions back into LOL2D's arcade scale, and
render shields as visible extra effective health instead of an overlay. Restore
Lux R's layered prepare/fire visual that was lost during the runtime migration.

## Root causes

- `CastBar` and `CastTelegraph` render from the immutable cast-start context, so
  their visuals stay at the old position when a mobile caster moves.
- Varus Q and Pantheon Q assign an image to their missile objects, but the base
  missile has no sprite renderer; their collision objects therefore fly invisibly.
- Charged directional spells have no shared live range telegraph.
- Janna R has a source-game cooldown (`130s`) that conflicts with LOL2D's short,
  repeatable arcade loop.
- Janna Q uses a `240`-unit hitbox and `1100–1760` range while ordinary LOL2D
  projectiles are mostly `20–40` units wide and travel roughly `350–700` units.
- Shield rendering overlays current health and caps itself inside the original
  health container, hiding the shield's real size.
- Lux R's old spell object had separate prepare and fire phases. The migrated
  spell replaced both with the default `BeamRenderer`, which draws one opaque
  stroke and is disposed as soon as casting completes, so the release flash and
  fading energy strands no longer exist.

## Design

### Live charge and channel VFX

VFX that belongs to a unit receives a live position provider rather than reading
`CastContext.origin` forever. The cast context remains the immutable gameplay
snapshot; only presentation follows the caster.

Varus Q and held Pantheon Q display:

- a charge bar above the current health-bar position;
- a directional line/cone from the current caster position toward the current aim;
- a range endpoint that grows from minimum to maximum with charge progress.

Janna R displays its channel radius and progress around/above Janna's live
position. The gameplay healing zone and knockback origin remain fixed according to
the spell's current mechanics; the live UI communicates who is channeling without
silently moving the already-created gameplay area.

VFX draws with the champion layer so charge bars remain readable near the health
bar rather than being obscured by the unit sprite.

### Visible projectiles

Add a small reusable sprite drawing helper to the missile base. A missile with a
typed image handle can opt into sprite drawing with independent visual width,
height, and rotation while its collision `size` remains a gameplay value.

Varus Q renders an arrow and Pantheon Q renders a spear aligned to travel direction.
If an asset has not loaded yet, the renderer uses a simple colored fallback shape;
lazy loading must never make the projectile completely invisible.

### Arcade cooldown policy

Normalize every current spell cooldown above ten seconds:

- ordinary Q/W/E and utility spells target `3–6s`;
- ultimates target `8–10s`;
- no current spell may exceed `10s`.

This is an explicit LOL2D balance decision and does not track live League values.
Focused charged abilities use:

- Varus Q: `5s`;
- Pantheon Q: `4s` (`1.6s` after quick thrust, preserving its 40% rule);
- Janna Q: `5s`;
- Janna R: `10s`;
- Lux R: `10s`.

Other existing outliers are clamped or assigned the closest value within the same
arcade bands. A boundary test prevents new cooldowns above ten seconds.

### Janna Q scale

Janna Q keeps its two-phase charge/recast mechanics but uses the shared scale:

- collision and base visual width grow from `48` to `72`;
- center travel grows from `550` to `900`;
- damage remains `15–30` and airborne remains `0.5–1.25s`;
- charge duration remains `3s`;
- its circular charge meter and trail derive from the new visual size.

The tornado may render taller than its hitbox for readability, but its footprint,
collision, range preview, display bounds, and impact gust must remain proportional.

### Lux R layered beam

Keep Lux R's current runtime casting, locked direction, damage geometry, sight,
interrupt rules, and cast lock. Replace only its presentation with two explicit
visual phases inspired by the repository's pre-migration implementation:

- during the one-second prepare phase, show a restrained translucent lane whose
  width grows toward the damage width, plus a bright center guide;
- on release, create a short-lived (`400–500ms`) burst that remains visible after
  the runtime leaves `CASTING`;
- draw the burst as a broad cool-colored outer glow, a narrower bright core, and
  several animated white/cyan energy strands that contract and fade;
- keep all release geometry frozen at cast start, matching the actual hit check;
- keep visual layers independent from the `200`-unit damage width so glow does not
  change collision or targeting.

The release VFX is a presentation-only object/handle and never applies damage.
Lux R continues to create exactly one `BeamSpellObject` for gameplay resolution.

### Shield as extra effective health

The base health container still represents `maxHealth`. Current health occupies
`currentHealth / maxHealth` of that base width. Shield uses a silver-grey segment
immediately after current health, with width `shield / maxHealth` on the same
scale.

The outer health-bar frame expands to contain `health + shield`; it is not capped
at `maxHealth` and the shield never overlays health. Mana remains aligned to the
base health width so temporary shields do not change mana readability. The shield
color stays visibly distinct from real health.

## Testing

- VFX tests prove live anchors follow caster movement while cast contexts remain
  immutable.
- Charged spell tests prove range geometry grows monotonically and reaches the
  configured maximum.
- Projectile tests prove both loaded-sprite and lazy/fallback paths draw something,
  with visual dimensions independent from collision size.
- Janna Q tests lock the new min/max hitbox, range, and unchanged charge scaling.
- A source boundary test rejects cooldowns above `10_000ms`.
- Champion health-bar tests verify shield begins after health, uses the same scale,
  expands the frame beyond 100%, and keeps a silver-grey fill.
- Lux R tests verify the prepare width grows, release persists after cast
  completion, uses multiple beam layers, and does not apply a second hit.
- Full repository verification must pass.

## Out of scope

- Rebalancing damage, mana costs, crowd-control duration, or every spell radius.
- Replacing the p5 renderer or implementing a data-driven balance editor.
- Downloading new projectile artwork; the existing typed ability icons are reused.
- Changing Janna R's fixed gameplay zone into a moving channel zone.
