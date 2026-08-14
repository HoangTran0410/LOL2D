<script setup lang="ts">
/**
 * "Điều Khiển" panel: where the touch-vs-pointer layout is chosen. Used to be
 * a bare gamepad icon in the pregame panel's corner — moved here because the
 * owner didn't know it existed, let alone that it silently overrode
 * auto-detection: an icon with a tooltip is not legible on a screen someone
 * opens once. A labelled row in the one tab that already holds "how the
 * match runs" settings is.
 *
 * Reads and writes through `useTouchUi()` (`SetupScene.vue` owns the single
 * instance, same as before — this panel never calls
 * `game/input/TouchControls.ts` itself), which itself only wraps
 * `touchControlsPreference()`/`rememberTouchControlsPreference()`. Both of
 * those stay someone else's file to edit; see the file comment below on
 * `AUTO_OPTION` for the migration this is already shaped for.
 */
defineProps<{ isTouchUi: boolean }>();
const emit = defineEmits<{ 'update:isTouchUi': [boolean] }>();

/**
 * `touchControlsPreference()` today only ever resolves to a boolean — once a
 * player picks a side here, `rememberTouchControlsPreference` pins it in
 * `localStorage` and every future visit (and, since `Game.applyTouchUiClass`
 * reads the same key, every real match) uses it forever, with capability
 * detection never getting another chance to run. That silent, permanent
 * override is exactly the bug the owner hit: one tap, and the layout is
 * "wrong" on every visit afterwards with nothing on screen explaining why.
 *
 * `TouchControls.ts` is being changed elsewhere to store a tri-state —
 * `'auto' | 'touch' | 'pointer'`, `'auto'` re-running capability detection
 * every time — with `touchControlsPreference(): boolean` kept as the
 * resolved answer for existing callers. This button is laid out for that
 * third state today (a three-way row, not a two-way switch) but stays
 * `disabled`, with no click handler, until that lands: wire it by replacing
 * this `disabled` button with one that calls the new tri-state setter with
 * `'auto'`, and drive `:class="{ selected: ... }"` off whichever accessor
 * reports the resolved mode is presently auto-detected rather than manually
 * pinned.
 */
</script>

<template>
  <div class="pregame-column">
    <h2>Điều Khiển</h2>
    <div class="input-mode-row" role="group" aria-label="Chế độ điều khiển">
      <button type="button" class="input-mode-btn" disabled title="Sắp ra mắt: tự nhận diện lại theo thiết bị">
        <i class="fas fa-wand-magic-sparkles"></i> Tự động
      </button>
      <button
        type="button"
        id="pregame-input-mode-touch"
        class="input-mode-btn"
        :class="{ selected: isTouchUi }"
        @click="emit('update:isTouchUi', true)"
      >
        <i class="fa-solid fa-hand-pointer"></i> Chạm tay
      </button>
      <button
        type="button"
        id="pregame-input-mode-pointer"
        class="input-mode-btn"
        :class="{ selected: !isTouchUi }"
        @click="emit('update:isTouchUi', false)"
      >
        <i class="fa-solid fa-computer-mouse"></i> Chuột & bàn phím
      </button>
    </div>
    <p class="pregame-hint">
      Đang dùng giao diện <strong>{{ isTouchUi ? 'cảm ứng' : 'chuột & bàn phím' }}</strong>. Chọn thủ công ở đây sẽ
      được ghi nhớ cho mọi lần vào Cấu Hình và vào trận sau — kể cả trên thiết bị khác nhận diện được cảm ứng —
      cho tới khi bạn đổi lại tại đây.
    </p>
  </div>
</template>
