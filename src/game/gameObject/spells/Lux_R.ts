import AssetManager from '../../../managers/AssetManager';
import type { CastContext, CastSpec } from '../../spell/runtime/types';
import BeamRenderer from '../../vfx/BeamRenderer';
import CastBar from '../../vfx/CastBar';
import Spell from '../Spell';
import BeamSpellObject, {
  type BeamGeometry,
  type BeamTarget,
} from '../spellObjects/BeamSpellObject';

interface LuxTarget extends BeamTarget {
  readonly teamId: string;
  readonly isDead: boolean;
  takeDamage(damage: number, source: unknown): void;
}

export default class Lux_R extends Spell {
  image = AssetManager.getAsset('spell_lux_r');
  name = 'Cầu Vồng Tối Thượng (Lux_R)';
  description =
    'Niệm <span class="time">1 giây</span> rồi bắn một dải sáng theo hướng đã chốt, gây <span class="damage">30 sát thương</span> lên mọi kẻ địch trúng phải';
  coolDown = 10_000;
  manaCost = 50;

  private readonly castTimeMs = 1_000;
  private readonly range = 3_400;
  private readonly width = 200;
  private readonly damage = 30;
  private castElapsedMs = 0;
  private geometry?: BeamGeometry;

  protected get castSpec(): CastSpec {
    return {
      activation: 'PRESS',
      targeting: 'DIRECTION',
      castTimeMs: this.castTimeMs,
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'release', durationMs: this.coolDown },
      interrupts: {
        death: true,
        stun: false,
        silence: false,
        displacement: false,
        move: false,
      },
      vfx: {
        castStart: context => new CastBar(context, () => this.castElapsedMs / this.castTimeMs),
        castLoop: context => new BeamRenderer(this.beamGeometry(context)),
      },
    };
  }

  onCastStart(context: CastContext): void {
    this.castElapsedMs = 0;
    this.geometry = this.beamGeometry(context);
  }

  onUpdate(): void {
    if (this.state === 'CASTING') this.castElapsedMs += deltaTime;
  }

  onSpellCast(): void {
    if (!this.geometry) return;

    const beam = new BeamSpellObject<LuxTarget>(this.owner, this.geometry, {
      candidateFilter: target =>
        typeof target.takeDamage === 'function' &&
        !target.isDead &&
        target.teamId !== this.owner.teamId,
      onHit: target => target.takeDamage(this.damage, this.owner),
    });
    this.game.objectManager.addObject(beam);
  }

  private beamGeometry(context: CastContext): BeamGeometry {
    return {
      start: context.origin,
      end: {
        x: context.origin.x + context.direction.x * this.range,
        y: context.origin.y + context.direction.y * this.range,
      },
      width: this.width,
    };
  }
}
