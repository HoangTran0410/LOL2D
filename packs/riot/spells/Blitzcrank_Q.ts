import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Airborne = InstanceType<ContentApi['buffs']['Airborne']>;
type Dash = InstanceType<ContentApi['buffs']['Dash']>;
type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type RootBuff = InstanceType<ContentApi['buffs']['Root']>;
type Spell = InstanceType<ContentApi['Spell']>;
type Blitzcrank_Q = InstanceType<ReturnType<typeof makeBlitzcrank_Q>>;
type Blitzcrank_Q_Object = InstanceType<ReturnType<typeof makeBlitzcrank_Q_Object>>;



function __buildBlitzcrank_Q(api: ContentApi) {
  const BuffAddType = api.enums.BuffAddType;
  const Spell = api.Spell;
  const RootBuff = api.buffs.Root;
  const VectorUtils = api.utils.VectorUtils;
  const Blitzcrank_Q_Object = makeBlitzcrank_Q_Object(api);
  class Blitzcrank_Q extends Spell {
    targetingMode = 'DIRECTION' as const;
    name = 'Bàn Tay Hỏa Tiễn (Blitzcrank_Q)';
    image = api.asset('spell_blitzcrank_q');
    description =
      'Bắn bàn tay theo hướng chỉ định, <span class="buff">Kéo</span> kẻ địch đầu tiên trúng phải về phía bạn, gây <span class="damage">20 sát thương</span> và <span class="buff">Làm Choáng</span> chúng trong <span class="time">0.5 giây</span>';
    coolDown = 5000;
    manaCost = 20;

    blitObj: Blitzcrank_Q_Object | null = null;
    ownerStunBuff: RootBuff | null = null;

    onSpellCast() {
      const range = 500;
      const speed = 10;
      const grabSpeed = 10;

      const { to: destination } = VectorUtils.getVectorWithRange(
        this.owner.position,
        this.aimPoint,
        range
      );

      this.blitObj = new Blitzcrank_Q_Object(this.owner);
      this.blitObj.position = this.owner.position.copy();
      this.blitObj.destination = destination;
      this.blitObj.speed = speed;
      this.blitObj.grabSpeed = grabSpeed;
      this.blitObj.range = range;
      this.game.objectManager.addObject(this.blitObj);

      this.ownerStunBuff = new RootBuff(1500, this.owner, this.owner);
      this.ownerStunBuff.buffAddType = BuffAddType.REPLACE_EXISTING;
      this.ownerStunBuff.image = this.image;
      this.owner.addBuff(this.ownerStunBuff);
    }

    onUpdate() {
      if (this.blitObj) {
        if (this.blitObj.phase === Blitzcrank_Q_Object.PHASES.GRAB || this.blitObj.toRemove) {
          this.ownerStunBuff?.deactivateBuff();
        }

        if (this.blitObj.toRemove) {
          this.blitObj = null;
        }
      }
    }
  }
  return Blitzcrank_Q;
}
const __cacheBlitzcrank_Q = new WeakMap<ContentApi, ReturnType<typeof __buildBlitzcrank_Q>>();
export default function makeBlitzcrank_Q(api: ContentApi) {
  const cached = __cacheBlitzcrank_Q.get(api);
  if (cached) return cached;
  const built = __buildBlitzcrank_Q(api);
  __cacheBlitzcrank_Q.set(api, built);
  return built;
}


