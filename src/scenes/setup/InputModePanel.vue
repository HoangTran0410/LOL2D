<script setup lang="ts">
/**
 * "Điều Khiển" panel: where the touch-vs-pointer layout is chosen. Used to be
 * a bare gamepad icon in the pregame panel's corner — moved here because the
 * owner didn't know it existed, let alone that it silently overrode
 * auto-detection: an icon with a tooltip is not legible on a screen someone
 * opens once. A labelled row in the one tab that already holds "how the
 * match runs" settings is.
 *
 * Three states, not a switch, and that is the whole point. The old binary
 * toggle had no way back to "just look at the device": one tap wrote a
 * preference that outranked capability detection on every future visit, and
 * the only way to undo it was clearing localStorage by hand. `Tự động` is the
 * way back, and it is the default.
 *
 * The distinction the row has to show is between the *choice* and the
 * *result*: `auto` on a phone and `touch` on a phone render identically, so
 * selecting on the resolved layout would light the wrong button. `mode` is the
 * choice; `isTouchUi` is the result, and only the hint line below reports it.
 */
import type { TouchModePreference } from '../../game/input/TouchControls';

defineProps<{ isTouchUi: boolean; mode: TouchModePreference }>();
const emit = defineEmits<{ 'update:mode': [TouchModePreference] }>();

const OPTIONS: { value: TouchModePreference; label: string; icon: string }[] = [
  { value: 'auto', label: 'Tự động', icon: 'fas fa-wand-magic-sparkles' },
  { value: 'touch', label: 'Chạm tay', icon: 'fa-solid fa-hand-pointer' },
  { value: 'pointer', label: 'Chuột & bàn phím', icon: 'fa-solid fa-computer-mouse' },
];
</script>

<template>
  <div class="pregame-column">
    <h2>Điều Khiển</h2>
    <div class="input-mode-row" role="group" aria-label="Chế độ điều khiển">
      <button
        v-for="option of OPTIONS"
        :key="option.value"
        type="button"
        :id="'pregame-input-mode-' + option.value"
        class="input-mode-btn"
        :class="{ selected: mode === option.value }"
        :aria-pressed="mode === option.value"
        @click="emit('update:mode', option.value)"
      >
        <i :class="option.icon"></i> {{ option.label }}
      </button>
    </div>
    <p class="pregame-hint">
      <template v-if="mode === 'auto'">
        Đang tự nhận diện theo thiết bị, và hiện dùng giao diện
        <strong>{{ isTouchUi ? 'cảm ứng' : 'chuột &amp; bàn phím' }}</strong>.
      </template>
      <template v-else>
        Bạn đang <strong>tự chọn</strong> giao diện
        <strong>{{ isTouchUi ? 'cảm ứng' : 'chuột &amp; bàn phím' }}</strong>. Lựa chọn này được ghi
        nhớ cho mọi lần vào sau và cho cả trận đấu, kể cả trên thiết bị nhận diện ra kiểu khác —
        chọn <strong>Tự động</strong> để trả lại cho thiết bị quyết định.
      </template>
    </p>
  </div>
</template>
