<script setup lang="ts">
/**
 * "Tướng" tab: the player first (clearly marked — `label="Bạn"` and its own
 * accent, see `.participant-card-player` in pregame-scene.css), then every
 * active bot, then the bot-count control as direct manipulation on the list
 * itself — "+ Thêm Bot" appends one, and only the *last* bot's card offers
 * removal.
 *
 * Removal is deliberately only offered on the last card, not on every one:
 * `PregameConfig.AIConfig.bots` is a fixed-length, positional array (`count`
 * just says how many of its first entries are active — see the type's own
 * doc comment), so "remove bot 2" while bot 5 stays active would have to
 * either reorder every bot after it or leave a hole, both of which would
 * silently discard configuration the player never touched. Removing the last
 * one is the only operation that has no such side effect, so it is the only
 * one offered.
 */
import { AI_COUNT_MAX } from '../../game/config/PregameConfig';
import type { PregameConfig } from '../../game/config/PregameConfig';
import ParticipantCard from './ParticipantCard.vue';

const props = defineProps<{ config: PregameConfig }>();
const emit = defineEmits<{
  openPlayer: [];
  openBot: [index: number];
  addBot: [];
  removeBot: [];
}>();
</script>

<template>
  <div class="participant-list" id="pregame-participant-list">
    <ParticipantCard label="Bạn" is-player :loadout="config.player" @open="emit('openPlayer')" />

    <ParticipantCard
      v-for="(loadout, index) in config.ai.bots.slice(0, config.ai.count)"
      :key="index"
      :label="`Bot ${index + 1}`"
      :loadout="loadout"
      :removable="index === config.ai.count - 1"
      @open="emit('openBot', index)"
      @remove="emit('removeBot')"
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
