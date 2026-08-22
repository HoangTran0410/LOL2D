import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Airborne = InstanceType<ContentApi['buffs']['Airborne']>;
type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Fizz_R = InstanceType<ReturnType<typeof makeFizz_R>>;
type Fizz_R_Lure = InstanceType<ReturnType<typeof makeFizz_R_Lure>>;
type Fizz_R_Shark = InstanceType<ReturnType<typeof makeFizz_R_Shark>>;



export const RANGE = 700;

export const RADIUS = 220;

export const DAMAGE = 48;

export const FUSE_MS = 1400;

/** How long the shark is out of the ground. The bite has to be watchable. */
export const ERUPT_MS = 700;


/**
 * Chum the Waters. The lure sticks to the first champion it touches and the
 * shark comes up under *them* — so the ultimate is dodged by not being hit by
 * the throw, and by everyone else walking away from whoever was.
 */
function __buildFizz_R(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Fizz_R_Lure = makeFizz_R_Lure(api);
  class Fizz_R extends Spell {
    targetingMode = 'DIRECTION' as const;
    image = api.asset('spell_fizz_r');
    name = 'Triệu Hồi Thủy Quái (Fizz_R)';
    description =
      `Ném một con cá mồi <span>${RANGE}px</span>. Nó dính vào mục tiêu đầu tiên trúng phải (hoặc rơi xuống đất),` +
      ` và sau <span class="time">${FUSE_MS / 1000} giây</span> một con cá mập trồi lên:` +
      ` <span class="damage">${DAMAGE} sát thương</span>, <span class="buff">Hất Tung</span> và` +
      ` <span class="buff">Làm Chậm 60%</span> trong <span>${RADIUS}px</span>`;
    coolDown = 10000;
    manaCost = 80;

    range = RANGE;

    onSpellCast() {
      const { to } = VectorUtils.getVectorWithRange(this.owner.position, this.aimPoint, this.range);
      const lure = new Fizz_R_Lure(this.owner);
      lure.destination = to;
      this.game.objectManager.addObject(lure);
    }

    drawPreview() {
      super.drawPreview(this.range);
    }
  }
  return Fizz_R;
}
const __cacheFizz_R = new WeakMap<ContentApi, ReturnType<typeof __buildFizz_R>>();
export default function makeFizz_R(api: ContentApi) {
  const cached = __cacheFizz_R.get(api);
  if (cached) return cached;
  const built = __buildFizz_R(api);
  __cacheFizz_R.set(api, built);
  return built;
}


function __buildFizz_R_Lure(api: ContentApi) {
  const MissileSpellObject = api.MissileSpellObject;
  const AttackableUnit = api.units.AttackableUnit;
  const Fizz_R_Shark = makeFizz_R_Shark(api);
  class Fizz_R_Lure extends MissileSpellObject {
    speed = 12;
    size = 26;
    maxHitCount = 1;

    onHit(enemy: AttackableUnit) {
      this.drop(enemy);
    }

    onArrive() {
      // Nothing caught it: the fish lands on the ground and the shark still comes.
      if (this.hitTargets.length === 0) this.drop(null);
    }

    drop(stuckTo: AttackableUnit | null) {
      const shark = new Fizz_R_Shark(this.owner);
      shark.position = (stuckTo?.position ?? this.position).copy();
      shark.stuckTo = stuckTo;
      this.game.objectManager.addObject(shark);
    }

    draw() {
      push();
      translate(this.position.x, this.position.y);
      rotate(frameCount / 6);
      noStroke();
      fill(120, 200, 255, 235);
      ellipse(0, 0, 24, 14);
      fill(80, 150, 210, 235);
      triangle(-12, 0, -22, -8, -22, 8);
      pop();
    }
  }
  return Fizz_R_Lure;
}
const __cacheFizz_R_Lure = new WeakMap<ContentApi, ReturnType<typeof __buildFizz_R_Lure>>();
export function makeFizz_R_Lure(api: ContentApi) {
  const cached = __cacheFizz_R_Lure.get(api);
  if (cached) return cached;
  const built = __buildFizz_R_Lure(api);
  __cacheFizz_R_Lure.set(api, built);
  return built;
}


