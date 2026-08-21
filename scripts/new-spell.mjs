#!/usr/bin/env node
/**
 * Scaffold a spell that is already correct about the things that are invisible
 * from the file you are editing.
 *
 *   npm run spell:new -- --champion Jhin --slot R
 *   npm run spell:new -- --champion Jhin --slot Q --targeting UNIT
 *   npm run spell:new -- --champion Jhin --slot R --activation RECAST --recasts 4
 *
 * Every trap in `docs/ADDING_SPELLS.md` that has actually shipped is baked into
 * the output rather than left for the author to remember:
 *
 *   - `castSpec` is built from exported constants only, because the runtime
 *     resolves it once and a getter reading live state freezes the first cast's
 *     answer in for the match (Jhin R);
 *   - a `UNIT` spell gets `targetTeam`, a `targetingRequest` and the `press()`
 *     override together, because omitting them resolves the *caster* as the
 *     target (Diana E, Sett R, Syndra R, Vi R);
 *   - the spell object carries `getDisplayBoundingBox`, because the default is a
 *     zero-area box and the effect vanishes at the screen edge;
 *   - the generated test drives `press()`, never a lifecycle hook, because a
 *     hook-calling test is green against an ability that does not work at all
 *     (Jhin R again);
 *   - the display name is taken from Riot's `vi_VN` localisation, because
 *     `vi-spell-names.test.ts` fails the build on a hand-written one.
 *
 * It also performs both registrations — the barrel export and the champion's
 * preset entry — since "forgot to register it" is its own recurring half hour.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Batch 4 task 3 moved the spells into the riot pack — a pack spell is a
// factory now (`(api: ContentApi) => SpellClass`), never a plain class
// value-importing core; see docs/ADDING_SPELLS.md and
// packs/riot/spells/_EmptyExample.ts for the shape this script generates.
const SPELLS_DIR = join(ROOT, 'packs/riot/spells');
const TESTS_DIR = join(ROOT, 'tests/game/spells');
const INDEX_FILE = join(SPELLS_DIR, 'index.ts');
// `preset.ts` stopped being where a champion's kit lives before batch 4 —
// see that file's own "Stage 4" header comment. The roster (what used to be
// `CHAMPION_KITS` in `config/spellCatalog.ts`, before batch 4 task 7 moved
// it into the pack itself) is real pack content now, keyed by bare spell id
// string rather than an `AllSpells.X` class reference.
const CATALOG_FILE = join(ROOT, 'packs/riot/data.ts');
const VI_NAMES_FILE = join(ROOT, 'docs/spell-names-vi.json');

const SLOTS = ['Q', 'W', 'E', 'R'];
const TARGETINGS = ['SELF', 'DIRECTION', 'POINT', 'UNIT'];
const ACTIVATIONS = ['PRESS', 'RECAST', 'TOGGLE', 'HOLD_RELEASE', 'TAP_OR_HOLD'];

const die = message => {
  console.error(`\n  ${message}\n`);
  process.exit(1);
};

// ─── arguments ────────────────────────────────────────────────────────────────

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const token = process.argv[i];
  if (!token.startsWith('--')) continue;
  const [key, inlineValue] = token.slice(2).split('=');
  const next = process.argv[i + 1];
  // A trailing `--force` has no value at all, so absence reads as `true` too.
  args[key] =
    inlineValue ?? (next === undefined || next.startsWith('--') ? 'true' : process.argv[++i]);
}

const champion = args.champion;
const slot = (args.slot ?? '').toUpperCase();
const targeting = (args.targeting ?? 'DIRECTION').toUpperCase();
const activation = (args.activation ?? 'PRESS').toUpperCase();
const recasts = Number(args.recasts ?? 1);
const force = args.force === 'true' || args.force === true;

if (!champion) die('--champion is required, e.g. --champion Jhin');
if (!SLOTS.includes(slot)) die(`--slot must be one of ${SLOTS.join(', ')}`);
if (!TARGETINGS.includes(targeting)) die(`--targeting must be one of ${TARGETINGS.join(', ')}`);
if (!ACTIVATIONS.includes(activation)) die(`--activation must be one of ${ACTIVATIONS.join(', ')}`);
if (!Number.isInteger(recasts) || recasts < 1) die('--recasts must be a positive whole number');

/** `Jarvan IV` -> `JarvanIV`, which is what the class and the file are called. */
const classPrefix = champion.replace(/[^A-Za-z0-9]/g, '');
const slug = `${classPrefix}_${slot}`;
const spellFile = join(SPELLS_DIR, `${slug}.ts`);
const testFile = join(TESTS_DIR, `${slug}.test.ts`);

