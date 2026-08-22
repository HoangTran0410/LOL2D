import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { BeamGeometry, CastContext, CastSpec } from '@moba2d/core/content/types';
// Relative, not `@/`: `LuxBeamEffect` moved into `packs/riot/vfx/` (Task 2 of
// the content-pack extraction) and this file has not moved yet, so this is a
// core file reaching into the Riot pack rather than the reverse. Temporary —
// `Lux_R.ts` itself moves into `packs/riot/spells/` in a later task of the
// same batch, at which point this becomes an ordinary sibling import.
import LuxBeamEffect from '../vfx/LuxBeamEffect';
import makeFlash from './Flash';
import makeGhost from './Ghost';
import makeHeal from './Heal';
import makeIgnite from './Ignite';
import makeLux_E, { makeLux_E_Object } from './Lux_E';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type BeamSpellObject = InstanceType<ContentApi['BeamSpellObject']>;
type Buff = InstanceType<ContentApi['buffs']['Buff']>;
type CastBar = InstanceType<ContentApi['vfx']['CastBar']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Lux_R = InstanceType<ReturnType<typeof makeLux_R>>;
type Lux_R_Beam = InstanceType<ReturnType<typeof makeLux_R_Beam>>;
type Lux_R_CastLock = InstanceType<ReturnType<typeof makeLux_R_CastLock>>;
type Lux_R_Vision = InstanceType<ReturnType<typeof makeLux_R_Vision>>;
type Flash = InstanceType<ReturnType<typeof makeFlash>>;
type Ghost = InstanceType<ReturnType<typeof makeGhost>>;
type Heal = InstanceType<ReturnType<typeof makeHeal>>;
type Ignite = InstanceType<ReturnType<typeof makeIgnite>>;
type Lux_E = InstanceType<ReturnType<typeof makeLux_E>>;
type Lux_E_Object = InstanceType<ReturnType<typeof makeLux_E_Object>>;



function hasSpells(unit: AttackableUnit): unit is AttackableUnit & { spells: Spell[] } {
  return 'spells' in unit && Array.isArray(unit.spells);
}


function __buildLux_R_CastLock(api: ContentApi) {
  const StatusFlags = api.enums.StatusFlags;
  const Buff = api.buffs.Buff;
  const Spell = api.Spell;
  const Flash = makeFlash(api);
  const Ghost = makeGhost(api);
  const Heal = makeHeal(api);
  const Ignite = makeIgnite(api);
  const Lux_E = makeLux_E(api);
  const Lux_E_Object = makeLux_E_Object(api);
  class Lux_R_CastLock extends Buff {
    name = 'Cầu Vồng Tối Thượng';
    stackId = 'lux_r_cast_lock';
    statusFlagsToEnable = StatusFlags.Immovable;
    private readonly disabledBeforeCast = new Map<Spell, boolean>();

    onActivate(): void {
      this.targetUnit.stopMovement?.();
      if (!hasSpells(this.targetUnit)) return;
      for (const spell of this.targetUnit.spells) {
        this.disabledBeforeCast.set(spell, spell.disabled);
        if (!this.isPermitted(spell)) spell.disabled = true;
      }
    }

    onDeactivate(): void {
      for (const [spell, wasDisabled] of this.disabledBeforeCast) spell.disabled = wasDisabled;
      this.disabledBeforeCast.clear();
    }

    private isPermitted(spell: Spell): boolean {
      return (
        spell instanceof Ghost ||
        spell instanceof Heal ||
        spell instanceof Ignite ||
        spell instanceof Flash ||
        (spell instanceof Lux_E && spell.luxEObject?.phase === Lux_E_Object.PHASES.STATIC)
      );
    }
  }
  return Lux_R_CastLock;
}
const __cacheLux_R_CastLock = new WeakMap<ContentApi, ReturnType<typeof __buildLux_R_CastLock>>();
export function makeLux_R_CastLock(api: ContentApi) {
  const cached = __cacheLux_R_CastLock.get(api);
  if (cached) return cached;
  const built = __buildLux_R_CastLock(api);
  __cacheLux_R_CastLock.set(api, built);
  return built;
}


// Exported so the suite asserts the beam and reveal wiring, not a copy of the
// numbers — retuning a value should not mean editing the test.
export const CAST_TIME_MS = 1_000;

export const RANGE = 3_400;

export const WIDTH = 200;

export const DAMAGE = 30;

export const REVEAL_DURATION_MS = 1_500;

/** Lux's own reveal slot, so hers neither evicts nor is evicted by another spell's. */
export const REVEAL_STACK_ID = 'lux_r_reveal';

export const REVEAL_VISION_RADIUS = 150;

export const VISION_LIFETIME_MS = 1_500;

