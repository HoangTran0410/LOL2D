import { describe, expect, it, vi } from 'vitest';
import { guardDraw } from '../../src/managers/RenderGuard';

/**
 * One uncaught error in `draw()` used to end the game for good.
 *
 * p5's frame loop is `_draw`, and it calls `redraw()` — which is where our
 * `draw()` runs — *before* it reaches
 * `this._requestAnimId = window.requestAnimationFrame(this._draw)` at the very
 * bottom (`p5.js:66431` and `:66449`). So a throw anywhere inside the game's
 * draw does not skip a frame, it skips **every** frame from then on: the chain
 * is never re-armed and nothing short of a reload brings it back.
 *
 * Reported from a real match on an installed PWA — background the app long
 * enough and it comes back to a black canvas with the Vue HUD still on top of
 * it, which is exactly the shape of a dead canvas loop under a live DOM. The
 * player is on a phone and cannot open a console, so the error also has to
 * reach a screen.
 *
 * The guard is the structural half and stands on its own: whatever throws, and
 * whether or not we ever find out what it was, the loop has to survive it.
 */
describe('the render guard', () => {
  it('does not let a throwing draw escape, so p5 re-arms the frame', () => {
    const guarded = guardDraw(
      () => {
        throw new Error('boom');
      },
      { report: () => undefined, rethrow: () => undefined }
    );

    expect(() => guarded()).not.toThrow();
  });

  it('keeps calling draw on later frames', () => {
    // The property that actually matters: one bad frame is a bad frame, not the
    // end of the session.
    let frames = 0;
    const guarded = guardDraw(
      () => {
        frames++;
        if (frames === 1) throw new Error('boom');
      },
      { report: () => undefined, rethrow: () => undefined }
    );

    guarded();
    guarded();
    guarded();

    expect(frames).toBe(3);
  });

  it('reports the first error, with the count of every one after it', () => {
    const report = vi.fn();
    const guarded = guardDraw(
      () => {
        throw new Error('boom');
      },
      { report, rethrow: () => undefined }
    );

    guarded();
    guarded();
    guarded();

    expect(report).toHaveBeenCalledTimes(3);
    expect(report.mock.calls.map(call => call[1])).toEqual([1, 2, 3]);
    expect(report.mock.calls[0][0]).toBeInstanceOf(Error);
    expect((report.mock.calls[0][0] as Error).message).toBe('boom');
  });

  it('says nothing at all while the frame is fine', () => {
    const report = vi.fn();
    const guarded = guardDraw(() => undefined, { report, rethrow: () => undefined });

    guarded();
    guarded();

    expect(report).not.toHaveBeenCalled();
  });

  it('wraps a thrown non-Error, so the reporter always has a message', () => {
    const report = vi.fn();
    const guarded = guardDraw(
      () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw 'a string, which is legal and which p5 sketches do throw';
      },
      { report, rethrow: () => undefined }
    );

    guarded();

    expect(report.mock.calls[0][0]).toBeInstanceOf(Error);
    expect((report.mock.calls[0][0] as Error).message).toContain('a string');
  });

  it('re-throws out of band, so the e2e harness still sees a draw error', () => {
    // `tests/e2e/harness.mjs` fails a run on `pageerror`, and swallowing here
    // would make every Playwright driver blind to a crash in draw — the guard
    // would have bought a live loop by hiding the thing that killed it. An
    // async re-throw reaches `window.onerror` without ever returning to p5's
    // frame chain, so both properties hold at once.
    const escaped: unknown[] = [];
    const guarded = guardDraw(
      () => {
        throw new Error('boom');
      },
      { report: () => undefined, rethrow: error => escaped.push(error) }
    );

    guarded();
    guarded();

    // Once. A draw that throws every frame would otherwise raise sixty errors a
    // second, and the first one is the one that says what happened.
    expect(escaped).toHaveLength(1);
    expect((escaped[0] as Error).message).toBe('boom');
  });
});
