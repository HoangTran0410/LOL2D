import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Champion = InstanceType<ContentApi['units']['Champion']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Dash = InstanceType<ContentApi['buffs']['Dash']>;
type Nearsight = InstanceType<ContentApi['buffs']['Nearsight']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Nocturne_R = InstanceType<ReturnType<typeof makeNocturne_R>>;
type Nocturne_R_Landing = InstanceType<ReturnType<typeof makeNocturne_R_Landing>>;
type Nocturne_R_Object = InstanceType<ReturnType<typeof makeNocturne_R_Object>>;
type Nocturne_R_Window = InstanceType<ReturnType<typeof makeNocturne_R_Window>>;



// Exported so the suite asserts the wiring, not a copy of the number —
// retuning a value should not mean editing the test.
// Scaled to the ~1600x1600 canvas: the raw PC value (1200) let Paranoia cross
// most of the map in one leap, half again as far as the longest reach anything
// else in the game has (900). 800 still makes it the longest gap-closer here.
export const LEAP_RANGE = 800;


/**
 * Paranoia, in two activations like the real ultimate:
 *
 *  1. the map goes dark — every enemy *champion* is nearsighted for 6s,
 *  2. within that same window Nocturne may recast to leap at one enemy champion,
 *     tracking them the whole way and dealing damage on arrival. The leap cannot
 *     be interrupted (displacement immunity).
 *
 * Letting the window lapse without leaping puts the ultimate on full cooldown.
 */
function __buildNocturne_R(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Spell = api.Spell;
  const Champion = api.units.Champion;
  const Dash = api.buffs.Dash;
  const Nearsight = api.buffs.Nearsight;
  const Nocturne_R_Object = makeNocturne_R_Object(api);
  const Nocturne_R_Window = makeNocturne_R_Window(api);
  const Nocturne_R_Landing = makeNocturne_R_Landing(api);
  class Nocturne_R extends Spell {
    // Both phases auto-lock their own target (R1 hits every enemy champion, R2
    // leaps at whichever is nearest the cursor among those in range) and never
    // read context.target; see "auto-locking spells" in docs/ADDING_SPELLS.md.
    targetingMode = 'SELF' as const;
    static PHASES = {
      R1: { image: api.asset('spell_nocturne_r') },
      // The wiki carries no separate icon for the second form, so the recast
      // reuses the base icon rather than falling back to a blank placeholder.
      R2: { image: api.asset('spell_nocturne_r') },
    };
    phase: 'R1' | 'R2' = 'R1';

    image = Nocturne_R.PHASES[this.phase].image;
    name = 'Hoang Tưởng (Nocturne_R)';
    description = `Bao trùm bản đồ trong bóng tối: <span>mọi tướng địch</span> bị <span class="buff">Mờ Mắt</span> (tầm nhìn giảm còn 200) trong <span class="time">6 giây</span>. Trong khoảng thời gian đó, tái kích hoạt để <span class="buff">Lao</span> tới một <span>tướng địch</span> trong phạm vi <span>${LEAP_RANGE}</span> (chọn tướng gần con trỏ chuột nhất), bám theo mục tiêu và gây <span class="damage">35 sát thương</span> khi tới nơi. Cú lao không thể bị chặn. Nếu không tái kích hoạt, kỹ năng vào thời gian hồi đầy đủ.`;
    coolDown = 10000;
    manaCost = 100;

    nearsightTime = 6000;
    newVisionRadius = 200;
    leapRange = LEAP_RANGE;
    leapSpeed = 18;
    damage = 35;
    /** The wiki's 0.25s delay before Paranoia may be recast. */
    recastDelay = 250;

    _recastTimeLeft = 0;

    checkCastCondition() {
      // the leap needs a champion to land on, and a Nocturne able to move
      if (this.phase === 'R2') {
        return !!this.findLeapTarget() && Dash.CanDash(this.owner);
      }
      return true;
    }

    onSpellCast() {
      if (this.phase === 'R1') this.castDarkness();
      else this.castLeap();
    }

    castDarkness() {
      // no area = the whole map; only champions are terrorised, not monsters
      const enemyChampions = this.game.objectManager.queryObjects({
        queryByDisplayBoundingBox: true,
        filters: [
          PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
          PredefinedFilters.type(Champion),
        ],
      });

      enemyChampions.forEach((enemy: any) => {
        const nearsightBuff = new Nearsight(this.nearsightTime, this.owner, enemy);
        nearsightBuff.image = Nocturne_R.PHASES.R1.image;
        nearsightBuff.newVisionRadius = this.newVisionRadius;
        enemy.addBuff(nearsightBuff);
      });

      const obj = new Nocturne_R_Object(this.owner);
      this.game.objectManager.addObject(obj);

      // a marker that rides on Nocturne for exactly as long as the leap is live
      const window = new Nocturne_R_Window(this.owner);
      window.spell = this;
      this.game.objectManager.addObject(window);

      // open the recast window; the real cooldown only starts when it closes
      this.phase = 'R2';
      this.image = Nocturne_R.PHASES.R2.image;
      this._recastTimeLeft = this.nearsightTime;
      // recast window, not a cooldown — deliberately not reduced
      this.currentCooldown = this.recastDelay;
    }

    castLeap() {
      const target = this.findLeapTarget();
      this.closeRecastWindow();
      if (!target) return;

      const dashBuff = new Dash(6000, this.owner, this.owner);
      dashBuff.image = Nocturne_R.PHASES.R2.image;
      dashBuff.dashDestination = target.position; // live ref: the leap chases the target
      dashBuff.dashSpeed = this.leapSpeed;
      dashBuff.cancelable = false; // displacement immunity: nothing stops the flight
      dashBuff.onReachedDestination = () => {
        if (!target.isDead) target.takeDamage(this.damage, this.owner);

        // the landing: something has to happen where 35 damage arrived
        const land = new Nocturne_R_Landing(this.owner);
        land.position = target.position.copy();
        this.game.objectManager.addObject(land);
      };
      this.owner.addBuff(dashBuff);
    }

    closeRecastWindow() {
      this.phase = 'R1';
      this.image = Nocturne_R.PHASES.R1.image;
      this._recastTimeLeft = 0;
      this.currentCooldown = this.reducedCooldown(this.coolDown);
    }

    /** The enemy champion closest to the cursor, so the player picks the victim. */
    findLeapTarget(): any {
      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.owner.position.x,
          y: this.owner.position.y,
          r: effectiveRange(this.leapRange, this.owner),
        }),
        filters: [
          PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
          PredefinedFilters.visibleTo(this.owner),
          PredefinedFilters.type(Champion),
        ],
      });

      const aim = this.aimPoint;

      let best: any = null;
      let bestDistance = Infinity;
      for (const enemy of enemies) {
        const distance = enemy.position.dist(aim);
        if (distance < bestDistance) {
          best = enemy;
          bestDistance = distance;
        }
      }
      return best;
    }

    onUpdate() {
      if (this.phase !== 'R2') return;

      this._recastTimeLeft -= deltaTime;
      if (this._recastTimeLeft <= 0) this.closeRecastWindow();
    }

    drawPreview() {
      if (this.phase === 'R2') super.drawPreview(effectiveRange(this.leapRange, this.owner));
    }
  }
  return Nocturne_R;
}
const __cacheNocturne_R = new WeakMap<ContentApi, ReturnType<typeof __buildNocturne_R>>();
export default function makeNocturne_R(api: ContentApi) {
  const cached = __cacheNocturne_R.get(api);
  if (cached) return cached;
  const built = __buildNocturne_R(api);
  __cacheNocturne_R.set(api, built);
  return built;
}


