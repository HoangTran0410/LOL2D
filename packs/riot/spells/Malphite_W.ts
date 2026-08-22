import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Shield = InstanceType<ContentApi['buffs']['Shield']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type StatAmp = InstanceType<ContentApi['buffs']['StatAmp']>;
type Malphite_W = InstanceType<ReturnType<typeof makeMalphite_W>>;
type Malphite_W_Armor = InstanceType<ReturnType<typeof makeMalphite_W_Armor>>;



// Exported so the suite asserts the armor's wiring against the spell's real
// tuning instead of a copied set of numbers — retuning a value should not
// mean editing a test.
export const DURATION_MS = 4_000;

// A champion pool is 100 health, so a shield is sized as a share of that.
export const SHIELD_AMOUNT = 25;

export const SIZE_BONUS = 10;

export const COOLDOWN_MS = 10_000;

export const MANA_COST = 40;


// Armor object tuning.
export const PLATE_COUNT = 7;

export const SLAM_MS = 200;

export const DUST_SPAWN_INTERVAL_MS = 90;

export const DUST_MAX_COUNT = 12;

export const DUST_LIFETIME_MS = 550;

/** How far past the owner's own radius the display box reaches, so orbiting
 *  plates, the duration ring and the slam burst never get clipped by the
 *  camera-bound cull in ObjectManager.draw(). */
export const BOUNDING_MARGIN = 90;

/**
 * Belt-and-braces upper bound on how long this purely cosmetic wrapper can
 * live. The real exit is `SpellObject.attachmentLost` — the buff expiring or
 * the caster dying — and that already resolves the buff instance the unit
 * actually ticks, so this should never fire. It stays because the one report
 * of this armour surviving forever was never reproduced: if there is a path
 * nobody has found, an upper bound turns a permanent artefact into a
 * few-second one.
 */
export const HARD_STOP_MS = DURATION_MS + DUST_LIFETIME_MS + 1_000;


function __buildMalphite_W(api: ContentApi) {
  const Spell = api.Spell;
  const Shield = api.buffs.Shield;
  const StatAmp = api.buffs.StatAmp;
  const Malphite_W_Armor = makeMalphite_W_Armor(api);
  class Malphite_W extends Spell {
    targetingMode = 'POINT' as const;
    image = api.asset('spell_malphite_w');
    name = 'Nắm Đấm Chấn Động (Malphite_W)';
    description =
      'Malphite phình to lớp vỏ đá của mình trong <span class="time">4 giây</span>, nhận <span class="buff">Khiên hấp thụ 25 sát thương</span> và tăng kích thước cơ thể';
    coolDown = COOLDOWN_MS;
    manaCost = MANA_COST;

    duration = DURATION_MS;
    shieldAmount = SHIELD_AMOUNT;
    sizeBonus = SIZE_BONUS;

    onSpellCast() {
      const shieldBuff = new Shield(this.duration, this.owner, this.owner);
      shieldBuff.image = this.image;
      shieldBuff.amount = this.shieldAmount;
      shieldBuff.color = [180, 170, 205];
      // Without its own id this shares one stack pool with every other bare Shield
      shieldBuff.stackId = 'malphite_w_shield';
      this.owner.addBuff(shieldBuff);

      const bulkBuff = new StatAmp(this.duration, this.owner, this.owner);
      bulkBuff.stackId = 'malphite_w_bulk';
      bulkBuff.image = this.image;
      bulkBuff.name = 'Đá Tảng';
      bulkBuff.bonuses = { size: { baseBonus: this.sizeBonus } };
      this.owner.addBuff(bulkBuff);

      // a shield ring plus a slightly bigger sprite is almost no feedback for a
      // 4-second self-buff, so wrap him in visible stone for exactly as long as
      // the buff lives (the object watches the buff, it does not time itself)
      const armor = new Malphite_W_Armor(this.owner);
      armor.attachTo(this.owner, bulkBuff);
      this.game.objectManager.addObject(armor);
    }
  }
  return Malphite_W;
}
const __cacheMalphite_W = new WeakMap<ContentApi, ReturnType<typeof __buildMalphite_W>>();
export default function makeMalphite_W(api: ContentApi) {
  const cached = __cacheMalphite_W.get(api);
  if (cached) return cached;
  const built = __buildMalphite_W(api);
  __cacheMalphite_W.set(api, built);
  return built;
}


