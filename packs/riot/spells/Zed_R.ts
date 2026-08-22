import type { ContentApi } from '@moba2d/core/content/ContentApi';
import { makeZed_W_Clone } from './Zed_W';

type Buff = InstanceType<ContentApi['buffs']['Buff']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Dash = InstanceType<ContentApi['buffs']['Dash']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Untargetable = InstanceType<ContentApi['buffs']['Untargetable']>;
type Zed_R = InstanceType<ReturnType<typeof makeZed_R>>;
type Zed_R_Detonation = InstanceType<ReturnType<typeof makeZed_R_Detonation>>;
type Zed_R_Mark = InstanceType<ReturnType<typeof makeZed_R_Mark>>;
type Zed_R_Object = InstanceType<ReturnType<typeof makeZed_R_Object>>;
type Zed_W_Clone = InstanceType<ReturnType<typeof makeZed_W_Clone>>;



/** Bruised purple, so the mark does not read as a normal burn. */
const SHADOW_COLOR: [number, number, number] = [215, 120, 255];


/**
 * Death Mark.
 *
 * Zed goes untargetable, dashes behind the target, leaves a Shadow at the
 * casting position and marks the victim. The mark stores a share of every point
 * of damage Zed and his shadows land on that victim, then detonates it as bonus
 * damage when it expires. Recast swaps Zed with the Shadow.
 */
