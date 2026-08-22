import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { BasicAttackHit } from '@moba2d/core/content/types';

type Airborne = InstanceType<ContentApi['buffs']['Airborne']>;
type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Buff = InstanceType<ContentApi['buffs']['Buff']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Stun = InstanceType<ContentApi['buffs']['Stun']>;
type XinZhao_Q = InstanceType<ReturnType<typeof makeXinZhao_Q>>;
type XinZhao_Q_Buff = InstanceType<ReturnType<typeof makeXinZhao_Q_Buff>>;
type XinZhao_Q_Object = InstanceType<ReturnType<typeof makeXinZhao_Q_Object>>;



/** How long the three strikes stay armed with no attack landing. */
export const XINZHAO_Q_DURATION_MS = 5_000;

/** Bonus damage carried by each empowered swing. Three of them is the payload. */
export const XINZHAO_Q_BONUS_DAMAGE = 12;

export const XINZHAO_Q_ATTACKS = 3;

/** The third strike lifts the target — long enough to read, short enough to walk out of. */
export const XINZHAO_Q_KNOCKUP_MS = 700;

/** Every landed strike shaves this much off Xin Zhao's other cooldowns. */
export const XINZHAO_Q_COOLDOWN_REFUND_MS = 800;


function __buildXinZhao_Q(api: ContentApi) {
  const Spell = api.Spell;
  const XinZhao_Q_Buff = makeXinZhao_Q_Buff(api);
  class XinZhao_Q extends Spell {
    targetingMode = 'SELF' as const;
    image = api.asset('spell_xinzhao_q');
    name = 'Liên Hoàn Tam Kích (XinZhao_Q)';
    description =
      'Cường hóa <span class="buff">3 đòn đánh kế tiếp</span> trong <span class="time">5 giây</span>, mỗi đòn gây thêm ' +
      '<span class="damage">12 sát thương</span> và giảm <span class="time">0.8 giây</span> hồi chiêu các kỹ năng khác. ' +
      'Đòn thứ ba <span class="buff">hất tung</span> mục tiêu.';
    coolDown = 7_000;
    manaCost = 30;

    private empowered: XinZhao_Q_Buff | null = null;

    /** The HUD badges the icon with the strikes still owed. */
    get stackCount(): number | undefined {
      const buff = this.empowered;
      if (!buff || buff.toRemove) return undefined;
      return buff.strikesLeft;
    }

    onSpellCast(): void {
      const buff = new XinZhao_Q_Buff(XINZHAO_Q_DURATION_MS, this.owner, this.owner);
      buff.spellRef = this;
      this.empowered = buff;
      buff.addDeactivateListener(() => {
        if (this.empowered === buff) this.empowered = null;
      });
      this.owner.addBuff(buff);
    }
  }
  return XinZhao_Q;
}
const __cacheXinZhao_Q = new WeakMap<ContentApi, ReturnType<typeof __buildXinZhao_Q>>();
export default function makeXinZhao_Q(api: ContentApi) {
  const cached = __cacheXinZhao_Q.get(api);
  if (cached) return cached;
  const built = __buildXinZhao_Q(api);
  __cacheXinZhao_Q.set(api, built);
  return built;
}


/**
 * The armed state itself.
 *
 * It lives on the champion rather than in the spell because it has to survive
 * the spell going on cooldown and has to end the moment he dies — and because
 * the buff bar is where the player looks to find out whether the strikes are
 * still up.
 */
