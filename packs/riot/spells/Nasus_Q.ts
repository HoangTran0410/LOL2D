import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { ExecuteFallback, ExecuteSpell } from '@moba2d/core/content/types';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Nasus_Q = InstanceType<ReturnType<typeof makeNasus_Q>>;
type Nasus_Q_Object = InstanceType<ReturnType<typeof makeNasus_Q_Object>>;



export const RANGE = 150;

export const BASE_DAMAGE = 25;

export const DAMAGE_PER_STACK = 5;


const describe = (stacks: number): string =>
  `Chém một kẻ địch trong phạm vi <span>${RANGE}px</span> — ` +
  `<span class="buff">ưu tiên kẻ sẽ chết vì nhát này</span>, nếu không có thì kẻ gần nhất — gây ` +
  `<span class="damage">${BASE_DAMAGE + stacks * DAMAGE_PER_STACK} sát thương</span>` +
  ` <i>(${stacks} cộng dồn)</i>. Mỗi lần <span class="buff">hạ gục</span> bằng chiêu này, ` +
  `sát thương của nó <span class="buff">vĩnh viễn tăng thêm ${DAMAGE_PER_STACK}</span>`;


function __buildNasus_Q(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const VectorUtils = api.utils.VectorUtils;
  const pickExecuteTarget = api.combat.ExecuteTargeting.pickExecuteTarget;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Spell = api.Spell;
  const AttackableUnit = api.units.AttackableUnit;
  const Nasus_Q_Object = makeNasus_Q_Object(api);
  class Nasus_Q extends Spell implements ExecuteSpell {
    // Auto-locks its own target; see "auto-locking spells" in docs/ADDING_SPELLS.md.
    targetingMode = 'SELF' as const;
    image = api.asset('spell_nasus_q');
    name = 'Quyền Trượng Linh Hồn (Nasus_Q)';
    // Rebuilt on every stack so the tooltip states the damage the next strike
    // will actually deal, not the value it had at level one.
    description = describe(0);
    coolDown = 3000;
    manaCost = 10;

    range = RANGE;
    baseDamage = BASE_DAMAGE;
    damagePerStack = DAMAGE_PER_STACK;
    /** Grows by one every time the strike connects; never resets. */
    stacks = 0;

    /** Surfaced to the HUD, which badges the icon with it. */
    get stackCount(): number {
      return this.stacks;
    }

    /**
     * The write side, for the practice panel. Whole stacks only and never
     * negative — `stacks` is a count of strikes that landed, and the tooltip is
     * rebuilt from it here exactly as `onSpellCast` rebuilds it.
     */
    setStackCount(count: number): boolean {
      this.stacks = Math.max(0, Math.floor(count));
      this.description = describe(this.stacks);
      return true;
    }

    /** Nothing killable in range is still worth a swing: this is his damage key. */
    readonly executeFallback: ExecuteFallback = 'nearest';

    checkCastCondition() {
      return !!this.findVictim();
    }

    onSpellCast() {
      const target = this.findVictim();
      if (!target) return;

      // Read once: the swing that follows is drawn from the same number, and
      // `stacks` may be about to change.
      const damage = this.executeDamageAgainst(target);
      // `canTakeDamageFromTeam` already excludes corpses, so this can only be
      // false through some future filter change — but a stack is permanent, and
      // "was it alive before I hit it" is the whole condition for earning one.
      const wasAlive = !target.isDead;
      target.takeDamage(damage, this.owner);

      const slain = wasAlive && target.isDead;
      if (slain) {
        this.stacks++;
        this.description = describe(this.stacks);
      }

      const obj = new Nasus_Q_Object(this.owner);
      obj.targetPosition = target.position.copy();
      obj.angle = VectorUtils.getAngle(this.owner.position, target.position);
      obj.targetSize = target.animatedValues?.displaySize ?? 50;
      obj.stacks = this.stacks;
      // The tally plate is a receipt for a stack, so it only prints when one was
      // earned. On an ordinary swing the claw marks say everything there is.
      obj.slain = slain;
      obj.range = this.range;
      this.game.objectManager.addObject(obj);
    }

    /** The one it should hit: killable first, otherwise nearest. */
    findVictim(): AttackableUnit | null {
      return pickExecuteTarget(this);
    }

    executeDamageAgainst(_target: AttackableUnit): number {
      return this.baseDamage + this.stacks * this.damagePerStack;
    }

    executeCandidates(): AttackableUnit[] {
      return this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.owner.position.x,
          y: this.owner.position.y,
          r: effectiveRange(this.range, this.owner),
        }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as AttackableUnit[];
    }

    drawPreview() {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }
  }
  return Nasus_Q;
}
const __cacheNasus_Q = new WeakMap<ContentApi, ReturnType<typeof __buildNasus_Q>>();
export default function makeNasus_Q(api: ContentApi) {
  const cached = __cacheNasus_Q.get(api);
  if (cached) return cached;
  const built = __buildNasus_Q(api);
  __cacheNasus_Q.set(api, built);
  return built;
}


