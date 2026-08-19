<script setup lang="ts">
/**
 * The team tab: who is in this match, which side each is on, and every knob on
 * each of them — kit, AI behaviour, and the practice cheats.
 *
 * This is the tab the two old panels disagreed about most. The setup screen had
 * a flat participant list with no sides and one set of AI flags for every bot;
 * the practice panel had sides, per-bot flags and per-unit cheats. It is one
 * list now, and both surfaces get all of it — the config has carried
 * `ai.botTeams` and `ai.botBehaviours` since long before the setup screen ever
 * showed them.
 *
 * ## Grouped by side, and the side is editable
 *
 * Đội Xanh and Đội Đỏ, in roster order within each. Every champion — the player
 * included — carries a switch that moves it to the other side. In a match that
 * is a real reassignment rather than a label: everything that reads a side reads
 * `teamId` at query time, so the fountain a unit respawns at, ally-from-enemy
 * targeting, turret protection and the fog's ally-vision all follow the moment
 * the switch is pressed.
 *
 * ## What a row *is* differs; what a row *shows* does not
 *
 * Outside a match a row is an entry in the stored config and removing one is an
 * array splice. Inside, it is a live unit holding a quadtree slot, a path agent
 * and a spell list mid-cooldown. `MatchConfigSource` is what makes both render
 * from the same markup — and it is also where the one difference that *must*
 * survive is written down: the row's title is the champion standing on the map
 * in a match, and the **loadout** outside one. Reading a rolled champion back
 * as a setting would silently pin a bot that is meant to keep re-rolling.
 *
 * ## What lands when
 *
 * In a match, add and remove need `ObjectManager.update()` — which flushes
 * `_objectToBeAdd` and sweeps `toRemove`, and cannot run until the panel closes.
 * The roster shows them immediately anyway, because the source counts both sets;
 * the note at the bottom says so. A team switch and the cheats are instant: they
 * read live fields the paused loop does not gate. Outside a match everything is
 * immediate, and the note hides.
 */
import { computed, inject, ref, shallowRef } from 'vue';
import { CONFIG_PANEL } from './panelState';
import type { ConfigRosterEntry } from './MatchConfigSource';
import {
  AI_COUNT_MAX,
  BOT_DIFFICULTY_ORDER,
  type BotDifficulty,
  type ChampionLoadout,
} from '@/game/config/PregameConfig';
import { MatchTeam, type MatchTeamId } from '@/game/config/MatchTeams';
import type { SpellDisplay } from '@/game/config/spellCatalog';
import LoadoutEditorModal from '@/scenes/setup/LoadoutEditorModal.vue';
import SpellPreviewModal from '@/scenes/setup/SpellPreviewModal.vue';

const panel = inject(CONFIG_PANEL)!;
const source = panel.source;

/** Read for the dependency, not for the value — see `panelState.ts`. */
const roster = computed<ConfigRosterEntry[]>(() => {
  void panel.version.value;
  return source.roster();
});

const live = computed(() => {
  void panel.version.value;
  return source.live;
});

const TEAMS: { id: MatchTeamId; name: string; modifier: string }[] = [
  { id: MatchTeam.BLUE, name: 'Đội Xanh', modifier: 'blue' },
  { id: MatchTeam.RED, name: 'Đội Đỏ', modifier: 'red' },
];

/** Both sides, always shown — an empty side still names itself so a unit has a place to go. */
const teams = computed(() =>
  TEAMS.map(team => ({ ...team, rows: roster.value.filter(row => row.team === team.id) }))
);

const botCount = computed(() => {
  void panel.version.value;
  return source.botCount();
});
const atCap = computed(() => !source.canAddBot() && botCount.value >= AI_COUNT_MAX);

const addingBot = ref(false);
const addDisabled = computed(() => addingBot.value || !source.canAddBot());

/**
 * Adding is per side, from the button at the end of that side's list — so the
 * bot lands where the player pressed rather than wherever a balancer put it.
 *
 * `addingBot` is shared by both buttons on purpose: a mid-match add has to
 * fetch a champion's kit, and `MatchDirector.addBotLoaded` de-duplicates
 * concurrent calls into one promise. Two enabled buttons would let a quick
 * second press be silently folded into the first — and land on the wrong side.
 */
const addBot = async (team: MatchTeamId): Promise<void> => {
  if (addingBot.value) return;
  addingBot.value = true;
  try {
    await source.addBot(team);
    panel.invalidate();
  } finally {
    addingBot.value = false;
  }
};

