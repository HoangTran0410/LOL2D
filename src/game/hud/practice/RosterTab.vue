<script setup lang="ts">
/**
 * The live roster: who is in this match, and every knob on each of them.
 *
 * The setup screen's Players tab answers the same question about a match that
 * does not exist yet, and this deliberately reads like it — a row per
 * participant, portrait and kit on the left, the row itself the way into the
 * loadout editor, a delete on the right (`ParticipantCard.vue`). What differs
 * is what a row *is*. There, a row is an entry in a `readonly ChampionLoadout[]`
 * and removing one is an array splice. Here it is a live unit holding a
 * quadtree slot, a path agent and a spell list mid-cooldown, and every edit
 * goes through `MatchDirector` — so this component owns no roster state at all,
 * only a view of the director's.
 *
 * ## The row shows the unit's name; the editor shows the loadout
 *
 * Two different facts, and the row cannot be used as a source for the other.
 * The row is who is standing on the map — after a swap to Zed, "Zed"; on the
 * default config, "Random", because `getChampionPresetRandom` names a rolled
 * mix that and there is no champion to name. The editor opens on the *setting*:
 * "Ngẫu Nhiên", the thing a player would be editing and the thing that keeps a
 * bot re-rolling on every respawn. Reading the row back as a loadout would
 * silently pin a bot that was meant to keep rolling — hence
 * `MatchDirector.loadoutOf`, since `getChampionPresetFromLoadout` is one-way.
 *
 * ## What lands when
 *
 * A champion *swap* lands on the unit the moment it is confirmed: it mutates a
 * unit already in the world, and only the canvas has to wait (the panel opens
 * paused, so nothing redraws). Add and remove are the other kind — they need
 * `ObjectManager.update()`, which flushes `_objectToBeAdd` and sweeps
 * `toRemove`, and that cannot run until the panel closes. The roster shows them
 * immediately anyway, because `MatchDirector.bots()` counts both sets; the note
 * at the bottom is about the *world*, and is `WorldTab`'s note for the same
 * reason.
 */
import { computed, inject, ref, shallowRef } from 'vue';
import type { HudInteractions } from '../hudInteractions';
import type { BotBehaviour, RosterEntry } from '../../MatchDirector';
import type { ChampionLoadout } from '../../config/PregameConfig';
import { AI_COUNT_MAX, DEFAULT_CHAMPION_LOADOUT } from '../../config/PregameConfig';
import AIChampion from '../../gameObject/attackableUnits/AIChampion';
import { TAP_MOVE_TOLERANCE_PX } from '../hudInteractions';
import LoadoutEditorModal from '../../../scenes/setup/LoadoutEditorModal.vue';

const hud = inject<HudInteractions>('hud')!;

/**
 * Bumped after every mutation, and read by the `computed` below purely to make
 * it re-run. A counter rather than the alternatives, both of which were
 * considered:
 *
 *   - *Making the roster reactive* is ruled out upstream. `hudInteractions.ts`
 *     wraps the director in `markRaw` on purpose: a proxied director hands back
 *     a proxied `objectManager`, proxied units and proxied p5 vectors — the
 *     whole game graph — on every read, which is a real cost paid every frame
 *     to solve a problem that only exists while this tab is open.
 *   - *`EventManager`* (`src/managers/EventManager.ts`) is the game's own bus
 *     and would be the right seam if anything else needed to hear about a
 *     roster change. Nothing does. It would mean a new `EventType`, an emit in
 *     three `MatchDirector` methods and a subscribe/unsubscribe lifecycle here,
 *     to deliver a message from this component to itself — this component is
 *     the only thing that mutates the roster while the panel is open, and it
 *     already knows exactly when it did.
 *
 * The counter stays contained to this file, and the invariant that keeps it
 * honest is one line: every director call in this component is followed by
 * `version.value++`.
 */
const version = ref(0);
const invalidate = (): void => {
  version.value++;
};

const roster = computed<RosterEntry[]>(() => {
  // Read for the dependency, not for the value.
  void version.value;
  return hud.director.roster();
});

