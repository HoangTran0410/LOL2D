import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MatchDirector from '../../../src/game/MatchDirector';
import MatchDirectorSource, {
  type MatchDirectorHost,
} from '../../../src/game/hud/config/MatchDirectorSource';
import PregameConfigSource from '../../../src/game/hud/config/PregameConfigSource';
import type { MatchConfigSource } from '../../../src/game/hud/config/MatchConfigSource';
import {
  AI_COUNT_MAX,
  DEFAULT_MAP_ID,
  DEFAULT_PREGAME_CONFIG,
  loadPregameConfig,
  savePregameConfig,
} from '../../../src/game/config/PregameConfig';
import { MatchTeam } from '../../../src/game/config/MatchTeams';
import { context as practiceContext } from '../practice/helpers';
import { packIsInstalled } from '../../support/installedPacks';

/**
 * **The test that makes one panel possible.**
 *
 * The whole point of `MatchConfigSource` is that the match-config panel is one
 * component with two backends — the stored config on the menu, the running
 * match in game — and that the two can never again diverge into "the setup
 * screen alone can pick an input mode, the practice panel alone can assign
 * sides". Every assertion below runs against **both**, so a control that only
 * one source can serve fails here before it can ship.
 *
 * It asserts behaviour through the seam only. Where the two genuinely differ —
 * a row's `title` is the live champion in a match and the *loadout* outside one
 * — the difference is stated as a per-source expectation rather than skipped,
 * because that difference is a rule and rules are what a contract is for.
 */

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

/**
 * The suite runs on `environment: 'node'` like the rest of this repo (there is
 * no jsdom), so the browser globals the device settings genuinely read have to
 * be stubbed rather than assumed: `PregameConfig` reads a bare `localStorage`,
 * `touchPreferences` and `renderPreferences` read `window.localStorage`, and
 * the input-mode row toggles `body.touch-ui`. One storage object behind all
 * three, so a write through any path is visible to the others.
 */
const stubBrowser = (storage: MemoryStorage): void => {
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', { localStorage: storage, location: { search: '' } });
  vi.stubGlobal('document', { body: { classList: { toggle: () => {} } } });
};

/** The shape `loadChampionPresetFromLoadout` resolves to, as far as the director cares. */
const presetFor = (loadout: { championName: string }) => ({
  name: loadout.championName === 'random' ? 'Ngẫu Nhiên' : loadout.championName,
  spells: [],
});

/** A camera, render settings and an exit, with no `Game` behind them. */
const fakeHost = (director: MatchDirector): MatchDirectorHost => {
  let zoom = 1;
  let quality: MatchDirectorHost['renderQuality'] = 'auto';
  let fps: MatchDirectorHost['renderFps'] = 60;
  return {
    director,
    camera: {
      get zoomFactor() {
        return zoom;
      },
      setZoomFactor(factor: number) {
        zoom = factor;
      },
      snapToScale() {},
    },
    touchUi: false,
    // Fixed, on purpose — this is the bench's stand-in for "the map this
    // match actually booted onto", which a real `Game` never changes for the
    // life of the match. `setMap` must never move it; that is exactly what
    // the 'map' suite below asserts.
    activeMapId: DEFAULT_MAP_ID,
    get renderQuality() {
      return quality;
    },
    get renderFps() {
      return fps;
    },
    setRenderQuality(next) {
      quality = next;
    },
    setRenderFps(next) {
      fps = next;
    },
    setTouchUiEnabled() {},
    requestExit() {},
  };
};

interface Bench {
  source: MatchConfigSource;
}

/**
 * No `ObjectManager.update()` anywhere below, deliberately. The panel holds the
 * match paused, so a tick is exactly what does *not* happen while these calls
 * run — and `MatchDirector.bots()` is built for that: it counts `_objectToBeAdd`
 * and skips `toRemove`, so an added or removed bot is on the roster
 * immediately. Ticking here would also run the AI on bots whose stub preset has
 * no spells, failing on a fixture detail rather than on the seam.
 */

const makePregame = async (): Promise<Bench> => {
  savePregameConfig({ ...DEFAULT_PREGAME_CONFIG, ai: { ...DEFAULT_PREGAME_CONFIG.ai, count: 1 } });
  return { source: new PregameConfigSource() };
};

const makeDirector = async (): Promise<Bench> => {
  savePregameConfig({ ...DEFAULT_PREGAME_CONFIG, ai: { ...DEFAULT_PREGAME_CONFIG.ai, count: 0 } });
  const { context } = practiceContext();
  // A stub loader: the contract is about the seam, not about what a kit
  // resolves to, and the real one reaches for the spell catalogue.
  const director = new MatchDirector(context, {
    loadPreset: async loadout => presetFor(loadout),
  });
  const source = new MatchDirectorSource(fakeHost(director));
  await source.addBot(MatchTeam.BLUE);
  return { source };
};

