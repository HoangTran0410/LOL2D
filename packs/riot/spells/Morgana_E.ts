import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Airborne = InstanceType<ContentApi['buffs']['Airborne']>;
type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Charm = InstanceType<ContentApi['buffs']['Charm']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Dash = InstanceType<ContentApi['buffs']['Dash']>;
type Fear = InstanceType<ContentApi['buffs']['Fear']>;
type Ground = InstanceType<ContentApi['buffs']['Ground']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Root = InstanceType<ContentApi['buffs']['Root']>;
type Shield = InstanceType<ContentApi['buffs']['Shield']>;
type Silence = InstanceType<ContentApi['buffs']['Silence']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Stun = InstanceType<ContentApi['buffs']['Stun']>;
type Morgana_E = InstanceType<ReturnType<typeof makeMorgana_E>>;
type Morgana_E_BlackShield = InstanceType<ReturnType<typeof makeMorgana_E_BlackShield>>;
type Morgana_E_Object = InstanceType<ReturnType<typeof makeMorgana_E_Object>>;



// Exported so the suite asserts the wiring, not a copy of the numbers —
// retuning a value should not mean editing the test.
// A LOL2D champion pool is ~100 health, so a shield is sized as a share of that:
// ~a third of a health bar, in line with the other shields in the game (Malphite
// W 25, Janna E 30, LeeSin W 22). The tooltip used to advertise 90 — the raw
// wiki figure — against code that only ever granted 30.
export const SHIELD_AMOUNT = 35;

export const SHIELD_DURATION_MS = 5_000;


function __buildMorgana_E(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Spell = api.Spell;
  const AttackableUnit = api.units.AttackableUnit;
  const Morgana_E_BlackShield = makeMorgana_E_BlackShield(api);
  const Morgana_E_Object = makeMorgana_E_Object(api);
  class Morgana_E extends Spell {
    // Auto-locks its own target; see "auto-locking spells" in docs/ADDING_SPELLS.md.
    targetingMode = 'SELF' as const;
    image = api.asset('spell_morgana_e');
    name = 'Khiên Đen (Morgana_E)';
    description = `Ban cho đồng minh có ít máu nhất trong phạm vi (hoặc chính mình) một <span class="buff">Lá Chắn Đen</span> hấp thụ <span class="damage">${SHIELD_AMOUNT} sát thương</span> trong <span class="time">${SHIELD_DURATION_MS / 1000} giây</span>. Khi lá chắn còn tồn tại, mục tiêu <span class="buff">miễn nhiễm mọi hiệu ứng khống chế</span> của kẻ địch (choáng, trói, câm lặng, làm chậm, hất tung, mê hoặc, khiếp sợ, ghìm, kéo/đẩy) — mỗi hiệu ứng bị chặn sẽ bị xoá ngay lập tức. Không chặn được <span class="buff">Mờ Mắt</span>, cũng không chặn khống chế từ chính mình hoặc đồng đội. Game không phân biệt sát thương phép và vật lý nên lá chắn hấp thụ mọi loại sát thương.`;
    coolDown = 6000;
    manaCost = 40;

    range = 500;
    shieldAmount = SHIELD_AMOUNT;
    shieldTime = SHIELD_DURATION_MS;

    onSpellCast() {
      const allies = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.owner.position.x,
          y: this.owner.position.y,
          r: effectiveRange(this.range, this.owner),
        }),
        filters: [
          PredefinedFilters.type(AttackableUnit),
          PredefinedFilters.teamId(this.owner.teamId),
          PredefinedFilters.excludeDead,
        ],
      });

      // the ally who needs it most; the caster shields themself when nobody is around
      let target = this.owner;
      let lowestHealth = Infinity;
      for (const ally of allies) {
        const health = ally.stats.health.value;
        if (health < lowestHealth) {
          target = ally;
          lowestHealth = health;
        }
      }

      const shieldBuff = new Morgana_E_BlackShield(this.shieldTime, this.owner, target);
      shieldBuff.image = this.image;
      shieldBuff.amount = this.shieldAmount;
      target.addBuff(shieldBuff);

      const obj = new Morgana_E_Object(this.owner);
      obj.targetUnit = target;
      obj.attachTo(target);
      this.game.objectManager.addObject(obj);
    }

    drawPreview() {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }
  }
  return Morgana_E;
}
const __cacheMorgana_E = new WeakMap<ContentApi, ReturnType<typeof __buildMorgana_E>>();
export default function makeMorgana_E(api: ContentApi) {
  const cached = __cacheMorgana_E.get(api);
  if (cached) return cached;
  const built = __buildMorgana_E(api);
  __cacheMorgana_E.set(api, built);
  return built;
}


