import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: vi.fn(() => undefined), getAsset: vi.fn(() => undefined) },
}));
import Shield from '../../../src/game/gameObject/buffs/Shield';
import StatAmp from '../../../src/game/gameObject/buffs/StatAmp';
import Buff from '../../../src/game/gameObject/Buff';
import type { CastContext } from '../../../src/game/spell/runtime/types';
import {
  createGame,
  createUnit,
  installSpellObjectGlobals,
  type TestGame,
} from '../spell/fixtures';
import { buildContentApi } from '../../../src/content/ContentApi';
import { BOUNDING_MARGIN, DURATION_MS, HARD_STOP_MS, PLATE_COUNT, SHIELD_AMOUNT, SIZE_BONUS } from '../../../packs/riot/spells/Malphite_W';
import makeMalphite_W, { makeMalphite_W_Armor } from '../../../packs/riot/spells/Malphite_W';
const __api = buildContentApi();
const Malphite_W = makeMalphite_W(__api);
const Malphite_W_Armor = makeMalphite_W_Armor(__api);

function unit(game: TestGame, x = 0, teamId = 'blue') {
  const result = createUnit(game, x, teamId);
  result.stats.mana.baseValue = 100;
  result.stats.health.baseValue = 100;
  result.stats.maxHealth.baseValue = 100;
  // a champion body, not the AttackableUnit default of 10 — matches how big
  // the effect actually has to read in play
  result.animatedValues.displaySize = 55;
  return result;
}

const castContext = (owner: ReturnType<typeof unit>): CastContext =>
  Object.freeze({
    spellId: 'malphite-w',
    activationId: 'activation',
    startedAtMs: 1,
    caster: owner,
    origin: Object.freeze({ x: owner.position.x, y: owner.position.y }),
    cursorWorld: Object.freeze({ x: owner.position.x + 100, y: owner.position.y }),
    direction: Object.freeze({ x: 1, y: 0 }),
  });

const stubDrawGlobals = () => {
  const spies = {
    image: vi.fn(),
    circle: vi.fn(),
    arc: vi.fn(),
    triangle: vi.fn(),
    beginShape: vi.fn(),
    vertex: vi.fn(),
    endShape: vi.fn(),
  };
  for (const [name, spy] of Object.entries(spies)) vi.stubGlobal(name, spy);
  for (const name of [
    'push',
    'pop',
    'translate',
    'rotate',
    'blendMode',
    'fill',
    'stroke',
    'noFill',
    'noStroke',
    'strokeWeight',
  ]) {
    vi.stubGlobal(name, vi.fn());
  }
  vi.stubGlobal('constrain', (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi));
  vi.stubGlobal('cos', Math.cos);
  vi.stubGlobal('sin', Math.sin);
  vi.stubGlobal('frameCount', 60);
  vi.stubGlobal('HALF_PI', Math.PI / 2);
  for (const name of ['ADD', 'BLEND', 'CLOSE']) vi.stubGlobal(name, name);
  return spies;
};

// runs the object's own update() in fixed steps, mirroring how ObjectManager
// drives it every frame, instead of jumping deltaTime in one big leap
function tick(objects: { update(): void }[], stepMs: number, totalMs: number): void {
  vi.stubGlobal('deltaTime', stepMs);
  for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
    for (const object of objects) object.update();
  }
}