function __buildZed_R(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const VectorUtils = api.utils.VectorUtils;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Spell = api.Spell;
  const Dash = api.buffs.Dash;
  const Untargetable = api.buffs.Untargetable;
  const Zed_W_Clone = makeZed_W_Clone(api);
  const Zed_R_Mark = makeZed_R_Mark(api);
  const Zed_R_Object = makeZed_R_Object(api);
  class Zed_R extends Spell {
    // Auto-locks its own target; see "auto-locking spells" in docs/ADDING_SPELLS.md.
    targetingMode = 'SELF' as const;
    static PHASES = {
      R1: {
        image: api.asset('spell_zed_r1'),
      },
      R2: {
        image: api.asset('spell_zed_r2'),
      },
    };
    phase: 'R1' | 'R2' = 'R1';

    image = Zed_R.PHASES[this.phase].image;
    name = 'Dấu Ấn Tử Thần (Zed_R)';
    description =
      '<span class="buff">Lướt</span> ra sau kẻ địch gần nhất trong tầm 500px, <span class="buff">Không thể bị chọn</span> trong lúc lướt và để lại 1 <span>phân thân</span> tại chỗ cũ. Mục tiêu bị đánh dấu trong <span class="time">3 giây</span>: <b>35%</b> toàn bộ sát thương Zed và phân thân gây lên nó được tích lại và <span class="damage">kích nổ</span> khi dấu ấn kết thúc. Có thể tái kích hoạt để <span class="buff">Đổi chỗ</span> với phân thân';
    coolDown = 10000;
    manaCost = 50;

    range = 500;
    damage = 20;
    markDuration = 3000;
    /** Share of Zed's damage on the victim that the mark banks up. */
    markStorePercent = 0.35;
    /** The Shadow outlives the mark so the swap stays available to the end. */
    shadowDuration = 4000;
    /** The swap unlocks 0.5s after Zed reappears. */
    coolDownBeforeSwap = 500;

    shadow: Zed_W_Clone | null = null;

    checkCastCondition() {
      // recast is a blink, not a dash — it only needs a shadow still standing
      if (this.phase === 'R2') {
        return !!this.shadow && !this.shadow.toRemove;
      }
      return Dash.CanDash(this.owner) && this._findTarget() !== null;
    }

    onSpellCast() {
      if (this.phase === 'R2') {
        this._swapWithShadow();
        return;
      }

      const target = this._findTarget();
      if (!target) return;

      const castPosition = this.owner.position.copy();

      // untargetable for the whole leap, dropped the instant he reappears
      const untargetableBuff = new Untargetable(2000, this.owner, this.owner);
      untargetableBuff.image = Zed_R.PHASES.R1.image;
      this.owner.addBuff(untargetableBuff);

      // land just past the target, so Zed ends up behind them
      const behindDistance =
        this.owner.position.dist(target.position) +
        target.stats.size.value / 2 +
        this.owner.stats.size.value / 2;
      const { to: destination } = VectorUtils.getVectorWithRange(
        this.owner.position,
        target.position,
        behindDistance
      );

      const dashBuff = new Dash(2000, this.owner, this.owner);
      dashBuff.image = Zed_R.PHASES.R1.image;
      dashBuff.dashDestination = destination;
      dashBuff.dashSpeed = 16;
      dashBuff.cancelable = false;
      dashBuff.onReachedDestination = () => untargetableBuff.deactivateBuff();
      dashBuff.onDeactivate = () => untargetableBuff.deactivateBuff();
      this.owner.addBuff(dashBuff);

      // the shadow stays behind at the casting position and mimics Q / E
      this._spawnShadow(castPosition);

      // mark first, so R's own hit is already banked by it
      const mark = new Zed_R_Mark(this.markDuration, this.owner, target);
      mark.storePercent = this.markStorePercent;
      mark.image = Zed_R.PHASES.R1.image;
      target.addBuff(mark);

      target.takeDamage(this.damage, this.owner);

      const obj = new Zed_R_Object(this.owner);
      obj.target = target;
      obj.lifeTime = this.markDuration;
      obj.mark = mark;
      this.game.objectManager.addObject(obj);

      this.phase = 'R2';
      this.image = Zed_R.PHASES.R2.image;
      // recast window, not a cooldown — deliberately not reduced
      this.currentCooldown = this.coolDownBeforeSwap;
    }

    _spawnShadow(position: p5.Vector) {
      const shadow = new Zed_W_Clone({
        game: this.game,
        position,
        teamId: this.owner.teamId,
        avatar: this.owner.avatar,
      } as any);
      shadow.owner = this.owner;
      // marks this spell as the source, so the shadow never mimics R back at us
      shadow.spellSource = this as any;
      shadow.destination = position.copy(); // spawns in place instead of dashing out
      shadow.lifeTime = this.shadowDuration;
      this.game.objectManager.addObject(shadow);
      this.shadow = shadow;
    }

    _swapWithShadow() {
      const shadow = this.shadow!;
      const curPos = this.owner.position.copy();

      // Grounded refuses the swap; the shadow keeps standing and stays swappable.
      if (!this.blinkOwnerTo(shadow.position.x, shadow.position.y)) return;
      shadow.teleportTo(curPos.x, curPos.y);
      shadow.swapable = false;

      this.shadow = null;
      this.phase = 'R1';
      this.image = Zed_R.PHASES.R1.image;
      this.currentCooldown = this.reducedCooldown(this.coolDown);
    }

    onUpdate() {
      // shadow expired before the swap was used
      if (this.phase === 'R2' && (!this.shadow || this.shadow.toRemove)) {
        this.shadow = null;
        this.phase = 'R1';
        this.image = Zed_R.PHASES.R1.image;
        this.currentCooldown = this.reducedCooldown(this.coolDown);
      }
    }

    /** Nearest damageable enemy within `range`, or null. */
    _findTarget(): any {
      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.owner.position.x,
          y: this.owner.position.y,
          r: effectiveRange(this.range, this.owner),
        }),
        filters: [
          PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
          PredefinedFilters.visibleTo(this.owner),
        ],
      });

      let nearest: any = null;
      let nearestDistance = Infinity;
      for (const enemy of enemies) {
        const d = this.owner.position.dist(enemy.position);
        if (d < nearestDistance) {
          nearest = enemy;
          nearestDistance = d;
        }
      }

      return nearest;
    }

    drawPreview() {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }
  }
  return Zed_R;
}
const __cacheZed_R = new WeakMap<ContentApi, ReturnType<typeof __buildZed_R>>();
export default function makeZed_R(api: ContentApi) {
  const cached = __cacheZed_R.get(api);
  if (cached) return cached;
  const built = __buildZed_R(api);
  __cacheZed_R.set(api, built);
  return built;
}


/**
 * Marked for Death: a pure observer on the victim's damage pipeline. It never
 * changes what gets through — it only banks a share of whatever Zed (or one of
 * his shadows) lands, and pays it all back at once when the mark expires.
 */
