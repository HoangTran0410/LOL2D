<script setup lang="ts">
/**
 * The team tab: who is in this match, which side each is on, and every knob on
 * each of them — kit, AI behaviour, and the practice cheats that used to live a
 * tab away.
 *
 * ## Why the cheats moved here
 *
 * They used to be a separate "Gian lận" tab that opened with its own list of
 * champions and a unit selector, so the roster was described twice — once here
 * to swap a kit, once there to make a champion invulnerable — and the two lists
 * sat a tab apart. "Bot 2" meant the same unit in both places, which is exactly
 * the tell that they were one thing split in two. So per-unit cheats (bất tử,
 * hồi đầy, xoá hồi chiêu, cộng dồn stack) fold into each champion's own row
 * here, and Gian lận keeps only what is genuinely global — reveal map and the
 * debug layers, which belong to the match, not to a champion.
 *
 * ## Grouped by side, and the side is editable
 *
 * The roster is split into Đội Xanh and Đội Đỏ, in spawn order within each. Every
 * champion — the player included — carries a switch that moves it to the other
 * side through `MatchDirector.setTeam`. That is a real reassignment, not a label:
 * everything that reads a side reads `teamId` at query time, so the fountain a
 * unit respawns at, ally-from-enemy targeting, turret protection and the fog's
 * ally-vision all follow the moment the switch is pressed. The player's side
 * persists as `playerTeam`, a bot's in `ai.botTeams`, so the sides you set are
 * the sides you reload.
 *
 * ## This component owns no roster state, only a view of the director's
 *
 * The setup screen's Players tab answers the same question about a match that
 * does not exist yet, and this reads like it — a row per participant, portrait
 * and kit on the left, the row itself the way into the loadout editor, a delete
 * on the right. What differs is what a row *is*. There, a row is an entry in a
 * `readonly ChampionLoadout[]` and removing one is an array splice. Here it is a
 * live unit holding a quadtree slot, a path agent and a spell list mid-cooldown,
 * and every edit goes through `MatchDirector`.
 *
 * ## The row shows the unit's name; the editor shows the loadout
 *
 * Two different facts, and the row cannot be used as a source for the other. The
 * row is who is standing on the map — after a swap to Zed, "Zed"; on the default
 * config, the coherent champion rolled for this life. The editor opens on the
 * *setting*: "Ngẫu Nhiên", the thing a player would be editing and the thing
 * that keeps a bot re-rolling on every respawn. Reading the row back as a
 * loadout would silently pin a bot that was meant to keep rolling — hence
 * `MatchDirector.loadoutOf`, since `getChampionPresetFromLoadout` is one-way.
 *
 * ## What lands when
 *
 * A champion *swap* first loads that exact kit, then lands on the existing unit;
 * the panel is paused, so the canvas never shows an in-between fallback. Add and
 * remove are the other kind — they need `ObjectManager.update()`, which flushes
 * `_objectToBeAdd` and sweeps `toRemove`, and that cannot run until the panel
 * closes. The roster shows them immediately anyway, because
 * `MatchDirector.bots()` counts both sets; the note at the bottom says so. A team
 * switch and the cheats, by contrast, are instant: they read live fields the
 * paused loop does not gate.
 */
import { computed, inject, onUnmounted, ref, shallowRef } from 'vue';
import type { HudInteractions } from '@/game/hud/hudInteractions';
import { scoreLine, statGroups } from './participantStats';
import type { BotBehaviour, RosterEntry } from '@/game/MatchDirector';
import type { ChampionLoadout } from '@/game/config/PregameConfig';
import { AI_COUNT_MAX, DEFAULT_CHAMPION_LOADOUT } from '@/game/config/PregameConfig';
import { MatchTeam, type MatchTeamId } from '@/game/config/MatchTeams';
import type Champion from '@/game/gameObject/attackableUnits/Champion';
import AIChampion from '@/game/gameObject/attackableUnits/AIChampion';
import type Spell from '@/game/gameObject/Spell';
import LoadoutEditorModal from '@/scenes/setup/LoadoutEditorModal.vue';

const hud = inject<HudInteractions>('hud')!;

/**
 * Bumped after every mutation, and read by the `computed`s and per-row helpers
 * below purely to make them re-run. A counter rather than the alternatives, both
 * of which were considered:
 *
 *   - *Making the roster reactive* is ruled out upstream. `hudInteractions.ts`
 *     wraps the director in `markRaw` on purpose: a proxied director hands back
 *     a proxied `objectManager`, proxied units and proxied p5 vectors — the
 *     whole game graph — on every read, which is a real cost paid every frame
 *     to solve a problem that only exists while this tab is open.
 *   - *`EventManager`* would be the right seam if anything else needed to hear
 *     about a roster change. Nothing does — this component is the only thing that
 *     mutates the roster while the panel is open, and it already knows when.
 *
 * The invariant that keeps it honest is one line: **every director call in this
 * component is followed by `invalidate()`**, and it covers the cheats too, whose
 * `stackCount` and invulnerability are read off live objects.
 */