describe('Malphite W', () => {
  beforeEach(() => {
    installSpellObjectGlobals();
    vi.stubGlobal('random', () => 0.5);
    vi.stubGlobal('TWO_PI', Math.PI * 2);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('grants the shield and size buffs and wraps the caster in an armor object watching the exact size-buff instance', () => {
    const game = createGame();
    const owner = unit(game);
    const spell = new Malphite_W(owner);

    expect(spell.press(castContext(owner))).toBe(true);

    expect(owner.buffs).toHaveLength(2);
    const shieldBuff = owner.buffs.find((b): b is Shield => b instanceof Shield);
    const bulkBuff = owner.buffs.find((b): b is StatAmp => b instanceof StatAmp);
    expect(shieldBuff?.amount).toBe(SHIELD_AMOUNT);
    expect(shieldBuff?.duration).toBe(DURATION_MS);
    expect(bulkBuff?.bonuses).toEqual({ size: { baseBonus: SIZE_BONUS } });
    expect(bulkBuff?.duration).toBe(DURATION_MS);

    const armor = game.objectManager._objectToBeAdd.find(
      (o): o is Malphite_W_Armor => o instanceof Malphite_W_Armor
    );
    expect(armor).toBeDefined();
    // attachTo() must have resolved the instance that actually lives in
    // owner.buffs and gets ticked by updateBuffs(), not whatever was handed to
    // addBuff() — those are not always the same object
    expect(armor!._anchorBuff).toBe(bulkBuff);
    expect(armor!.attachmentLost).toBe(false);
  });

  it('draws a procedural ring of plates rather than a blitted icon', () => {
    const draw = stubDrawGlobals();
    const game = createGame();
    const owner = unit(game);
    const armor = new Malphite_W_Armor(owner);
    const buff = new StatAmp(DURATION_MS, owner, owner);
    owner.buffs.push(buff);
    armor.attachTo(owner, buff);
    armor.age = 1_000; // well past the slam window, mid-buff

    armor.draw();

    expect(draw.image).not.toHaveBeenCalled();
    // one plate polygon plus its lit facet triangle, per plate
    expect(draw.beginShape).toHaveBeenCalledTimes(PLATE_COUNT);
    expect(draw.endShape).toHaveBeenCalledTimes(PLATE_COUNT);
    expect(draw.triangle).toHaveBeenCalledTimes(PLATE_COUNT);
    // the glow halo plus the duration ring's background circle
    expect(draw.circle.mock.calls.length).toBeGreaterThanOrEqual(2);
    // the duration ring's progress arc
    expect(draw.arc).toHaveBeenCalledTimes(1);
  });

  it('draw() and update() agree on death: a corpse never keeps its plates painted', () => {
    // Regression guard: draw() used to check only `buff && !buff.toRemove`,
    // while update() also checked `!owner.isDead`. The two masked each other
    // in the common case (death clears buffs synchronously, so buff.toRemove
    // and owner.isDead flip together), but they must still agree on their own
    // terms — a future change to how death clears buffs should not be able to
    // leave a corpse wrapped in stone again. Both now read the one latched
    // `attachmentLost`, which is what makes them unable to drift apart.
    const draw = stubDrawGlobals();
    const game = createGame();
    const owner = unit(game);
    const armor = new Malphite_W_Armor(owner);
    const buff = new StatAmp(DURATION_MS, owner, owner);
    owner.buffs.push(buff);
    armor.attachTo(owner, buff);
    armor.age = 1_000;

    // buff.toRemove is still false here on purpose — this isolates the
    // owner.isDead branch from whatever clears buffs on death
    owner.deathData = { reviveAfter: 5_000 };
    expect(owner.isDead).toBe(true);
    expect(buff.toRemove).toBe(false);

    armor.draw();

    expect(draw.beginShape).not.toHaveBeenCalled();
    expect(draw.arc).not.toHaveBeenCalled();
  });

  it('sizes its display bounding box to cover the full effect so it cannot be culled', () => {
    const game = createGame();
    const owner = unit(game);
    const armor = new Malphite_W_Armor(owner);

    const box = armor.getDisplayBoundingBox();
    const expectedRadius = owner.animatedValues.displaySize / 2 + BOUNDING_MARGIN;

    expect(box).toMatchObject({
      x: owner.position.x - expectedRadius,
      y: owner.position.y - expectedRadius,
      w: expectedRadius * 2,
      h: expectedRadius * 2,
    });

    // and it must actually survive ObjectManager's real camera-bound culling
    // path — the exact bug this test exists to catch, per Anivia R's storm
    game.objectManager.addObject(armor);
    game.objectManager.update();
    const visible = game.objectManager.queryObjects({
      queryByDisplayBoundingBox: true,
      area: game.camera.getBoundingBox(),
    });
    expect(visible).toContain(armor);
  });

  it('disappears shortly after the size buff expires naturally, while the owner is still alive', () => {
    const game = createGame();
    const owner = unit(game);
    const spell = new Malphite_W(owner);
    spell.press(castContext(owner));

    const bulkBuff = owner.buffs.find((b): b is StatAmp => b instanceof StatAmp)!;
    const armor = game.objectManager._objectToBeAdd.find(
      (o): o is Malphite_W_Armor => o instanceof Malphite_W_Armor
    )!;

    // run the buff and the armor together, the way updateBuffs()/ObjectManager
    // actually drive them, for slightly less than the full duration
    tick([bulkBuff, armor], 100, DURATION_MS - 100);
    expect(bulkBuff.toRemove).toBe(false);
    expect(armor.toRemove).toBe(false);

    // cross the duration: Buff.update() deactivates itself once timeElapsed
    // reaches duration, which is what the armor is watching for
    tick([bulkBuff, armor], 100, 200);
    expect(bulkBuff.toRemove).toBe(true);
    expect(armor.toRemove).toBe(false); // dust is still draining

    // let the dust tail finish
    tick([armor], 100, 1_000);
    expect(armor.toRemove).toBe(true);
    expect(armor.age).toBeLessThan(HARD_STOP_MS);
  });

  it('disappears once the owner dies, even mid-buff, and does not come back after they respawn', () => {
    const game = createGame();
    const owner = unit(game);
    const spell = new Malphite_W(owner);
    spell.press(castContext(owner));

    const bulkBuff = owner.buffs.find((b): b is StatAmp => b instanceof StatAmp)!;
    const armor = game.objectManager._objectToBeAdd.find(
      (o): o is Malphite_W_Armor => o instanceof Malphite_W_Armor
    )!;

    tick([bulkBuff, armor], 100, 500);
    expect(armor.toRemove).toBe(false);

    // AttackableUnit.die() clears every buff immediately
    owner.die({ reviveAfter: 5_000 });
    expect(owner.isDead).toBe(true);
    expect(bulkBuff.toRemove).toBe(true);

    tick([armor], 100, 1_000);
    expect(armor.toRemove).toBe(true);

    // respawning elsewhere must not resurrect it
    owner.respawn();
    expect(owner.isDead).toBe(false);
    tick([armor], 100, 500);
    expect(armor.toRemove).toBe(true);
  });

  it('treats a buff that never landed as an attachment already over', () => {
    // The general failure mode this class of object used to have: trusting the
    // instance handed to addBuff, which is not always the one the unit ends up
    // ticking (RENEW_EXISTING renews the existing buff and drops the new one).
    // An orphan never advances timeElapsed and never flips toRemove, so an
    // object shadowing it waited forever. attachTo resolves what actually
    // landed, so the orphan case can no longer produce an immortal object — it
    // produces one that never starts.
    const game = createGame();
    const owner = unit(game);
    const orphanedBuff = new Buff(DURATION_MS, owner, owner); // never added to owner.buffs
    const armor = new Malphite_W_Armor(owner);
    armor.attachTo(owner, orphanedBuff);

    expect(armor.attachmentLost).toBe(true);

    tick([armor], 100, 300);
    expect(orphanedBuff.toRemove).toBe(false); // confirms it really is orphaned
    expect(armor.toRemove).toBe(true);
  });

  it('never lingers past the hard stop even if its anchor stays valid forever', () => {
    // attachmentLost should always fire first. This is the backstop for the
    // path nobody has found: a buff that sits in owner.buffs and is never
    // ticked keeps the attachment perfectly valid, so only the hard stop can
    // end it. A permanent artefact becomes a few-second one.
    const game = createGame();
    const owner = unit(game);
    const neverTicked = new Buff(DURATION_MS, owner, owner);
    owner.buffs.push(neverTicked);
    const armor = new Malphite_W_Armor(owner);
    armor.attachTo(owner, neverTicked);

    tick([armor], 100, HARD_STOP_MS - 100);
    expect(armor.attachmentLost).toBe(false);
    expect(armor.toRemove).toBe(false);

    tick([armor], 100, 200);
    expect(armor.toRemove).toBe(true);
  });
});
