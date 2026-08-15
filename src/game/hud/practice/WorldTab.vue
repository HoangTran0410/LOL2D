<script setup lang="ts">
/**
 * What exists in the world besides the champions: the jungle camps and the
 * lane minions.
 *
 * Both switches take effect on the first unpaused tick, not while you are
 * looking at them — the panel opens paused and `ObjectManager.update()` is
 * what sweeps removed units out and flushes new ones in (see `MatchDirector`'s
 * file comment). Hence the note in the template: without it the panel looks
 * broken, because the honest answer to "I turned the jungle off and nothing
 * happened" is "the match is not running". Turning the jungle back on re-runs
 * `Game.spawnJungle()`, so the camps return at their `MonsterPreset` positions
 * rather than wherever they had wandered.
 *
 * The director is the single source of truth for both, not this component:
 * `minionsEnabled` is a view of `MinionSpawner.enabled` and `jungleEnabled` is
 * the director's own flag (an empty jungle is also what a cleared map looks
 * like, which must not read as "switched off"). The refs below are only what
 * the checkboxes render; every write goes through the director and the ref is
 * refreshed from it, so a rejected or no-op write cannot leave the tick box
 * disagreeing with the match.
 *
 * ## Why a `touchend` handler as well as `change`
 *
 * A checkbox's `change` fires from the click the browser synthesises after a
 * tap — and there is no such click here. `GameScene`'s p5 touch handlers
 * `preventDefault()` every touch on the *page* (see `hudInteractions.ts`'s
 * file comment), which suppresses the synthetic click everywhere, not just on
 * the canvas. Wired to `change` alone these two toggles were verifiably inert
 * under a real thumb while working perfectly under a mouse — the same bug
 * class the picker's own checkboxes already work around. The handler sits on
 * the `<label>`, not the `<input>`, so tapping the word also counts; on a
 * mouse the label's click reaches the input and `change` does the work, and
 * the two paths cannot both fire for one gesture.
 */
import { inject, ref } from 'vue';
import type { HudInteractions } from '../hudInteractions';

const hud = inject<HudInteractions>('hud')!;

const jungle = ref(hud.director.jungleEnabled);
const minions = ref(hud.director.minionsEnabled);

const setJungle = (on: boolean): void => {
  hud.director.jungleEnabled = on;
  jungle.value = hud.director.jungleEnabled;
};

const setMinions = (on: boolean): void => {
  hud.director.minionsEnabled = on;
  minions.value = hud.director.minionsEnabled;
};

const onJungleChange = (event: Event): void =>
  setJungle((event.target as HTMLInputElement).checked);

const onMinionsChange = (event: Event): void =>
  setMinions((event.target as HTMLInputElement).checked);
</script>

<template>
  <div class="practice-tab-body">
    <label class="pregame-toggle" @touchend.prevent="setJungle(!jungle)">
      <input type="checkbox" id="practice-jungle" :checked="jungle" @change="onJungleChange" />
      <span>Quái rừng</span>
    </label>

    <label class="pregame-toggle" @touchend.prevent="setMinions(!minions)">
      <input type="checkbox" id="practice-minions" :checked="minions" @change="onMinionsChange" />
      <span>Lính</span>
    </label>

    <p class="practice-note">Thay đổi có hiệu lực khi bạn đóng bảng và trận chạy tiếp.</p>
  </div>
</template>