const version = ref(0);
const invalidate = (): void => {
  version.value++;
};

const roster = computed<RosterEntry[]>(() => {
  // Read for the dependency, not for the value.
  void version.value;
  return hud.director.roster();
});

/** "Bạn", then Bot 1..n in spawn order — the position in the full roster, not a unit id. */
const labelOf = (index: number): string => (index === 0 ? 'Bạn' : `Bot ${index}`);

/**
 * The four ability icons for a unit's row, Q/W/E/R. `spells` is indexed by
 * `SpellHotKeys` — `[A, Q, W, E, R, D, F]` — so the abilities are slots 1‑4; a
 * basic-attack-only or half-built kit leaves a slot empty, which shows the
 * letter rather than a broken image. Decorative only: the whole row already
 * opens the loadout editor, and a nested button inside that button is not valid
 * markup.
 */
const ABILITY_SLOTS = [1, 2, 3, 4];
const ABILITY_LETTERS = ['Q', 'W', 'E', 'R'];
const abilityIconsOf = (
  unit: Champion
): { key: string; letter: string; url: string | null }[] =>
  ABILITY_SLOTS.map((slot, i) => {
    const image = unit.spells?.[slot]?.image as { url?: string } | null | undefined;
    return { key: `${unit.id}-${slot}`, letter: ABILITY_LETTERS[i], url: image?.url ?? null };
  });

interface RosterRow {
  entry: RosterEntry;
  /** Index in the full roster, so the label stays stable when grouped by side. */
  index: number;
  label: string;
}

/** The whole roster with its labels resolved, before it is split by side. */
const rows = computed<RosterRow[]>(() =>
  roster.value.map((entry, index) => ({ entry, index, label: labelOf(index) }))
);

const rowsOnTeam = (teamId: MatchTeamId): RosterRow[] =>
  rows.value.filter(row => row.entry.unit.teamId === teamId);

const TEAMS: { id: MatchTeamId; name: string; modifier: string }[] = [
  { id: MatchTeam.BLUE, name: 'Đội Xanh', modifier: 'blue' },
  { id: MatchTeam.RED, name: 'Đội Đỏ', modifier: 'red' },
];

/** Both sides, always shown — an empty side still names itself so a unit has a place to go. */
const teams = computed(() =>
  TEAMS.map(team => ({ ...team, rows: rowsOnTeam(team.id) }))
);

const bots = computed(() => roster.value.filter(entry => !entry.isPlayer));
const atCap = computed(() => bots.value.length >= AI_COUNT_MAX);
const addingBot = ref(false);
const addDisabled = computed(() => atCap.value || addingBot.value);

/**
 * `RosterEntry.unit` is a `Champion`, which is the honest type — the player is
 * one and has no behaviour flags. `setBotBehaviour` and `removeBot` want the
 * narrower thing, so this checks rather than casts: `entry.behaviour` being
 * present already implies a bot, but implying is not proving, and the roster is
 * built from live objects the panel does not own.
 */
const botOf = (entry: RosterEntry): AIChampion | null =>
  entry.unit instanceof AIChampion ? entry.unit : null;

const addBot = async (): Promise<void> => {
  // The cap is the director's (`addBot` returns null at `AI_COUNT_MAX`); the
  // button is disabled and the count is on screen so a refusal is never the
  // player's first hint that there was a limit.
  if (addingBot.value) return;
  addingBot.value = true;
  try {
    await hud.director.addBotLoaded(DEFAULT_CHAMPION_LOADOUT);
    invalidate();
  } finally {
    addingBot.value = false;
  }
};

const removeBot = (entry: RosterEntry): void => {
  const bot = botOf(entry);
  if (!bot) return;
  hud.director.removeBot(bot);
  invalidate();
};

/** The other side — where this unit's switch sends it. */
const otherTeam = (teamId: string): MatchTeamId =>
  teamId === MatchTeam.BLUE ? MatchTeam.RED : MatchTeam.BLUE;

const teamNameOf = (teamId: MatchTeamId): string =>
  TEAMS.find(team => team.id === teamId)?.name ?? '';

const switchTeam = (entry: RosterEntry): void => {
  hud.director.setTeam(entry.unit, otherTeam(entry.unit.teamId));
  invalidate();
};

