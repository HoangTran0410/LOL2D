<script setup lang="ts">
/**
 * The match itself: its rules, the world it runs in, and the two ways out of it.
 *
 * Everything that is *not* about a participant and *not* about this device.
 * CDR and URF apply on the spot in a running match — `Spell.ts` reads
 * `game.matchRules` at cast time rather than capturing it at construction, so
 * moving the slider changes the cooldown of spells that already exist, on their
 * next cast. The jungle and minion switches apply on the first unpaused tick,
 * which is what the note under them is for: without it the panel looks broken,
 * because the honest answer to "I turned the jungle off and nothing happened"
 * is "the match is not running".
 *
 * Outside a match all four are plain config writes and the note hides.
 *
 * The controls deliberately do not stage behind a confirm. There is nothing to
 * stage: each is one assignment, reversible by dragging or clicking back, and a
 * rule change is not a pick a player builds up over several taps. The two that
 * *do* confirm are at the bottom, and they are the two that are not recoverable.
 */
import { computed, inject, ref } from 'vue';
import { CONFIG_PANEL } from './panelState';
import { CDR_PERCENT_MAX, CDR_PERCENT_MIN } from '@/game/config/PregameConfig';

const emit = defineEmits<{ close: [] }>();

const panel = inject(CONFIG_PANEL)!;
const source = panel.source;

const live = source.live;

/**
 * Seeded from the source, which is the match's own view of its rules — a match
 * booted from a config that set a rule seeded it at construction, so the tab
 * opens showing what is running rather than a fresh 0%.
 */
const rules = ref(source.getRules());
const world = ref(source.getWorld());

const CDR_PERCENT_STEP = 10;

/**
 * Read back after writing rather than trusting the local edit: the source
 * rounds and clamps, so the label shows the percentage the match actually got
 * and not the one the control asked for.
 */
const setCdr = (percent: number, persist: boolean): void => {
  source.setRules({ ...rules.value, cooldownReductionPercent: percent }, persist);
  rules.value = source.getRules();
};

const cdrValue = (event: Event): number => Number((event.target as HTMLInputElement).value);
const onCdrInput = (event: Event): void => setCdr(cdrValue(event), false);
const onCdrChange = (event: Event): void => setCdr(cdrValue(event), true);

const onUrfChange = (event: Event): void => {
  source.setRules(
    { ...rules.value, manaFree: (event.target as HTMLInputElement).checked },
    true
  );
  rules.value = source.getRules();
};

const setWorld = (patch: { jungle?: boolean; minions?: boolean }): void => {
  source.setWorld(patch);
  world.value = source.getWorld();
  panel.invalidate();
};

const onJungleChange = (event: Event): void =>
  setWorld({ jungle: (event.target as HTMLInputElement).checked });

const onMinionsChange = (event: Event): void =>
  setWorld({ minions: (event.target as HTMLInputElement).checked });

/**
 * The map picker (Task 10 of the content-pack extraction).
 *
 * Outside a match this is a plain setting — `setMap` writes it, `getMap()`
 * reads it straight back — so re-reading the source after every write would
 * work fine here, the same idiom `setCdr` above uses. It would not work in a
 * match: `MatchConfigSource.getMap`'s own doc comment is explicit that a
 * running match reports its own map, unmoved, no matter what is picked,
 * because nothing in this seam rebuilds a live terrain map or nav grid.
 * Re-reading `getMap()` there would make the `<select>` visibly snap back to
 * the running map the instant a different one was chosen — indistinguishable
 * from the control being broken. `selectedMapId` tracks the *pick* instead,
 * which is honest in both places: outside a match the pick and the setting
 * are the same fact, and in one, the note below says what the select cannot.
 */
const maps = source.availableMaps();
const selectedMapId = ref(source.getMap());

const onMapChange = (event: Event): void => {
  const id = (event.target as HTMLSelectElement).value;
  source.setMap(id);
  selectedMapId.value = id;
};

/** The running match's own map, by name — for the note below, in a match only. */
const liveMapName = computed(
  () => maps.find(map => map.id === source.getMap())?.name ?? source.getMap()
);

/**
 * ## The way out of the match
 *
 * Escape used to end it outright, with no confirmation and no way back. Escape
 * now opens this panel, so the exit has to live somewhere findable — and this
 * is the tab that means *this match*, which is what is being quit.
 *
 * Deliberately **not** beside the shell's close button in the tab row: two
 * adjacent controls whose outcomes differ by an entire match is exactly the
 * mis-hit being designed out.
 *
 * Two steps, and it is one of only two controls in the panel that confirm.
 * Bots, saved kits, champion swaps and every cheat are one press each, on
 * purpose, because each is cheap to redo. This one is not.
 */
const confirmingExit = ref(false);

const exitMatch = (): void => {
  if (!confirmingExit.value) {
    confirmingExit.value = true;
    return;
  }
  live?.requestExit();
};

