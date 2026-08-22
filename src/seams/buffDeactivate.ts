import type { SeamCheck, SeamViolation } from './types';
import { readSource, walkTsFiles } from './shared';

/**
 * `Buff` has exactly one way to end: `deactivateBuff()`. There is no
 * `Buff.deactivate()` — `deactivate()` is a *`Spell`* method, and `Spell`
 * subclasses call `super.deactivate()` all over a content tree, which is
 * what makes the wrong one so easy to reach for. Both typecheck: the buff
 * arrays a spell walks are loosely typed, so `tsc` never sees the call.
 *
 * See `tests/seams/exported-seams.test.ts` for the shipped
 * examples (a stealth cloak and a self-heal-over-time ultimate).
 */
const DEACTIVATE_CALL = /([A-Za-z_$][\w$]*)\s*\??\.deactivate\(\)/g;

/** `super` is a Spell ending its own lifecycle; anything named `spell` too. */
const isSpellReceiver = (receiver: string): boolean =>
  receiver === 'super' || /spell/i.test(receiver);

/** Comments describe the rule; only code may break it. */
const codeOf = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

export const checkBuffDeactivate: SeamCheck = (root, options) => {
  const violations: SeamViolation[] = [];
  for (const file of walkTsFiles(root, options)) {
    for (const line of codeOf(readSource(root, file)).split('\n')) {
      for (const [, receiver] of line.matchAll(DEACTIVATE_CALL)) {
        if (!isSpellReceiver(receiver)) {
          violations.push({ file, message: line.trim() });
        }
      }
    }
  }
  return violations;
};
