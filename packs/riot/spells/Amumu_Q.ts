import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Dash = InstanceType<ContentApi['buffs']['Dash']>;
type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Stun = InstanceType<ContentApi['buffs']['Stun']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type Amumu_Q = InstanceType<ReturnType<typeof makeAmumu_Q>>;
type Amumu_Q_Impact = InstanceType<ReturnType<typeof makeAmumu_Q_Impact>>;
type Amumu_Q_Object = InstanceType<ReturnType<typeof makeAmumu_Q_Object>>;



/** Dirty linen, with a darker weave underneath for contrast on pale ground. */
const LINEN: [number, number, number] = [235, 222, 172];

const LINEN_DARK: [number, number, number] = [125, 108, 66];


function __buildAmumu_Q(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Amumu_Q_Object = makeAmumu_Q_Object(api);
  class Amumu_Q extends Spell {
    targetingMode = 'DIRECTION' as const;
    image = api.asset('spell_amumu_q');
    name = 'Quăng Dải Băng (Amumu_Q)';
    description =
      'Ném một dải băng về hướng chỉ định. Khi trúng kẻ địch đầu tiên, gây <span class="damage">20 sát thương</span>, <span class="buff">Choáng</span> chúng trong <span class="time">1 giây</span> và <span class="buff">Kéo</span> chính bạn tới chỗ chúng <i>(các hiệu ứng khống chế lên Amumu không ngăn được cú kéo này)</i>';
    coolDown = 8000;
    manaCost = 30;

    range = 550;
    damage = 20;
    stunDuration = 1000;

    /**
     * LoL: immobilising effects do NOT prevent Amumu from commencing the dash, so
     * a root or a stun must not gate the cast — only Grounding blocks it.
     */
    checkCastCondition() {
      return !this.owner.grounded;
    }

    onSpellCast() {
      const { to: destination } = VectorUtils.getVectorWithRange(
        this.owner.position,
        this.aimPoint,
        this.range
      );

      const obj = new Amumu_Q_Object(this.owner);
      obj.destination = destination;
      obj.range = this.range;
      obj.damage = this.damage;
      obj.stunDuration = this.stunDuration;

      this.game.objectManager.addObject(obj);
    }

    drawPreview() {
      super.drawPreview(this.range);
    }
  }
  return Amumu_Q;
}
const __cacheAmumu_Q = new WeakMap<ContentApi, ReturnType<typeof __buildAmumu_Q>>();
export default function makeAmumu_Q(api: ContentApi) {
  const cached = __cacheAmumu_Q.get(api);
  if (cached) return cached;
  const built = __buildAmumu_Q(api);
  __cacheAmumu_Q.set(api, built);
  return built;
}


