import { Rectangle, Circle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import { PredefinedFilters } from '../../managers/ObjectManager';
import type { CastContext, CastSpec, Vec2 } from '../../spell/runtime/types';
import Spell from '../Spell';
import AttackableUnit from '../attackableUnits/AttackableUnit';
import Monster from '../attackableUnits/Monster';
import AreaSpellObject from '../spellObjects/AreaSpellObject';

// Exported so the suite asserts the zone's wiring, not a copy of the
// numbers — retuning a value should not mean editing the test.
export const RANGE = 600;
export const RADIUS = 220;
export const CAST_TIME_MS = 0;
export const DURATION_MS = 5_000;
export const TICK_EVERY_MS = 500;
export const MIN_TICK_DAMAGE = 3;
export const MAX_TICK_DAMAGE = 5;
export const MONSTER_DAMAGE_MULTIPLIER = 1.7;
export const MANA_COST = 50;

type ShadowTarget = AttackableUnit;

export default class Morgana_W extends Spell {
  image = AssetManager.get('spell_morgana_w');
  name = 'Bóng Tối Hành Hạ (Morgana_W)';
  description =
    'Nguyền rủa mặt đất tại vị trí chỉ định trong <span class="time">5 giây</span>, gây <span class="damage">3-5 sát thương phép mỗi 0.5 giây</span> cho kẻ địch đứng trong đó — sát thương tăng theo phần trăm máu đã mất của mục tiêu, và tăng 70% khi nhắm vào quái rừng.';
  coolDown = 9_000;
  manaCost = MANA_COST;

  range = RANGE;
  activeZone: Morgana_W_Object | null = null;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'POINT',
      castTimeMs: CAST_TIME_MS,
      resource: { commitAt: 'release', refundOn: [] },
      cooldown: { startAt: 'release', durationMs: this.coolDown },
    };
  }

  onRelease(context: CastContext): void {
    const center = this.pointInRange(context.cursorWorld);
    const zone = new Morgana_W_Object(this.owner, center);
    this.activeZone = zone;
    this.game.objectManager.addObject(zone);
  }

  onUpdate(): void {
    if (this.activeZone?.toRemove) this.activeZone = null;
  }

  drawPreview(): void {
    super.drawPreview(this.range);
  }

  private pointInRange(point: Vec2): Vec2 {
    const dx = point.x - this.owner.position.x;
    const dy = point.y - this.owner.position.y;
    const distance = Math.hypot(dx, dy);
    const ratio = distance > this.range ? this.range / distance : 1;
    return { x: this.owner.position.x + dx * ratio, y: this.owner.position.y + dy * ratio };
  }
}

export class Morgana_W_Object extends AreaSpellObject {
  constructor(owner: AttackableUnit, center: Vec2) {
    super(owner, center, RADIUS, {
      candidates: () =>
        this.game.objectManager.queryObjects({
          area: new Circle({ x: center.x, y: center.y, r: RADIUS }),
          filters: [PredefinedFilters.canTakeDamageFromTeam(owner.teamId)],
        }),
      tickEveryMs: TICK_EVERY_MS,
      durationMs: DURATION_MS,
      onEnter: target => this.damageTarget(target),
      onTick: target => this.damageTarget(target),
    });
  }

  private damageTarget(target: ShadowTarget): void {
    const maxHealth = target.stats.maxHealth.value;
    const missingRatio = maxHealth > 0 ? 1 - target.stats.health.value / maxHealth : 0;
    const base =
      MIN_TICK_DAMAGE + (MAX_TICK_DAMAGE - MIN_TICK_DAMAGE) * constrain(missingRatio, 0, 1);
    const multiplier = target instanceof Monster ? MONSTER_DAMAGE_MULTIPLIER : 1;
    target.takeDamage(base * multiplier, this.owner);
  }

  draw(): void {
    const fadeIn = constrain(this.elapsedMs / 250, 0, 1);
    const fadeOut = 1 - constrain((this.elapsedMs - (DURATION_MS - 400)) / 400, 0, 1);
    const alpha = Math.min(fadeIn, fadeOut);
    const pulse = 0.6 + 0.4 * sin(this.elapsedMs / 260);

    push();
    translate(this.center.x, this.center.y);

    // desecrated ground: a pooling dark stain, not a flat tinted circle
    noStroke();
    fill(30, 5, 45, 90 * alpha);
    circle(0, 0, this.radius * 2);
    fill(60, 10, 85, 60 * alpha * pulse);
    circle(0, 0, this.radius * 1.5);

    // boundary ring, breathing with the curse
    noFill();
    stroke(20, 0, 30, 200 * alpha);
    strokeWeight(5);
    circle(0, 0, this.radius * 2);
    stroke(190, 90, 230, (140 + 90 * pulse) * alpha);
    strokeWeight(2);
    circle(0, 0, this.radius * 2);

    // corrupted spikes rising and sinking back into the ground
    const SPIKE_COUNT = 10;
    for (let i = 0; i < SPIKE_COUNT; i++) {
      const seed = i * 3.171;
      const loopMs = 900 + (i % 4) * 160;
      const phase = ((this.elapsedMs + seed * 260) % loopMs) / loopMs;
      const rise = sin(phase * PI);
      if (rise <= 0.02) continue;
      const a = seed * 2;
      const r = this.radius * (0.15 + ((i * 0.181) % 1) * 0.78);
      const px = cos(a) * r;
      const py = sin(a) * r;
      const spikeHeight = 10 + rise * 26;

      push();
      translate(px, py);
      noStroke();
      fill(150, 60, 200, 210 * rise * alpha);
      triangle(-4, 0, 4, 0, 0, -spikeHeight);
      fill(220, 170, 255, 160 * rise * alpha);
      triangle(-1.4, 0, 1.4, 0, 0, -spikeHeight);
      pop();
    }

    // slow-drifting motes of corruption over the whole area, keyed off
    // elapsedMs rather than random() so they drift instead of flickering
    noStroke();
    fill(210, 150, 255, 130 * alpha);
    const MOTE_COUNT = 16;
    for (let i = 0; i < MOTE_COUNT; i++) {
      const seed = i * 2.399963;
      const loopMs = 2_600 + (i % 5) * 220;
      const phase = ((this.elapsedMs + seed * 500) % loopMs) / loopMs;
      const r = this.radius * (0.1 + phase * 0.85);
      const a = seed + this.elapsedMs / 3_400;
      circle(cos(a) * r, sin(a) * r, 2 + (i % 3));
    }

    pop();
  }

  // the spikes reach a little past the collision radius; pad the culling box
  getDisplayBoundingBox(): Rectangle {
    const pad = this.radius + 30;
    return new Rectangle({
      x: this.center.x - pad,
      y: this.center.y - pad,
      w: pad * 2,
      h: pad * 2,
      data: this,
    });
  }
}
