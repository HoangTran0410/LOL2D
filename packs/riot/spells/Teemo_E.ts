import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { BasicAttackHit } from '@moba2d/core/content/types';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type DamageOverTime = InstanceType<ContentApi['buffs']['DamageOverTime']>;
type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type Teemo_E = InstanceType<ReturnType<typeof makeTeemo_E>>;
type Teemo_E_Object = InstanceType<ReturnType<typeof makeTeemo_E_Object>>;
type Teemo_E_Splash = InstanceType<ReturnType<typeof makeTeemo_E_Splash>>;



// Exported so the suite asserts the wiring, not a copy of the numbers —
// retuning a value should not mean editing the test.
export const RANGE = 380;

export const ON_HIT_DAMAGE = 9;

export const POISON_DAMAGE_PER_TICK = 6;

export const POISON_TICK_INTERVAL_MS = 1_000;

// 4 ticks over the duration => 24 total poison damage, matching the imported
// rank-1 wiki figure ("Total Poison Damage: 24").
export const POISON_DURATION_MS = 4_000;

export const MANA_COST = 25;


/** Poisons `victim`, from whichever of the two deliveries applied it. */
function __buildapplyToxicShot(api: ContentApi) {
  const DamageOverTime = api.buffs.DamageOverTime;
  const AttackableUnit = api.units.AttackableUnit;
  function applyToxicShot(source: AttackableUnit, victim: AttackableUnit): void {
    const poison = new DamageOverTime(POISON_DURATION_MS, source, victim);
    poison.stackId = 'teemo_e_toxicshot';
    poison.image = api.asset('spell_teemo_e');
    poison.name = 'Trúng Độc';
    poison.damagePerTick = POISON_DAMAGE_PER_TICK;
    poison.tickInterval = POISON_TICK_INTERVAL_MS;
    poison.flameColor = [210, 255, 110];
    poison.emberColor = [55, 120, 20];
    victim.addBuff(poison);
  }
  return applyToxicShot;
}
const __cacheapplyToxicShot = new WeakMap<ContentApi, ReturnType<typeof __buildapplyToxicShot>>();
export function makeApplyToxicShot(api: ContentApi) {
  const cached = __cacheapplyToxicShot.get(api);
  if (cached) return cached;
  const built = __buildapplyToxicShot(api);
  __cacheapplyToxicShot.set(api, built);
  return built;
}


/**
 * Toxic Shot is a passive in the real game: every basic attack poisons. It was
 * first written here as an active dart only because this project had no basic
 * attacks for a passive to hang off. It has them now, so the passive is the
 * real thing — every landed attack applies the poison, through the
 * `ON_ATTACK_HIT` seam.
 *
 * The dart stays as the active. It is one poison with two deliveries rather
 * than two abilities: without it the slot has nothing to press, which reads as
 * broken in a game built around pressing keys, and it gives Teemo a way to
 * apply the poison from outside attack range.
 */
function __buildTeemo_E(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const EventType = api.enums.EventType;
  const applyToxicShot = makeApplyToxicShot(api);
  const Teemo_E_Object = makeTeemo_E_Object(api);
  class Teemo_E extends Spell {
    targetingMode = 'DIRECTION' as const;
    image = api.asset('spell_teemo_e');
    name = 'Bắn Độc (Teemo_E)';
    description = `Nội tại: mỗi đòn <span class="buff">đánh thường</span> của Teemo khiến mục tiêu <span class="buff">Trúng Độc</span>. Chủ động: bắn một mũi tẩm độc về hướng chỉ định, gây <span class="damage">${ON_HIT_DAMAGE} sát thương</span> tức thì và gây độc tương tự. Độc gây <span class="damage">${POISON_DAMAGE_PER_TICK} sát thương mỗi giây</span> trong <span class="time">${POISON_DURATION_MS / 1000} giây</span>.`;
    // kept as a literal (not an exported constant) so the repo-wide arcade
    // cooldown-cap scan in tests/game/spells/cooldowns.test.ts can see it
    coolDown = 4_000;
    manaCost = MANA_COST;

    range = RANGE;

    /** Unsubscribes the passive; `undefined` until the first update wires it. */
    private stopWatching?: () => void;

    onUpdate(): void {
      // Wired here, not in the constructor: every spell is instantiated once with
      // a null owner to build the picker, and that instance has no game to
      // subscribe to and must never react to a real fight.
      if (this.stopWatching || !this.owner || !this.game?.eventManager) return;

      this.stopWatching = this.game.eventManager.on(
        EventType.ON_ATTACK_HIT,
        ({ attacker, victim }: BasicAttackHit) => {
          // the event is global; every Teemo on the map hears every attack
          if (attacker !== this.owner || !victim || victim.isDead) return;
          applyToxicShot(this.owner, victim);
        }
      );
    }

    onRemoved(): void {
      this.stopWatching?.();
      this.stopWatching = undefined;
      super.onRemoved();
    }

    deactivate(): void {
      this.stopWatching?.();
      this.stopWatching = undefined;
      super.deactivate();
    }

    onSpellCast() {
      const { to } = VectorUtils.getVectorWithRange(this.owner.position, this.aimPoint, this.range);

      const obj = new Teemo_E_Object(this.owner);
      obj.destination = to;
      this.game.objectManager.addObject(obj);
    }

    drawPreview() {
      super.drawPreview(this.range);
    }
  }
  return Teemo_E;
}
const __cacheTeemo_E = new WeakMap<ContentApi, ReturnType<typeof __buildTeemo_E>>();
export default function makeTeemo_E(api: ContentApi) {
  const cached = __cacheTeemo_E.get(api);
  if (cached) return cached;
  const built = __buildTeemo_E(api);
  __cacheTeemo_E.set(api, built);
  return built;
}


