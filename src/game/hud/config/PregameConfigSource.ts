/**
 * `MatchConfigSource` over the stored config, for the panel mounted on the menu
 * where no match exists.
 *
 * Everything here is a read and a write of `PregameConfig`. There is nothing to
 * apply, which is the whole difference from `MatchDirectorSource`: `live` is
 * `null`, so the controls that act on a running match are not rendered and
 * cannot be called.
 *
 * This replaces `scenes/setup/usePregameConfig.ts`, which did the same job for
 * a screen that no longer exists. The bot-slot bookkeeping is carried over
 * unchanged — the fixed-length parallel arrays, the team balancing when a slot
 * activates, the splice-and-refill on removal — because it was right and its
 * reasons are still the reasons.
 *
 * No p5, no game objects, no `Game`: it must not pull the match into the menu's
 * chunk. `tests/scenes/matchConfigChunk.test.ts` enforces that.
 */
import {
  AI_COUNT_MAX,
  AI_COUNT_MIN,
  DEFAULT_CHAMPION_LOADOUT,
  DEFAULT_PREGAME_CONFIG,
  globalBotBehaviour,
  loadPregameConfig,
  sanitizePregameConfig,
  savePregameConfig,
  toMatchRules,
  type BotBehaviour,
  type ChampionLoadout,
  type CheatConfig,
  type MatchRules,
  type MatchRulesConfig,
  type PregameConfig,
  type WorldConfig,
} from '@/game/config/PregameConfig';
import type { MatchTeamId } from '@/game/config/MatchTeams';
import {
  renderFpsPreference,
  renderQualityPreference,
  setRenderFpsPreference,
  setRenderQualityPreference,
  type RenderFps,
} from '@/game/config/renderPreferences';
import {
  setTouchModePreference,
  touchControlsPreference,
  touchModePreference,
  type TouchModePreference,
} from '@/game/input/touchPreferences';
import type { RenderQuality } from '@/game/managers/ObjectManager';
import { isSpellCatalogId, spellDisplayOf, type SpellDisplay } from '@/game/config/spellCatalog';
import type { ConfigRosterEntry, MatchConfigSource, MatchLiveControls } from './MatchConfigSource';
import { visualOfLoadout, type LoadoutVisual } from './rosterVisuals';
import { contentCatalog } from '@/content/catalog';
import type { QualifiedMapSummary } from '@/content/PackRegistry';

const PLAYER_ID = 'player';
const BOT_PREFIX = 'bot-';

export default class PregameConfigSource implements MatchConfigSource {
  /** No match, so nothing to act on. The panel reads this and hides those controls. */
  readonly live: MatchLiveControls | null = null;

  private config: PregameConfig;
  private _inputMode: TouchModePreference = touchModePreference();
  private _touchUi: boolean = touchControlsPreference();

  constructor() {
    this.config = loadPregameConfig();
  }

  private persist(): void {
    savePregameConfig(this.config);
  }

  /**
   * Which bot slot an id names, or `null` for the player. Ids are positional
   * (`bot-0`), and positions shift when a bot in the middle is removed — which
   * is fine because the panel re-reads the roster after every mutation, and
   * deliberately not fine to hold on to across one.
   */
  private slotOf(id: string): number | null {
    if (id === PLAYER_ID) return null;
    const index = Number(id.slice(BOT_PREFIX.length));
    return Number.isInteger(index) && index >= 0 && index < this.config.ai.count ? index : null;
  }

  // ------------------------------------------------------------------ roster

  /** Drops the catalogue ids: they are this source's private route to a description. */
  private publicVisual(visual: LoadoutVisual) {
    return {
      title: visual.title,
      avatarUrl: visual.avatarUrl,
      abilities: visual.abilities.map(({ letter, url, spellId }) => ({
        letter,
        url,
        describable: spellId !== null,
      })),
    };
  }

  roster(): ConfigRosterEntry[] {
    const { player, playerTeam, ai, cheats } = this.config;
    const entries: ConfigRosterEntry[] = [
      {
        id: PLAYER_ID,
        index: 0,
        label: 'Bạn',
        isPlayer: true,
        team: playerTeam,
        loadout: player,
        invulnerable: cheats.playerInvulnerable,
        ...this.publicVisual(visualOfLoadout(player)),
      },
    ];

    for (let i = 0; i < ai.count; i++) {
      entries.push({
        id: `${BOT_PREFIX}${i}`,
        index: i + 1,
        label: `Bot ${i + 1}`,
        isPlayer: false,
        team: ai.botTeams[i],
        loadout: ai.bots[i],
        behaviour: ai.botBehaviours[i],
        invulnerable: !!cheats.botInvulnerable[i],
        ...this.publicVisual(visualOfLoadout(ai.bots[i])),
      });
    }

    return entries;
  }

