<script setup lang="ts">
/**
 * The practice tool's own tab: the state of a unit *inside* the match, which
 * every other tab leaves alone. Practising a Nasus combo at 300 stacks should
 * not mean farming 300 stacks, and checking what a spell does off cooldown
 * should not mean waiting out the cooldown.
 *
 * Every mutation goes through `hud.director` — the buff, the refill, the
 * cooldown reset — and the stack rows go through `Spell.setStackCount`, which
 * each stacking spell overrides. Nothing here constructs a `Buff` or touches
 * `stats` directly, so a cheat cannot end up meaning something different from
 * the real mechanic it imitates.
 *
 * ## The roster, and the counter that keeps it honest
 *
 * `version` / `invalidate` is `RosterTab.vue`'s pattern, verbatim, for the
 * reason spelled out there: `hudInteractions.ts` wraps the director in
 * `markRaw` on purpose, so nothing reachable through it is reactive. The
 * invariant comes with it — **every director call in this component is
 * followed by `version.value++`** — and it covers the spells too, whose
 * `stackCount` is read off live objects.
 *
 * ## No number input, on purpose
 *
 * Stacks are set with `+1 / +10 / +100 / Xoá` rather than a field. p5 binds
 * `keydown` on `window`, so typing inside a running match casts abilities;
 * the saved-kit name form pays for a text input with
 * `@keydown.stop`/`@keyup.stop`/`@keypress.stop`, and that is a cost worth
 * paying for a name and not for a number four buttons can express.
 *
 * The tab uses native DOM click, checkbox and scrolling behavior. `GameScene`
 * cancels touch gestures only when their target is the game canvas.
 */
import { computed, inject, ref } from 'vue';
import type { HudInteractions } from '@/game/hud/hudInteractions';
import type { RosterEntry } from '@/game/MatchDirector';
import type Spell from '@/game/gameObject/Spell';
import type { DebugFlags } from '@/game/debug/DebugOverlay';

const hud = inject<HudInteractions>('hud')!;

const version = ref(0);
const invalidate = (): void => {
  version.value++;
};

const roster = computed<RosterEntry[]>(() => {
  // Read for the dependency, not for the value. See the file comment.
  void version.value;
  return hud.director.roster();
});

/** "Bạn", then Bot 1..n in spawn order — the same labels the roster tab uses. */
const labelOf = (index: number): string => (index === 0 ? 'Bạn' : `Bot ${index}`);

/**
 * Which row the cheats apply to, as an index rather than a unit reference: a
 * bot removed on the tab next door would otherwise leave this pointing at a
 * unit that is no longer in the match. Clamped on read for the same reason.
 */
const selectedIndex = ref(0);
const selected = computed<RosterEntry | null>(() => {
  const entries = roster.value;
  if (entries.length === 0) return null;
  return entries[Math.min(selectedIndex.value, entries.length - 1)] ?? null;
});

const selectUnit = (index: number): void => {
  selectedIndex.value = index;
};

const invulnerable = computed<boolean>(() => {
  void version.value;
  const entry = selected.value;
  return entry ? hud.director.isInvulnerable(entry.unit) : false;
});

/**
 * The selected unit's stacking spells. `stackCount` is `undefined` for a spell
 * with nothing to count, so a stacking spell added later shows up here with no
 * change to this file.
 */
const stackSpells = computed<Spell[]>(() => {
  void version.value;
  const entry = selected.value;
  if (!entry) return [];
  return (entry.unit.spells ?? []).filter(
    (spell: Spell | undefined): spell is Spell => !!spell && spell.stackCount !== undefined
  );
});

/**
 * Show the whole map on the minimap. A plain flag on the director, read once
 * per frame by `Game.minimapBlips()` — nothing about it depends on the update
 * loop, which the panel has paused for as long as this tab is open.
 */
const revealMap = computed<boolean>(() => {
  void version.value;
  return hud.director.revealMap;
});

const setRevealMap = (on: boolean): void => {
  hud.director.revealMap = on;
  invalidate();
};

const onRevealMapChange = (event: Event): void =>
  setRevealMap((event.target as HTMLInputElement).checked);

/**
 * The debug layers (`src/game/debug/DebugOverlay.ts`). Not cheats, but they
 * live on this tab for the same reason `revealMap` does — they show you what
 * the match is hiding — and because the panel is deliberately at three tabs: at
 * 390px a fourth leaves each one about 63px.
 *
 * `routes` is the overlay the `N` key has always toggled, and the checkbox and
 * the key write the same field: `director.debug.routes` is an accessor onto
 * `NavigationSystem.debugRoutes`, so neither can be stale relative to the
 * other.
 */
