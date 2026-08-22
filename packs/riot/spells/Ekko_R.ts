import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Invulnerable = InstanceType<ContentApi['buffs']['Invulnerable']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Untargetable = InstanceType<ContentApi['buffs']['Untargetable']>;
type Ekko_R = InstanceType<ReturnType<typeof makeEkko_R>>;
type Ekko_R_Object = InstanceType<ReturnType<typeof makeEkko_R_Object>>;



export const EKKO_R_DAMAGE = 60;

export const EKKO_R_RADIUS = 180;

export const EKKO_R_REWIND_MS = 4000;

export const EKKO_R_BASE_HEAL = 40;

export const EKKO_R_HEAL_PER_LOST = 0.3;


interface PositionSnapshot {
  time: number;
  x: number;
  y: number;
  health: number;
}


function __buildEkko_R(api: ContentApi) {
  const Spell = api.Spell;
  const Invulnerable = api.buffs.Invulnerable;
  const Untargetable = api.buffs.Untargetable;
  const Ekko_R_Object = makeEkko_R_Object(api);
  class Ekko_R extends Spell {
    targetingMode = 'SELF' as const;
    image = api.asset('spell_ekko_r');
    name = 'Đột Phá Thời Gian (Ekko_R)';
    description =
      'Giật ngược thời gian trở về vị trí cách đây <span class="time">4 giây</span>, hồi lại ít nhất <span class="buff">40 Máu</span> (tăng theo lượng máu đã mất) và gây <span class="damage">60 sát thương</span> diện rộng tại điểm đến.';
    coolDown = 10000;
    manaCost = 100;

    history: PositionSnapshot[] = [];

    onUpdate() {
      if (!this.owner) return;
      const now = this.game.time || Date.now();
      this.history.push({
        time: now,
        x: this.owner.position.x,
        y: this.owner.position.y,
        health: this.owner.stats.health.baseValue,
      });

      // Prune entries older than 5000ms
      const cutoff = now - 5000;
      while (this.history.length > 0 && this.history[0].time < cutoff) {
        this.history.shift();
      }
    }

    getSnapshot4sAgo(): PositionSnapshot {
      const now = this.game.time || Date.now();
      const targetTime = now - EKKO_R_REWIND_MS;
      if (this.history.length === 0) {
        return {
          time: now,
          x: this.owner.position.x,
          y: this.owner.position.y,
          health: this.owner.stats.health.baseValue,
        };
      }

      let closest = this.history[0];
      let minDiff = Math.abs(closest.time - targetTime);
      for (const snap of this.history) {
        const diff = Math.abs(snap.time - targetTime);
        if (diff < minDiff) {
          minDiff = diff;
          closest = snap;
        }
      }
      return closest;
    }

    onSpellCast() {
      const snap = this.getSnapshot4sAgo();
      const targetPos = createVector(snap.x, snap.y);
      const origin = this.owner.position.copy();

      // Calculate heal based on health lost in last 4 seconds
      const currentHealth = this.owner.stats.health.baseValue;
      const healthLost = Math.max(0, snap.health - currentHealth);
      const healAmount = EKKO_R_BASE_HEAL + healthLost * EKKO_R_HEAL_PER_LOST;

      this.owner.stats.health.baseValue = Math.min(
        this.owner.stats.maxHealth.value,
        currentHealth + healAmount
      );

      // Briefly grant invulnerable & untargetable
      this.owner.addBuff(new Invulnerable(500, this.owner, this.owner));
      this.owner.addBuff(new Untargetable(500, this.owner, this.owner));

      // Teleport Ekko
      this.owner.position.set(targetPos.x, targetPos.y);
      this.owner.destination.set(targetPos.x, targetPos.y);

      // Add explosion spell object
      const explosion = new Ekko_R_Object(this.owner);
      explosion.position = targetPos.copy();
      explosion.origin = origin;
      this.game.objectManager.addObject(explosion);
    }

    drawVfx() {
      super.drawVfx();
      // Render time-ghost afterimage ONLY when Ekko R is READY and Ekko is alive!
      if (!this.owner || this.owner.isDead || this.state !== 'READY') return;
      const snap = this.getSnapshot4sAgo();
      push();

      // the timeline he would snap back along, drawn as ticks rather than a solid
      // line so it reads as a rewind rather than a tether
      const dx = snap.x - this.owner.position.x;
      const dy = snap.y - this.owner.position.y;
      const span = Math.hypot(dx, dy);
      const marks = Math.max(2, Math.min(10, Math.floor(span / 40)));
      stroke(0, 220, 255, 110);
      strokeWeight(1);
      for (let i = 1; i < marks; i++) {
        const t = i / marks;
        // the ticks crawl backwards along the line: the direction he will travel
        const k = 1 - ((t + 1 - ((frameCount / 160) % 1)) % 1);
        circle(this.owner.position.x + dx * k, this.owner.position.y + dy * k, 3);
      }

      // the ghost itself, breathing so it does not read as a dead marker
      const pulse = 1 + sin(frameCount * 0.09) * 0.06;
      const size = this.owner.stats.size.value;
      noStroke();
      fill(0, 220, 255, 90);
      circle(snap.x, snap.y, size * pulse);
      noFill();
      stroke(100, 240, 255, 200);
      strokeWeight(2);
      circle(snap.x, snap.y, size * pulse);
      // clock hand on the ghost: this is the position 4 seconds back
      push();
      translate(snap.x, snap.y);
      rotate(-HALF_PI - ((frameCount * 0.03) % TWO_PI));
      stroke(180, 250, 255, 190);
      strokeWeight(2);
      line(0, 0, size * 0.32, 0);
      pop();
      pop();
    }

    drawPreview() {
      super.drawPreview();
      const snap = this.getSnapshot4sAgo();
      push();
      fill(0, 240, 255, 160);
      stroke(255, 255, 255, 220);
      strokeWeight(3);
      circle(snap.x, snap.y, this.owner.stats.size.value * 1.2);
      // the blast that will land there
      noFill();
      stroke(120, 240, 255, 150);
      strokeWeight(2);
      circle(snap.x, snap.y, EKKO_R_RADIUS * 2);
      pop();
    }
  }
  return Ekko_R;
}
const __cacheEkko_R = new WeakMap<ContentApi, ReturnType<typeof __buildEkko_R>>();
export default function makeEkko_R(api: ContentApi) {
  const cached = __cacheEkko_R.get(api);
  if (cached) return cached;
  const built = __buildEkko_R(api);
  __cacheEkko_R.set(api, built);
  return built;
}