const removeBot = (row: ConfigRosterEntry): void => {
  source.removeBot(row.id);
  panel.invalidate();
};

const otherTeam = (team: MatchTeamId): MatchTeamId =>
  team === MatchTeam.BLUE ? MatchTeam.RED : MatchTeam.BLUE;

const teamNameOf = (team: MatchTeamId): string =>
  TEAMS.find(entry => entry.id === team)?.name ?? '';

const switchTeam = (row: ConfigRosterEntry): void => {
  source.setTeam(row.id, otherTeam(row.team));
  panel.invalidate();
};

/** The three booleans only: `difficulty` is the same record's fourth field and has its own row. */
type BehaviourFlag = 'autoMove' | 'autoAttack' | 'autoCast';

const BEHAVIOUR_FLAGS: { key: BehaviourFlag; label: string }[] = [
  { key: 'autoMove', label: 'Tự di chuyển' },
  { key: 'autoAttack', label: 'Tự tấn công' },
  { key: 'autoCast', label: 'Tự dùng kỹ năng' },
];

const onFlagChange = (row: ConfigRosterEntry, flag: BehaviourFlag, event: Event): void => {
  source.setBotBehaviour(row.id, { [flag]: (event.target as HTMLInputElement).checked });
  panel.invalidate();
};

/**
 * How well this one bot plays — `BOT_DIFFICULTY_ORDER` is the config's own copy
 * of the three tiers, easiest first. It is deliberately *not*
 * `BOT_DIFFICULTIES` from `game/ai/Difficulty.ts`: that is a runtime value in
 * the match chunk, and this panel is mounted over the menu, where importing it
 * would fetch and parse the whole game before the logo (`matchConfigChunk` and
 * `pregameBootPath` are the two tests that say so).
 *
 * The labels live here rather than beside the tiers because they are this
 * screen's words, the same way `SettingsTab`'s debug-layer labels are. A
 * `Record<BotDifficulty, string>` is what makes a fourth tier a compile error
 * here instead of a blank button — that much `vue-tsc` does check, unlike the
 * `v-if` guard below it (`strict: false`, so no `strictNullChecks`).
 */
const DIFFICULTY_LABELS: Record<BotDifficulty, string> = {
  easy: 'Dễ',
  normal: 'Thường',
  hard: 'Khó',
};

/**
 * Both handlers, on purpose. `GameScene` calls `preventDefault()` on every
 * touch on the page, so the browser synthesises no trailing `click` and a
 * `@click`-only button is dead under a thumb while being perfect under a mouse
 * — the `.prevent` on the touch half then stops the pair firing twice where the
 * click *is* synthesised. `tests/game/hud/rosterTabDifficulty.test.ts` checks
 * both are still there and still reach this same call.
 */
const setDifficulty = (row: ConfigRosterEntry, difficulty: BotDifficulty): void => {
  source.setBotBehaviour(row.id, { difficulty });
  panel.invalidate();
};

/**
 * Which cards have their drawer open, keyed by row id rather than by position:
 * removing Bot 1 shifts every row below it, and an open drawer would jump to a
 * different participant instead of closing.
 */
const expanded = ref(new Set<string>());

const isExpanded = (row: ConfigRosterEntry): boolean => expanded.value.has(row.id);

const toggleExpanded = (row: ConfigRosterEntry): void => {
  // A new Set rather than mutating in place: `ref` tracks the reference, and a
  // `Set` mutated through it does not notify.
  const next = new Set(expanded.value);
  if (!next.delete(row.id)) next.add(row.id);
  expanded.value = next;
};

// ------------------------------------------------------------------- cheats

const onInvulnerableChange = (row: ConfigRosterEntry, event: Event): void => {
  source.setInvulnerable(row.id, (event.target as HTMLInputElement).checked);
  panel.invalidate();
};

const refill = (row: ConfigRosterEntry): void => {
  live.value?.refill(row.id);
  panel.invalidate();
};

const clearCooldowns = (row: ConfigRosterEntry): void => {
  live.value?.clearCooldowns(row.id);
  panel.invalidate();
};

const stacksOf = (row: ConfigRosterEntry) => {
  void panel.version.value;
  return live.value?.stacksOf(row.id) ?? [];
};

const addStacks = (row: ConfigRosterEntry, spellId: string, amount: number): void => {
  live.value?.addStacks(row.id, spellId, amount);
  panel.invalidate();
};

const clearStacks = (row: ConfigRosterEntry, spellId: string): void => {
  live.value?.clearStacks(row.id, spellId);
  panel.invalidate();
};

const STACK_STEPS = [1, 10, 100];