function __buildXinZhao_Q_Buff(api: ContentApi) {
  const EventType = api.enums.EventType;
  const Buff = api.buffs.Buff;
  const Spell = api.Spell;
  const Airborne = api.buffs.Airborne;
  const Stun = api.buffs.Stun;
  const AttackableUnit = api.units.AttackableUnit;
  const XinZhao_Q_Object = makeXinZhao_Q_Object(api);
  class XinZhao_Q_Buff extends Buff {
    image: Buff['image'] = api.asset('spell_xinzhao_q');
    name = 'Liên Hoàn Tam Kích';
    strikesLeft = XINZHAO_Q_ATTACKS;
    spellRef: Spell | null = null;

    private stopListening?: () => void;
    private auraObj: XinZhao_Q_Object | null = null;

    onActivate(): void {
      this.auraObj = new XinZhao_Q_Object(this.targetUnit, this);
      // Attached to the body but deliberately *not* to this buff: the third strike
      // ends the buff on the same frame it lands, and watching the buff would take
      // the knock-up's own flare off the screen before a single frame drew it.
      this.auraObj.attachTo(this.targetUnit);
      this.game.objectManager.addObject(this.auraObj);

      this.stopListening = this.game.eventManager.on(
        EventType.ON_ATTACK_HIT,
        ({ attacker, victim }: BasicAttackHit) => {
          if (attacker !== this.targetUnit || !victim || this.toRemove) return;
          this.strike(victim);
        }
      );
    }

    private strike(victim: AttackableUnit): void {
      this.strikesLeft = Math.max(0, this.strikesLeft - 1);
      // Each landed strike refreshes the window: the combo is a rhythm, not a race.
      this.timeElapsed = 0;
      victim.takeDamage(XINZHAO_Q_BONUS_DAMAGE, this.targetUnit);
      this.refundOtherCooldowns();

      const finisher = this.strikesLeft === 0;
      if (finisher) {
        victim.addBuff(new Airborne(XINZHAO_Q_KNOCKUP_MS, this.targetUnit, victim));
        victim.addBuff(new Stun(XINZHAO_Q_KNOCKUP_MS, this.targetUnit, victim));
      }

      this.auraObj?.strikeAt(victim.position.x, victim.position.y, finisher);
      if (finisher) this.deactivateBuff();
    }

    /** The combo's whole reason to hold an attack order: it pays for the next ability. */
    private refundOtherCooldowns(): void {
      const spells = (this.targetUnit as unknown as { spells?: Spell[] }).spells ?? [];
      for (const spell of spells) {
        if (spell === this.spellRef) continue;
        if (spell.currentCooldown > 0) {
          spell.currentCooldown = Math.max(0, spell.currentCooldown - XINZHAO_Q_COOLDOWN_REFUND_MS);
        }
      }
    }

    onDeactivate(): void {
      if (this.auraObj) {
        this.auraObj.endAndFade();
        this.auraObj = null;
      }
      this.stopListening?.();
      this.stopListening = undefined;
    }
  }
  return XinZhao_Q_Buff;
}
const __cacheXinZhao_Q_Buff = new WeakMap<ContentApi, ReturnType<typeof __buildXinZhao_Q_Buff>>();
export function makeXinZhao_Q_Buff(api: ContentApi) {
  const cached = __cacheXinZhao_Q_Buff.get(api);
  if (cached) return cached;
  const built = __buildXinZhao_Q_Buff(api);
  __cacheXinZhao_Q_Buff.set(api, built);
  return built;
}


/** How far off his body the talons orbit. */
const TALON_ORBIT = 40;


/**
 * Three spear talons circling Xin Zhao, one going dark per strike spent.
 *
 * The count is the whole spell, so it has to be readable off his body without
 * looking at the HUD — and the finisher needs its own tell, because a knock-up
 * the player did not see coming is a knock-up he could not have set up.
 */
