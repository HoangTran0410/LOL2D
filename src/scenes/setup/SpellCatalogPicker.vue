<script setup lang="ts">
/**
 * The free-form kit builder's full spell-catalogue overlay: a "Ngẫu Nhiên"
 * card, then every `SpellGroups` shelf that has at least one entry in the
 * catalogue (built once — see `getPregameCatalog`). One shared instance,
 * opened by any custom slot across the player's editor or any bot's, via
 * `usePregameOverlays`.
 */
import AssetManager from '../../managers/AssetManager';
import { SpellGroups } from '../../game/preset';
import type { SpellCatalogEntry } from '../../game/preset';
import { getPregameCatalog } from './pregameCatalog';
import { usePregameOverlays } from './pregameOverlays';
import type { SpellClass } from './types';

defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; pick: [id: string] }>();

const { catalogByClass } = getPregameCatalog();
const { openSpellDetail } = usePregameOverlays();

const groups = SpellGroups.map(group => ({
  name: group.name,
  entries: (group.spells as SpellClass[])
    .map(spellClass => catalogByClass.get(spellClass))
    .filter((entry): entry is SpellCatalogEntry => !!entry),
})).filter(group => group.entries.length > 0);

const onOverlayClick = (event: MouseEvent): void => {
  if (event.target === event.currentTarget) emit('close');
};
</script>

<template>
  <div id="pregame-catalog-picker" class="pregame-overlay" :hidden="!open" @click="onOverlayClick">
    <div class="pregame-overlay-panel">
      <header class="pregame-overlay-header">
        <h3 id="pregame-catalog-title">Chọn Chiêu</h3>
        <button
          type="button"
          id="pregame-catalog-close"
          class="pregame-icon-btn"
          title="Đóng"
          @click="emit('close')"
        >
          <i class="fas fa-times"></i>
        </button>
      </header>
      <div class="pregame-catalog-content" id="pregame-catalog-content">
        <button type="button" class="catalog-random-card" @click="emit('pick', 'random')">
          <i class="fas fa-random"></i> Ngẫu Nhiên
        </button>
        <template v-for="group in groups" :key="group.name">
          <div class="catalog-group-heading">{{ group.name }}</div>
          <div class="catalog-group-row">
            <button
              v-for="entry in group.entries"
              :key="entry.id"
              type="button"
              class="catalog-spell-card"
              @click="emit('pick', entry.id)"
            >
              <img
                :src="entry.display.iconUrl ?? AssetManager.placeholder(entry.display.name).url"
                :alt="entry.display.name"
                @click.stop="openSpellDetail(entry.spellClass)"
              />
              <div class="catalog-spell-name">{{ entry.display.name }}</div>
            </button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
