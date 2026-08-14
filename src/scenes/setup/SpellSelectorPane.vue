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
 * a pointer, a full-height catalogue with the detail pane (and the commit
 * button inside it) pinned below for a thumb. Same reasoning
 * `SpellPickerModal.vue`'s file comment gives for the in-game HUD picker:
 * forking this into two components would just be two places to keep the
 * catalogue markup in sync.
 */
import { ref, computed } from 'vue';
import { getSpellDisplay } from '../../game/preset';
import type { MatchRules } from '../../game/config/PregameConfig';
import type { SelectorEntry, SelectorGroup } from './types';
import SpellIcon from './SpellIcon.vue';

const props = defineProps<{
  title: string;
  groups: SelectorGroup[];
  /** Custom kit slots can be left to chance; summoner slots cannot (see `PregameConfig.ChampionLoadout`). */
  allowRandom: boolean;
  /** The slot's stored value: an entry id, or `'random'`. */
  currentChoice: string;
  matchRules: MatchRules;
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

    <div class="selector-body">
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
          <div v-if="group.name" class="catalog-group-heading">{{ group.name }}</div>
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
        <template v-if="detail">
          <div class="spell-detail-header">
            <SpellIcon :display="detail" />
            <div>
              <h3>{{ detail.name }}</h3>
              <div class="spell-detail-costs">
                <span class="spell-detail-cooldown">
                  <i class="fas fa-clock"></i> {{ (detail.effectiveCoolDownMs / 1000).toFixed(1) }}s
                </span>
                <span class="spell-detail-mana">
                  <i class="fas fa-tint"></i> {{ Math.round(detail.effectiveManaCost) }}
                </span>
              </div>
            </div>
          </div>
          <div class="spell-detail-body" v-html="detail.description || '<em>Không có mô tả.</em>'"></div>
        </template>
        <p v-else-if="highlighted === 'random'" class="selector-detail-placeholder">
          Chiêu sẽ được chọn ngẫu nhiên khi vào trận.
        </p>
        <p v-else class="selector-detail-placeholder">Chọn một chiêu để xem mô tả.</p>

        <button
          type="button"
          class="hextech-btn selector-commit"
          :disabled="highlighted === null"
          @click="commit"
        >
          Dùng chiêu này
        </button>
      </div>
    </div>
  </div>
</template>
