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
import { getSpellDisplay, type SpellCatalogEntry } from '../../game/preset';
import type { MatchRules } from '../../game/config/PregameConfig';
import type { SavedKit } from '../../game/config/savedKits';
import AssetManager from '../../managers/AssetManager';
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
   * Champion tiles only: the ability rows and the two shelves that are not a
   * champion are hidden, leaving the whole-kit action as the only gesture.
   *
   * Hidden in CSS rather than dropped with `v-if`, which is the whole reason
   * this is one boolean and not a second render path. The roster is ~50
   * shelves and ~200 icons; keeping them mounted makes the toggle instant
   * instead of a rebuild, and `loading="lazy"` already means an icon nobody
   * has scrolled to never fetched. Nothing about the DOM changes — see
   * `.kit-roster.compact` in pregame-scene.css.
   */
  compact: boolean;
  /**
   * The one shelf compact lets through anyway, or `null`.
   *
   * Compared by identity, not by name: `getPregameCatalog()` builds once and
   * caches, so the parent hands back one of the very objects in `shelves`.
   * The parent decides which — it is the one that knows what the selected slot
   * means. See `LoadoutEditorModal.revealShelf`.
   */
  revealShelf: KitShelf | null;
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
const detailOf = (entry: SpellCatalogEntry) => getSpellDisplay(entry.spellClass, props.matchRules);

const isSelectedShelf = (shelf: KitShelf): boolean =>
  props.selectedChampion !== null && props.selectedChampion === shelf.championName;
</script>

<template>
  <div class="kit-roster" :class="{ compact }">
    <!-- Deliberately its own class prefix rather than `.kit-shelf`: a
         champion's shelf is a fixed part of the catalogue and a saved kit is
         a row the player can delete, they carry different actions, and the
         e2e drives (`drive-kit-builder.mjs`) count `.kit-shelf` expecting
         exactly the catalogue. -->
    <section v-if="savedKits.length" class="saved-kit-shelf">
      <h4 class="saved-kit-heading">Bộ đã lưu</h4>
      <div class="saved-kit-list">
        <div v-for="kit in savedKits" :key="kit.id" class="saved-kit" :data-kit="kit.name">
          <button
            type="button"
            class="saved-kit-apply"
            :title="`Dùng bộ ${kit.name}`"
            @click="emit('applySavedKit', kit)"
          >
            <span class="saved-kit-name">{{ kit.name }}</span>
            <span class="kit-apply-chip">Dùng</span>
          </button>
          <!-- No confirm step, like `.participant-remove` and
               `.practice-remove-bot`: a saved kit is a shortcut, not the
               loadout itself, and re-saving one is the same two taps that
               made it. -->
          <button
            type="button"
            class="saved-kit-delete"
            :title="`Xoá bộ ${kit.name}`"
            :aria-label="`Xoá bộ ${kit.name}`"
            @click="emit('deleteSavedKit', kit)"
          >
            <i class="fas fa-times"></i>
          </button>
        </div>
      </div>
    </section>

    <button
      type="button"
      class="catalog-random-card"
      :class="{ selected: selectedChampion === 'random' }"
      @click="emit('pickRandom')"
    >
      <i class="fas fa-random"></i> Ngẫu Nhiên — tướng và bộ chiêu bốc thăm khi vào trận
    </button>

    <section
      v-for="shelf in shelves"
      :key="shelf.name"
      class="kit-shelf"
      :class="{
        selected: isSelectedShelf(shelf),
        'has-kit': shelf.kit.length > 0,
        revealed: shelf === revealShelf,
      }"
      :data-champion="shelf.name"
    >
      <!-- `has-kit` is the same predicate that decides whether the header is a
           button at all (`v-if="shelf.kit.length"` below), reused rather than
           restated: compact mode shows exactly the shelves that have a whole
           kit to apply, so Đánh Thường and Phép Bổ Trợ drop out of the grid on
           their own and no second rule can drift away from the first. -->
      <!-- The shelf header doubles as the whole-kit button wherever there is
           a kit to apply; the basic-attack and summoner shelves render the
           same row as an inert heading. -->
      <button
        v-if="shelf.kit.length"
        type="button"
        class="kit-shelf-heading kit-shelf-apply"
        :title="`Dùng cả bộ chiêu ${shelf.name}`"
        @click="emit('applyKit', shelf)"
      >
        <img
          v-if="shelf.avatar"
          class="catalog-group-avatar"
          :src="AssetManager.get(shelf.avatar).url"
          :alt="shelf.name"
          loading="lazy"
          decoding="async"
        />
        <span class="kit-shelf-name">{{ shelf.name }}</span>
        <span class="kit-apply-chip">Chọn</span>
      </button>
      <div v-else class="kit-shelf-heading">
        <img
          v-if="shelf.avatar"
          class="catalog-group-avatar"
          :src="AssetManager.get(shelf.avatar).url"
          :alt="shelf.name"
          loading="lazy"
          decoding="async"
        />
        <span class="kit-shelf-name">{{ shelf.name }}</span>
      </div>

      <div class="catalog-group-row">
        <!-- `@contextmenu.prevent`: a card is an icon inside a button, and a
             long press on one is Chrome's own "open image / download image"
             menu unless something says otherwise. That menu both hides the
             description the hold just opened and cancels the touch that would
             have finished the gesture. The hold belongs to the app. -->
        <button
          v-for="item in shelf.entries"
          :key="item.entry.id"
          type="button"
          class="catalog-spell-card"
          :class="{ selected: activeEntryId === item.entry.id }"
          :data-spell="item.entry.id"
          @click="pick(item.entry)"
          @mouseenter="!isTouchUi && hoverStart(detailOf(item.entry), $event)"
          @mouseleave="!isTouchUi && hoverEnd()"
          @touchstart="touchStart(detailOf(item.entry), $event)"
          @touchmove="touchMove($event)"
          @touchend="touchEnd()"
          @touchcancel="closePeek()"
          @contextmenu.prevent
        >
          <!-- The icon is the whole card. No name under it: at four abilities
               to a shelf the champion's name above them already says what
               they are, and the spell's own name is a hover or a hold away
               (`useSpellPeek`) — spelling all of them out is what made this
               roster twice as tall as the in-game one. -->
          <SpellIcon :display="item.entry.display" lazy />
        </button>
      </div>
    </section>
  </div>
</template>
