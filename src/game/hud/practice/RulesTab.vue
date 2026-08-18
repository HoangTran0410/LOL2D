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
import { inject, onBeforeUnmount, onMounted, ref } from 'vue';
import DomUtils from '@/utils/dom.utils';
import type { HudInteractions } from '@/game/hud/hudInteractions';
import type { RenderFps } from '@/game/Game';
import type { RenderQuality } from '@/game/managers/ObjectManager';
import type { MatchRulesConfig } from '@/game/config/PregameConfig';
import { CDR_PERCENT_MAX, CDR_PERCENT_MIN } from '@/game/config/PregameConfig';
import {
  ZOOM_FACTOR_MAX,
  ZOOM_FACTOR_MIN,
  setZoomFactorPreference,
} from '@/game/gameObject/map/Camera';

const hud = inject<HudInteractions>('hud')!;
const renderQuality = ref<RenderQuality>(hud.renderQuality);
const renderFps = ref<RenderFps>(hud.renderFps);

const onRenderQualityChange = (event: Event): void => {
  const quality = (event.target as HTMLSelectElement).value as RenderQuality;
  hud.setRenderQuality(quality);
  renderQuality.value = hud.renderQuality;
};

const onRenderFpsChange = (event: Event): void => {
  const fps = Number((event.target as HTMLSelectElement).value) as RenderFps;
  hud.setRenderFps(fps);
  renderFps.value = hud.renderFps;
};

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
const apply = (next: MatchRulesConfig, persist: boolean): void => {
  if (!persist) {
    hud.director.seedRules(next);
    rules.value = hud.director.getRules();
    return;
  }
  hud.director.setRules(next);
  rules.value = hud.director.getRules();
};

const setCdr = (percent: number, persist: boolean): void =>
  apply({ ...rules.value, cooldownReductionPercent: percent }, persist);

const setUrf = (on: boolean): void => apply({ ...rules.value, manaFree: on }, true);

const cdrValue = (event: Event): number => Number((event.target as HTMLInputElement).value);
const onCdrInput = (event: Event): void => setCdr(cdrValue(event), false);
const onCdrChange = (event: Event): void => setCdr(cdrValue(event), true);

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
 * `GameScene` cancels only canvas touches, so these checkboxes deliberately use
 * the browser's native label click and `change` behavior on both pointer and
 * touch devices.
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

const CDR_PERCENT_STEP = 10;

/**
 * Zoom, driven by the native range input for both mouse and touch.
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
  // The match is paused while this panel is open, so Camera.update() cannot
  // lerp currentScale toward the new target before the first visible frame.
  camera.snapToScale();
  zoom.value = camera.zoomFactor; // read back: setZoomFactor clamps
};

const persistZoom = (): void => setZoomFactorPreference(camera.zoomFactor, hud.touchUi);

const onZoomInput = (event: Event): void =>
  setZoom(Number((event.target as HTMLInputElement).value));

/**
 * ## Fullscreen, and why it is in here
 *
 * The menu has a fullscreen button and the game had none, so a phone that
 * pressed Chơi was stuck with the browser's address bar over the match for the
 * rest of the session — the one place the screen is worth the most. It is in
 * this tab rather than as a second always-visible corner control because
 * `InGameHUD.vue` deliberately cut the last one of those to reclaim phone
 * screen space, and because opening this panel pauses the match: you are not
 * being ganked while you fiddle with the viewport.
 *
 * `goFullscreen` chains an orientation lock onto the request, so on Android
 * this button *is* the auto-rotate. Elsewhere `OrientationHint.vue` asks the
 * player to turn the phone, which is all a browser can do on an iPhone.
 *
 * The button hides itself where the API does not exist rather than sitting
 * there dead. `fullscreenchange` is what keeps the label honest: the browser
 * leaves fullscreen on its own for reasons this component never hears about —
 * a swipe down, a notification, Escape.
 */
const isFullscreen = ref(DomUtils.isFullscreen());
const fullscreenSupported = DomUtils.fullscreenSupported();

const syncFullscreen = (): void => {
  isFullscreen.value = DomUtils.isFullscreen();
};

const toggleFullscreen = (): void => {
  isFullscreen.value = DomUtils.toggleFullscreen();
};

onMounted(() => document.addEventListener('fullscreenchange', syncFullscreen));
onBeforeUnmount(() => document.removeEventListener('fullscreenchange', syncFullscreen));

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

