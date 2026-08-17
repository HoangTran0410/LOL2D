<script setup lang="ts">
/**
 * The loadout editor: one screen, seven slots, one roster.
 *
 * It used to be a mode toggle over two different editors, each of which
 * opened a *third* view — a per-slot catalogue you drilled into, highlighted
 * in, and committed out of, one slot at a time. Assembling a kit meant seven
 * round trips through a dialog inside a dialog, and choosing a champion in
 * "Chọn Tướng" and then changing one ability meant starting over in "Tự Ghép
 * Chiêu". This replaces all of it with the shape the in-game HUD picker
 * already had: the slot row pinned at
 * the top, the whole roster scrolling underneath it, and picks batched behind
 * Xác nhận so a player can keep changing their mind. Same roster, same order,
 * same two gestures — see `KitRoster.vue`.
 *
 * ## The mode field survives, as a consequence rather than a question
 *
 * `ChampionLoadout.mode` still exists and still means what it did: `champion`
 * carries a portrait and a name (`ParticipantCard` shows both, and the match
 * spawns the champion's real kit), `custom` carries seven independent slot
 * choices. What is gone is *asking the player which one they are in*. The
 * gesture decides:
 *
 *   - a whole champion off the roster (or "Ngẫu Nhiên") is a champion pick;
 *   - changing D or F on a champion pick stays a champion pick, because
 *     champion mode stores those two separately (`summonerD`/`summonerF`) —
 *     picking your summoners was never what made a kit custom;
 *   - changing anything else — one ability, the basic attack, a summoner slot
 *     filled with something that is not a summoner spell — turns the loadout
 *     custom, with the champion's own kit copied into the seven slots first
 *     (`toCustom`), so "Ahri but with Flash on A" is one tap from Ahri rather
 *     than a fresh build.
 *
 * A champion whose shelf carries only part of a kit (Graves, Olaf — see
 * `KitShelf.championName`) has no name the config can store, so taking its
 * kit goes through the custom path and writes only the slots it covers.
 *
 * ## Draft, not write-through
 *
 * Every other control on this screen writes straight to `localStorage` on
 * change. This one doesn't: `draft` is edited freely and only `emit('change')`
 * on "Xác nhận" reaches `usePregameConfig`. The X and the backdrop both
 * discard it — there was a "Huỷ" button beside Xác nhận too, dropped once the
 * slot bar had to hold the view toggle as well; two adjacent buttons whose
 * outcomes differ by the whole edit was the mis-hit worth removing anyway. That is the in-game picker's contract, and it is what makes
 * "take Ahri's kit, then swap her R" a thing you can back out of.
 *
 * ## Saving is a third act, next to those two
 *
 * "Lưu bộ" copies the draft into the saved-kit library
 * (`src/game/config/savedKits.ts`, its own storage key) and does nothing else:
 * it neither closes the editor nor commits the draft to the match, because
 * "keep this kit for later" and "play this kit now" are different answers and
 * a player will often want both, in either order. The library comes back as
 * the shelf at the top of the roster, and applying one from there replaces the
 * draft wholesale.
 *
 * This editor is shared with the in-game practice panel (`RosterTab.vue`
 * mounts it over a paused match), so both screens get the library and the same
 * kit crosses between them.
 */
import { ref, computed, nextTick } from 'vue';
import type { ChampionLoadout, MatchRules, SlotChoice } from '../../game/config/PregameConfig';
import { SLOT_COUNT } from '../../game/config/PregameConfig';
import {
  deleteKit,
  loadSavedKits,
  saveKit,
  SAVED_KIT_NAME_MAX,
  type SavedKit,
} from '../../game/config/savedKits';
import { SpellHotKeys } from '../../game/constants';
import { BASIC_ATTACK_ID, getSpellDisplay, type SpellCatalogEntry } from '../../game/preset';
import { getPregameCatalog, type KitShelf } from './pregameCatalog';
import { kitRosterView, setKitRosterView } from './kitRosterView';
import KitRoster from './KitRoster.vue';
import SpellDetailPane from './SpellDetailPane.vue';
import SpellIcon from './SpellIcon.vue';
import { useSpellPeek } from './useSpellPeek';

const props = defineProps<{
  title: string;
  loadout: ChampionLoadout;
  matchRules: MatchRules;
  isTouchUi: boolean;
  /**
   * Which slot the editor opens on, when the gesture that opened it already
   * named one. The practice panel's `RosterTab` passes it through from the
   * in-game HUD strip, where clicking your own Q means "change *this*". The
   * setup screen omits it: a row there is opened as a whole loadout.
   */
  initialSlot?: number;
}>();
const emit = defineEmits<{ change: [ChampionLoadout]; close: [] }>();

