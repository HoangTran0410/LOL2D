<script setup lang="ts">
/**
 * The champion-mode grid: the random card first, then every full-kit
 * champion from `preset.ts`. `preview` just relays `ChampionCard`'s own
 * event up to `LoadoutEditorModal` (which owns `matchRules` and turns a
 * `spellClass` into a `SpellDisplay` — see its file comment) — this
 * component has no opinion about what a preview does, only that a card's
 * ability row can request one.
 */
import { getPregameCatalog } from './pregameCatalog';
import type { SpellClass } from './types';
import ChampionCard from './ChampionCard.vue';

defineProps<{ selected: string }>();
const emit = defineEmits<{ pick: [championName: string]; preview: [spellClass: SpellClass] }>();

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
      @preview="spellClass => emit('preview', spellClass)"
    />
  </div>
</template>