if (existsSync(spellFile) && !force) {
  die(`${slug}.ts already exists. Pass --force to overwrite it.`);
}

// ─── the display name has to be Riot's ────────────────────────────────────────

const viNames = JSON.parse(readFileSync(VI_NAMES_FILE, 'utf8'));
const viName = viNames.names?.[slug];
if (!viName) {
  die(
    `No Vietnamese name recorded for ${slug}.\n` +
      `  \`vi-spell-names.test.ts\` fails the build without one, so fetch it first:\n\n` +
      `      npm run names:sync -- --refresh\n`
  );
}

// ─── templates ────────────────────────────────────────────────────────────────

const CONST = name => `${classPrefix.toUpperCase()}_${slot}_${name}`;

const isUnit = targeting === 'UNIT';
const isCharge = activation === 'HOLD_RELEASE' || activation === 'TAP_OR_HOLD';
const isRecast = activation === 'RECAST' || activation === 'TOGGLE';

// A pack spell imports `ContentApi` as a type only and reaches everything
// else — base classes, buffs, combat helpers — off the `api` argument its
// factory receives. `packBoundary.test.ts` enforces this: a pack file
// importing `Spell`/`AttackableUnit`/etc. as a *value* fails the build.
const imports = [
  `import type { ContentApi } from '@/content/ContentApi';`,
  `import type { CastContext, CastSpec${isUnit ? ', TargetingRequest' : ''} } from '@/content/types';`,
]
  .filter(Boolean)
  .join('\n');

/** The `active` block, which is also where a multi-recast budget is declared. */
const activeBlock = isRecast
  ? `
      active: {
        maxDurationMs: ${CONST('WINDOW_MS')},${
          recasts > 1
            ? `
        recastDelayMs: ${CONST('RECAST_GAP_MS')},
        // The runtime completes the activation on the LAST recast, not the
        // first. Without this it is 1, and the effect ends after one press.
        recasts: ${recasts},`
            : ''
        }
      },`
  : '';

const chargeBlock = isCharge
  ? `
      charge: { maxDurationMs: ${CONST('MAX_CHARGE_MS')}, releaseAtMax: true },`
  : '';

const targetingRequestBlock = isUnit
  ? `
  get targetingRequest(): Readonly<TargetingRequest> {
    return {
      range: this.range,
      // Without this the resolver defaults to 'ANY', whose candidate list
      // includes the caster — so a cursor on empty ground resolves ${champion}
      // onto ${champion}. Four spells have shipped that way.
      targetTeam: 'ENEMY',
      queryCandidates: () => this.game.objectManager.objects,
      isTargetable: candidate => is${slug}Target(candidate),
      getTargetInfo: candidate =>
        is${slug}Target(candidate)
          ? {
              position: candidate.position,
              teamId: candidate.teamId,
              selectionRadius: candidate.animatedValues?.displaySize
                ? candidate.animatedValues.displaySize / 2
                : candidate.collisionRadius,
            }
          : null,
    };
  }

  /** The game resolves the target before pressing; this covers every other caller. */
  press(context: CastContext): boolean {
    if (context.target !== undefined) return super.press(context);

    const result = api.combat.TargetResolver.resolve('UNIT', {
      ...context,
      casterTeamId: this.owner.teamId,
      ...this.targetingRequest,
    });
    return result.ok ? super.press(result.context) : false;
  }

  checkCastCondition(): boolean {
    return this.isValidTarget(this.castContext?.target);
  }
`
  : '';