const bots = computed(() => roster.value.filter(entry => !entry.isPlayer));
const atCap = computed(() => bots.value.length >= AI_COUNT_MAX);

/**
 * `RosterEntry.unit` is a `Champion`, which is the honest type — the player is
 * one and has no behaviour flags. `setBotBehaviour` and `removeBot` want the
 * narrower thing, so this checks rather than casts: `entry.behaviour` being
 * present already implies a bot, but implying is not proving, and the roster is
 * built from live objects the panel does not own.
 */
const botOf = (entry: RosterEntry): AIChampion | null =>
  entry.unit instanceof AIChampion ? entry.unit : null;

/** "Bạn", then Bot 1..n in spawn order — the position in the list, not a unit id. */
const labelOf = (index: number): string => (index === 0 ? 'Bạn' : `Bot ${index}`);

const addBot = (): void => {
  // The cap is the director's (`addBot` returns null at `AI_COUNT_MAX`); the
  // button is disabled and the count is on screen so a refusal is never the
  // player's first hint that there was a limit.
  hud.director.addBot(DEFAULT_CHAMPION_LOADOUT);
  invalidate();
};

const removeBot = (entry: RosterEntry): void => {
  const bot = botOf(entry);
  if (!bot) return;
  hud.director.removeBot(bot);
  invalidate();
};

const setFlag = (entry: RosterEntry, flag: keyof BotBehaviour, on: boolean): void => {
  const bot = botOf(entry);
  if (!bot) return;
  const flags: Partial<BotBehaviour> = {};
  flags[flag] = on;
  hud.director.setBotBehaviour(bot, flags);
  invalidate();
};

const onFlagChange = (entry: RosterEntry, flag: keyof BotBehaviour, event: Event): void =>
  setFlag(entry, flag, (event.target as HTMLInputElement).checked);

const BEHAVIOUR_FLAGS: { key: keyof BotBehaviour; label: string }[] = [
  // Same three settings, same order and the same words as `AiConfigPanel.vue`
  // on the setup screen, minus its "AI" prefix — out here the row already says
  // whose flags these are.
  { key: 'autoMove', label: 'Tự di chuyển' },
  { key: 'autoAttack', label: 'Tự tấn công' },
  { key: 'autoCast', label: 'Tự dùng kỹ năng' },
];

/**
 * `shallowRef`, not `ref`: `ref` deep-converts what it is given, and this holds
 * a live `Champion`. See `hudInteractions.ts`'s `markRaw` on the director for
 * the same decision and the same reason.
 */
const editing = shallowRef<RosterEntry | null>(null);
const editingIndex = shallowRef(0);

const openEditor = (entry: RosterEntry, index: number): void => {
  editing.value = entry;
  editingIndex.value = index;
};

const editingLoadout = computed<ChampionLoadout>(() =>
  editing.value ? hud.director.loadoutOf(editing.value.unit) : DEFAULT_CHAMPION_LOADOUT
);

const applyLoadout = (loadout: ChampionLoadout): void => {
  if (editing.value) hud.director.applyLoadout(editing.value.unit, loadout);
  editing.value = null;
  invalidate();
};

/**
 * ## The editor is teleported out of the panel, and it has to be
 *
 * `.practice-panel` is `position: fixed` *with a transform* (it is centred with
 * `translate(-50%, -50%)`), and a transform makes an element the containing
 * block for its `position: fixed` descendants. Rendered in place, the editor's
 * `.pregame-modal-backdrop` — `position: fixed; inset: 0` — would resolve
 * `inset: 0` against the panel's 760px × 90vh box instead of the viewport: a
 * "full-screen" backdrop the size of the panel behind it, with the dialog
 * overflowing it. `KitRoster`'s `.spell-peek` has the same problem twice over,
 * since it computes its own `top`/`left` from `getBoundingClientRect()`, i.e.
 * in viewport coordinates.
 *
 * Teleporting to `<body>` puts both back in the viewport's coordinate space and
 * in the root stacking context, where `z-index: 200` clears the HUD. The host
 * is `display: contents` so it adds no box of its own.
 */

