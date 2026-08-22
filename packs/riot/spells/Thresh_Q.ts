import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Dash = InstanceType<ContentApi['buffs']['Dash']>;
type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type RootBuff = InstanceType<ContentApi['buffs']['Root']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Stun = InstanceType<ContentApi['buffs']['Stun']>;
type Thresh_Q = InstanceType<ReturnType<typeof makeThresh_Q>>;
type Thresh_Q_Impact = InstanceType<ReturnType<typeof makeThresh_Q_Impact>>;
type Thresh_Q_Object = InstanceType<ReturnType<typeof makeThresh_Q_Object>>;



/** Lantern green — the same light the chain, the scythe and the shackle share. */
const CHAIN_COLOR: [number, number, number] = [130, 255, 175];

const CHAIN_DARK: [number, number, number] = [20, 70, 45];


/**
 * Death Sentence / Deathly Leap.
 *
 * The hook does NOT drag the victim home. On impact it stuns for 1.5s and Thresh
 * tugs the chain exactly twice (0.1s after the hit, then again 0.6s later), each
 * tug hauling the victim only a short distance. 0.5s after the hit Thresh may
 * recast to leap to the shackled victim himself.
 */
function __buildThresh_Q(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const BuffAddType = api.enums.BuffAddType;
  const Spell = api.Spell;
  const Dash = api.buffs.Dash;
  const RootBuff = api.buffs.Root;
  const Thresh_Q_Object = makeThresh_Q_Object(api);
  class Thresh_Q extends Spell {
    targetingMode = 'DIRECTION' as const;
    static PHASES = {
      Q1: {
        image: api.asset('spell_thresh_q'),
      },
      Q2: {
        image: api.asset('spell_thresh_q2'),
      },
    };
    phase: 'Q1' | 'Q2' = 'Q1';

    image = Thresh_Q.PHASES[this.phase].image;
    name = 'Án Tử (Thresh_Q)';
    description =
      'Quăng lưỡi hái theo hướng chỉ định, móc trúng kẻ địch đầu tiên, gây <span class="damage">25 sát thương</span> và <span class="buff">Choáng</span> chúng trong <span class="time">1.5 giây</span>. Thresh giật xích <b>2 lần</b> (sau <span class="time">0.1 giây</span> và <span class="time">0.6 giây</span> kế tiếp), mỗi lần kéo nạn nhân lại gần một đoạn ngắn. Sau <span class="time">0.5 giây</span> có thể tái kích hoạt để <span class="buff">Lướt</span> tới chỗ nạn nhân đang bị xích';
    coolDown = 8000;
    manaCost = 30;

    /** Deathly Leap unlocks 0.5s after the hook connects. */
    coolDownAfterHook = 500;

    range = 550;

    threshObj: Thresh_Q_Object | null = null;
    ownerRootBuff: RootBuff | null = null;

    checkCastCondition() {
      // the recast needs a victim still on the chain, and legs to leap with
      if (this.phase === 'Q2') {
        const victim = this.threshObj?.champHooked;
        return (
          !!this.threshObj &&
          !this.threshObj.toRemove &&
          !!victim &&
          !victim.isDead &&
          Dash.CanDash(this.owner)
        );
      }
      return true;
    }

    onSpellCast() {
      if (this.phase === 'Q2') {
        this._deathlyLeap();
        return;
      }

      const { to: destination } = VectorUtils.getVectorWithRange(
        this.owner.position,
        this.aimPoint,
        this.range
      );

      this.threshObj = new Thresh_Q_Object(this.owner);
      this.threshObj.position = this.owner.position.copy();
      this.threshObj.destination = destination;
      this.threshObj.range = this.range;
      this.threshObj.onHookLanded = () => {
        // shackled: the recast becomes available once the short lockout passes
        // recast window, not a cooldown — deliberately not reduced
        this.phase = 'Q2';
        this.image = Thresh_Q.PHASES.Q2.image;
        this.currentCooldown = this.coolDownAfterHook;
      };
      this.game.objectManager.addObject(this.threshObj);

      // Thresh plants himself while the chain flies out
      this.ownerRootBuff = new RootBuff(1500, this.owner, this.owner);
      this.ownerRootBuff.buffAddType = BuffAddType.REPLACE_EXISTING;
      this.ownerRootBuff.image = Thresh_Q.PHASES.Q1.image;
      this.owner.addBuff(this.ownerRootBuff);
    }

    /** Recast: stop tugging and leap to the shackled victim instead. */
    _deathlyLeap() {
      const victim = this.threshObj!.champHooked;

      const dashBuff = new Dash(2000, this.owner, this.owner);
      dashBuff.image = Thresh_Q.PHASES.Q2.image;
      dashBuff.dashDestination = victim.position; // live ref: home in on the victim
      dashBuff.dashSpeed = 16;
      dashBuff.cancelable = false;
      this.owner.addBuff(dashBuff);

      this.threshObj!.toRemove = true; // ends the shackle and any pending tug
      this.threshObj = null;
      this.phase = 'Q1';
      this.image = Thresh_Q.PHASES.Q1.image;
    }

    onUpdate() {
      if (!this.threshObj) return;

      // the wind-up root ends the moment the chain connects (or misses)
      if (this.threshObj.phase === Thresh_Q_Object.PHASES.SHACKLE || this.threshObj.toRemove) {
        this.ownerRootBuff?.deactivateBuff();
      }

      if (this.threshObj.toRemove) {
        this.threshObj = null;

        // the shackle ran out without a leap — back to a fresh Q1
        if (this.phase === 'Q2') {
          this.phase = 'Q1';
          this.image = Thresh_Q.PHASES.Q1.image;
          this.currentCooldown = this.reducedCooldown(this.coolDown);
        }
      }
    }

    drawPreview() {
      super.drawPreview(this.range);
    }
  }
  return Thresh_Q;
}
const __cacheThresh_Q = new WeakMap<ContentApi, ReturnType<typeof __buildThresh_Q>>();
export default function makeThresh_Q(api: ContentApi) {
  const cached = __cacheThresh_Q.get(api);
  if (cached) return cached;
  const built = __buildThresh_Q(api);
  __cacheThresh_Q.set(api, built);
  return built;
}


