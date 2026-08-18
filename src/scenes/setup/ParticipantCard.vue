<script setup lang="ts">
/**
 * One row in the Players tab's participant list — the human player or one AI
 * bot, shown identically: a portrait, a kit summary, and a chevron. Tapping
 * anywhere on the card opens `LoadoutEditorModal` bound to this participant's
 * loadout — the same editor, the same gesture, for the player and every bot;
 * only which loadout it is bound to differs (see `SetupScene.vue`).
 *
 * The kit-icon row is a second, explicit click target for a read-only
 * preview of that spell: `.participant-card-open` is an invisible full-card
 * button that opens the editor, and each kit icon is a real, visibly
 * bordered button (`.kit-icon-btn`, `position:relative` so it wins the
 * click) stacked above it. `SetupScene.vue` owns the preview surface (there
 * is no modal open yet at this point in the screen, so it gets its own small
 * one — see `SpellPreviewModal.vue`); this component only relays *which*
 * spell. Inside the editor the same question is answered differently — by
 * hovering or holding an icon whose tap already means "equip this" (see
 * `KitRoster.vue`) — because there every icon has a job, while out here the
 * only competing target is "open the editor".
 */
import { computed } from 'vue';
import AssetManager from '@/managers/AssetManager';
import type { ChampionLoadout } from '@/game/config/PregameConfig';
import type { SpellCatalogEntry } from '@/game/preset';
import { getPregameCatalog } from './pregameCatalog';
import type { SpellClass } from './types';
import SpellIcon from './SpellIcon.vue';

const props = defineProps<{
  label: string;
  loadout: ChampionLoadout;
  isPlayer?: boolean;
  /** Shows the per-card delete button — every bot has one; removing it shifts the rest up (see `PlayersTab.vue`). */
  removable?: boolean;
}>();
const emit = defineEmits<{ open: []; remove: []; previewAbility: [spellClass: SpellClass] }>();

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

/** Just the fields a kit-icon button needs — `champions[i].spells` (`SelectableChampionSpell`) and
 * `spellCatalog` (`SpellCatalogEntry`) both carry more than this, and structurally satisfy it either way. */
interface KitIcon {
  spellClass: SpellClass;
  display: SpellCatalogEntry['display'];
}

const kitIcons = computed<KitIcon[]>(() => {
  if (props.loadout.mode === 'champion') {
    return pickedChampion.value?.spells ?? [];
  }
  return props.loadout.customSlots
    .map(choice => (choice !== 'random' ? spellCatalog.find(e => e.id === choice) : undefined))
    .filter((entry): entry is SpellCatalogEntry => !!entry);
});
</script>

<template>
  <div class="participant-card" :class="{ 'participant-card-player': isPlayer }">
    <div class="participant-card-main">
      <button
        type="button"
        class="participant-card-open"
        :aria-label="`Chỉnh trang bị của ${label}`"
        @click="emit('open')"
      ></button>

      <div class="participant-portrait" :class="{ 'participant-portrait-random': !avatarKey }">
        <img v-if="avatarKey" :src="AssetManager.get(avatarKey).url" :alt="label" />
        <i v-else class="fas fa-random"></i>
      </div>
      <div class="participant-info">
        <div class="participant-name">{{ label }}</div>
        <div class="participant-summary">{{ summaryLabel }}</div>
        <div v-if="kitIcons.length" class="participant-kit-icons">
          <button
            v-for="(entry, idx) in kitIcons"
            :key="idx"
            type="button"
            class="kit-icon-btn"
            title="Xem mô tả chiêu"
            @click="emit('previewAbility', entry.spellClass)"
          >
            <SpellIcon :display="entry.display" />
          </button>
        </div>
      </div>
      <i class="fas fa-chevron-right participant-chevron"></i>
    </div>
    <button
      v-if="removable"
      type="button"
      class="participant-remove"
      title="Xoá bot này"
      @click="emit('remove')"
    >
      <i class="fas fa-times"></i>
    </button>
  </div>
</template>
