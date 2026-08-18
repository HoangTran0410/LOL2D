import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined, placeholder: () => undefined },
}));

import Jhin_Q, {
  JHIN_MARK_MS,
  JHIN_Q_DAMAGE,
  JHIN_Q_MAX_HITS,
  Jhin_Q_Object,
  applyJhinMark,
  hasJhinMark,
} from '../../../src/game/gameObject/spells/Jhin_Q';
import Jhin_W, {
  JHIN_W_CAST_MS,
  JHIN_W_DAMAGE,
  JHIN_W_RANGE,
} from '../../../src/game/gameObject/spells/Jhin_W';
import Jhin_E, {
  JHIN_E_ARM_MS,
  JHIN_E_BLAST_RADIUS,
  JHIN_E_DAMAGE,
  JHIN_E_FUSE_MS,
  JHIN_E_MAX_TRAPS,
  Jhin_E_Trap,
} from '../../../src/game/gameObject/spells/Jhin_E';
import Jhin_R, {
  JHIN_R_DAMAGE,
  JHIN_R_FINAL_DAMAGE,
  JHIN_R_RANGE,
  JHIN_R_SHOTS,
  JHIN_R_SHOT_GAP_MS,
  JHIN_R_WINDOW_MS,
} from '../../../src/game/gameObject/spells/Jhin_R';
import Root from '../../../src/game/gameObject/buffs/Root';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import {
  createGame,
  createUnit,
  installSketchMathGlobals,
  installSpellObjectGlobals,
  pressSpell,
  type TestGame,
} from '../spell/fixtures';

function unit(game: TestGame, x: number, teamId: string, pool = 100): AttackableUnit {
  const result = createUnit(game, x, teamId);
  result.collisionRadius = 1;
  result.stats.speed.baseValue = 10;
  result.stats.mana.baseValue = 100;
  result.stats.health.baseValue = pool;
  result.stats.maxHealth.baseValue = pool;
  result.stats.healthRegen.baseValue = 0;
  result.stats.manaRegen.baseValue = 0;
  result.animatedValues.displaySize = 20;
  return result;
}

function liveRoots(victim: AttackableUnit): number {
  let count = 0;
  for (const buff of victim.buffs) {
    if (buff instanceof Root && !buff.toRemove) count += 1;
  }
  return count;
}

function trapsOf(game: TestGame): Jhin_E_Trap[] {
  const found: Jhin_E_Trap[] = [];
  for (const object of game.objectManager._objectToBeAdd) {
    if (object instanceof Jhin_E_Trap) found.push(object);
  }
  for (const object of game.objectManager.objects) {
    if (object instanceof Jhin_E_Trap) found.push(object);
  }
  return found;
}

