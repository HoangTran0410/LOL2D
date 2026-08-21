import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, createUnit, installSpellObjectGlobals } from '../../../game/spell/fixtures';
import type { CastContext } from '../../../../src/game/spell/runtime/types';
import { buildContentApi } from '../../../../src/content/ContentApi';
import makeTwitch_Q, { makeTwitch_Q_Object } from '../../../../packs/riot/spells/Twitch_Q';
const __api = buildContentApi();
const Twitch_Q = makeTwitch_Q(__api);
const Twitch_Q_Object = makeTwitch_Q_Object(__api);

const context: CastContext = Object.freeze({
  spellId: 'twitch-q',
  activationId: 'activation',
  startedAtMs: 0,
  caster: {},
  origin: Object.freeze({ x: 0, y: 0 }),
  cursorWorld: Object.freeze({ x: 1, y: 0 }),
  direction: Object.freeze({ x: 1, y: 0 }),
});

describe('Twitch Q stealth VFX does not survive death', () => {
  beforeEach(() => installSpellObjectGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('drops the cloak the instant the caster dies mid-stealth, and stays dropped through a respawn elsewhere', () => {
    const game = createGame();
    const twitch = createUnit(game, 0, 'blue');
    twitch.animatedValues.displaySize = 20;
    const spawned: unknown[] = [];
    game.objectManager.addObject = ((object: unknown) =>
      spawned.push(object)) as typeof game.objectManager.addObject;

    const spell = new Twitch_Q(twitch);
    spell.press(context);

    // named rather than counted: a bare length silently asserts the whole kit,
    // so adding a buff to Ambush reads as a regression in an unrelated file
    const applied = twitch.buffs.map(buff => buff.constructor.name).sort();
    expect(applied).toEqual(['Invisible', 'Phasing', 'Speedup']);
    const cloak = spawned.find((o): o is Twitch_Q_Object => o instanceof Twitch_Q_Object)!;
    expect(cloak).toBeInstanceOf(Twitch_Q_Object);
    expect(cloak._cloaked).toBe(true);

    // Killed well inside the 4s stealth window — the old bug relied on the
    // buff's own duration to expire it, which only happened to work because
    // the base 5s respawn timer outlasts a 4s Q. Any death mid-stealth must
    // clear it immediately, not "eventually if the timer allows it".
    twitch.die({ reviveAfter: 5_000 });

    expect(cloak._cloaked).toBe(false);
    expect(twitch.buffs).toHaveLength(0);

    // Respawning elsewhere must not bring the cloak back to life.
    twitch.respawn();
    twitch.position.set(999, 999);
    expect(cloak._cloaked).toBe(false);
    expect(twitch.buffs).toHaveLength(0);
  });

  it('self-removes shortly after a mid-stealth death instead of parking on screen forever', () => {
    const game = createGame();
    const twitch = createUnit(game, 0, 'blue');
    twitch.animatedValues.displaySize = 20;
    const spawned: unknown[] = [];
    game.objectManager.addObject = ((object: unknown) =>
      spawned.push(object)) as typeof game.objectManager.addObject;

    const spell = new Twitch_Q(twitch);
    spell.press(context);
    const cloak = spawned.find((o): o is Twitch_Q_Object => o instanceof Twitch_Q_Object)!;

    twitch.die({ reviveAfter: 5_000 });

    // one big tick past both the smoke's own lifetime and the mote decay window
    vi.stubGlobal('deltaTime', cloak.lifeTime + 700);
    cloak.update();

    expect(cloak.toRemove).toBe(true);
  });
});
