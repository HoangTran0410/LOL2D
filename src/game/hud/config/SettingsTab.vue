<script setup lang="ts">
/**
 * The device, not the match: how you drive it, how it draws, and what it shows
 * you that it would normally hide.
 *
 * These were the settings the two old panels disagreed about in the other
 * direction. Điều khiển and Ưu tiên mục tiêu existed only on the pregame screen
 * — so a player who had already started a match could not reach them at all —
 * while chất lượng, FPS, thu phóng and toàn màn hình existed only in the panel,
 * so a phone could not set them before pressing Chơi. All of it is here, in both
 * places.
 *
 * Hiện toàn bản đồ and the debug layers are here too, which is what is left of
 * the old Gian lận tab. They are not about any one champion — they change what
 * the whole match shows you — so they belong with the other display settings
 * rather than in a tab of their own; the per-unit cheats live on each
 * champion's row on Đội. All of it persists now, which is why the layers can be
 * set before a match exists.
 *
 * Thu phóng and toàn màn hình are the two that need a match (a camera to zoom,
 * and — for fullscreen — the screen actually being worth the most while a match
 * is on). They hide outside one.
 *
 * `GameScene` cancels only canvas touches, so these checkboxes and selects use
 * the browser's native label, `change` and scroll behavior on both pointer and
 * touch devices.
 */
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue';
import { CONFIG_PANEL } from './panelState';
import DomUtils from '@/utils/dom.utils';
import { DEBUG_LAYER_KEYS, type DebugLayerConfig } from '@/game/config/PregameConfig';
import {
  setTouchTargetPriorityPreference,
  touchTargetPriorityPreference,
  type TouchModePreference,
  type TouchTargetPriority,
} from '@/game/input/touchPreferences';
import { ZOOM_FACTOR_MAX, ZOOM_FACTOR_MIN } from '@/game/config/zoomBounds';
import type { RenderQuality } from '@/game/managers/ObjectManager';
import type { RenderFps } from '@/game/config/renderPreferences';

const panel = inject(CONFIG_PANEL)!;
const source = panel.source;
const live = source.live;

// ---------------------------------------------------------------- điều khiển

/**
 * Three states, not a switch, and that is the whole point. The old binary
 * toggle had no way back to "just look at the device": one tap wrote a
 * preference that outranked capability detection on every future visit, and the
 * only way to undo it was clearing `localStorage` by hand. `Tự động` is the way
 * back, and it is the default.
 *
 * The distinction the row has to show is between the *choice* and the *result*:
 * `auto` on a phone and `touch` on a phone render identically, so selecting on
 * the resolved layout would light the wrong button. `inputMode` is the choice;
 * `touchUi` is the result, and only the hint line reports it.
 */
const INPUT_MODES: { value: TouchModePreference; label: string; icon: string }[] = [
  { value: 'auto', label: 'Tự động', icon: 'fas fa-wand-magic-sparkles' },
  { value: 'touch', label: 'Chạm tay', icon: 'fa-solid fa-hand-pointer' },
  { value: 'pointer', label: 'Chuột & bàn phím', icon: 'fa-solid fa-computer-mouse' },
];

const inputMode = ref<TouchModePreference>(source.inputMode);
const touchUi = ref(source.touchUi);

const setInputMode = (mode: TouchModePreference): void => {
  source.setInputMode(mode);
  inputMode.value = source.inputMode;
  touchUi.value = source.touchUi;
  panel.invalidate();
};

const targetPriority = ref<TouchTargetPriority>(touchTargetPriorityPreference());

const setTargetPriority = (priority: TouchTargetPriority): void => {
  setTouchTargetPriorityPreference(priority);
  targetPriority.value = priority;
};

// ------------------------------------------------------------------ hiển thị

const renderQuality = ref<RenderQuality>(source.renderQuality);
const renderFps = ref<RenderFps>(source.renderFps);

const onRenderQualityChange = (event: Event): void => {
  source.setRenderQuality((event.target as HTMLSelectElement).value as RenderQuality);
  renderQuality.value = source.renderQuality;
};

const onRenderFpsChange = (event: Event): void => {
  source.setRenderFps(Number((event.target as HTMLSelectElement).value) as RenderFps);
  renderFps.value = source.renderFps;
};

/**
 * Zoom, driven by the native range input for both mouse and touch. A phone has
 * no wheel, and a phone is who the viewport-scaling work exists for.
 *
 * The control writes the *factor* over the camera's balanced base, never an
 * absolute scale, so the choice survives a resize or an orientation change.
 * `Game.draw()` returns early while the panel has the match paused, so the
 * canvas does not repaint until the panel closes — the zoom has still been
 * applied; it becomes visible on close.
 */
const ZOOM_STEP = 0.1;
const zoom = ref(live?.zoom ?? 1);

const onZoomInput = (event: Event): void => {
  live?.setZoom(Number((event.target as HTMLInputElement).value));
  zoom.value = live?.zoom ?? zoom.value; // read back: setZoom clamps
};

const persistZoom = (): void => live?.persistZoom();

