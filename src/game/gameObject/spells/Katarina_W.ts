import { Circle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import { effectiveRange } from '../../combat/Reach';
import { PredefinedFilters } from '../../managers/ObjectManager';
import type { CastContext, CastSpec } from '../../spell/runtime/types';
import type AttackableUnit from '../attackableUnits/AttackableUnit';
import Dash from '../buffs/Dash';
import Slow from '../buffs/Slow';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import { KATARINA_BLOOD, KATARINA_STEEL, Katarina_Dagger } from './Katarina_Q';

export const KATARINA_W_HOP = 130;
export const KATARINA_W_SLOW_RADIUS = 200;
export const KATARINA_W_SLOW = 0.25;
export const KATARINA_W_SLOW_MS = 1_500;
export const KATARINA_W_DASH_MS = 320;

export default class Katarina_W extends Spell {
  image = AssetManager.get('spell_katarina_w');
  name = 'Tung Hứng (Katarina_W)';
  description = `Nhảy lùi <b>${KATARINA_W_HOP}</b> đơn vị và cắm một con dao xuống <b>chỗ vừa
    đứng</b>. Kẻ địch quanh chỗ đó bị <span class="buff">làm chậm
    ${Math.round(KATARINA_W_SLOW * 100)}%</span> trong ${KATARINA_W_SLOW_MS / 1000} giây.`;
  coolDown = 9_000;
  manaCost = 20;
  range = KATARINA_W_SLOW_RADIUS;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'SELF',
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'release', durationMs: this.coolDown },
    };
  }

  checkCastCondition(): boolean {
    return Dash.CanDash(this.owner);
  }

  onSpellCast(context: CastContext): void {
    // Everything here is measured from where she *was*: the dagger, the slow and
    // the art all belong to the fight she is backing out of.
    const departure = createVector(this.owner.position.x, this.owner.position.y);
    const aim = context?.cursorWorld ?? this.aimPoint;
    let awayX = departure.x - aim.x;
    let awayY = departure.y - aim.y;
    const span = Math.hypot(awayX, awayY);
    if (span < 1) {
      const heading = this.firingDirection(context);
      const length = Math.hypot(heading.x, heading.y) || 1;
      awayX = -heading.x / length;
      awayY = -heading.y / length;
    } else {
      awayX /= span;
      awayY /= span;
    }

    const dash = new Dash(KATARINA_W_DASH_MS, this.owner, this.owner);
    dash.dashDestination = createVector(
      departure.x + awayX * KATARINA_W_HOP,
      departure.y + awayY * KATARINA_W_HOP
    );
    dash.dashSpeed = 15;
    dash.image = this.image;
    this.owner.addBuff(dash);

    Katarina_Dagger.plant(this.owner, departure.x, departure.y);

    const radius = effectiveRange(this.range, this.owner);
    const caught = this.game.objectManager.queryObjects({
      area: new Circle({ x: departure.x, y: departure.y, r: radius }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    const slowed = new Set<AttackableUnit>();
    for (const victim of caught) {
      if (slowed.has(victim)) continue;
      slowed.add(victim);
      const slow = new Slow(KATARINA_W_SLOW_MS, this.owner, victim);
      slow.percent = KATARINA_W_SLOW;
      slow.stackId = 'katarina_w_slow';
      victim.addBuff(slow);
    }

    const pulse = new Katarina_W_Pulse(this.owner, departure.x, departure.y, radius);
    pulse.pushX = awayX;
    pulse.pushY = awayY;
    this.game.objectManager.addObject(pulse);
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}

/**
 * The shove-off. A hard rim on the slow radius that was really used, plus blades
 * flicked *outwards along the hop*, so the art reads "she left, the steel
 * stayed" rather than "something exploded".
 */
export class Katarina_W_Pulse extends SpellObject {
  lifeTime = 420;
  age = 0;
  radius: number;
  pushX = 1;
  pushY = 0;
  /** Seeded once in the constructor. */
  shards: { angle: number; length: number }[] = [];

  constructor(owner: AttackableUnit, x: number, y: number, radius: number) {
    super(owner);
    this.position = createVector(x, y);
    this.radius = radius;
    for (let i = 0; i < 7; i++) {
      this.shards.push({ angle: random(0, TWO_PI), length: random(0.55, 0.9) });
    }
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const opened = 1 - (1 - t) * (1 - t);
    const fade = 1 - t;

    push();
    noFill();
    // The rim is the slow's real edge — the whole decision an enemy is making.
    stroke(KATARINA_BLOOD[0], KATARINA_BLOOD[1], KATARINA_BLOOD[2], 220 * fade);
    strokeWeight(3 * fade + 1);
    circle(this.position.x, this.position.y, this.radius * 2 * opened);

    stroke(KATARINA_STEEL[0], KATARINA_STEEL[1], KATARINA_STEEL[2], 190 * fade);
    strokeWeight(2);
    for (const shard of this.shards) {
      const inner = this.radius * 0.2 * opened;
      const outer = this.radius * shard.length * opened;
      line(
        this.position.x + cos(shard.angle) * inner,
        this.position.y + sin(shard.angle) * inner,
        this.position.x + cos(shard.angle) * outer,
        this.position.y + sin(shard.angle) * outer
      );
    }

    // The kick-off streak: which way she went, drawn from the ground she left.
    stroke(KATARINA_BLOOD[0], KATARINA_BLOOD[1], KATARINA_BLOOD[2], 200 * fade);
    strokeWeight(5 * fade + 1);
    line(
      this.position.x,
      this.position.y,
      this.position.x + this.pushX * KATARINA_W_HOP * opened,
      this.position.y + this.pushY * KATARINA_W_HOP * opened
    );
    pop();
  }

  getDisplayBoundingBox() {
    const painted = Math.max(this.radius, KATARINA_W_HOP) + 20;
    return this.squareDisplayBoundingBox(painted * 2);
  }
}