  botCount(): number {
    return this.config.ai.count;
  }

  canAddBot(): boolean {
    return this.config.ai.count < AI_COUNT_MAX;
  }

  /**
   * Activates the next slot on `team`, keeping its stored kit and behaviour.
   * Existing participants keep their teams byte-for-byte — activating a bot is
   * not a reason to move somebody else.
   *
   * The side is the caller's, not `teamForAddedBot`'s: the button lives at the
   * end of a side's list, so balancing here would put the bot somewhere other
   * than where it was asked for.
   *
   * `async` to satisfy the interface, which is shaped by the other source:
   * adding a bot to a running match has to fetch that champion's kit first.
   */
  async addBot(team: MatchTeamId): Promise<void> {
    const { ai } = this.config;
    if (ai.count >= AI_COUNT_MAX) return;

    const index = ai.count;
    const botTeams = ai.botTeams.slice();
    botTeams[index] = team;

    this.config = { ...this.config, ai: { ...ai, count: index + 1, botTeams } };
    this.persist();
  }

  /**
   * Removes one bot by position, shifting every bot after it up and dropping
   * the count. The four per-slot arrays are spliced together because they are
   * index-aligned: shift only the kit and the bot that moved down inherits
   * somebody else's side, behaviour and invulnerability.
   *
   * The freed tail slot is refilled — the arrays are always `AI_COUNT_MAX` long
   * (see `AIConfig.bots`). Its behaviour comes from the config's own global
   * flags rather than `DEFAULT_BOT_BEHAVIOUR`, since those are what a slot
   * nobody has configured means here; `globalBotBehaviour` is that rule, and it
   * is also where the tier — which has no global — gets its default.
   */
  removeBot(id: string): void {
    const index = this.slotOf(id);
    if (index === null) return;

    const { ai, cheats } = this.config;

    const bots = ai.bots.slice();
    bots.splice(index, 1);
    bots.push(DEFAULT_CHAMPION_LOADOUT);

    const botTeams = ai.botTeams.slice();
    botTeams.splice(index, 1);
    botTeams.push(DEFAULT_PREGAME_CONFIG.ai.botTeams[AI_COUNT_MAX - 1]);

    const botBehaviours = ai.botBehaviours.slice();
    botBehaviours.splice(index, 1);
    botBehaviours.push(globalBotBehaviour(ai));

    const botInvulnerable = cheats.botInvulnerable.slice();
    botInvulnerable.splice(index, 1);
    botInvulnerable.push(false);

    this.config = {
      ...this.config,
      ai: {
        ...ai,
        count: Math.max(AI_COUNT_MIN, ai.count - 1),
        bots,
        botTeams,
        botBehaviours,
      },
      cheats: { ...cheats, botInvulnerable },
    };
    this.persist();
  }

  setTeam(id: string, team: MatchTeamId): void {
    const index = this.slotOf(id);
    if (index === null) {
      this.config = { ...this.config, playerTeam: team };
    } else {
      const botTeams = this.config.ai.botTeams.slice();
      botTeams[index] = team;
      this.config = { ...this.config, ai: { ...this.config.ai, botTeams } };
    }
    this.persist();
  }

  setBotBehaviour(id: string, flags: Partial<BotBehaviour>): void {
    const index = this.slotOf(id);
    if (index === null) return;
    const botBehaviours = this.config.ai.botBehaviours.slice();
    botBehaviours[index] = { ...botBehaviours[index], ...flags };
    this.config = { ...this.config, ai: { ...this.config.ai, botBehaviours } };
    this.persist();
  }

  loadoutOf(id: string): ChampionLoadout {
    const index = this.slotOf(id);
    return index === null ? this.config.player : this.config.ai.bots[index];
  }

