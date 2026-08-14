<script setup lang="ts">
/** One collapsible bot row: a header (label + summary + chevron) and, only while expanded, a `LoadoutEditor`. */
import type { ChampionLoadout } from '../../game/config/PregameConfig';
import LoadoutEditor from './LoadoutEditor.vue';

const props = defineProps<{ index: number; loadout: ChampionLoadout; expanded: boolean }>();
const emit = defineEmits<{ toggle: []; change: [ChampionLoadout] }>();

const summaryText = (loadout: ChampionLoadout): string => {
  if (loadout.mode === 'custom') return 'Tự Ghép Chiêu';
  if (loadout.championName === 'random') return 'Ngẫu Nhiên';
  return loadout.championName;
};
</script>

<template>
  <div class="bot-row" :class="{ expanded }">
    <button type="button" class="bot-row-header" @click="emit('toggle')">
      <span class="bot-row-label">Bot {{ index + 1 }}</span>
      <span class="bot-row-summary">{{ summaryText(loadout) }}</span>
      <i class="fas fa-chevron-down"></i>
    </button>
    <div class="bot-row-editor" :hidden="!expanded">
      <LoadoutEditor v-if="expanded" :loadout="loadout" @change="loadout => emit('change', loadout)" />
    </div>
  </div>
</template>
