<script setup lang="ts">
/**
 * The loadout picker's roster: one scrolling list of every spell in the game,
 * shelved by champion, with a "Ngẫu Nhiên" card leading it.
 *
 * This is the whole of what used to be three screens — the champion grid, the
 * mode toggle that hid it behind "Tự Ghép Chiêu", and the per-slot catalogue
 * you drilled into and committed out of. It is modelled on the in-game HUD
 * picker (`src/game/hud/SpellPickerModal.vue`), which browses the same
 * `SpellGroups` roster in the same order, because that one is fast in exactly
 * the way this screen was not: no drill-down, no dialog on a dialog, and the
 * slot you are filling stays pinned above the list the whole time (the parent
 * owns that row — see `LoadoutEditorModal.vue`).
 *
 * Two gestures, one target:
 *
 *   - tapping a champion's *header* takes that champion's whole kit, which is
 *     the four taps and four slot changes it used to cost. Only shelves that
 *     are a champion offer it — `KitShelf.kit` is empty for the basic attack
 *     and the summoner spells, and five summoner spells have no four slots to
 *     land in.
 *   - tapping an *ability* puts that one spell in whichever slot is selected
 *     above.
 *
 * Reading a description is a hover or a hold on the same icon, not a second
 * click target beside it — see `useSpellPeek.ts` for that contract and for
 * why `pick` has to ignore the click that follows a hold.
 */
import { getSpellDisplay, type SpellCatalogEntry } from '../../game/preset';
import type { MatchRules } from '../../game/config/PregameConfig';
import AssetManager from '../../managers/AssetManager';
import type { KitShelf } from './pregameCatalog';
import SpellIcon from './SpellIcon.vue';
import SpellDetailPane from './SpellDetailPane.vue';
import { useSpellPeek } from './useSpellPeek';

const props = defineProps<{
  shelves: KitShelf[];
  /** Highlights the entry currently sitting in the selected slot. */
  activeEntryId: string | null;
  /** Highlights the shelf the loadout is currently a whole-champion pick of, or `'random'`. */
  selectedChampion: string | null;
  /**
   * The cached `SpellCatalogEntry.display` on each card carries a spell's own
   * tuning numbers; the description panel has to show the *effective* ones,
   * so it rebuilds the display under this match's CDR/URF rather than reusing
   * the card's. See `getSpellDisplay` in preset.ts.
   */
  matchRules: MatchRules;
  isTouchUi: boolean;
}>();
const emit = defineEmits<{
  pick: [entry: SpellCatalogEntry];
  applyKit: [shelf: KitShelf];
  pickRandom: [];
}>();

// Destructured so `peekDisplay`/`peekStyle` are top-level refs the template
// unwraps on its own — reached through the object they'd each need `.value`.
const {
  display: peekDisplay,
  style: peekStyle,
  hoverStart,
  hoverEnd,
  touchStart,
  touchMove,
  touchEnd,
  close: closePeek,
} = useSpellPeek();

/**
 * A hold has already answered "what is this"; the click the browser sends
 * afterwards would also answer "equip this", which is not what a player who
 * held still for 400ms asked for.
 */
const pick = (entry: SpellCatalogEntry): void => {
  if (touchEnd()) return;
  emit('pick', entry);
};

/** The description panel's copy of a spell, with this match's cooldown/mana applied. */
const detailOf = (entry: SpellCatalogEntry) => getSpellDisplay(entry.spellClass, props.matchRules);

const isSelectedShelf = (shelf: KitShelf): boolean =>
  props.selectedChampion !== null && props.selectedChampion === shelf.championName;
</script>

<template>
  <div class="kit-roster">
    <button type="button" class="catalog-random-card" :class="{ selected: selectedChampion === 'random' }"
      @click="emit('pickRandom')">
      <i class="fas fa-random"></i> Ngẫu Nhiên — tướng và bộ chiêu bốc thăm khi vào trận
    </button>

    <section v-for="shelf in shelves" :key="shelf.name" class="kit-shelf" :class="{ selected: isSelectedShelf(shelf) }"
      :data-champion="shelf.name">
      <!-- The shelf header doubles as the whole-kit button wherever there is
           a kit to apply; the basic-attack and summoner shelves render the
           same row as an inert heading. -->
      <button v-if="shelf.kit.length" type="button" class="kit-shelf-heading kit-shelf-apply"
        :title="`Dùng cả bộ chiêu ${shelf.name}`" @click="emit('applyKit', shelf)">
        <img v-if="shelf.avatar" class="catalog-group-avatar" :src="AssetManager.get(shelf.avatar).url"
          :alt="shelf.name" />
        <span class="kit-shelf-name">{{ shelf.name }}</span>
        <span class="kit-apply-chip">Dùng bộ</span>
      </button>
      <div v-else class="kit-shelf-heading">
        <img v-if="shelf.avatar" class="catalog-group-avatar" :src="AssetManager.get(shelf.avatar).url"
          :alt="shelf.name" />
        <span class="kit-shelf-name">{{ shelf.name }}</span>
      </div>

      <div class="catalog-group-row">
        <button v-for="item in shelf.entries" :key="item.entry.id" type="button" class="catalog-spell-card"
          :class="{ selected: activeEntryId === item.entry.id }" :data-spell="item.entry.id" @click="pick(item.entry)"
          @mouseenter="!isTouchUi && hoverStart(detailOf(item.entry), $event)" @mouseleave="!isTouchUi && hoverEnd()"
          @touchstart="touchStart(detailOf(item.entry), $event)" @touchmove="touchMove($event)"
          @touchcancel="closePeek()">
          <!-- The icon is the whole card. No name under it: at four abilities
               to a shelf the champion's name above them already says what
               they are, and the spell's own name is a hover or a hold away
               (`useSpellPeek`) — spelling all of them out is what made this
               roster twice as tall as the in-game one. -->
          <SpellIcon :display="item.entry.display" />
        </button>
      </div>
    </section>
  </div>

  <!-- `position: fixed`, above the modal it floats over (see
       `.spell-peek` in pregame-scene.css). -->
  <div v-if="peekDisplay" class="spell-peek" :style="peekStyle">
    <SpellDetailPane :display="peekDisplay" placeholder="" />
  </div>
</template>
