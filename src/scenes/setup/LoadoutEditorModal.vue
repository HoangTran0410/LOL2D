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
 * already had (`src/game/hud/SpellPickerModal.vue`): the slot row pinned at
 * the top, the whole roster scrolling underneath it, and picks batched behind
 * Huỷ / Xác nhận so a player can keep changing their mind. Same roster, same
 * order, same two gestures — see `KitRoster.vue`.
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
 * on "Xác nhận" reaches `usePregameConfig`. "Huỷ", the X and the backdrop all
 * discard it. That is the in-game picker's contract, and it is what makes
 * "take Ahri's kit, then swap her R" a thing you can back out of.
 */
import { ref, computed } from 'vue';
import type { ChampionLoadout, MatchRules, SlotChoice } from '../../game/config/PregameConfig';
import { SLOT_COUNT } from '../../game/config/PregameConfig';
import { SpellHotKeys } from '../../game/constants';
import { BASIC_ATTACK_ID, type SpellCatalogEntry } from '../../game/preset';
import { getPregameCatalog, type KitShelf } from './pregameCatalog';
import KitRoster from './KitRoster.vue';
import SpellIcon from './SpellIcon.vue';

const props = defineProps<{
  title: string;
  loadout: ChampionLoadout;
  matchRules: MatchRules;
  isTouchUi: boolean;
}>();
const emit = defineEmits<{ change: [ChampionLoadout]; close: [] }>();

const { champions, summoners, catalogById, catalogByClass, kitShelves } = getPregameCatalog();

/** A, Q, W, E, R, D, F — same order and source as the real in-game hotkeys. */
const SLOT_LABELS = SpellHotKeys.map(code => String.fromCharCode(code));
/** The two summoner slots, by index into a `customSlots` array. */
const SLOT_D = SLOT_COUNT - 2;
const SLOT_F = SLOT_COUNT - 1;

const draft = ref<ChampionLoadout>({ ...props.loadout, customSlots: props.loadout.customSlots.slice() });
/** Which slot the next roster tap fills. Q, like the in-game picker's default — the first slot anyone changes. */
const activeSlot = ref(1);

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
    return Array.from({ length: SLOT_COUNT }, (_, i) => entryById(loadout.customSlots[i] ?? 'random'));
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
  if (loadout.mode === 'champion' && (index === SLOT_D || index === SLOT_F) && isSummonerId(entry.id)) {
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

const confirm = (): void => {
  emit('change', draft.value);
  emit('close');
};
const cancel = (): void => emit('close');

const hint = computed(() => {
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

      <!-- Pinned above the roster, never scrolls: it is both where you choose
           which slot the next tap fills and where you commit or back out. The
           two actions share the row rather than taking a footer of their own,
           the way the in-game picker's do — on a landscape phone that row is
           most of the chrome the modal can afford. -->
      <div class="kit-slot-bar">
        <button
          v-for="slot in slots"
          :key="slot.index"
          type="button"
          class="kit-slot-pill"
          :class="{ active: activeSlot === slot.index, changed: slot.changed }"
          :title="slot.title"
          @click="activeSlot = slot.index"
        >
          <SpellIcon :display="slot.entry ? slot.entry.display : null" />
          <span class="kit-slot-pill-key">{{ slot.label }}</span>
        </button>

        <!-- The eighth control in the slot group, and it belongs there: it
             acts on the selected slot, not on a spell. -->
        <button
          type="button"
          class="kit-slot-pill kit-slot-random"
          :disabled="activeSlotIsRandom"
          :title="`Bốc thăm ô ${SLOT_LABELS[activeSlot]} khi vào trận`"
          @click="randomizeSlot"
        >
          <i class="fas fa-random"></i>
        </button>

        <button type="button" class="hextech-btn secondary kit-bar-btn" @click="cancel">Huỷ</button>
        <button type="button" class="hextech-btn kit-bar-btn" @click="confirm">Xác nhận</button>
      </div>

      <p class="kit-hint">{{ hint }}</p>

      <div class="pregame-modal-body">
        <KitRoster
          :shelves="kitShelves"
          :active-entry-id="activeEntryId"
          :selected-champion="selectedChampion"
          :match-rules="matchRules"
          :is-touch-ui="isTouchUi"
          @pick="pickSpell"
          @apply-kit="applyKit"
          @pick-random="pickRandom"
        />
      </div>
    </div>
  </div>
</template>