const unitGuard = isUnit
  ? `
  private isValidTarget(target: unknown): target is AttackableUnit {
    return (
      is${slug}Target(target) &&
      target !== this.owner &&
      target.teamId !== this.owner.teamId &&
      api.combat.Vision.canSee(this.owner, target) &&
      api.combat.Reach.withinRange(this.range, this.owner, target)
    );
  }
`
  : '';

// A local closure inside the class factory, not a separate top-level export:
// it needs api.units.AttackableUnit as a value (instanceof), and this
// scaffold has no other caller for it yet — promote it to its own
// exported, memoized factory (see the pattern below) the moment a second
// file wants it.
const unitPredicateLocal = isUnit
  ? `
  const is${slug}Target = (target: unknown): target is AttackableUnit =>
    target instanceof api.units.AttackableUnit &&
    target.targetable &&
    !target.toRemove &&
    !target.isDead;
`
  : '';

/** The hooks the chosen activation actually reaches. */
let hooks;
if (isRecast) {
  hooks = `
  /** The first press. Nothing is fired here — that is \`onRecast\`. */
  onActivate(): void {
    if (this.active) return;
    this.active = true;
    // TODO: put the effect into the world.
  }

  /** Press ${recasts > 1 ? `2..${recasts + 1}` : '2'}. */
  onRecast(): void {
    if (!this.active) return;
    // TODO: the per-press payload. Aim with \`this.aimPoint\`, NOT the context
    // argument: the runtime hands \`onRecast\` the context of the *opening*
    // press, while \`aimPoint\` reads the live one.
  }

  onCancel(): void {
    this.endEffect();
  }

  /** Both the last recast and the window lapsing arrive here. */
  onComplete(): void {
    this.endEffect();
  }

  onRemoved(): void {
    this.endEffect();
    super.onRemoved();
  }

  deactivate(): void {
    this.endEffect();
    super.deactivate();
  }

  /** Idempotent: completion, cancellation, death and scene exit all converge here. */
  private endEffect(): void {
    this.active = false;
    // TODO: take the effect back out of the world.
  }
`;
} else if (isCharge) {
  hooks = `
  onChargeUpdate(_context: CastContext, _elapsedMs: number, ratio: number): void {
    this.charge = ratio;
  }

  /** The key came up. \`ratio\` at release is what the payload should scale on. */
  onRelease(context: CastContext): void {
    this.fire(context);
    this.charge = 0;
  }

  onCancel(): void {
    this.charge = 0;
  }
`;
} else {
  hooks = `
  onSpellCast(context: CastContext): void {
    this.fire(context);
  }
`;
}

const fireBody =
  isCharge || !isRecast
    ? `
  private fire(context: CastContext): void {${
    isUnit
      ? `
    const target = context.target ?? this.castContext?.target;
    if (!this.isValidTarget(target)) return;

    target.takeDamage(${CONST('DAMAGE')}, this.owner);
    this.game.objectManager.addObject(
      new ${slug}_Object(this.owner, target.position.x, target.position.y)
    );`
      : `
    const direction = this.firingDirection(context);
    const reach = api.combat.Reach.effectiveRange(this.range, this.owner);
    const toX = this.owner.position.x + direction.x * reach;
    const toY = this.owner.position.y + direction.y * reach;

    // TODO: deal the damage / apply the buff here.
    this.game.objectManager.addObject(new ${slug}_Object(this.owner, toX, toY));`
  }
  }
`
    : '';

const stateFields = [
  isRecast ? '  private active = false;' : null,
  isCharge ? '  private charge = 0;' : null,
]
  .filter(Boolean)
  .join('\n');

const spellSource = `${imports}

// A pack spell needs an instance type for a core class it never imports as a
// value — see docs/ADDING_SPELLS.md's "the factory shape" section.
type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;

// Tuning lives here as exported constants so a test imports them rather than
// hard-coding a number — retuning must never mean editing a test.
export const ${CONST('DAMAGE')} = 20;
export const ${CONST('RANGE')} = 400;${
  isRecast
    ? `
