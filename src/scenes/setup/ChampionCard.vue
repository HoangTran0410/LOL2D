<script setup lang="ts">
/**
 * One card in the champion grid — a real champion's portrait, name and Q/W/E/R
 * icons, or (when `champion` is null) the "Ngẫu Nhiên" random card that always
 * leads the grid.
 *
 * The whole card is one target with one destination: tapping it (anywhere)
 * picks the champion. The Q/W/E/R row used to be independently clickable —
 * tap an icon and it opened a description instead of picking, `.stop`ping the
 * click so it wouldn't also pick the card underneath it — which is exactly
 * the "which pixels did I hit" ambiguity the picker's own redesign removed.
 * The icons stay as plain, non-interactive information (hover still shows a
 * name via `SpellIcon`'s `title`); there is nothing left to preview *before*
 * picking, on purpose — the kit-slot selector opened from inside the loadout
 * editor is where a description actually belongs, because that is where a
 * choice is being made.
 */
import AssetManager from '../../managers/AssetManager';
import type { SelectableChampion } from '../../game/preset';
import SpellIcon from './SpellIcon.vue';

defineProps<{
  champion: SelectableChampion | null;
  selected: boolean;
}>();
const emit = defineEmits<{ pick: [] }>();
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
      <SpellIcon v-for="(spell, idx) in champion.spells" :key="idx" :display="spell.display" />
    </div>
  </button>
</template>
