<script setup lang="ts">
/**
 * The "Cấu Hình Từng Bot AI" list: at most one row expanded at a time
 * (`expandedIndex`), each row reusing the same `LoadoutEditor` the player's
 * section uses. `SetupScene.vue` remounts this component (via `:key`) on
 * "Mặc Định" so the accordion collapses along with the config reset, rather
 * than needing this local expansion state lifted up just for that one case.
 */
import { ref, watch } from 'vue';
import type { ChampionLoadout } from '../../game/config/PregameConfig';
import BotRow from './BotRow.vue';

const props = defineProps<{ bots: readonly ChampionLoadout[]; count: number }>();
const emit = defineEmits<{ change: [index: number, loadout: ChampionLoadout] }>();

const expandedIndex = ref<number | null>(null);

const toggle = (index: number): void => {
  expandedIndex.value = expandedIndex.value === index ? null : index;
};

// Rows beyond a lowered count disappear, and the accordion can't keep an
// editor open in a row that no longer exists.
watch(
  () => props.count,
  count => {
    if (expandedIndex.value !== null && expandedIndex.value >= count) expandedIndex.value = null;
  }
);
</script>

<template>
  <div class="bot-list" id="pregame-bot-list">
    <BotRow
      v-for="(loadout, index) in bots.slice(0, count)"
      :key="index"
      :index="index"
      :loadout="loadout"
      :expanded="expandedIndex === index"
      @toggle="toggle(index)"
      @change="loadout => emit('change', index, loadout)"
    />
  </div>
</template>
