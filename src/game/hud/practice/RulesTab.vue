<script setup lang="ts">
/**
 * Everything about *this match* that is not a participant: CDR, zoom, URF, and
 * whether the jungle and the lane minions exist. The last two came from a
 * separate Thế giới tab, which held two controls and answered the same
 * question this one does — settings for the match you are in.
 *
 * The first three apply on the spot; the last two apply on the first unpaused
 * tick, which is what the note at the bottom is for. See "Two kinds of
 * control" below.
 *
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
 * (`hud.director`) rather than at `localStorage`, which is still the whole
 * difference between the two screens: the setup screen edits a config, this
 * edits a running match. The config is written all the same — by
 * `MatchDirector`, after it has applied the change, so a match retuned here
 * comes back retuned. Nothing in this file touches storage itself; there is
 * one write path and it is not here (see `MatchDirector`'s file comment).
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
import {
  ZOOM_FACTOR_MAX,
  ZOOM_FACTOR_MIN,
  setZoomFactorPreference,
} from '../../gameObject/map/Camera';

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
 * ## Two kinds of control, and why the world's two need a note
 *
 * The jungle and minion switches take effect on the first unpaused tick, not
 * while you are looking at them — the panel opens paused and
 * `ObjectManager.update()` is what sweeps removed units out and flushes new
 * ones in (see `MatchDirector`'s file comment). Hence the note under them:
 * without it the panel looks broken, because the honest answer to "I turned
 * the jungle off and nothing happened" is "the match is not running". Turning
 * the jungle back on re-runs `Game.spawnJungle()`, so the camps return at
 * their `MonsterPreset` positions rather than wherever they had wandered.
 *
 * The director is the single source of truth for both, not this component:
 * `minionsEnabled` is a view of `MinionSpawner.enabled` and `jungleEnabled` is
 * the director's own flag (an empty jungle is also what a cleared map looks
 * like, which must not read as "switched off"). The refs below are only what
 * the checkboxes render; every write goes through the director and the ref is
 * refreshed from it, so a rejected or no-op write cannot leave the tick box
 * disagreeing with the match.
 *
 * ## Why a `touchend` handler as well as `change`
 *
 * A checkbox's `change` fires from the click the browser synthesises after a
 * tap — and there is no such click here. `GameScene`'s p5 touch handlers
 * `preventDefault()` every touch on the *page* (see `hudInteractions.ts`'s
 * file comment), which suppresses the synthetic click everywhere, not just on
 * the canvas. Wired to `change` alone these two toggles were verifiably inert
 * under a real thumb while working perfectly under a mouse. The handler sits
 * on the `<label>`, not the `<input>`, so tapping the word also counts; on a
 * mouse the label's click reaches the input and `change` does the work, and
 * the two paths cannot both fire for one gesture.
 */
const jungle = ref(hud.director.jungleEnabled);
const minions = ref(hud.director.minionsEnabled);

const setJungle = (on: boolean): void => {
  hud.director.jungleEnabled = on;
  jungle.value = hud.director.jungleEnabled;
};

const setMinions = (on: boolean): void => {
  hud.director.minionsEnabled = on;
  minions.value = hud.director.minionsEnabled;
};

const onJungleChange = (event: Event): void =>
  setJungle((event.target as HTMLInputElement).checked);

const onMinionsChange = (event: Event): void =>
  setMinions((event.target as HTMLInputElement).checked);

/**
 * Both controls again, for a thumb. `GameScene`'s p5 touch handlers
 * `preventDefault()` every touch on the *page* (see `hudInteractions.ts`'s
 * file comment), which kills the browser's own response to a touch on a form
 * control along with the synthetic click: verified here, not assumed — wired
 * to `@input`/`@change` alone, the slider would not move and the checkbox
 * would not tick under a real `Input.dispatchTouchEvent`, while both worked
 * under a mouse. So the drag is computed from where the finger is across the
 * track, the same hand-rolled shape as `RosterTab.vue`'s own touch
 * scrolling.
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

/**
 * Zoom, the same shape as the CDR slider above — including the hand-rolled
 * touch drag, and for the same reason written out there.
 *
 * A phone has no wheel, and a phone is who the viewport-scaling work exists
 * for; `GameScene.mouseWheel` is the other way in. The control writes the
 * *factor* over the camera's balanced base, never an absolute scale, so the
 * choice survives a resize or an orientation change — see
 * `Camera.setZoomFactor`.
 *
 * Note that `Game.draw()` returns early while the panel has the match paused,
 * so the canvas does not repaint until the panel closes. The zoom has still
 * been applied; it becomes visible on close.
 */