/**
 * ## Fullscreen
 *
 * `goFullscreen` chains an orientation lock onto the request, so on Android
 * this button *is* the auto-rotate. Elsewhere `OrientationHint.vue` asks the
 * player to turn the phone, which is all a browser can do on an iPhone.
 *
 * It hides itself where the API does not exist rather than sitting there dead.
 * `fullscreenchange` is what keeps the label honest: the browser leaves
 * fullscreen on its own for reasons this component never hears about — a swipe
 * down, a notification, Escape.
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

// ------------------------------------------------------------------- gỡ lỗi

const cheats = computed(() => {
  void panel.version.value;
  return source.getCheats();
});

const onRevealMapChange = (event: Event): void => {
  source.setCheats({ revealMap: (event.target as HTMLInputElement).checked });
  panel.invalidate();
};

const DEBUG_LABELS: Record<keyof DebugLayerConfig, string> = {
  routes: 'Đường đi',
  terrain: 'Địa hình',
  collision: 'Va chạm',
  vision: 'Tầm nhìn',
  quadtree: 'Quadtree',
  fps: 'FPS',
};

const onDebugChange = (key: keyof DebugLayerConfig, event: Event): void => {
  source.setCheats({
    debug: { ...cheats.value.debug, [key]: (event.target as HTMLInputElement).checked },
  });
  panel.invalidate();
};
</script>

<template>
  <div class="practice-tab-body">
    <h3 class="practice-section-title">Điều khiển</h3>
    <div class="input-mode-row" role="group" aria-label="Chế độ điều khiển">
      <button v-for="option of INPUT_MODES" :key="option.value" type="button" :id="'pregame-input-mode-' + option.value"
        class="input-mode-btn" :class="{ selected: inputMode === option.value }"
        :aria-pressed="inputMode === option.value" @click="setInputMode(option.value)">
        <i :class="option.icon"></i> {{ option.label }}
      </button>
    </div>
    <p class="pregame-hint">
      <template v-if="inputMode === 'auto'">
        Đang tự nhận diện theo thiết bị, và hiện dùng giao diện
        <strong>{{ touchUi ? 'cảm ứng' : 'chuột &amp; bàn phím' }}</strong>.
      </template>
      <template v-else>
        Bạn đang <strong>tự chọn</strong> giao diện
        <strong>{{ touchUi ? 'cảm ứng' : 'chuột &amp; bàn phím' }}</strong>. Lựa chọn này được ghi nhớ cho mọi lần vào
        sau — chọn <strong>Tự động</strong> để trả
        lại cho thiết bị quyết định.
      </template>
    </p>

    <h3 class="practice-section-title">Ưu tiên mục tiêu khi chạm nhanh</h3>
    <div class="input-mode-row" role="group" aria-label="Ưu tiên mục tiêu">
      <button id="pregame-target-priority-nearest" type="button" class="input-mode-btn"
        :class="{ selected: targetPriority === 'nearest' }" :aria-pressed="targetPriority === 'nearest'"
        @click="setTargetPriority('nearest')">
        <i class="fa-solid fa-location-crosshairs"></i> Gần nhất
      </button>
      <button id="pregame-target-priority-lowest-health" type="button" class="input-mode-btn"
        :class="{ selected: targetPriority === 'lowest-health' }" :aria-pressed="targetPriority === 'lowest-health'"
        @click="setTargetPriority('lowest-health')">
        <i class="fa-solid fa-heart-crack"></i> Ít máu nhất
      </button>
    </div>

    <h3 class="practice-section-title">Hiển thị</h3>
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

    <!-- Needs a camera to act on, so it is not offered before a match exists. -->
    <label v-if="live" class="pregame-field">
      <span>Thu phóng: <strong id="practice-zoom-value">{{ Math.round(zoom * 100) }}%</strong></span>
      <input type="range" id="practice-zoom" :min="ZOOM_FACTOR_MIN" :max="ZOOM_FACTOR_MAX" :step="ZOOM_STEP"
        :value="zoom" @input="onZoomInput" @change="persistZoom" />
    </label>

    <button v-if="fullscreenSupported" type="button" class="practice-fullscreen" id="practice-fullscreen"
      @click="toggleFullscreen" @touchend.prevent="toggleFullscreen">
      <i :class="isFullscreen ? 'fas fa-compress' : 'fas fa-expand'" aria-hidden="true"></i>
      <span>{{ isFullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình' }}</span>
    </button>

    <h3 class="practice-section-title">Gỡ lỗi</h3>
    <label class="pregame-toggle">
      <input type="checkbox" id="practice-cheat-reveal-map" :checked="cheats.revealMap" @change="onRevealMapChange" />
      <span>Hiện toàn bản đồ</span>
    </label>

    <!-- Two columns because five full-width rows would push the content off a
         landscape phone on their own. -->
    <div class="practice-debug">
      <span class="practice-debug-title">Lớp gỡ lỗi</span>
      <div class="practice-debug-grid">
        <label v-for="key of DEBUG_LAYER_KEYS" :key="key" class="pregame-toggle practice-debug-toggle">
          <input type="checkbox" :id="`practice-debug-${key}`" :checked="cheats.debug[key]"
            @change="onDebugChange(key, $event)" />
          <span>{{ DEBUG_LABELS[key] }}</span>
        </label>
      </div>
    </div>
  </div>
</template>