interface RewindShard {
  angle: number;
  distance: number;
  size: number;
  spin: number;
}


/**
 * Chronobreak's landing.
 *
 * This is the ultimate, and it used to be a single expanding circle with no
 * particles at all — the thinnest effect of the three champions. It now plays
 * the mechanic: shards of the last four seconds rush *inward* to the point he
 * rewound to, collapse, and blow back out as the damage lands. The implosion is
 * the tell that something arrived here, rather than merely exploded here.
 */
function __buildEkko_R_Object(api: ContentApi) {
  const SpellObject = api.SpellObject;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Circle = api.utils.Quadtree.Circle;
  const Rectangle = api.utils.Quadtree.Rectangle;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  class Ekko_R_Object extends SpellObject {
    radius = EKKO_R_RADIUS;
    lifeTime = 620;
    timer = 0;
    hasDealtDamage = false;
    /** Where he rewound *from*, so the collapse has somewhere to come from. */
    origin: p5.Vector | null = null;

    shards: RewindShard[] = [];

    particleSystem = PredefinedParticleSystems.randomMovingParticlesDecreaseSize('#7ef0ff', 0.3);

    onAdded() {
      super.onAdded();
      this.game.objectManager.addObject(this.particleSystem);
      for (let i = 0; i < 18; i++) {
        this.shards.push({
          angle: (TWO_PI / 18) * i + random(-0.12, 0.12),
          distance: random(0.7, 1.25),
          size: random(12, 30),
          spin: random(-4, 4),
        });
      }
      for (let i = 0; i < 24; i++) {
        const a = random(TWO_PI);
        const d = random(this.radius * 0.3, this.radius);
        this.particleSystem.addParticle({
          x: this.position.x + cos(a) * d,
          y: this.position.y + sin(a) * d,
          r: random(6, 14),
        });
      }
    }

    update() {
      this.timer += deltaTime;

      if (!this.hasDealtDamage) {
        this.hasDealtDamage = true;
        const enemies = this.game.objectManager.queryObjects({
          area: new Circle({ x: this.position.x, y: this.position.y, r: this.radius }),
          filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
        });
        for (const enemy of enemies) {
          enemy.takeDamage(EKKO_R_DAMAGE, this.owner);
          for (let i = 0; i < 6; i++) {
            this.particleSystem.addParticle({
              x: enemy.position.x + random(-16, 16),
              y: enemy.position.y + random(-16, 16),
              r: random(6, 13),
            });
          }
        }
      }

      if (this.timer >= this.lifeTime) {
        this.toRemove = true;
      }
    }

    draw() {
      const t = constrain(this.timer / this.lifeTime, 0, 1);
      // the first third implodes, the rest blows out
      const implode = constrain(t / 0.32, 0, 1);
      const burst = constrain((t - 0.32) / 0.68, 0, 1);
      const fade = 1 - burst;

      push();
      translate(this.position.x, this.position.y);

      // the four seconds he rewound through, snapping shut towards the point
      if (implode < 1) {
        stroke(150, 240, 255, 220 * (1 - implode * 0.4));
        strokeWeight(3);
        noFill();
        for (const shard of this.shards) {
          const d = this.radius * shard.distance * (1 - implode);
          push();
          translate(cos(shard.angle) * d, sin(shard.angle) * d);
          rotate(shard.angle + shard.spin * implode);
          const len = shard.size * (0.4 + implode * 0.6);
          line(-len / 2, 0, len / 2, 0);
          pop();
        }
        // the seam back to where he left, closing as it collapses
        if (this.origin) {
          stroke(180, 120, 255, 170 * (1 - implode));
          strokeWeight(3 * (1 - implode) + 1);
          line(
            0,
            0,
            (this.origin.x - this.position.x) * (1 - implode),
            (this.origin.y - this.position.y) * (1 - implode)
          );
        }
      }

      // the collapse bottoming out: a hard white core
      if (burst <= 0) {
        noStroke();
        fill(255, 255, 255, 200 * implode);
        circle(0, 0, 24 * implode + 6);
        pop();
        return;
      }

      // the blast: two shockwaves at different speeds so the edge has weight
      noStroke();
      fill(0, 220, 255, 110 * fade);
      circle(0, 0, this.radius * 2 * burst);

      noFill();
      stroke(190, 255, 255, 245 * fade);
      strokeWeight(9 * fade + 2);
      circle(0, 0, this.radius * 2 * burst);
      stroke(120, 200, 255, 180 * fade);
      strokeWeight(4 * fade + 1);
      circle(0, 0, this.radius * 2 * burst * 0.72);

      // hard rim on the actual damage radius, so the hitbox is not a guess
      stroke(255, 255, 255, 200 * fade);
      strokeWeight(2);
      circle(0, 0, this.radius * 2);

      // shards thrown back out
      stroke(210, 255, 255, 235 * fade);
      strokeWeight(3);
      for (const shard of this.shards) {
        const d = this.radius * shard.distance * burst;
        push();
        translate(cos(shard.angle) * d, sin(shard.angle) * d);
        rotate(shard.angle + shard.spin * burst);
        const len = shard.size * fade;
        line(-len / 2, 0, len / 2, 0);
        pop();
      }

      // the flash of arrival
      const flash = 1 - constrain(burst / 0.25, 0, 1);
      if (flash > 0) {
        noStroke();
        fill(255, 255, 255, 230 * flash);
        circle(0, 0, this.radius * 1.1 * (1 - flash) + 26);
      }
      pop();
    }

    getDisplayBoundingBox() {
      // covers the seam back to where he rewound from, not just the blast
      let minX = this.position.x - this.radius - 40;
      let minY = this.position.y - this.radius - 40;
      let maxX = this.position.x + this.radius + 40;
      let maxY = this.position.y + this.radius + 40;
      if (this.origin) {
        minX = Math.min(minX, this.origin.x - 20);
        minY = Math.min(minY, this.origin.y - 20);
        maxX = Math.max(maxX, this.origin.x + 20);
        maxY = Math.max(maxY, this.origin.y + 20);
      }
      return new Rectangle({ x: minX, y: minY, w: maxX - minX, h: maxY - minY, data: this });
    }
  }
  return Ekko_R_Object;
}
const __cacheEkko_R_Object = new WeakMap<ContentApi, ReturnType<typeof __buildEkko_R_Object>>();
export function makeEkko_R_Object(api: ContentApi) {
  const cached = __cacheEkko_R_Object.get(api);
  if (cached) return cached;
  const built = __buildEkko_R_Object(api);
  __cacheEkko_R_Object.set(api, built);
  return built;
}