function __buildTeemo_E_Object(api: ContentApi) {
  const MissileSpellObject = api.MissileSpellObject;
  const TrailSystem = api.helpers.TrailSystem;
  const AttackableUnit = api.units.AttackableUnit;
  const applyToxicShot = makeApplyToxicShot(api);
  const Teemo_E_Splash = makeTeemo_E_Splash(api);
  class Teemo_E_Object extends MissileSpellObject {
    speed = 11;
    size = 16;
    onHitDamage = ON_HIT_DAMAGE;
    poisonDamagePerTick = POISON_DAMAGE_PER_TICK;
    poisonTickInterval = POISON_TICK_INTERVAL_MS;
    poisonDuration = POISON_DURATION_MS;

    // a single vial: it embeds in the first thing it hits, same as Teemo's Q
    maxHitCount = 1;

    /** Cosmetic: the vial tumbles end over end as it flies. */
    _spin = random(TWO_PI);

    trailSystem = new TrailSystem({
      trailSize: this.size / 2,
      trailColor: '#7CFF5C55',
      maxLength: 12,
    });

    onAfterMove() {
      this._spin += 0.35;
    }

    onHit(enemy: AttackableUnit) {
      enemy.takeDamage(this.onHitDamage, this.owner);
      applyToxicShot(this.owner, enemy);

      // the vial shatters on impact, so the poison burst is its own object
      const splash = new Teemo_E_Splash(this.owner);
      splash.position = enemy.position.copy();
      splash.targetSize = enemy.animatedValues?.displaySize ?? 40;
      this.game.objectManager.addObject(splash);
    }

    draw() {
      const angle = Math.atan2(
        this.destination.y - this.position.y,
        this.destination.x - this.position.x
      );
      const s = this.size;

      push();
      translate(this.position.x, this.position.y);
      rotate(angle);
      rotate(sin(this._spin) * 0.5);

      // ooze dripping off the vial as it flies
      noStroke();
      for (let i = 0; i < 3; i++) {
        fill(140, 230, 80, 65 - i * 18);
        circle(-s * (0.5 + i * 0.35) + random(-1, 1), s * 0.2 + i * 2, 5 - i);
      }

      // corked glass vial: a rounded body with a narrow neck
      stroke(30, 55, 20, 230);
      strokeWeight(1.5);
      fill(90, 200, 70, 195);
      ellipse(0, 0, s * 1.2, s * 0.85);
      fill(70, 60, 45, 230);
      rect(-s * 0.75, -s * 0.16, s * 0.3, s * 0.32, 2);

      // glowing toxic core inside the glass
      blendMode(ADD);
      noStroke();
      fill(170, 255, 110, 140);
      circle(s * 0.08, 0, s * 0.65);
      blendMode(BLEND);

      // glass highlight
      stroke(230, 255, 200, 200);
      strokeWeight(1);
      noFill();
      arc(0, -s * 0.08, s * 0.9, s * 0.6, PI + 0.4, PI + 1.6);

      pop();
    }

    getDisplayBoundingBox() {
      const r = this.size * 2.2;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Teemo_E_Object;
}
const __cacheTeemo_E_Object = new WeakMap<ContentApi, ReturnType<typeof __buildTeemo_E_Object>>();
export function makeTeemo_E_Object(api: ContentApi) {
  const cached = __cacheTeemo_E_Object.get(api);
  if (cached) return cached;
  const built = __buildTeemo_E_Object(api);
  __cacheTeemo_E_Object.set(api, built);
  return built;
}


/** Poison bursting where the vial shattered — the toxin taking hold. */
function __buildTeemo_E_Splash(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class Teemo_E_Splash extends SpellObject {
    targetSize = 40;
    age = 0;
    lifeTime = 500;
    maxRadius = 40;

    _drops: { angle: number; distance: number; size: number }[] = [];

    onAdded() {
      for (let i = 0; i < 6; i++) {
        this._drops.push({
          angle: random(TWO_PI),
          distance: random(0.4, 1),
          size: random(6, 12),
        });
      }
    }

    update() {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const fade = 1 - t;

      push();
      translate(this.position.x, this.position.y);

      noStroke();
      fill(90, 190, 60, 150 * fade);
      circle(0, 0, this.targetSize * (0.6 + t * 0.6));

      for (const drop of this._drops) {
        const d = this.maxRadius * t * drop.distance;
        fill(150, 240, 100, 170 * fade);
        circle(cos(drop.angle) * d, sin(drop.angle) * d, drop.size * (1 - t * 0.5));
      }

      noFill();
      stroke(190, 255, 130, 210 * fade);
      strokeWeight(3 * fade + 1);
      circle(0, 0, this.targetSize * 0.6 + this.maxRadius * 1.3 * t);

      pop();
    }

    getDisplayBoundingBox() {
      const r = this.targetSize + this.maxRadius * 1.5;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Teemo_E_Splash;
}
const __cacheTeemo_E_Splash = new WeakMap<ContentApi, ReturnType<typeof __buildTeemo_E_Splash>>();
export function makeTeemo_E_Splash(api: ContentApi) {
  const cached = __cacheTeemo_E_Splash.get(api);
  if (cached) return cached;
  const built = __buildTeemo_E_Splash(api);
  __cacheTeemo_E_Splash.set(api, built);
  return built;
}