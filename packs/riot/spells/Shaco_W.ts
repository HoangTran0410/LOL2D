import type { ContentApi } from '@moba2d/core/content/ContentApi';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Fear = InstanceType<ContentApi['buffs']['Fear']>;
type Pet = InstanceType<ContentApi['units']['Pet']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type Shaco_W = InstanceType<ReturnType<typeof makeShaco_W>>;
type Shaco_W_Box = InstanceType<ReturnType<typeof makeShaco_W_Box>>;
type Shaco_W_Bullet_Object = InstanceType<ReturnType<typeof makeShaco_W_Bullet_Object>>;



export const ARM_TIME_MS = 1000;

export const LIFETIME_MS = 20000;

export const FEAR_RANGE = 80;

export const FEAR_DURATION_MS = 1000;

export const ATTACK_WINDOW_MS = 4000;

export const ATTACK_RANGE = 160;

export const ATTACK_DAMAGE = 7;

export const ATTACKS_PER_SECOND = 2;

export const BOX_HEALTH = 30;


function __buildShaco_W(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Shaco_W_Box = makeShaco_W_Box(api);
  class Shaco_W extends Spell {
    targetingMode = 'POINT' as const;
    image = api.asset('spell_shaco_w');
    name = 'Hộp Hề Ma Quái (Shaco_W)';
    description =
      `Đặt một Hộp Hề Ma Quái, tàng hình sau <span class="time">${ARM_TIME_MS / 1000} giây</span> và tồn tại` +
      ` <span class="time">${LIFETIME_MS / 1000} giây</span>. Khi kẻ địch tới gần, hộp bật ra:` +
      ` <span class="buff">Hoảng Sợ</span> và nã <span class="damage">mọi kẻ địch xung quanh</span> trong <span class="time">${ATTACK_WINDOW_MS / 1000} giây</span>,` +
      ` <span class="damage">${ATTACK_DAMAGE} sát thương</span> mỗi phát. Lúc tàng hình <span class="buff">không thể bị chọn</span>,` +
      ` nhưng khi đã bật ra thì <span class="damage">có thể bị phá</span> (${BOX_HEALTH} máu)`;
    coolDown = 5000;
    manaCost = 20;

    onSpellCast() {
      const { from, to } = VectorUtils.getVectorWithMaxRange(this.owner.position, this.aimPoint, 100);

      const box = new Shaco_W_Box({
        game: this.game,
        position: from,
        teamId: this.owner.teamId,
        ownerUnit: this.owner,
        lifeTimeMs: LIFETIME_MS,
        stationary: true,
        followsOwner: false,
        aggroRadius: ATTACK_RANGE,
        preset: {
          name: 'Hộp Hề Ma Quái',
          spells: [],
          attack: {
            damage: ATTACK_DAMAGE,
            attacksPerSecond: ATTACKS_PER_SECOND,
            range: ATTACK_RANGE,
          },
        },
      });
      box.slideTo = to;
      this.game.objectManager.addObject(box);
    }
  }
  return Shaco_W;
}
const __cacheShaco_W = new WeakMap<ContentApi, ReturnType<typeof __buildShaco_W>>();
export default function makeShaco_W(api: ContentApi) {
  const cached = __cacheShaco_W.get(api);
  if (cached) return cached;
  const built = __buildShaco_W(api);
  __cacheShaco_W.set(api, built);
  return built;
}


/**
 * The box, as a unit.
 *
 * It used to be a `SpellObject` that ran its own attack loop and could not be
 * touched — an enemy walking into a Shaco box had no answer except to leave.
 * As a `Pet` it is a real body: it shows up in queries, it has 30 health, and
 * once it has popped out and started shooting, killing it is the answer.
 *
 * What it must *not* be is targetable while it is still hidden — a trap you
 * can right-click before it triggers is not a trap. `Pet.setHidden` pairs
 * `Invisible` with `Untargetable` for exactly this, and the reveal takes both
 * off in the same call the fear goes out in.
 */
