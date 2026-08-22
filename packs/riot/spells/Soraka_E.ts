import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Root = InstanceType<ContentApi['buffs']['Root']>;
type Silence = InstanceType<ContentApi['buffs']['Silence']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Soraka_E = InstanceType<ReturnType<typeof makeSoraka_E>>;
type Soraka_E_Object = InstanceType<ReturnType<typeof makeSoraka_E_Object>>;



/**
 * Equinox. Two halves of one field: while it stands, nobody inside may cast;
 * when it collapses, everybody inside is rooted. The silence is reapplied on a
 * tick with a short linger, so walking out ends it a beat later rather than on
 * the exact frame — the same shape Cassiopeia's cloud uses for its slow.
 */
export const COOLDOWN_MS = 9_000;

export const MANA_COST = 35;

export const CAST_RANGE = 450;

export const RADIUS = 110;

/** Damage on the way in, and again when it collapses: 32 in total if you stay. */
export const IMPACT_DAMAGE = 16;

export const ERUPT_DAMAGE = 16;

export const ZONE_DURATION_MS = 1_500;

export const ROOT_DURATION_MS = 1_250;


function __buildSoraka_E(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Soraka_E_Object = makeSoraka_E_Object(api);
  class Soraka_E extends Spell {
    targetingMode = 'POINT' as const;
    image = api.asset('spell_soraka_e');
    name = 'Điểm Phân Cực (Soraka_E)';
    description = `Mở một vùng ngày-đêm tại vị trí chỉ định, gây <span class="damage">${IMPACT_DAMAGE} sát thương</span> ngay lập tức và <span class="buff">Câm Lặng</span> kẻ địch đứng trong đó. Sau <span class="time">${ZONE_DURATION_MS / 1000} giây</span> vùng này sụp xuống, gây thêm <span class="damage">${ERUPT_DAMAGE} sát thương</span> và <span class="buff">Trói</span> trong <span class="time">${ROOT_DURATION_MS / 1000} giây</span>.`;
    coolDown = COOLDOWN_MS;
    manaCost = MANA_COST;

    castRange = CAST_RANGE;

    onSpellCast() {
      const { to } = VectorUtils.getVectorWithMaxRange(
        this.owner.position,
        this.aimPoint,
        this.castRange
      );

      const zone = new Soraka_E_Object(this.owner);
      zone.position = to;
      this.game.objectManager.addObject(zone);
    }

    drawPreview() {
      super.drawPreview(this.castRange);
    }
  }
  return Soraka_E;
}
const __cacheSoraka_E = new WeakMap<ContentApi, ReturnType<typeof __buildSoraka_E>>();
export default function makeSoraka_E(api: ContentApi) {
  const cached = __cacheSoraka_E.get(api);
  if (cached) return cached;
  const built = __buildSoraka_E(api);
  __cacheSoraka_E.set(api, built);
  return built;
}


interface Glyph {
  angle: number;
  radius: number;
  size: number;
  spin: number;
}


const GLYPH_COUNT = 8;


