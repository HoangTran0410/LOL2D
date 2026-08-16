import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import Spell from '../Spell';
import Dash from '../buffs/Dash';
import Buff from '../Buff';
import EventType from '../../enums/EventType';
import { PredefinedFilters } from '../../managers/ObjectManager';
import { Circle, Rectangle } from '../../../libs/quadtree';
import SpellObject from '../SpellObject';

export const EKKO_E_BLINK_DAMAGE = 25;
export const EKKO_E_WINDOW_MS = 5000;
export const EKKO_E_SEEK_RADIUS = 250;

export default class Ekko_E extends Spell {
  targetingMode = 'DIRECTION' as const;
  image = AssetManager.get('spell_ekko_e');
  name = 'Biến Chuyển Pha (Ekko_E)';
  description =
    '<span class="buff">Lướt</span> theo hướng chỉ định. Tái kích hoạt E hoặc đánh thường trong <span class="time">5 giây</span> để dịch chuyển tới kẻ địch và gây thêm <span class="damage">25 sát thương</span>.';
  coolDown = 9000;
  manaCost = 40;
  range = 250;

  activeBuff: Ekko_E_Buff | null = null;

  checkCastCondition() {
    return Dash.CanDash(this.owner);
  }

  onSpellCast() {
    if (this.activeBuff && !this.activeBuff.toRemove) {
      // Recast E2: Blink to nearest enemy near aim point
      const mouse = this.aimPoint;
      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({ x: mouse.x, y: mouse.y, r: EKKO_E_SEEK_RADIUS }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      });

      if (enemies.length > 0) {
        let nearest = enemies[0];
        let minD = mouse.dist(nearest.position);
        for (const enemy of enemies) {
          const d = mouse.dist(enemy.position);
          if (d < minD) {
            minD = d;
            nearest = enemy;
          }
        }
        nearest.takeDamage(EKKO_E_BLINK_DAMAGE, this.owner);
        const blinkPos = VectorUtils.getVectorWithRange(
          nearest.position,
          this.owner.position,
          nearest.stats.size.value / 2 + this.owner.stats.size.value / 2 + 10
        ).to;

        // a blink is one frame of movement: without a rift drawn between the two
        // points nobody can tell where he went, or that he went at all
        this.spawnRift(this.owner.position.copy(), blinkPos, nearest.position.copy());

        this.owner.position.set(blinkPos.x, blinkPos.y);
        this.owner.destination.set(blinkPos.x, blinkPos.y);
        this.activeBuff.deactivateBuff();
        this.activeBuff = null;
        return;
      }
    }

    // E1 initial dash
    const { to: dashDest } = VectorUtils.getVectorWithRange(
      this.owner.position,
      this.aimPoint,
      this.range
    );

    const dashBuff = new Dash(1000, this.owner, this.owner);
    dashBuff.image = this.image;
    dashBuff.dashDestination = dashDest;
    dashBuff.dashSpeed = 14;
    dashBuff.onDashUpdate = () => {
      if (frameCount % 2 === 0) {
        const afterimage = new Ekko_E_Afterimage(
          this.owner,
          this.owner.position.x,
          this.owner.position.y
        );
        this.game.objectManager.addObject(afterimage);
      }
    };
    this.owner.addBuff(dashBuff);

    // Apply Ekko E empowered attack / recast buff
    const empoweredBuff = new Ekko_E_Buff(EKKO_E_WINDOW_MS, this.owner, this.owner);
    this.activeBuff = empoweredBuff;
    this.owner.addBuff(empoweredBuff);
  }

  spawnRift(from: p5.Vector, to: p5.Vector, victim: p5.Vector) {
    const rift = new Ekko_E_Rift(this.owner, from, to, victim);
    this.game.objectManager.addObject(rift);
  }
}

/**
 * One frame of Ekko left behind by the dash.
 *
 * Sized off the owner's body rather than a fixed 35px, so it reads as a ghost of
 * *him* — a plain dot the same size regardless of the champion is the shape that
 * makes every dash in a game look identical.
 */
