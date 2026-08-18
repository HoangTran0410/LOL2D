import { afterEach, describe, expect, it, vi } from 'vitest';
import MatchDirector from '../../../src/game/MatchDirector';
import {
  DEFAULT_CHAMPION_LOADOUT,
  DEFAULT_PREGAME_CONFIG,
  type ChampionLoadout,
} from '../../../src/game/config/PregameConfig';
import type { ChampionPresetData } from '../../../src/game/gameObject/attackableUnits/Champion';
import { context } from './helpers';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
};

const loadoutNamed = (championName: string): ChampionLoadout => ({
  ...DEFAULT_CHAMPION_LOADOUT,
  championName,
});

const presetNamed = (name: string): ChampionPresetData => ({ name, spells: [] });

afterEach(() => vi.unstubAllGlobals());

describe('MatchDirector async mutation ordering', () => {
  it('shares one in-flight add across panel remounts and only creates one bot', async () => {
    const { context: ctx } = context();
    const gate = deferred<ChampionPresetData>();
    const loadPreset = vi.fn(() => gate.promise);
    const director = new MatchDirector(ctx, { loadPreset });

    const first = director.addBotLoaded(loadoutNamed('Ahri'));
    const remounted = director.addBotLoaded(loadoutNamed('Ahri'));

    expect(remounted).toBe(first);
    expect(loadPreset).toHaveBeenCalledTimes(1);

    gate.resolve(presetNamed('Ahri'));
    const [firstBot, remountedBot] = await Promise.all([first, remounted]);

    expect(remountedBot).toBe(firstBot);
    expect(director.bots()).toHaveLength(1);
  });

  it('lets the newest apply win even when the older load finishes last', async () => {
    const { context: ctx, player } = context();
    const ahri = deferred<ChampionPresetData>();
    const zed = deferred<ChampionPresetData>();
    const loadPreset = vi.fn((loadout: ChampionLoadout) =>
      loadout.championName === 'Ahri' ? ahri.promise : zed.promise
    );
    const director = new MatchDirector(ctx, { loadPreset });

    const older = director.applyLoadoutLoaded(player, loadoutNamed('Ahri'));
    const newer = director.applyLoadoutLoaded(player, loadoutNamed('Zed'));

    zed.resolve(presetNamed('Zed'));
    expect(await newer).toBe(true);
    ahri.resolve(presetNamed('Ahri'));
    expect(await older).toBe(false);

    expect(player.name).toBe('Zed');
    expect(director.loadoutOf(player).championName).toBe('Zed');
  });

  it('preloads every default kit before committing an awaited reset', async () => {
    const { context: ctx, player } = context();
    const gates: Deferred<ChampionPresetData>[] = [];
    const loadPreset = vi.fn(() => {
      const gate = deferred<ChampionPresetData>();
      gates.push(gate);
      return gate.promise;
    });
    const director = new MatchDirector(ctx, { loadPreset });

    const resetting = director.resetToDefaults();

    expect(loadPreset).toHaveBeenCalledTimes(1 + DEFAULT_PREGAME_CONFIG.ai.count);
    expect(director.bots()).toHaveLength(0);
    expect(player.name).toBeUndefined();

    gates.forEach((gate, index) => gate.resolve(presetNamed(`Default${index}`)));
    expect(await resetting).toBe(true);

    expect(player.name).toBe('Default0');
    expect(director.bots()).toHaveLength(DEFAULT_PREGAME_CONFIG.ai.count);
    expect(director.bots().map(bot => bot.teamId)).toEqual(
      DEFAULT_PREGAME_CONFIG.ai.botTeams.slice(0, DEFAULT_PREGAME_CONFIG.ai.count)
    );
  });

  it('invalidates pending add and apply work when reset commits', async () => {
    const { context: ctx, player } = context();
    const addGate = deferred<ChampionPresetData>();
    const applyGate = deferred<ChampionPresetData>();
    const loadPreset = vi.fn((loadout: ChampionLoadout) => {
      if (loadout.championName === 'Ahri') return addGate.promise;
      if (loadout.championName === 'Zed') return applyGate.promise;
      return Promise.resolve(presetNamed('Default'));
    });
    const director = new MatchDirector(ctx, { loadPreset });

    const pendingAdd = director.addBotLoaded(loadoutNamed('Ahri'));
    const pendingApply = director.applyLoadoutLoaded(player, loadoutNamed('Zed'));
    expect(await director.resetToDefaults()).toBe(true);

    addGate.resolve(presetNamed('Ahri'));
    applyGate.resolve(presetNamed('Zed'));

    expect(await pendingAdd).toBeNull();
    expect(await pendingApply).toBe(false);
    expect(player.name).toBe('Default');
    expect(director.loadoutOf(player)).toEqual(DEFAULT_PREGAME_CONFIG.player);
    expect(director.bots()).toHaveLength(DEFAULT_PREGAME_CONFIG.ai.count);
  });

  it('lets a newer reset win when an older reset resolves afterwards', async () => {
    const { context: ctx, player } = context();
    const gates: Deferred<ChampionPresetData>[] = [];
    const loadPreset = vi.fn(() => {
      const gate = deferred<ChampionPresetData>();
      gates.push(gate);
      return gate.promise;
    });
    const director = new MatchDirector(ctx, { loadPreset });

    const older = director.resetToDefaults();
    const newer = director.resetToDefaults();
    const groupSize = 1 + DEFAULT_PREGAME_CONFIG.ai.count;

    gates.slice(groupSize).forEach(gate => gate.resolve(presetNamed('Newest')));
    expect(await newer).toBe(true);
    gates.slice(0, groupSize).forEach(gate => gate.resolve(presetNamed('Stale')));
    expect(await older).toBe(false);

    expect(player.name).toBe('Newest');
    expect(director.bots()).toHaveLength(DEFAULT_PREGAME_CONFIG.ai.count);
  });
});
