import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: {
    get: vi.fn(() => undefined),
    getAsset: vi.fn(() => undefined),
    placeholder: vi.fn(() => undefined),
  },
}));

import {
  createGame,
  createUnit,
  installSketchMathGlobals,
  installSpellObjectGlobals,
  type TestGame,
} from '../spell/fixtures';
import type AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import type SpellObject from '../../../src/game/gameObject/SpellObject';
import type { CastContext } from '../../../src/game/spell/runtime/types';

import Ahri_W, { Ahri_W_Object } from '../../../src/game/gameObject/spells/Ahri_W';
import Amumu_Q, { Amumu_Q_Object } from '../../../src/game/gameObject/spells/Amumu_Q';
import Ashe_E, { Ashe_E_Object, Ashe_E_Ping } from '../../../src/game/gameObject/spells/Ashe_E';
import Leblanc_E, { Leblanc_E_Object } from '../../../src/game/gameObject/spells/Leblanc_E';
import LeeSin_Q, { LeeSin_Q_Object } from '../../../src/game/gameObject/spells/LeeSin_Q';
import LeeSin_W, { LeeSin_W_Burst } from '../../../src/game/gameObject/spells/LeeSin_W';
import Lux_W, { Lux_W_Burst, Lux_W_Object } from '../../../src/game/gameObject/spells/Lux_W';
import Morgana_E, { Morgana_E_Object } from '../../../src/game/gameObject/spells/Morgana_E';
import Thresh_Q, { Thresh_Q_Object } from '../../../src/game/gameObject/spells/Thresh_Q';
import Twitch_Q, { Twitch_Q_Object } from '../../../src/game/gameObject/spells/Twitch_Q';
import Zed_E, { Zed_E_Object } from '../../../src/game/gameObject/spells/Zed_E';

const castContext = (caster: AttackableUnit): CastContext =>
  Object.freeze({
    spellId: 'attached-effect',
    activationId: 'activation',
    startedAtMs: 0,
    caster,
    origin: Object.freeze({ x: caster.position.x, y: caster.position.y }),
    cursorWorld: Object.freeze({ x: caster.position.x + 100, y: caster.position.y }),
    direction: Object.freeze({ x: 1, y: 0 }),
  });

/** Everything the spell handed to the object manager this frame. */
const spawned = <T>(game: TestGame, type: new (...args: never[]) => T): T[] => {
  game.objectManager.update();
  return game.objectManager.objects.filter((object): object is T => object instanceof type);
};

/**
 * Kills the anchor, runs the effect, then revives the anchor a long way off and
 * runs it again: an attached effect has to be gone on the first frame and stay
 * gone through the respawn instead of latching back on to the new body.
 */
const outlivesNothing = (effect: SpellObject, anchor: AttackableUnit): void => {
  anchor.die({ reviveAfter: 5_000 });
  effect.update();
  expect(effect.toRemove).toBe(true);

  anchor.respawn();
  anchor.position.set(900, 900);
  anchor.destination.set(900, 900);
  effect.update();
  expect(effect.toRemove).toBe(true);
};