function __buildAmumu_Q_Object(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const MissileSpellObject = api.MissileSpellObject;
  const Dash = api.buffs.Dash;
  const Stun = api.buffs.Stun;
  const TrailSystem = api.helpers.TrailSystem;
  const Amumu_Q_Impact = makeAmumu_Q_Impact(api);
  class Amumu_Q_Object extends MissileSpellObject {
    range = 550;
    speed = 12;
    size = 20;
    damage = 20;
    stunDuration = 1000;
    // the bandage sticks to the first victim instead of dying on impact — the
    // opposite of Blitzcrank's hook: it reels the caster in, not the target
    maxHitCount = 1;
    removeOnMaxHit = false;

    enemyHit: any = null;
    dashBuff: Dash | null = null;
    stunBuff: Stun | null = null;

    /** Cosmetic only: how far the wrapping has slid along the bandage. */
    _wrapScroll = 0;
    /** Cosmetic only: counts down from the moment of the catch. */
    _catchFlash = 0;

    trailSystem = new TrailSystem({
      trailSize: this.size,
      trailColor: '#E8D9A044',
    });

    onHit(enemy: any) {
      this.enemyHit = enemy;
      this.isMissile = false;
      this._catchFlash = 400;
      // Once it lands, the bandage is a rope strung between two bodies rather
      // than a projectile: it has to drop if either end goes. The victim is
      // checked below; the caster is the attachment.
      this.attachTo(this.owner);

      // the wrap taking hold, so the catch is not a silent teleport
      const impact = new Amumu_Q_Impact(this.owner);
      impact.position = enemy.position.copy();
      this.game.objectManager.addObject(impact);

      enemy.takeDamage(this.damage, this.owner);

      this.stunBuff = new Stun(this.stunDuration, this.owner, enemy);
      enemy.addBuff(this.stunBuff);

      this.dashBuff = new Dash(3000, this.owner, this.owner);
      this.dashBuff.image = api.asset('spell_amumu_q');
      this.dashBuff.dashDestination = enemy.position; // live ref: the rope follows them
      this.dashBuff.dashSpeed = 14;
      // CC on Amumu must not interrupt the reel-in, so the dash is uncancellable
      this.dashBuff.cancelable = false;
      this.dashBuff.onReachedDestination = () => {
        this.toRemove = true;
      };
      this.dashBuff.onDeactivate = () => {
        this.toRemove = true;
      };
      this.owner.addBuff(this.dashBuff);
    }

    update() {
      // the wrapping runs outwards on the throw and reels back on the pull
      this._wrapScroll += (deltaTime / 1000) * (this.enemyHit ? -150 : 220);
      if (this._catchFlash > 0) this._catchFlash -= deltaTime;

      if (!this.enemyHit) {
        super.update();
        return;
      }

      if (this.dropIfAttachmentLost()) {
        this.dashBuff?.deactivateBuff?.();
        return;
      }

      // anchored on the victim while the caster is reeled towards them
      this.position.set(this.enemyHit.position.x, this.enemyHit.position.y);

      if (this.enemyHit.isDead) {
        this.dashBuff?.deactivateBuff?.();
        this.toRemove = true;
      }
    }

    onRemoved() {
      this.dashBuff?.deactivateBuff?.();
    }

    draw() {
      const ownerPos = this.owner.position;
      const hooked = !!this.enemyHit;
      const [lr, lg, lb] = LINEN;
      const [dr, dg, db] = LINEN_DARK;

      const dist = this.position.dist(ownerPos);
      const dirX = dist > 0.001 ? (this.position.x - ownerPos.x) / dist : 1;
      const dirY = dist > 0.001 ? (this.position.y - ownerPos.y) / dist : 0;
      const normX = -dirY;
      const normY = dirX;
      // a rope under tension is straight and thin; a thrown one still has slack
      const sway = hooked ? 0 : 5;

      push();

      // the bandage: a dark weave with a pale cloth over it, so it reads on any ground
      noFill();
      for (const [col, weight] of [
        [[dr, dg, db, 235], 11],
        [[lr, lg, lb, 240], 7],
      ] as [number[], number][]) {
        (stroke as any)(...col);
        strokeWeight(hooked ? weight + 2 : weight);
        beginShape();
        for (let i = 0; i <= 10; i++) {
          const t = i / 10;
          const wobble = sin(t * PI) * sin(this._wrapScroll / 40 + t * 5) * sway;
          vertex(
            ownerPos.x + dirX * dist * t + normX * wobble,
            ownerPos.y + dirY * dist * t + normY * wobble
          );
        }
        endShape();
      }

      // the wrapping itself: diagonal turns of cloth sliding along the strip
      const spacing = 15;
      const wraps = Math.min(48, Math.max(1, Math.floor(dist / spacing)));
      const offset = ((this._wrapScroll % spacing) + spacing) % spacing;
      stroke(dr, dg, db, 200);
      strokeWeight(2.5);
      for (let i = 0; i < wraps; i++) {
        const along = offset + i * spacing;
        if (along > dist - 4) continue;
        const t = along / dist;
        const wobble = sin(t * PI) * sin(this._wrapScroll / 40 + t * 5) * sway;
        const cx = ownerPos.x + dirX * along + normX * wobble;
        const cy = ownerPos.y + dirY * along + normY * wobble;
        const halfW = hooked ? 7 : 6;
        // slanted, so consecutive turns read as a spiral around the strip
        line(
          cx + normX * halfW - dirX * 3,
          cy + normY * halfW - dirY * 3,
          cx - normX * halfW + dirX * 3,
          cy - normY * halfW + dirY * 3
        );
      }

      pop();

      // the head: a wadded ball of bandage, cross-wrapped
      push();
      translate(this.position.x, this.position.y);
      rotate(Math.atan2(dirY, dirX));

      noStroke();
      fill(dr, dg, db, 255);
      circle(0, 0, this.size + 8);
      fill(lr, lg, lb, 255);
      circle(0, 0, this.size + 2);

      stroke(dr, dg, db, 220);
      strokeWeight(2.5);
      noFill();
      arc(0, 0, this.size + 2, this.size + 2, -0.9, 0.9);
      line(-this.size * 0.4, -this.size * 0.3, this.size * 0.45, this.size * 0.2);
      line(-this.size * 0.4, this.size * 0.3, this.size * 0.45, -this.size * 0.2);

      // frayed ends trailing off the ball
      stroke(lr, lg, lb, 190);
      strokeWeight(2);
      for (let i = 0; i < 3; i++) {
        const a = -0.7 + i * 0.7 + sin(this._wrapScroll / 30 + i) * 0.2;
        line(
          cos(a) * this.size * 0.5,
          sin(a) * this.size * 0.5,
          cos(a) * (this.size * 0.5 + 12),
          sin(a) * (this.size * 0.5 + 12)
        );
      }
      pop();

      // while Amumu is being reeled in, chevrons run along the bandage towards
      // the victim — the direction he is about to travel
      if (hooked) {
        const pulse = (frameCount % 30) / 30;
        push();
        noFill();
        stroke(255, 250, 220, 200);
        strokeWeight(3);
        for (let i = 0; i < 3; i++) {
          const along = ((pulse + i / 3) % 1) * dist;
          const bx = ownerPos.x + dirX * along;
          const by = ownerPos.y + dirY * along;
          line(bx - normX * 10 - dirX * 12, by - normY * 10 - dirY * 12, bx, by);
          line(bx + normX * 10 - dirX * 12, by + normY * 10 - dirY * 12, bx, by);
        }
        pop();
      }
    }

    // the bandage spans from the caster to its head, so the box must cover both
    getDisplayBoundingBox() {
      const pad = this.size * 2;
      return new Rectangle({
        x: Math.min(this.position.x, this.owner.position.x) - pad,
        y: Math.min(this.position.y, this.owner.position.y) - pad,
        w: Math.abs(this.position.x - this.owner.position.x) + pad * 2,
        h: Math.abs(this.position.y - this.owner.position.y) + pad * 2,
        data: this,
      });
    }
  }
  return Amumu_Q_Object;
}
const __cacheAmumu_Q_Object = new WeakMap<ContentApi, ReturnType<typeof __buildAmumu_Q_Object>>();
export function makeAmumu_Q_Object(api: ContentApi) {
  const cached = __cacheAmumu_Q_Object.get(api);
  if (cached) return cached;
  const built = __buildAmumu_Q_Object(api);
  __cacheAmumu_Q_Object.set(api, built);
  return built;
}