const scoreOf = (row: ConfigRosterEntry) => {
  void panel.version.value;
  return live.value?.scoreOf(row.id) ?? { kills: 0, deaths: 0, cs: 0 };
};

const statGroupsOf = (row: ConfigRosterEntry) => {
  void panel.version.value;
  return live.value?.statGroupsOf(row.id) ?? [];
};

// ----------------------------------------------------------- ability preview
//
// A kit icon is a description, in both places. It used to be one only on the
// setup screen — in the panel the same icons were decorative — which is one of
// the divergences this rewrite closes. The row is a transparent full-width
// button with the icons as real buttons stacked above it (`position: relative`,
// so they win the click), the shape `ParticipantCard.vue` used: a nested
// `<button>` is not valid markup.

const previewSpell = shallowRef<SpellDisplay | null>(null);

const openPreview = (row: ConfigRosterEntry, letter: string): void => {
  previewSpell.value = source.describeAbility(row.id, letter);
};

// ------------------------------------------------------------ loadout editor

const editing = shallowRef<ConfigRosterEntry | null>(null);
/** Which slot the editor opens on. Q by default, the way the editor itself defaults. */
const editingSlot = shallowRef(1);

const openEditor = (row: ConfigRosterEntry, slot = 1): void => {
  editing.value = row;
  editingSlot.value = slot;
};

const editingLoadout = computed<ChampionLoadout>(() =>
  editing.value ? source.loadoutOf(editing.value.id) : source.roster()[0].loadout
);

const applyLoadout = async (loadout: ChampionLoadout): Promise<void> => {
  const row = editing.value;
  if (!row) return;
  editing.value = null;
  await source.applyLoadout(row.id, loadout);
  panel.invalidate();
};

/**
 * The shell routes Escape here first; see `MatchConfigPanel.vue`. Returns
 * whether there was an inner layer to close, so Escape falls through to the
 * panel when there was not.
 */
defineExpose({
  closeEditor: (): boolean => {
    if (!editing.value && !previewSpell.value) return false;
    if (previewSpell.value) previewSpell.value = null;
    else editing.value = null;
    return true;
  },
});

/**
 * ## The editor is teleported out of the panel, and it has to be
 *
 * `.practice-panel` is `position: fixed` *with a transform* (it is centred with
 * `translate(-50%, -50%)`), and a transform makes an element the containing
 * block for its `position: fixed` descendants. Rendered in place, the editor's
 * `.pregame-modal-backdrop` — `position: fixed; inset: 0` — would resolve
 * `inset: 0` against the panel's box instead of the viewport: a "full-screen"
 * backdrop the size of the panel, with the dialog overflowing it.
 *
 * Teleporting to `<body>` puts both back in the viewport's coordinate space and
 * in the root stacking context. The host is `display: contents` so it adds no
 * box of its own.
 */
</script>