const setFlag = (entry: RosterEntry, flag: keyof BotBehaviour, on: boolean): void => {
  const bot = botOf(entry);
  if (!bot) return;
  const flags: Partial<BotBehaviour> = {};
  flags[flag] = on;
  hud.director.setBotBehaviour(bot, flags);
  invalidate();
};

const onFlagChange = (entry: RosterEntry, flag: keyof BotBehaviour, event: Event): void =>
  setFlag(entry, flag, (event.target as HTMLInputElement).checked);

const BEHAVIOUR_FLAGS: { key: keyof BotBehaviour; label: string }[] = [
  // Same three settings, same order and the same words as `AiConfigPanel.vue`
  // on the setup screen, minus its "AI" prefix — out here the row already says
  // whose flags these are.
  { key: 'autoMove', label: 'Tự di chuyển' },
  { key: 'autoAttack', label: 'Tự tấn công' },
  { key: 'autoCast', label: 'Tự dùng kỹ năng' },
];

/**
 * Which cards have their drawer open — stats plus the practice cheats — keyed by
 * unit id rather than by row index: removing Bot 1 shifts every index below it,
 * and an open drawer would jump to a different bot instead of closing.
 *
 * Not persisted anywhere. The panel mounts every tab with `v-if` and keeps
 * nothing alive, so this resets on a tab switch, which is right for a peek and
 * also what keeps the numbers fresh: a remount re-reads them. Nothing has to
 * invalidate them while the drawer is open, because the panel holds the match
 * paused — see the trap in CLAUDE.md.
 */
const expanded = ref(new Set<string>());

const isExpanded = (entry: RosterEntry): boolean => expanded.value.has(entry.unit.id);

const toggleExpanded = (entry: RosterEntry): void => {
  // A new Set rather than mutating in place: `ref` tracks the reference, and a
  // `Set` mutated through it does not notify.
  const next = new Set(expanded.value);
  if (!next.delete(entry.unit.id)) next.add(entry.unit.id);
  expanded.value = next;
};

// ------------------------------------------------------------------- cheats
//
// The per-unit half of the old Gian lận tab, now on each champion's own row.
// Every one goes through `hud.director` (or `Spell.setStackCount`, which each
// stacking spell overrides) — nothing here constructs a `Buff` or touches
// `stats`, so a cheat cannot mean something different from the real mechanic it
// imitates. Each helper reads `version` so a template call re-runs on
// `invalidate()`; each mutator ends in `invalidate()`.

const isInvulnerable = (unit: Champion): boolean => {
  void version.value;
  return hud.director.isInvulnerable(unit);
};

const onInvulnerableChange = (unit: Champion, event: Event): void => {
  hud.director.setInvulnerable(unit, (event.target as HTMLInputElement).checked);
  invalidate();
};

const refill = (unit: Champion): void => {
  hud.director.refill(unit);
  invalidate();
};

const clearCooldowns = (unit: Champion): void => {
  hud.director.clearCooldowns(unit);
  invalidate();
};

/**
 * The unit's stacking spells. `stackCount` is `undefined` for a spell with
 * nothing to count, so a stacking spell added later shows up here with no change
 * to this file. Nothing renders for a kit that accumulates nothing, which is
 * most of them.
 */
const stackSpellsOf = (unit: Champion): Spell[] => {
  void version.value;
  return (unit.spells ?? []).filter(
    (spell: Spell | undefined): spell is Spell => !!spell && spell.stackCount !== undefined
  );
};

/** Relative, because the buttons are `+1 / +10 / +100`; `setStackCount` itself is absolute. */
const addStacks = (spell: Spell, amount: number): void => {
  spell.setStackCount((spell.stackCount ?? 0) + amount);
  invalidate();
};

const clearStacks = (spell: Spell): void => {
  spell.setStackCount(0);
  invalidate();
};

const STACK_STEPS = [1, 10, 100];

// ------------------------------------------------------------ loadout editor

/**
 * `shallowRef`, not `ref`: `ref` deep-converts what it is given, and this holds
 * a live `Champion`. See `hudInteractions.ts`'s `markRaw` on the director for
 * the same decision and the same reason.
 */
const editing = shallowRef<RosterEntry | null>(null);
const editingIndex = shallowRef(0);
/** Which slot the editor opens on. Q by default, the way the editor itself defaults. */
const editingSlot = shallowRef(1);

const openEditor = (entry: RosterEntry, index: number, slot = 1): void => {
  editing.value = entry;
  editingIndex.value = index;
  editingSlot.value = slot;
};

