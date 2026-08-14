<script setup lang="ts">
/**
 * One card in the champion grid — a real champion's portrait, name and Q/W/E/R
 * icons, or (when `champion` is null) the "Ngẫu Nhiên" random card that always
 * leads the grid. Tapping the card picks it; tapping a spell icon previews
 * that spell in the shared detail panel without picking anything (`.stop` so
 * the click doesn't also bubble up into the card's own pick handler).
 */
import AssetManager from '../../managers/AssetManager';
import type { SelectableChampion } from '../../game/preset';
import { usePregameOverlays } from './pregameOverlays';

defineProps<{
  champion: SelectableChampion | null;
  selected: boolean;
}>();
const emit = defineEmits<{ pick: [] }>();

const { openSpellDetail } = usePregameOverlays();
</script>

<template>
  <button
    type="button"
    class="champion-card"
    :class="{ selected }"
    :data-champion="champion ? champion.name : 'random'"
    @click="emit('pick')"
  >
    <div class="champion-portrait" :class="{ 'champion-portrait-random': !champion }">
      <img v-if="champion" :src="AssetManager.get(champion.avatar).url" :alt="champion.name" />
      <i v-else class="fas fa-random"></i>
    </div>
    <div class="champion-name">{{ champion ? champion.name : 'Ngẫu Nhiên' }}</div>
    <div v-if="champion" class="champion-spells">
      <img
        v-for="(spell, idx) in champion.spells"
        :key="idx"
        :src="spell.display.iconUrl ?? AssetManager.placeholder(spell.display.name).url"
        :alt="spell.display.name"
        :title="spell.display.name"
        @click.stop="openSpellDetail(spell.spellClass)"
      />
    </div>
  </button>
</template>