function __buildSoraka_E_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const BuffAddType = api.enums.BuffAddType;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellObject = api.SpellObject;
  const Root = api.buffs.Root;
  const Silence = api.buffs.Silence;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
  class Soraka_E_Object extends SpellObject {
    /** A field lying on the ground: units wade through it, not behind it. */
    zIndex = GROUND_Z_INDEX;

    position: p5.Vector = this.owner.position.copy();

    radius = RADIUS;
    lifeTime = ZONE_DURATION_MS;
    /** The collapse is drawn after the field's life, not inside it. */
    collapseTime = 400;
    age = 0;

    /** Silence is refreshed on a tick rather than every frame, to avoid garbage. */
    reapplyInterval = 200;
    silenceLinger = 200;
    _timeSinceReapply = this.reapplyInterval; // bite on the very first frame

    hasImpacted = false;
    hasCollapsed = false;

    _glyphs: Glyph[] = [];

    onAdded() {
      for (let i = 0; i < GLYPH_COUNT; i++) {
        this._glyphs.push({
          angle: (TWO_PI * i) / GLYPH_COUNT,
          radius: this.radius * random(0.55, 0.88),
          size: random(10, 18),
          spin: random(0.0003, 0.0009) * (i % 2 === 0 ? 1 : -1),
        });
      }
    }

    update() {
      this.age += deltaTime;

      if (!this.hasImpacted) {
        this.hasImpacted = true;
        for (const enemy of this._enemiesInside()) {
          enemy.takeDamage(IMPACT_DAMAGE, this.owner);
        }
      }

      if (this.age < this.lifeTime) {
        this._timeSinceReapply += deltaTime;
        if (this._timeSinceReapply >= this.reapplyInterval) {
          this._timeSinceReapply = 0;
          this._silenceEnemiesInside();
        }
      } else if (!this.hasCollapsed) {
        this.hasCollapsed = true;
        this._collapse();
      }

      if (this.age >= this.lifeTime + this.collapseTime) this.toRemove = true;

      for (const glyph of this._glyphs) glyph.angle += glyph.spin * deltaTime;
    }

    /**
     * Everyone the field overlaps. Deliberately no vision filter: this is an area
     * effect, not an acquisition — a champion standing in a bush inside the zone
     * is standing in the zone.
     */
    _enemiesInside() {
      return this.game.objectManager.queryObjects({
        area: new Circle({ x: this.position.x, y: this.position.y, r: this.radius }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      });
    }

    _silenceEnemiesInside() {
      const duration = this.reapplyInterval + this.silenceLinger;
      for (const enemy of this._enemiesInside()) {
        const silence = new Silence(duration, this.owner, enemy);
        silence.buffAddType = BuffAddType.RENEW_EXISTING;
        enemy.addBuff(silence);
      }
    }

    _collapse() {
      for (const enemy of this._enemiesInside()) {
        enemy.takeDamage(ERUPT_DAMAGE, this.owner);
        enemy.addBuff(new Root(ROOT_DURATION_MS, this.owner, enemy));
      }

      // the collapse throws light outwards, so it reads even at the screen edge
      const burst = PredefinedParticleSystems.smoke([120, 105, 210], 0.5, 9);
      this.useParticles(burst);
      for (let i = 0; i < 20; i++) {
        const angle = random(TWO_PI);
        burst.addParticle({
          x: this.position.x + cos(angle) * this.radius * 0.8,
          y: this.position.y + sin(angle) * this.radius * 0.8,
          size: random(12, 26),
          opacity: 230,
        });
      }
    }

    draw() {
      push();
      translate(this.position.x, this.position.y);

      if (!this.hasCollapsed) {
        const t = constrain(this.age / this.lifeTime, 0, 1);
        // 1-(1-t)^2: the field snaps open, then holds
        const open = constrain(this.age / 220, 0, 1);
        const grow = 1 - (1 - open) * (1 - open);

        // day and night: a bright half and a dark half sharing one disc, which is
        // what makes this field unmistakably Soraka's and nobody else's
        noStroke();
        fill(18, 14, 44, 165);
        arc(0, 0, this.radius * 2 * grow, this.radius * 2 * grow, HALF_PI, HALF_PI + PI);
        fill(226, 231, 255, 70);
        arc(0, 0, this.radius * 2 * grow, this.radius * 2 * grow, -HALF_PI, HALF_PI);

        // hard rim on the actual radius, so the hitbox is not a guess
        noFill();
        stroke(25, 20, 55, 220);
        strokeWeight(7);
        circle(0, 0, this.radius * 2 * grow);
        stroke(205, 200, 255, 235);
        strokeWeight(2);
        circle(0, 0, this.radius * 2 * grow);

        // the dividing line turns: the equinox running down
        const spin = this.age / 900;
        stroke(240, 240, 255, 170);
        strokeWeight(3);
        line(
          cos(spin) * this.radius * grow,
          sin(spin) * this.radius * grow,
          -cos(spin) * this.radius * grow,
          -sin(spin) * this.radius * grow
        );

        // sigils orbiting inside — the silence, made visible
        noStroke();
        for (const glyph of this._glyphs) {
          const x = cos(glyph.angle) * glyph.radius * grow;
          const y = sin(glyph.angle) * glyph.radius * grow;
          fill(255, 250, 230, 190);
          circle(x, y, glyph.size * 0.45);
          fill(160, 150, 255, 110);
          circle(x, y, glyph.size);
        }

        // how much time is left before the roots come up
        stroke(255, 235, 170, 210);
        strokeWeight(5);
        noFill();
        arc(0, 0, this.radius * 2 + 14, this.radius * 2 + 14, -HALF_PI, -HALF_PI + TWO_PI * (1 - t));
      } else {
        const t = constrain((this.age - this.lifeTime) / this.collapseTime, 0, 1);
        const out = 1 - (1 - t) * (1 - t);
        const alpha = 235 * (1 - t);

        noFill();
        stroke(190, 175, 255, alpha);
        strokeWeight(8 * (1 - t) + 1);
        circle(0, 0, this.radius * 2 * (1 + out * 0.45));

        // the roots themselves, snapping shut toward the centre
        stroke(120, 100, 220, alpha);
        strokeWeight(4);
        for (let i = 0; i < 14; i++) {
          const a = (TWO_PI * i) / 14;
          const outer = this.radius * (1 - out * 0.55);
          line(
            cos(a) * outer,
            sin(a) * outer,
            cos(a) * this.radius * 0.15,
            sin(a) * this.radius * 0.15
          );
        }

        if (t < 0.25) {
          const flash = 1 - t / 0.25;
          noStroke();
          fill(255, 255, 245, 200 * flash);
          circle(0, 0, this.radius * 1.5 * flash);
        }
      }

      pop();
    }

    getDisplayBoundingBox() {
      // the collapse ring overshoots the field, and the timer arc sits outside it
      const r = this.radius * 1.5 + 30;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Soraka_E_Object;
}
const __cacheSoraka_E_Object = new WeakMap<ContentApi, ReturnType<typeof __buildSoraka_E_Object>>();
export function makeSoraka_E_Object(api: ContentApi) {
  const cached = __cacheSoraka_E_Object.get(api);
  if (cached) return cached;
  const built = __buildSoraka_E_Object(api);
  __cacheSoraka_E_Object.set(api, built);
  return built;
}