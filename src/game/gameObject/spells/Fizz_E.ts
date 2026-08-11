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
      image: AssetManager.getAsset('spell_fizz_e'),
    },
    AIR: {
      image: AssetManager.getAsset('spell_fizz_e2'),
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
      this.game.worldMouse,
      this.maxRange
    );

    this._untargetableBuff = new Untargetable(3000, this.owner, this.owner);
    this._untargetableBuff.image = Fizz_E.PHASES.AIR.image;
    this.owner.addBuff(this._untargetableBuff);

    // perched on the trident: can't walk, but can still recast
    this._hoverBuff = new Fizz_E_Hover(3000, this.owner, this.owner);
    this._hoverBuff.image = Fizz_E.PHASES.AIR.image;
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
      this.game.worldMouse,
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
        slowBuff.image = AssetManager.getAsset('buff_slow');
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
    const bottom = pos.y + size * 0.75;

    push();
    // the trident he is balancing on
    stroke(120, 200, 210, 220);
    strokeWeight(4);
    line(pos.x, pos.y, pos.x, bottom);

    strokeWeight(3);
    const prongY = pos.y + size * 0.1;
    line(pos.x - 7, prongY, pos.x - 7, prongY - 10);
    line(pos.x + 7, prongY, pos.x + 7, prongY - 10);
    line(pos.x - 7, prongY, pos.x + 7, prongY);

    // a little wobble at the tip so the balance reads as precarious
    noStroke();
    fill(190, 240, 255, 150);
    circle(pos.x + sin(frameCount / 4) * 2, bottom, 8);
    pop();
  }
}

interface Splash {
  angle: number;
  speed: number;
  size: number;
}

const SPLASH_COUNT = 12;

export class Fizz_E_Object extends SpellObject {
  position: p5.Vector = this.owner.position.copy();
  hitRadius = 140;
  lifeTime = 500;
  age = 0;

  _splashes: Splash[] = [];

  onAdded() {
    for (let i = 0; i < SPLASH_COUNT; i++) {
      this._splashes.push({
        angle: (TWO_PI * i) / SPLASH_COUNT + random(-0.2, 0.2),
        speed: random(0.7, 1.1),
        size: random(6, 14),
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
    const t = this.age / this.lifeTime;

    push();

    // shockwave ring pushing outwards
    noFill();
    stroke(140, 220, 255, 220 * (1 - t));
    strokeWeight(6 * (1 - t) + 2);
    circle(this.position.x, this.position.y, this.hitRadius * 2 * (0.35 + t * 0.65));

    // droplets flying off the landing point
    noStroke();
    fill(190, 240, 255, 200 * (1 - t));
    for (const splash of this._splashes) {
      const distance = this.hitRadius * t * splash.speed;
      circle(
        this.position.x + cos(splash.angle) * distance,
        this.position.y + sin(splash.angle) * distance,
        splash.size * (1 - t)
      );
    }

    pop();
  }

  getDisplayBoundingBox() {
    return new Rectangle({
      x: this.position.x - this.hitRadius,
      y: this.position.y - this.hitRadius,
      w: this.hitRadius * 2,
      h: this.hitRadius * 2,
      data: this,
    });
  }
}