  /**
   * Resolved from the loadout through the catalogue — the only thing there is
   * out here. The numbers are shown under this config's own rules, so a
   * cooldown quoted before the match is the one the match will charge.
   */
  describeAbility(id: string, letter: string): SpellDisplay | null {
    const ability = visualOfLoadout(this.loadoutOf(id)).abilities.find(
      entry => entry.letter === letter
    );
    // `isSpellCatalogId` no longer narrows anything `string` doesn't already
    // say (`SpellCatalogId` is `string` since batch 5 task 2) — this line's
    // guarantee is entirely the runtime call, not the compiler. That's the
    // guarantee that matters here: `ability.spellId` comes from a player's
    // persisted `localStorage` config, which can name a spell this build no
    // longer has, and this is what stops that stale id from reaching
    // `spellDisplayOf` ungated.
    if (!ability?.spellId || !isSpellCatalogId(ability.spellId)) return null;
    return spellDisplayOf(ability.spellId, this.matchRules);
  }

  async applyLoadout(id: string, loadout: ChampionLoadout): Promise<void> {
    const index = this.slotOf(id);
    if (index === null) {
      this.config = { ...this.config, player: loadout };
    } else {
      const bots = this.config.ai.bots.slice();
      bots[index] = loadout;
      this.config = { ...this.config, ai: { ...this.config.ai, bots } };
    }
    this.persist();
  }

  // ------------------------------------------------------------------- rules

  get matchRules(): MatchRules {
    return toMatchRules(this.config.rules);
  }

  getRules(): MatchRulesConfig {
    return { ...this.config.rules };
  }

  /**
   * `persist: false` is the CDR slider mid-drag. There is no match to apply it
   * to out here, so the only thing it can do is keep the value the label reads
   * without writing storage on every frame of the drag.
   */
  setRules(rules: MatchRulesConfig, persist: boolean): void {
    this.config = { ...this.config, rules: { ...rules } };
    // Sanitizing on the way in, not only on the way out: the label reads back
    // from `getRules()`, so a percentage the validator would clamp has to be
    // clamped before it is shown, in both sources.
    this.config = sanitizePregameConfig(this.config);
    if (persist) this.persist();
  }

  getWorld(): WorldConfig {
    return { ...this.config.world };
  }

  setWorld(world: Partial<WorldConfig>): void {
    this.config = { ...this.config, world: { ...this.config.world, ...world } };
    this.persist();
  }

  // --------------------------------------------------------------------- map

  availableMaps(): QualifiedMapSummary[] {
    return [...contentCatalog().maps()];
  }

  getMap(): string {
    return this.config.mapId;
  }

  setMap(id: string): void {
    this.config = { ...this.config, mapId: id };
    this.persist();
  }

  // ------------------------------------------------------------------ cheats

  getCheats(): CheatConfig {
    return this.config.cheats;
  }

  setCheats(cheats: Partial<CheatConfig>): void {
    this.config = { ...this.config, cheats: { ...this.config.cheats, ...cheats } };
    this.persist();
  }

  setInvulnerable(id: string, on: boolean): void {
    const index = this.slotOf(id);
    if (index === null) {
      this.setCheats({ playerInvulnerable: on });
      return;
    }
    const botInvulnerable = this.config.cheats.botInvulnerable.slice();
    botInvulnerable[index] = on;
    this.setCheats({ botInvulnerable });
  }

  // ------------------------------------------------------------------ device

  get touchUi(): boolean {
    return this._touchUi;
  }

  get inputMode(): TouchModePreference {
    return this._inputMode;
  }

  /**
   * Re-resolves rather than assuming: `'auto'` means "whatever this device is",
   * which only `touchControlsPreference()` knows — and it still honours the
   * `?touch=` query parameter the e2e harness drives this screen with, so the
   * layout never contradicts it.
   */
  setInputMode(mode: TouchModePreference): void {
    setTouchModePreference(mode);
    this._inputMode = mode;
    const resolved = touchControlsPreference();
    this._touchUi = resolved;
    document.body?.classList.toggle('touch-ui', resolved);
  }

  get renderQuality(): RenderQuality {
    return renderQualityPreference();
  }

  get renderFps(): RenderFps {
    return renderFpsPreference();
  }

  setRenderQuality(quality: RenderQuality): void {
    setRenderQualityPreference(quality);
  }

  setRenderFps(fps: RenderFps): void {
    setRenderFpsPreference(fps);
  }

  async resetToDefaults(): Promise<void> {
    this.config = sanitizePregameConfig(DEFAULT_PREGAME_CONFIG);
    this.persist();
  }
}

