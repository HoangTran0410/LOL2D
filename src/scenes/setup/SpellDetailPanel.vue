<script setup lang="ts">
/**
 * The shared spell-description overlay — tap any spell icon anywhere on the
 * pregame screen to open it (see `usePregameOverlays`). Recomputes from
 * `matchRules` automatically: `display` is a `computed`, so when the CDR/URF
 * sliders change the panel updates live while it's open, the same behaviour
 * `SetupScene.ts` used to get from calling `refreshSpellDetailIfOpen()` by
 * hand after every `persist()`.
 */
import { computed } from 'vue';
import AssetManager from '../../managers/AssetManager';
import { getSpellDisplay } from '../../game/preset';
import type { MatchRules } from '../../game/config/PregameConfig';
import type { SpellClass } from './types';

const props = defineProps<{ spellClass: SpellClass | null; matchRules: MatchRules }>();
const emit = defineEmits<{ close: [] }>();

const display = computed(() => (props.spellClass ? getSpellDisplay(props.spellClass, props.matchRules) : null));

const onOverlayClick = (event: MouseEvent): void => {
  if (event.target === event.currentTarget) emit('close');
};
</script>

<template>
  <div
    id="pregame-spell-detail"
    class="pregame-overlay pregame-overlay-bottom"
    :hidden="!display"
    @click="onOverlayClick"
  >
    <div v-if="display" class="pregame-overlay-panel spell-detail-panel">
      <button
        type="button"
        id="pregame-detail-close"
        class="pregame-icon-btn spell-detail-close"
        title="Đóng"
        @click="emit('close')"
      >
        <i class="fas fa-times"></i>
      </button>
      <div class="spell-detail-header">
        <img
          id="pregame-detail-icon"
          :src="display.iconUrl ?? AssetManager.placeholder(display.name).url"
          :alt="display.name"
        />
        <div>
          <h3 id="pregame-detail-name">{{ display.name }}</h3>
          <div class="spell-detail-costs">
            <span class="spell-detail-cooldown">
              <i class="fas fa-clock"></i>
              <span id="pregame-detail-cooldown">{{ (display.effectiveCoolDownMs / 1000).toFixed(1) }}s</span>
            </span>
            <span class="spell-detail-mana">
              <i class="fas fa-tint"></i>
              <span id="pregame-detail-mana">{{ Math.round(display.effectiveManaCost) }}</span>
            </span>
          </div>
        </div>
      </div>
      <div
        class="spell-detail-body"
        id="pregame-detail-description"
        v-html="display.description || '<em>Không có mô tả.</em>'"
      ></div>
    </div>
  </div>
</template>
