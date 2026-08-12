import type { CastContext } from '../spell/runtime/types';

export interface VfxHandle {
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

export default class SpellVfx {
  private readonly effects = new Set<VfxHandle>();
  private readonly loopingEffects = new Set<VfxHandle>();
  private readonly loopingSounds = new Set<SfxHandle>();

  constructor(
    private readonly vfx: SpellVfxSpec = {},
    private readonly sfx: SpellSfxSpec = {}
  ) {}

  castStart(context: CastContext): void {
    this.dispose();
    this.start('castStart', context);
    this.startLoop('castLoop', context);
  }

  release(context: CastContext, channeling: boolean): void {
    this.stopLoops();
    this.start('release', context);
    if (channeling) this.startLoop('channelLoop', context);
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
    for (const effect of this.effects) effect.update(deltaMs);
  }

  draw(): void {
    for (const effect of this.effects) effect.draw();
  }

  dispose(): void {
    this.stopLoops();
    for (const effect of this.effects) effect.dispose();
    this.effects.clear();
  }

  private start(phase: Phase, context: CastContext): void {
    const effect = this.vfx[phase]?.(context);
    if (effect) this.effects.add(effect);
    this.sfx[phase]?.(context).play();
  }

  private startLoop(phase: 'castLoop' | 'activeLoop' | 'channelLoop', context: CastContext): void {
    const effect = this.vfx[phase]?.(context);
    if (effect) {
      this.effects.add(effect);
      this.loopingEffects.add(effect);
    }
    const sound = this.sfx[phase]?.(context);
    if (sound) {
      sound.play();
      this.loopingSounds.add(sound);
    }
  }

  private stopLoops(): void {
    for (const effect of this.loopingEffects) {
      effect.dispose();
      this.effects.delete(effect);
    }
    this.loopingEffects.clear();
    for (const sound of this.loopingSounds) sound.stop();
    this.loopingSounds.clear();
  }
}
