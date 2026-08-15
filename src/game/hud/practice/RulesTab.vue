<script setup lang="ts">
/**
 * CDR and URF, mid-match. `Spell.ts` reads `game.matchRules` at cast time
 * rather than capturing it at construction (`:320` for the cooldown
 * multiplier, `:369` for `manaFree`), so moving this slider changes the
 * cooldown of spells that already exist, on their next cast — no respawn, no
 * rebuild. That is the whole reason this tab is cheap and the roster tab is
 * not.
 *
 * Same two controls, same markup and the same copy as `MatchRulesPanel.vue`
 * on the setup screen — including `step="10"`, so a percentage means the same
 * thing and lands on the same values in both places. Pointed at the live match
 * (`hud.director`) instead of at `localStorage`: the practice panel never
 * writes `lol2d:pregameConfig:v1` (see `MatchDirector`'s file comment).
 *
 * Unlike the spell picker's slot row, these two apply on the spot rather than
 * staging behind Huỷ / Xác nhận. There is nothing to stage: `setRules` is one
 * assignment into the object every spell already holds, it is reversible by
 * dragging back, and a rule change is not a pick that a player builds up over
 * several taps. (`MatchDirector.setRules` mutates `game.matchRules` in place
 * for exactly that reason — replacing the object would leave every existing
 * spell reading the old one.)
 */
import { inject, ref } from 'vue';
import type { HudInteractions } from '../hudInteractions';
import type { MatchRulesConfig } from '../../config/PregameConfig';
import { CDR_PERCENT_MAX, CDR_PERCENT_MIN } from '../../config/PregameConfig';

const hud = inject<HudInteractions>('hud')!;

/**
 * Seeded from the director, which is the match's own view of its rules — a
 * `Game` booted from a config that set a rule seeded it at construction, so
 * the tab opens showing the match that is running rather than a fresh 0%.
 */
const rules = ref<MatchRulesConfig>(hud.director.getRules());

/**
 * Read back after writing rather than trusting the local edit: `setRules`
 * rounds and clamps to `CDR_PERCENT_MIN`/`MAX`, so the label shows the
 * percentage the match actually got and not the one the control asked for.
 */
const apply = (next: MatchRulesConfig): void => {
  hud.director.setRules(next);
  rules.value = hud.director.getRules();
};

const setCdr = (percent: number): void =>
  apply({ ...rules.value, cooldownReductionPercent: percent });

const setUrf = (on: boolean): void => apply({ ...rules.value, manaFree: on });

const onCdrInput = (event: Event): void => setCdr(Number((event.target as HTMLInputElement).value));

const onUrfChange = (event: Event): void => setUrf((event.target as HTMLInputElement).checked);

/**
 * Both controls again, for a thumb. `GameScene`'s p5 touch handlers
 * `preventDefault()` every touch on the *page* (see `hudInteractions.ts`'s
 * file comment), which kills the browser's own response to a touch on a form
 * control along with the synthetic click: verified here, not assumed — wired
 * to `@input`/`@change` alone, the slider would not move and the checkbox
 * would not tick under a real `Input.dispatchTouchEvent`, while both worked
 * under a mouse. So the drag is computed from where the finger is across the
 * track, the same hand-rolled shape as the picker's own touch scrolling in
 * `SpellPickerModal.vue`.
 *
 * Snapped to `CDR_PERCENT_STEP`, which is `MatchRulesPanel.vue`'s `step="10"`
 * — one definition, so a finger and a mouse cannot reach different values on
 * the same control. The track's full width is used without allowing for the
 * thumb's own width, which biases the middle of the slider by a few pixels;
 * the snap swallows that, and both ends clamp, so 0% and 90% stay reachable.
 */
const CDR_PERCENT_STEP = 10;

const onCdrTouch = (event: TouchEvent): void => {
  const touch = event.touches[0] ?? event.changedTouches[0];
  if (!touch) return;
  const track = (event.currentTarget as HTMLElement).getBoundingClientRect();
  if (!track.width) return;

  const ratio = Math.min(1, Math.max(0, (touch.clientX - track.left) / track.width));
  const raw = CDR_PERCENT_MIN + ratio * (CDR_PERCENT_MAX - CDR_PERCENT_MIN);
  setCdr(Math.round(raw / CDR_PERCENT_STEP) * CDR_PERCENT_STEP);
};
</script>

<template>
  <div class="practice-tab-body">
    <label class="pregame-field">
      <span
        >Giảm hồi chiêu:
        <strong id="practice-cdr-value">{{ rules.cooldownReductionPercent }}%</strong></span
      >
      <input
        type="range"
        id="practice-cdr"
        :min="CDR_PERCENT_MIN"
        :max="CDR_PERCENT_MAX"
        :step="CDR_PERCENT_STEP"
        :value="rules.cooldownReductionPercent"
        @input="onCdrInput"
        @touchstart.prevent="onCdrTouch"
        @touchmove.prevent="onCdrTouch"
      />
    </label>

    <label class="pregame-toggle" @touchend.prevent="setUrf(!rules.manaFree)">
      <input type="checkbox" id="practice-urf" :checked="rules.manaFree" @change="onUrfChange" />
      <span>URF (không tốn mana)</span>
    </label>
  </div>
</template>
