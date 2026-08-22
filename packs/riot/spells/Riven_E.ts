import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastContext, CastSpec } from '@moba2d/core/content/types';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Buff = InstanceType<ContentApi['buffs']['Buff']>;
type Dash = InstanceType<ContentApi['buffs']['Dash']>;
type Shield = InstanceType<ContentApi['buffs']['Shield']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Riven_E = InstanceType<ReturnType<typeof makeRiven_E>>;
type Riven_E_Shell = InstanceType<ReturnType<typeof makeRiven_E_Shell>>;



export const E_DISTANCE = 280;

export const E_SHIELD = 25;

export const E_SHIELD_MS = 1_500;


const E_DASH_MS = 440;

const E_DASH_SPEED = 16;


const IRON: [number, number, number] = [30, 39, 46];

const RUNE: [number, number, number] = [0, 210, 168];

const RUNE_HOT: [number, number, number] = [150, 255, 228];


function __buildRiven_E(api: ContentApi) {
  const effectiveRange = api.combat.Reach.effectiveRange;
  const Dash = api.buffs.Dash;
  const Shield = api.buffs.Shield;
  const Spell = api.Spell;
  const Riven_E_Shell = makeRiven_E_Shell(api);
  class Riven_E extends Spell {
    image = api.asset('spell_riven_e');
    name = 'Anh Dũng (Riven_E)';
    description =
      `Lao ${E_DISTANCE} theo hướng chỉ định và dựng một lớp khiên ` +
      `<span class="damage">${E_SHIELD} điểm</span> trong ${E_SHIELD_MS / 1000} giây.`;
    coolDown = 8_000;
    manaCost = 20;
    range = E_DISTANCE;

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'PRESS',
        targeting: 'DIRECTION',
        resource: { commitAt: 'start', refundOn: [] },
        cooldown: { startAt: 'release', durationMs: this.coolDown },
      };
    }

    checkCastCondition(): boolean {
      return Dash.CanDash(this.owner);
    }

    onSpellCast(context: CastContext): void {
      const aim = this.firingDirection(context);
      const span = Math.hypot(aim.x, aim.y) || 1;
      const toX = this.owner.position.x + (aim.x / span) * E_DISTANCE;
      const toY = this.owner.position.y + (aim.y / span) * E_DISTANCE;

      const shield = new Shield(E_SHIELD_MS, this.owner, this.owner);
      shield.amount = E_SHIELD;
      shield.color = RUNE;
      shield.stackId = 'riven_e_shell';
      this.owner.addBuff(shield);

      // The shell is the subject of the effect, so the dash deliberately has no trail.
      this.game.objectManager.addObject(new Riven_E_Shell(this.owner, shield));

      const dash = new Dash(E_DASH_MS, this.owner, this.owner);
      dash.dashDestination = createVector(toX, toY);
      dash.dashSpeed = E_DASH_SPEED;
      dash.showTrail = false;
      this.owner.addBuff(dash);
    }

    drawPreview(): void {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }
  }
  return Riven_E;
}
const __cacheRiven_E = new WeakMap<ContentApi, ReturnType<typeof __buildRiven_E>>();
export default function makeRiven_E(api: ContentApi) {
  const cached = __cacheRiven_E.get(api);
  if (cached) return cached;
  const built = __buildRiven_E(api);
  __cacheRiven_E.set(api, built);
  return built;
}


/**
 * A faceted hexagonal shell that forms as she launches and cracks as it is spent. It reads
 * the live shield to decide how broken to look, so the player can see what is left of it.
 * Attached to the shield buff, so it drops exactly when the shield does.
 */
