import { Circle, Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import { PredefinedFilters } from '../../managers/ObjectManager';
import BuffAddType from '../../enums/BuffAddType';
import StatusFlags from '../../enums/StatusFlags';
import Buff from '../Buff';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import { StatsModifier } from '../Stats';
import Dash from '../buffs/Dash';
import Slow from '../buffs/Slow';
import Untargetable from '../buffs/Untargetable';

/**
 * Playful / Trickster.
 *
 * Fizz vaults onto his trident and hangs there completely untargetable for
 * 0.75s, then splashes down for AoE damage and a slow. Recasting while up there
 * (Trickster) drops him early: he hops to a new spot, hits a smaller area and
 * does not slow.
 */
export default class Fizz_E extends Spell {
  static PHASES = {
    GROUND: {
      image: AssetManager.get('spell_fizz_e'),
    },
    AIR: {
      // The wiki carries no separate icon for the second form, so the recast
      // reuses the base icon rather than falling back to a blank placeholder.
      image: AssetManager.get('spell_fizz_e'),
    },
  };
  phase: 'GROUND' | 'AIR' = 'GROUND';

  image = Fizz_E.PHASES[this.phase].image;
  name = 'Nghịch Ngợm / Tinh Quái (Fizz_E)';
  description =
    'Fizz chống đinh ba nhảy lên không, <span class="buff">Không thể bị chọn làm mục tiêu</span> trong <span class="time">0.75 giây</span>. Khi đáp xuống, gây <span class="damage">30 sát thương</span> quanh mình và <span class="buff">Làm Chậm</span> 50% trong <span class="time">2 giây</span>. Có thể tái kích hoạt lúc đang lơ lửng (<b>Tinh Quái</b>) để nhảy xuống sớm ở vị trí khác: phạm vi nhỏ hơn và <i>không làm chậm</i>';
  coolDown = 8000;
  manaCost = 30;

  maxRange = 400;
  /** Full Playful splash. */
  hitRadius = 140;
  /** Trickster lands harder to hit — a smaller area, no slow. */
  tricksterRadius = 90;
  /** How far the Trickster hop can carry him. */
  tricksterRange = 180;
  damage = 30;
  hoverDuration = 750;
  slowDuration = 2000;
  slowPercent = 0.5;
  dashSpeed = 14;
  /** Short lockout before the recast registers, so one keypress is not two. */
  recastDelay = 150;

  _hoverTimeLeft = 0;
  _landing = false;
  _dashBuff: Dash | null = null;
  _untargetableBuff: Untargetable | null = null;
  _hoverBuff: Fizz_E_Hover | null = null;

  checkCastCondition() {
    // Trickster is a drop, not a dash — it works even while rooted on the pole
    if (this.phase === 'AIR') return true;
    return Dash.CanDash(this.owner);
  }

  onSpellCast() {
    if (this.phase === 'AIR') {
      this._trickster();
      return;
    }

    const { to } = VectorUtils.getVectorWithMaxRange(
      this.owner.position,
      this.aimPoint,
      this.maxRange
    );

    this._untargetableBuff = new Untargetable(3000, this.owner, this.owner);
    this._untargetableBuff.image = Fizz_E.PHASES.AIR.image;
    this.owner.addBuff(this._untargetableBuff);

    // perched on the trident: can't walk, but can still recast
    this._hoverBuff = new Fizz_E_Hover(3000, this.owner, this.owner);
    this._hoverBuff.image = Fizz_E.PHASES.AIR.image;
    // cosmetic: lets the pole telegraph the splash it is about to drop
    this._hoverBuff.splashRadius = this.hitRadius;
    this._hoverBuff.hoverDuration = this.hoverDuration;
    this.owner.addBuff(this._hoverBuff);

    const dashBuff = new Dash(2000, this.owner, this.owner);
    dashBuff.image = Fizz_E.PHASES.AIR.image;
    dashBuff.dashDestination = to;
    dashBuff.dashSpeed = this.dashSpeed;
    dashBuff.showTrail = true;
    dashBuff.cancelable = false;
    this.owner.addBuff(dashBuff);
    this._dashBuff = dashBuff;

    this.phase = 'AIR';
    this.image = Fizz_E.PHASES.AIR.image;
    this._hoverTimeLeft = this.hoverDuration;
    this._landing = false;
    this.currentCooldown = this.recastDelay;
  }

  /** Recast: hop off the pole early, towards the cursor. */
  _trickster() {
    this._landing = true;
    this._hoverTimeLeft = 0;
    this.phase = 'GROUND';
    this.image = Fizz_E.PHASES.GROUND.image;

    this._dashBuff?.deactivateBuff?.();

    const { to } = VectorUtils.getVectorWithMaxRange(
      this.owner.position,
      this.aimPoint,
      this.tricksterRange
    );

    const hop = new Dash(1000, this.owner, this.owner);
    hop.image = Fizz_E.PHASES.GROUND.image;
    hop.dashDestination = to;
    hop.dashSpeed = 20;
    hop.showTrail = true;
    hop.cancelable = false;
    // stays untargetable until he actually touches down
    hop.onReachedDestination = () => this._splashDown(this.tricksterRadius, false);
    hop.onDeactivate = () => this._splashDown(this.tricksterRadius, false);
    this._dashBuff = hop;
    this.owner.addBuff(hop);
  }

  onUpdate() {
    if (this.phase !== 'AIR' || this._landing) return;

    this._hoverTimeLeft -= deltaTime;
    if (this._hoverTimeLeft <= 0) {
      this._landing = true;
      this.phase = 'GROUND';
      this.image = Fizz_E.PHASES.GROUND.image;
      this._dashBuff?.deactivateBuff?.(); // stop where he is and drop
      this._splashDown(this.hitRadius, true);
    }
  }

  /** Touchdown: end the airborne window and hit everything nearby. */
  _splashDown(radius: number, withSlow: boolean) {
    if (!this._untargetableBuff && !this._hoverBuff) return; // already resolved

    this._untargetableBuff?.deactivateBuff?.();
    this._hoverBuff?.deactivateBuff?.();
    this._untargetableBuff = null;
    this._hoverBuff = null;
    this._dashBuff = null;
    this._landing = false;
    this.phase = 'GROUND';
    this.image = Fizz_E.PHASES.GROUND.image;
    this.currentCooldown = this.coolDown;

    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.owner.position.x,
        y: this.owner.position.y,
        r: radius,
      }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    });

    enemies.forEach((enemy: any) => {
      enemy.takeDamage(this.damage, this.owner);

      if (withSlow) {
        const slowBuff = new Slow(this.slowDuration, this.owner, enemy);
        slowBuff.image = AssetManager.get('buff_slow');
        slowBuff.percent = this.slowPercent;
        enemy.addBuff(slowBuff);
      }
    });

    const obj = new Fizz_E_Object(this.owner);
    obj.hitRadius = radius;
    this.game.objectManager.addObject(obj);
  }

  drawPreview() {
    super.drawPreview(this.phase === 'AIR' ? this.tricksterRange : this.maxRange);
  }
}