const { champions, summoners, catalogById, catalogByClass, kitShelves } = getPregameCatalog();

/** A, Q, W, E, R, D, F — same order and source as the real in-game hotkeys. */
const SLOT_LABELS = SpellHotKeys.map(code => String.fromCharCode(code));
/** The two summoner slots, by index into a `customSlots` array. */
const SLOT_D = SLOT_COUNT - 2;
const SLOT_F = SLOT_COUNT - 1;

const draft = ref<ChampionLoadout>({
  ...props.loadout,
  customSlots: props.loadout.customSlots.slice(),
});
/** Which slot the next roster tap fills. Q unless the caller named one — the first slot anyone changes. */
const activeSlot = ref(props.initialSlot ?? 1);

const entryById = (id: string): SpellCatalogEntry | null =>
  id === 'random' ? null : (catalogById.get(id) ?? null);

/**
 * The seven slots a loadout resolves to, as catalogue entries — `null` where
 * the match will roll the dice. Deliberately mirrors
 * `getChampionPresetFromLoadout`, which is what actually builds the champion:
 * champion mode is `[BasicAttack, ...the shelf's four in order, D, F]`, and a
 * random champion is that with the four abilities left open.
 */
const resolveSlots = (loadout: ChampionLoadout): (SpellCatalogEntry | null)[] => {
  if (loadout.mode === 'custom') {
    return Array.from({ length: SLOT_COUNT }, (_, i) =>
      entryById(loadout.customSlots[i] ?? 'random')
    );
  }

  const tail = [entryById(loadout.summonerD), entryById(loadout.summonerF)];
  const champion =
    loadout.championName === 'random'
      ? undefined
      : champions.find(entry => entry.name === loadout.championName);

  if (!champion) return [entryById(BASIC_ATTACK_ID), null, null, null, null, ...tail];
  return [
    entryById(BASIC_ATTACK_ID),
    ...champion.spells.map(spell => catalogByClass.get(spell.spellClass) ?? null),
    ...tail,
  ];
};

const draftSlots = computed(() => resolveSlots(draft.value));
/** What the player walked in with — the slot row marks anything that differs, so "Xác nhận" has a visible scope. */
const originalSlots = computed(() => resolveSlots(props.loadout));

const slots = computed(() =>
  Array.from({ length: SLOT_COUNT }, (_, index) => ({
    index,
    label: SLOT_LABELS[index],
    entry: draftSlots.value[index] ?? null,
    changed: (draftSlots.value[index]?.id ?? null) !== (originalSlots.value[index]?.id ?? null),
    title:
      index === 0
        ? 'Phím đòn đánh thường'
        : `Phím ${SLOT_LABELS[index]}${index >= SLOT_D ? ' (phép bổ trợ)' : ''}`,
  }))
);

/* ------------------------------------------------- the description panel */

/**
 * One `useSpellPeek` for the whole editor, driven from two places: the slot
 * pills in the bar below, and the roster's cards (`KitRoster` takes it as a
 * prop rather than making its own — two instances would be two panels).
 *
 * The pills carry the same spells the roster does, so leaving them mute meant
 * the one question a player is most likely to have — "what is already in my
 * Q?" — was the one the screen would not answer without first finding that
 * spell again among 85 cards.
 */
const peek = useSpellPeek();
const {
  display: peekDisplay,
  style: peekStyle,
  heldOpen: peekHeldOpen,
  hoverStart,
  hoverEnd,
  touchStart,
  touchMove,
  touchEnd,
  close: closePeek,
} = peek;

/** The panel's copy of a spell, rebuilt under this match's CDR/URF — same as `KitRoster.detailOf`. */
const detailOf = (entry: SpellCatalogEntry) => getSpellDisplay(entry.spellClass, props.matchRules);

/**
 * Same rule the roster's `pick` follows: a hold has already answered "what is
 * this", and the click the browser sends afterwards must not also move the
 * selection out from under the description that just opened.
 */
const selectSlot = (index: number): void => {
  if (touchEnd()) return;
  activeSlot.value = index;
};

const activeEntryId = computed(() => draftSlots.value[activeSlot.value]?.id ?? null);
const selectedChampion = computed(() =>
  draft.value.mode === 'champion' ? draft.value.championName : null
);

const isSummonerId = (id: string): boolean => summoners.some(option => option.id === id);