function __buildBlitzcrank_Q_Object(api: ContentApi) {
  const MissileSpellObject = api.MissileSpellObject;
  const Airborne = api.buffs.Airborne;
  const Dash = api.buffs.Dash;
  const Rectangle = api.utils.Quadtree.Rectangle;
  class Blitzcrank_Q_Object extends MissileSpellObject {
    range = 500;
    speed = 10;
    grabSpeed = 10;
    size = 30;
    // the hand grabs one enemy and drags them home instead of dying on impact
    maxHitCount = 1;
    removeOnMaxHit = false;

    airborneBuff: Airborne | null = null;
    dashBuff: Dash | null = null;
    champToGrab: any = null;

    static PHASES = {
      FORWARD: 'forward',
      GRAB: 'grab',
    } as const;
    phase: (typeof Blitzcrank_Q_Object.PHASES)[keyof typeof Blitzcrank_Q_Object.PHASES] =
      Blitzcrank_Q_Object.PHASES.FORWARD;

    onBeforeMove() {
      if (this.phase === Blitzcrank_Q_Object.PHASES.GRAB) this.speed = this.grabSpeed;
    }

    onHit(enemy: any) {
      this.phase = Blitzcrank_Q_Object.PHASES.GRAB;
      this.champToGrab = enemy;
      this.destination = this.owner.position;

      this.airborneBuff = new Airborne(7000, this.owner, enemy);
      enemy.addBuff(this.airborneBuff);

      this.dashBuff = new Dash(10000, this.owner, enemy);
      this.dashBuff.showTrail = false;
      this.dashBuff.cancelable = false;
      // Same speed the hand itself retracts at, because the hand no longer drags
      // the victim onto itself — they travel side by side from the same point to
      // the same point, which is what keeps the two looking attached.
      this.dashBuff.dashSpeed = this.grabSpeed;
      enemy.addBuff(this.dashBuff);

      enemy.takeDamage(20, this.owner);
    }

    update() {
      super.update();

      if (!this.champToGrab) return;

      // The Dash is the only thing that moves the victim. This used to write
      // `champToGrab.position` directly as well, every frame, on top of the Dash
      // it had already applied for the same pull — and a raw write to `position`
      // answers to nothing. Morgana's Black Shield killed the Dash exactly as it
      // is meant to and then watched the hand haul the champion in regardless,
      // which is what "E chặn mọi khống chế nhưng vẫn bị Blitz kéo" was.
      if (!this.dashBuff || this.dashBuff.toRemove) {
        this.champToGrab = null;
        this.toRemove = true;
        return;
      }

      this.dashBuff.dashDestination = this.owner.position.copy();

      if (this.champToGrab.isDead) {
        this.toRemove = true;
      }
    }

    onRemoved() {
      this.airborneBuff?.deactivateBuff?.();
      this.dashBuff?.deactivateBuff?.();
    }

    draw() {
      push();

      const alpha = constrain(
        map(this.position.dist(this.owner.position), 0, this.range, 200, 50),
        50,
        200
      );
      stroke(255, alpha);
      strokeWeight(4);
      line(this.owner.position.x, this.owner.position.y, this.position.x, this.position.y);

      noStroke();
      fill(255, 150, 50);
      circle(this.position.x, this.position.y, this.size);

      fill(200, 100, 90);
      const dir = p5.Vector.sub(this.destination, this.position).normalize();
      for (let i = 0; i < 3; i++) {
        const angle = dir.heading() + (i - 1) * 0.5;
        const x = this.position.x + cos(angle) * this.size;
        const y = this.position.y + sin(angle) * this.size;
        circle(x, y, 15);
      }

      pop();
    }

    // the arm spans from the caster to the hand, so the box must cover both
    getDisplayBoundingBox() {
      return new Rectangle({
        x: Math.min(this.position.x, this.owner.position.x) - this.size / 2,
        y: Math.min(this.position.y, this.owner.position.y) - this.size / 2,
        w: Math.abs(this.position.x - this.owner.position.x) + this.size,
        h: Math.abs(this.position.y - this.owner.position.y) + this.size,
        data: this,
      });
    }
  }
  return Blitzcrank_Q_Object;
}
const __cacheBlitzcrank_Q_Object = new WeakMap<ContentApi, ReturnType<typeof __buildBlitzcrank_Q_Object>>();
export function makeBlitzcrank_Q_Object(api: ContentApi) {
  const cached = __cacheBlitzcrank_Q_Object.get(api);
  if (cached) return cached;
  const built = __buildBlitzcrank_Q_Object(api);
  __cacheBlitzcrank_Q_Object.set(api, built);
  return built;
}