const SOURCES: [string, () => Promise<Bench>][] = [
  ['PregameConfigSource', makePregame],
  ['MatchDirectorSource', makeDirector],
];

describe.each(SOURCES)('MatchConfigSource contract — %s', (name, make) => {
  const isPregame = name === 'PregameConfigSource';
  let source: MatchConfigSource;

  beforeEach(async () => {
    stubBrowser(new MemoryStorage());
    source = (await make()).source;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('roster', () => {
    it('puts the player first, labelled Bạn, with the bots numbered after it', () => {
      const roster = source.roster();
      expect(roster[0].isPlayer).toBe(true);
      expect(roster[0].label).toBe('Bạn');
      expect(roster[1].isPlayer).toBe(false);
      expect(roster[1].label).toBe('Bot 1');
    });

    it('gives every row four ability slots, Q W E R', () => {
      for (const row of source.roster()) {
        expect(row.abilities.map(ability => ability.letter)).toEqual(['Q', 'W', 'E', 'R']);
      }
    });

    it('gives a bot a behaviour and the player none', () => {
      const roster = source.roster();
      expect(roster[0].behaviour).toBeUndefined();
      expect(roster[1].behaviour).toEqual({
        autoMove: expect.any(Boolean),
        autoAttack: expect.any(Boolean),
        autoCast: expect.any(Boolean),
        difficulty: expect.any(String),
      });
    });

    it('reports the bot count and whether another fits', () => {
      expect(source.botCount()).toBe(1);
      expect(source.canAddBot()).toBe(true);
    });

    it('adds a bot', async () => {
      await source.addBot(MatchTeam.BLUE);
      expect(source.botCount()).toBe(2);
      expect(source.roster()).toHaveLength(3);
    });

    it('removes a bot by id and persists the smaller roster', async () => {
      const id = source.roster()[1].id;
      source.removeBot(id);
      expect(source.botCount()).toBe(0);
      expect(loadPregameConfig().ai.count).toBe(0);
    });

    it('refuses to add past the cap', async () => {
      while (source.canAddBot()) {
        await source.addBot(MatchTeam.BLUE);
      }
      expect(source.botCount()).toBe(AI_COUNT_MAX);
      await source.addBot(MatchTeam.BLUE);
      expect(source.botCount()).toBe(AI_COUNT_MAX);
    });
  });

  describe('sides', () => {
    it('moves the player to the other side and persists it', () => {
      const id = source.roster()[0].id;
      source.setTeam(id, MatchTeam.RED);
      expect(source.roster()[0].team).toBe(MatchTeam.RED);
      expect(loadPregameConfig().playerTeam).toBe(MatchTeam.RED);
    });

    it('adds a bot to the side it was asked for', async () => {
      await source.addBot(MatchTeam.RED);
      const added = source.roster()[source.roster().length - 1];
      expect(added.team).toBe(MatchTeam.RED);

      await source.addBot(MatchTeam.BLUE);
      const next = source.roster()[source.roster().length - 1];
      expect(next.team).toBe(MatchTeam.BLUE);
    });

    it('moves a bot and persists it', () => {
      const row = source.roster()[1];
      const other = row.team === MatchTeam.BLUE ? MatchTeam.RED : MatchTeam.BLUE;
      source.setTeam(row.id, other);
      expect(source.roster()[1].team).toBe(other);
      expect(loadPregameConfig().ai.botTeams[0]).toBe(other);
    });
  });

  describe('per-bot behaviour', () => {
    it('sets one flag without disturbing the others, and persists it', () => {
      const id = source.roster()[1].id;
      source.setBotBehaviour(id, { autoCast: false });

      const behaviour = source.roster()[1].behaviour!;
      expect(behaviour.autoCast).toBe(false);
      expect(behaviour.autoMove).toBe(true);
      expect(loadPregameConfig().ai.botBehaviours[0].autoCast).toBe(false);
      expect(loadPregameConfig().ai.botBehaviours[0].autoMove).toBe(true);
    });

    /**
     * The tier travels inside `BotBehaviour` rather than beside it, which is
     * what makes it one control on the same row and one setter for all four
     * fields. A row that carried the flags but not the tier would be the exact
     * shape of divergence this suite exists to catch.
     */
    it('carries the bot’s difficulty on the row, normal until it is set', () => {
      expect(source.roster()[1].behaviour!.difficulty).toBe('normal');
    });

    it('sets the difficulty without disturbing the flags, and persists it', () => {
      const id = source.roster()[1].id;
      source.setBotBehaviour(id, { difficulty: 'hard' });

      const behaviour = source.roster()[1].behaviour!;
      expect(behaviour.difficulty).toBe('hard');
      expect(behaviour.autoMove).toBe(true);
      expect(behaviour.autoAttack).toBe(true);
      expect(behaviour.autoCast).toBe(true);
      expect(loadPregameConfig().ai.botBehaviours[0].difficulty).toBe('hard');
    });

    it('leaves the difficulty alone when only a flag is sent', () => {
      const id = source.roster()[1].id;
      source.setBotBehaviour(id, { difficulty: 'easy' });
      source.setBotBehaviour(id, { autoMove: false });

      expect(source.roster()[1].behaviour!.difficulty).toBe('easy');
      expect(loadPregameConfig().ai.botBehaviours[0].difficulty).toBe('easy');
    });

    it('ignores a behaviour set on the player', () => {
      const id = source.roster()[0].id;
      expect(() => source.setBotBehaviour(id, { autoCast: false })).not.toThrow();
      expect(source.roster()[0].behaviour).toBeUndefined();
    });
  });

  describe('loadouts', () => {
    it('reads back the loadout it was given, and persists it', async () => {
      const id = source.roster()[0].id;
      await source.applyLoadout(id, {
        ...DEFAULT_PREGAME_CONFIG.player,
        mode: 'champion',
        championName: 'Ahri',
      });
      expect(source.loadoutOf(id).championName).toBe('Ahri');
      expect(loadPregameConfig().player.championName).toBe('Ahri');
    });
  });

  describe('rules', () => {
    it('applies and persists a rules change', () => {
      source.setRules({ cooldownReductionPercent: 40, manaFree: true }, true);
      expect(source.getRules()).toEqual({ cooldownReductionPercent: 40, manaFree: true });
      expect(loadPregameConfig().rules.cooldownReductionPercent).toBe(40);
      expect(source.matchRules.cooldownMultiplier).toBeCloseTo(0.6);
      expect(source.matchRules.manaFree).toBe(true);
    });

    it('clamps out-of-range CDR the same way in both sources', () => {
      source.setRules({ cooldownReductionPercent: 999, manaFree: false }, true);
      expect(source.getRules().cooldownReductionPercent).toBe(90);
    });

    it('does not write storage mid-drag', () => {
      source.setRules({ cooldownReductionPercent: 10, manaFree: false }, true);
      const before = localStorage.getItem('lol2d:pregameConfig:v1');
      source.setRules({ cooldownReductionPercent: 70, manaFree: false }, false);
      expect(localStorage.getItem('lol2d:pregameConfig:v1')).toBe(before);
      // …but the label still reads the value being dragged.
      expect(source.getRules().cooldownReductionPercent).toBe(70);
    });
  });

  describe('world', () => {
    it('switches the jungle and the minions independently, and persists both', () => {
      source.setWorld({ jungle: false });
      expect(source.getWorld()).toEqual({ jungle: false, minions: true });
      expect(loadPregameConfig().world.jungle).toBe(false);

      source.setWorld({ minions: false });
      expect(source.getWorld()).toEqual({ jungle: false, minions: false });
      expect(loadPregameConfig().world.minions).toBe(false);
    });
  });

  /**
   * Task 10 of the content-pack extraction. `getMap`/`setMap` genuinely
   * differ by source — see `MatchConfigSource.getMap`'s own doc comment —
   * and that difference is asserted here rather than skipped, the same way
   * `roster()[].title` is: `PregameConfigSource` reports back whatever was
   * last chosen, because outside a match a choice and a setting are the same
   * fact; `MatchDirectorSource` keeps reporting the map the match actually
   * booted onto no matter what is picked, because nothing in this seam
   * rebuilds a live terrain map or nav grid — the only way to actually play
   * a different one is to leave this match and start a new one.
   */
  describe('map', () => {
    it('lists every installed map, by qualified id', () => {
      const maps = source.availableMaps();
      const ids = maps.map(map => map.id);
      // The reference pack's map is core's own and is always here; Summoner's
      // Rift belongs to the riot pack and is not. Asserting `>= 2` and naming
      // both was a literal about which packs a checkout has —
      // content-pack-extraction batch 5 task 8's drill scored it `expected 1
      // to be greater than or equal to 2` with the riot pack moved out of the
      // tree, which is the correct answer to the wrong question. What this
      // test is actually about is that ids come back *qualified*, which is
      // batch 2's last bug (a picker that stored the bare local id and then
      // rerolled to something random at match start).
      expect(ids).toContain('reference:proving-grounds');
      if (packIsInstalled('riot')) expect(ids).toContain('riot:summoners-rift');
      expect(ids.length).toBe(packIsInstalled('riot') ? 2 : 1);
      for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*:.+$/);
    });

    it('reads a qualified id', () => {
      expect(source.getMap()).toBe(DEFAULT_MAP_ID);
    });

    it('persists a different choice through storage, as the qualified id', () => {
      const other = source.availableMaps().find(map => map.id !== source.getMap())!;
      source.setMap(other.id);
      expect(loadPregameConfig().mapId).toBe(other.id);
    });

    it(
      isPregame
        ? 'reports the newly chosen map immediately — there is no running world to disagree with it'
        : 'keeps reporting the running match’s own map — a live world cannot be swapped from under it',
      () => {
        const before = source.getMap();
        const other = source.availableMaps().find(map => map.id !== before)!;

        source.setMap(other.id);

        if (isPregame) {
          expect(source.getMap()).toBe(other.id);
        } else {
          expect(source.getMap()).toBe(before);
          // The choice still lands in storage — it is what the *next* match
          // boots onto — even though this running one does not move.
          expect(loadPregameConfig().mapId).toBe(other.id);
        }
      }
    );
  });

  describe('cheats', () => {
    it('makes one participant invulnerable, on the row and in storage', () => {
      const id = source.roster()[1].id;
      source.setInvulnerable(id, true);

      expect(source.roster()[1].invulnerable).toBe(true);
      expect(source.roster()[0].invulnerable).toBe(false);
      expect(loadPregameConfig().cheats.botInvulnerable[0]).toBe(true);
      expect(loadPregameConfig().cheats.playerInvulnerable).toBe(false);
    });

    it('switches invulnerability back off', () => {
      const id = source.roster()[0].id;
      source.setInvulnerable(id, true);
      source.setInvulnerable(id, false);
      expect(source.roster()[0].invulnerable).toBe(false);
      expect(loadPregameConfig().cheats.playerInvulnerable).toBe(false);
    });

    it('reveals the map and persists it', () => {
      source.setCheats({ revealMap: true });
      expect(source.getCheats().revealMap).toBe(true);
      expect(loadPregameConfig().cheats.revealMap).toBe(true);
    });

    it('lights a debug layer and persists it', () => {
      source.setCheats({ debug: { ...source.getCheats().debug, quadtree: true } });
      expect(source.getCheats().debug.quadtree).toBe(true);
      expect(source.getCheats().debug.vision).toBe(false);
      expect(loadPregameConfig().cheats.debug.quadtree).toBe(true);
    });

    it('toggles the FPS overlay like any other debug layer, and persists it', () => {
      source.setCheats({ debug: { ...source.getCheats().debug, fps: true } });
      expect(source.getCheats().debug.fps).toBe(true);
      expect(source.getCheats().debug.terrain).toBe(false);
      expect(loadPregameConfig().cheats.debug.fps).toBe(true);
    });
  });

  describe('device settings', () => {
    it('stores an input mode choice and reports the resolved layout separately', () => {
      source.setInputMode('touch');
      expect(source.inputMode).toBe('touch');
      expect(typeof source.touchUi).toBe('boolean');

      source.setInputMode('auto');
      expect(source.inputMode).toBe('auto');
    });

    it('stores render quality and the FPS cap', () => {
      source.setRenderQuality('low');
      source.setRenderFps(30);
      expect(source.renderQuality).toBe('low');
      expect(source.renderFps).toBe(30);
    });
  });

  describe('live controls', () => {
    it('offers them only when a match is running', () => {
      expect(source.live === null).toBe(isPregame);
    });
  });

  describe('reset', () => {
    it('puts the config back to the defaults', async () => {
      source.setRules({ cooldownReductionPercent: 50, manaFree: true }, true);
      source.setTeam(source.roster()[0].id, MatchTeam.RED);
      source.setInvulnerable(source.roster()[0].id, true);

      await source.resetToDefaults();

      expect(source.getRules()).toEqual(DEFAULT_PREGAME_CONFIG.rules);
      expect(source.roster()[0].team).toBe(DEFAULT_PREGAME_CONFIG.playerTeam);
      expect(source.roster()[0].invulnerable).toBe(false);
      expect(loadPregameConfig().rules).toEqual(DEFAULT_PREGAME_CONFIG.rules);
      expect(loadPregameConfig().cheats.playerInvulnerable).toBe(false);
    });

    it('puts the stored map choice back to the default too', async () => {
      const other = source.availableMaps().find(map => map.id !== DEFAULT_MAP_ID)!;
      source.setMap(other.id);
      expect(loadPregameConfig().mapId).toBe(other.id);

      await source.resetToDefaults();

      expect(loadPregameConfig().mapId).toBe(DEFAULT_MAP_ID);
    });
  });
});