<template>
  <div class="practice-tab-body practice-roster-body">
    <section
      v-for="team of teams"
      :key="team.id"
      class="practice-team"
      :class="`practice-team--${team.modifier}`"
    >
      <header class="practice-team-header">
        <span class="practice-team-dot" aria-hidden="true"></span>
        <span class="practice-team-name">{{ team.name }}</span>
        <span class="practice-team-count">{{ team.rows.length }}</span>
      </header>

      <p v-if="team.rows.length === 0" class="practice-team-empty">Chưa có ai bên này.</p>

      <div
        v-for="row of team.rows"
        :key="row.id"
        class="practice-roster-row"
        :class="{ 'is-player': row.isPlayer }"
      >
        <div class="practice-roster-main">
          <!-- The invisible "open the editor" button covers the identity zone
               and *only* it — never the toggle, the side switch or the delete
               beside them. That was the objection to this shape when the row
               was built (an invisible sheet across a row full of controls is an
               overlapping tap target); scoped to the portrait and the name it
               is the same situation `ParticipantCard` used it in, where the
               only things stacked over it are the kit icons. -->
          <div class="practice-roster-identity">
            <button
              type="button"
              class="practice-roster-open"
              :aria-label="`Đổi tướng của ${row.label}`"
              @click="openEditor(row)"
            ></button>

            <span
              class="practice-roster-portrait"
              :class="{ 'is-empty': !row.avatarUrl }"
              aria-hidden="true"
            >
              <img v-if="row.avatarUrl" :src="row.avatarUrl" alt="" />
              <i v-else class="fas fa-random"></i>
            </span>

            <span class="practice-roster-text">
              <span class="practice-roster-label">
                {{ row.label }}
                <!-- Legible without opening anything: cheats persist now, so a
                     player can come back days later to a match they do not
                     remember configuring. -->
                <i
                  v-if="row.invulnerable"
                  class="fas fa-shield-halved practice-roster-badge"
                  title="Đang bất tử"
                  :data-invulnerable="row.id"
                ></i>
              </span>
              <span class="practice-roster-name">{{ row.title }}</span>
              <span class="practice-roster-spells">
                <button
                  v-for="ability of row.abilities"
                  :key="ability.letter"
                  type="button"
                  class="practice-roster-spell"
                  :class="{ 'is-inert': !ability.describable }"
                  :title="ability.describable ? 'Xem mô tả chiêu' : ability.letter"
                  @click="ability.describable && openPreview(row, ability.letter)"
                >
                  <img v-if="ability.url" :src="ability.url" alt="" />
                  <span v-else class="practice-roster-spell-empty">{{ ability.letter }}</span>
                </button>
              </span>
            </span>
          </div>

          <!-- KDA doubles as the drawer toggle in a match; outside one there is
               no score to show, so the caret carries the drawer on its own. -->
          <button
            type="button"
            class="practice-stat-toggle"
            :id="`practice-row-toggle-${row.index}`"
            :aria-expanded="isExpanded(row)"
            :aria-label="`Chỉ số và luyện tập của ${row.label}`"
            @click="toggleExpanded(row)"
          >
            <span v-if="live" class="practice-score">
              <span class="practice-score-k">{{ scoreOf(row).kills }}</span>
              <span class="practice-score-sep">/</span>
              <span class="practice-score-d">{{ scoreOf(row).deaths }}</span>
              <span class="practice-score-sep">/</span>
              <span class="practice-score-cs">{{ scoreOf(row).cs }}</span>
            </span>
            <i
              class="fas practice-stat-caret"
              :class="isExpanded(row) ? 'fa-chevron-up' : 'fa-chevron-down'"
              aria-hidden="true"
            ></i>
          </button>

          <button
            type="button"
            class="practice-team-switch"
            :aria-label="`Chuyển ${row.label} sang ${teamNameOf(otherTeam(row.team))}`"
            :title="`Chuyển sang ${teamNameOf(otherTeam(row.team))}`"
            @click="switchTeam(row)"
          >
            <i class="fas fa-right-left" aria-hidden="true"></i>
          </button>

          <button
            v-if="!row.isPlayer"
            type="button"
            class="practice-remove-bot"
            :aria-label="`Xoá ${row.label}`"
            title="Xoá bot này"
            @click="removeBot(row)"
          >
            <i class="fas fa-times"></i>
          </button>
        </div>

        <div v-if="isExpanded(row)" class="practice-stat-sheet">
          <!-- Live only: a stat sheet with no unit behind it would be a column
               of zeroes pretending to be a reading. -->
          <div v-if="live" class="practice-stat-columns">
            <section
              v-for="group of statGroupsOf(row)"
              :key="group.title"
              class="practice-stat-group"
            >
              <h4 class="practice-stat-title">{{ group.title }}</h4>
              <div v-for="stat of group.rows" :key="stat.label" class="practice-stat-row">
                <span class="practice-stat-label">
                  <i class="fas practice-stat-icon" :class="stat.icon" aria-hidden="true"></i>
                  {{ stat.label }}
                </span>
                <span class="practice-stat-value">{{ stat.value }}</span>
              </div>
            </section>
          </div>

          <section class="practice-cheat-group">
            <h4 class="practice-stat-title">Luyện tập</h4>

            <!-- Bots only: how the AI plays this champion. The player drives its
                 own movement, attacks and casts and has none. -->
            <div v-if="row.behaviour" class="practice-cheat-behaviour">
              <label
                v-for="flag of BEHAVIOUR_FLAGS"
                :key="flag.key"
                class="pregame-toggle practice-cheat-flag"
              >
                <input
                  type="checkbox"
                  :checked="row.behaviour[flag.key]"
                  @change="onFlagChange(row, flag.key, $event)"
                />
                <span>{{ flag.label }}</span>
              </label>

              <!-- Inside the same `v-if`, so the tier is offered exactly where a
                   behaviour exists to hold it: the player's row has none, and
                   nothing but this guard says so — `strict: false` means
                   `row.behaviour.difficulty` compiles anywhere. A scan test
                   holds it here. `@touchend.prevent` beside `@click` because
                   `GameScene` cancels every touch on the page — see
                   `setDifficulty`. -->
              <div class="practice-difficulty" role="group" aria-label="Trình độ">
                <span class="practice-difficulty-title">Trình độ</span>
                <span class="practice-difficulty-row">
                  <button
                    v-for="tier of BOT_DIFFICULTY_ORDER"
                    :key="tier"
                    type="button"
                    class="practice-difficulty-btn"
                    :class="{ selected: row.behaviour.difficulty === tier }"
                    :id="`practice-difficulty-${tier}-${row.index}`"
                    :aria-pressed="row.behaviour.difficulty === tier"
                    @click="setDifficulty(row, tier)"
                    @touchend.prevent="setDifficulty(row, tier)"
                  >
                    {{ DIFFICULTY_LABELS[tier] }}
                  </button>
                </span>
              </div>
            </div>

            <label class="pregame-toggle practice-cheat-invuln">
              <input
                type="checkbox"
                :id="`practice-cheat-invuln-${row.index}`"
                :checked="row.invulnerable"
                @change="onInvulnerableChange(row, $event)"
              />
              <span>Bất tử</span>
            </label>

            <!-- Actions on a unit, so there is nothing to press before a match
                 starts and nothing to store about them. -->
            <div v-if="live" class="practice-cheat-actions">
              <button
                type="button"
                class="practice-cheat-btn"
                :id="`practice-cheat-refill-${row.index}`"
                @click="refill(row)"
              >
                Hồi đầy
              </button>
              <button
                type="button"
                class="practice-cheat-btn"
                :id="`practice-cheat-cooldowns-${row.index}`"
                @click="clearCooldowns(row)"
              >
                Xoá hồi chiêu
              </button>
            </div>

            <div
              v-for="stack of stacksOf(row)"
              :key="stack.spellId"
              class="practice-cheat-stack"
              :data-cheat-stack="stack.spellId"
            >
              <span class="practice-cheat-stack-name">
                {{ stack.name }}
                <strong class="practice-cheat-stack-count">{{ stack.count }}</strong>
              </span>
              <span class="practice-cheat-stack-actions">
                <button
                  v-for="step of STACK_STEPS"
                  :key="step"
                  type="button"
                  class="practice-cheat-btn"
                  @click="addStacks(row, stack.spellId, step)"
                >
                  +{{ step }}
                </button>
                <button
                  type="button"
                  class="practice-cheat-btn"
                  @click="clearStacks(row, stack.spellId)"
                >
                  Xoá
                </button>
              </span>
            </div>
          </section>
        </div>
      </div>

      <!-- One per side, at the end of that side's list, scrolling with it.
           It used to be a single button pinned to the bottom of the scroller,
           which cost a permanent 45px strip over the roster *and* said nothing
           about where the bot would go. Here the position is the answer.

           The count is on the button rather than in a note beside it: at the
           cap, the control the player is pressing is the one that has to
           explain itself. -->
      <button
        type="button"
        class="practice-add-bot"
        :id="`practice-add-bot-${team.modifier}`"
        :disabled="addDisabled"
        :aria-label="`Thêm bot vào ${team.name}`"
        @click="addBot(team.id)"
      >
        <i class="fas fa-plus" aria-hidden="true"></i>
        <!-- "Thêm bot", not "Thêm bot vào Đội Xanh": the button sits inside that
             side's own tinted box, so the words would only repeat where it
             already is — and on a narrow phone they wrap. The side stays in the
             `aria-label`, where position is not available. -->
        <span>{{
          addingBot ? 'Đang tải…' : atCap ? `Đã đủ ${AI_COUNT_MAX} bot` : 'Thêm bot'
        }}</span>
        <span class="practice-add-bot-count">{{ botCount }}/{{ AI_COUNT_MAX }}</span>
      </button>
    </section>

    <!-- Scoped to add and remove, and only in a match: outside one there is no
         paused loop to wait for. -->
    <p v-if="live" class="practice-note">
      Thêm và xoá có hiệu lực khi bạn đóng bảng và trận chạy tiếp.
    </p>

    <Teleport to="body">
      <div v-if="editing" class="practice-editor-host">
        <LoadoutEditorModal
          :title="`Đổi tướng — ${editing.label}`"
          :loadout="editingLoadout"
          :initial-slot="editingSlot"
          :match-rules="source.matchRules"
          :is-touch-ui="source.touchUi"
          @change="applyLoadout"
          @close="editing = null"
        />
      </div>
      <div v-if="previewSpell" class="practice-editor-host">
        <SpellPreviewModal :display="previewSpell" @close="previewSpell = null" />
      </div>
    </Teleport>
  </div>
</template>