const DEBUG_LAYERS: { key: keyof DebugFlags; label: string }[] = [
  { key: 'routes', label: 'Đường đi' },
  { key: 'terrain', label: 'Địa hình' },
  { key: 'collision', label: 'Va chạm' },
  { key: 'vision', label: 'Tầm nhìn' },
  { key: 'quadtree', label: 'Quadtree' },
];

const debugOn = (key: keyof DebugFlags): boolean => {
  // Read for the dependency, not for the value. See the file comment.
  void version.value;
  return hud.director.debug[key];
};

const setDebug = (key: keyof DebugFlags, on: boolean): void => {
  hud.director.debug[key] = on;
  invalidate();
};

const onDebugChange = (key: keyof DebugFlags, event: Event): void =>
  setDebug(key, (event.target as HTMLInputElement).checked);

const setInvulnerable = (on: boolean): void => {
  const entry = selected.value;
  if (!entry) return;
  hud.director.setInvulnerable(entry.unit, on);
  invalidate();
};

const onInvulnerableChange = (event: Event): void =>
  setInvulnerable((event.target as HTMLInputElement).checked);

const refill = (): void => {
  const entry = selected.value;
  if (!entry) return;
  hud.director.refill(entry.unit);
  invalidate();
};

const clearCooldowns = (): void => {
  const entry = selected.value;
  if (!entry) return;
  hud.director.clearCooldowns(entry.unit);
  invalidate();
};

/** Relative, because the buttons are `+1 / +10 / +100`; `setStackCount` itself is absolute. */
const addStacks = (spell: Spell, amount: number): void => {
  spell.setStackCount((spell.stackCount ?? 0) + amount);
  invalidate();
};

const clearStacks = (spell: Spell): void => {
  spell.setStackCount(0);
  invalidate();
};

const STACK_STEPS = [1, 10, 100];
</script>

<template>
  <div class="practice-tab-body">
    <!-- Who the cheats apply to. One row per unit, the same order and the same
         labels as Đấu thủ, so "Bot 2" means the same unit on both tabs. -->
    <div class="practice-cheat-units">
      <button
        v-for="(entry, index) in roster"
        :key="index"
        type="button"
        class="practice-cheat-unit"
        :class="{ selected: selected === entry }"
        :id="`practice-cheat-unit-${index}`"
        @click="selectUnit(index)"
      >
        <span class="practice-cheat-unit-label">{{ labelOf(index) }}</span>
        <span class="practice-cheat-unit-name">{{ entry.unit.name || 'Không tên' }}</span>
      </button>
    </div>

    <label class="pregame-toggle">
      <input
        type="checkbox"
        id="practice-cheat-invuln"
        :checked="invulnerable"
        @change="onInvulnerableChange"
      />
      <span>Bất tử</span>
    </label>

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
         the stack rows off a landscape phone on their own. -->
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

    <div class="practice-cheat-actions">
      <button type="button" class="practice-cheat-btn" id="practice-cheat-refill" @click="refill">
        Hồi đầy
      </button>
      <button
        type="button"
        class="practice-cheat-btn"
        id="practice-cheat-cooldowns"
        @click="clearCooldowns"
      >
        Xoá hồi chiêu
      </button>
    </div>

    <!-- One row per stacking spell. Nothing renders here for a champion whose
         kit does not accumulate anything, which is most of them. -->
    <div
      v-for="spell of stackSpells"
      :key="spell.id"
      class="practice-cheat-stack"
      :data-cheat-stack="spell.id"
    >
      <span class="practice-cheat-stack-name">
        {{ spell.name }}
        <strong class="practice-cheat-stack-count">{{ spell.stackCount }}</strong>
      </span>
      <span class="practice-cheat-stack-actions">
        <button
          v-for="step of STACK_STEPS"
          :key="step"
          type="button"
          class="practice-cheat-btn"
          @click="addStacks(spell, step)"
        >
          +{{ step }}
        </button>
        <button type="button" class="practice-cheat-btn" @click="clearStacks(spell)">Xoá</button>
      </span>
    </div>

    <p v-if="stackSpells.length === 0" class="practice-note">
      Tướng này không có chiêu cộng dồn. Bất tử, hồi đầy và xoá hồi chiêu vẫn dùng được.
    </p>
  </div>
</template>