export class Ekko_E_Afterimage extends SpellObject {
  lifeTime = 280;
  timer = 0;
  x: number;
  y: number;
  bodySize: number;

  constructor(owner: any, x: number, y: number) {
    super(owner);
    this.x = x;
    this.y = y;
    this.bodySize = owner?.stats?.size?.value ?? 30;
    this.position = createVector(x, y);
  }

  update() {
    this.timer += deltaTime;
    if (this.timer >= this.lifeTime) {
      this.toRemove = true;
    }
  }

  draw() {
    const t = constrain(this.timer / this.lifeTime, 0, 1);
    const fade = 1 - t;
    push();
    translate(this.x, this.y);
    // the silhouette collapses inward as it fades, so the trail has direction
    noStroke();
    fill(0, 240, 220, 130 * fade);
    circle(0, 0, this.bodySize * (1 - t * 0.45));
    noFill();
    stroke(150, 255, 245, 200 * fade);
    strokeWeight(2);
    circle(0, 0, this.bodySize * (1 - t * 0.45));
    // a stuttered second ghost: time skipping, not motion blur
    fill(180, 120, 255, 70 * fade);
    noStroke();
    circle(0, 0, this.bodySize * 0.55 * (1 - t * 0.3));
    pop();
  }

  getDisplayBoundingBox() {
    const r = this.bodySize;
    return new Rectangle({
      x: this.x - r,
      y: this.y - r,
      w: r * 2,
      h: r * 2,
      data: this,
    });
  }
}

/** The tear left between where Ekko was and where he reappeared. */
export class Ekko_E_Rift extends SpellObject {
  from: p5.Vector;
  to: p5.Vector;
  victim: p5.Vector;
  lifeTime = 340;
  timer = 0;

  constructor(owner: any, from: p5.Vector, to: p5.Vector, victim: p5.Vector) {
    super(owner);
    this.from = from;
    this.to = to;
    this.victim = victim;
    this.position = to.copy();
  }

  update() {
    this.timer += deltaTime;
    if (this.timer >= this.lifeTime) this.toRemove = true;
  }

  draw() {
    const t = constrain(this.timer / this.lifeTime, 0, 1);
    const fade = 1 - t;

    push();
    // the seam he travelled along, drawn as a jagged tear rather than a line
    stroke(180, 120, 255, 200 * fade);
    strokeWeight(4 * fade + 1);
    noFill();
    beginShape();
    const steps = 10;
    for (let i = 0; i <= steps; i++) {
      const k = i / steps;
      const jitter = i === 0 || i === steps ? 0 : sin(k * 12 + this.timer * 0.03) * 9 * fade;
      const nx = -(this.to.y - this.from.y);
      const ny = this.to.x - this.from.x;
      const len = Math.hypot(nx, ny) || 1;
      vertex(
        lerp(this.from.x, this.to.x, k) + (nx / len) * jitter,
        lerp(this.from.y, this.to.y, k) + (ny / len) * jitter
      );
    }
    endShape();
    stroke(150, 255, 245, 230 * fade);
    strokeWeight(2);
    line(this.from.x, this.from.y, this.to.x, this.to.y);

    // where he left
    noStroke();
    fill(0, 240, 220, 150 * fade);
    circle(this.from.x, this.from.y, 34 * fade + 6);

    // the hit on the body he blinked to
    noFill();
    stroke(255, 255, 255, 235 * fade);
    strokeWeight(4 * fade + 1);
    circle(this.victim.x, this.victim.y, 26 + 46 * t);
    pop();
  }

  getDisplayBoundingBox() {
    const minX = Math.min(this.from.x, this.to.x, this.victim.x) - 45;
    const minY = Math.min(this.from.y, this.to.y, this.victim.y) - 45;
    const maxX = Math.max(this.from.x, this.to.x, this.victim.x) + 45;
    const maxY = Math.max(this.from.y, this.to.y, this.victim.y) + 45;
    return new Rectangle({ x: minX, y: minY, w: maxX - minX, h: maxY - minY, data: this });
  }
}

