import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dash from '../../../src/game/gameObject/buffs/Dash';
import ActionState from '../../../src/game/enums/ActionState';

class TestVector {
  constructor(public x = 0, public y = 0) {}
  copy(): TestVector { return new TestVector(this.x, this.y); }
  set(x: number, y: number): this { this.x = x; this.y = y; return this; }
  add(other: TestVector): this { this.x += other.x; this.y += other.y; return this; }
  mag(): number { return Math.hypot(this.x, this.y); }
  setMag(value: number): this {
    const length = this.mag();
    if (length > 0) { this.x = (this.x / length) * value; this.y = (this.y / length) * value; }
    return this;
  }
  dist(other: TestVector): number { return Math.hypot(this.x - other.x, this.y - other.y); }
}

const p5Stub = {
  Vector: {
    dist: (a: TestVector, b: TestVector) => a.dist(b),
    sub: (a: TestVector, b: TestVector) => new TestVector(a.x - b.x, a.y - b.y),
  },
};

const unit = (grounded: boolean) => ({
  position: new TestVector(0, 0),
  destination: new TestVector(0, 0),
  stats: {
    size: { value: 50 },
    actionState: grounded ? ActionState.CAN_MOVE | ActionState.GROUNDED : ActionState.CAN_MOVE,
  },
  buffs: [] as unknown[],
  grounded,
  canMove: true,
  game: { objectManager: { addObject: vi.fn() } },
  moveTo: vi.fn(),
  markDisplaced: vi.fn(),
  stopMovement: vi.fn(),
});

const dashOn = (source: ReturnType<typeof unit>, target: ReturnType<typeof unit>) => {
  const dash = new Dash(1_000, source as never, target as never);
  dash.dashDestination = new TestVector(500, 0) as never;
  return dash;
};

describe('Ground', () => {
  beforeEach(() => {
    vi.stubGlobal('deltaTime', 16);
    vi.stubGlobal('p5', p5Stub);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lets a free unit dash itself', () => {
    const self = unit(false);
    const dash = dashOn(self, self);

    dash.activateBuff();
    dash.onUpdate();

    expect(self.position.x).toBeGreaterThan(0);
    expect(dash.toRemove).toBe(false);
  });

  // The point of the buff: you can still walk, you just cannot move yourself
  // with an ability.
  it('refuses a self-propelled dash while grounded', () => {
    const self = unit(true);
    const dash = dashOn(self, self);

    dash.activateBuff();
    dash.onUpdate();

    expect(self.position.x).toBe(0);
    expect(self.moveTo).not.toHaveBeenCalled();
    expect(dash.toRemove).toBe(true);
  });

  // Grounding is not displacement immunity — a hook or a knockback still lands.
  it('still lets someone else displace a grounded unit', () => {
    const attacker = unit(false);
    const victim = unit(true);
    const dash = dashOn(attacker, victim);

    dash.activateBuff();
    dash.onUpdate();

    expect(victim.position.x).toBeGreaterThan(0);
    expect(victim.markDisplaced).toHaveBeenCalled();
    expect(dash.toRemove).toBe(false);
  });

  it('stops a dash that is already under way when Ground lands mid-flight', () => {
    const self = unit(false);
    const dash = dashOn(self, self);

    dash.activateBuff();
    dash.onUpdate();
    const travelled = self.position.x;

    self.grounded = true;
    dash.onUpdate();

    expect(self.position.x).toBe(travelled);
    expect(dash.toRemove).toBe(true);
  });

  it('agrees with the cast-time check spells use', () => {
    expect(Dash.CanDash(unit(false) as never)).toBe(true);
    expect(Dash.CanDash(unit(true) as never)).toBe(false);
  });
});

// Half the self-dashing spells never called Dash.CanDash, and the blinks
// (Flash, Zed W, Zed R) bypassed grounding entirely by reaching for
// teleportTo. Enforcing it in the Dash buff and in Spell.blinkOwnerTo only
// holds as long as nothing goes around them, so fail the build if anything does.
describe('no spell relocates its own caster behind the shared gate', () => {
  const spellsDir = join(process.cwd(), 'src/game/gameObject/spells');

  it.each(readdirSync(spellsDir).filter(name => name.endsWith('.ts')))(
    '%s',
    name => {
      const source = readFileSync(join(spellsDir, name), 'utf8');
      // `owner.teleportTo` moves the champion; `clone.teleportTo` / `shadow.teleportTo`
      // move a spell's own puppet, which grounding has no say over.
      expect(source).not.toMatch(/\bowner\.teleportTo\s*\(/);
    }
  );
});