export const ${CONST('WINDOW_MS')} = 4_000;${
        recasts > 1
          ? `
export const ${CONST('RECAST_GAP_MS')} = 500;
export const ${CONST('RECASTS')} = ${recasts};`
          : ''
      }`
    : ''
}${
  isCharge
    ? `
export const ${CONST('MAX_CHARGE_MS')} = 1_000;`
    : ''
}

/**
 * Every pack spell factory is memoized: a bare \`return class ...\` here would
 * hand two independent callers (the real game's \`spellRegistry.ts\`, an e2e
 * script or a test building its own comparison value) two different,
 * \`instanceof\`-incompatible classes with the same name. Copy this shape
 * exactly — see \`packs/riot/spells/_EmptyExample.ts\`'s header for the full
 * reasoning. Do not "simplify" it back to a bare \`return class ...\`.
 */
function __build${slug}(api: ContentApi) {${unitPredicateLocal}
  const ${slug}_Object = make${slug}_Object(api);

  return class ${slug} extends api.Spell {
  image = api.asset('spell_${classPrefix.toLowerCase()}_${slot.toLowerCase()}');
  name = '${viName} (${slug})';
  description = \`TODO: describe what the player sees, with damage scaled to a ~100 health pool.\`;
  coolDown = 8_000;
  manaCost = 40;
  range = ${CONST('RANGE')};
${stateFields ? `\n${stateFields}\n` : ''}
  /**
   * Read **once**, on the first cast, and frozen for the rest of the match.
   * Build it from constants only — a value computed from live state here is the
   * opening press's answer forever. Vary a cooldown through
   * \`this.currentCooldown = this.reducedCooldown(n)\` instead.
   */
  get castSpec(): Readonly<CastSpec> {
    return {
      activation: '${activation}',
      targeting: '${targeting}',${chargeBlock}${activeBlock}
      resource: { commitAt: '${isUnit ? 'release' : 'start'}', refundOn: [${
        isUnit ? `'TARGET_INVALID', 'OUT_OF_RANGE'` : ''
      }] },
      cooldown: { startAt: '${isRecast ? 'end' : 'release'}', durationMs: this.coolDown },
      // One name from \`SpellForm\`: HELD (default) | AIMED | TETHERED | INDEPENDENT.
      // Ask where the live effect lives, not which interrupts feel right.
    };
  }
${targetingRequestBlock}${hooks}${fireBody}${unitGuard}
  drawPreview(): void {
    super.drawPreview(api.combat.Reach.effectiveRange(this.range, this.owner));
  }
  };
}
const __cache${slug} = new WeakMap<ContentApi, ReturnType<typeof __build${slug}>>();
export default function make${slug}(api: ContentApi) {
  const cached = __cache${slug}.get(api);
  if (cached) return cached;
  const built = __build${slug}(api);
  __cache${slug}.set(api, built);
  return built;
}

/**
 * TODO: the effect's own artwork. Read \`docs/VFX_STANDARD.md\` — a real windup,
 * the hit radius drawn at the radius the damage actually uses, the impact landed
 * on the victim, and as few layers as say it.
 */
function __build${slug}_Object(api: ContentApi) {
  return class ${slug}_Object extends api.SpellObject {
  lifeTime = 400;
  age = 0;
  radius = 60;

  constructor(owner: AttackableUnit, x: number, y: number) {
    super(owner);
    this.position = createVector(x, y);
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const opened = 1 - (1 - t) * (1 - t);
    const fade = 1 - t;

    push();
    noFill();
    stroke(255, 255, 255, 220 * fade);
    strokeWeight(2 * fade + 1);
    circle(this.position.x, this.position.y, this.radius * 2 * opened);
    pop();
  }

  /**
   * Mandatory whenever the draw paints past its own centre. The default derives
   * the box from \`visionRadius\`, which is 0 for a plain SpellObject — a
   * zero-area box, so the effect vanishes when its *centre* leaves the camera
   * while its damage lands normally.
   */
  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.radius + 24) * 2);
  }
  };
}
const __cache${slug}_Object = new WeakMap<ContentApi, ReturnType<typeof __build${slug}_Object>>();
export function make${slug}_Object(api: ContentApi) {
  const cached = __cache${slug}_Object.get(api);
  if (cached) return cached;
  const built = __build${slug}_Object(api);
  __cache${slug}_Object.set(api, built);
  return built;
}
`;

