<script setup lang="ts">
/**
 * A spell's icon, name, cooldown/mana and description — the one presentation
 * every "what does this spell do" surface on the pregame screen reuses:
 * `SpellSelectorPane.vue`'s detail column (a choice being made, so it sits
 * next to a commit button its caller renders separately) and the read-only
 * ability previews opened from `ChampionCard.vue`'s Q/W/E/R row and
 * `ParticipantCard.vue`'s kit-icon row (nothing to commit — there is no
 * selector to open for a champion's bundled kit). Two modes of the same
 * component, not a second copy of this markup.
 *
 * `collapsible` is the only thing that differs between them, and it is
 * driven by the caller's `isTouchUi`, not by this component: on a pointer,
 * the description sits fully open in a side column (unchanged from before
 * this existed); on touch, where the description would otherwise eat half
 * the screen before anything is even highlighted, only the header (icon,
 * name, cooldown, mana — the facts worth comparing while still browsing) is
 * always visible, and the prose behind a `Xem mô tả` toggle. `expanded` is a
 * prop, not local state: the toggle only flips a value the parent owns, so
 * `SpellSelectorPane.vue` can react to it (single-scroller CSS depends on
 * knowing whether the sheet is open — see its own file comment for why).
 */
import type { SpellDisplay } from '../../game/preset';
import SpellIcon from './SpellIcon.vue';

withDefaults(
  defineProps<{
    display: SpellDisplay | null;
    /** Shown instead of the detail block when `display` is null (nothing highlighted yet, or a 'random' choice). */
    placeholder: string;
    collapsible?: boolean;
    /** Ignored unless `collapsible` — the description is always shown otherwise. */
    expanded?: boolean;
  }>(),
  { collapsible: false, expanded: true }
);
const emit = defineEmits<{ 'update:expanded': [boolean] }>();
</script>

<template>
  <div class="spell-detail-pane">
    <template v-if="display">
      <div class="spell-detail-header">
        <SpellIcon :display="display" />
        <div>
          <h3>{{ display.name }}</h3>
          <div class="spell-detail-costs">
            <span class="spell-detail-cooldown">
              <i class="fas fa-clock"></i> {{ (display.effectiveCoolDownMs / 1000).toFixed(1) }}s
            </span>
            <span class="spell-detail-mana">
              <i class="fas fa-tint"></i> {{ Math.round(display.effectiveManaCost) }}
            </span>
          </div>
        </div>
      </div>
      <button
        v-if="collapsible"
        type="button"
        class="spell-detail-toggle"
        :aria-expanded="expanded"
        @click="emit('update:expanded', !expanded)"
      >
        {{ expanded ? 'Thu gọn' : 'Xem mô tả' }}
        <i class="fas" :class="expanded ? 'fa-chevron-up' : 'fa-chevron-down'"></i>
      </button>
      <div
        v-if="!collapsible || expanded"
        class="spell-detail-body"
        v-html="display.description || '<em>Không có mô tả.</em>'"
      ></div>
    </template>
    <p v-else class="selector-detail-placeholder">{{ placeholder }}</p>
  </div>
</template>
