<script setup lang="ts">
/** The champion-mode grid: the random card first, then every full-kit champion from `preset.ts`. */
import { getPregameCatalog } from './pregameCatalog';
import ChampionCard from './ChampionCard.vue';

defineProps<{ selected: string }>();
const emit = defineEmits<{ pick: [championName: string] }>();

const { champions } = getPregameCatalog();
</script>

<template>
  <div class="champion-grid">
    <ChampionCard :champion="null" :selected="selected === 'random'" @pick="emit('pick', 'random')" />
    <ChampionCard
      v-for="champion in champions"
      :key="champion.name"
      :champion="champion"
      :selected="selected === champion.name"
      @pick="emit('pick', champion.name)"
    />
  </div>
</template>