function __buildShaco_W_Box(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const VectorUtils = api.utils.VectorUtils;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Pet = api.units.Pet;
  const AttackableUnit = api.units.AttackableUnit;
  const Fear = api.buffs.Fear;
  const Shaco_W_Bullet_Object = makeShaco_W_Bullet_Object(api);
  class Shaco_W_Box extends Pet {
    /** Where it is being lobbed to; it slides there over the arming second. */
    slideTo: p5.Vector | null = null;
    slideSpeed = 6;
    armed = false;
    triggered = false;
    /** Counts down between volleys once popped; at 0 the next tick fires. */
    attackCooldown = 0;

    constructor(options: ConstructorParameters<typeof Pet>[0]) {
      super(options);
      this.stats.maxHealth.baseValue = BOX_HEALTH;
      this.stats.health.baseValue = BOX_HEALTH;
    }

    /**
     * A phantom trap: enemies can shoot it and hit it with spells, but it never
     * shoves a champion off their path — walking over the box is free. Excluding
     * it from `UnitCollisionSystem` (which skips any unit whose collidesWithUnits
     * is false) is all it takes; the box still sits in every gameplay query.
     */
    get collidesWithUnits(): boolean {
      return false;
    }

    update(): void {
      // The slide happens before anything else so the box is at its resting spot
      // by the time it arms — a box that armed mid-flight would fear from the
      // wrong place.
      if (this.slideTo && this.position.dist(this.slideTo) > this.slideSpeed) {
        VectorUtils.moveVectorToVector(this.position, this.slideTo, this.slideSpeed);
      }

      super.update();
      if (this.toRemove || this.isDead) return;

      if (!this.armed && this.age >= ARM_TIME_MS) {
        this.armed = true;
        this.setHidden(true);
      }

      if (this.armed && !this.triggered) {
        this.checkTrigger();
        return;
      }
      if (this.triggered) this.fireVolley();
    }

    /**
     * A single-target basic attack is the wrong shape for a trap: a box that pops
     * in the middle of a wave should punish the whole wave, not lock one body and
     * ignore the rest. So the box takes no `orderAttack` — findTarget stays null —
     * and drives its own barrage in `fireVolley` instead.
     */
    findTarget(): AttackableUnit | null {
      return null;
    }

    /**
     * One bolt at every enemy inside ATTACK_RANGE, on the attack clock. This is an
     * area effect, not an acquisition, so it is not vision-gated — the same rule
     * `checkTrigger`'s fear plays by: a body that stepped on the box in a bush
     * still eats the volley.
     */
    fireVolley(): void {
      this.attackCooldown -= deltaTime;
      if (this.attackCooldown > 0) return;
      this.attackCooldown = 1000 / ATTACKS_PER_SECOND;

      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({ x: this.position.x, y: this.position.y, r: ATTACK_RANGE }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.teamId)],
      }) as AttackableUnit[];

      for (const enemy of enemies) {
        const bolt = new Shaco_W_Bullet_Object(this);
        bolt.position = this.position.copy();
        bolt.targetEnemy = enemy;
        bolt.damage = ATTACK_DAMAGE;
        this.game.objectManager.addObject(bolt);
      }
    }

    /** Someone stepped on it: fear the room, come out of hiding, start the clock. */
    checkTrigger(): void {
      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({ x: this.position.x, y: this.position.y, r: FEAR_RANGE }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.teamId)],
      }) as AttackableUnit[];
      if (enemies.length === 0) return;

      this.triggered = true;
      this.setHidden(false);
      // Its whole remaining life is the shooting window — the box is spent once
      // it has popped, whether or not the 20 seconds were up.
      this.lifeTimeMs = this.age + ATTACK_WINDOW_MS;

      for (const enemy of enemies) {
        const fear = new Fear(FEAR_DURATION_MS, this.ownerUnit, enemy);
        fear.sourcePosition = this.position.copy();
        enemy.addBuff(fear);
      }
    }

    /**
     * A jack-in-the-box, not a champion portrait: a lidded wind-up box while it
     * waits, the jester flung out on a coil once it pops. No range ring — the toy
     * itself is the whole telegraph.
     */
    drawAvatar(): void {
      if (this.hidden) {
        // Owner-only hint at the buried box; enemies see nothing at all because
        // `Stealthed` keeps the whole unit out of their render pass.
        push();
        translate(this.position.x, this.position.y);
        noStroke();
        fill(255, 26);
        rect(-9, -9, 18, 18, 3);
        pop();
        return;
      }

      const bob = this.triggered ? 6 + 4 * Math.sin(this.age / 90) : 0;
      push();
      translate(this.position.x, this.position.y);

      // the crate body — jester red with a yellow front band and a diamond, so it
      // reads as a toy box rather than a plain barrel
      stroke(40, 20, 60);
      strokeWeight(2);
      fill(150, 40, 60);
      rect(-14, -12, 28, 24, 4);
      noStroke();
      fill(240, 200, 70);
      rect(-14, 2, 28, 8, 0, 0, 3, 3);
      fill(150, 40, 60);
      push();
      rotate(QUARTER_PI);
      rect(-4, 2, 8, 8);
      pop();

      if (!this.triggered) {
        // closed lid + a wind-up crank on the side
        stroke(40, 20, 60);
        strokeWeight(2);
        fill(120, 30, 50);
        rect(-15, -16, 30, 6, 3);
        stroke(70, 70, 82);
        strokeWeight(2);
        noFill();
        line(15, -7, 20, -7);
        line(20, -7, 20, -13);
        noStroke();
        fill(96, 96, 110);
        circle(20, -13, 5);
      } else {
        // lid flung open at the hinge, jester on a coil
        push();
        translate(-15, -16);
        rotate(-0.8);
        stroke(40, 20, 60);
        strokeWeight(2);
        fill(120, 30, 50);
        rect(0, -6, 30, 6, 3);
        pop();

        const headY = -18 - bob;
        stroke(225, 215, 120);
        strokeWeight(2);
        noFill();
        beginShape();
        const links = 24;
        for (let i = 0; i <= links; i++) {
          const t = i / links;
          vertex(Math.sin(t * 3 * TWO_PI) * 6, lerp(-10, headY + 7, t));
        }
        endShape();

        push();
        translate(0, headY);
        // two-point jester hat with bells
        stroke(40, 20, 60);
        strokeWeight(1.5);
        fill(70, 120, 200);
        triangle(-8, -3, -13, -13, -1, -7);
        triangle(8, -3, 13, -13, 1, -7);
        noStroke();
        fill(240, 220, 90);
        circle(-13, -13, 4);
        circle(13, -13, 4);
        // face
        stroke(40, 20, 60);
        strokeWeight(1.5);
        fill(245, 222, 194);
        circle(0, 0, 15);
        noStroke();
        fill(40, 20, 60);
        circle(-3, -1, 2.5);
        circle(3, -1, 2.5);
        fill(220, 70, 70);
        circle(0, 3, 3.5);
        noFill();
        stroke(40, 20, 60);
        strokeWeight(1.5);
        arc(0, 1, 8, 7, 0, PI);
        pop();
      }

      pop();
    }

    getDisplayBoundingBox() {
      // Covers the crate and the jester at the top of its coil; the bolts it fires
      // are their own SpellObjects with their own boxes.
      return this.squareDisplayBoundingBox(120);
    }
  }
  return Shaco_W_Box;
}
const __cacheShaco_W_Box = new WeakMap<ContentApi, ReturnType<typeof __buildShaco_W_Box>>();
export function makeShaco_W_Box(api: ContentApi) {
  const cached = __cacheShaco_W_Box.get(api);
  if (cached) return cached;
  const built = __buildShaco_W_Box(api);
  __cacheShaco_W_Box.set(api, built);
  return built;
}


