import { Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import StatAmp from '../buffs/StatAmp';
import { PredefinedParticleSystems } from '../helpers/ParticleSystem';
import type AttackableUnit from '../attackableUnits/AttackableUnit';

/** The floor of the heal, paid even at full health. */
export const TRYNDAMERE_Q_BASE_HEAL = 14;
/** …plus this much of what he is missing, which is where the gamble lives. */
export const TRYNDAMERE_Q_MISSING_HEALTH_HEAL = 0.28;
export const TRYNDAMERE_Q_MAX_HEAL = 40;
/** Bloodlust's other half: the lower he is, the harder he hits. */
export const TRYNDAMERE_Q_AD_BONUS_MAX = 14;
export const TRYNDAMERE_Q_AD_BONUS_MS = 6_000;
export const TRYNDAMERE_Q_STACK_ID = 'tryndamere-bloodlust';

export default class Tryndamere_Q extends Spell {
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_tryndamere_q');
  name = 'Say Máu (Tryndamere_Q)';
  description =
    'Hồi <span class="damage">14 máu</span> cộng <span class="damage">28% lượng máu đã mất</span> ' +
    '(tối đa <span class="damage">40</span>), đồng thời nhận tới <span class="buff">14 sát thương đánh</span> ' +
    'tùy theo lượng máu đã mất trong <span class="time">6 giây</span>.';
  coolDown = 9_000;
  // Tryndamere is manaless in his own game and stays manaless here: his whole
  // kit is priced in cooldowns and in how low he is willing to go.
  manaCost = 0;

  /** How far below full he is, 0 at full health and 1 at death's door. */
  missingHealthRatio(): number {
    const stats = this.owner.stats;
    const max = stats.maxHealth.value || 1;
    return Math.max(0, Math.min(1, (max - stats.health.value) / max));
  }

  healAmount(): number {
    const stats = this.owner.stats;
    const missing = Math.max(0, stats.maxHealth.value - stats.health.value);
    return Math.min(
      TRYNDAMERE_Q_MAX_HEAL,
      TRYNDAMERE_Q_BASE_HEAL + missing * TRYNDAMERE_Q_MISSING_HEALTH_HEAL
    );
  }

  onSpellCast(): void {
    const ratio = this.missingHealthRatio();
    const heal = this.healAmount();
    this.owner.takeHeal(heal, this.owner);

    const rage = new StatAmp(TRYNDAMERE_Q_AD_BONUS_MS, this.owner, this.owner);
    // Generic buff class, so it needs its own slot or it fights every other
    // StatAmp in the game for one.
    rage.stackId = TRYNDAMERE_Q_STACK_ID;
    rage.name = 'Say Máu';
    rage.image = this.image;
    rage.bonuses = {
      attackDamage: { flatBonus: Math.round(TRYNDAMERE_Q_AD_BONUS_MAX * ratio) },
    };
    this.owner.addBuff(rage);

    const surge = new Tryndamere_Q_Object(this.owner, ratio);
    surge.attachTo(this.owner, rage);
    this.game.objectManager.addObject(surge);
  }
}

/**
 * The blood drawn back in: motes pulled up his body, ending in a red flare.
 *
 * Deliberately not a green cross — the heal is the same gesture as the rage,
 * and the player reads its size off how much red comes back.
 */
export class Tryndamere_Q_Object extends SpellObject {
  age = 0;
  lifeTime = 700;
  /** How badly hurt he was at cast: drives how much blood is drawn in. */
  intensity: number;
  private motes: { angle: number; radius: number; speed: number }[] = [];

  particleSystem = PredefinedParticleSystems.randomMovingParticlesDecreaseSize('#d1263c', 0.35);

  constructor(owner: AttackableUnit, intensity: number) {
    super(owner);
    this.intensity = intensity;
  }

  onAdded(): void {
    this.useParticles(this.particleSystem);
    const count = 8 + Math.round(this.intensity * 8);
    for (let i = 0; i < count; i++) {
      this.motes.push({
        angle: (TWO_PI / count) * i + random(-0.3, 0.3),
        radius: random(45, 85),
        speed: random(0.8, 1.6),
      });
    }
    for (let i = 0; i < 10; i++) {
      const angle = (TWO_PI / 10) * i;
      this.particleSystem.addParticle({
        x: this.owner.position.x + cos(angle) * 30,
        y: this.owner.position.y + sin(angle) * 30,
        r: random(4, 9),
      });
    }
  }

  update(): void {
    if (this.dropIfAttachmentLost()) return;
    this.position.set(this.owner.position.x, this.owner.position.y);
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    // wind-in: motes accelerate as they arrive, so the heal lands rather than drifts
    const pull = t * t;
    const fade = 1 - t;

    push();
    translate(this.position.x, this.position.y);
    noStroke();
    for (const mote of this.motes) {
      const radius = mote.radius * (1 - pull * mote.speed);
      if (radius <= 2) continue;
      const angle = mote.angle + pull * 2.2;
      fill(210, 40, 60, 230 * fade);
      circle(cos(angle) * radius, sin(angle) * radius, 4 + 5 * (1 - t));
    }

    // the flare he drinks it down with, gone in the first fifth
    if (t < 0.25) {
      const flash = 1 - t / 0.25;
      noFill();
      stroke(235, 70, 80, 220 * flash);
      strokeWeight(4 * flash + 1);
      circle(0, 0, 46 + 40 * (1 - flash));
    }
    pop();
  }

  getDisplayBoundingBox(): Rectangle {
    const r = 110;
    return this.squareDisplayBoundingBox(r * 2);
  }
}