/** The catch: cloth flaring out and dust knocked off where the bandage bit. */
function __buildAmumu_Q_Impact(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class Amumu_Q_Impact extends SpellObject {
    position = this.owner.position.copy();
    age = 0;
    lifeTime = 400;
    maxRadius = 72;

    _strands: { angle: number; length: number; curl: number }[] = [];

    onAdded() {
      for (let i = 0; i < 9; i++) {
        this._strands.push({
          angle: (TWO_PI * i) / 9 + random(-0.2, 0.2),
          length: random(0.6, 1),
          curl: random(-0.7, 0.7),
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
      const [lr, lg, lb] = LINEN;
      const [dr, dg, db] = LINEN_DARK;

      push();
      translate(this.position.x, this.position.y);

      // dust ring thrown off the wrap
      noFill();
      stroke(dr, dg, db, 190 * fade);
      strokeWeight(9 * fade + 1);
      circle(0, 0, this.maxRadius * 2 * (0.25 + t * 0.75));

      // loose strands whipping out and curling
      stroke(lr, lg, lb, 235 * fade);
      strokeWeight(4 * fade + 1.5);
      noFill();
      for (const s of this._strands) {
        const reach = this.maxRadius * s.length * (0.3 + t * 0.7);
        const a = s.angle;
        beginShape();
        vertex(cos(a) * 8, sin(a) * 8);
        const midA = a + s.curl * 0.3;
        vertex(cos(midA) * reach * 0.6, sin(midA) * reach * 0.6);
        const endA = a + s.curl;
        vertex(cos(endA) * reach, sin(endA) * reach);
        endShape();
      }

      const flash = 1 - constrain(t / 0.28, 0, 1);
      if (flash > 0) {
        noStroke();
        fill(255, 248, 215, 210 * flash);
        circle(0, 0, 42 * flash + 8);
      }

      pop();
    }

    getDisplayBoundingBox() {
      const r = this.maxRadius + 20;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Amumu_Q_Impact;
}
const __cacheAmumu_Q_Impact = new WeakMap<ContentApi, ReturnType<typeof __buildAmumu_Q_Impact>>();
export function makeAmumu_Q_Impact(api: ContentApi) {
  const cached = __cacheAmumu_Q_Impact.get(api);
  if (cached) return cached;
  const built = __buildAmumu_Q_Impact(api);
  __cacheAmumu_Q_Impact.set(api, built);
  return built;
}