// ─── the test, wired to press() ───────────────────────────────────────────────

const pressCall = isCharge
  ? `    expect(pressSpell(spell, { at: { x: 300, y: 0 } })).toBe(true);
    vi.stubGlobal('deltaTime', ${CONST('MAX_CHARGE_MS')});
    spell.update();
    vi.stubGlobal('deltaTime', 16);`
  : `    expect(pressSpell(spell, { at: { x: 300, y: 0 }${
      isUnit ? ', target: victim' : ''
    } })).toBe(true);`;

const testSource = `import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined, placeholder: () => undefined },
}));

// Every pack spell's default export is a factory now (\`(api: ContentApi) =>
// SpellClass\`) — resolved once against the same cached ContentApi singleton
// the real game builds against.
import { buildContentApi } from '../../../src/content/ContentApi';
import make${slug}, { ${CONST('DAMAGE')} } from '../../../packs/riot/spells/${slug}';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import {
  createGame,
  createUnit,
  installSketchMathGlobals,
  installSpellObjectGlobals,
  pressSpell,
  type TestGame,
} from '../spell/fixtures';

const api = buildContentApi();
const ${slug} = make${slug}(api);

/**
 * Write the player-visible script first and make these the test names:
 * "press once and X happens", "an enemy in the area takes Y", "pressing it
 * again does Z". Then run them, watch them fail, and read the message.
 *
 * Everything here goes through \`pressSpell\`, never a lifecycle hook — a test
 * that calls \`onSpellCast()\` cannot see activation, cooldown, resource cost or
 * targeting rejection, and stays green against an ability that does not work.
 * \`spell-runtime-drive-seam.test.ts\` enforces that.
 */
describe('${slug}', () => {
  let game: TestGame;
  let owner: AttackableUnit;

  const unit = (x: number, teamId: string, pool = 100): AttackableUnit => {
    const created = createUnit(game, x, teamId);
    created.collisionRadius = 1;
    created.stats.mana.baseValue = 100;
    created.stats.maxMana.baseValue = 100;
    created.stats.health.baseValue = pool;
    created.stats.maxHealth.baseValue = pool;
    created.stats.healthRegen.baseValue = 0;
    created.stats.manaRegen.baseValue = 0;
    created.animatedValues.displaySize = 20;
    return created;
  };

  beforeEach(() => {
    installSpellObjectGlobals();
    installSketchMathGlobals();
    vi.stubGlobal('deltaTime', 16);
    game = createGame();
    owner = unit(0, 'blue');
    game.setPlayer(owner);
    game.objectManager.addObject(owner);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('lands its payload on an enemy', () => {
    const victim = unit(300, 'red');
    game.objectManager.addObject(victim);
    game.objectManager.update();

    const spell = new ${slug}(owner);
${pressCall}

    // TODO: drive the world forward if the payload travels, then assert on it.
    expect(victim.stats.health.value).toBe(100 - ${CONST('DAMAGE')});
  });

  it('charges its cost and starts its cooldown exactly once', () => {
    const victim = unit(300, 'red');
    game.objectManager.addObject(victim);
    game.objectManager.update();

    const spell = new ${slug}(owner);
${pressCall}

    expect(owner.stats.mana.value).toBe(100 - spell.manaCost);
    expect(spell.currentCooldown).toBeGreaterThan(0);
  });

  it('refuses the cast when it cannot be paid for', () => {
    const victim = unit(300, 'red');
    game.objectManager.addObject(victim);
    game.objectManager.update();
    owner.stats.mana.baseValue = 0;

    const spell = new ${slug}(owner);
    expect(pressSpell(spell, { at: { x: 300, y: 0 }${isUnit ? ', target: victim' : ''} })).toBe(
      false
    );
    expect(victim.stats.health.value).toBe(100);
  });
});
`;

// ─── registration ─────────────────────────────────────────────────────────────

