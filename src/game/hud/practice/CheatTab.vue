<script setup lang="ts">
/**
 * What is left of the practice tool once the per-champion cheats moved onto the
 * roster: the two knobs that belong to the *match*, not to a unit.
 *
 * `revealMap` and the debug layers are not about any one champion — they change
 * what the whole match shows you — so a unit selector here would have been a
 * list of champions none of these controls act on. The per-unit half (bất tử,
 * hồi đầy, xoá hồi chiêu, cộng dồn stack) folded into each champion's own row on
 * the Đội tab, where it sits beside that champion's kit and behaviour instead of
 * a tab away behind a second copy of the roster. See `RosterTab.vue`'s header.
 *
 * Both are session state and neither persists — `MatchDirector` writes the
 * *match* (roster, rules, world) and nothing else. An invulnerable champion or a
 * lit-up debug layer surviving a reload would read as the game being broken, not
 * as a restored setting. The test that guards that line lives in
 * `MatchDirector.persistence.test.ts`.
 *
 * The tab uses native DOM click, checkbox and scrolling behavior; `GameScene`
 * cancels touch gestures only when their target is the game canvas.
 */
import { computed, inject, ref } from 'vue';
import type { HudInteractions } from '@/game/hud/hudInteractions';
import type { DebugFlags } from '@/game/debug/DebugOverlay';

const hud = inject<HudInteractions>('hud')!;

const version = ref(0);
const invalidate = (): void => {
  version.value++;
};

/**
 * Show the whole map on the minimap. A plain flag on the director, read once per
 * frame by `Game.minimapBlips()` — nothing about it depends on the update loop,
 * which the panel has paused for as long as this tab is open.
 */
const revealMap = computed<boolean>(() => {
  void version.value;
  return hud.director.revealMap;
});

const onRevealMapChange = (event: Event): void => {
  hud.director.revealMap = (event.target as HTMLInputElement).checked;
  invalidate();
};

/**
 * The debug layers (`src/game/debug/DebugOverlay.ts`). Not cheats, but they show
 * you what the match is hiding, so they sit beside `revealMap`.
 *
 * `routes` is the overlay the `N` key has always toggled, and the checkbox and
 * the key write the same field: `director.debug.routes` is an accessor onto
 * `NavigationSystem.debugRoutes`, so neither can be stale relative to the other.
 */
const DEBUG_LAYERS: { key: keyof DebugFlags; label: string }[] = [
  { key: 'routes', label: 'Đường đi' },
  { key: 'terrain', label: 'Địa hình' },
  { key: 'collision', label: 'Va chạm' },
  { key: 'vision', label: 'Tầm nhìn' },
  { key: 'quadtree', label: 'Quadtree' },
];

const debugOn = (key: keyof DebugFlags): boolean => {
  // Read for the dependency, not for the value.
  void version.value;
  return hud.director.debug[key];
};

const onDebugChange = (key: keyof DebugFlags, event: Event): void => {
  hud.director.debug[key] = (event.target as HTMLInputElement).checked;
  invalidate();
};
</script>

<template>
  <div class="practice-tab-body">
    <label class="pregame-toggle">
      <input
        type="checkbox"
        id="practice-cheat-reveal-map"
        :checked="revealMap"
        @change="onRevealMapChange"
      />
      <span>Hiện toàn bản đồ</span>
    </label>

    <!-- The debug layers. Two columns because five full-width rows would push
         the content off a landscape phone on their own. -->
    <div class="practice-debug">
      <span class="practice-debug-title">Lớp gỡ lỗi</span>
      <div class="practice-debug-grid">
        <label
          v-for="layer of DEBUG_LAYERS"
          :key="layer.key"
          class="pregame-toggle practice-debug-toggle"
        >
          <input
            type="checkbox"
            :id="`practice-debug-${layer.key}`"
            :checked="debugOn(layer.key)"
            @change="onDebugChange(layer.key, $event)"
          />
          <span>{{ layer.label }}</span>
        </label>
      </div>
    </div>

    <p class="practice-note">
      Bất tử, hồi đầy, xoá hồi chiêu và cộng dồn nằm trong từng tướng ở tab Đội.
    </p>
  </div>
</template>
