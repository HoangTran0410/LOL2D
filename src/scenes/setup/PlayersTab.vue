<script setup lang="ts">
/**
 * "Tướng" tab: the player first (clearly marked — `label="Bạn"` and its own
 * accent, see `.participant-card-player` in pregame-scene.css), then every
 * active bot, then the bot-count control as direct manipulation on the list
 * itself — "+ Thêm Bot" appends one, and every bot's card offers removal.
 *
 * Removal is offered on every card, not just the last: removing "Bot 2"
 * shifts Bot 3 up into its place (see `removeBotAt` in usePregameConfig.ts).
 * The remaining bots keep their loadouts — they just move down a slot — which
 * is what a player expects when they delete a *specific* opponent from the
 * list, rather than only ever being able to lop off whichever one happens to
 * be last.
 */
import { AI_COUNT_MAX } from '../../game/config/PregameConfig';
import type { PregameConfig } from '../../game/config/PregameConfig';
import type { SpellClass } from './types';
import ParticipantCard from './ParticipantCard.vue';

const props = defineProps<{ config: PregameConfig }>();
const emit = defineEmits<{
  openPlayer: [];
  openBot: [index: number];
  addBot: [];
  removeBot: [index: number];
  previewAbility: [spellClass: SpellClass];
}>();
</script>

<template>
  <div class="participant-list" id="pregame-participant-list">
    <ParticipantCard
      label="Bạn"
      is-player
      :loadout="config.player"
      @open="emit('openPlayer')"
      @preview-ability="spellClass => emit('previewAbility', spellClass)"
    />

    <ParticipantCard
      v-for="(loadout, index) in config.ai.bots.slice(0, config.ai.count)"
      :key="index"
      :label="`Bot ${index + 1}`"
      :loadout="loadout"
      removable
      @open="emit('openBot', index)"
      @remove="emit('removeBot', index)"
      @preview-ability="spellClass => emit('previewAbility', spellClass)"
    />

    <p v-if="config.ai.count === 0" class="pregame-hint">
      Chưa có tướng địch nào — bấm "Thêm Bot" để thêm đối thủ AI.
    </p>

    <button
      v-if="config.ai.count < AI_COUNT_MAX"
      type="button"
      id="pregame-add-bot-btn"
      class="participant-add-btn"
      @click="emit('addBot')"
    >
      <i class="fas fa-plus"></i> Thêm Bot
    </button>
  </div>
</template>
