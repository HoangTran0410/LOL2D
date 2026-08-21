<script setup lang="ts">
/**
 * The loadout picker's roster: one scrolling list of every spell in the game,
 * shelved by champion, with a "Ngẫu Nhiên" card leading it.
 *
 * This is the whole of what used to be three screens — the champion grid, the
 * mode toggle that hid it behind "Tự Ghép Chiêu", and the per-slot catalogue
 * you drilled into and committed out of. It is modelled on the in-game HUD
 * picker that used to browse the same `SpellGroups` roster in the same order
 * (deleted with the practice panel's Chiêu thức tab, which this component now
 * serves in both places), because that one was fast in exactly the way this
 * screen was not: no drill-down, no dialog on a dialog, and the
 * slot you are filling stays pinned above the list the whole time (the parent
 * owns that row — see `LoadoutEditorModal.vue`).
 *
 * ## One champion open at a time
 *
 * The roster is always champion tiles — a portrait over a name, ~50 of them —
 * and tapping one **opens** it in place rather than doing anything to the
 * loadout. The opened shelf spans the grid and shows the two things a player
 * could have meant by that tap:
 *
 *   - **Dùng cả bộ** takes the whole kit, which is the four taps and four slot
 *     changes it used to cost. Only shelves that are a champion offer it —
 *     `KitShelf.kit` is empty for the basic attack and the summoner spells, and
 *     five summoner spells have no four slots to land in.
 *   - tapping one of its *abilities* puts that spell in whichever slot is
 *     selected in the bar above.
 *
 * This replaced a global compact/expanded toggle over the same roster, which
 * made the player choose between the two halves of that up front: compact
 * showed the tiles and could not fill a single slot at all, expanded showed all
 * ~200 ability icons at once and was too dense to find a champion in. Neither
 * mode was the common case, and the toggle was a setting to get wrong before
 * reaching the screen you wanted. Opening one shelf is both answers, in the
 * place the question was asked, and it is why there is no second modal here.
 *
 * The two shelves that are not a champion stay out of the tile grid and open
 * only when the slot they serve is selected — see
 * `LoadoutEditorModal.shelfForSlot`.
 *
 * Reading a description is a hover or a hold on the same icon, not a second
 * click target beside it — see `useSpellPeek.ts` for that contract and for
 * why `pick` has to ignore the click that follows a hold. The panel itself is
 * the parent's (`peek`), because the slot bar above this roster opens the same
 * one for the spells already in the kit.
 *
 * ## The saved-kit shelf leads the list
 *
 * Above both of those sits whatever the player has saved before
 * (`src/game/config/savedKits.ts`): the shortest path of all to a whole
 * loadout, and the only one in here they built themselves. It is a prop, not
 * a `loadSavedKits()` call of its own — the parent is the thing that *writes*
 * the library, so it is also the thing that knows when the list changed, and
 * this component stays what it already was: a view of what it is handed.
 */
import { watch, nextTick } from 'vue';
import { packAsset, spellDisplayOf, type SpellCatalogEntry } from '@/game/config/spellCatalog';
import type { MatchRules } from '@/game/config/PregameConfig';
import type { SavedKit } from '@/game/config/savedKits';
import type { KitShelf } from './pregameCatalog';
import SpellIcon from './SpellIcon.vue';
import type { SpellPeek } from './useSpellPeek';

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
  /**
   * The one shelf expanded in place, or `null` for a grid of closed tiles.
   *
   * Compared by identity, not by name: `getPregameCatalog()` builds once and
   * caches, so the parent hands back one of the very objects in `shelves`. The
   * parent owns which one, because opening is also driven by the slot bar it
   * owns — see `LoadoutEditorModal.openShelf`.
   *
   * Everything an unopened shelf would have shown is hidden in CSS rather than
   * dropped with `v-if`. The roster is ~50 shelves and ~200 icons; keeping them
   * mounted makes opening one instant instead of a rebuild, and
   * `loading="lazy"` already means an icon nobody has scrolled to never
   * fetched. The e2e drives count `.kit-shelf` and `.catalog-spell-card`
   * expecting the whole catalogue in the DOM, and check visibility separately.
   * See `.kit-shelf.open` in pregame-scene.css.
   */
  openShelf: KitShelf | null;
  /**
   * The hotkey letter of the slot a tapped ability would fill, for the opened
   * shelf's note. The parent owns the selection, so it owns the label too —
   * spelling it out is what keeps "tap an ability" from being a guess about
   * where the spell lands.
   */
  activeSlotLabel: string;
  /** The library, newest first — see `loadSavedKits`. Empty renders no shelf at all. */
  savedKits: readonly SavedKit[];
  /**
   * The editor's one description panel, owned by the parent because the slot
   * bar above this roster shows the same panel for the same spells — two
   * instances would be two panels, and on touch the second would open behind
   * the first one's dismiss layer. The parent renders it; this component only
   * drives it. See `useSpellPeek.ts`.
   */
  peek: SpellPeek;
}>();
const emit = defineEmits<{
  pick: [entry: SpellCatalogEntry];
  applyKit: [shelf: KitShelf];
  /** Open this shelf, or close it if it is the open one. The parent decides. */
  toggleShelf: [shelf: KitShelf];
  pickRandom: [];
  applySavedKit: [kit: SavedKit];
  deleteSavedKit: [kit: SavedKit];
}>();