function registerInBarrel() {
  const source = readFileSync(INDEX_FILE, 'utf8');
  const line = `export { default as ${slug} } from './${slug}';`;
  if (source.includes(line)) return 'already exported';

  const lines = source.split('\n');
  // Keep the champion's slots together and in Q/W/E/R order.
  const mine = lines
    .map((text, index) => ({ text, index }))
    .filter(entry =>
      new RegExp(`export \\{ default as ${classPrefix}_[QWER] \\}`).test(entry.text)
    );

  if (mine.length === 0) {
    return `no ${classPrefix}_* exports found — add \`${line}\` to spells/index.ts by hand`;
  }

  const order = SLOTS.indexOf(slot);
  let at = mine[mine.length - 1].index + 1;
  for (const entry of mine) {
    const theirs = SLOTS.indexOf(entry.text.match(/_([QWER]) \}/)[1]);
    if (theirs > order) {
      at = entry.index;
      break;
    }
  }
  lines.splice(at, 0, line);
  writeFileSync(INDEX_FILE, lines.join('\n'));
  return 'exported from spells/index.ts';
}

/**
 * A champion's kit lives in the riot pack's own roster (\`packs/riot/data.ts\`)
 * now, not \`preset.ts\` — that changed before batch 4, see \`preset.ts\`'s own
 * "Stage 4" header comment. Batch 4 task 7 moved the roster itself out of
 * \`config/spellCatalog.ts\` (where it was called \`CHAMPION_KITS\`) and into
 * the pack, real content rather than a table core kept for an adapter to
 * read. \`spells: [...]\` there holds bare id strings (\`'Ahri_Q'\`), not
 * \`AllSpells.Ahri_Q\` class references.
 */
function registerInChampionKit() {
  const source = readFileSync(CATALOG_FILE, 'utf8');
  if (new RegExp(`spells:\\s*\\[[^\\]]*'${slug}'`).test(source)) {
    return 'already in the roster';
  }

  const block = new RegExp(
    `(name: '${champion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}',[\s\S]*?spells: \[)([^\]]*)(\])`
  );
  const found = source.match(block);
  if (!found) {
    return `no '${champion}' entry in the roster (packs/riot/data.ts) — add '${slug}' to its spells: [] by hand`;
  }

  const existing = found[2]
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean);
  existing.push(`'${slug}'`);
  // Each entry is a quoted id ('Ahri_Q') — the slot letter is the character
  // before the closing quote, not the last character of the entry.
  existing.sort((a, b) => SLOTS.indexOf(a.slice(-2, -1)) - SLOTS.indexOf(b.slice(-2, -1)));

  writeFileSync(CATALOG_FILE, source.replace(block, `$1${existing.join(', ')}$3`));
  return "added to the champion's roster entry";
}

// ─── write ────────────────────────────────────────────────────────────────────

writeFileSync(spellFile, spellSource);
const testExisted = existsSync(testFile);
if (!testExisted) writeFileSync(testFile, testSource);

const barrel = registerInBarrel();
const kit = registerInChampionKit();

console.log(`
  ${slug} — ${activation} / ${targeting}${recasts > 1 ? ` / ${recasts} recasts` : ''}

    spell    packs/riot/spells/${slug}.ts
    test     ${testExisted ? `tests/game/spells/${slug}.test.ts (kept — already existed)` : `tests/game/spells/${slug}.test.ts`}
    barrel   ${barrel}
    kit      ${kit}

  Next, in this order:

    1. Write the player-visible script into the test names — "press once and X",
       "an enemy standing in it takes Y" — before touching the spell body. If you
       cannot state it in one line per press, the design is not decided yet.
    2. Run the test and READ the failure. A test that has never failed has not
       been shown to test anything.
    3. Fill in the spell. Add the art last, against docs/VFX_STANDARD.md.
    4. Add an entry to tests/e2e/shoot-new-champion-vfx.mjs and look at it:
         LOL2D_CHROME_CHANNEL= node tests/e2e/shoot-new-champion-vfx.mjs /tmp/vfx ${champion}
    5. npm run verify
`);