function __buildXinZhao_Q_Object(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const SpellObject = api.SpellObject;
  const AttackableUnit = api.units.AttackableUnit;
  class XinZhao_Q_Object extends SpellObject {
    buffRef: XinZhao_Q_Buff;
    age = 0;
    /** Blades fold out over this long, so the buff never pops in at full size. */
    unfoldMs = 200;
    /** Counts down from 1 on each swing that spends a talon. */
    strikeFlare = 0;
    private strikePoint: { x: number; y: number } | null = null;
    private strikeWasFinisher = false;

    constructor(owner: AttackableUnit, buffRef: XinZhao_Q_Buff) {
      super(owner);
      this.buffRef = buffRef;
    }

    /** Set once the buff is over: the talons stop, the last flare plays out. */
    ending = false;

    strikeAt(x: number, y: number, finisher: boolean): void {
      this.strikePoint = { x, y };
      this.strikeWasFinisher = finisher;
      this.strikeFlare = 1;
    }

    endAndFade(): void {
      this.ending = true;
    }

    update(): void {
      if (this.dropIfAttachmentLost()) return;
      this.position.set(this.owner.position.x, this.owner.position.y);
      this.age += deltaTime;
      if (this.strikeFlare > 0) this.strikeFlare = Math.max(0, this.strikeFlare - deltaTime / 320);
      if (this.ending && this.strikeFlare <= 0) this.toRemove = true;
    }

    draw(): void {
      const unfold = Math.min(1, this.age / this.unfoldMs);
      // ease-out: the talons snap into their orbit instead of sliding linearly
      const eased = 1 - (1 - unfold) * (1 - unfold);
      const orbit = TALON_ORBIT * eased;
      const spin = this.age * 0.0022;

      // once the combo is spent the talons are gone; only its last flare remains
      if (this.ending) {
        this.drawStrikeFlare();
        return;
      }

      push();
      translate(this.position.x, this.position.y);
      for (let i = 0; i < XINZHAO_Q_ATTACKS; i++) {
        const spent = i >= this.buffRef.strikesLeft;
        const angle = spin + (TWO_PI / XINZHAO_Q_ATTACKS) * i;
        push();
        rotate(angle);
        translate(orbit, 0);
        rotate(HALF_PI);
        if (spent) {
          // a spent talon stays visible but dull, so the count reads as 1-of-3
          noFill();
          stroke(120, 110, 80, 120 * eased);
          strokeWeight(2);
        } else {
          fill(255, 226, 140, 235 * eased);
          stroke(255, 255, 220, 240 * eased);
          strokeWeight(1.5);
        }
        // a spear head, not a dot
        triangle(0, -11, -5, 7, 5, 7);
        pop();
      }
      pop();

      this.drawStrikeFlare();
    }

    /** The ring on the body a talon just opened; wider and lifted on the finisher. */
    private drawStrikeFlare(): void {
      if (this.strikeFlare <= 0 || !this.strikePoint) return;

      const t = 1 - this.strikeFlare;
      push();
      translate(this.strikePoint.x, this.strikePoint.y);
      noFill();
      stroke(255, 236, 170, 235 * this.strikeFlare);
      strokeWeight(4 * this.strikeFlare + 1);
      circle(0, 0, 26 + 46 * t);
      if (this.strikeWasFinisher) {
        // the finisher gets a second, wider ring: the knock-up has to be legible
        stroke(255, 190, 90, 200 * this.strikeFlare);
        strokeWeight(3);
        circle(0, 0, 40 + 90 * t);
        // three lift lines for the up-throw
        for (let i = 0; i < 3; i++) {
          const a = (TWO_PI / 3) * i + t * 1.2;
          line(cos(a) * 14, sin(a) * 14, cos(a) * 14, sin(a) * 14 - 26 * t);
        }
      }
      pop();
    }

    getDisplayBoundingBox(): Rectangle {
      let minX = this.position.x;
      let minY = this.position.y;
      let maxX = this.position.x;
      let maxY = this.position.y;
      if (this.strikePoint && this.strikeFlare > 0) {
        minX = Math.min(minX, this.strikePoint.x);
        minY = Math.min(minY, this.strikePoint.y);
        maxX = Math.max(maxX, this.strikePoint.x);
        maxY = Math.max(maxY, this.strikePoint.y);
      }
      const pad = TALON_ORBIT + 80;
      return new Rectangle({
        x: minX - pad,
        y: minY - pad,
        w: maxX - minX + pad * 2,
        h: maxY - minY + pad * 2,
        data: this,
      });
    }
  }
  return XinZhao_Q_Object;
}
const __cacheXinZhao_Q_Object = new WeakMap<ContentApi, ReturnType<typeof __buildXinZhao_Q_Object>>();
export function makeXinZhao_Q_Object(api: ContentApi) {
  const cached = __cacheXinZhao_Q_Object.get(api);
  if (cached) return cached;
  const built = __buildXinZhao_Q_Object(api);
  __cacheXinZhao_Q_Object.set(api, built);
  return built;
}