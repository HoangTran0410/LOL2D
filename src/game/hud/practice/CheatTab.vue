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
 * ## Touch, twice over
 *
 * `GameScene` `preventDefault()`s every touch on the *page*, which suppresses
 * both the synthetic `click` and native scrolling everywhere — so every
 * control below carries a `touchend` handler beside its `click` one, and this
 * tab scrolls by hand the way `RosterTab` does. Eleven units and four stack
 * rows overflow a 390px-tall landscape phone easily.
 */
import { computed, inject, ref } from 'vue';
import type { HudInteractions } from '../hudInteractions';
import type { RosterEntry } from '../../MatchDirector';
import type Spell from '../../gameObject/Spell';
import { TAP_MOVE_TOLERANCE_PX } from '../hudInteractions';

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

/**
 * The hand-rolled scroll, the same shape and for the same reason as
 * `RosterTab.vue`'s — a gesture the canvas has already `preventDefault()`ed
 * gets neither native scrolling nor a trailing click, so both have to be done
 * here. `onTap` is what a `click` would have been.
 */
let tapX = 0;
let tapY = 0;
let tapMoved = false;
let scroller: HTMLElement | null = null;
let scrollStartTop = 0;

const scrollerOf = (start: EventTarget | null): HTMLElement | null => {
  let node = start instanceof Element ? (start as HTMLElement) : null;
  while (node && node !== document.body) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
};

const onTouchStart = (event: TouchEvent): void => {
  const touch = event.touches[0];
  tapMoved = false;
  tapX = touch?.clientX ?? 0;
  tapY = touch?.clientY ?? 0;
  scroller = scrollerOf(event.target);
  scrollStartTop = scroller?.scrollTop ?? 0;
};

const onTouchMove = (event: TouchEvent): void => {
  const touch = event.touches[0];
  if (!touch) return;
  if (scroller) scroller.scrollTop = scrollStartTop - (touch.clientY - tapY);
  if (tapMoved) return;
  if (Math.hypot(touch.clientX - tapX, touch.clientY - tapY) <= TAP_MOVE_TOLERANCE_PX) return;
  tapMoved = true;
};

const onTap = (action: () => void): void => {
  scroller = null;
  if (tapMoved) return;
  action();
};
</script>

<template>
  <div class="practice-tab-body" @touchstart="onTouchStart" @touchmove="onTouchMove">
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
        @touchend.prevent="onTap(() => selectUnit(index))"
      >
        <span class="practice-cheat-unit-label">{{ labelOf(index) }}</span>
        <span class="practice-cheat-unit-name">{{ entry.unit.name || 'Không tên' }}</span>
      </button>
    </div>

    <label class="pregame-toggle" @touchend.prevent="onTap(() => setInvulnerable(!invulnerable))">
      <input
        type="checkbox"
        id="practice-cheat-invuln"
        :checked="invulnerable"
        @change="onInvulnerableChange"
      />
      <span>Bất tử</span>
    </label>

    <label class="pregame-toggle" @touchend.prevent="onTap(() => setRevealMap(!revealMap))">
      <input
        type="checkbox"
        id="practice-cheat-reveal-map"
        :checked="revealMap"
        @change="onRevealMapChange"
      />
      <span>Hiện toàn bản đồ</span>
    </label>

    <div class="practice-cheat-actions">
      <button
        type="button"
        class="practice-cheat-btn"
        id="practice-cheat-refill"
        @click="refill"
        @touchend.prevent="onTap(refill)"
      >
        Hồi đầy
      </button>
      <button
        type="button"
        class="practice-cheat-btn"
        id="practice-cheat-cooldowns"
        @click="clearCooldowns"
        @touchend.prevent="onTap(clearCooldowns)"
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
          @touchend.prevent="onTap(() => addStacks(spell, step))"
        >
          +{{ step }}
        </button>
        <button
          type="button"
          class="practice-cheat-btn"
          @click="clearStacks(spell)"
          @touchend.prevent="onTap(() => clearStacks(spell))"
        >
          Xoá
        </button>
      </span>
    </div>

    <p v-if="stackSpells.length === 0" class="practice-note">
      Tướng này không có chiêu cộng dồn. Bất tử, hồi đầy và xoá hồi chiêu vẫn dùng được.
    </p>
  </div>
</template>