/**
 * ## And the way back to a clean slate
 *
 * The panel persists everything it changes now (see `MatchDirector`'s file
 * comment), which quietly took away the fresh match every restart used to be:
 * a player who spent an evening at 90% CDR with nine bots and no jungle had no
 * way back except editing `localStorage`. This is that way back — it writes
 * `DEFAULT_PREGAME_CONFIG` *and* applies it to the running match, so the
 * button does what it says while you are looking at it.
 *
 * The second control in the panel that confirms, and for both of the exit's
 * reasons: it is not recoverable — the roster, kits and rules it discards were
 * built up over many presses — and it sits next to another irreversible
 * control, where a mis-hit is exactly what a confirm is for. The two arm
 * independently, so arming one and pressing the other cannot fire it.
 */
const confirmingReset = ref(false);
const resetting = ref(false);

const resetDefaults = async (): Promise<void> => {
  if (resetting.value) return;
  if (!confirmingReset.value) {
    confirmingReset.value = true;
    return;
  }
  confirmingReset.value = false;
  resetting.value = true;
  try {
    await hud.director.resetToDefaults();
    // Every control on this tab is seeded from the director at mount, so the
    // ones this moved must be re-read instead of showing the old match.
    rules.value = hud.director.getRules();
    jungle.value = hud.director.jungleEnabled;
    minions.value = hud.director.minionsEnabled;
  } finally {
    resetting.value = false;
  }
};
</script>

<template>
  <div class="practice-tab-body">
    <div class="practice-render-settings">
      <label class="pregame-field">
        <span>Chất lượng hình ảnh</span>
        <select id="practice-render-quality" :value="renderQuality" @change="onRenderQualityChange">
          <option value="auto">Tự động</option>
          <option value="low">Thấp — mượt hơn</option>
          <option value="high">Cao — đẹp hơn</option>
        </select>
      </label>

      <label class="pregame-field">
        <span>Giới hạn FPS</span>
        <select id="practice-render-fps" :value="renderFps" @change="onRenderFpsChange">
          <option :value="30">30 FPS — tiết kiệm pin</option>
          <option :value="60">60 FPS — mượt hơn</option>
        </select>
      </label>
    </div>

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
        @change="onCdrChange"
      />
    </label>

    <label class="pregame-field">
      <span
        >Thu phóng: <strong id="practice-zoom-value">{{ Math.round(zoom * 100) }}%</strong></span
      >
      <input
        type="range"
        id="practice-zoom"
        :min="ZOOM_FACTOR_MIN"
        :max="ZOOM_FACTOR_MAX"
        :step="ZOOM_STEP"
        :value="zoom"
        @input="onZoomInput"
        @change="persistZoom"
      />
    </label>

    <label class="pregame-toggle">
      <input type="checkbox" id="practice-urf" :checked="rules.manaFree" @change="onUrfChange" />
      <span>URF (không tốn mana)</span>
    </label>

    <label class="pregame-toggle">
      <input type="checkbox" id="practice-jungle" :checked="jungle" @change="onJungleChange" />
      <span>Quái rừng</span>
    </label>

    <label class="pregame-toggle">
      <input type="checkbox" id="practice-minions" :checked="minions" @change="onMinionsChange" />
      <span>Lính</span>
    </label>

    <!-- Scoped to the two switches above it, not to the whole tab: CDR, zoom
         and URF are immediate. -->
    <p class="practice-note">
      Quái rừng và lính: thay đổi có hiệu lực khi bạn đóng bảng và trận chạy tiếp.
    </p>

    <!-- Reversible, so it sits above the confirming pair rather than among
         them — and full width, because it is the one control here a phone
         reaches for first. -->
    <button
      v-if="fullscreenSupported"
      type="button"
      class="practice-fullscreen"
      id="practice-fullscreen"
      @click="toggleFullscreen"
      @touchend.prevent="toggleFullscreen"
    >
      <i :class="isFullscreen ? 'fas fa-compress' : 'fas fa-expand'" aria-hidden="true"></i>
      <span>{{ isFullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình' }}</span>
    </button>

    <!-- Last in the flow and visually apart: the two irreversible things in the
         panel, side by side because they are the same kind of control. See the
         file comment on why each is here and why both confirm. -->
    <div class="practice-tab-actions">
      <button
        type="button"
        class="practice-reset"
        :class="{ confirming: confirmingReset }"
        :disabled="resetting"
        id="practice-reset"
        @click="resetDefaults"
      >
        <i class="fas fa-rotate-left" aria-hidden="true"></i>
        <span>{{
          resetting ? 'Đang đặt lại…' : confirmingReset ? 'Chắc chưa?' : 'Đặt lại mặc định'
        }}</span>
      </button>

      <button
        type="button"
        class="practice-exit"
        :class="{ confirming: confirmingExit }"
        id="practice-exit"
        @click="exitMatch"
      >
        <i class="fas fa-sign-out-alt" aria-hidden="true"></i>
        <span>{{ confirmingExit ? 'Chắc chưa?' : 'Thoát trận' }}</span>
      </button>
    </div>
  </div>
</template>