/** Slabs of rock orbiting Malphite while Brutal Strikes is up. */
function __buildMalphite_W_Armor(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class Malphite_W_Armor extends SpellObject {
    age = 0;
    plateCount = PLATE_COUNT;

    _dust: { a: number; r: number; age: number; size: number }[] = [];
    _dustTimer = 0;

    update() {
      this.age += deltaTime;
      this.position.set(this.owner.position.x, this.owner.position.y);

      if (this.age >= HARD_STOP_MS) {
        this.toRemove = true;
        return;
      }

      // One question, asked in one place, and it latches: once the shell is gone
      // it never comes back, so a Malphite who dies and respawns elsewhere does
      // not arrive still wearing it. The dust already in the air is allowed to
      // fall rather than popping out of existence with the plates.
      if (!this.attachmentLost) {
        this._dustTimer += deltaTime;
        if (this._dustTimer >= DUST_SPAWN_INTERVAL_MS && this._dust.length < DUST_MAX_COUNT) {
          this._dustTimer = 0;
          this._dust.push({
            a: random(TWO_PI),
            r: this.owner.animatedValues.displaySize / 2 + random(0, 10),
            age: 0,
            size: random(4, 9),
          });
        }
      } else if (this._dust.length === 0) {
        this.toRemove = true;
      }

      let i = 0;
      while (i < this._dust.length) {
        const d = this._dust[i];
        d.age += deltaTime;
        if (d.age >= DUST_LIFETIME_MS) this._dust.splice(i, 1);
        else i++;
      }
    }

    draw() {
      const size = this.owner.animatedValues.displaySize;
      const radius = size / 2;
      const buff = this._anchorBuff;
      // the same latched question update() asks, so the two can no longer drift:
      // a corpse must not keep its plates or duration ring painted
      const alive = !this.attachmentLost;
      const left =
        alive && buff && buff.duration ? constrain(1 - buff.timeElapsed / buff.duration, 0, 1) : 0;
      // slams on in the first 200ms, so the cast has a moment of impact
      const slam = constrain(this.age / SLAM_MS, 0, 1);
      const spin = frameCount / 90;
      // seated from outside in as the spell lands, then held clear of the body
      // so the plates read as orbiting stone rather than hugging the sprite
      const seat = radius + 26 - 18 * slam;

      push();
      translate(this.position.x, this.position.y);

      // grit crumbling off the shell
      noStroke();
      for (const d of this._dust) {
        const t = d.age / DUST_LIFETIME_MS;
        fill(196, 158, 120, 165 * (1 - t));
        circle(cos(d.a) * (d.r + t * 10), sin(d.a) * (d.r + t * 10) + t * 6, d.size * (1 - t * 0.5));
      }

      if (alive) {
        // a low, wide glow behind the plates so the whole ring pops off grey
        // terrain and fog-of-war instead of blending into it
        blendMode(ADD);
        noStroke();
        fill(110, 90, 160, 55 * (0.5 + 0.5 * slam));
        circle(0, 0, seat * 2 + 26);
        blendMode(BLEND);

        // interlocking plates
        for (let i = 0; i < this.plateCount; i++) {
          const a = (i / this.plateCount) * TWO_PI + spin;
          push();
          rotate(a);
          translate(seat, 0);
          rotate(HALF_PI);
          stroke(24, 20, 34, 245);
          strokeWeight(2.5);
          fill(96, 78, 118, 235 * (0.4 + 0.6 * slam));
          beginShape();
          vertex(-15, -8);
          vertex(-8, -14);
          vertex(13, -9);
          vertex(15, 7);
          vertex(0, 14);
          vertex(-14, 7);
          endShape(CLOSE);
          // lit facet catching the light, same trick Malphite's Q shard uses to
          // read as crystal rather than a flat grey shape
          noStroke();
          fill(224, 214, 250, 220);
          triangle(-8, -9, 5, -8, -3, -1);
          pop();
        }

        // how much of the 4 seconds is left
        noFill();
        stroke(150, 142, 180, 110);
        strokeWeight(4);
        circle(0, 0, seat * 2 + 34);
        stroke(230, 222, 255, 235);
        strokeWeight(4);
        arc(0, 0, seat * 2 + 34, seat * 2 + 34, -HALF_PI, -HALF_PI + TWO_PI * left);
      }

      // the slam itself
      if (this.age < 300) {
        const t = this.age / 300;
        noFill();
        stroke(215, 205, 245, 220 * (1 - t));
        strokeWeight(6 * (1 - t) + 1);
        circle(0, 0, size + 120 * t);
      }
      pop();
    }

    getDisplayBoundingBox() {
      const r = this.owner.animatedValues.displaySize / 2 + BOUNDING_MARGIN;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Malphite_W_Armor;
}
const __cacheMalphite_W_Armor = new WeakMap<ContentApi, ReturnType<typeof __buildMalphite_W_Armor>>();
export function makeMalphite_W_Armor(api: ContentApi) {
  const cached = __cacheMalphite_W_Armor.get(api);
  if (cached) return cached;
  const built = __buildMalphite_W_Armor(api);
  __cacheMalphite_W_Armor.set(api, built);
  return built;
}