/**
 * Black Shield: a shield that also grants crowd control immunity while it holds.
 *
 * The engine has no "before a buff is applied" hook, so immunity is enforced from
 * the buff's own update: every frame it walks the target's buff list and kills any
 * enemy-sourced crowd control that appeared after the shield went up. Because
 * `AttackableUnit.updateBuffs` re-accumulates the status flags of every buff each
 * frame *in list order*, and this shield always sits earlier in that list than the
 * crowd control it is blocking, zeroing the offender's flags here removes them from
 * the same frame's status — the target is never actually stunned/rooted/slowed.
 *
 * Faithful details taken from the wiki:
 *  - it does not cleanse crowd control that was already on the target, only blocks new,
 *  - it does not resist self or allied crowd control,
 *  - it does not resist nearsight (so `Nearsight` is absent from the blocked list).
 */
function __buildMorgana_E_BlackShield(api: ContentApi) {
  const Airborne = api.buffs.Airborne;
  const Charm = api.buffs.Charm;
  const Dash = api.buffs.Dash;
  const Fear = api.buffs.Fear;
  const Ground = api.buffs.Ground;
  const Root = api.buffs.Root;
  const Shield = api.buffs.Shield;
  const Silence = api.buffs.Silence;
  const Slow = api.buffs.Slow;
  const Stun = api.buffs.Stun;
  class Morgana_E_BlackShield extends Shield {
    name = 'Lá Chắn Đen';
    stackId = 'morgana_e_blackshield';
    color: [number, number, number] = [180, 90, 230];

    /** Crowd control this shield eats. `Dash` covers enemy displacements (hooks, pulls). */
    static BLOCKED_BUFFS: any[] = [Stun, Root, Silence, Slow, Airborne, Charm, Fear, Ground, Dash];

    /** Buffs present when the shield went up: those are left alone, no cleansing. */
    _preExisting: Set<any> = new Set();
    blockedCount = 0;
    _flash = 0;
    /** Cosmetic: one expanding ripple per disable eaten, capped so it stays cheap. */
    _ripples: number[] = [];

    onActivate(): void {
      for (const buff of this.targetUnit.buffs) this._preExisting.add(buff);
    }

    onUpdate(): void {
      if (this._flash > 0) this._flash -= deltaTime;

      // ripples age here, never in draw(), so their speed does not depend on
      // how many times the unit happens to be rendered
      let r = 0;
      while (r < this._ripples.length) {
        this._ripples[r] += deltaTime;
        if (this._ripples[r] >= 450) this._ripples.splice(r, 1);
        else r++;
      }

      if (this.toRemove || this.targetUnit.isDead) return;

      const targetTeamId = this.targetUnit.teamId;

      for (const buff of this.targetUnit.buffs) {
        if (buff === this || buff.toRemove || this._preExisting.has(buff)) continue;
        // self and allied crowd control goes through, like the real spell
        if (!buff.sourceUnit || buff.sourceUnit.teamId === targetTeamId) continue;
        if (!Morgana_E_BlackShield.BLOCKED_BUFFS.some((BuffClass: any) => buff instanceof BuffClass))
          continue;

        // strip the status it would contribute this very frame, then end it
        buff.statusFlagsToEnable = 0;
        buff.statusFlagsToDisable = 0;
        buff.deactivateBuff();

        this.blockedCount++;
        this._flash = 250;
        if (this._ripples.length < 4) this._ripples.push(0);
      }
    }

    draw(): void {
      super.draw();
      if (this.targetUnit.isDead) return;

      const pos = this.targetUnit.position;
      const size = this.targetUnit.animatedValues.displaySize;
      const flash = this._flash > 0 ? this._flash / 250 : 0;

      push();
      translate(pos.x, pos.y);

      // the shield itself: a dome of darkness, not a hairline ring
      noStroke();
      fill(30, 0, 48, 120 + 90 * flash);
      circle(0, 0, size + 20);
      fill(90, 25, 140, 70 + 70 * flash);
      circle(0, 0, size + 8);

      noFill();
      stroke(15, 0, 26, 220);
      strokeWeight(6);
      circle(0, 0, size + 20);
      stroke(205, 130, 255, 200 + 55 * flash);
      strokeWeight(3);
      circle(0, 0, size + 20);

      // runes turning on the surface of the dome
      stroke(215, 150, 255, 150 + 105 * flash);
      strokeWeight(3);
      const a = -frameCount / 40;
      for (let i = 0; i < 6; i++) {
        const angle = a + (i * TWO_PI) / 6;
        const r1 = size / 2 + 4;
        const r2 = size / 2 + 15;
        line(cos(angle) * r1, sin(angle) * r1, cos(angle) * r2, sin(angle) * r2);
        // a short cross-bar turns each spoke into a rune rather than a tick
        const mx = cos(angle) * (r1 + r2) * 0.5;
        const my = sin(angle) * (r1 + r2) * 0.5;
        line(mx - sin(angle) * 4, my + cos(angle) * 4, mx + sin(angle) * 4, my - cos(angle) * 4);
      }

      // every disable eaten throws off a ring — the block, made visible
      for (const age of this._ripples) {
        const t = constrain(age / 450, 0, 1);
        const fade = 1 - t;
        const ripple = size + 20 + t * 150;
        noFill();
        stroke(25, 0, 40, 220 * fade);
        strokeWeight(16 * fade + 1);
        circle(0, 0, ripple);
        stroke(235, 185, 255, 250 * fade);
        strokeWeight(6 * fade + 1);
        circle(0, 0, ripple);

        // shards of the broken effect spat outwards
        stroke(255, 235, 255, 240 * fade);
        strokeWeight(4 * fade + 1.5);
        for (let i = 0; i < 10; i++) {
          const ang = (TWO_PI * i) / 10 + t;
          const r1 = ripple / 2;
          const r2 = r1 + 20 * fade + 4;
          line(cos(ang) * r1, sin(ang) * r1, cos(ang) * r2, sin(ang) * r2);
        }
      }

      if (flash > 0) {
        noStroke();
        fill(235, 190, 255, 150 * flash);
        circle(0, 0, size + 26);
      }

      pop();
    }
  }
  return Morgana_E_BlackShield;
}
const __cacheMorgana_E_BlackShield = new WeakMap<ContentApi, ReturnType<typeof __buildMorgana_E_BlackShield>>();
export function makeMorgana_E_BlackShield(api: ContentApi) {
  const cached = __cacheMorgana_E_BlackShield.get(api);
  if (cached) return cached;
  const built = __buildMorgana_E_BlackShield(api);
  __cacheMorgana_E_BlackShield.set(api, built);
  return built;
}