/** Champion mode expanded into seven explicit choices, so a single-slot edit can leave the rest exactly as they were. */
const toCustom = (loadout: ChampionLoadout): ChampionLoadout => {
  if (loadout.mode === 'custom') return loadout;
  return {
    ...loadout,
    mode: 'custom',
    customSlots: resolveSlots(loadout).map(entry => (entry?.id ?? 'random') as SlotChoice),
  };
};

const writeSlots = (loadout: ChampionLoadout, edits: { index: number; id: string }[]): void => {
  const next = toCustom(loadout);
  const customSlots = next.customSlots.slice();
  for (const { index, id } of edits) {
    if (index >= 0 && index < SLOT_COUNT) customSlots[index] = id;
  }
  draft.value = { ...next, customSlots };
};

const pickSpell = (entry: SpellCatalogEntry): void => {
  const index = activeSlot.value;
  const loadout = draft.value;

  // D/F on a champion pick have their own fields — filling them is not what
  // makes a kit custom, so the portrait and the champion's name survive it.
  if (
    loadout.mode === 'champion' &&
    (index === SLOT_D || index === SLOT_F) &&
    isSummonerId(entry.id)
  ) {
    draft.value = { ...loadout, [index === SLOT_D ? 'summonerD' : 'summonerF']: entry.id };
    return;
  }

  writeSlots(loadout, [{ index, id: entry.id }]);
};

const applyKit = (shelf: KitShelf): void => {
  if (shelf.championName) {
    // A full champion: stored by name so the loadout keeps its identity — the
    // portrait on the participant card, and `SpellGroups`' own kit at spawn.
    // The summoners the player already chose are not part of that and stay.
    draft.value = { ...draft.value, mode: 'champion', championName: shelf.championName };
    return;
  }
  // A partial shelf. No `championName` can name it, so it lands in the custom
  // kit — only the slots its abilities claim, everything else untouched.
  writeSlots(
    draft.value,
    shelf.kit.map(({ entry, slotIndex }) => ({ index: slotIndex, id: entry.id }))
  );
};

/** The whole loadout bocked to chance — a champion-level choice, like taking a champion's kit. */
const pickRandom = (): void => {
  draft.value = { ...draft.value, mode: 'champion', championName: 'random' };
};

/**
 * *One* slot left to chance (`SlotChoice`'s `'random'`), which the match
 * resolves per spawn out of the whole catalogue. Lives on the slot bar
 * rather than in the roster because it acts on the selected slot, not on a
 * spell — putting it among the spell cards would make it a second thing in
 * there that isn't one, next to a whole-loadout random card it would be
 * constantly mistaken for.
 *
 * No special case for D/F: a summoner slot on a champion pick has to name a
 * real summoner spell (see `ChampionLoadout.summonerD`), so leaving it to
 * chance turns the loadout custom through the same path a non-summoner pick
 * does.
 */
const randomizeSlot = (): void => {
  writeSlots(draft.value, [{ index: activeSlot.value, id: 'random' }]);
};

const activeSlotIsRandom = computed(() => draftSlots.value[activeSlot.value] === null);

/* ------------------------------------------------------------ saved kits */

/**
 * ## An inline row, not `window.prompt`
 *
 * `prompt` would be three lines and does work over a paused canvas, but it is
 * a Chrome-chrome dialog dropped on top of a hextech screen, it cannot be
 * styled, tested through the touch path the rest of this modal uses, or
 * dismissed by the same gestures — and in the in-game copy of this editor
 * (`RosterTab.vue`'s teleported host) the surrounding UI is reached by
 * synthesised clicks, which a modal native dialog would sit outside of
 * entirely. The row costs a `v-if` and stays inside the editor's own idiom.
 *
 * Two things it has to get right that a `prompt` would have got for free:
 *
 *   - **A blank name.** `saveKit` throws on one (an unnamed kit is
 *     unfindable), so the confirm button is disabled until the name has
 *     something in it once trimmed, and the call is wrapped anyway — a
 *     library write is not worth an unhandled error in the console.
 *   - **Keystrokes belong to the game.** p5 listens for `keydown` on `window`
 *     and `GameScene.keyPressed` turns A/Q/W/E/R/D/F into casts and Escape
 *     into "leave the match". Typing "Ahri quái" into an unguarded input
 *     mid-match would fire four abilities, and one Escape would drop the
 *     player to the menu. `@keydown.stop` (plus keyup/keypress, which p5 also
 *     listens for) keeps the letters in the field. The setup screen never
 *     needed this — there is no `GameScene` under it — but the editor is
 *     shared, so the guard lives with the input rather than with the caller.
 */
