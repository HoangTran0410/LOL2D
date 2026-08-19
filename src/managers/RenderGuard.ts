/**
 * Keeps one bad frame from being the last one.
 *
 * p5's frame loop is `_draw`, and the shape of it is the whole reason this
 * module exists: it calls `redraw()` — which is where the game's `draw()` runs
 * — and only *afterwards*, at the very bottom, reaches
 *
 *     if (this._loop) this._requestAnimId = window.requestAnimationFrame(this._draw);
 *
 * (`p5.js:66431` and `:66449`). So an exception anywhere inside a draw does not
 * cost a frame, it costs **every frame from then on**: the chain is never
 * re-armed and nothing short of a reload brings the game back. What a player
 * sees is a black canvas with the Vue HUD still sitting on top of it, because
 * the DOM has a lifecycle of its own — reported from a real match on an
 * installed PWA after the app had been in the background a while.
 *
 * Two things follow, and both are the point:
 *
 *  - **The loop survives whatever threw.** That holds regardless of what it
 *    was, which matters because the cause is a browser reclaiming memory and
 *    is not reproducible on a desk.
 *  - **The player finds out.** They are on a phone and cannot open a console.
 *    A silent black screen is indistinguishable from a hang; a message and a
 *    reload button is a bug report.
 *
 * The error is also re-thrown out of band. `tests/e2e/harness.mjs` fails a run
 * on `pageerror`, so swallowing here would make every Playwright driver blind
 * to a crash in draw — the guard would have bought a live loop by hiding the
 * thing that killed it. Throwing from a `setTimeout` reaches `window.onerror`
 * without ever returning to p5's frame chain, so both properties hold at once.
 */

export interface RenderGuardOptions {
  /**
   * Where a crash is surfaced. Defaults to the on-screen overlay below; a test
   * passes its own, because the suite runs on `environment: 'node'` and has no
   * DOM to put an overlay in.
   */
  report?: (error: Error, count: number) => void;
  /**
   * How the first error is re-raised for anything watching `window.onerror`.
   * Injectable for the same reason.
   */
  rethrow?: (error: Error) => void;
}

const asError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(String(value));

const rethrowAsync = (error: Error): void => {
  setTimeout(() => {
    throw error;
  }, 0);
};

/**
 * Wraps a draw function so it can never break p5's frame chain.
 *
 * The counter is per wrapped function, so "how many frames have thrown" is a
 * fact about this loop rather than a module-wide tally.
 */
export function guardDraw(draw: () => void, options: RenderGuardOptions = {}): () => void {
  const report = options.report ?? showCrashOverlay;
  const rethrow = options.rethrow ?? rethrowAsync;
  let failures = 0;

  return () => {
    try {
      draw();
    } catch (thrown) {
      const error = asError(thrown);
      failures += 1;
      // Once. A draw that throws every frame would otherwise raise sixty errors
      // a second, and the first one is the one that says what happened.
      if (failures === 1) rethrow(error);
      report(error, failures);
    }
  };
}

/* ------------------------------------------------------------- the overlay */

const OVERLAY_ID = 'render-crash';

/**
 * Puts the error on the screen, because the player is on a phone.
 *
 * Plain DOM and no imports: this runs when the game has already failed, so it
 * must not depend on anything the game does. Built once and then only updated,
 * since the frame that threw is very likely to throw again immediately.
 */
function showCrashOverlay(error: Error, count: number): void {
  if (typeof document === 'undefined') return;

  const existing = document.getElementById(OVERLAY_ID);
  if (existing) {
    const tally = existing.querySelector('[data-crash-count]');
    if (tally) tally.textContent = String(count);
    return;
  }

  const box = document.createElement('div');
  box.id = OVERLAY_ID;
  box.setAttribute('role', 'alert');
  box.style.cssText = [
    'position:fixed',
    'left:0',
    'right:0',
    'bottom:0',
    'z-index:2147483647',
    'padding:12px 14px',
    'background:rgba(12,16,22,0.96)',
    'color:#e6e8ee',
    'font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace',
    'border-top:2px solid #c8763a',
    'max-height:45vh',
    'overflow:auto',
    // The canvas swallows touches; this must not be part of that argument.
    'touch-action:auto',
  ].join(';');

  const title = document.createElement('strong');
  title.textContent = 'Lỗi khi vẽ khung hình';
  title.style.cssText = 'display:block;color:#f0a860;margin-bottom:4px';

  const message = document.createElement('div');
  message.textContent = `${error.message}`;
  message.style.cssText = 'white-space:pre-wrap;word-break:break-word';

  const where = document.createElement('div');
  where.textContent = (error.stack ?? '').split('\n').slice(1, 4).join('\n');
  where.style.cssText = 'margin-top:4px;opacity:0.66;white-space:pre-wrap;word-break:break-word';

  const footer = document.createElement('div');
  footer.style.cssText = 'margin-top:8px;display:flex;gap:8px;align-items:center';

  const tally = document.createElement('span');
  tally.setAttribute('data-crash-count', '');
  tally.textContent = String(count);
  const tallyLabel = document.createElement('span');
  tallyLabel.style.cssText = 'opacity:0.66';
  tallyLabel.append('khung hình lỗi: ', tally);

  const reload = document.createElement('button');
  reload.type = 'button';
  reload.textContent = 'Tải lại';
  reload.style.cssText =
    'padding:6px 14px;background:#1b2430;color:#e6e8ee;border:1px solid #3a4658;font:inherit';
  // Both, per the house rule for every control in this game: the canvas layer
  // cancels gestures over itself and a click-only control is dead under a thumb.
  reload.addEventListener('click', () => location.reload());
  reload.addEventListener('touchend', event => {
    event.preventDefault();
    location.reload();
  });

  footer.append(reload, tallyLabel);
  box.append(title, message, where, footer);
  document.body.appendChild(box);
}