describe('spell effects that ride on a body die with it', () => {
  beforeEach(() => {
    installSpellObjectGlobals();
    installSketchMathGlobals();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("drops Ahri's fox-fires instead of orbiting and hunting from her corpse", () => {
    const game = createGame();
    const ahri = createUnit(game, 0, 'blue');
    game.setPlayer(ahri);

    new Ahri_W(ahri).press(castContext(ahri));
    const fires = spawned(game, Ahri_W_Object);
    expect(fires).toHaveLength(3);
    for (const fire of fires) expect(fire._anchorUnit).toBe(ahri);

    // alive and well before the kill: they orbit, they do not remove themselves
    for (const fire of fires) fire.update();
    expect(fires.some(fire => fire.toRemove)).toBe(false);

    ahri.die({ reviveAfter: 5_000 });
    game.objectManager.update();
    expect(game.objectManager.objects.filter(o => o instanceof Ahri_W_Object)).toHaveLength(0);

    ahri.respawn();
    ahri.position.set(900, 900);
    game.objectManager.update();
    expect(game.objectManager.objects.filter(o => o instanceof Ahri_W_Object)).toHaveLength(0);
    for (const fire of fires) expect(fire.toRemove).toBe(true);
  });

  it("drops Zed's blade instead of sweeping around his corpse", () => {
    const game = createGame();
    const zed = createUnit(game, 0, 'blue');
    game.setPlayer(zed);

    new Zed_E(zed).press(castContext(zed));
    const [blade] = spawned(game, Zed_E_Object);
    expect(blade._anchorUnit).toBe(zed);

    blade.update();
    expect(blade.toRemove).toBe(false);

    outlivesNothing(blade, zed);
  });

  it("drops Amumu's bandage, and its pull, when the caster dies mid-reel", () => {
    const game = createGame();
    const amumu = createUnit(game, 0, 'blue');
    game.setPlayer(amumu);
    const victim = createUnit(game, 200, 'red');

    const bandage = new Amumu_Q_Object(amumu);
    bandage.onHit(victim);
    expect(bandage._anchorUnit).toBe(amumu);
    expect(amumu.buffs).toContain(bandage.dashBuff);

    bandage.update();
    expect(bandage.toRemove).toBe(false);

    amumu.die({ reviveAfter: 5_000 });
    bandage.update();
    expect(bandage.toRemove).toBe(true);
    expect(bandage.dashBuff?.toRemove).toBe(true); // the reel-in stops with it

    amumu.respawn();
    amumu.position.set(900, 900);
    bandage.update();
    expect(bandage.toRemove).toBe(true);
  });

  it("drops Thresh's chain when Thresh dies instead of tugging from a corpse", () => {
    const game = createGame();
    const thresh = createUnit(game, 0, 'blue');
    game.setPlayer(thresh);
    const victim = createUnit(game, 200, 'red');

    const chain = new Thresh_Q_Object(thresh);
    chain.onHit(victim);
    expect(chain._anchorUnit).toBe(thresh);

    chain.update();
    expect(chain.toRemove).toBe(false);

    outlivesNothing(chain, thresh);
  });

  it("drops LeBlanc's chain, and its delayed root, when LeBlanc dies", () => {
    const game = createGame();
    const leblanc = createUnit(game, 0, 'blue');
    game.setPlayer(leblanc);
    const victim = createUnit(game, 200, 'red');

    const chain = new Leblanc_E_Object(leblanc);
    chain.onHit(victim);
    expect(chain._anchorUnit).toBe(leblanc);

    leblanc.die({ reviveAfter: 5_000 });
    // well past the 2.5s the root would otherwise land on
    vi.stubGlobal('deltaTime', 4_000);
    chain.update();

    expect(chain.toRemove).toBe(true);
    expect(victim.buffs).toHaveLength(0);

    leblanc.respawn();
    leblanc.position.set(900, 900);
    chain.update();
    expect(chain.toRemove).toBe(true);
  });

  it("drops Lee Sin's sonic wave marker off a victim that dies under it", () => {
    const game = createGame();
    const leeSin = createUnit(game, 0, 'blue');
    game.setPlayer(leeSin);
    const victim = createUnit(game, 200, 'red');

    const wave = new LeeSin_Q_Object(leeSin);
    wave.onHit(victim);
    expect(wave._anchorUnit).toBe(victim);

    wave.update();
    expect(wave.toRemove).toBe(false);

    outlivesNothing(wave, victim);
  });

  it("drops Ashe's reveal ping off an enemy that dies while it is up", () => {
    const game = createGame();
    const ashe = createUnit(game, 0, 'blue');
    game.setPlayer(ashe);
    const enemy = createUnit(game, 60, 'red');
    game.objectManager.addObject(enemy);

    new Ashe_E(ashe).press(castContext(ashe));
    const [bird] = spawned(game, Ashe_E_Object);
    bird.position.set(enemy.position.x, enemy.position.y);
    bird.onAfterMove();

    const [ping] = spawned(game, Ashe_E_Ping);
    expect(ping._anchorUnit).toBe(enemy);

    ping.update();
    expect(ping.toRemove).toBe(false);

    outlivesNothing(ping, enemy);
  });

  it("drops Morgana's shield flash off a target that dies under it", () => {
    const game = createGame();
    const morgana = createUnit(game, 0, 'blue');
    game.setPlayer(morgana);

    new Morgana_E(morgana).press(castContext(morgana));
    const [flash] = spawned(game, Morgana_E_Object);
    expect(flash._anchorUnit).toBe(morgana);

    flash.update();
    expect(flash.toRemove).toBe(false);

    outlivesNothing(flash, morgana);
  });

  it("drops Lux's shield flash off an ally that dies under it", () => {
    const game = createGame();
    const lux = createUnit(game, 0, 'blue');
    game.setPlayer(lux);
    const ally = createUnit(game, 120, 'blue');
    game.objectManager.addObject(ally);

    new Lux_W(lux).press(castContext(lux));
    const [wand] = spawned(game, Lux_W_Object);
    wand.position.set(ally.position.x, ally.position.y);
    wand.onAfterMove();

    const [burst] = spawned(game, Lux_W_Burst);
    expect(burst._anchorUnit).toBe(ally);

    burst.update();
    expect(burst.toRemove).toBe(false);

    outlivesNothing(burst, ally);
  });

  it("drops Lee Sin's safeguard flash off an ally that dies under it", () => {
    const game = createGame();
    const leeSin = createUnit(game, 0, 'blue');
    game.setPlayer(leeSin);
    const ally = createUnit(game, 40, 'blue');

    new LeeSin_W(leeSin).grantShield(ally);
    const [burst] = spawned(game, LeeSin_W_Burst);
    expect(burst._anchorUnit).toBe(ally);

    burst.update();
    expect(burst.toRemove).toBe(false);

    outlivesNothing(burst, ally);
  });

  it("drops Twitch's cloak on death and keeps it dropped through a respawn", () => {
    const game = createGame();
    const twitch = createUnit(game, 0, 'blue');
    game.setPlayer(twitch);
    twitch.stats.mana.baseValue = twitch.stats.maxMana.value;

    new Twitch_Q(twitch).press(castContext(twitch));
    const [cloak] = spawned(game, Twitch_Q_Object);
    expect(cloak._cloaked).toBe(true);

    twitch.die({ reviveAfter: 5_000 });
    expect(cloak._cloaked).toBe(false);

    twitch.respawn();
    twitch.position.set(900, 900);
    expect(cloak._cloaked).toBe(false);

    // one tick past both the smoke and the mote decay: nothing left to draw
    vi.stubGlobal('deltaTime', cloak.lifeTime + 700);
    cloak.update();
    expect(cloak.toRemove).toBe(true);
  });
});