export const MANA_COST = 100;


/**
 * The beam the player actually sees, as a world object rather than as
 * `castSpec.vfx`.
 *
 * `castSpec.vfx` is drawn from `Champion.draw()`, so it inherits the caster's
 * visibility twice over: `ObjectManager.draw()` only reaches objects whose
 * *own* display box is on camera, and `FogOfWar` clears `visibleToPlayerTeam` on every
 * unit the player cannot see. A 3400px beam hung off a 40px champion therefore
 * vanished outright whenever Lux was off screen or in fog, while still doing
 * its damage and stamping its reveal on the victim — measured on a real match:
 * `LuxBeamEffect.draw` never ran, the player lost health, and the Lux R icon
 * appeared on their bar with no beam ever painted.
 *
 * Out here it is culled by its own bounds and fog never touches it, which is
 * how every other spell's effect in this game already behaves — they are all
 * world objects, which is why only this one went missing. This is deliberately
 * not a general rule for `castSpec.vfx`: Pantheon Q's and Varus Q's
 * `ChargeRangeTelegraph` show where the *caster* is aiming, and hiding those
 * along with a caster nobody can see is correct. The beam is the effect, not a
 * telegraph of one, and only effects belong in the world.
 */
function __buildLux_R_Beam(api: ContentApi) {
  const SpellObject = api.SpellObject;
  const beamBoundingBox = api.beamBoundingBox;
  const Rectangle = api.utils.Quadtree.Rectangle;
  class Lux_R_Beam extends SpellObject {
    private readonly effect: LuxBeamEffect;

    constructor(
      owner: SpellObject['owner'],
      private readonly geometry: BeamGeometry,
      phase: 'prepare' | 'release',
      getProgress?: () => number
    ) {
      super(owner);
      this.effect = new LuxBeamEffect(geometry, phase, getProgress);
    }

    update(deltaMs = deltaTime): void {
      if (this.dropIfAttachmentLost()) return;
      this.effect.update(deltaMs);
      if (this.effect.complete) this.toRemove = true;
    }

    draw(): void {
      this.effect.draw();
    }

    getDisplayBoundingBox(): Rectangle {
      return beamBoundingBox(this.geometry, this);
    }

    /** Ends the beam now, for a cast that never reached its release. */
    dispose(): void {
      this.effect.dispose();
      this.toRemove = true;
    }
  }
  return Lux_R_Beam;
}
const __cacheLux_R_Beam = new WeakMap<ContentApi, ReturnType<typeof __buildLux_R_Beam>>();
export function makeLux_R_Beam(api: ContentApi) {
  const cached = __cacheLux_R_Beam.get(api);
  if (cached) return cached;
  const built = __buildLux_R_Beam(api);
  __cacheLux_R_Beam.set(api, built);
  return built;
}


function __buildLux_R_Vision(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class Lux_R_Vision extends SpellObject {
    visionRadius = 250;
    private elapsedMs = 0;

    constructor(owner: SpellObject['owner'], position: { x: number; y: number }) {
      super(owner);
      this.position = createVector(position.x, position.y);
    }

    update(deltaMs = deltaTime): void {
      this.elapsedMs += Math.max(0, deltaMs);
      if (this.elapsedMs >= VISION_LIFETIME_MS) this.toRemove = true;
    }
  }
  return Lux_R_Vision;
}
const __cacheLux_R_Vision = new WeakMap<ContentApi, ReturnType<typeof __buildLux_R_Vision>>();
export function makeLux_R_Vision(api: ContentApi) {
  const cached = __cacheLux_R_Vision.get(api);
  if (cached) return cached;
  const built = __buildLux_R_Vision(api);
  __cacheLux_R_Vision.set(api, built);
  return built;
}


