<script setup lang="ts">
/**
 * One summoner-spell slot (D or F) in champion mode: every summoner spell as
 * an option, the currently-picked one highlighted. Carries an extra
 * `summoner-slot-d`/`summoner-slot-f` class (alongside the original
 * `summoner-slot`) so a specific slot can be selected from outside — this
 * component is mounted twice per loadout editor (D and F), and an id would
 * collide the moment two editors are on screen at once (the player's plus an
 * expanded bot row), which a plain id could not do.
 */
import AssetManager from '../../managers/AssetManager';
import { getPregameCatalog } from './pregameCatalog';
import { usePregameOverlays } from './pregameOverlays';

const props = defineProps<{ slot: 'D' | 'F'; selected: string }>();
const emit = defineEmits<{ pick: [id: string] }>();

const { summoners } = getPregameCatalog();
const { openSpellDetail } = usePregameOverlays();
</script>

<template>
  <div class="summoner-slot" :class="props.slot === 'D' ? 'summoner-slot-d' : 'summoner-slot-f'">
    <span class="summoner-slot-label">{{ slot }}</span>
    <div class="summoner-options">
      <button
        v-for="summoner in summoners"
        :key="summoner.id"
        type="button"
        class="summoner-option"
        :class="{ selected: selected === summoner.id }"
        :data-summoner="summoner.id"
        @click="emit('pick', summoner.id)"
      >
        <img
          :src="summoner.display.iconUrl ?? AssetManager.placeholder(summoner.display.name).url"
          :alt="summoner.display.name"
          :title="summoner.display.name"
          @click.stop="openSpellDetail(summoner.spellClass)"
        />
      </button>
    </div>
  </div>
</template>
