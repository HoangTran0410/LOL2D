<script setup lang="ts">
/**
 * A spell's icon, name, cooldown/mana and description — the one presentation
 * every "what does this spell do" surface on the pregame screen reuses: the
 * hover/long-press panel over the loadout picker's roster (`KitRoster.vue`,
 * via `useSpellPeek.ts`) and the read-only preview opened from
 * `ParticipantCard.vue`'s kit-icon row (`SpellPreviewModal.vue`). One
 * component, not two copies of this markup.
 *
 * It used to carry a `collapsible`/`expanded` mode as well — the touch
 * bottom sheet the per-slot spell selector needed, so its catalogue and its
 * description would never scroll at the same time. That selector is gone
 * (see `LoadoutEditorModal.vue`) and both surfaces left are transient panels
 * that only ever show one spell, so the mode went with it.
 */
import FormatUtils from '@/utils/format.utils';
import type { SpellDisplay } from '@/game/config/spellCatalog';
import SpellIcon from './SpellIcon.vue';

defineProps<{
  display: SpellDisplay | null;
  /** Shown instead of the detail block when `display` is null. */
  placeholder: string;
}>();
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
              <i class="fas fa-clock"></i>
              {{ FormatUtils.spellSeconds(display.effectiveCoolDownMs) }}s
            </span>
            <span class="spell-detail-mana">
              <i class="fas fa-tint"></i> {{ Math.round(display.effectiveManaCost) }}
            </span>
          </div>
        </div>
      </div>
      <div
        class="spell-detail-body"
        v-html="display.description || '<em>Không có mô tả.</em>'"
      ></div>
    </template>
    <p v-else class="selector-detail-placeholder">{{ placeholder }}</p>
  </div>
</template>