function __buildThresh_Q_Object(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const VectorUtils = api.utils.VectorUtils;
  const MissileSpellObject = api.MissileSpellObject;
  const Dash = api.buffs.Dash;
  const Stun = api.buffs.Stun;
  const Thresh_Q_Impact = makeThresh_Q_Impact(api);
  class Thresh_Q_Object extends MissileSpellObject {
    range = 550;
    speed = 12;
    size = 26;
    damage = 25;

    /** Stun + shackle window. */
    shackleDuration = 1500;
    /** Tug timings measured from the hit: 0.1s, then 0.6s after that. */
    tugDelays = [100, 700];
    /** How far a single tug hauls the victim — a jerk, not a full drag. */
    tugDistance = 100;
    tugSpeed = 13;

    // the scythe latches onto one victim instead of dying on impact
    maxHitCount = 1;
    removeOnMaxHit = false;

    champHooked: any = null;
    stunBuff: Stun | null = null;
    tugBuff: Dash | null = null;
    onHookLanded: (() => void) | null = null;

    _timeSinceHit = 0;
    _tugsDone = 0;

    /** Cosmetic only: counts down after a tug so the chain can flash as it yanks. */
    _tugFlash = 0;
    /** Cosmetic only: how far the links have slid along the chain, for the pull. */
    _linkScroll = 0;

    static PHASES = {
      FORWARD: 'forward',
      SHACKLE: 'shackle',
    } as const;
    phase: (typeof Thresh_Q_Object.PHASES)[keyof typeof Thresh_Q_Object.PHASES] =
      Thresh_Q_Object.PHASES.FORWARD;

    onHit(enemy: any) {
      this.phase = Thresh_Q_Object.PHASES.SHACKLE;
      this.champHooked = enemy;
      this.isMissile = false; // stop colliding; the chain is spent
      // the chain hangs off Thresh: killing him drops it instead of leaving a
      // corpse hauling the victim in with the remaining tugs
      this.attachTo(this.owner);

      enemy.takeDamage(this.damage, this.owner);

      this.stunBuff = new Stun(this.shackleDuration, this.owner, enemy);
      enemy.addBuff(this.stunBuff);

      this.onHookLanded?.();

      // the bite: a green flash where the scythe caught
      const impact = new Thresh_Q_Impact(this.owner);
      impact.position = enemy.position.copy();
      impact.angle = VectorUtils.getAngle(this.owner.position, enemy.position);
      this.game.objectManager.addObject(impact);
    }

    update() {
      // links slide toward Thresh, faster while the chain is hauling someone in
      this._linkScroll +=
        (deltaTime / 1000) *
        (this.phase === Thresh_Q_Object.PHASES.SHACKLE ? (this._tugFlash > 0 ? 190 : 55) : -160);
      if (this._tugFlash > 0) this._tugFlash -= deltaTime;

      if (this.phase === Thresh_Q_Object.PHASES.FORWARD) {
        super.update();
        return;
      }

      if (this.dropIfAttachmentLost()) return;

      // the scythe rides on the victim for as long as the shackle holds
      this.position.set(this.champHooked.position.x, this.champHooked.position.y);

      this._timeSinceHit += deltaTime;

      if (
        this._tugsDone < this.tugDelays.length &&
        this._timeSinceHit >= this.tugDelays[this._tugsDone]
      ) {
        this._tugsDone++;
        this._tug();
      }

      if (this.champHooked.isDead || this._timeSinceHit >= this.shackleDuration) {
        this.toRemove = true;
      }
    }

    /** One short haul towards Thresh — a snapshot destination, never a live ref. */
    _tug() {
      const { to } = VectorUtils.getVectorWithMaxRange(
        this.champHooked.position,
        this.owner.position,
        this.tugDistance
      );

      this.tugBuff?.deactivateBuff?.();

      const tug = new Dash(500, this.owner, this.champHooked);
      tug.image = api.asset('spell_thresh_q');
      tug.dashDestination = to;
      tug.dashSpeed = this.tugSpeed;
      tug.showTrail = false;
      tug.cancelable = false; // the stun we applied must not cancel our own tug
      this.champHooked.addBuff(tug);
      this.tugBuff = tug;
      this._tugFlash = 260; // cosmetic: lets draw() show the yank
    }

    onRemoved() {
      this.tugBuff?.deactivateBuff?.();
    }

    draw() {
      const ownerPos = this.owner.position;
      const shackled = this.phase === Thresh_Q_Object.PHASES.SHACKLE;
      const tugging = this._tugFlash > 0;
      const [cr, cg, cb] = CHAIN_COLOR;
      const [dr, dg, db] = CHAIN_DARK;

      // a slack chain is dim; a chain with someone on the end is lit up, and a
      // chain mid-yank is white-hot — the state of the spell, read off the rope
      const alpha = shackled
        ? tugging
          ? 255
          : 225
        : constrain(map(this.position.dist(ownerPos), 0, this.range, 220, 90), 90, 220);

      const dist = this.position.dist(ownerPos);
      const dirX = dist > 0.001 ? (this.position.x - ownerPos.x) / dist : 1;
      const dirY = dist > 0.001 ? (this.position.y - ownerPos.y) / dist : 0;
      const normX = -dirY;
      const normY = dirX;

      push();

      // the rope the links hang on
      stroke(dr, dg, db, alpha);
      strokeWeight(shackled ? 7 : 5);
      line(ownerPos.x, ownerPos.y, this.position.x, this.position.y);
      stroke(cr, cg, cb, alpha * (tugging ? 1 : 0.55));
      strokeWeight(shackled ? 3 : 2);
      line(ownerPos.x, ownerPos.y, this.position.x, this.position.y);

      // interlocking links, sliding along the rope: out while it flies, back
      // towards Thresh while it hauls, and racing during a tug
      const spacing = 22;
      const linkCount = Math.min(40, Math.max(1, Math.floor(dist / spacing)));
      const offset = ((this._linkScroll % spacing) + spacing) % spacing;
      const chainAngle = Math.atan2(dirY, dirX);

      for (let i = 0; i < linkCount; i++) {
        const along = offset + i * spacing;
        if (along > dist - 6) continue;
        const x = ownerPos.x + dirX * along;
        const y = ownerPos.y + dirY * along;

        push();
        translate(x, y);
        rotate(chainAngle);
        noFill();
        // every other link turned edge-on, which is what makes it read as a chain
        const w = i % 2 === 0 ? 17 : 7;
        stroke(dr, dg, db, alpha);
        strokeWeight(5);
        ellipse(0, 0, w, 12);
        stroke(cr, cg, cb, alpha);
        strokeWeight(2);
        ellipse(0, 0, w, 12);
        pop();
      }

      // during a yank, bright chevrons race down the chain towards Thresh
      if (tugging) {
        const yank = this._tugFlash / 260;
        stroke(240, 255, 245, 230 * yank);
        strokeWeight(3);
        noFill();
        for (let i = 0; i < 4; i++) {
          const along = (((1 - yank) * 1.1 + i * 0.25) % 1) * dist;
          const bx = ownerPos.x + dirX * along;
          const by = ownerPos.y + dirY * along;
          line(bx + normX * 9 + dirX * 11, by + normY * 9 + dirY * 11, bx, by);
          line(bx - normX * 9 + dirX * 11, by - normY * 9 + dirY * 11, bx, by);
        }
      }

      pop();

      // while someone is on the chain, ring them so the recast target is obvious
      if (shackled && this.champHooked && !this.champHooked.isDead) {
        const victimSize = this.champHooked.animatedValues.displaySize;
        const left = constrain(1 - this._timeSinceHit / this.shackleDuration, 0, 1);

        push();
        translate(this.champHooked.position.x, this.champHooked.position.y);
        noFill();
        stroke(dr, dg, db, 220);
        strokeWeight(7);
        circle(0, 0, victimSize + 26);
        // the arc drains away with the shackle: that is the recast window
        stroke(cr, cg, cb, 245);
        strokeWeight(4);
        arc(0, 0, victimSize + 26, victimSize + 26, -HALF_PI, -HALF_PI + TWO_PI * left);

        // shackle teeth pointing inwards
        stroke(cr, cg, cb, 190);
        strokeWeight(3);
        for (let i = 0; i < 6; i++) {
          const a = (i * TWO_PI) / 6 - this._linkScroll / 40;
          const r1 = victimSize / 2 + 15;
          const r2 = victimSize / 2 + 26;
          line(cos(a) * r1, sin(a) * r1, cos(a) * r2, sin(a) * r2);
        }
        pop();
      }

      // the scythe head — flies point-first, then bites back towards Thresh.
      // Drawn last so the blade stays legible over the victim's own effects.
      const angle = shackled
        ? VectorUtils.getAngle(this.position, ownerPos)
        : VectorUtils.getAngle(this.position, this.destination);

      // while shackled the scythe rides on the victim's centre, where their own
      // crowd-control effect swallows it — bite into the near edge instead
      const bite = shackled && this.champHooked ? this.champHooked.animatedValues.displaySize / 2 : 0;

      push();
      translate(this.position.x + dirX * -bite, this.position.y + dirY * -bite);
      rotate(angle);

      // the blade is drawn well past the collision circle so it stays a silhouette
      const s = this.size * 1.35;

      // curved blade: a hook, unmistakably not a ball
      stroke(dr, dg, db, 255);
      strokeWeight(5);
      fill(cr, cg, cb, 240);
      beginShape();
      vertex(s * 1.05, 0);
      bezierVertex(s * 0.55, -s * 0.95, -s * 0.3, -s * 1.0, -s * 0.75, -s * 0.42);
      vertex(-s * 0.35, -s * 0.18);
      bezierVertex(-s * 0.1, -s * 0.5, s * 0.35, -s * 0.45, s * 0.62, 0);
      endShape(CLOSE);

      // the haft and its counterweight
      stroke(dr, dg, db, 255);
      strokeWeight(6);
      line(-s * 0.75, -s * 0.42, -s * 0.5, s * 0.5);
      stroke(cr, cg, cb, 255);
      strokeWeight(2.5);
      line(-s * 0.75, -s * 0.42, -s * 0.5, s * 0.5);

      noStroke();
      fill(235, 255, 245, 230);
      circle(-s * 0.5, s * 0.5, s * 0.35);
      // glint on the cutting edge
      fill(255, 255, 255, 200);
      circle(s * 0.85, -s * 0.1, s * 0.22);

      pop();
    }

    // the chain spans from the caster to the scythe, so the box must cover both
    // (padded by the blade and the shackle ring, which reach past `position`)
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
  return Thresh_Q_Object;
}
const __cacheThresh_Q_Object = new WeakMap<ContentApi, ReturnType<typeof __buildThresh_Q_Object>>();
export function makeThresh_Q_Object(api: ContentApi) {
  const cached = __cacheThresh_Q_Object.get(api);
  if (cached) return cached;
  const built = __buildThresh_Q_Object(api);
  __cacheThresh_Q_Object.set(api, built);
  return built;
}


/** The hook connecting: a burst of lantern light where the blade bit in. */
function __buildThresh_Q_Impact(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class Thresh_Q_Impact extends SpellObject {
    position = this.owner.position.copy();
    angle = 0;
    age = 0;
    lifeTime = 420;
    maxRadius = 85;

    update() {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const fade = 1 - t;
      const [cr, cg, cb] = CHAIN_COLOR;

      push();
      translate(this.position.x, this.position.y);

      // ring blowing outwards from the point of contact
      noFill();
      stroke(cr, cg, cb, 230 * fade);
      strokeWeight(8 * fade + 1);
      circle(0, 0, this.maxRadius * 2 * (0.2 + t * 0.8));

      stroke(CHAIN_DARK[0], CHAIN_DARK[1], CHAIN_DARK[2], 180 * fade);
      strokeWeight(4 * fade + 1);
      circle(0, 0, this.maxRadius * 2 * (0.2 + t * 0.8) * 0.75);

      // broken links spat out along the line of the chain
      rotate(this.angle);
      stroke(cr, cg, cb, 240 * fade);
      strokeWeight(3);
      for (let i = 0; i < 7; i++) {
        const a = -1.2 + (i / 6) * 2.4;
        const d = 14 + t * 78;
        const x = cos(a) * d;
        const y = sin(a) * d;
        line(x, y, x + cos(a) * 12, y + sin(a) * 12);
      }

      // the flash of the bite itself
      const flash = 1 - constrain(t / 0.25, 0, 1);
      if (flash > 0) {
        noStroke();
        fill(230, 255, 240, 220 * flash);
        circle(0, 0, 46 * flash + 8);
      }

      pop();
    }

    getDisplayBoundingBox() {
      const r = this.maxRadius + 20;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Thresh_Q_Impact;
}
const __cacheThresh_Q_Impact = new WeakMap<ContentApi, ReturnType<typeof __buildThresh_Q_Impact>>();
export function makeThresh_Q_Impact(api: ContentApi) {
  const cached = __cacheThresh_Q_Impact.get(api);
  if (cached) return cached;
  const built = __buildThresh_Q_Impact(api);
  __cacheThresh_Q_Impact.set(api, built);
  return built;
}