describe('Jhin spells', () => {
  let game: TestGame;
  let owner: AttackableUnit;

  beforeEach(() => {
    installSpellObjectGlobals();
    installSketchMathGlobals();
    vi.stubGlobal('deltaTime', 250);
    vi.stubGlobal('createVector', (x = 0, y = 0) => new (p5 as any).Vector(x, y));
    game = createGame();
    owner = unit(game, 0, 'blue');
    game.setPlayer(owner);
    (game as any).worldMouse = createVector(300, 0);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('Q escalates its damage per bounce and stops dead at the hit cap', () => {
    const victims = [
      unit(game, 200, 'red'),
      unit(game, 360, 'red'),
      unit(game, 520, 'red'),
      unit(game, 680, 'red'),
      unit(game, 840, 'red'),
    ];
    for (const victim of victims) game.objectManager.addObject(victim);
    game.objectManager.update();

    const grenade = new Jhin_Q_Object(owner);
    grenade.destination = createVector(200, 0);
    for (const victim of victims) grenade.onHit(victim);

    expect(JHIN_Q_MAX_HITS).toBe(JHIN_Q_DAMAGE.length);
    expect(victims[0].stats.health.value).toBe(100 - JHIN_Q_DAMAGE[0]);
    expect(victims[1].stats.health.value).toBe(100 - JHIN_Q_DAMAGE[1]);
    expect(victims[2].stats.health.value).toBe(100 - JHIN_Q_DAMAGE[2]);
    expect(victims[3].stats.health.value).toBe(100 - JHIN_Q_DAMAGE[3]);
    expect(victims[4].stats.health.value).toBe(100);
    expect(victims[3].stats.health.value).toBeLessThan(victims[0].stats.health.value);
  });

  /**
   * Q used to be a POINT skillshot that hunted after it arrived, so a key pressed at empty
   * ground flew its full range and then latched onto whatever was within another 300. These
   * pin down the two halves of that: no target, no cast; and arriving on nothing is a miss.
   */
  describe('Q needs a body to throw at', () => {
    const pressQ = (q: Jhin_Q, cursorX: number, cursorY = 0): boolean =>
      pressSpell(q, { at: { x: cursorX, y: cursorY } });

    const grenadesInFlight = (): Jhin_Q_Object[] => {
      const found: Jhin_Q_Object[] = [];
      for (const object of game.objectManager._objectToBeAdd) {
        if (object instanceof Jhin_Q_Object) found.push(object);
      }
      for (const object of game.objectManager.objects) {
        if (object instanceof Jhin_Q_Object) found.push(object);
      }
      return found;
    };

    it('refuses the cast when there is nobody to throw at', () => {
      const q = new Jhin_Q(owner);
      expect(pressQ(q, 300)).toBe(false);
      expect(grenadesInFlight()).toHaveLength(0);
      expect(owner.stats.mana.value).toBe(100);
    });

    it('locks onto the enemy under the cursor and chases it', () => {
      const victim = unit(game, 300, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();

      const q = new Jhin_Q(owner);
      expect(pressQ(q, 300)).toBe(true);

      const flying = grenadesInFlight();
      expect(flying).toHaveLength(1);
      expect(flying[0].chasing).toBe(victim);
    });

    it('expires where it was aimed instead of hunting a new body', () => {
      const bystander = unit(game, 260, 'red');
      game.objectManager.addObject(bystander);
      game.objectManager.update();

      const grenade = new Jhin_Q_Object(owner);
      grenade.position = createVector(100, 0);
      grenade.destination = createVector(100, 0);
      grenade.onArrive();

      expect(grenade.toRemove).toBe(true);
      expect(grenade.chasing).toBe(null);
      expect(bystander.stats.health.value).toBe(100);
    });
  });

  /**
   * E is a concealed mine with a fuse: stepping on it slows and marks you, and the damage
   * only lands when the bloom finishes opening — so reacting is worth something.
   */
  describe('E hides, then blooms before it bites', () => {
    const stepOn = (trap: Jhin_E_Trap): void => {
      vi.stubGlobal('deltaTime', JHIN_E_ARM_MS);
      trap.update();
      vi.stubGlobal('deltaTime', 16);
    };

    it('is concealed once armed, and shows itself only after it is tripped', () => {
      const trap = new Jhin_E_Trap(owner, createVector(400, 0));
      game.objectManager.addObject(trap);

      expect(trap.concealed).toBe(false); // still being planted

      const victim = unit(game, 400, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();

      vi.stubGlobal('deltaTime', JHIN_E_ARM_MS - 1);
      trap.update();
      expect(trap.armed).toBe(false);
      expect(trap.concealed).toBe(false);

      vi.stubGlobal('deltaTime', 2);
      trap.update();
      vi.stubGlobal('deltaTime', 16);
      expect(trap.armed).toBe(true);
      expect(trap.triggered).toBe(true);
      expect(trap.concealed).toBe(false); // tripped, so no longer hidden
    });

    it('slows and marks on the step, but deals no damage until the bloom fills', () => {
      const victim = unit(game, 400, 'red');
      game.objectManager.addObject(victim);
      game.objectManager.update();

      const trap = new Jhin_E_Trap(owner, createVector(400, 0));
      game.objectManager.addObject(trap);
      stepOn(trap);

      expect(trap.triggered).toBe(true);
      expect(hasJhinMark(victim)).toBe(true);
      expect(victim.stats.health.value).toBe(100);
      expect(trap.fuseProgress).toBe(0);

      // Most of the fuse gone, still nothing.
      vi.stubGlobal('deltaTime', JHIN_E_FUSE_MS - 50);
      trap.update();
      expect(victim.stats.health.value).toBe(100);
      expect(trap.toRemove).toBe(false);

      vi.stubGlobal('deltaTime', 50);
      trap.update();
      vi.stubGlobal('deltaTime', 16);
      expect(trap.toRemove).toBe(true);
      expect(victim.stats.health.value).toBe(100 - JHIN_E_DAMAGE);
    });

    it('misses whoever left the blast radius while it was opening', () => {
      const runner = unit(game, 400, 'red');
      game.objectManager.addObject(runner);
      game.objectManager.update();

      const trap = new Jhin_E_Trap(owner, createVector(400, 0));
      game.objectManager.addObject(trap);
      stepOn(trap);
      expect(trap.triggered).toBe(true);

      // Out past the blast radius before the fuse runs out.
      runner.position.set(400 + JHIN_E_BLAST_RADIUS + 40, 0);
      game.objectManager.update();

      vi.stubGlobal('deltaTime', JHIN_E_FUSE_MS);
      trap.update();
      vi.stubGlobal('deltaTime', 16);

      expect(trap.toRemove).toBe(true);
      expect(runner.stats.health.value).toBe(100);
    });

    it('catches a second enemy who walked in while it was opening', () => {
      const tripper = unit(game, 400, 'red');
      const latecomer = unit(game, 900, 'red');
      game.objectManager.addObject(tripper);
      game.objectManager.addObject(latecomer);
      game.objectManager.update();

      const trap = new Jhin_E_Trap(owner, createVector(400, 0));
      game.objectManager.addObject(trap);
      stepOn(trap);

      latecomer.position.set(430, 0);
      game.objectManager.update();

      vi.stubGlobal('deltaTime', JHIN_E_FUSE_MS);
      trap.update();
      vi.stubGlobal('deltaTime', 16);

      expect(tripper.stats.health.value).toBe(100 - JHIN_E_DAMAGE);
      expect(latecomer.stats.health.value).toBe(100 - JHIN_E_DAMAGE);
    });
  });

  it('Q and E both hang the lotus mark, and it lapses after MARK_MS', () => {
    const shot = unit(game, 200, 'red');
    const stepped = unit(game, 400, 'red');
    game.objectManager.addObject(shot);
    game.objectManager.addObject(stepped);
    game.objectManager.update();

    new Jhin_Q_Object(owner).onHit(shot);
    expect(hasJhinMark(shot)).toBe(true);

    const trap = new Jhin_E_Trap(owner, createVector(400, 0));
    vi.stubGlobal('deltaTime', JHIN_E_ARM_MS);
    trap.update();
    expect(hasJhinMark(stepped)).toBe(true);

    vi.stubGlobal('deltaTime', 500);
    for (let tick = 0; tick <= JHIN_MARK_MS / 500 + 1; tick++) game.objectManager.update();
    expect(hasJhinMark(shot)).toBe(false);
    expect(hasJhinMark(stepped)).toBe(false);
  });

  /**
   * W raises the gun for `JHIN_W_CAST_MS` before it fires. Calling `onSpellCast`
   * by hand used to skip that entirely, so the old test could not have noticed
   * if the windup vanished; driving it through `press` means the shot only
   * happens once the clock says it does.
   */
  const fireW = (w: Jhin_W, at: { x: number; y: number }): void => {
    expect(pressSpell(w, { at })).toBe(true);
    expect(w.state).toBe('CASTING');
    vi.stubGlobal('deltaTime', JHIN_W_CAST_MS);
    w.update();
    vi.stubGlobal('deltaTime', 250);
  };

  it('W shoots long distance (1250) and roots the marked body', () => {
    expect(JHIN_W_RANGE).toBe(1250);

    const marked = unit(game, 600, 'red');
    const plain = unit(game, 800, 'red');
    game.objectManager.addObject(marked);
    game.objectManager.addObject(plain);
    game.objectManager.update();
    applyJhinMark(owner, marked);

    fireW(new Jhin_W(owner), { x: 900, y: 0 });

    expect(marked.stats.health.value).toBe(100 - JHIN_W_DAMAGE);
    expect(plain.stats.health.value).toBe(100 - JHIN_W_DAMAGE);
    expect(liveRoots(marked)).toBe(1);
    expect(liveRoots(plain)).toBe(0);
  });

  it('W consumes the mark, so a second W finds nothing left to root', () => {
    const marked = unit(game, 200, 'red', 300);
    game.objectManager.addObject(marked);
    game.objectManager.update();
    applyJhinMark(owner, marked);

    const w = new Jhin_W(owner);
    fireW(w, { x: 400, y: 0 });
    expect(hasJhinMark(marked)).toBe(false);
    expect(liveRoots(marked)).toBe(1);

    // The second W is the point of the test, so it has to be affordable: the
    // runtime charges 40 mana and a 10s cooldown for the first one.
    w.resetCoolDown();
    owner.stats.mana.baseValue = 100;
    fireW(w, { x: 400, y: 0 });
    expect(liveRoots(marked)).toBe(1);
    expect(marked.stats.health.value).toBe(300 - JHIN_W_DAMAGE - JHIN_W_DAMAGE);
  });

  it('E tosses grenade and plants trap on arrival; a fourth trap evicts the oldest', () => {
    const stepped = unit(game, 300, 'red');
    game.objectManager.addObject(stepped);
    game.objectManager.update();

    const trap = new Jhin_E_Trap(owner, createVector(300, 0));
    vi.stubGlobal('deltaTime', 250);
    trap.update();
    trap.update();
    expect(trap.triggered).toBe(false);
    trap.update();
    // Armed and stepped on — but the damage belongs to the detonation, not the step.
    expect(trap.triggered).toBe(true);
    expect(stepped.stats.health.value).toBe(100);

    vi.stubGlobal('deltaTime', JHIN_E_FUSE_MS);
    trap.update();
    expect(stepped.stats.health.value).toBe(100 - JHIN_E_DAMAGE);
    expect(trap.toRemove).toBe(true);

    const e = new Jhin_E(owner);
    for (let index = 0; index < JHIN_E_MAX_TRAPS + 1; index++) {
      // Four casts in a row costs 100 mana and four 9s cooldowns, neither of
      // which this test is about — so pay them off explicitly each time.
      e.resetCoolDown();
      owner.stats.mana.baseValue = 100;
      expect(pressSpell(e, { at: { x: 120 + index * 30, y: 240 } })).toBe(true);
      // Complete grenade throw and register planted trap
      vi.stubGlobal('deltaTime', 400);
      game.objectManager.update();
      game.objectManager.update();
    }
    const planted = trapsOf(game);
    let alive = 0;
    for (const known of planted) {
      if (!known.toRemove) alive += 1;
    }
    expect(alive).toBe(JHIN_E_MAX_TRAPS);
  });

  /**
   * Driven through `press`, not `onSpellCast`. R's whole bug lived in the gap
   * between the two: calling the hook by hand opened the curtain and left it
   * open, while the real runtime completed the activation on the same press and
   * slammed it shut before the player could fire a single shot.
   */
  describe('R, driven the way the game drives it', () => {
    const pressR = (r: Jhin_R, cursorX: number, cursorY = 0): boolean =>
      pressSpell(r, { at: { x: cursorX, y: cursorY } });

    /** Let the spell's own clock run, so the next press clears the shot gap. */
    const waitOutTheGap = (r: Jhin_R): void => {
      vi.stubGlobal('deltaTime', JHIN_R_SHOT_GAP_MS);
      r.update();
      vi.stubGlobal('deltaTime', 16);
    };

    /** Fly whatever is in the air into the target without touching the spell. */
    const flyBullets = (): void => {
      vi.stubGlobal('deltaTime', 16);
      for (let frame = 0; frame < 40; frame++) game.objectManager.update();
    };

    it('opens the stage on press 1 and fires one bullet on each of presses 2-5', () => {
      expect(JHIN_R_RANGE).toBe(1350);

      const victim = unit(game, 300, 'red', 300);
      game.objectManager.addObject(victim);
      game.objectManager.update();

      const r = new Jhin_R(owner);

      // Press 1 raises the curtain and fires nothing.
      expect(pressR(r, 300)).toBe(true);
      expect(r.performing).toBe(true);
      expect(r.shotsRemaining).toBe(JHIN_R_SHOTS);
      expect(r.shotsFired).toBe(0);
      expect(liveRoots(owner)).toBe(1);
      flyBullets();
      expect(victim.stats.health.value).toBe(300);

      // Presses 2, 3, 4 each spend one shot and leave the stage standing.
      for (let shot = 1; shot <= 3; shot++) {
        waitOutTheGap(r);
        expect(pressR(r, 300)).toBe(true);
        expect(r.shotsFired).toBe(shot);
        expect(r.shotsRemaining).toBe(JHIN_R_SHOTS - shot);
        expect(r.performing).toBe(true);
        flyBullets();
        expect(victim.stats.health.value).toBe(300 - JHIN_R_DAMAGE * shot);
      }

      // Press 5 is the finale: the heavy round, then the curtain falls.
      waitOutTheGap(r);
      expect(pressR(r, 300)).toBe(true);
      flyBullets();
      expect(victim.stats.health.value).toBe(300 - JHIN_R_DAMAGE * 3 - JHIN_R_FINAL_DAMAGE);
      expect(r.performing).toBe(false);
      expect(liveRoots(owner)).toBe(0);
    });

    it('drops the curtain when the window lapses, and charges the full cooldown', () => {
      const r = new Jhin_R(owner);
      expect(pressR(r, 300)).toBe(true);
      expect(r.performing).toBe(true);

      vi.stubGlobal('deltaTime', JHIN_R_WINDOW_MS);
      r.update();
      vi.stubGlobal('deltaTime', 16);

      expect(r.performing).toBe(false);
      expect(liveRoots(owner)).toBe(0);
      expect(r.currentCooldown).toBeGreaterThan(0);
    });
  });
});
