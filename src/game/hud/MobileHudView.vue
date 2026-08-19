<script setup lang="ts">
/**
 * The touch HUD: whatever `TouchControls` draws on the canvas (joystick,
 * spell buttons with their own cooldown/mana) plus the practice panel.
 * Nothing else.
 *
 * There used to be a bottom-HUD strip here too — avatar, health/mana bars,
 * a loadout row, buffs — the same markup `DesktopHudView` still renders.
 * The owner's call: on a phone it duplicated information the canvas already
 * carries and ate real screen space doing it. Before it came out, each
 * piece was checked against what actually draws on the canvas today:
 *
 *   - health *and mana*: `Champion.drawHealthBar()` (which every live
 *     Champion — the player included — draws over its own head) already
 *     paints both, a shield overlay, and the `value / max` label. This was
 *     not a gap to fill; it was already there.
 *   - buff stacks and crowd control: the same method draws one icon per
 *     buff *kind* with a stack-count overlay above the bar, and a CC status
 *     line (stun, root, silence, ...) below it when the buff came from
 *     someone else. `AttackableUnit.drawBuffs()` layers each buff's own
 *     `draw()` on top of that (a spinning icon over the character for
 *     several CC types). Stacks and CC readability both survive; the one
 *     piece that does not is the strip's numeric countdown per buff — a
 *     real loss, accepted deliberately rather than clutter a phone screen
 *     with a second timer on top of the icon that already fades when the
 *     buff ends.
 *   - the revive countdown: the same method's dead branch draws
 *     "Hồi Sinh Sau Ns..." at the corpse position, and the camera keeps
 *     following `player.position` (dead or alive) since there is no
 *     keyboard to reach the desktop's follow-toggle in touch mode. It stays
 *     on screen the whole time.
 *   - the avatar: every unit's on-map body *is* its avatar image
 *     (`AttackableUnit.drawAvatar()`); the strip's square portrait was a
 *     second copy of the same picture the player is already looking at,
 *     centred on screen by the same camera follow.
 *
 * The one thing genuinely lost — a direct, per-slot tap target for "change
 * this spell" — moved into the practice panel: see `InGameHUD.vue`'s corner
 * button, and `RosterTab`'s loadout editor, which sets all seven slots for
 * every unit in the match rather than only the player's.
 *
 * The long-press description panel that used to render here went with the
 * picker's icons, which were the only thing on this screen that fired it. Its
 * replacement is one tap further in and is the editor's own: `useSpellPeek.ts`
 * behind `KitRoster`'s icons.
 */
import { inject } from 'vue';
import type { HudInteractions } from './hudInteractions';

const hud = inject<HudInteractions>('hud')!;
</script>

<template>
</template>
