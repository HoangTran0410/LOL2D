<script setup lang="ts">
/**
 * One slot, one tap, one destination: this is the whole answer to "bấm dính
 * ảnh spell thì mở mô tả, bấm ngoài ảnh thì mở spell selector, user ko hiểu"
 * (tap the icon and it describes; tap beside it and it opens a picker; no one
 * can tell which they'll get). There used to be two separate overlays — a
 * catalogue picker and a spell-detail panel — opened by two different click
 * targets on the same slot, and they could both end up open and stacked. This
 * is one pane with both halves of that always visible together, opened by a
 * slot's only click target (`SlotButton.vue`'s `@click`).
 *
 * Tapping an entry in the catalogue *highlights* it — moves the detail pane
 * to describe it — and does not touch the slot's stored value. Only "Dùng
 * chiêu này" does that, via `commit`. `cancel` (the back arrow, or the
 * backdrop) leaves the slot exactly as it was, highlight and all: nothing
 * here writes to `usePregameConfig` directly, so there is nothing to undo.
 *
 * Opens with the slot's current choice already highlighted and described —
 * "what is this" and "change it" are the same gesture, answered by the same
 * screen, which is the point.
 *
 * Layout is one template, reflowed by CSS alone on `body.touch-ui` (see
 * `.selector-body` in pregame-scene.css) — side-by-side catalogue/detail for
 * a pointer, a full-height catalogue with the detail pane pinned below for a
 * thumb. Same reasoning `SpellPickerModal.vue`'s file comment gives for the
 * in-game HUD picker: forking this into two components would just be two
 * places to keep the catalogue markup in sync.
 *
 * The commit button lives here, as a sibling *after* `.selector-body`, not
 * inside the detail pane any more — a fixed footer outside whatever region
 * scrolls, so it stays reachable in every state (collapsed or expanded
 * detail sheet, catalogue scrolled to any position) without needing its own
 * "pin to the bottom of a flex column" trick. See `SpellDetailPane.vue` for
 * why the detail block itself is a separate, reusable component.
 *
 * `isTouchUi` decides whether the detail pane is a collapsible bottom sheet
 * (touch — see `detailExpanded` below) or the always-open side column
 * (pointer, unchanged). `detailExpanded` lives here rather than inside
 * `SpellDetailPane` because the single-scroller rule needs it *here* too:
 * `.selector-body.detail-expanded` in pregame-scene.css is what freezes the
 * catalogue's own scroll while the sheet is open, so only the sheet's
 * description scrolls — never both at once. Deliberately not reset when
 * `highlighted` changes, so switching between catalogue entries never
 * re-collapses a sheet the player already opened.
 */
import { ref, computed } from 'vue';
import { getSpellDisplay } from '../../game/preset';
import type { MatchRules } from '../../game/config/PregameConfig';
import type { SelectorEntry, SelectorGroup } from './types';
import AssetManager from '../../managers/AssetManager';
import SpellIcon from './SpellIcon.vue';
import SpellDetailPane from './SpellDetailPane.vue';

const props = defineProps<{
  title: string;
  groups: SelectorGroup[];
  /** Custom kit slots can be left to chance; summoner slots cannot (see `PregameConfig.ChampionLoadout`). */
  allowRandom: boolean;
  /** The slot's stored value: an entry id, or `'random'`. */
  currentChoice: string;
  matchRules: MatchRules;
  isTouchUi: boolean;
}>();
const emit = defineEmits<{ commit: [choice: string]; cancel: [] }>();

type Highlight = SelectorEntry | 'random' | null;

const findEntry = (id: string): SelectorEntry | undefined =>
  props.groups.flatMap(group => group.entries).find(entry => entry.id === id);

// Opens with the currently-equipped choice already highlighted — the same
// gesture answers "what is this" and "change it".
const highlighted = ref<Highlight>(
  props.currentChoice === 'random' ? 'random' : (findEntry(props.currentChoice) ?? null)
);

const isHighlighted = (entry: SelectorEntry): boolean =>
  highlighted.value !== null && highlighted.value !== 'random' && highlighted.value.id === entry.id;

const detail = computed(() =>
  highlighted.value && highlighted.value !== 'random'
    ? getSpellDisplay(highlighted.value.spellClass, props.matchRules)
    : null
);

const detailPlaceholder = computed(() =>
  highlighted.value === 'random'
    ? 'Chiêu sẽ được chọn ngẫu nhiên khi vào trận.'
    : 'Chọn một chiêu để xem mô tả.'
);

/** Collapsed by default; stays open for the rest of this pane's lifetime once opened (see file comment). */
const detailExpanded = ref(false);

const commit = (): void => {
  if (highlighted.value === null) return;
  emit('commit', highlighted.value === 'random' ? 'random' : highlighted.value.id);
};
</script>

<template>
  <div class="selector-pane">
    <header class="pregame-modal-header">
      <button type="button" class="pregame-icon-btn" title="Quay lại" @click="emit('cancel')">
        <i class="fas fa-arrow-left"></i>
      </button>
      <h3>{{ title }}</h3>
    </header>

    <div class="selector-body" :class="{ 'detail-expanded': isTouchUi && detailExpanded }">
      <div class="selector-catalogue">
        <button
          v-if="allowRandom"
          type="button"
          class="catalog-random-card"
          :class="{ selected: highlighted === 'random' }"
          @click="highlighted = 'random'"
        >
          <i class="fas fa-random"></i> Ngẫu Nhiên
        </button>

        <template v-for="group in groups" :key="group.name ?? '_flat'">
          <div v-if="group.name" class="catalog-group-heading">
            <img
              v-if="group.icon"
              class="catalog-group-avatar"
              :src="AssetManager.get(group.icon).url"
              :alt="group.name"
            />
            {{ group.name }}
          </div>
          <div class="catalog-group-row">
            <button
              v-for="entry in group.entries"
              :key="entry.id"
              type="button"
              class="catalog-spell-card"
              :class="{ selected: isHighlighted(entry) }"
              @click="highlighted = entry"
            >
              <SpellIcon :display="entry.display" />
              <div class="catalog-spell-name">{{ entry.display.name }}</div>
            </button>
          </div>
        </template>
      </div>

      <div class="selector-detail">
        <SpellDetailPane
          :display="detail"
          :placeholder="detailPlaceholder"
          :collapsible="isTouchUi"
          :expanded="detailExpanded"
          @update:expanded="v => (detailExpanded = v)"
        />
      </div>
    </div>

    <button type="button" class="hextech-btn selector-commit" :disabled="highlighted === null" @click="commit">
      Dùng chiêu này
    </button>
  </div>
</template>