/**
 * ## Touch, twice over: the scroll the browser will not perform and the click
 * it will not send
 *
 * `GameScene`'s p5 touch handlers `preventDefault()` every touch on the *page*
 * (needed so a drag across the canvas is a control input rather than a scroll),
 * and a gesture that has had `preventDefault()` called on it gets neither the
 * browser's native scrolling nor the trailing synthetic `click` — anywhere on
 * the page, not just over the canvas. Both halves bite here, in two places:
 *
 *   - **This tab's own body.** `.practice-tab-body` is `overflow-y: auto`, and
 *     six units at two lines each overflow a 390px-tall landscape phone by
 *     several hundred pixels. Untouched, the list would not scroll under a
 *     thumb and the add button — last in the flow — would be unreachable.
 *     (`RulesTab`/`WorldTab` never hit this: two controls each, no overflow.)
 *   - **The loadout editor.** `LoadoutEditorModal` and `KitRoster` drive every
 *     action from `@click` and let the browser scroll their roster, which is
 *     right where they were written — `useSpellPeek.ts` says in as many words
 *     that the setup screen is a plain DOM overlay where a tap synthesises a
 *     click. Opened from *inside a match*, neither assumption survives.
 *
 * So one gesture tracker serves both: it scrolls whatever the finger went down
 * in, and it distinguishes a tap from a drag with the same
 * `TAP_MOVE_TOLERANCE_PX` a browser's own click-vs-drag heuristic would have
 * applied for free — the shape `SpellPickerModal.vue` already uses for the
 * picker's list and `hudInteractions.touchSpellEnd` for its icons. The two
 * differ only in what a tap then does: this tab's controls have real handlers
 * and go through `onTap`, while the editor has none of its own and gets the
 * missing click synthesised at the point the finger lifted. That bridge lives
 * here rather than in the editor because the editor is not what is broken —
 * this host is, and only this host.
 *
 * Deliberately *not* conditional on `hud.touchUi`: that flag is a rendering
 * preference (it can be forced on for a mouse), while this is about which
 * events actually arrive. A browser that did synthesise its own click would
 * double-fire the editor's, which is survivable because every action reachable
 * through the bridge is idempotent — picking the same spell into the same slot,
 * selecting the selected slot, applying the applied kit — and the two that are
 * not (Huỷ, Xác nhận) unmount the editor on the first, leaving the second
 * nothing to land on.
 *
 * One tracker for both surfaces is safe because they are mutually exclusive: a
 * finger is on the editor or on the tab under it, never on both, and the
 * editor's backdrop covers the panel while it is open.
 */
let tapX = 0;
let tapY = 0;
let tapMoved = false;
let scroller: HTMLElement | null = null;
let scrollStartTop = 0;

/**
 * The nearest ancestor that can actually scroll — `.practice-tab-body` here,
 * `.pregame-modal-body` in the editor — found rather than named, so a change to
 * either layout cannot silently leave this scrolling nothing.
 */
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
  // Measured from where the finger went down, not from the last frame, so the
  // list cannot drift away from the thumb over a long drag.
  if (scroller) scroller.scrollTop = scrollStartTop - (touch.clientY - tapY);
  if (tapMoved) return;
  if (Math.hypot(touch.clientX - tapX, touch.clientY - tapY) <= TAP_MOVE_TOLERANCE_PX) return;
  // Past here the gesture is that scroll, not a tap on whatever happened to be
  // under the finger when it started.
  tapMoved = true;
};

/** What a `click` would have done, for this tab's own controls. */
const onTap = (action: () => void): void => {
  scroller = null;
  if (tapMoved) return;
  action();
};

/** The same, for an editor whose controls only listen for `click`. */
const onEditorTouchEnd = (event: TouchEvent): void => {
  scroller = null;
  if (tapMoved) return;
  const touch = event.changedTouches[0];
  if (!touch) return;
  // Where the finger *lifted*, resolved against the live document, so a list
  // that scrolled or re-rendered mid-gesture cannot hand the click to the
  // element that used to be there.
  const element = document.elementFromPoint(touch.clientX, touch.clientY);
  (element as HTMLElement | null)?.click?.();
};
</script>