/**
 * The desktop strip's per-icon shortcut lands here: clicking your own Q used to
 * open the picker aimed at that slot, and now opens this tab's editor on the
 * player's row, aimed at that slot. Consumed once — the flag is cleared
 * immediately, so switching tabs and coming back does not re-open the editor.
 */
const requestedSlot = hud.editPlayerSlot;
if (requestedSlot !== null) {
  const index = roster.value.findIndex(entry => entry.isPlayer);
  if (index >= 0) openEditor(roster.value[index], index, requestedSlot);
  hud.editPlayerSlot = null;
}

/**
 * Escape closes the innermost layer first — the editor over this tab, not the
 * panel under it — which is the rule commit `b48ef7d` set for the setup screen's
 * own nested modals. The handler lives on the shared `hud` object because the
 * key never reaches the DOM: p5 binds `keydown` on `window` and `GameScene`
 * routes it. Returning `false` when nothing is open lets Escape fall through to
 * the panel.
 */
hud.onEscapeInner = () => {
  if (!editing.value) return false;
  editing.value = null;
  return true;
};

onUnmounted(() => {
  hud.onEscapeInner = null;
});

const editingLoadout = computed<ChampionLoadout>(() =>
  editing.value ? hud.director.loadoutOf(editing.value.unit) : DEFAULT_CHAMPION_LOADOUT
);

