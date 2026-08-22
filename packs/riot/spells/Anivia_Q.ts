import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Chilled = InstanceType<ContentApi['buffs']['Chilled']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Stun = InstanceType<ContentApi['buffs']['Stun']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type Anivia_Q = InstanceType<ReturnType<typeof makeAnivia_Q>>;
type Anivia_Q_Blast = InstanceType<ReturnType<typeof makeAnivia_Q_Blast>>;
type Anivia_Q_Object = InstanceType<ReturnType<typeof makeAnivia_Q_Object>>;



/**
 * Flash Frost. The chunk of ice flies THROUGH everyone, chilling them, and only
 * shatters when Anivia recasts Q — or automatically once it reaches max range.
 *
 * Two-stage spell in the `LeeSin_Q` shape: `phase` on the Spell, `onSpellCast`
 * branches on it, `checkCastCondition` gates the recast, and `onUpdate` puts the
 * spell back to Q1 (on full cooldown) once the missile is gone.
 */
function __buildAnivia_Q(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Anivia_Q_Object = makeAnivia_Q_Object(api);
  class Anivia_Q extends Spell {
    targetingMode = 'DIRECTION' as const;
    image = api.asset('spell_anivia_q');
    name = 'Quả Cầu Băng (Anivia_Q)';
    description =
      'Phóng một khối băng bay chậm <b>xuyên qua</b> mọi kẻ địch trên đường đi, gây <span class="damage">15 sát thương</span> và <span class="buff">Làm Chậm 40%</span> trong <span class="time">2 giây</span>. <b>Bấm lại phím chiêu</b> để cho khối băng nổ sớm: vụ nổ bán kính 150px gây thêm <span class="damage">25 sát thương</span> và <span class="buff">Làm Choáng</span> trong <span class="time">1.2 giây</span>. Nếu không bấm lại, khối băng tự nổ khi bay hết tầm';
    coolDown = 9000;
    manaCost = 30;

    range = 450;
    /** Short beat before the recast is allowed, so one tap cannot detonate instantly. */
    recastDelay = 400;

    phase: 'Q1' | 'Q2' = 'Q1';
    spellObject: Anivia_Q_Object | null = null;

    checkCastCondition() {
      // the recast only exists while there is a chunk of ice still in the air
      if (this.phase === 'Q2') {
        return !!this.spellObject && !this.spellObject.toRemove;
      }
      return true;
    }

    onSpellCast() {
      if (this.phase === 'Q1') {
        const { to } = VectorUtils.getVectorWithRange(this.owner.position, this.aimPoint, this.range);

        const obj = new Anivia_Q_Object(this.owner);
        obj.destination = to;
        this.game.objectManager.addObject(obj);

        this.spellObject = obj;
        this.phase = 'Q2';
        // hand the recast back to the player almost immediately
        // recast window, not a cooldown — deliberately not reduced
        this.currentCooldown = this.recastDelay;
      } else {
        this.spellObject?.detonate();
        this.spellObject = null;
        this.phase = 'Q1';
        this.currentCooldown = this.reducedCooldown(this.coolDown);
      }
    }

    onUpdate() {
      // missile died on its own (auto-detonation at max range) => back to Q1
      if (this.phase === 'Q2' && (!this.spellObject || this.spellObject.toRemove)) {
        this.spellObject = null;
        this.phase = 'Q1';
        this.currentCooldown = this.reducedCooldown(this.coolDown);
      }
    }

    drawPreview() {
      super.drawPreview(this.range);
    }
  }
  return Anivia_Q;
}
const __cacheAnivia_Q = new WeakMap<ContentApi, ReturnType<typeof __buildAnivia_Q>>();
export default function makeAnivia_Q(api: ContentApi) {
  const cached = __cacheAnivia_Q.get(api);
  if (cached) return cached;
  const built = __buildAnivia_Q(api);
  __cacheAnivia_Q.set(api, built);
  return built;
}


