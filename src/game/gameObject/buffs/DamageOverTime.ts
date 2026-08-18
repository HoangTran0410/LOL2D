import AssetManager from '@/managers/AssetManager';
import BuffAddType from '@/game/enums/BuffAddType';
import Buff from '@/game/gameObject/Buff';

interface Flame {
  baseX: number;
  baseY: number;
  riseSpeed: number;
  size: number;
  age: number;
  lifeTime: number;
  wobblePhase: number;
  wobbleAmp: number;
}

const MAX_FLAMES = 120;
const FLAME_SPAWN_INTERVAL = 13;
const FRAME_MS = 1000 / 60;

/**
 * Deals damage on a fixed interval for as long as it lasts — burns, poisons,
 * bleeds. Damage is credited to `sourceUnit`, so kills score correctly.
 *
 *   const dot = new DamageOverTime(5000, caster, target);
 *   dot.damagePerTick = 6;   // 6 damage
 *   dot.tickInterval = 500;  // every 0.5s => 60 total over 5s
 *   target.addBuff(dot);
 *
 * Renders as a column of flame rising off the victim. Recolour it with
 * `flameColor` (hot core at the base) and `emberColor` (what it cools to on the
 * way up) — e.g. green + dark green reads as poison. Particles are spawned in
 * onUpdate and only drawn in draw, so the fire's density does not depend on how
 * many times the unit happens to be rendered.
 */
export default class DamageOverTime extends Buff {
  image: Buff['image'] = AssetManager.get('buff_poison');
  name = 'Thiêu Đốt';
  buffAddType = BuffAddType.RENEW_EXISTING;

  damagePerTick = 5;
  tickInterval = 500;

  flameColor: [number, number, number] = [255, 230, 120];
  emberColor: [number, number, number] = [210, 35, 10];

  _timeSinceLastTick = 0;
  _flames: Flame[] = [];
  _timeSinceLastSpawn = 0;

  onUpdate(): void {
    if (this.targetUnit.isDead) {
      this.deactivateBuff();
      return;
    }

    this._timeSinceLastTick += deltaTime;

    // at most one tick per frame; the remainder carries over so the rate holds
    // even if the frame took longer than a whole interval
    if (this._timeSinceLastTick >= this.tickInterval) {
      this._timeSinceLastTick -= this.tickInterval;
      this.targetUnit.takeDamage(this.damagePerTick, this.sourceUnit);
    }

    this._updateFlames();
  }

  _updateFlames(): void {
    const radius = this.targetUnit.animatedValues.displaySize / 2;

    this._timeSinceLastSpawn += deltaTime;
    while (this._timeSinceLastSpawn >= FLAME_SPAWN_INTERVAL && this._flames.length < MAX_FLAMES) {
      this._timeSinceLastSpawn -= FLAME_SPAWN_INTERVAL;
      this._flames.push({
        // wide at the feet; draw() pulls them toward the centre as they climb
        baseX: random(-radius * 0.85, radius * 0.85),
        baseY: random(radius * 0.15, radius * 0.55),
        riseSpeed: random(2.2, 4.4),
        size: random(radius * 0.55, radius * 1.05),
        age: 0,
        lifeTime: random(450, 780),
        wobblePhase: random(0, TWO_PI),
        wobbleAmp: random(2, 7),
      });
    }
    if (this._timeSinceLastSpawn > FLAME_SPAWN_INTERVAL) this._timeSinceLastSpawn = 0;

    let i = 0;
    while (i < this._flames.length) {
      const flame = this._flames[i];
      flame.age += deltaTime;
      if (flame.age >= flame.lifeTime) this._flames.splice(i, 1);
      else i++;
    }
  }

  draw(): void {
    if (this._flames.length === 0) return;

    const pos = this.targetUnit.position;
    const radius = this.targetUnit.animatedValues.displaySize / 2;
    const [hotR, hotG, hotB] = this.flameColor;
    const [coolR, coolG, coolB] = this.emberColor;

    push();
    noStroke();
    blendMode(ADD); // overlapping tongues of flame build into a glow

    // pool of light at the feet, so the fire looks anchored to the ground
    fill(coolR, coolG, coolB, 70);
    ellipse(pos.x, pos.y + radius * 0.35, radius * 2.1, radius * 0.9);

    for (const flame of this._flames) {
      const t = flame.age / flame.lifeTime; // 0 at the base, 1 at burnout
      const risen = (flame.riseSpeed * flame.age) / FRAME_MS;

      // converge toward the centre while rising => tapered flame, not a cloud
      const x =
        pos.x + flame.baseX * (1 - t * 0.8) + sin(flame.wobblePhase + t * 7) * flame.wobbleAmp * t;
      const y = pos.y + flame.baseY - risen;
      const size = flame.size * (1 - t * 0.75);
      // kept low because additive blending stacks these into a solid glow
      const alpha = 140 * (1 - t) * (1 - t * 0.6);

      // cools from the hot colour to the ember colour as it climbs
      fill(
        hotR + (coolR - hotR) * t,
        hotG + (coolG - hotG) * Math.min(1, t * 1.4),
        hotB + (coolB - hotB) * Math.min(1, t * 1.8),
        alpha
      );
      circle(x, y, size);
    }

    // white-hot core only right at the base, where the fire is hottest
    for (const flame of this._flames) {
      const t = flame.age / flame.lifeTime;
      if (t > 0.22) continue;

      const risen = (flame.riseSpeed * flame.age) / FRAME_MS;
      fill(255, 250, 225, 70 * (1 - t / 0.22));
      circle(pos.x + flame.baseX * (1 - t * 0.8), pos.y + flame.baseY - risen, flame.size * 0.3);
    }

    blendMode(BLEND);
    pop();
  }
}