/** The cast flash: a dark ring blooming outwards on whoever got the shield. */
function __buildMorgana_E_Object(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const SpellObject = api.SpellObject;
  class Morgana_E_Object extends SpellObject {
    targetUnit: any = null;
    age = 0;
    lifeTime = 500;
    maxRadius = 60;

    update() {
      if (this.dropIfAttachmentLost()) return;

      this.age += deltaTime;
      if (this.age >= this.lifeTime || !this.targetUnit) this.toRemove = true;
    }

    draw() {
      if (!this.targetUnit) return;

      const pos = this.targetUnit.position;
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const fade = 1 - t;
      const bodySize = this.targetUnit.animatedValues?.displaySize ?? 40;

      push();
      translate(pos.x, pos.y);

      // the dome slamming shut: a ring collapsing onto the target, not a bloom
      noFill();
      const closing = lerp(this.maxRadius * 2, bodySize + 20, t);
      stroke(20, 0, 34, 220 * fade);
      strokeWeight(11 * fade + 2);
      circle(0, 0, closing);
      stroke(205, 130, 255, 250 * fade);
      strokeWeight(5 * fade + 1.5);
      circle(0, 0, closing);

      // sigils dropping in with it
      stroke(235, 190, 255, 220 * fade);
      strokeWeight(3);
      for (let i = 0; i < 6; i++) {
        const a = (TWO_PI * i) / 6 - t * 1.6;
        line(
          cos(a) * closing * 0.5,
          sin(a) * closing * 0.5,
          cos(a) * closing * 0.4,
          sin(a) * closing * 0.4
        );
      }

      // it settles with a dark pulse over the protected champion
      const settle = constrain((t - 0.6) / 0.4, 0, 1);
      if (settle > 0) {
        noStroke();
        fill(40, 0, 62, 150 * settle * fade * 2.5);
        circle(0, 0, bodySize + 20);
      }

      pop();
    }

    getDisplayBoundingBox() {
      const pos = this.targetUnit?.position ?? this.owner.position;
      return new Rectangle({
        x: pos.x - this.maxRadius,
        y: pos.y - this.maxRadius,
        w: this.maxRadius * 2,
        h: this.maxRadius * 2,
        data: this,
      });
    }
  }
  return Morgana_E_Object;
}
const __cacheMorgana_E_Object = new WeakMap<ContentApi, ReturnType<typeof __buildMorgana_E_Object>>();
export function makeMorgana_E_Object(api: ContentApi) {
  const cached = __cacheMorgana_E_Object.get(api);
  if (cached) return cached;
  const built = __buildMorgana_E_Object(api);
  __cacheMorgana_E_Object.set(api, built);
  return built;
}