/**
 * Perched on the trident: rooted (so he hangs where he vaulted to) but still
 * able to cast, which is what makes the Trickster recast possible. The height
 * bonus is what the renderer reads as "off the ground".
 */
export class Fizz_E_Hover extends Buff {
  name = 'Nghịch Ngợm';
  buffAddType = BuffAddType.REPLACE_EXISTING;

  height = 22;

  /** Cosmetic: the splash he is about to drop, drawn as a telegraph ring. */
  splashRadius = 140;
  /** Cosmetic: how long the perch lasts, for the countdown arc. */
  hoverDuration = 750;

  statusFlagsToEnable = StatusFlags.Rooted;
  statusFlagsToDisable = StatusFlags.CanMove;

  statsModifier: StatsModifier = new StatsModifier();

  onCreate(): void {
    this.statsModifier = new StatsModifier();
    this.statsModifier.height.baseBonus = this.height;
  }

  onActivate(): void {
    this.targetUnit.stats.addModifier(this.statsModifier);
  }

  onDeactivate(): void {
    this.targetUnit.stats.removeModifier(this.statsModifier);
  }

  draw(): void {
    const pos = this.targetUnit.position;
    const size = this.targetUnit.animatedValues.displaySize;
    // the pole plants well below him — the gap is what says "off the ground"
    const bottom = pos.y + size * 1.15;
    const left = constrain(1 - this.timeElapsed / this.hoverDuration, 0, 1);

    push();

    // the splash he is about to drop, so bystanders can walk out of it
    noFill();
    stroke(150, 225, 255, 120);
    strokeWeight(3);
    const segments = 26;
    for (let i = 0; i < segments; i++) {
      if (i % 2) continue;
      const a1 = (TWO_PI * i) / segments + frameCount / 90;
      const a2 = (TWO_PI * (i + 1)) / segments + frameCount / 90;
      arc(pos.x, bottom, this.splashRadius * 2, this.splashRadius * 2, a1, a2);
    }
    // the ring closes in as the perch runs out
    stroke(210, 250, 255, 200);
    strokeWeight(4);
    arc(
      pos.x,
      bottom,
      this.splashRadius * 2,
      this.splashRadius * 2,
      -HALF_PI,
      -HALF_PI + TWO_PI * left
    );

    // the shadow he cast on the ground: proof he is genuinely up in the air
    noStroke();
    fill(10, 25, 40, 130);
    ellipse(pos.x, bottom, size * 0.75, size * 0.28);

    // the trident he is balancing on, planted in that shadow
    stroke(40, 90, 110, 230);
    strokeWeight(8);
    line(pos.x, pos.y + size * 0.1, pos.x, bottom);
    stroke(150, 225, 245, 245);
    strokeWeight(4);
    line(pos.x, pos.y + size * 0.1, pos.x, bottom);

    // three prongs under his feet
    const prongY = pos.y + size * 0.12;
    stroke(40, 90, 110, 230);
    strokeWeight(7);
    line(pos.x - 11, prongY, pos.x + 11, prongY);
    line(pos.x - 11, prongY, pos.x - 11, prongY - 16);
    line(pos.x + 11, prongY, pos.x + 11, prongY - 16);
    line(pos.x, prongY, pos.x, prongY - 20);
    stroke(190, 245, 255, 250);
    strokeWeight(3);
    line(pos.x - 11, prongY, pos.x + 11, prongY);
    line(pos.x - 11, prongY, pos.x - 11, prongY - 16);
    line(pos.x + 11, prongY, pos.x + 11, prongY - 16);
    line(pos.x, prongY, pos.x, prongY - 20);

    // water running down the shaft and beading at the tip
    noStroke();
    fill(190, 240, 255, 180);
    for (let i = 0; i < 3; i++) {
      const t = ((frameCount / 30 + i / 3) % 1);
      circle(pos.x + sin(frameCount / 5 + i * 2) * 2, lerp(prongY, bottom, t), 5 * (1 - t) + 2);
    }
    pop();
  }
}

