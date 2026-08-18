import type { CastContext } from '@/game/spell/runtime/types';

export interface VfxHandle {
  readonly complete?: boolean;
  update(deltaMs: number): void;
  draw(): void;
  dispose(): void;
}

export interface SfxHandle {
  play(): void;
  stop(): void;
}

export type VfxFactory = (context: CastContext) => VfxHandle;
export type SfxFactory = (context: CastContext) => SfxHandle;

export interface SpellVfxSpec {
  castStart?: VfxFactory;
  castLoop?: VfxFactory;
  release?: VfxFactory;
  activeLoop?: VfxFactory;
  channelLoop?: VfxFactory;
  impact?: VfxFactory;
  cancel?: VfxFactory;
}

export interface SpellSfxSpec {
  castStart?: SfxFactory;
  castLoop?: SfxFactory;
  release?: SfxFactory;
  activeLoop?: SfxFactory;
  channelLoop?: SfxFactory;
  impact?: SfxFactory;
  cancel?: SfxFactory;
}

type Phase = keyof SpellVfxSpec;
type LoopPhase = 'castLoop' | 'activeLoop' | 'channelLoop';

export default class SpellVfx {
  private readonly effects = new Map<Phase, VfxHandle>();
  private readonly loopingSounds = new Map<LoopPhase, SfxHandle>();
  private loopPhase?: LoopPhase;

  constructor(
    private readonly vfx: SpellVfxSpec = {},
    private readonly sfx: SpellSfxSpec = {}
  ) {}

  castStart(context: CastContext): void {
    this.dispose();
    this.start('castStart', context);
    this.startLoop('castLoop', context);
  }

  release(context: CastContext): void {
    this.stopLoops();
    this.start('release', context);
  }

  channel(context: CastContext): void {
    this.startLoop('channelLoop', context);
  }

  activate(context: CastContext): void {
    this.stopLoops();
    this.startLoop('activeLoop', context);
  }

  impact(context: CastContext): void {
    this.start('impact', context);
  }

  cancel(context: CastContext): void {
    this.dispose();
    this.start('cancel', context);
  }

  complete(): void {
    this.stopLoops();
  }

  update(deltaMs: number): void {
    for (const [phase, effect] of this.effects) {
      effect.update(deltaMs);
      if (!effect.complete) continue;
      effect.dispose();
      this.effects.delete(phase);
    }
  }

  draw(): void {
    for (const effect of this.effects.values()) effect.draw();
  }

  dispose(): void {
    for (const effect of this.effects.values()) effect.dispose();
    this.effects.clear();
    for (const sound of this.loopingSounds.values()) sound.stop();
    this.loopingSounds.clear();
    this.loopPhase = undefined;
  }

  private start(phase: Phase, context: CastContext): void {
    this.disposePhase(phase);
    const effect = this.vfx[phase]?.(context);
    if (effect) this.effects.set(phase, effect);
    this.sfx[phase]?.(context).play();
  }

  private startLoop(phase: LoopPhase, context: CastContext): void {
    if (this.loopPhase === phase) return;
    this.stopLoops();
    this.loopPhase = phase;
    const effect = this.vfx[phase]?.(context);
    if (effect) this.effects.set(phase, effect);
    const sound = this.sfx[phase]?.(context);
    if (sound) {
      sound.play();
      this.loopingSounds.set(phase, sound);
    }
  }

  private stopLoops(): void {
    for (const phase of ['castLoop', 'activeLoop', 'channelLoop'] as const) {
      this.disposePhase(phase);
    }
    for (const sound of this.loopingSounds.values()) sound.stop();
    this.loopingSounds.clear();
    this.loopPhase = undefined;
  }

  private disposePhase(phase: Phase): void {
    this.effects.get(phase)?.dispose();
    this.effects.delete(phase);
  }
}