function __buildNasus_Q_Object(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const SpellObject = api.SpellObject;
  class Nasus_Q_Object extends SpellObject {
    targetPosition: p5.Vector = this.owner.position.copy();
    angle = 0;
    size = 90;
    lifeTime = 350;
    age = 0;

    /** All cosmetic: how big the victim is, how many stacks this swing carried,
     *  and how far the strike could reach — the last one is the telegraph. */
    targetSize = 50;
    stacks = 1;
    range = 150;
    /** Whether this swing actually banked a stack; see `Nasus_Q.onSpellCast`. */
    slain = false;

    update() {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) {
        this.toRemove = true;
      }
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const fade = 1 - t;
      // the swing gets visibly heavier as the stacks pile up
      const heft = 1 + Math.min(0.5, this.stacks * 0.02);

      // --- the reach of the strike, flashed on the caster -------------------
      push();
      translate(this.owner.position.x, this.owner.position.y);
      noFill();
      stroke(255, 205, 120, 150 * fade);
      strokeWeight(3 * fade + 1);
      circle(0, 0, this.range * 2);
      // the arm of the swing, from Nasus to the victim
      stroke(255, 225, 160, 190 * fade);
      strokeWeight(6 * fade + 1);
      const reach = this.owner.position.dist(this.targetPosition);
      const swing = this.angle + (1 - t) * 0.5 - 0.25;
      line(0, 0, cos(swing) * reach, sin(swing) * reach);
      pop();

      // --- the strike landing on the victim ---------------------------------
      push();
      translate(this.targetPosition.x, this.targetPosition.y);

      // white flash on the first frames, so the moment of contact is obvious
      if (t < 0.3) {
        blendMode(ADD);
        noStroke();
        fill(255, 220, 150, 170 * (1 - t / 0.3));
        circle(0, 0, this.targetSize * 1.4 * heft);
        blendMode(BLEND);
      }

      rotate(this.angle);

      // three claw gashes sweeping across the target
      const span = this.targetSize * (0.9 + 0.5 * t) * heft;
      for (let i = -1; i <= 1; i++) {
        const off = i * span * 0.22;
        stroke(255, 245, 210, 240 * fade);
        strokeWeight((5 - Math.abs(i) * 1.5) * fade + 1);
        noFill();
        arc(off * 0.4, off, span, span * 1.5, -PI / 2.6 + t * 0.4, PI / 2.6 + t * 0.4);
      }

      // the heavy leading edge of the staff
      stroke(255, 200, 110, 220 * fade);
      strokeWeight(8 * fade + 2);
      arc(0, 0, span * 1.25, span * 1.7, -PI / 3 + t * 0.4, PI / 3 + t * 0.4);

      // sand and grit knocked loose
      noStroke();
      fill(240, 210, 150, 200 * fade);
      for (let i = 0; i < 6; i++) {
        const a = -0.9 + i * 0.36;
        const d = span * 0.45 + 40 * t;
        circle(cos(a) * d, sin(a) * d, (6 - i * 0.4) * fade + 1);
      }

      pop();

      // --- the tally ---------------------------------------------------------
      // Only on a kill, because only a kill moves the number. Below the unit: the
      // health bar and buff icons already own the space above.
      if (!this.slain) return;
      push();
      // Overlay, not world — see Camera.constantSize. The plate and its number
      // compensate together, or the digits float off the plate at a small scale.
      const k = this.game?.camera?.constantSize?.(1) ?? 1;
      const ty = this.targetPosition.y + this.targetSize * 0.6 + (16 + t * 10) * k;
      textAlign(CENTER, CENTER);
      noStroke();
      fill(20, 12, 0, 150 * fade);
      rect(this.targetPosition.x - 24 * k, ty - 10 * k, 48 * k, 20 * k, 5 * k);
      fill(255, 225, 165, 245 * fade);
      textSize((15 + 7 * (1 - Math.min(1, t * 4))) * k);
      text(`Q ${this.stacks}`, this.targetPosition.x, ty);
      pop();
    }

    getDisplayBoundingBox() {
      // covers the victim, the swing arm and the range ring around Nasus
      const minX = Math.min(this.targetPosition.x, this.owner.position.x) - this.range;
      const minY = Math.min(this.targetPosition.y, this.owner.position.y) - this.range;
      return new Rectangle({
        x: minX,
        y: minY,
        w: Math.abs(this.targetPosition.x - this.owner.position.x) + this.range * 2,
        h: Math.abs(this.targetPosition.y - this.owner.position.y) + this.range * 2,
        data: this,
      });
    }
  }
  return Nasus_Q_Object;
}
const __cacheNasus_Q_Object = new WeakMap<ContentApi, ReturnType<typeof __buildNasus_Q_Object>>();
export function makeNasus_Q_Object(api: ContentApi) {
  const cached = __cacheNasus_Q_Object.get(api);
  if (cached) return cached;
  const built = __buildNasus_Q_Object(api);
  __cacheNasus_Q_Object.set(api, built);
  return built;
}