interface Splash {
  angle: number;
  speed: number;
  size: number;
  /** Droplets arc up and fall back, so each carries its own hop height. */
  hop: number;
}

const SPLASH_COUNT = 20;

export class Fizz_E_Object extends SpellObject {
  position: p5.Vector = this.owner.position.copy();
  hitRadius = 140;
  lifeTime = 550;
  age = 0;

  _splashes: Splash[] = [];

  onAdded() {
    for (let i = 0; i < SPLASH_COUNT; i++) {
      this._splashes.push({
        angle: (TWO_PI * i) / SPLASH_COUNT + random(-0.15, 0.15),
        speed: random(0.75, 1.05),
        size: random(8, 18),
        hop: random(10, 26),
      });
    }
  }

  update() {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) {
      this.toRemove = true;
    }
  }

  draw() {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const fade = 1 - t;
    const flash = 1 - constrain(t / 0.22, 0, 1);

    push();
    translate(this.position.x, this.position.y);

    // the puddle left behind covers exactly what was hit: whoever took damage
    // is standing inside this disc, and can see that they were
    noStroke();
    fill(120, 205, 245, 110 * fade);
    circle(0, 0, this.hitRadius * 2 * (0.5 + t * 0.5));

    // hard rim on the hit radius, so the boundary is not a guess
    noFill();
    stroke(35, 90, 130, 200 * fade);
    strokeWeight(9 * fade + 2);
    circle(0, 0, this.hitRadius * 2);
    stroke(215, 250, 255, 245 * fade);
    strokeWeight(4 * fade + 1.5);
    circle(0, 0, this.hitRadius * 2);

    // the wave itself racing out to that rim
    stroke(180, 240, 255, 230 * fade);
    strokeWeight(10 * fade + 2);
    circle(0, 0, this.hitRadius * 2 * (0.2 + t * 0.8));

    // crown of water thrown up at the point of landing
    noStroke();
    for (const splash of this._splashes) {
      const distance = this.hitRadius * t * splash.speed;
      // parabola: up first, then back down into the puddle
      const lift = sin(constrain(t, 0, 1) * PI) * splash.hop;
      fill(225, 250, 255, 235 * fade);
      circle(
        cos(splash.angle) * distance,
        sin(splash.angle) * distance - lift,
        splash.size * (1 - t * 0.7)
      );
    }

    // the impact flash, gone almost as soon as it appears
    if (flash > 0) {
      noStroke();
      fill(255, 255, 255, 220 * flash);
      circle(0, 0, this.hitRadius * 0.9 * flash + 20);
      stroke(255, 255, 255, 255 * flash);
      strokeWeight(5);
      noFill();
      circle(0, 0, this.hitRadius * 1.3 * (1 - flash) + 20);
    }

    pop();
  }

  getDisplayBoundingBox() {
    const r = this.hitRadius + 40;
    return new Rectangle({
      x: this.position.x - r,
      y: this.position.y - r,
      w: r * 2,
      h: r * 2,
      data: this,
    });
  }
}