function __buildAnivia_Q_Object(api: ContentApi) {
  const BuffAddType = api.enums.BuffAddType;
  const MissileSpellObject = api.MissileSpellObject;
  const Chilled = api.buffs.Chilled;
  const CHILL_DURATION_MS = api.CHILL_DURATION_MS;
  const Slow = api.buffs.Slow;
  const TrailSystem = api.helpers.TrailSystem;
  const Anivia_Q_Blast = makeAnivia_Q_Blast(api);
  class Anivia_Q_Object extends MissileSpellObject {
    // deliberately sluggish — the payoff is the detonation, not the travel
    speed = 5;
    size = 32;
    damage = 15;
    slowTime = 2000;
    slowPercent = 0.4;

    // pierces everything on the way through
    maxHitCount = Infinity;
    // detonation is driven by `detonate()`, so arriving must not silently delete it
    removeOnArrive = false;

    blastRadius = 150;
    blastDamage = 25;
    blastStunTime = 1200;

    _detonated = false;

    trailSystem = new TrailSystem({
      trailSize: this.size / 1.5,
      trailColor: '#a8e4ff55',
      maxLength: 22,
    });

    onHit(enemy: any) {
      enemy.takeDamage(this.damage, this.owner);

      const slowBuff = new Slow(this.slowTime, this.owner, enemy);
      slowBuff.percent = this.slowPercent;
      slowBuff.buffAddType = BuffAddType.RENEW_EXISTING;
      enemy.addBuff(slowBuff);

      // Frostbite (E) reads this to double its damage — see Chilled.ts.
      enemy.addBuff(new Chilled(CHILL_DURATION_MS, this.owner, enemy));
    }

    /** Shatter now. Safe to call twice: only the first call spawns the blast. */
    detonate() {
      if (this._detonated) return;
      this._detonated = true;

      const blast = new Anivia_Q_Blast(this.owner);
      blast.position = this.position.copy();
      blast.maxRadius = this.blastRadius;
      blast.damage = this.blastDamage;
      blast.stunTime = this.blastStunTime;
      this.game.objectManager.addObject(blast);

      this.toRemove = true;
    }

    /** Not recast in time: it shatters on its own at the end of the path. */
    onArrive() {
      this.detonate();
    }

    draw() {
      // the chunk is armed the whole time it flies, so it always shows the
      // circle it would shatter into — the recast is a decision, not a gamble
      push();
      noFill();
      const pulse = 0.5 + 0.5 * sin(frameCount / 9);
      stroke(150, 215, 250, 60 + 45 * pulse);
      strokeWeight(2);
      const segments = 30;
      for (let i = 0; i < segments; i++) {
        if (i % 2) continue;
        const a1 = (TWO_PI * i) / segments - frameCount / 160;
        const a2 = (TWO_PI * (i + 1)) / segments - frameCount / 160;
        arc(this.position.x, this.position.y, this.blastRadius * 2, this.blastRadius * 2, a1, a2);
      }
      // frost creeping in from that edge as it charges
      stroke(215, 245, 255, 40 + 40 * pulse);
      strokeWeight(3);
      for (let i = 0; i < 8; i++) {
        const a = (TWO_PI * i) / 8 + frameCount / 200;
        line(
          this.position.x + cos(a) * this.blastRadius,
          this.position.y + sin(a) * this.blastRadius,
          this.position.x + cos(a) * (this.blastRadius - 16),
          this.position.y + sin(a) * (this.blastRadius - 16)
        );
      }
      pop();

      push();
      translate(this.position.x, this.position.y);
      rotate(frameCount / 40);

      const r = this.size / 2;

      // a hexagonal shard of ice rather than a ball: faceted, with a lit core
      stroke(35, 90, 130, 235);
      strokeWeight(4);
      fill(120, 195, 240, 225);
      beginShape();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TWO_PI;
        vertex(cos(a) * r * 1.15, sin(a) * r * 1.15);
      }
      endShape(CLOSE);

      // facets cut into the face
      stroke(240, 252, 255, 200);
      strokeWeight(2);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TWO_PI;
        line(0, 0, cos(a) * r * 1.05, sin(a) * r * 1.05);
      }

      // spikes of frost growing off the corners
      stroke(255, 255, 255, 230);
      strokeWeight(3.5);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TWO_PI + PI / 6;
        line(cos(a) * r * 0.7, sin(a) * r * 0.7, cos(a) * (r + 11), sin(a) * (r + 11));
      }

      noStroke();
      fill(255, 255, 255, 200 + 55 * pulse);
      circle(0, 0, r * 0.8);

      pop();
    }

    // the armed ring is far wider than the shard itself
    getDisplayBoundingBox() {
      const r = this.blastRadius + 20;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Anivia_Q_Object;
}
const __cacheAnivia_Q_Object = new WeakMap<ContentApi, ReturnType<typeof __buildAnivia_Q_Object>>();
export function makeAnivia_Q_Object(api: ContentApi) {
  const cached = __cacheAnivia_Q_Object.get(api);
  if (cached) return cached;
  const built = __buildAnivia_Q_Object(api);
  __cacheAnivia_Q_Object.set(api, built);
  return built;
}