function __buildRiven_E_Shell(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const Buff = api.buffs.Buff;
  const SpellObject = api.SpellObject;
  class Riven_E_Shell extends SpellObject {
    static readonly FACETS = 6;
    age = 0;
    readonly shield: Buff;
    /** Seeded once in onAdded: a crack that re-rolls every frame is noise, not damage. */
    chips: { facet: number; along: number; length: number; lean: number }[] = [];

    constructor(owner: AttackableUnit, shield: Buff) {
      super(owner);
      this.position = owner.position.copy();
      this.shield = shield;
    }

    onAdded(): void {
      this.attachTo(this.owner, this.shield);
      for (let i = 0; i < 9; i++) {
        this.chips.push({
          facet: i % Riven_E_Shell.FACETS,
          along: 0.2 + random(0, 0.6),
          length: 7 + random(0, 11),
          lean: random(-0.7, 0.7),
        });
      }
    }

    update(): void {
      if (this.dropIfAttachmentLost()) return;
      this.age += deltaTime;
      this.position.set(this.owner.position.x, this.owner.position.y);
    }

    get shellRadius(): number {
      return this.owner.animatedValues.displaySize / 2 + 16;
    }

    draw(): void {
      // Forms over 200ms, then how whole it looks is how much shield is left.
      const formed = Math.min(1, this.age / 200);
      const grown = 1 - (1 - formed) * (1 - formed);
      const left = Math.max(0, Math.min(1, this.shield.shieldAmount / E_SHIELD));
      const spent = 1 - left;
      const reach = this.shellRadius * (0.55 + 0.45 * grown);
      const spin = this.age / 2200;
      const corners: { x: number; y: number }[] = [];
      for (let i = 0; i < Riven_E_Shell.FACETS; i++) {
        const angle = spin + (i / Riven_E_Shell.FACETS) * Math.PI * 2;
        corners.push({
          x: this.position.x + Math.cos(angle) * reach,
          y: this.position.y + Math.sin(angle) * reach,
        });
      }

      push();
      // the pane: dark iron, thinning out as the shield is eaten
      noStroke();
      fill(IRON[0], IRON[1], IRON[2], 120 * grown * left);
      beginShape();
      for (const corner of corners) vertex(corner.x, corner.y);
      endShape(CLOSE);

      // the facet frame, still there once the panes are gone
      noFill();
      for (let i = 0; i < Riven_E_Shell.FACETS; i++) {
        const from = corners[i];
        const to = corners[(i + 1) % Riven_E_Shell.FACETS];
        stroke(RUNE[0], RUNE[1], RUNE[2], (110 + 145 * left) * grown);
        strokeWeight(2.5 - 1.2 * spent);
        line(from.x, from.y, to.x, to.y);
        stroke(RUNE_HOT[0], RUNE_HOT[1], RUNE_HOT[2], 90 * grown * left);
        strokeWeight(1);
        line(this.position.x, this.position.y, from.x, from.y);
      }

      // cracks: only as many as the shield has already absorbed
      const shown = Math.round(this.chips.length * spent);
      strokeWeight(1.5);
      for (let i = 0; i < shown; i++) {
        const chip = this.chips[i];
        const from = corners[chip.facet];
        const to = corners[(chip.facet + 1) % Riven_E_Shell.FACETS];
        const rootX = from.x + (to.x - from.x) * chip.along;
        const rootY = from.y + (to.y - from.y) * chip.along;
        const inward = Math.atan2(this.position.y - rootY, this.position.x - rootX) + chip.lean;
        stroke(RUNE_HOT[0], RUNE_HOT[1], RUNE_HOT[2], 220);
        line(
          rootX,
          rootY,
          rootX + Math.cos(inward) * chip.length,
          rootY + Math.sin(inward) * chip.length
        );
      }
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((this.shellRadius + 30) * 2);
    }
  }
  return Riven_E_Shell;
}
const __cacheRiven_E_Shell = new WeakMap<ContentApi, ReturnType<typeof __buildRiven_E_Shell>>();
export function makeRiven_E_Shell(api: ContentApi) {
  const cached = __cacheRiven_E_Shell.get(api);
  if (cached) return cached;
  const built = __buildRiven_E_Shell(api);
  __cacheRiven_E_Shell.set(api, built);
  return built;
}