function __buildShaco_W_Bullet_Object(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const SpellObject = api.SpellObject;
  const TrailSystem = api.helpers.TrailSystem;
  class Shaco_W_Bullet_Object extends SpellObject {
    isMissile = true;
    position: p5.Vector = createVector();
    targetEnemy: any = null;
    speed = 10;
    damage = 7;
    hitEffectDuration = 300;
    timeSinceHit = 0;

    static PHASES = {
      MOVING: 0,
      HIT_EFFECT: 1,
    } as const;
    phase: (typeof Shaco_W_Bullet_Object.PHASES)[keyof typeof Shaco_W_Bullet_Object.PHASES] =
      Shaco_W_Bullet_Object.PHASES.MOVING;

    // for display
    lazerWidth = 5;
    lazerLength = 20;
    strokeColor: [number, number, number] = [255, 255, 0];
    fillColor: [number, number, number] = [255, 150, 0];

    trailSystem = new TrailSystem({
      trailColor: [...this.strokeColor, 50] as any,
      trailSize: this.lazerWidth,
      maxLength: 10,
    });

    onAdded() {
      this.game.objectManager.addObject(this.trailSystem);
    }

    update() {
      // move phase
      if (this.phase === Shaco_W_Bullet_Object.PHASES.MOVING) {
        if (this.position.dist(this.targetEnemy.position) > this.speed) {
          VectorUtils.moveVectorToVector(this.position, this.targetEnemy.position, this.speed);
          this.trailSystem.addTrail(this.position);
        } else {
          // hit target
          this.targetEnemy.takeDamage(this.damage, this.owner);
          this.phase = Shaco_W_Bullet_Object.PHASES.HIT_EFFECT;
        }
      }

      // hit effect phase
      else if (this.phase === Shaco_W_Bullet_Object.PHASES.HIT_EFFECT) {
        this.timeSinceHit += deltaTime;
        if (this.timeSinceHit >= this.hitEffectDuration) {
          this.toRemove = true;
        }
      }
    }

    draw() {
      push();

      // move phase
      if (this.phase === Shaco_W_Bullet_Object.PHASES.MOVING) {
        const dir = VectorUtils.getDirectionVector(this.position, this.targetEnemy.position);
        strokeWeight(this.lazerWidth);
        stroke(...this.strokeColor);
        line(
          this.position.x - dir.x * this.lazerLength,
          this.position.y - dir.y * this.lazerLength,
          this.position.x,
          this.position.y
        );
      }

      // hit effect phase
      else if (this.phase === Shaco_W_Bullet_Object.PHASES.HIT_EFFECT) {
        // draw circle around target
        const targetSize = this.targetEnemy.stats.size.value;
        const alpha = map(this.timeSinceHit, 0, this.hitEffectDuration, 150, 0);
        const size = map(this.timeSinceHit, 0, this.hitEffectDuration, targetSize, targetSize + 50);
        stroke(...this.strokeColor, alpha + 20);
        fill(...this.fillColor, alpha);
        circle(this.targetEnemy.position.x, this.targetEnemy.position.y, size);
      }
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox(this.lazerLength * 2);
    }
  }
  return Shaco_W_Bullet_Object;
}
const __cacheShaco_W_Bullet_Object = new WeakMap<ContentApi, ReturnType<typeof __buildShaco_W_Bullet_Object>>();
export function makeShaco_W_Bullet_Object(api: ContentApi) {
  const cached = __cacheShaco_W_Bullet_Object.get(api);
  if (cached) return cached;
  const built = __buildShaco_W_Bullet_Object(api);
  __cacheShaco_W_Bullet_Object.set(api, built);
  return built;
}