/** The shatter: one burst of damage and a stun, then it fades. */
function __buildAnivia_Q_Blast(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const BuffAddType = api.enums.BuffAddType;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellObject = api.SpellObject;
  const Stun = api.buffs.Stun;
  class Anivia_Q_Blast extends SpellObject {
    position = this.owner.position.copy();
    maxRadius = 150;
    damage = 25;
    stunTime = 1200;

    lifeTime = 500;
    age = 0;
    radius = 0;
    hasDealtDamage = false;

    update() {
      if (!this.hasDealtDamage) {
        this.hasDealtDamage = true;

        const enemies = this.game.objectManager.queryObjects({
          area: new Circle({
            x: this.position.x,
            y: this.position.y,
            r: this.maxRadius,
          }),
          filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
        });

        enemies.forEach((enemy: any) => {
          enemy.takeDamage(this.damage, this.owner);

          const stunBuff = new Stun(this.stunTime, this.owner, enemy);
          stunBuff.buffAddType = BuffAddType.RENEW_EXISTING;
          enemy.addBuff(stunBuff);
        });
      }

      this.age += deltaTime;
      this.radius = lerp(this.radius, this.maxRadius, 0.25);

      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const fade = 1 - t;
      const flash = 1 - constrain(t / 0.2, 0, 1);

      push();
      translate(this.position.x, this.position.y);

      // the area that was actually hit, filled so it cannot be missed
      noStroke();
      fill(150, 215, 250, 110 * fade);
      circle(0, 0, this.maxRadius * 2);

      // hard frozen rim exactly on the blast radius
      noFill();
      stroke(35, 90, 135, 220 * fade);
      strokeWeight(10 * fade + 2);
      circle(0, 0, this.maxRadius * 2);
      stroke(240, 252, 255, 250 * fade);
      strokeWeight(4 * fade + 1.5);
      circle(0, 0, this.maxRadius * 2);

      // the shatter front racing out to it
      stroke(215, 245, 255, 230 * fade);
      strokeWeight(9 * fade + 2);
      circle(0, 0, this.radius * 2);

      // splinters of the chunk thrown out to the edge
      strokeWeight(4 * fade + 1);
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * TWO_PI + 0.2;
        const inner = this.maxRadius * (0.25 + t * 0.5);
        const outer = inner + this.maxRadius * 0.3 * fade + 8;
        stroke(255, 255, 255, 235 * fade);
        line(cos(a) * inner, sin(a) * inner, cos(a) * outer, sin(a) * outer);
      }

      // spikes of ice punched up around the rim
      stroke(230, 250, 255, 200 * fade);
      strokeWeight(3);
      fill(180, 230, 255, 150 * fade);
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * TWO_PI + 0.35;
        const base = this.maxRadius * 0.92;
        const tip = this.maxRadius * (1 + 0.16 * (0.4 + fade));
        triangle(
          cos(a) * base - sin(a) * 11,
          sin(a) * base + cos(a) * 11,
          cos(a) * base + sin(a) * 11,
          sin(a) * base - cos(a) * 11,
          cos(a) * tip,
          sin(a) * tip
        );
      }

      // the crack of the shatter
      if (flash > 0) {
        noStroke();
        fill(255, 255, 255, 235 * flash);
        circle(0, 0, this.maxRadius * flash + 24);
      }

      pop();
    }

    getDisplayBoundingBox() {
      const r = this.maxRadius + 40; // the rim spikes stand outside the blast
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Anivia_Q_Blast;
}
const __cacheAnivia_Q_Blast = new WeakMap<ContentApi, ReturnType<typeof __buildAnivia_Q_Blast>>();
export function makeAnivia_Q_Blast(api: ContentApi) {
  const cached = __cacheAnivia_Q_Blast.get(api);
  if (cached) return cached;
  const built = __buildAnivia_Q_Blast(api);
  __cacheAnivia_Q_Blast.set(api, built);
  return built;
}