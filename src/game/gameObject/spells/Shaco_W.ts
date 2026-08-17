import { Circle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import Pet from '../attackableUnits/Pet';
import type AttackableUnit from '../attackableUnits/AttackableUnit';
import Fear from '../buffs/Fear';
import TrailSystem from '../helpers/TrailSystem';
import { Rectangle } from '../../../libs/quadtree';

export const ARM_TIME_MS = 1000;
export const LIFETIME_MS = 20000;
export const FEAR_RANGE = 70;
export const FEAR_DURATION_MS = 1000;
export const ATTACK_WINDOW_MS = 3000;
export const ATTACK_RANGE = 160;
export const ATTACK_DAMAGE = 7;
export const ATTACKS_PER_SECOND = 2;
export const BOX_HEALTH = 30;

export default class Shaco_W extends Spell {
  targetingMode = 'POINT' as const;
  image = AssetManager.get('spell_shaco_w');
  name = 'Hộp Hề Ma Quái (Shaco_W)';
  description =
    `Đặt một Hộp Hề Ma Quái, tàng hình sau <span class="time">${ARM_TIME_MS / 1000} giây</span> và tồn tại` +
    ` <span class="time">${LIFETIME_MS / 1000} giây</span>. Khi kẻ địch tới gần, hộp bật ra:` +
    ` <span class="buff">Hoảng Sợ</span> chúng rồi bắn trong <span class="time">${ATTACK_WINDOW_MS / 1000} giây</span>,` +
    ` <span class="damage">${ATTACK_DAMAGE} sát thương</span> mỗi phát. Lúc tàng hình <span class="buff">không thể bị chọn</span>,` +
    ` nhưng khi đã bật ra thì <span class="damage">có thể bị phá</span> (${BOX_HEALTH} máu)`;
  coolDown = 5000;

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
        attack: { damage: ATTACK_DAMAGE, attacksPerSecond: ATTACKS_PER_SECOND, range: ATTACK_RANGE },
      },
    });
    box.slideTo = to;
    this.game.objectManager.addObject(box);
  }
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
export class Shaco_W_Box extends Pet {
  /** Where it is being lobbed to; it slides there over the arming second. */
  slideTo: p5.Vector | null = null;
  slideSpeed = 6;
  armed = false;
  triggered = false;
  /** Cosmetic: the radius circle grows into whichever range is live. */
  rangeToDraw = 0;

  constructor(options: ConstructorParameters<typeof Pet>[0]) {
    super(options);
    this.stats.maxHealth.baseValue = BOX_HEALTH;
    this.stats.health.baseValue = BOX_HEALTH;
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
      this.rangeToDraw = lerp(this.rangeToDraw, FEAR_RANGE, 0.1);
      this.checkTrigger();
      return;
    }
    if (this.triggered) this.rangeToDraw = lerp(this.rangeToDraw, ATTACK_RANGE, 0.1);
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

  /** The box, not a champion portrait. Everything else — health bar, buffs — is the base's. */
  drawAvatar(): void {
    if (this.hidden) {
      // A hint only its owner can act on; enemies see nothing at all because
      // `Stealthed` keeps the whole unit out of their render pass.
      noStroke();
      fill(255, 30);
      circle(this.position.x, this.position.y, 35);
      return;
    }

    const spring = this.triggered ? 6 + 4 * Math.sin(this.age / 90) : 0;
    push();
    translate(this.position.x, this.position.y);
    stroke(120, 70, 40);
    strokeWeight(2);
    fill(190, 120, 60);
    rect(-14, -14 + spring * 0.3, 28, 28, 4);
    if (this.triggered) {
      // the jester springing out of the lid
      stroke(200, 60, 60);
      strokeWeight(3);
      noFill();
      line(0, -14, 0, -20 - spring);
      fill(230, 90, 90);
      noStroke();
      circle(0, -24 - spring, 14);
    }
    pop();

    if (this.rangeToDraw <= 1) return;
    push();
    noFill();
    stroke(120, this.triggered ? 150 : 60);
    circle(this.position.x, this.position.y, this.rangeToDraw * 2);
    pop();
  }

  getDisplayBoundingBox() {
    const span = Math.max(60, this.rangeToDraw);
    return this.squareDisplayBoundingBox(span * 2);
  }
}

export class Shaco_W_Bullet_Object extends SpellObject {
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
