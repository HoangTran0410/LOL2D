/**
 * Malzahar's kit, at the four places a wrong answer would still look right on
 * screen: what the void band actually catches, that the swarm arrives as real
 * bodies rather than effects, that a host dying pays out and passes the rot on,
 * and that the Null Zone outlives the channel that opened it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined, placeholder: () => undefined },
}));

import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import Silence from '../../../src/game/gameObject/buffs/Silence';
import Stun from '../../../src/game/gameObject/buffs/Stun';
import Malzahar_Q, {
  DAMAGE as VOID_DAMAGE,
  DELAY_MS as VOID_DELAY_MS,
  Malzahar_Q_Object,
  PORTAL_GAP,
} from '../../../src/game/gameObject/spells/Malzahar_Q';
import Malzahar_W, {
  Malzahar_W_Rift,
  Malzahar_W_Voidling,
  SPAWN_DELAY_MS,
  SPAWN_STAGGER_MS,
  VOIDLING_COUNT,
  VOIDLING_HEALTH,
} from '../../../src/game/gameObject/spells/Malzahar_W';
import Malzahar_E, {
  MANA_ON_KILL,
  Malzahar_E_Object,
  VISIONS_STACK_ID,
} from '../../../src/game/gameObject/spells/Malzahar_E';
import Malzahar_R, {
  CHANNEL_DURATION_MS,
  Malzahar_R_Zone,
  ZONE_DAMAGE_PER_TICK,
  ZONE_TICK_MS,
} from '../../../src/game/gameObject/spells/Malzahar_R';
import type AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import type GameObject from '../../../src/game/gameObject/GameObject';
import type { CastContext } from '../../../src/game/spell/runtime/types';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';
import { installSketchMathGlobals, installSpellObjectGlobals } from '../spell/fixtures';

let game: TestGame;
let playerSet = false;

beforeEach(() => {
  stubGameGlobals();
  // The richer TestVector (limit/sub/fromAngle) and the maths helpers the real
  // spell code reaches for; these must land after stubGameGlobals to win.
  installSpellObjectGlobals();
  installSketchMathGlobals();
  game = createGame();
  playerSet = false;
});
afterEach(() => vi.unstubAllGlobals());

const unit = (teamId: string, x: number, y = 0): Champion => {
  const champion = new Champion({ game, teamId });
  champion.position.set(x, y);
  champion.destination.set(x, y);
  champion.stats.mana.baseValue = 500;
  // `isAllied` — which the display box reads — asks the game who the player is.
  if (!playerSet) {
    game.setPlayer(champion);
    playerSet = true;
  }
  return champion;
};

const context = (
  caster: AttackableUnit,
  cursorX = 0,
  cursorY = 0,
  target?: AttackableUnit
): CastContext =>
  Object.freeze({
    spellId: 'test',
    activationId: 'test',
    startedAtMs: 0,
    caster,
    origin: { x: caster.position.x, y: caster.position.y },
    cursorWorld: { x: cursorX, y: cursorY },
    direction: { x: 1, y: 0 },
    target,
  });

const advance = (object: { update(): void }, ms: number): void => {
  for (let elapsed = 0; elapsed < ms; elapsed += 16) object.update();
};

const spawned = (): GameObject[] => [
  ...game.objectManager.objects,
  ...game.objectManager._objectToBeAdd,
];

const find = <T>(is: (object: unknown) => object is T): T => spawned().find(is)!;

describe('Malzahar Q — Call of the Void', () => {
  it('catches what stands between the portals and leaves what does not', () => {
    const malzahar = unit('malzahar', 0);
    // The band opens across the cast line, so this one is standing in it...
    const between = unit('creep', 200, 60);
    // ...and this one is level with the aim point but a whole gap to the side.
    const beside = unit('creep', 200 + PORTAL_GAP, 0);
    indexObjects(game, [malzahar, between, beside]);
    const spell = new Malzahar_Q(malzahar);

    const betweenBefore = between.stats.health.value;
    const besideBefore = beside.stats.health.value;

    expect(spell.press(context(malzahar, 200, 0))).toBe(true);
    const rift = find((o): o is Malzahar_Q_Object => o instanceof Malzahar_Q_Object);

    // Nothing happens on the cast itself: the delay is the whole telegraph.
    advance(rift, VOID_DELAY_MS - 32);
    expect(between.stats.health.value).toBe(betweenBefore);

    advance(rift, 64);

    expect(betweenBefore - between.stats.health.value).toBe(VOID_DAMAGE);
    expect(between.hasBuff(Silence)).toBe(true);
    expect(beside.stats.health.value).toBe(besideBefore);
    expect(beside.hasBuff(Silence)).toBe(false);
  });
});

describe('Malzahar W — Void Swarm', () => {
  it('hatches real bodies out of the rift, and none of them is a takedown', () => {
    const malzahar = unit('malzahar', 0);
    indexObjects(game, [malzahar]);
    const spell = new Malzahar_W(malzahar);

    expect(spell.press(context(malzahar, 180))).toBe(true);
    const rift = find((o): o is Malzahar_W_Rift => o instanceof Malzahar_W_Rift);

    // The rift has to tear open first — nothing climbs out on frame one.
    advance(rift, SPAWN_DELAY_MS - 32);
    expect(spawned().filter(o => o instanceof Malzahar_W_Voidling)).toHaveLength(0);

    advance(rift, VOIDLING_COUNT * SPAWN_STAGGER_MS + 64);
    const swarm = spawned().filter(
      (o): o is Malzahar_W_Voidling => o instanceof Malzahar_W_Voidling
    );
    expect(swarm).toHaveLength(VOIDLING_COUNT);
    for (const voidling of swarm) {
      expect(voidling.stats.health.value).toBe(VOIDLING_HEALTH);
      // `Pet extends Champion`, so without this every voidling killed would
      // land on somebody's KDA.
      expect(voidling.killCredit).toBe('none');
    }
  });
});

describe('Malzahar E — Malefic Visions', () => {
  it('pays Malzahar and jumps to the nearest clean head when its host dies', () => {
    const malzahar = unit('malzahar', 0);
    const host = unit('creep', 200);
    const neighbour = unit('creep', 260);
    indexObjects(game, [malzahar, host, neighbour]);
    malzahar.stats.maxMana.baseValue = 500;
    const spell = new Malzahar_E(malzahar);

    expect(spell.press(context(malzahar, 200, 0, host))).toBe(true);
    const watcher = find((o): o is Malzahar_E_Object => o instanceof Malzahar_E_Object);
    expect(host.buffs.some(buff => buff.stackId === VISIONS_STACK_ID)).toBe(true);

    const manaBefore = malzahar.stats.mana.value;
    host.takeDamage(9_999, malzahar);
    expect(host.isDead).toBe(true);

    watcher.update();

    expect(malzahar.stats.mana.value - manaBefore).toBe(MANA_ON_KILL);
    expect(neighbour.buffs.some(buff => buff.stackId === VISIONS_STACK_ID)).toBe(true);
  });
});

describe('Malzahar R — Nether Grasp', () => {
  it('pins the victim for the channel and leaves a zone that outlives it', () => {
    const malzahar = unit('malzahar', 0);
    const victim = unit('creep', 200);
    indexObjects(game, [malzahar, victim]);
    const spell = new Malzahar_R(malzahar);

    expect(spell.press(context(malzahar, 200, 0, victim))).toBe(true);

    const pin = victim.buffs.find((buff): buff is Stun => buff instanceof Stun)!;
    expect(pin.duration).toBe(CHANNEL_DURATION_MS);

    const zone = find((o): o is Malzahar_R_Zone => o instanceof Malzahar_R_Zone);

    // The channel ends — killed, stunned, whatever — and the hole stays open.
    spell.onCancel();
    const before = victim.stats.health.value;
    advance(zone, ZONE_TICK_MS + 32);
    expect(before - victim.stats.health.value).toBe(ZONE_DAMAGE_PER_TICK);
  });
});
