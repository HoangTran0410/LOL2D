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
 * at the bottom is about the *world*, and is `RulesTab`'s jungle/minion note
 * for the same reason.
 */
import { computed, inject, onUnmounted, ref, shallowRef } from 'vue';
import type { HudInteractions } from '../hudInteractions';
import type { BotBehaviour, RosterEntry } from '../../MatchDirector';
import type { ChampionLoadout } from '../../config/PregameConfig';
import { AI_COUNT_MAX, DEFAULT_CHAMPION_LOADOUT } from '../../config/PregameConfig';
import AIChampion from '../../gameObject/attackableUnits/AIChampion';
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
/** Which slot the editor opens on. Q by default, the way the editor itself defaults. */
const editingSlot = shallowRef(1);

const openEditor = (entry: RosterEntry, index: number, slot = 1): void => {
  editing.value = entry;
  editingIndex.value = index;
  editingSlot.value = slot;
};

/**
 * The desktop strip's per-icon shortcut lands here: clicking your own Q used
 * to open the picker aimed at that slot, and now opens this tab's editor on
 * the player's row, aimed at that slot. Consumed once — the flag is cleared
 * immediately, so switching tabs and coming back does not re-open the editor.
 */
const requestedSlot = hud.editPlayerSlot;
if (requestedSlot !== null) {
  const index = roster.value.findIndex(entry => entry.isPlayer);
  if (index >= 0) openEditor(roster.value[index], index, requestedSlot);
  hud.editPlayerSlot = null;
}

/**
 * Escape closes the innermost layer first — the editor over this tab, not the
 * panel under it — which is the rule commit `b48ef7d` set for the setup
 * screen's own nested modals. The handler lives on the shared `hud` object
 * because the key never reaches the DOM: p5 binds `keydown` on `window` and
 * `GameScene` routes it. Returning `false` when nothing is open lets Escape
 * fall through to the panel.
 */
hud.onEscapeInner = () => {
  if (!editing.value) return false;
  editing.value = null;
  return true;
};

onUnmounted(() => {
  hud.onEscapeInner = null;
});

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

</script>

<template>
  <div class="practice-tab-body practice-roster-body">
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
    >
      <i class="fas fa-plus"></i>
      <span>{{ atCap ? `Đã đủ ${AI_COUNT_MAX} bot — xoá bớt để thêm` : 'Thêm bot' }}</span>
      <span class="practice-add-bot-count">{{ bots.length }}/{{ AI_COUNT_MAX }}</span>
    </button>

    <Teleport to="body">
      <div
        v-if="editing"
        class="practice-editor-host"
      >
        <LoadoutEditorModal
          :title="`Đổi tướng — ${labelOf(editingIndex)}`"
          :loadout="editingLoadout"
          :initial-slot="editingSlot"
          :match-rules="hud.director.matchRules"
          :is-touch-ui="hud.touchUi"
          @change="applyLoadout"
          @close="editing = null"
        />
      </div>
    </Teleport>
  </div>
</template>