/**
 * ## And the way back to a clean slate
 *
 * The panel persists everything it changes, which quietly took away the fresh
 * match every restart used to be: a player who spent an evening at 90% CDR with
 * nine bots and no jungle had no way back except editing `localStorage`. This is
 * that way back — it writes the defaults *and*, in a match, applies them while
 * you are looking at it.
 *
 * The second control that confirms, for both of the exit's reasons: it is not
 * recoverable, and it sits next to another irreversible control. The two arm
 * independently, so arming one and pressing the other cannot fire it.
 */
const confirmingReset = ref(false);
const resetting = ref(false);

const resetDefaults = async (): Promise<void> => {
  if (resetting.value) return;
  if (!confirmingReset.value) {
    confirmingReset.value = true;
    return;
  }
  confirmingReset.value = false;
  resetting.value = true;
  try {
    await source.resetToDefaults();
    // Every control on this tab is seeded from the source at mount, so the ones
    // this moved must be re-read instead of showing the old match.
    rules.value = source.getRules();
    world.value = source.getWorld();
    panel.invalidate();
  } finally {
    resetting.value = false;
  }
};

const resetLabel = computed(() =>
  resetting.value ? 'Đang đặt lại…' : confirmingReset.value ? 'Chắc chưa?' : 'Đặt lại mặc định'
);
</script>

<template>
  <div class="practice-tab-body">
    <label class="pregame-field">
      <span
        >Giảm hồi chiêu:
        <strong id="practice-cdr-value">{{ rules.cooldownReductionPercent }}%</strong></span
      >
      <input
        type="range"
        id="practice-cdr"
        :min="CDR_PERCENT_MIN"
        :max="CDR_PERCENT_MAX"
        :step="CDR_PERCENT_STEP"
        :value="rules.cooldownReductionPercent"
        @input="onCdrInput"
        @change="onCdrChange"
      />
    </label>

    <label class="pregame-toggle">
      <input type="checkbox" id="practice-urf" :checked="rules.manaFree" @change="onUrfChange" />
      <span>URF (không tốn mana)</span>
    </label>

    <!-- `GameScene` cancels only canvas touches (see `SettingsTab.vue`'s file
         comment), so a native `<select>` needs no touch handler of its own —
         `@change` already fires under a thumb the same way it does under a
         mouse. -->
    <label class="pregame-field">
      <span>Bản đồ</span>
      <select id="practice-map" :value="selectedMapId" @change="onMapChange">
        <option v-for="map of maps" :key="map.id" :value="map.id">{{ map.name }}</option>
      </select>
    </label>

    <!-- Only in a match, and only for the map: a live match cannot swap its
         own world out from under itself — see `MatchConfigSource.getMap`. -->
    <p v-if="live" class="practice-note">
      Bản đồ mới sẽ áp dụng cho trận tiếp theo — trận đang chạy vẫn trên
      <strong>{{ liveMapName }}</strong
      >.
    </p>

    <label class="pregame-toggle">
      <input
        type="checkbox"
        id="practice-jungle"
        :checked="world.jungle"
        @change="onJungleChange"
      />
      <span>Quái rừng</span>
    </label>

    <label class="pregame-toggle">
      <input
        type="checkbox"
        id="practice-minions"
        :checked="world.minions"
        @change="onMinionsChange"
      />
      <span>Lính</span>
    </label>

    <!-- Scoped to the two switches above it, not to the whole tab: CDR and URF
         are immediate. And only in a match — outside one there is no paused
         loop for anything to be waiting on. -->
    <p v-if="live" class="practice-note">
      Quái rừng và lính: thay đổi có hiệu lực khi bạn đóng bảng và trận chạy tiếp.
    </p>

    <!-- Last in the flow and visually apart: the irreversible controls. See the
         file comment on why each is here and why both confirm. -->
    <div class="practice-tab-actions">
      <button
        type="button"
        class="practice-reset"
        :class="{ confirming: confirmingReset }"
        :disabled="resetting"
        id="practice-reset"
        @click="resetDefaults"
      >
        <i class="fas fa-rotate-left" aria-hidden="true"></i>
        <span>{{ resetLabel }}</span>
      </button>

      <button
        v-if="live"
        type="button"
        class="practice-exit"
        :class="{ confirming: confirmingExit }"
        id="practice-exit"
        @click="exitMatch"
      >
        <i class="fas fa-sign-out-alt" aria-hidden="true"></i>
        <span>{{ confirmingExit ? 'Chắc chưa?' : 'Thoát trận' }}</span>
      </button>

      <!-- Outside a match the equivalent is simply going back to the menu; it
           discards nothing, so it does not confirm. -->
      <button v-else type="button" class="practice-exit" id="pregame-back-btn" @click="emit('close')">
        <i class="fas fa-arrow-left" aria-hidden="true"></i>
        <span>Về menu</span>
      </button>
    </div>
  </div>
</template>