<template>
  <div
    class="practice-tab-body practice-roster-body"
    @touchstart="onTouchStart"
    @touchmove="onTouchMove"
  >
    <div
      v-for="(entry, index) in roster"
      :key="index"
      class="practice-roster-row"
      :class="{ 'is-player': entry.isPlayer }"
    >
      <div class="practice-roster-main">
        <button
          type="button"
          class="practice-roster-open"
          :aria-label="`Đổi tướng của ${labelOf(index)}`"
          @click="openEditor(entry, index)"
          @touchend.prevent="onTap(() => openEditor(entry, index))"
        >
          <span
            class="practice-roster-portrait"
            :class="{ 'is-empty': !entry.unit.avatar }"
            aria-hidden="true"
          >
            <img v-if="entry.unit.avatar" :src="entry.unit.avatar.url" alt="" />
            <i v-else class="fas fa-random"></i>
          </span>
          <span class="practice-roster-text">
            <span class="practice-roster-label">{{ labelOf(index) }}</span>
            <span class="practice-roster-name">{{ entry.unit.name || 'Không tên' }}</span>
          </span>
          <i class="fas fa-chevron-right practice-roster-chevron" aria-hidden="true"></i>
        </button>

        <button
          v-if="!entry.isPlayer"
          type="button"
          class="practice-remove-bot"
          :aria-label="`Xoá ${labelOf(index)}`"
          title="Xoá bot này"
          @click="removeBot(entry)"
          @touchend.prevent="onTap(() => removeBot(entry))"
        >
          <i class="fas fa-times"></i>
        </button>
      </div>

      <!-- Bots only: the player's own movement, attacks and casts are the
           player's. -->
      <div v-if="entry.behaviour" class="practice-roster-flags">
        <label
          v-for="flag of BEHAVIOUR_FLAGS"
          :key="flag.key"
          class="pregame-toggle practice-flag"
          @touchend.prevent="onTap(() => setFlag(entry, flag.key, !entry.behaviour![flag.key]))"
        >
          <input
            type="checkbox"
            :checked="entry.behaviour[flag.key]"
            @change="onFlagChange(entry, flag.key, $event)"
          />
          <span>{{ flag.label }}</span>
        </label>
      </div>
    </div>

    <p class="practice-note">Thêm và xoá có hiệu lực khi bạn đóng bảng và trận chạy tiếp.</p>

    <!-- Last in the flow, like the setup screen's "Thêm Bot", but pinned to the
         bottom of the scroller (`position: sticky`) — with ten two-line rows
         above it there is no viewport this game runs on where it would still be
         on screen otherwise. The count is on the button rather than in a note
         beside it for the same reason: at the cap, the one control the player is
         pressing is the one that has to explain itself. -->
    <button
      type="button"
      class="practice-add-bot"
      :disabled="atCap"
      @click="addBot"
      @touchend.prevent="onTap(() => !atCap && addBot())"
    >
      <i class="fas fa-plus"></i>
      <span>{{ atCap ? `Đã đủ ${AI_COUNT_MAX} bot — xoá bớt để thêm` : 'Thêm bot' }}</span>
      <span class="practice-add-bot-count">{{ bots.length }}/{{ AI_COUNT_MAX }}</span>
    </button>

    <Teleport to="body">
      <div
        v-if="editing"
        class="practice-editor-host"
        @touchstart="onTouchStart"
        @touchmove="onTouchMove"
        @touchend="onEditorTouchEnd"
      >
        <LoadoutEditorModal
          :title="`Đổi tướng — ${labelOf(editingIndex)}`"
          :loadout="editingLoadout"
          :match-rules="hud.director.matchRules"
          :is-touch-ui="hud.touchUi"
          @change="applyLoadout"
          @close="editing = null"
        />
      </div>
    </Teleport>
  </div>
</template>