export class Ekko_E_Buff extends Buff {
  image = AssetManager.get('spell_ekko_e');
  name = 'Biến Chuyển Pha (Cường Hóa)';
  private stopListening?: () => void;
  private auraObj: Ekko_E_AuraObject | null = null;

  onActivate() {
    this.auraObj = new Ekko_E_AuraObject(this.targetUnit, this);
    this.auraObj.attachTo(this.targetUnit, this);
    this.game.objectManager.addObject(this.auraObj);

    this.stopListening = this.game.eventManager.on(
      EventType.ON_ATTACK_HIT,
      ({ attacker, victim }: any) => {
        if (attacker === this.targetUnit && victim) {
          victim.takeDamage(EKKO_E_BLINK_DAMAGE, this.targetUnit);
          const dir = VectorUtils.getVectorWithRange(
            victim.position,
            this.targetUnit.position,
            victim.stats.size.value / 2 + this.targetUnit.stats.size.value / 2 + 10
          );
          const rift = new Ekko_E_Rift(
            this.targetUnit,
            this.targetUnit.position.copy(),
            dir.to.copy(),
            victim.position.copy()
          );
          this.game.objectManager.addObject(rift);
          this.targetUnit.position.set(dir.to.x, dir.to.y);
          this.deactivateBuff();
        }
      }
    );
  }

  onDeactivate() {
    if (this.auraObj) {
      this.auraObj.toRemove = true;
      this.auraObj = null;
    }
    if (this.stopListening) {
      this.stopListening();
      this.stopListening = undefined;
    }
  }
}

const EKKO_E_AURA_RADIUS = 40;

/**
 * The recast window sitting on Ekko.
 *
 * The clock hand ticks in twelve discrete steps rather than sweeping smoothly —
 * a second hand, not a fan. It is the cheapest way to say "time" in a game where
 * half the champions already have a spinning ring on the floor.
 */
export class Ekko_E_AuraObject extends SpellObject {
  buffRef: Buff;

  constructor(owner: any, buffRef: Buff) {
    super(owner);
    this.buffRef = buffRef;
  }

  update() {
    if (this.dropIfAttachmentLost()) return;
    if (!this.owner || this.owner.toRemove || this.buffRef.toRemove) {
      this.toRemove = true;
      return;
    }
    this.position.set(this.owner.position.x, this.owner.position.y);
  }

  draw() {
    if (!this.owner) return;
    push();
    translate(this.owner.position.x, this.owner.position.y);

    // how much of the recast window is left
    const left = constrain(
      1 - this.buffRef.timeElapsed / (this.buffRef.duration || EKKO_E_WINDOW_MS),
      0,
      1
    );

    noFill();
    stroke(0, 120, 130, 150);
    strokeWeight(3);
    circle(0, 0, EKKO_E_AURA_RADIUS * 2);
    stroke(0, 245, 225, 220);
    strokeWeight(3);
    arc(
      0,
      0,
      EKKO_E_AURA_RADIUS * 2,
      EKKO_E_AURA_RADIUS * 2,
      -HALF_PI,
      -HALF_PI + TWO_PI * left
    );

    // ticking second hand — snaps between twelve positions
    const tick = Math.floor((frameCount / 10) % 12);
    push();
    rotate(-HALF_PI + (TWO_PI / 12) * tick);
    stroke(255, 255, 255, 230);
    strokeWeight(3);
    line(0, 0, EKKO_E_AURA_RADIUS * 0.72, 0);
    pop();
    // hour hand, half speed
    push();
    rotate(-HALF_PI + (TWO_PI / 12) * Math.floor((frameCount / 120) % 12));
    stroke(180, 120, 255, 220);
    strokeWeight(3);
    line(0, 0, EKKO_E_AURA_RADIUS * 0.44, 0);
    pop();
    noStroke();
    fill(220, 255, 250, 240);
    circle(0, 0, 6);
    pop();
  }

  getDisplayBoundingBox() {
    const r = EKKO_E_AURA_RADIUS + 12;
    return new Rectangle({
      x: this.position.x - r,
      y: this.position.y - r,
      w: r * 2,
      h: r * 2,
      data: this,
    });
  }
}
