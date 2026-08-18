<script setup lang="ts">
/**
 * Read-only ability preview opened from the Players tab's participant list
 * (`ParticipantCard.vue`'s kit-icon row) — there is no loadout editor open
 * at that point in the screen, so unlike `LoadoutEditorModal.vue`'s own
 * preview (which swaps its body — see that file's comment), this one is a
 * small dialog of its own. That still satisfies "one dialog at a time": the
 * participant list sits directly under `SetupScene.vue`, with nothing else
 * open when this can be reached (the loadout modal's backdrop, once open,
 * covers the whole list — see `drive-kit-builder.mjs`'s
 * `playerCardNotClickableBehindModal` check for the existing proof of that).
 *
 * Reuses `.pregame-modal-backdrop`/`.pregame-modal` for the shell (same
 * look, same single-scroller body — `.pregame-modal-body`) and
 * `SpellDetailPane.vue` for the content, same as everywhere else a spell's
 * description is shown on this screen.
 */
import type { SpellDisplay } from '@/game/config/spellCatalog';
import SpellDetailPane from './SpellDetailPane.vue';

defineProps<{ display: SpellDisplay }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <div class="pregame-modal-backdrop" @click.self="emit('close')">
    <div class="pregame-modal spell-preview-modal">
      <header class="pregame-modal-header">
        <h3>{{ display.name }}</h3>
        <button type="button" class="pregame-icon-btn" title="Đóng" @click="emit('close')">
          <i class="fas fa-times"></i>
        </button>
      </header>
      <div class="pregame-modal-body">
        <SpellDetailPane :display="display" placeholder="" />
      </div>
    </div>
  </div>
</template>