const applyLoadout = async (loadout: ChampionLoadout): Promise<void> => {
  const entry = editing.value;
  if (!entry) return;
  editing.value = null;
  await hud.director.applyLoadoutLoaded(entry.unit, loadout);
  invalidate();
};

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
 * in the root stacking context, where `z-index: 200` clears the HUD. The host is
 * `display: contents` so it adds no box of its own.
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
        :key="row.entry.unit.id"
        class="practice-roster-row"
        :class="{ 'is-player': row.entry.isPlayer }"
      >
        <div class="practice-roster-main">
          <button
            type="button"
            class="practice-roster-open"
            :aria-label="`Đổi tướng của ${row.label}`"
            @click="openEditor(row.entry, row.index)"
          >
            <span
              class="practice-roster-portrait"
              :class="{ 'is-empty': !row.entry.unit.avatar }"
              aria-hidden="true"
            >
              <img v-if="row.entry.unit.avatar" :src="row.entry.unit.avatar.url" alt="" />
              <i v-else class="fas fa-random"></i>
            </span>
            <span class="practice-roster-text">
              <span class="practice-roster-label">{{ row.label }}</span>
              <span class="practice-roster-name">{{ row.entry.unit.name || 'Không tên' }}</span>
              <span class="practice-roster-spells" aria-hidden="true">
                <span
                  v-for="ability of abilityIconsOf(row.entry.unit)"
                  :key="ability.key"
                  class="practice-roster-spell"
                  :title="ability.letter"
                >
                  <img v-if="ability.url" :src="ability.url" alt="" />
                  <span v-else class="practice-roster-spell-empty">{{ ability.letter }}</span>
                </span>
              </span>
            </span>
          </button>

          <!-- KDA doubles as the drawer toggle, inline in the row rather than a
               strip of its own below: it carries the row's empty middle, and the
               short landscape panel keeps a row of height. Its full labels live
               in the drawer's Thành tích section. -->
          <button
            type="button"
            class="practice-stat-toggle"
            :id="`practice-row-toggle-${row.index}`"
            :aria-expanded="isExpanded(row.entry)"
            :aria-label="`Chỉ số và luyện tập của ${row.label}`"
            @click="toggleExpanded(row.entry)"
          >
            <span class="practice-score">
              <span class="practice-score-k">{{ scoreLine(row.entry.unit).kills }}</span>
              <span class="practice-score-sep">/</span>
              <span class="practice-score-d">{{ scoreLine(row.entry.unit).deaths }}</span>
              <span class="practice-score-sep">/</span>
              <span class="practice-score-cs">{{ scoreLine(row.entry.unit).cs }}</span>
            </span>
            <i
              class="fas practice-stat-caret"
              :class="isExpanded(row.entry) ? 'fa-chevron-up' : 'fa-chevron-down'"
              aria-hidden="true"
            ></i>
          </button>

          <button
            type="button"
            class="practice-team-switch"
            :aria-label="`Chuyển ${row.label} sang ${teamNameOf(otherTeam(row.entry.unit.teamId))}`"
            :title="`Chuyển sang ${teamNameOf(otherTeam(row.entry.unit.teamId))}`"
            @click="switchTeam(row.entry)"
          >
            <i class="fas fa-right-left" aria-hidden="true"></i>
          </button>

          <button
            v-if="!row.entry.isPlayer"
            type="button"
            class="practice-remove-bot"
            :aria-label="`Xoá ${row.label}`"
            title="Xoá bot này"
            @click="removeBot(row.entry)"
          >
            <i class="fas fa-times"></i>
          </button>
        </div>

        <!-- Stats on the left, the folded-in cheats on the right: on a wide
             (landscape) panel the two zones sit side by side and fill the row
             rather than leaving the right half empty; on a narrow one they
             stack. -->
        <div v-if="isExpanded(row.entry)" class="practice-stat-sheet">
          <div class="practice-stat-columns">
            <section
              v-for="group of statGroups(row.entry.unit)"
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

          <!-- The folded-in cheats: session state on this one unit. -->
          <section class="practice-cheat-group">
            <h4 class="practice-stat-title">Luyện tập</h4>

            <!-- Bots only: how the AI plays this champion. Folded in here from
                 the row so every per-bot setting sits in one place — the player
                 drives its own movement, attacks and casts and has none. -->
            <div v-if="row.entry.behaviour" class="practice-cheat-behaviour">
              <label
                v-for="flag of BEHAVIOUR_FLAGS"
                :key="flag.key"
                class="pregame-toggle practice-cheat-flag"
              >
                <input
                  type="checkbox"
                  :checked="row.entry.behaviour[flag.key]"
                  @change="onFlagChange(row.entry, flag.key, $event)"
                />
                <span>{{ flag.label }}</span>
              </label>
            </div>

            <label class="pregame-toggle practice-cheat-invuln">
              <input
                type="checkbox"
                :id="`practice-cheat-invuln-${row.index}`"
                :checked="isInvulnerable(row.entry.unit)"
                @change="onInvulnerableChange(row.entry.unit, $event)"
              />
              <span>Bất tử</span>
            </label>

            <div class="practice-cheat-actions">
              <button
                type="button"
                class="practice-cheat-btn"
                :id="`practice-cheat-refill-${row.index}`"
                @click="refill(row.entry.unit)"
              >
                Hồi đầy
              </button>
              <button
                type="button"
                class="practice-cheat-btn"
                :id="`practice-cheat-cooldowns-${row.index}`"
                @click="clearCooldowns(row.entry.unit)"
              >
                Xoá hồi chiêu
              </button>
            </div>

            <div
              v-for="spell of stackSpellsOf(row.entry.unit)"
              :key="spell.id"
              class="practice-cheat-stack"
              :data-cheat-stack="spell.id"
            >
              <span class="practice-cheat-stack-name">
                {{ spell.name }}
                <strong class="practice-cheat-stack-count">{{ spell.stackCount }}</strong>
              </span>
              <span class="practice-cheat-stack-actions">
                <button
                  v-for="step of STACK_STEPS"
                  :key="step"
                  type="button"
                  class="practice-cheat-btn"
                  @click="addStacks(spell, step)"
                >
                  +{{ step }}
                </button>
                <button type="button" class="practice-cheat-btn" @click="clearStacks(spell)">
                  Xoá
                </button>
              </span>
            </div>
          </section>
        </div>
      </div>
    </section>

    <p class="practice-note">Thêm và xoá có hiệu lực khi bạn đóng bảng và trận chạy tiếp.</p>

    <!-- Last in the flow, like the setup screen's "Thêm Bot", but pinned to the
         bottom of the scroller (`position: sticky`). The count is on the button
         rather than in a note beside it: at the cap, the one control the player
         is pressing is the one that has to explain itself. A new bot auto-balances
         onto the lighter side; its row's switch moves it after. -->
    <button type="button" class="practice-add-bot" :disabled="addDisabled" @click="addBot">
      <i class="fas fa-plus"></i>
      <span>{{
        addingBot
          ? 'Đang tải bộ kỹ năng…'
          : atCap
            ? `Đã đủ ${AI_COUNT_MAX} bot — xoá bớt để thêm`
            : 'Thêm bot'
      }}</span>
      <span class="practice-add-bot-count">{{ bots.length }}/{{ AI_COUNT_MAX }}</span>
    </button>

    <Teleport to="body">
      <div v-if="editing" class="practice-editor-host">
        <LoadoutEditorModal
          :title="`Đổi tướng — ${labelOf(editingIndex)}`"
          :loadout="editingLoadout"
          :initial-slot="editingSlot"
          :match-rules="hud.director.matchRules"
          :is-touch-ui="hud.touchUi"
          @change="applyLoadout"
          @close="editing = null"
        />
      </div>
    </Teleport>
  </div>
</template>
