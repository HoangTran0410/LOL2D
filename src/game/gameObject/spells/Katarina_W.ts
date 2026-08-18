import AssetManager from '@/managers/AssetManager';
import type { CastContext, CastSpec } from '@/game/spell/runtime/types';
import type AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import Speedup from '@/game/gameObject/buffs/Speedup';
import Spell from '@/game/gameObject/Spell';
import SpellObject from '@/game/gameObject/SpellObject';
import { KATARINA_BLOOD, KATARINA_STEEL, Katarina_Dagger } from './Katarina_Q';

export const KATARINA_W_SPEEDUP_PERCENT = 0.45;
export const KATARINA_W_SPEEDUP_MS = 1_250;
export const KATARINA_W_DROP_DELAY_MS = 800;

export default class Katarina_W extends Spell {
  image = AssetManager.get('spell_katarina_w');
  name = 'Tung Hứng (Katarina_W)';
  description = `Tung một con dao lên không trung và nhận
    <span class="buff">+${Math.round(KATARINA_W_SPEEDUP_PERCENT * 100)}% tốc độ di chuyển</span>
    giảm dần trong ${KATARINA_W_SPEEDUP_MS / 1000} giây.
    Dao sẽ rơi xuống đất đúng vị trí này sau ${KATARINA_W_DROP_DELAY_MS / 1000} giây.`;
  coolDown = 9_000;
  manaCost = 0;
  range = 0;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'SELF',
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'release', durationMs: this.coolDown },
    };
  }

  onSpellCast(_context: CastContext): void {
    const departure = createVector(this.owner.position.x, this.owner.position.y);

    // Speedup buff
    const speedup = new Speedup(KATARINA_W_SPEEDUP_MS, this.owner, this.owner);
    speedup.percent = KATARINA_W_SPEEDUP_PERCENT;
    speedup.image = this.image;
    this.owner.addBuff(speedup);

    // Plant a dagger in the air that falls to ground in 800ms
    Katarina_Dagger.plant(this.owner, departure.x, departure.y, KATARINA_W_DROP_DELAY_MS);

    // Visual toss shimmer at cast position
    this.game.objectManager.addObject(new Katarina_W_Toss(this.owner, departure.x, departure.y));
  }
}

/**
 * Visual swirl when Katarina throws a dagger into the air.
 */
export class Katarina_W_Toss extends SpellObject {
  lifeTime = 380;
  age = 0;

  constructor(owner: AttackableUnit, x: number, y: number) {
    super(owner);
    this.position = createVector(x, y);
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const fade = 1 - t;
    const expand = 1 - (1 - t) * (1 - t);

    push();
    translate(this.position.x, this.position.y);

    // Expanding speed/wind rings
    noFill();
    stroke(KATARINA_STEEL[0], KATARINA_STEEL[1], KATARINA_STEEL[2], 220 * fade);
    strokeWeight(2.5 * fade + 1);
    circle(0, 0, 90 * expand);

    stroke(KATARINA_BLOOD[0], KATARINA_BLOOD[1], KATARINA_BLOOD[2], 240 * fade);
    strokeWeight(3.5 * fade + 1);
    circle(0, 0, 56 * expand);

    // Upward toss streaks
    stroke(KATARINA_STEEL[0], KATARINA_STEEL[1], KATARINA_STEEL[2], 230 * fade);
    strokeWeight(2);
    line(-8, 5, -3, -50 * expand);
    line(8, 5, 3, -50 * expand);
    stroke(KATARINA_BLOOD[0], KATARINA_BLOOD[1], KATARINA_BLOOD[2], 240 * fade);
    strokeWeight(3);
    line(0, 8, 0, -70 * expand);
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox(140);
  }
}