/** The wave of darkness washing outwards from the caster as the ult goes off. */
function __buildNocturne_R_Object(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class Nocturne_R_Object extends SpellObject {
    position = this.owner.position.copy();
    age = 0;
    lifeTime = 900;
    maxRadius = 760;

    update() {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const fade = 1 - t;
      const radius = lerp(30, this.maxRadius, t);

      push();
      translate(this.position.x, this.position.y);

      // a wall of black rolling out — heavy enough to read as "the lights went out"
      noFill();
      stroke(6, 2, 14, 210 * fade);
      strokeWeight(42 * fade + 6);
      circle(0, 0, radius * 2);
      stroke(52, 14, 92, 220 * fade);
      strokeWeight(24 * fade + 4);
      circle(0, 0, radius * 2);
      stroke(165, 95, 255, 245 * fade);
      strokeWeight(5 * fade + 1.5);
      circle(0, 0, radius * 2);

      // claws of shadow raking outwards inside the wave
      stroke(120, 55, 200, 190 * fade);
      strokeWeight(7 * fade + 1);
      for (let i = 0; i < 12; i++) {
        const a = (TWO_PI * i) / 12 + t * 0.5;
        const inner = radius - 60 * fade - 20;
        arc(0, 0, inner * 2, inner * 2, a, a + 0.28);
        arc(0, 0, radius * 2 * 0.82, radius * 2 * 0.82, a + 0.5, a + 0.72);
      }

      // the pitch-dark heart of it, right where Nocturne cast
      noStroke();
      fill(4, 1, 10, 190 * fade * fade);
      circle(0, 0, radius * 1.1);

      pop();
    }

    getDisplayBoundingBox() {
      const r = this.maxRadius + 60;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Nocturne_R_Object;
}
const __cacheNocturne_R_Object = new WeakMap<ContentApi, ReturnType<typeof __buildNocturne_R_Object>>();
export function makeNocturne_R_Object(api: ContentApi) {
  const cached = __cacheNocturne_R_Object.get(api);
  if (cached) return cached;
  const built = __buildNocturne_R_Object(api);
  __cacheNocturne_R_Object.set(api, built);
  return built;
}


/**
 * Rides on Nocturne while Paranoia's leap is available and disappears the moment
 * it is not — so "can I still jump?" is answered in the world, not in the HUD.
 */
function __buildNocturne_R_Window(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class Nocturne_R_Window extends SpellObject {
    spell: Nocturne_R | null = null;
    position = this.owner.position.copy();
    size = 96;
    age = 0;

    update() {
      this.age += deltaTime;

      // the phase check is the real one; the age cap is a backstop so the marker
      // can never outlive the window even if its spell stops being updated
      const expired = !this.spell || this.age > this.spell.nearsightTime + 500;
      if (expired || this.spell!.phase !== 'R2' || this.owner.isDead) {
        this.toRemove = true;
        return;
      }
      this.position.set(this.owner.position.x, this.owner.position.y);
    }

    draw() {
      if (!this.spell) return;
      const left = constrain(this.spell._recastTimeLeft / this.spell.nearsightTime, 0, 1);
      const bodySize = this.owner.animatedValues?.displaySize ?? 40;
      const ring = Math.max(this.size, bodySize + 34);
      const pulse = 0.5 + 0.5 * sin(frameCount / 7);

      push();
      translate(this.position.x, this.position.y);

      // a pool of dark under him
      noStroke();
      fill(20, 4, 38, 120);
      circle(0, 0, ring * 0.9);

      // the arc that drains: exactly how long the leap stays available
      noFill();
      stroke(10, 2, 20, 220);
      strokeWeight(9);
      circle(0, 0, ring);
      stroke(175, 105, 255, 235);
      strokeWeight(5);
      arc(0, 0, ring, ring, -HALF_PI, -HALF_PI + TWO_PI * left);

      // shadow spikes flaring off him while the window is open
      stroke(140, 70, 230, 120 + 90 * pulse);
      strokeWeight(3);
      for (let i = 0; i < 8; i++) {
        const a = (TWO_PI * i) / 8 - frameCount / 45;
        const r1 = ring / 2 + 4;
        const r2 = ring / 2 + 12 + 6 * pulse;
        line(cos(a) * r1, sin(a) * r1, cos(a) * r2, sin(a) * r2);
      }

      pop();
    }

    getDisplayBoundingBox() {
      const r = this.size;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Nocturne_R_Window;
}
const __cacheNocturne_R_Window = new WeakMap<ContentApi, ReturnType<typeof __buildNocturne_R_Window>>();
export function makeNocturne_R_Window(api: ContentApi) {
  const cached = __cacheNocturne_R_Window.get(api);
  if (cached) return cached;
  const built = __buildNocturne_R_Window(api);
  __cacheNocturne_R_Window.set(api, built);
  return built;
}


/** Where the leap ends: shadow slamming down on the victim. */
function __buildNocturne_R_Landing(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class Nocturne_R_Landing extends SpellObject {
    position = this.owner.position.copy();
    age = 0;
    lifeTime = 480;
    maxRadius = 120;

    update() {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const fade = 1 - t;

      push();
      translate(this.position.x, this.position.y);

      noFill();
      stroke(12, 3, 24, 230 * fade);
      strokeWeight(16 * fade + 2);
      circle(0, 0, this.maxRadius * 2 * (0.2 + t * 0.8));
      stroke(180, 110, 255, 245 * fade);
      strokeWeight(5 * fade + 1.5);
      circle(0, 0, this.maxRadius * 2 * (0.2 + t * 0.8));

      // three raking claw marks
      stroke(230, 200, 255, 250 * fade);
      strokeWeight(6 * fade + 2);
      for (let i = -1; i <= 1; i++) {
        const a = -0.5 + i * 0.42;
        const reach = this.maxRadius * (0.4 + t * 0.6);
        arc(0, 0, reach * 2, reach * 1.5, a - 0.55, a + 0.55);
      }

      const flash = 1 - constrain(t / 0.25, 0, 1);
      if (flash > 0) {
        noStroke();
        fill(210, 160, 255, 220 * flash);
        circle(0, 0, 60 * flash + 12);
      }

      pop();
    }

    getDisplayBoundingBox() {
      const r = this.maxRadius + 20;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Nocturne_R_Landing;
}
const __cacheNocturne_R_Landing = new WeakMap<ContentApi, ReturnType<typeof __buildNocturne_R_Landing>>();
export function makeNocturne_R_Landing(api: ContentApi) {
  const cached = __cacheNocturne_R_Landing.get(api);
  if (cached) return cached;
  const built = __buildNocturne_R_Landing(api);
  __cacheNocturne_R_Landing.set(api, built);
  return built;
}