// Destructured off the prop rather than reached through it: `props.peek` is
// one stable object for the life of the editor, and the handlers read better
// bare in the template. (Nothing reactive is lost — the refs inside it are
// the reactive part, and the parent, not this component, renders them.)
const { hoverStart, hoverEnd, touchStart, touchMove, touchEnd, close: closePeek } = props.peek;

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
const detailOf = (entry: SpellCatalogEntry) => spellDisplayOf(entry.id, props.matchRules);

const isSelectedShelf = (shelf: KitShelf): boolean =>
  props.selectedChampion !== null && props.selectedChampion === shelf.championName;

const slotLetterOf = (slotIndex: number | null): string => {
  if (slotIndex === 1) return 'Q';
  if (slotIndex === 2) return 'W';
  if (slotIndex === 3) return 'E';
  if (slotIndex === 4) return 'R';
  return '';
};

/**
 * Smoothly scrolls the opened shelf into the viewport so the player never has
 * to guess where the expanded kit went or search below the fold.
 */
watch(
  () => props.openShelf,
  newShelf => {
    if (!newShelf) return;
    void nextTick(() => {
      requestAnimationFrame(() => {
        const openEl = document.querySelector<HTMLElement>('.kit-shelf.open');
        if (openEl) {
          openEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
    });
  }
);
</script>

<template>
  <div class="kit-roster">
    <!-- Deliberately its own class prefix rather than `.kit-shelf`: a
         champion's shelf is a fixed part of the catalogue and a saved kit is
         a row the player can delete, they carry different actions, and the
         e2e drives (`drive-kit-builder.mjs`) count `.kit-shelf` expecting
         exactly the catalogue. -->
    <section v-if="savedKits.length" class="saved-kit-shelf">
      <h4 class="saved-kit-heading">Bộ đã lưu</h4>
      <div class="saved-kit-list">
        <div v-for="kit in savedKits" :key="kit.id" class="saved-kit" :data-kit="kit.name">
          <button type="button" class="saved-kit-apply" :title="`Dùng bộ ${kit.name}`"
            @click="emit('applySavedKit', kit)">
            <span class="saved-kit-name">{{ kit.name }}</span>
            <span class="kit-apply-chip">Dùng</span>
          </button>
          <!-- No confirm step, like `.participant-remove` and
               `.practice-remove-bot`: a saved kit is a shortcut, not the
               loadout itself, and re-saving one is the same two taps that
               made it. -->
          <button type="button" class="saved-kit-delete" :title="`Xoá bộ ${kit.name}`"
            :aria-label="`Xoá bộ ${kit.name}`" @click="emit('deleteSavedKit', kit)">
            <i class="fas fa-times"></i>
          </button>
        </div>
      </div>
    </section>

    <button type="button" class="catalog-random-card" :class="{ selected: selectedChampion === 'random' }"
      @click="emit('pickRandom')">
      <i class="fas fa-random"></i> Ngẫu Nhiên Tất Cả
    </button>

    <section v-for="shelf in shelves" :key="shelf.name" class="kit-shelf" :class="{
      selected: isSelectedShelf(shelf),
      'has-kit': shelf.kit.length > 0,
      open: shelf === openShelf,
    }" :data-champion="shelf.name">
      <!-- `has-kit` is the same predicate that decides whether the header is a
           button at all (`v-if="shelf.kit.length"` below), reused rather than
           restated: the tile grid shows exactly the shelves that have a whole
           kit to offer, so Đánh Thường and Phép Bổ Trợ drop out of it on their
           own and no second rule can drift away from the first. -->
      <!-- The shelf header is the tile, and the tile is a disclosure: it opens
           this champion rather than committing it, because a tap on a portrait
           is ambiguous between "give me this kit" and "let me see it". Both
           answers live in the opened body below. The basic-attack and summoner
           shelves render the same row as an inert heading — they are opened by
           selecting the slot they serve, not by being tapped. -->
      <button v-if="shelf.kit.length" type="button" class="kit-shelf-heading kit-shelf-apply"
        :title="shelf === openShelf ? `Đóng ${shelf.name}` : `Xem bộ chiêu ${shelf.name}`"
        :aria-expanded="shelf === openShelf" @click="emit('toggleShelf', shelf)">
        <div class="catalog-avatar-wrap">
          <img v-if="shelf.avatar" class="catalog-group-avatar" :src="packAsset(shelf.avatar).url"
            :alt="shelf.name" loading="lazy" decoding="async" />
          <span v-if="isSelectedShelf(shelf) && shelf !== openShelf" class="kit-tile-badge" title="Đang chọn tướng này">
            <i class="fas fa-check" aria-hidden="true"></i>
          </span>
        </div>
        <span class="kit-shelf-name">{{ shelf.name }}</span>
        <div class="kit-shelf-state">
          <span v-if="isSelectedShelf(shelf) && shelf === openShelf" class="kit-selected-pill">
            <i class="fas fa-check" aria-hidden="true"></i> Đang dùng
          </span>
          <span class="kit-apply-chip">
            <i v-if="shelf === openShelf" class="fas fa-times" aria-hidden="true"></i>
            {{ shelf === openShelf ? 'Đóng' : 'Chọn' }}
          </span>
        </div>
        <!-- <i v-if="shelf !== openShelf" class="fas fa-chevron-down kit-shelf-chevron" aria-hidden="true"></i> -->
      </button>
      <div v-else class="kit-shelf-heading">
        <img v-if="shelf.avatar" class="catalog-group-avatar" :src="packAsset(shelf.avatar).url"
          :alt="shelf.name" loading="lazy" decoding="async" />
        <span class="kit-shelf-name">{{ shelf.name }}</span>
      </div>

      <!-- The whole-kit action, stated as a button instead of being what
           tapping the portrait did. It is only ever rendered for the shelf that
           is open, so the grid of ~50 closed tiles carries no buttons a stray
           tap could hit — which is the thing that made the old tile grid unable
           to do anything *but* replace the kit. -->
      <div v-if="shelf === openShelf && shelf.kit.length" class="kit-shelf-cta">
        <button type="button" class="hextech-btn kit-apply-all" :class="{ 'is-active-kit': isSelectedShelf(shelf) }"
          :title="`Dùng cả bộ chiêu ${shelf.name}`" @click="emit('applyKit', shelf)">
          <i class="fas" :class="isSelectedShelf(shelf) ? 'fa-check-double' : 'fa-bolt'" aria-hidden="true"></i>
          <span class="kit-apply-all-label">
            {{ isSelectedShelf(shelf) ? 'Đang dùng cả bộ' : 'Dùng cả bộ' }}
          </span>
          <span class="kit-keys-preview">
            <span class="kit-key-badge">Q</span>
            <span class="kit-key-badge">W</span>
            <span class="kit-key-badge">E</span>
            <span class="kit-key-badge">R</span>
          </span>
        </button>

        <div class="kit-slot-target-guide kit-cta-note">
          <span class="kit-guide-divider">HOẶC</span>
          <span class="kit-guide-action">
            Gán 1 chiêu vào ô
            <span class="kit-target-slot-badge">{{ activeSlotLabel }}</span>
            <i class="fas fa-arrow-down kit-guide-arrow" aria-hidden="true"></i>
          </span>
        </div>
      </div>

      <div class="catalog-group-row">
        <!-- `@contextmenu.prevent`: a card is an icon inside a button, and a
             long press on one is Chrome's own "open image / download image"
             menu unless something says otherwise. That menu both hides the
             description the hold just opened and cancels the touch that would
             have finished the gesture. The hold belongs to the app. -->
        <button v-for="item in shelf.entries" :key="item.entry.id" type="button" class="catalog-spell-card" :class="{
          selected: activeEntryId === item.entry.id,
          'matches-slot': slotLetterOf(item.slotIndex) === activeSlotLabel,
        }" :data-spell="item.entry.id" @click="pick(item.entry)"
          @mouseenter="!isTouchUi && hoverStart(detailOf(item.entry), $event)" @mouseleave="!isTouchUi && hoverEnd()"
          @touchstart="touchStart(detailOf(item.entry), $event)" @touchmove="touchMove($event)" @touchend="touchEnd()"
          @touchcancel="closePeek()" @contextmenu.prevent>
          <!-- The icon is the whole card. No name under it: at four abilities
               to a shelf the champion's name above them already says what
               they are, and the spell's own name is a hover or a hold away
               (`useSpellPeek`) — spelling all of them out is what made this
               roster twice as tall as the in-game one. -->
          <SpellIcon :display="item.entry.display" lazy />
          <span v-if="slotLetterOf(item.slotIndex)" class="spell-slot-tag">
            {{ slotLetterOf(item.slotIndex) }}
          </span>
        </button>
      </div>
    </section>
  </div>
</template>