const savedKits = ref<SavedKit[]>(loadSavedKits());
const naming = ref(false);
const kitName = ref('');
const saveError = ref('');
const nameInput = ref<HTMLInputElement | null>(null);
const rosterBody = ref<HTMLElement | null>(null);

const toggleSave = (): void => {
  if (naming.value) {
    naming.value = false;
    return;
  }
  saveError.value = '';
  // Prefilled with the champion the draft is, when it is one: most saves are
  // "Ahri, but…", and a name is easier to edit than to invent.
  kitName.value =
    draft.value.mode === 'champion' && draft.value.championName !== 'random'
      ? draft.value.championName
      : '';
  naming.value = true;
  void nextTick(() => nameInput.value?.focus());
};

const cancelSave = (): void => {
  naming.value = false;
  saveError.value = '';
};

const commitSave = (): void => {
  try {
    saveKit(kitName.value, draft.value);
  } catch {
    saveError.value = 'Bộ chiêu cần một cái tên.';
    return;
  }
  savedKits.value = loadSavedKits();
  naming.value = false;
  kitName.value = '';
  // The shelf is the top row of the roster and the roster is what scrolls, so
  // sending it back to the top *is* the "it saved" feedback: the new kit
  // appears where the player is looking instead of somewhere above it.
  if (rosterBody.value) rosterBody.value.scrollTop = 0;
};

const onNameKey = (event: KeyboardEvent): void => {
  if (event.key === 'Enter') {
    event.preventDefault();
    if (kitName.value.trim()) commitSave();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    cancelSave();
  }
};

/**
 * A real tap focuses a text field on its own; the synthetic click that
 * `RosterTab`'s touch bridge sends in place of the one the browser suppresses
 * does not. One line, and the field is typable under a thumb in a match.
 */
const focusName = (): void => nameInput.value?.focus();

/**
 * Wholesale, never merged into what is already there. A saved kit is all seven
 * slots plus the mode and the champion name, so replacing the draft is what
 * makes the slot row, the highlighted card and the selected shelf all move
 * together — a field-by-field merge would leave, say, a champion pick's
 * portrait standing over a custom kit's slots. Copied, not aliased: `draft` is
 * about to be edited and the stored kit must not follow it.
 */
const applySavedKit = (kit: SavedKit): void => {
  draft.value = { ...kit.loadout, customSlots: kit.loadout.customSlots.slice() };
};

const removeSavedKit = (kit: SavedKit): void => {
  deleteKit(kit.id);
  savedKits.value = loadSavedKits();
};

/* ------------------------------------------------------ compact / expanded */

/**
 * The roster is ~50 shelves and ~200 ability icons, which is a long scroll to
 * find one champion in — and taking a whole kit is what most opens of this
 * editor are for. Compact keeps the champion tiles and drops everything else;
 * expanded is the roster as it was.
 *
 * The state is in a module (`kitRosterView.ts`) and not a `ref` here, because
 * this modal is mounted with `v-if` and `<script setup>` *is* the setup
 * function — a `ref` at the top of this block is rebuilt on every open.
 */
const compact = computed(() => kitRosterView.value === 'compact');

const toggleView = (): void => setKitRosterView(compact.value ? 'expanded' : 'compact');

const confirm = (): void => {
  emit('change', draft.value);
  emit('close');
};
const cancel = (): void => emit('close');

const hint = computed(() => {
  // Compact has no ability cards to tap, so the slot the roster would fill is
  // not what the screen is about — saying "đang chọn chiêu cho ô Q" over a grid
  // that cannot fill one is the hint pointing at the wrong gesture.
  if (compact.value) return 'Bấm một tướng để lấy cả bộ chiêu — mở rộng để chọn từng chiêu.';
  if (activeSlot.value === 0) {
    return 'Ô A là đòn đánh thường — đổi ô này là đổi luôn nhịp đánh của tướng.';
  }
  if (activeSlot.value >= SLOT_D) {
    return `Đang chọn phép bổ trợ cho ô ${SLOT_LABELS[activeSlot.value]}.`;
  }
  return `Đang chọn chiêu cho ô ${SLOT_LABELS[activeSlot.value]} — bấm tên tướng để lấy cả bộ.`;
});
</script>

