<script setup lang="ts">
/**
 * One row in the Players tab's participant list — the human player or one AI
 * bot, shown identically: a portrait, a kit summary, and a chevron. Tapping
 * anywhere on the card opens `LoadoutEditorModal` bound to this participant's
 * loadout — the same editor, the same gesture, for the player and every bot;
 * only which loadout it is bound to differs (see `SetupScene.vue`).
 */
import { computed } from 'vue';
import AssetManager from '../../managers/AssetManager';
import type { ChampionLoadout } from '../../game/config/PregameConfig';
import type { SpellDisplay } from '../../game/preset';
import { getPregameCatalog } from './pregameCatalog';
import SpellIcon from './SpellIcon.vue';

const props = defineProps<{
  label: string;
  loadout: ChampionLoadout;
  isPlayer?: boolean;
  /** Only the last bot can be removed without reordering every other bot's saved config — see `PlayersTab.vue`. */
  removable?: boolean;
}>();
const emit = defineEmits<{ open: []; remove: [] }>();

const { champions, spellCatalog } = getPregameCatalog();

const pickedChampion = computed(() =>
  props.loadout.mode === 'champion' && props.loadout.championName !== 'random'
    ? champions.find(c => c.name === props.loadout.championName)
    : undefined
);

const summaryLabel = computed(() => {
  if (props.loadout.mode === 'custom') return 'Tự Ghép Chiêu';
  if (props.loadout.championName === 'random') return 'Ngẫu Nhiên';
  return props.loadout.championName;
});

/** No stable avatar for a random champion or a custom kit — both resolve a fresh random portrait per spawn (see `preset.ts`). */
const avatarKey = computed(() => pickedChampion.value?.avatar ?? null);

const kitIcons = computed<SpellDisplay[]>(() => {
  if (props.loadout.mode === 'champion') {
    return pickedChampion.value?.spells.map(s => s.display) ?? [];
  }
  return props.loadout.customSlots
    .map(choice => (choice !== 'random' ? spellCatalog.find(e => e.id === choice)?.display : undefined))
    .filter((display): display is SpellDisplay => !!display);
});
</script>

<template>
  <div class="participant-card" :class="{ 'participant-card-player': isPlayer }">
    <button type="button" class="participant-card-main" @click="emit('open')">
      <div class="participant-portrait" :class="{ 'participant-portrait-random': !avatarKey }">
        <img v-if="avatarKey" :src="AssetManager.get(avatarKey).url" :alt="label" />
        <i v-else class="fas fa-random"></i>
      </div>
      <div class="participant-info">
        <div class="participant-name">{{ label }}</div>
        <div class="participant-summary">{{ summaryLabel }}</div>
        <div v-if="kitIcons.length" class="participant-kit-icons">
          <SpellIcon v-for="(display, idx) in kitIcons" :key="idx" :display="display" />
        </div>
      </div>
      <i class="fas fa-chevron-right participant-chevron"></i>
    </button>
    <button
      v-if="removable"
      type="button"
      class="participant-remove"
      title="Xoá bot này"
      @click="emit('remove')"
    >
      <i class="fas fa-minus"></i>
    </button>
  </div>
</template>