function __buildZed_R_Mark(api: ContentApi) {
  const Buff = api.buffs.Buff;
  const BuffAddType = api.enums.BuffAddType;
  const Zed_R_Detonation = makeZed_R_Detonation(api);
  class Zed_R_Mark extends Buff {
    name = 'Dấu Ấn Tử Thần';
    buffAddType = BuffAddType.REPLACE_EXISTING;

    storePercent = 0.35;
    storedDamage = 0;

    _detonated = false;

    /** True for Zed himself and for anything he owns (his shadows). */
    _isFromZed(attacker: any): boolean {
      if (!attacker || !this.sourceUnit) return false;
      return attacker === this.sourceUnit || attacker.owner === this.sourceUnit;
    }

    modifyIncomingDamage(damage: number, attacker: any): number {
      if (!this._detonated && damage > 0 && this._isFromZed(attacker)) {
        this.storedDamage += damage * this.storePercent;
      }
      return damage;
    }

    onDeactivate(): void {
      if (this._detonated) return;
      this._detonated = true; // guard: the detonation itself re-enters takeDamage

      const payload = Math.round(this.storedDamage);
      if (payload > 0 && this.targetUnit && !this.targetUnit.isDead) {
        this.targetUnit.takeDamage(payload, this.sourceUnit);

        // the payload landing: without this the mark deals its damage in silence
        const burst = new Zed_R_Detonation(this.sourceUnit);
        burst.position = this.targetUnit.position.copy();
        burst.payload = payload;
        this.game?.objectManager?.addObject(burst);
      }
    }
  }
  return Zed_R_Mark;
}
const __cacheZed_R_Mark = new WeakMap<ContentApi, ReturnType<typeof __buildZed_R_Mark>>();
export function makeZed_R_Mark(api: ContentApi) {
  const cached = __cacheZed_R_Mark.get(api);
  if (cached) return cached;
  const built = __buildZed_R_Mark(api);
  __cacheZed_R_Mark.set(api, built);
  return built;
}