<template>
  <div class="pregame-modal-backdrop" @click.self="cancel">
    <div class="pregame-modal loadout-modal">
      <header class="pregame-modal-header">
        <h3>{{ title }}</h3>
        <button type="button" class="pregame-icon-btn" title="Đóng" @click="cancel">
          <i class="fas fa-times"></i>
        </button>
      </header>

      <div class="kit-slot-bar">
        <button
          v-for="slot in slots"
          :key="slot.index"
          type="button"
          class="kit-slot-pill"
          :class="{ active: activeSlot === slot.index, changed: slot.changed }"
          :title="slot.title"
          @click="selectSlot(slot.index)"
          @mouseenter="!isTouchUi && slot.entry && hoverStart(detailOf(slot.entry), $event)"
          @mouseleave="!isTouchUi && hoverEnd()"
          @touchstart="slot.entry && touchStart(detailOf(slot.entry), $event)"
          @touchmove="touchMove($event)"
          @touchend="touchEnd()"
          @touchcancel="closePeek()"
          @contextmenu.prevent
        >
          <SpellIcon :display="slot.entry ? slot.entry.display : null" />
          <span class="kit-slot-pill-key">{{ slot.label }}</span>
        </button>

        <button
          type="button"
          class="kit-slot-pill kit-slot-random"
          :disabled="activeSlotIsRandom"
          :title="`Bốc thăm ô ${SLOT_LABELS[activeSlot]} khi vào trận`"
          @click="randomizeSlot"
        >
          <i class="fas fa-random"></i>
        </button>

        <div class="kit-bar-actions">
          <button
            type="button"
            class="kit-view-toggle"
            :class="{ compact }"
            id="kit-view-toggle"
            :title="compact ? 'Hiện từng chiêu' : 'Thu gọn — chỉ hiện tướng'"
            :aria-pressed="compact"
            @click="toggleView"
          >
            <i :class="compact ? 'fas fa-list' : 'fas fa-table-cells-large'"></i>
          </button>
          <button
            type="button"
            class="hextech-btn secondary saved-kit-save"
            :class="{ open: naming }"
            title="Lưu bộ chiêu này để dùng lại ở trận khác"
            aria-label="Lưu bộ"
            @click="toggleSave"
          >
            <i class="fas fa-floppy-disk" aria-hidden="true"></i>
            <!-- <span class="kit-bar-label">Lưu bộ</span> -->
          </button>
          <!-- <button type="button" class="hextech-btn secondary kit-bar-btn" title="Huỷ, không đổi gì" aria-label="Huỷ"
            @click="cancel">
            <i class="fas fa-rotate-left" aria-hidden="true"></i>
            <span class="kit-bar-label">Huỷ</span>
          </button> -->
          <button
            type="button"
            class="hextech-btn kit-bar-btn"
            title="Xác nhận bộ chiêu này"
            aria-label="Xác nhận"
            @click="confirm"
          >
            <i class="fas fa-check" aria-hidden="true"></i>
            <span class="kit-bar-label">Xác nhận</span>
          </button>
        </div>
      </div>

      <div v-if="naming" class="saved-kit-form">
        <input
          ref="nameInput"
          v-model="kitName"
          type="text"
          class="saved-kit-input"
          :maxlength="SAVED_KIT_NAME_MAX"
          placeholder="Tên bộ chiêu"
          aria-label="Tên bộ chiêu"
          @keydown.stop="onNameKey"
          @keyup.stop
          @keypress.stop
          @click="focusName"
        />
        <button
          type="button"
          class="hextech-btn saved-kit-confirm"
          :disabled="!kitName.trim()"
          @click="commitSave"
        >
          Lưu
        </button>
        <button
          type="button"
          class="pregame-icon-btn saved-kit-close"
          title="Thôi"
          @click="cancelSave"
        >
          <i class="fas fa-times"></i>
        </button>
        <span v-if="saveError" class="saved-kit-error">{{ saveError }}</span>
      </div>

      <p class="kit-hint">{{ hint }}</p>

      <div ref="rosterBody" class="pregame-modal-body">
        <KitRoster
          :shelves="kitShelves"
          :active-entry-id="activeEntryId"
          :selected-champion="selectedChampion"
          :match-rules="matchRules"
          :is-touch-ui="isTouchUi"
          :compact="compact"
          :saved-kits="savedKits"
          :peek="peek"
          @pick="pickSpell"
          @apply-kit="applyKit"
          @pick-random="pickRandom"
          @apply-saved-kit="applySavedKit"
          @delete-saved-kit="removeSavedKit"
        />
      </div>

      <div
        v-if="peekHeldOpen"
        class="spell-peek-scrim"
        aria-hidden="true"
        @touchstart.prevent="closePeek()"
      ></div>

      <div v-if="peekDisplay" class="spell-peek" :style="peekStyle">
        <SpellDetailPane :display="peekDisplay" placeholder="" />
      </div>
    </div>
  </div>
</template>