const ZOOM_STEP = 0.1;
const camera = hud.camera;
const zoom = ref(camera.zoomFactor);

const setZoom = (factor: number): void => {
  camera.setZoomFactor(factor);
  setZoomFactorPreference(camera.zoomFactor);
  zoom.value = camera.zoomFactor; // read back: setZoomFactor clamps
};

const onZoomInput = (event: Event): void =>
  setZoom(Number((event.target as HTMLInputElement).value));

const onZoomTouch = (event: TouchEvent): void => {
  const touch = event.touches[0] ?? event.changedTouches[0];
  if (!touch) return;
  const track = (event.currentTarget as HTMLElement).getBoundingClientRect();
  if (!track.width) return;
  const ratio = Math.min(1, Math.max(0, (touch.clientX - track.left) / track.width));
  const raw = ZOOM_FACTOR_MIN + ratio * (ZOOM_FACTOR_MAX - ZOOM_FACTOR_MIN);
  setZoom(Math.round(raw / ZOOM_STEP) * ZOOM_STEP);
};
/**
 * ## The way out of the match
 *
 * Escape used to be it, and one mis-hit ended the match with no confirmation
 * and no way back (`GameScene.keyPressed`). Escape now opens this panel, so
 * the exit has to live somewhere findable — and this is the tab that means
 * *this match*, which is what is being quit.
 *
 * Deliberately **not** beside the shell's close button in the tab row: two
 * adjacent controls whose outcomes differ by an entire match is exactly the
 * mis-hit being designed out.
 *
 * Two steps, and it is the only control in the panel that confirms. Bots,
 * saved kits, champion swaps and every cheat are one press each, on purpose,
 * because each is cheap to redo. This one is not.
 */
const confirmingExit = ref(false);

const exitMatch = (): void => {
  if (!confirmingExit.value) {
    confirmingExit.value = true;
    return;
  }
  hud.requestExit();
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

    <label class="pregame-field">
      <span
        >Thu phóng:
        <strong id="practice-zoom-value">{{ Math.round(zoom * 100) }}%</strong></span
      >
      <input
        type="range"
        id="practice-zoom"
        :min="ZOOM_FACTOR_MIN"
        :max="ZOOM_FACTOR_MAX"
        :step="ZOOM_STEP"
        :value="zoom"
        @input="onZoomInput"
        @touchstart.prevent="onZoomTouch"
        @touchmove.prevent="onZoomTouch"
      />
    </label>

    <label class="pregame-toggle" @touchend.prevent="setUrf(!rules.manaFree)">
      <input type="checkbox" id="practice-urf" :checked="rules.manaFree" @change="onUrfChange" />
      <span>URF (không tốn mana)</span>
    </label>

    <label class="pregame-toggle" @touchend.prevent="setJungle(!jungle)">
      <input type="checkbox" id="practice-jungle" :checked="jungle" @change="onJungleChange" />
      <span>Quái rừng</span>
    </label>

    <label class="pregame-toggle" @touchend.prevent="setMinions(!minions)">
      <input type="checkbox" id="practice-minions" :checked="minions" @change="onMinionsChange" />
      <span>Lính</span>
    </label>

    <!-- Scoped to the two switches above it, not to the whole tab: CDR, zoom
         and URF are immediate. -->
    <p class="practice-note">
      Quái rừng và lính: thay đổi có hiệu lực khi bạn đóng bảng và trận chạy tiếp.
    </p>

    <!-- Last in the flow and visually apart: the one irreversible thing in the
         panel. See the file comment on why it is here and why it confirms. -->
    <button
      type="button"
      class="practice-exit"
      :class="{ confirming: confirmingExit }"
      id="practice-exit"
      @click="exitMatch"
      @touchend.prevent="exitMatch"
    >
      <i class="fas fa-sign-out-alt" aria-hidden="true"></i>
      <span>{{ confirmingExit ? 'Chắc chưa?' : 'Thoát trận' }}</span>
    </button>
  </div>
</template>