function __buildFizz_R_Shark(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellObject = api.SpellObject;
  const Airborne = api.buffs.Airborne;
  const Slow = api.buffs.Slow;
  const AttackableUnit = api.units.AttackableUnit;
  class Fizz_R_Shark extends SpellObject {
    position: p5.Vector = this.owner.position.copy();
    stuckTo: AttackableUnit | null = null;
    radius = RADIUS;
    visionRadius = RADIUS;
    lifeTime = FUSE_MS + ERUPT_MS;
    age = 0;
    erupted = false;

    update() {
      // The lure rides the body it stuck to, so running does not save the victim
      // — only their friends.
      const host = this.stuckTo as any;
      if (host && !host.isDead) this.position = host.position.copy();

      this.age += deltaTime;
      if (this.age >= this.lifeTime) {
        this.toRemove = true;
        return;
      }
      if (this.erupted || this.age < FUSE_MS) return;
      this.erupted = true;

      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({ x: this.position.x, y: this.position.y, r: this.radius }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      });
      enemies.forEach((enemy: any) => {
        enemy.takeDamage(DAMAGE, this.owner);
        enemy.addBuff(new Airborne(700, this.owner, enemy));
        const slow = new Slow(2000, this.owner, enemy);
        slow.percent = 0.6;
        enemy.addBuff(slow);
      });

      // No `AoePulse` here on purpose. The shared shapes are radial, and
      // `columns` is Alistar Q's ground-eruption — using it made the ultimate
      // read as a rock pillar with a fish icon. A shark coming up out of the
      // floor is a *specific* picture, so it gets drawn below rather than
      // borrowed.
    }

    /** 0 at the surface, 1 at the top of the leap, back to 0 as it crashes down. */
    get leap(): number {
      const t = constrain((this.age - FUSE_MS) / ERUPT_MS, 0, 1);
      return Math.sin(t * PI);
    }

    draw() {
      const t = constrain(this.age / FUSE_MS, 0, 1);
      push();
      translate(this.position.x, this.position.y);
      if (!this.erupted) {
        noFill();
        stroke(120, 210, 255, 220);
        strokeWeight(3);
        circle(0, 0, this.radius * 2);
        noStroke();
        fill(90, 180, 240, 70 * t);
        circle(0, 0, this.radius * 2 * t);
        // the fin circling in, closer every frame
        const a = this.age / 160;
        const d = this.radius * (1 - t * 0.85);
        fill(60, 130, 200, 240);
        triangle(
          cos(a) * d,
          sin(a) * d,
          cos(a) * d - 12,
          sin(a) * d + 14,
          cos(a) * d + 12,
          sin(a) * d + 14
        );
        pop();
        return;
      }

      // ------------------------------------------------------------- the bite
      const rise = this.leap;
      const gone = constrain((this.age - FUSE_MS) / ERUPT_MS, 0, 1);

      // water thrown outward along the ground, so the blast radius stays legible
      noFill();
      stroke(190, 240, 255, 220 * (1 - gone));
      strokeWeight(7 * (1 - gone) + 2);
      circle(0, 0, this.radius * 2 * (0.35 + 0.65 * gone));
      noStroke();
      fill(150, 220, 255, 70 * (1 - gone));
      circle(0, 0, this.radius * 2 * (0.3 + 0.7 * gone));

      // the shark itself, launching up out of the hole and falling back
      const height = rise * 150;
      const scale = 1 + rise * 0.5;
      push();
      translate(0, -height);
      // it twists as it comes up, so the jaws face the camera at the top
      rotate(-HALF_PI + rise * 0.55);

      // body
      fill(70, 120, 175);
      ellipse(0, 26 * scale, 62 * scale, 118 * scale);
      // tail fin, trailing back into the water
      fill(55, 100, 150);
      triangle(0, 84 * scale, -34 * scale, 128 * scale, 34 * scale, 128 * scale);
      // dorsal
      triangle(0, 4 * scale, -10 * scale, 46 * scale, 10 * scale, 46 * scale);

      // jaws — the reason the ability exists. They snap shut across the leap.
      const gape = (1 - rise) * 0.55 + 0.12;
      fill(40, 75, 115);
      arc(0, -18 * scale, 58 * scale, 62 * scale, PI + gape, TWO_PI - gape, PIE);
      fill(200, 40, 60);
      arc(0, -18 * scale, 44 * scale, 46 * scale, PI + gape, TWO_PI - gape, PIE);
      fill(255);
      for (let i = -2; i <= 2; i++) {
        const x = i * 10 * scale;
        triangle(x - 4 * scale, -34 * scale, x + 4 * scale, -34 * scale, x, -22 * scale);
        triangle(x - 4 * scale, -4 * scale, x + 4 * scale, -4 * scale, x, -16 * scale);
      }
      // eye
      fill(20, 30, 45);
      circle(-18 * scale, -6 * scale, 8 * scale);
      pop();

      // spray following it up
      noStroke();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TWO_PI;
        const d = this.radius * 0.35 * gone;
        fill(210, 245, 255, 200 * (1 - gone));
        circle(cos(a) * d, sin(a) * d - height * 0.5, 10 * (1 - gone) + 3);
      }

      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox(this.radius * 2);
    }
  }
  return Fizz_R_Shark;
}
const __cacheFizz_R_Shark = new WeakMap<ContentApi, ReturnType<typeof __buildFizz_R_Shark>>();
export function makeFizz_R_Shark(api: ContentApi) {
  const cached = __cacheFizz_R_Shark.get(api);
  if (cached) return cached;
  const built = __buildFizz_R_Shark(api);
  __cacheFizz_R_Shark.set(api, built);
  return built;
}