function __buildLux_R(api: ContentApi) {
  const SpellForm = api.enums.SpellForm;
  const CastBar = api.vfx.CastBar;
  const Spell = api.Spell;
  const createReveal = api.buffs.createReveal;
  const BeamSpellObject = api.BeamSpellObject;
  const Lux_R_CastLock = makeLux_R_CastLock(api);
  const Lux_R_Beam = makeLux_R_Beam(api);
  const Lux_R_Vision = makeLux_R_Vision(api);
  class Lux_R extends Spell {
    image = api.asset('spell_lux_r');
    name = 'Cầu Vồng Tối Thượng (Lux_R)';
    description =
      'Niệm <span class="time">1 giây</span> rồi bắn một dải sáng theo hướng đã chốt, gây <span class="damage">30 sát thương</span> lên mọi kẻ địch trúng phải';
    coolDown = 10_000;
    manaCost = MANA_COST;

    private readonly castTimeMs = CAST_TIME_MS;
    private readonly range = RANGE;
    private readonly width = WIDTH;
    private readonly damage = DAMAGE;
    private castElapsedMs = 0;
    private geometry?: BeamGeometry;
    private castLock?: Lux_R_CastLock;
    private prepareBeam?: Lux_R_Beam;
    private sightObjects: Lux_R_Vision[] = [];

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'PRESS',
        targeting: 'DIRECTION',
        castTimeMs: this.castTimeMs,
        resource: { commitAt: 'start', refundOn: [] },
        cooldown: { startAt: 'release', durationMs: this.coolDown },
        // Once the beam is called down it is in the sky, not in Lux's hands: the
        // cast time is a wind-up on an effect that is already committed, so only
        // her dying takes it back.
        interrupts: SpellForm.INDEPENDENT,
        // The cast bar only, on purpose. It hangs over Lux's head and means
        // nothing without her, so inheriting her visibility is right. The beam
        // does not — see `Lux_R_Beam`.
        vfx: {
          castStart: context => new CastBar(context, () => this.castElapsedMs / this.castTimeMs),
        },
      };
    }

    onCastStart(context: CastContext): void {
      this.castElapsedMs = 0;
      this.geometry = this.beamGeometry(context);
      this.castLock = new Lux_R_CastLock(this.castTimeMs, this.owner, this.owner);
      this.castLock.image = this.image;
      this.owner.addBuff(this.castLock);
      this.addBeamSight(this.geometry);

      this.prepareBeam = new Lux_R_Beam(
        this.owner,
        this.geometry,
        'prepare',
        () => this.castElapsedMs / this.castTimeMs
      );
      // The wind-up is a telegraph of a cast still in progress, so it rides Lux:
      // if she dies the beam never arrives and the lane must go with her. The
      // release flash below does not, because by then the beam is already in the
      // sky and out of her hands.
      this.prepareBeam.attachTo(this.owner);
      this.game.objectManager.addObject(this.prepareBeam);
    }

    onUpdate(): void {
      if (this.state === 'CASTING') this.castElapsedMs += deltaTime;
    }

    onSpellCast(): void {
      if (!this.geometry) return;

      this.endPrepareBeam();
      this.game.objectManager.addObject(new Lux_R_Beam(this.owner, this.geometry, 'release'));

      const beam = new BeamSpellObject(this.owner, this.geometry, {
        candidateFilter: target =>
          typeof target.takeDamage === 'function' &&
          typeof target.addBuff === 'function' &&
          !target.isDead &&
          target.teamId !== this.owner.teamId,
        onHit: target => {
          target.takeDamage(this.damage, this.owner);
          target.addBuff(
            createReveal({
              stackId: REVEAL_STACK_ID,
              durationMs: REVEAL_DURATION_MS,
              source: this.owner,
              target,
              visionRadius: REVEAL_VISION_RADIUS,
              image: this.image,
            })
          );
        },
      });
      this.game.objectManager.addObject(beam);
    }

    onCancel(): void {
      this.releaseCastLock();
      this.endPrepareBeam();
      for (const sight of this.sightObjects) sight.toRemove = true;
      this.sightObjects = [];
    }

    onComplete(): void {
      this.releaseCastLock();
      this.endPrepareBeam();
    }

    private beamGeometry(context: CastContext): BeamGeometry {
      const direction = this.firingDirection(context);
      return {
        start: context.origin,
        end: {
          x: context.origin.x + direction.x * this.range,
          y: context.origin.y + direction.y * this.range,
        },
        width: this.width,
      };
    }

    private addBeamSight(geometry: BeamGeometry): void {
      const segments = Math.ceil(this.range / 400);
      this.sightObjects = [];
      for (let index = 0; index <= segments; index++) {
        const ratio = index / segments;
        const sight = new Lux_R_Vision(this.owner, {
          x: geometry.start.x + (geometry.end.x - geometry.start.x) * ratio,
          y: geometry.start.y + (geometry.end.y - geometry.start.y) * ratio,
        });
        this.sightObjects.push(sight);
        this.game.objectManager.addObject(sight);
      }
    }

    private releaseCastLock(): void {
      this.castLock?.deactivateBuff();
      this.castLock = undefined;
    }

    private endPrepareBeam(): void {
      this.prepareBeam?.dispose();
      this.prepareBeam = undefined;
    }
  }
  return Lux_R;
}
const __cacheLux_R = new WeakMap<ContentApi, ReturnType<typeof __buildLux_R>>();
export default function makeLux_R(api: ContentApi) {
  const cached = __cacheLux_R.get(api);
  if (cached) return cached;
  const built = __buildLux_R(api);
  __cacheLux_R.set(api, built);
  return built;
}