/** The banked damage going off all at once. Scaled by how much was stored. */
function __buildZed_R_Detonation(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class Zed_R_Detonation extends SpellObject {
    position = this.owner.position.copy();
    payload = 0;
    age = 0;
    lifeTime = 600;

    get maxRadius(): number {
      return constrain(70 + this.payload * 1.6, 70, 190);
    }

    update() {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const fade = 1 - t;
      const r = this.maxRadius;
      const [cr, cg, cb] = SHADOW_COLOR;

      push();
      translate(this.position.x, this.position.y);

      // shadow imploding, then blowing out
      const implode = constrain(t / 0.18, 0, 1);
      noFill();
      stroke(cr, cg, cb, 230 * (1 - implode));
      strokeWeight(5);
      circle(0, 0, r * 2 * (1 - implode * 0.85));

      if (t > 0.14) {
        const k = constrain((t - 0.14) / 0.86, 0, 1);
        stroke(25, 5, 40, 220 * fade);
        strokeWeight(20 * fade + 3);
        circle(0, 0, r * 2 * k);
        stroke(cr, cg, cb, 250 * fade);
        strokeWeight(6 * fade + 1.5);
        circle(0, 0, r * 2 * k);

        // blades of shadow thrown out — Zed's shuriken shape, exploded
        stroke(240, 210, 255, 240 * fade);
        strokeWeight(4 * fade + 1);
        for (let i = 0; i < 8; i++) {
          const a = (TWO_PI * i) / 8 + t * 1.4;
          const inner = r * k * 0.55;
          const outer = r * k;
          line(cos(a) * inner, sin(a) * inner, cos(a) * outer, sin(a) * outer);
        }
      }

      // the flash at the moment it goes off
      const flash = 1 - constrain(Math.abs(t - 0.16) / 0.16, 0, 1);
      if (flash > 0) {
        noStroke();
        fill(255, 235, 255, 235 * flash);
        circle(0, 0, r * 0.85 * flash + 16);
      }

      pop();
    }

    getDisplayBoundingBox() {
      const r = this.maxRadius + 30;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Zed_R_Detonation;
}
const __cacheZed_R_Detonation = new WeakMap<ContentApi, ReturnType<typeof __buildZed_R_Detonation>>();
export function makeZed_R_Detonation(api: ContentApi) {
  const cached = __cacheZed_R_Detonation.get(api);
  if (cached) return cached;
  const built = __buildZed_R_Detonation(api);
  __cacheZed_R_Detonation.set(api, built);
  return built;
}


/** The death-mark rune spinning over the victim while the mark lasts. */
function __buildZed_R_Object(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const SpellObject = api.SpellObject;
  class Zed_R_Object extends SpellObject {
    position = this.owner.position.copy();
    target: any = null;
    mark: Zed_R_Mark | null = null;
    lifeTime = 3000;
    age = 0;
    size = 60;

    update() {
      this.age += deltaTime;

      if (!this.target || this.target.isDead || this.age >= this.lifeTime) {
        this.toRemove = true;
        return;
      }

      this.position.set(this.target.position.x, this.target.position.y);
    }

    draw() {
      const alpha =
        this.age > this.lifeTime - 400
          ? map(this.age, this.lifeTime - 400, this.lifeTime, 220, 0)
          : 220;
      const size = this.target
        ? Math.max(this.size, this.target.animatedValues.displaySize + 20)
        : this.size;
      const [cr, cg, cb] = SHADOW_COLOR;
      const left = constrain(1 - this.age / this.lifeTime, 0, 1);
      const stored = this.mark?.storedDamage ?? 0;
      // the closer the mark is to going off, the harder the rune throbs
      const urgency = 0.5 + 0.5 * sin(frameCount / (3 + left * 8));

      push();
      translate(this.position.x, this.position.y);

      // dark disc under the rune so it never washes out against the victim
      noStroke();
      fill(20, 4, 34, alpha * 0.45);
      circle(0, 0, size * 1.05);

      // the fuse: how long until the banked damage lands
      noFill();
      stroke(20, 4, 34, alpha);
      strokeWeight(7);
      circle(0, 0, size + 14);
      stroke(cr, cg, cb, alpha);
      strokeWeight(4);
      arc(0, 0, size + 14, size + 14, -HALF_PI, -HALF_PI + TWO_PI * left);

      push();
      rotate(frameCount / 30);

      // two counter-set arcs plus a triangle: a simple, readable death rune
      noFill();
      stroke(20, 4, 34, alpha);
      strokeWeight(7);
      arc(0, 0, size, size, 0, PI * 0.6);
      arc(0, 0, size, size, PI, PI * 1.6);
      stroke(cr, cg, cb, alpha);
      strokeWeight(3.5);
      arc(0, 0, size, size, 0, PI * 0.6);
      arc(0, 0, size, size, PI, PI * 1.6);

      strokeWeight(2.5);
      stroke(255, alpha * 0.85);
      const r = size / 3;
      triangle(0, -r, cos(PI / 6) * r, sin(PI / 6) * r, -cos(PI / 6) * r, sin(PI / 6) * r);
      pop();

      // banked damage swells the rune, so the payload is readable before it lands
      if (stored > 0) {
        noStroke();
        fill(cr, cg, cb, alpha * (0.35 + 0.3 * urgency));
        circle(0, 0, constrain(stored * 1.6, 6, size * 0.9));
        fill(255, 235, 255, alpha * 0.5 * urgency);
        circle(0, 0, constrain(stored * 0.7, 3, size * 0.4));
      }

      pop();

      // a thread of shadow back to Zed: whose mark this is, at a glance
      if (this.owner && !this.owner.isDead) {
        push();
        const ox = this.owner.position.x;
        const oy = this.owner.position.y;
        const dashes = 9;
        stroke(cr, cg, cb, alpha * 0.5);
        strokeWeight(2.5);
        for (let i = 0; i < dashes; i++) {
          const t1 = (i + ((frameCount / 60) % 1) * 0.5) / dashes;
          const t2 = t1 + 0.4 / dashes;
          if (t2 > 1) continue;
          line(
            lerp(ox, this.position.x, t1),
            lerp(oy, this.position.y, t1),
            lerp(ox, this.position.x, t2),
            lerp(oy, this.position.y, t2)
          );
        }
        pop();
      }
    }

    // the tether spans from Zed to the victim, so the box must cover both
    getDisplayBoundingBox() {
      const pad = this.size;
      const ox = this.owner?.position?.x ?? this.position.x;
      const oy = this.owner?.position?.y ?? this.position.y;
      return new Rectangle({
        x: Math.min(this.position.x, ox) - pad,
        y: Math.min(this.position.y, oy) - pad,
        w: Math.abs(this.position.x - ox) + pad * 2,
        h: Math.abs(this.position.y - oy) + pad * 2,
        data: this,
      });
    }
  }
  return Zed_R_Object;
}
const __cacheZed_R_Object = new WeakMap<ContentApi, ReturnType<typeof __buildZed_R_Object>>();
export function makeZed_R_Object(api: ContentApi) {
  const cached = __cacheZed_R_Object.get(api);
  if (cached) return cached;
  const built = __buildZed_R_Object(api);
  __cacheZed_R_Object.set(api, built);
  return built;
}