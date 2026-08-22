/**
 * Recall — the one ability every champion has and no champion picks.
 *
 * The four things that are invisible from the file: it goes to *its own*
 * team's platform, being hit stops it, walking stops it, and the bot brain
 * never mistakes it for a combat spell.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined, placeholder: () => undefined },
}));

import Champion from '../../src/game/gameObject/attackableUnits/Champion';
import Fountain from '../../src/game/gameObject/structures/Fountain';
import { SpellRole, rolesOf } from '../../src/game/ai/SpellRole';
import type AttackableUnit from '../../src/game/gameObject/attackableUnits/AttackableUnit';
import type { CastContext } from '../../src/game/spell/runtime/types';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../game/fixtures';
import { installSketchMathGlobals, installSpellObjectGlobals } from '../game/spell/fixtures';
import { buildContentApi } from '../../src/content/ContentApi';
import { RECALL_CHANNEL_MS } from '../../src/game/gameObject/coreSpells/Recall';
import makeRecall from '../../src/game/gameObject/coreSpells/Recall';
const __api = buildContentApi();
const Recall = makeRecall(__api);

const BLUE_BASE = { x: 400, y: 400 };
const RED_BASE = { x: 3_000, y: 3_000 };

let game: TestGame;
let playerSet = false;

beforeEach(() => {
  stubGameGlobals();
  installSpellObjectGlobals();
  installSketchMathGlobals();
  game = createGame();
  playerSet = false;

  // Both platforms, in the order `Game.spawnFountains` builds them: blue first.
  // A recall that reached for `fountains[0]` would land every champion on blue
  // and still pass a test that only asked "did it move".
  const fountains = [
    new Fountain({
      game,
      preset: { name: 'blue', x: BLUE_BASE.x, y: BLUE_BASE.y, r: 200, teamId: 'blue' },
    }),
    new Fountain({
      game,
      preset: { name: 'red', x: RED_BASE.x, y: RED_BASE.y, r: 200, teamId: 'red' },
    }),
  ];
  (game as unknown as { fountains: Fountain[] }).fountains = fountains;
});

afterEach(() => vi.unstubAllGlobals());

const unit = (teamId: string, x: number, y = 0): Champion => {
  const champion = new Champion({ game, teamId });
  // No longer built by the class itself — `Champion.recall` is nullable now
  // that a map without a fountain can leave it unset. This is the same
  // one-line attachment `preset.ts`'s `attachRecall` does for a real match.
  champion.recall = new Recall(champion);
  champion.position.set(x, y);
  champion.destination.set(x, y);
  if (!playerSet) {
    game.setPlayer(champion);
    playerSet = true;
  }
  return champion;
};

const context = (caster: AttackableUnit): CastContext =>
  Object.freeze({
    spellId: 'test',
    activationId: 'test',
    startedAtMs: 0,
    caster,
    origin: { x: caster.position.x, y: caster.position.y },
    cursorWorld: { x: caster.position.x, y: caster.position.y },
    direction: { x: 1, y: 0 },
  });

/** Runs the world's clock forward for one object, `deltaTime` at a time. */
const advance = (object: { update(): void }, ms: number): void => {
  for (let elapsed = 0; elapsed < ms; elapsed += 16) object.update();
};

describe('Recall — going home', () => {
  it('puts a blue champion on the blue platform when the channel finishes', () => {
    const champion = unit('blue', 1_500, 1_500);
    indexObjects(game, [champion]);

    expect(champion.recall.press(context(champion))).toBe(true);
    advance(champion.recall, RECALL_CHANNEL_MS + 64);

    expect(champion.position.x).toBe(BLUE_BASE.x);
    expect(champion.position.y).toBe(BLUE_BASE.y);
  });

  it('puts a red champion on the red platform, not on the other base', () => {
    const blue = unit('blue', 0);
    const red = unit('red', 1_500, 1_500);
    indexObjects(game, [blue, red]);

    expect(red.recall.press(context(red))).toBe(true);
    advance(red.recall, RECALL_CHANNEL_MS + 64);

    expect(red.position.x).toBe(RED_BASE.x);
    expect(red.position.y).toBe(RED_BASE.y);
  });

  it('is cancelled by damage, and the champion stays where it was hit', () => {
    const champion = unit('blue', 1_500, 1_500);
    const enemy = unit('red', 1_560, 1_500);
    indexObjects(game, [champion, enemy]);

    expect(champion.recall.press(context(champion))).toBe(true);
    advance(champion.recall, RECALL_CHANNEL_MS / 2);

    champion.takeDamage(10, enemy);
    champion.recall.update();
    expect(champion.recall.state).not.toBe('CHANNELING');

    // The rest of the channel must not still be running underneath.
    advance(champion.recall, RECALL_CHANNEL_MS + 64);
    expect(champion.position.x).toBe(1_500);
    expect(champion.position.y).toBe(1_500);
  });

  it('is cancelled by a move order — the reason `interrupts` stays HELD', () => {
    const champion = unit('blue', 1_500, 1_500);
    indexObjects(game, [champion]);

    expect(champion.recall.press(context(champion))).toBe(true);
    advance(champion.recall, RECALL_CHANNEL_MS / 2);

    champion.orderMove(1_800, 1_500);
    champion.recall.update();
    expect(champion.recall.state).not.toBe('CHANNELING');

    advance(champion.recall, RECALL_CHANNEL_MS + 64);
    expect(champion.position.x).toBe(1_500);
    expect(champion.position.y).toBe(1_500);
  });

  it('does nothing at all when its team has no platform', () => {
    const champion = unit('ffa-uuid', 1_500, 1_500);
    indexObjects(game, [champion]);

    expect(champion.recall.press(context(champion))).toBe(true);
    advance(champion.recall, RECALL_CHANNEL_MS + 64);

    expect(champion.position.x).toBe(1_500);
    expect(champion.position.y).toBe(1_500);
  });

  it('carries no combat role, so the bot brain can never score it', () => {
    const champion = unit('blue', 0);
    expect(champion.recall).toBeInstanceOf(Recall);
    // Without `static aiRoles`, `inferRoles` reads a free SELF spell as `Buff`.
    expect(rolesOf(champion.recall, 0)).toBe(SpellRole.None);
  });

  it('is not one of the kit slots the loadout editor indexes', () => {
    const champion = unit('blue', 0);
    expect(champion.spells).not.toContain(champion.recall);
  });
});
