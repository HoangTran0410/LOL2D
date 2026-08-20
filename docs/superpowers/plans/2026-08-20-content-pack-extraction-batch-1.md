# Content Pack Extraction — Batch 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the engine a content-pack seam and one working pack, without moving any Riot content yet.

**Architecture:** Three couplings that make core depend on content are removed first (`BasicAttack` and `Recall` become core mechanics, Baron stops being the default camp, two core buffs stop borrowing content icons). Then `src/content/` defines the pack contract — a factory that receives an injected `ContentApi` — and `packs/reference/` is a small self-authored pack that proves the contract carries a real champion. Riot content stays exactly where it is; batch 2 migrates it.

**Tech Stack:** TypeScript, Vite, Vitest (`environment: 'node'`, no DOM), p5.js in global mode.

**Spec:** `docs/superpowers/specs/2026-08-20-content-pack-extraction-design.md`

## Global Constraints

- **No new runtime dependency.** Validation is hand-written. The repo has no zod/ajv and is not gaining one.
- **`npm run verify` is the gate** and must be green at every commit. Cheap form: `npm run verify 2>&1 | grep -E "Tests |Test Files |error|FAIL"`.
- **Prettier**: 2 spaces, single quotes, 100 columns. Several pre-existing files fail `--check` on `main`; never run `--write` across unrelated files.
- **p5 global mode**: never name a local `pop`, `text`, `fill`, `line`, `point`, `random`, `map`, `scale`, `rotate`, `image`, `color` — shadowing an ambient global is legal TypeScript and fails only at runtime.
- **`Array.prototype.filter` cannot narrow types** (polyfilled in `src/main.ts`). Write a plain loop, never a cast.
- **Every test must be shown to fail first.** Write it, run it, read the message.
- **Commit with explicit paths.** Never `git add -A`, never `.`, never a bare `git commit` — other agents share this working tree.
- **Do not push.** This batch is local-only.
- The shared config panel (`src/game/hud/config/`) must not import a `src/game/` runtime value; `MatchDirectorSource.ts` is the single exempt file. `src/content/` is core and is **not** exempt from that rule — the panel must not import it either.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `src/game/gameObject/coreSpells/BasicAttack.ts` | moved from `spells/` — the attack every champion has |
| `src/game/gameObject/coreSpells/Recall.ts` | moved from `spells/` — the way home every champion has |
| `src/game/gameObject/coreSpells/index.ts` | barrel, second input to the catalogue generator |
| `assets/images/buffs/chill.png` | generic frost mark, replaces `spell_anivia_e` on `Chilled` |
| `assets/images/buffs/haste.png` | generic haste mark, replaces `spell_ghost` on `Speedup` |
| `src/content/ContentPack.ts` | pack contract: manifest, factory signature, section types |
| `src/content/validate.ts` | runtime validation at the boundary |
| `src/content/ContentApi.ts` | the injected object, and the one place core assembles it |
| `src/content/PackRegistry.ts` | installed packs, qualified ids, merged view |
| `src/content/install.ts` | Stage-1 static loader — **the only file batch 2's runtime loader replaces** |
| `packs/reference/pack.ts` | the reference pack factory |
| `packs/reference/spells/*.ts` | its four abilities |
| `tests/content/*.test.ts` | contract, validation, registry, boundary scan |

**Modified:**

| File | Change |
|---|---|
| `src/game/gameObject/attackableUnits/Champion.ts:21` | import `Recall` from `coreSpells/` |
| `src/game/preset.ts:28` | import `BasicAttack` from `coreSpells/` |
| `src/game/gameObject/spells/index.ts` | drop the two moved entries |
| `scripts/generate-spell-catalog.mjs:54,112,206` | load both barrels, merge |
| `vite.config.ts:296-298` | delete the now-unreachable path exemption |
| `src/game/gameObject/attackableUnits/Monster.ts:85-94` | `DEFAULT_PRESET` stops being Baron |
| `src/game/gameObject/buffs/Chilled.ts:17` | `buff_chill` |
| `src/game/gameObject/buffs/Speedup.ts:16` | `buff_haste` |
| `tests/game/spells/dash-onupdate-seam.test.ts` and 3 sibling scans | also scan `coreSpells/` |

---

## Task 1: Core spells leave the content directory

`Champion.ts:21` imports `spells/Recall` and holds `readonly recall: Recall = new Recall(this)` at `:137`. Core cannot compile without that file, and it is a cycle straight across the boundary batch 2 will draw. `preset.ts:59` uses `BasicAttack` as the fallback for any unresolved slot. Both are mechanics every pack presupposes, so they belong to core.

**Files:**
- Create: `src/game/gameObject/coreSpells/BasicAttack.ts` (git mv), `src/game/gameObject/coreSpells/Recall.ts` (git mv), `src/game/gameObject/coreSpells/index.ts`
- Modify: `src/game/gameObject/attackableUnits/Champion.ts:21`, `src/game/preset.ts:28`, `src/game/gameObject/spells/index.ts`, `scripts/generate-spell-catalog.mjs`, `vite.config.ts:296-298`
- Test: `tests/content/coreSpells.test.ts`, plus re-pointing `tests/game/spells/Recall.test.ts:16`, `tests/game/spells/BasicAttack.test.ts`, `tests/game/ai/BotBrain.recover.test.ts:8`

**Interfaces:**
- Consumes: nothing.
- Produces: `src/game/gameObject/coreSpells/index.ts` exporting `{ BasicAttack, Recall }`; `BASIC_ATTACK_ID` keeps its value `'BasicAttack'` and its catalogue entry.

- [ ] **Step 1: Write the failing test**

`tests/content/coreSpells.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Core must not import out of the content directory.
 *
 * `Champion.ts` held `readonly recall = new Recall(this)` against
 * `spells/Recall`, so the engine could not compile without one content file,
 * and `preset.ts` used `spells/BasicAttack` as its universal slot fallback.
 * Both are mechanics every pack presupposes rather than content a pack
 * supplies, so they live in `coreSpells/`.
 *
 * A source scan because the failure is an import edge: it is legal
 * TypeScript, it compiles, and it only becomes visible when the content
 * directory is extracted and the engine stops building.
 */
const SRC = join(__dirname, '../../src');

const read = (relative: string): string => readFileSync(join(SRC, relative), 'utf8');

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('core does not import content', () => {
  it.each([
    'game/gameObject/attackableUnits/Champion.ts',
    'game/preset.ts',
  ])('%s does not import from gameObject/spells', file => {
    expect(stripComments(read(file))).not.toMatch(/from '[^']*gameObject\/spells\//);
  });

  it('Champion still has a recall, from coreSpells', () => {
    const source = stripComments(read('game/gameObject/attackableUnits/Champion.ts'));
    expect(source).toMatch(/from '@\/game\/gameObject\/coreSpells\/Recall'/);
    expect(source).toMatch(/readonly recall/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/content/coreSpells.test.ts`
Expected: FAIL — the first two cases fail because both files still match `gameObject/spells/`, and the third fails on the `coreSpells/Recall` specifier.

- [ ] **Step 3: Move the two files**

```bash
mkdir -p src/game/gameObject/coreSpells
git mv src/game/gameObject/spells/BasicAttack.ts src/game/gameObject/coreSpells/BasicAttack.ts
git mv src/game/gameObject/spells/Recall.ts src/game/gameObject/coreSpells/Recall.ts
```

Create `src/game/gameObject/coreSpells/index.ts`:

```ts
/**
 * The spells core itself constructs.
 *
 * Not a shorter list of content — a different kind of thing. Every pack
 * presupposes that a champion can swing and can go home, and `Champion.ts`
 * builds `recall` in a field initialiser while `preset.ts` falls back to
 * `BasicAttack` for any slot it cannot resolve. Leaving them under `spells/`
 * meant the engine imported out of the directory that is about to become a
 * separate repository.
 *
 * `scripts/generate-spell-catalog.mjs` reads this barrel alongside the content
 * one, so both still appear in the picker and keep their ids.
 */
export { default as BasicAttack } from './BasicAttack';
export { default as Recall } from './Recall';
```

- [ ] **Step 4: Re-point every importer**

`src/game/gameObject/attackableUnits/Champion.ts:21`:

```ts
import Recall from '@/game/gameObject/coreSpells/Recall';
```

`src/game/preset.ts:28`:

```ts
import BasicAttack from './gameObject/coreSpells/BasicAttack';
```

In `src/game/gameObject/spells/index.ts`, delete the `BasicAttack` and `Recall` export lines.

In `tests/game/spells/Recall.test.ts:16` and `tests/game/ai/BotBrain.recover.test.ts:8`, change `gameObject/spells/Recall` to `gameObject/coreSpells/Recall`. In `tests/game/spells/BasicAttack.test.ts`, change `gameObject/spells/BasicAttack` to `gameObject/coreSpells/BasicAttack`. Then `git mv tests/game/spells/Recall.test.ts tests/content/Recall.test.ts` and `git mv tests/game/spells/BasicAttack.test.ts tests/content/BasicAttack.test.ts`, fixing their now-shallower relative paths (`../../../src` becomes `../../src`).

- [ ] **Step 5: Teach the catalogue generator about the second barrel**

`scripts/generate-spell-catalog.mjs` loads one barrel at `:54` and `:112`. Add the core barrel beside it and merge, so `BasicAttack` keeps its catalogue entry and the `'Đánh Thường'` shelf keeps working.

At `:54`, beside `barrelPath`:

```js
const coreBarrelPath = resolve(root, 'src/game/gameObject/coreSpells/index.ts');
```

At `:112`, replace the single `ssrLoadModule` with both, merged content-last so a content id can never shadow a core one:

```js
  const CoreSpells = await server.ssrLoadModule('/src/game/gameObject/coreSpells/index.ts');
  const ContentSpells = await server.ssrLoadModule('/src/game/gameObject/spells/index.ts');
  const AllSpells = { ...ContentSpells, ...CoreSpells };
```

At `:206`, the import path is derived from the barrel entry. Emit the core directory for ids that came from the core barrel:

```js
      const dir = coreIds.has(entry.id) ? 'coreSpells' : 'spells';
      return `  ${JSON.stringify(entry.id)}: () => import('@/game/gameObject/${dir}/${entry.path.slice(2)}'),`;
```

with `coreIds` built where the modules are loaded:

```js
  const coreIds = new Set(Object.keys(CoreSpells));
```

- [ ] **Step 6: Delete the vite exemption**

`vite.config.ts:296-298` skips chunking for `spells/BasicAttack.ts` and `spells/Recall.ts`. The regex on the next line only matches `src/game/gameObject/spells/`, so once the files live elsewhere the exemption can never fire. Replace:

```ts
          const spell =
            id.includes('spells/BasicAttack.ts') || id.includes('spells/Recall.ts')
              ? null
              : /src\/game\/gameObject\/spells\/([A-Za-z0-9]+?)(?:_[QWER][0-9]*)?\.ts$/.exec(id);
```

with:

```ts
          // `coreSpells/` is core and falls through to the `game` chunk below;
          // only the content directory is chunked per champion.
          const spell =
            /src\/game\/gameObject\/spells\/([A-Za-z0-9]+?)(?:_[QWER][0-9]*)?\.ts$/.exec(id);
```

- [ ] **Step 7: Widen the four seam scans to cover core spells**

`coreSpells/` left the scanned population but did not stop being spells. In `tests/game/spells/dash-onupdate-seam.test.ts`, `mana-spend-seam.test.ts`, `castspec-frozen-seam.test.ts` and `target-vision-seam.test.ts`, add the directory beside `SPELLS_DIR`:

```ts
const CORE_SPELLS_DIR = join(__dirname, '../../../src/game/gameObject/coreSpells');
```

and include its `tsFilesIn(...)` output in whatever list each test already iterates, skipping `index.ts`.

- [ ] **Step 8: Regenerate and verify**

Run: `npm run catalog:generate && npx vitest run tests/content/ tests/game/spells/ && npm run verify 2>&1 | grep -E "Tests |Test Files |error|FAIL"`
Expected: `tests/content/coreSpells.test.ts` PASS, catalogue check clean, full verify green with the same test count as before plus the new file's cases.

- [ ] **Step 9: Commit**

```bash
git add src/game/gameObject/coreSpells src/game/gameObject/spells/index.ts \
  src/game/gameObject/attackableUnits/Champion.ts src/game/preset.ts \
  src/generated/spellCatalog.ts src/generated/spellModules.ts \
  scripts/generate-spell-catalog.mjs vite.config.ts \
  tests/content tests/game/spells tests/game/ai/BotBrain.recover.test.ts
git commit -m "refactor(content): move BasicAttack and Recall into core

Champion held \`readonly recall = new Recall(this)\` against a file in the
content directory, so the engine could not compile without it — a cycle
across the boundary the pack extraction is about to draw, and the reason
GlobalShot's and Pet's dependency closures were 57 and 56 modules. Both
spells are mechanics every pack presupposes rather than content a pack
supplies."
```

---

## Task 2: Core buffs stop borrowing content icons

`Chilled.ts:17` resolves `'spell_anivia_e'` and `Speedup.ts:16` resolves `'spell_ghost'`. Both are generic mechanics in `buffs/`, which is otherwise entirely content-free — pull the content out and the two lose their HUD row, because `hudState.ts:188` skips any buff without an image.

**Files:**
- Create: `assets/images/buffs/chill.png`, `assets/images/buffs/haste.png`
- Modify: `src/game/gameObject/buffs/Chilled.ts:17`, `src/game/gameObject/buffs/Speedup.ts:16`
- Test: `tests/content/buffIcons.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: asset keys `buff_chill` and `buff_haste` in `src/generated/assetManifest.ts`.

- [ ] **Step 1: Write the failing test**

`tests/content/buffIcons.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A buff is a mechanic; its icon must come from core's own art.
 *
 * `Chilled` pointed at `spell_anivia_e` and `Speedup` at `spell_ghost` — two
 * content images. `buffs/` is otherwise entirely content-free, so those two
 * keys were the whole of the leak, and `hudState.ts:188` drops any buff whose
 * image is missing: extract the content and both silently lose their HUD row
 * rather than failing loudly.
 */
const BUFFS_DIR = join(__dirname, '../../src/game/gameObject/buffs');

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('core buff icons', () => {
  it('no buff resolves a champ_, spell_ or monster_ asset', () => {
    const offenders: string[] = [];
    for (const name of readdirSync(BUFFS_DIR)) {
      if (!name.endsWith('.ts')) continue;
      const source = stripComments(readFileSync(join(BUFFS_DIR, name), 'utf8'));
      const hit = source.match(/'(champ_|spell_|monster_)[A-Za-z0-9_]+'/);
      if (hit) offenders.push(`${name}: ${hit[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it('the population is not empty, or this scan proves nothing', () => {
    const files = readdirSync(BUFFS_DIR).filter(name => name.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/content/buffIcons.test.ts`
Expected: FAIL — `expected [ 'Chilled.ts: 'spell_anivia_e'', 'Speedup.ts: 'spell_ghost'' ] to deeply equal []`.

- [ ] **Step 3: Generate the two icons**

The existing set (`assets/images/buffs/`) is flat 32×32 marks of 692B–1.2KB. Write this throwaway script to the scratchpad — **not** into `scripts/`, it runs once — and run it:

```js
// /private/tmp/claude-501/-Users-hoangtran-Desktop-Github-LOL2D/97ce2ebd-72ef-4602-8bdd-4966b66074d7/scratchpad/make-buff-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = buf => {
  let c = 0xffffffff;
  for (const byte of buf) c = TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 0);
  return Buffer.concat([head, data, crcBuf]);
};
const png = (size, pixel) => {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      raw[o++] = r; raw[o++] = g; raw[o++] = b; raw[o++] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

const S = 32, C = 15.5;
// Chill: a six-point frost star.
const chill = (x, y) => {
  const dx = x - C, dy = y - C, d = Math.hypot(dx, dy);
  if (d > 15) return [0, 0, 0, 0];
  const a = Math.atan2(dy, dx);
  const spoke = Math.abs(Math.cos(3 * a));
  const on = d < 3 || (spoke > 0.93 && d < 15) || (spoke > 0.985 && d < 15);
  return on ? [176, 226, 255, 255] : [0, 0, 0, 0];
};
// Haste: three forward chevrons.
const haste = (x, y) => {
  const dy = Math.abs(y - C);
  for (const originX of [7, 15, 23]) {
    const edge = originX + dy * 0.85;
    if (x >= edge - 2.6 && x <= edge && dy < 11) return [255, 214, 120, 255];
  }
  return [0, 0, 0, 0];
};

writeFileSync('assets/images/buffs/chill.png', png(S, chill));
writeFileSync('assets/images/buffs/haste.png', png(S, haste));
console.log('written');
```

Run it from the repo root: `node /private/tmp/claude-501/-Users-hoangtran-Desktop-Github-LOL2D/97ce2ebd-72ef-4602-8bdd-4966b66074d7/scratchpad/make-buff-icons.mjs`

- [ ] **Step 4: Regenerate the manifest and point the buffs at them**

Run: `npm run assets:generate`

`src/game/gameObject/buffs/Chilled.ts:17`:

```ts
  image: Buff['image'] = AssetManager.get('buff_chill');
```

`src/game/gameObject/buffs/Speedup.ts:16`:

```ts
  image: Buff['image'] = AssetManager.get('buff_haste');
```

In `Chilled.ts`, the doc comment above still says it "keeps its own ability-art icon instead of a CC icon like `buff_slow`". Replace that sentence with: *"Not a crowd-control effect — no statusFlags — so it carries its own frost mark rather than a CC icon like `buff_slow`."*

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/content/buffIcons.test.ts && npm run verify 2>&1 | grep -E "Tests |Test Files |error|FAIL"`
Expected: PASS, and `assets:check` clean because the manifest was regenerated.

- [ ] **Step 6: Commit**

```bash
git add assets/images/buffs/chill.png assets/images/buffs/haste.png \
  src/generated/assetManifest.ts src/game/gameObject/buffs/Chilled.ts \
  src/game/gameObject/buffs/Speedup.ts tests/content/buffIcons.test.ts
git commit -m "fix(buffs): give Chilled and Speedup core icons

Both resolved a content image — spell_anivia_e and spell_ghost — while
buffs/ is otherwise entirely content-free. hudState drops a buff whose
image is missing, so extracting the content would have deleted two HUD
rows silently rather than failing."
```

---

## Task 3: Baron stops being the default camp

`Monster.ts:85-94` hard-codes Baron — name, avatar, Summoner's Rift coordinates — as `DEFAULT_PRESET` for a monster constructed without one. That is content sitting in an engine file, and the coordinates are meaningless on any other map.

**Files:**
- Modify: `src/game/gameObject/attackableUnits/Monster.ts:85-94`
- Test: `tests/content/monsterDefault.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `DEFAULT_PRESET` stays the same exported shape; only its values change.

- [ ] **Step 1: Write the failing test**

`tests/content/monsterDefault.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The engine's fallback camp must not be a named champion-grade monster.
 *
 * `DEFAULT_PRESET` was Baron: its name, its avatar and its Summoner's Rift
 * coordinates, in an engine file. Nothing chose it — it was the nearest camp
 * to hand when the default was needed — and on any other map those
 * coordinates are somewhere arbitrary.
 */
const source = readFileSync(
  join(__dirname, '../../src/game/gameObject/attackableUnits/Monster.ts'),
  'utf8'
);

const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('the default monster preset', () => {
  it('names no specific monster', () => {
    const body = stripComments(source);
    const preset = body.slice(body.indexOf('const DEFAULT_PRESET'));
    expect(preset.slice(0, 400)).not.toMatch(/Baron|monster_/);
  });

  it('sits at the origin rather than a map coordinate', () => {
    const body = stripComments(source);
    const preset = body.slice(body.indexOf('const DEFAULT_PRESET'));
    expect(preset.slice(0, 400)).toMatch(/camp:\s*\{\s*x:\s*0,\s*y:\s*0/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/content/monsterDefault.test.ts`
Expected: FAIL on both — the slice still contains `Baron` and `monster_Baron_Nashor`, and `camp` is `{ x: 2147, y: 1876, r: 100 }`.

- [ ] **Step 3: Replace the preset**

`src/game/gameObject/attackableUnits/Monster.ts:85-94`:

```ts
/**
 * What a camp is when nobody said. Deliberately anonymous and at the origin.
 *
 * This was Baron — its name, its art and its Summoner's Rift coordinates —
 * which made an engine file depend on one map's content and put any
 * preset-less monster in the middle of that map's river. Every real camp comes
 * from map data; this exists so the constructor has something total to fall
 * back on, and a caller that reaches it has a bug worth seeing.
 */
const DEFAULT_PRESET: MonsterPresetData = {
  name: 'Quái',
  avatar: null,
  camp: { x: 0, y: 0, r: 100 },
  speed: 0,
  size: 60,
  attackRange: 100,
  reviveTime: 3000,
  health: 300,
};
```

`MonsterPresetData.avatar` is declared `AssetKey` at `Monster.ts:36`, so the `avatar: null` above will not compile until it is widened. Change that line to:

```ts
  /** Null for the anonymous fallback camp; every real camp names its art. */
  avatar: AssetKey | null;
```

Then find the read — `grep -n "preset.avatar\|this.avatar" src/game/gameObject/attackableUnits/Monster.ts` — and guard it. If the read is inside a draw method, return early before any p5 call rather than passing null through:

```ts
    if (!this.preset.avatar) return;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/content/monsterDefault.test.ts tests/game/monsters/ && npm run verify 2>&1 | grep -E "Tests |Test Files |error|FAIL"`
Expected: PASS. `tests/game/monsters/` still passes because every case there supplies a real preset from `MonsterPreset`.

- [ ] **Step 5: Commit**

```bash
git add src/game/gameObject/attackableUnits/Monster.ts tests/content/monsterDefault.test.ts
git commit -m "refactor(monsters): the default camp is no longer Baron

DEFAULT_PRESET carried Baron's name, art and Summoner's Rift coordinates
in an engine file, so a preset-less monster landed in that map's river and
the engine named one map's content."
```

---

## Task 4: The pack contract and its validator

The types a pack is written against, and the runtime check that a loaded pack really matches them. They ship together because a type with no validator is a lie at the boundary: TypeScript types are erased, so nothing at runtime enforces them.

**Files:**
- Create: `src/content/ContentPack.ts`, `src/content/validate.ts`
- Test: `tests/content/validate.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type ContentPackFactory = (api: ContentApi) => ContentPack`
  - `interface PackManifest { id: string; version: string; coreRange: string; }`
  - `interface ChampionEntry { id: string; name: string; image: string | null; spells: string[]; }`
  - `interface MonsterDef { id: string; name: string; fills: string[]; health: number; }`
  - `interface ContentPack { manifest; spells?; champions?; monsters?; maps?; }`
  - `function validatePack(pack: unknown): { ok: true; pack: ContentPack } | { ok: false; errors: string[] }`

- [ ] **Step 1: Write the failing test**

`tests/content/validate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { validatePack } from '../../src/content/validate';

/**
 * Validation is the only thing standing at the boundary.
 *
 * A pack is authored in TypeScript, but types are erased at compile time, so
 * by the time core holds a pack object nothing has checked it. Stage 2 makes
 * that acute — the object will come from a URL — but it is already true of a
 * pack built from a different core version.
 *
 * The failure mode this exists to prevent is the silent one. `TerrainMap`
 * drops an unknown terrain layer without a word, and `MinionSpawner` returns
 * null for a team with fewer than two turrets and lets the whole wave fall
 * back into the fountain; both surface as a broken match minutes later
 * instead of a named error at load.
 */
const goodManifest = { id: 'ref', version: '1.0.0', coreRange: '^1' };

describe('validatePack', () => {
  it('accepts a minimal pack that declares only a manifest', () => {
    const result = validatePack({ manifest: goodManifest });
    expect(result.ok).toBe(true);
  });

  it('rejects a pack with no manifest', () => {
    const result = validatePack({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/manifest/);
  });

  it('rejects a pack id that is not a bare identifier', () => {
    // Ids are namespaced as `<packId>:<localId>`, so a colon in the pack id
    // makes the qualified id ambiguous.
    const result = validatePack({ manifest: { ...goodManifest, id: 'ref:extra' } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/id/);
  });

  it('names the champion whose spell id does not exist in the pack', () => {
    const result = validatePack({
      manifest: goodManifest,
      spells: { Alpha_Q: class {} },
      champions: [{ id: 'alpha', name: 'Alpha', image: null, spells: ['Alpha_Q', 'Alpha_W'] }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/Alpha_W/);
  });

  it('rejects a map whose lane names a faction it never declared', () => {
    const result = validatePack({
      manifest: goodManifest,
      maps: [
        {
          id: 'arena',
          size: 4000,
          terrain: { wall: [], bush: [], water: [] },
          factions: [{ id: 'blue' }],
          slots: { spawn: [], minion: [], structure: [], neutral: [] },
          lanes: [{ id: 'MID', from: 'blue', to: 'red', waypoints: [] }],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/red/);
  });

  it('rejects a structure slot whose kind is not core vocabulary', () => {
    // `role` on a neutral slot is a free string the packs agree on between
    // themselves; `kind` on a structure is core's own vocabulary, because
    // Turret and Fountain are core classes.
    const result = validatePack({
      manifest: goodManifest,
      maps: [
        {
          id: 'arena',
          size: 4000,
          terrain: { wall: [], bush: [], water: [] },
          factions: [{ id: 'blue' }],
          slots: {
            spawn: [],
            minion: [],
            structure: [{ faction: 'blue', kind: 'obelisk', x: 0, y: 0 }],
            neutral: [],
          },
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/obelisk/);
  });

  it('accepts a map with no lanes at all', () => {
    // A battle-royale map has none, and that must be a shape rather than an
    // error: no lanes means no minion waves, and BotBrain's PUSH posture —
    // the only one that needs a lane — falls through to ROAM.
    const result = validatePack({
      manifest: goodManifest,
      maps: [
        {
          id: 'forest',
          size: 4000,
          terrain: { wall: [], bush: [], water: [] },
          factions: [{ id: 'solo' }],
          slots: { spawn: [], minion: [], structure: [], neutral: [] },
        },
      ],
    });
    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/content/validate.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/content/validate"`.

- [ ] **Step 3: Write the types**

`src/content/ContentPack.ts`:

```ts
import type { ContentApi } from './ContentApi';

/**
 * What a content pack is, and why it is a function.
 *
 * A pack could have been a module of exports. It is a factory taking core's
 * API instead, because the alternative is a pack that bundles its own copy of
 * `Spell`, `SpellObject` and the buffs — and then there are two classes of
 * every name in the process. `instanceof` stops answering, `Z_INDEX_MAP` is
 * looked up by base-class identity so a pack's spell object matches no key and
 * falls to z-index 99 on top of every champion, and the buff registry exists
 * twice. One core, handed in.
 *
 * The same shape also loads at runtime, which is the whole point:
 *
 *     Stage 1  import factory from '@lol2d/content-riot'      -> factory(api)
 *     Stage 2  const { default: factory } = await import(url) -> factory(api)
 *
 * so batch 2 changes `install.ts` and nothing a pack author wrote.
 */
export type ContentPackFactory = (api: ContentApi) => ContentPack;

export interface PackManifest {
  /** A bare identifier. It becomes the prefix in every `<packId>:<localId>`. */
  id: string;
  version: string;
  /** Which core versions this pack was built against. */
  coreRange: string;
}

/** A spell class. Loose on purpose — `spellRegistry.SpellClass` is `any` too. */
export type SpellClass = new (...args: never[]) => unknown;

export interface ChampionEntry {
  id: string;
  name: string;
  /** Pack-relative asset key, or null for a champion with no portrait yet. */
  image: string | null;
  /** Local spell ids, in slot order. */
  spells: string[];
}

export interface MonsterDef {
  id: string;
  name: string;
  /** Slot roles this monster can occupy. Free strings; core only matches. */
  fills: string[];
  health: number;
}

export interface Faction {
  id: string;
}

export interface SpawnSlot {
  faction: string;
  x: number;
  y: number;
  r: number;
}

export interface MinionSlot {
  faction: string;
  lane: string;
  x: number;
  y: number;
}

/** Core's own vocabulary — `Turret` and `Fountain` are core classes. */
export type StructureKind = 'turret';

export interface StructureSlot {
  faction: string;
  kind: StructureKind;
  x: number;
  y: number;
}

export interface NeutralSlot {
  /** A free string a monster's `fills` matches. Core never interprets it. */
  role: string;
  x: number;
  y: number;
  r: number;
}

export interface LaneDefinition {
  id: string;
  from: string;
  to: string;
  waypoints: { x: number; y: number }[];
}

export interface MapDefinition {
  id: string;
  /** Square edge length in world units. */
  size: number;
  terrain: {
    wall: { x: number; y: number }[][];
    bush: { x: number; y: number }[][];
    water: { x: number; y: number }[][];
  };
  factions: Faction[];
  slots: {
    spawn: SpawnSlot[];
    minion: MinionSlot[];
    structure: StructureSlot[];
    neutral: NeutralSlot[];
  };
  /** Absent on a map with no lanes — no waves, and PUSH falls through. */
  lanes?: LaneDefinition[];
}

export interface ContentPack {
  manifest: PackManifest;
  spells?: Record<string, SpellClass>;
  champions?: ChampionEntry[];
  monsters?: Record<string, MonsterDef>;
  maps?: MapDefinition[];
}

export const STRUCTURE_KINDS: readonly StructureKind[] = Object.freeze(['turret']);
```

- [ ] **Step 4: Write the validator**

`src/content/validate.ts`:

```ts
import {
  STRUCTURE_KINDS,
  type ContentPack,
  type MapDefinition,
  type StructureKind,
} from './ContentPack';

/**
 * The boundary check, hand-written and dependency-free.
 *
 * Every rule here exists because the engine's own failure for it is silent.
 * `TerrainMap` drops a terrain layer it does not recognise without a word;
 * `MinionSpawner.musterPointFor` returns null for a team with fewer than two
 * turrets and the whole wave falls back into the fountain; a lane naming a
 * faction nobody declared walks minions to `undefined`. Each of those surfaces
 * as a broken match some minutes in. Named at load, they are a sentence.
 */
export type ValidationResult =
  | { ok: true; pack: ContentPack }
  | { ok: false; errors: string[] };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Bare identifier: the pack id becomes a prefix, so a colon is ambiguous. */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function checkManifest(value: unknown, errors: string[]): void {
  if (!isObject(value)) {
    errors.push('manifest: missing');
    return;
  }
  if (typeof value.id !== 'string' || !ID_PATTERN.test(value.id)) {
    errors.push(`manifest.id: must be a bare identifier, got ${JSON.stringify(value.id)}`);
  }
  if (typeof value.version !== 'string') errors.push('manifest.version: must be a string');
  if (typeof value.coreRange !== 'string') errors.push('manifest.coreRange: must be a string');
}

function checkChampions(pack: Record<string, unknown>, errors: string[]): void {
  if (pack.champions === undefined) return;
  if (!Array.isArray(pack.champions)) {
    errors.push('champions: must be an array');
    return;
  }
  const spells = isObject(pack.spells) ? pack.spells : {};
  for (const entry of pack.champions) {
    if (!isObject(entry) || typeof entry.id !== 'string') {
      errors.push('champions[]: each entry needs a string id');
      continue;
    }
    if (!Array.isArray(entry.spells)) {
      errors.push(`champions.${entry.id}.spells: must be an array`);
      continue;
    }
    for (const id of entry.spells) {
      if (typeof id !== 'string') {
        errors.push(`champions.${entry.id}.spells: ids must be strings`);
      } else if (!(id in spells)) {
        errors.push(`champions.${entry.id}: spell ${id} is not in this pack`);
      }
    }
  }
}

function checkMap(map: unknown, index: number, errors: string[]): void {
  const where = `maps[${index}]`;
  if (!isObject(map) || typeof map.id !== 'string') {
    errors.push(`${where}: needs a string id`);
    return;
  }
  const name = `maps.${map.id}`;
  if (!isFiniteNumber(map.size) || map.size <= 0) {
    errors.push(`${name}.size: must be a positive number`);
  }
  if (!isObject(map.terrain)) {
    errors.push(`${name}.terrain: missing`);
  } else {
    for (const layer of Object.keys(map.terrain)) {
      // TerrainMap only knows wall/bush/water and drops anything else in
      // silence. A pack that declares `lava` must be told, not ignored.
      if (layer !== 'wall' && layer !== 'bush' && layer !== 'water') {
        errors.push(`${name}.terrain: unknown layer ${layer}`);
      }
    }
  }

  const factions = new Set<string>();
  if (!Array.isArray(map.factions) || map.factions.length === 0) {
    errors.push(`${name}.factions: must list at least one faction`);
  } else {
    for (const faction of map.factions) {
      if (isObject(faction) && typeof faction.id === 'string') factions.add(faction.id);
      else errors.push(`${name}.factions[]: each faction needs a string id`);
    }
  }

  if (!isObject(map.slots)) {
    errors.push(`${name}.slots: missing`);
    return;
  }
  for (const group of ['spawn', 'minion', 'structure', 'neutral']) {
    if (!Array.isArray(map.slots[group])) errors.push(`${name}.slots.${group}: must be an array`);
  }

  const structures = Array.isArray(map.slots.structure) ? map.slots.structure : [];
  for (const slot of structures) {
    if (!isObject(slot)) continue;
    if (!STRUCTURE_KINDS.includes(slot.kind as StructureKind)) {
      errors.push(
        `${name}.slots.structure: unknown kind ${JSON.stringify(slot.kind)}; ` +
          `core provides ${STRUCTURE_KINDS.join(', ')}`
      );
    }
    if (typeof slot.faction === 'string' && !factions.has(slot.faction)) {
      errors.push(`${name}.slots.structure: faction ${slot.faction} was never declared`);
    }
  }

  for (const group of ['spawn', 'minion'] as const) {
    const slots = Array.isArray(map.slots[group]) ? map.slots[group] : [];
    for (const slot of slots) {
      if (isObject(slot) && typeof slot.faction === 'string' && !factions.has(slot.faction)) {
        errors.push(`${name}.slots.${group}: faction ${slot.faction} was never declared`);
      }
    }
  }

  // Absent lanes are a shape, not an omission: no waves, and BotBrain's PUSH
  // posture — the only rule that reads a lane — falls through to ROAM.
  if (map.lanes === undefined) return;
  if (!Array.isArray(map.lanes)) {
    errors.push(`${name}.lanes: must be an array when present`);
    return;
  }
  for (const lane of map.lanes) {
    if (!isObject(lane) || typeof lane.id !== 'string') {
      errors.push(`${name}.lanes[]: each lane needs a string id`);
      continue;
    }
    for (const end of ['from', 'to'] as const) {
      const faction = lane[end];
      if (typeof faction !== 'string' || !factions.has(faction)) {
        errors.push(`${name}.lanes.${lane.id}.${end}: faction ${String(faction)} was never declared`);
      }
    }
  }
}

export function validatePack(candidate: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObject(candidate)) {
    return { ok: false, errors: ['pack: must be an object'] };
  }

  checkManifest(candidate.manifest, errors);
  checkChampions(candidate, errors);

  if (candidate.maps !== undefined) {
    if (!Array.isArray(candidate.maps)) errors.push('maps: must be an array');
    else candidate.maps.forEach((map, index) => checkMap(map, index, errors));
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, pack: candidate as unknown as ContentPack };
}
```

`ContentApi` does not exist yet; `ContentPack.ts` imports it as a type. Create a one-line placeholder now and fill it in Task 5 — `src/content/ContentApi.ts`:

```ts
export interface ContentApi {}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/content/validate.test.ts`
Expected: PASS, 7 cases.

- [ ] **Step 6: Mutation-check two rules**

The `red` and `obelisk` cases both assert on a message. Temporarily delete the lane-faction loop, re-run, and confirm the `rejects a map whose lane names a faction it never declared` case fails; restore it. Do the same for the `STRUCTURE_KINDS.includes` check. A validator whose rules can be removed without a test noticing is not a validator.

- [ ] **Step 7: Commit**

```bash
git add src/content/ContentPack.ts src/content/validate.ts src/content/ContentApi.ts \
  tests/content/validate.test.ts
git commit -m "feat(content): the pack contract and its boundary validator

A pack is a factory taking core's API rather than a module of exports, so
there is exactly one copy of Spell, SpellObject and the buffs in the
process — two would break instanceof and drop every pack spell object to
z-index 99, since Z_INDEX_MAP is looked up by base-class identity.

Validation is hand-written because every rule it enforces has a silent
engine failure behind it: an unknown terrain layer is dropped without a
word, and a team with fewer than two turrets loses its whole wave into the
fountain."
```

---

## Task 5: `ContentApi` — what core hands a pack

**Files:**
- Modify: `src/content/ContentApi.ts` (replacing the Task 4 placeholder)
- Test: `tests/content/contentApi.test.ts`

**Interfaces:**
- Consumes: `ContentPack.ts` types.
- Produces: `interface ContentApi`, and `function buildContentApi(): ContentApi`.

- [ ] **Step 1: Write the failing test**

`tests/content/contentApi.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/managers/AssetManager', () => ({
  default: { get: (key: string) => ({ key, path: key, status: 'ready', data: null }) },
}));

import { buildContentApi } from '../../src/content/ContentApi';

/**
 * The API is what a pack may touch, and its size is a measured number.
 *
 * 241 spell files import 72 distinct core modules between them — 110 symbols,
 * not the ~40 the top of the import table suggests. Grouping them into
 * namespaces is what makes that a surface rather than a pile.
 *
 * The reassuring half is that the transitive closure stops at 87 modules and
 * reaches `Game`, `SceneManager` and every `.vue` file exactly zero times,
 * because `GameObject.game` is typed as a structural context rather than the
 * `Game` class. This test pins the namespaces so a future edit cannot quietly
 * widen the seam.
 */
describe('buildContentApi', () => {
  it('exposes exactly the agreed namespaces', () => {
    const api = buildContentApi() as unknown as Record<string, unknown>;
    const namespaces = ['units', 'buffs', 'combat', 'vfx', 'helpers', 'enums', 'terrain', 'utils'];
    for (const name of namespaces) {
      expect(api[name], `missing namespace ${name}`).toBeTypeOf('object');
    }
  });

  it('hands over the base classes a spell extends', () => {
    const api = buildContentApi() as unknown as Record<string, unknown>;
    for (const name of ['Spell', 'SpellObject', 'MissileSpellObject']) {
      expect(api[name], `missing base class ${name}`).toBeTypeOf('function');
    }
  });

  it('carries the 24 buffs as constructors, not as an interface', () => {
    // Slow is `new`-ed 64 times across the spell tree, Dash 51, StatAmp 33.
    // They are mechanics rather than content, so core keeps them and hands
    // over the constructors themselves.
    const api = buildContentApi();
    expect(Object.keys(api.buffs).length).toBeGreaterThanOrEqual(20);
    for (const [name, ctor] of Object.entries(api.buffs)) {
      expect(ctor, `buff ${name} is not constructible`).toBeTypeOf('function');
    }
  });

  it('resolves an asset by plain string, not by the generated union', () => {
    // Core keeps its typed AssetKey union; a pack's keys are strings it
    // declares in its own manifest and type-checks with its own generated
    // union. Type safety stops at the boundary, which is where runtime
    // validation takes over.
    const api = buildContentApi();
    expect(api.asset('anything_at_all')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/content/contentApi.test.ts`
Expected: FAIL — `buildContentApi is not a function`, since `ContentApi.ts` is still the empty placeholder.

- [ ] **Step 3: Write the API**

Replace `src/content/ContentApi.ts` entirely. Import the real modules from core and group them; the buff list is every file in `src/game/gameObject/buffs/` that has a default export.

```ts
import AssetManager, { type AssetHandle } from '@/managers/AssetManager';

import Spell from '@/game/gameObject/Spell';
import SpellObject from '@/game/gameObject/SpellObject';
import MissileSpellObject from '@/game/gameObject/MissileSpellObject';
import AreaSpellObject from '@/game/gameObject/spellObjects/AreaSpellObject';
import BeamSpellObject from '@/game/gameObject/spellObjects/BeamSpellObject';
import HomingMissileSpellObject from '@/game/gameObject/spellObjects/HomingMissileSpellObject';
import AoePulse from '@/game/gameObject/spellObjects/AoePulse';

import AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import Pet from '@/game/gameObject/attackableUnits/Pet';
import Monster from '@/game/gameObject/attackableUnits/Monster';

import Airborne from '@/game/gameObject/buffs/Airborne';
import Charm from '@/game/gameObject/buffs/Charm';
import Chilled from '@/game/gameObject/buffs/Chilled';
import DamageOverTime from '@/game/gameObject/buffs/DamageOverTime';
import DamageReflect from '@/game/gameObject/buffs/DamageReflect';
import Dash from '@/game/gameObject/buffs/Dash';
import Disarm from '@/game/gameObject/buffs/Disarm';
import Fear from '@/game/gameObject/buffs/Fear';
import Ground from '@/game/gameObject/buffs/Ground';
import Invisible from '@/game/gameObject/buffs/Invisible';
import Invulnerable from '@/game/gameObject/buffs/Invulnerable';
import Nearsight from '@/game/gameObject/buffs/Nearsight';
import Phasing from '@/game/gameObject/buffs/Phasing';
import Root from '@/game/gameObject/buffs/Root';
import Shield from '@/game/gameObject/buffs/Shield';
import Silence from '@/game/gameObject/buffs/Silence';
import Slow from '@/game/gameObject/buffs/Slow';
import Speedup from '@/game/gameObject/buffs/Speedup';
import Stasis from '@/game/gameObject/buffs/Stasis';
import StatAmp from '@/game/gameObject/buffs/StatAmp';
import Stun from '@/game/gameObject/buffs/Stun';
import Taunt from '@/game/gameObject/buffs/Taunt';
import Untargetable from '@/game/gameObject/buffs/Untargetable';
import Buff from '@/game/gameObject/Buff';

import * as Reach from '@/game/combat/Reach';
import * as Vision from '@/game/combat/Vision';
import * as ExecuteTargeting from '@/game/combat/ExecuteTargeting';
import * as AttackTargeting from '@/game/combat/AttackTargeting';
import * as GlobalShot from '@/game/combat/GlobalShot';
import * as TargetResolver from '@/game/spell/targeting/TargetResolver';

import CastBar from '@/game/vfx/CastBar';
import CastTelegraph from '@/game/vfx/CastTelegraph';
import ChargeRangeTelegraph from '@/game/vfx/ChargeRangeTelegraph';
import VfxGroup from '@/game/vfx/VfxGroup';

import ParticleSystem from '@/game/gameObject/helpers/ParticleSystem';
import TrailSystem from '@/game/gameObject/helpers/TrailSystem';
import CombatText from '@/game/gameObject/helpers/CombatText';

import ActionState from '@/game/enums/ActionState';
import BuffAddType from '@/game/enums/BuffAddType';
import EventType from '@/game/enums/EventType';
import StatusFlags from '@/game/enums/StatusFlags';

import { wallOutlinesInArea } from '@/game/gameObject/map/DynamicTerrain';
import TerrainField from '@/game/gameObject/map/TerrainField';

import VectorUtils from '@/utils/vector.utils';
import * as CollideUtils from '@/utils/collide.utils';
import * as Quadtree from '@/libs/quadtree';
import SAT from '@/libs/SAT';

/**
 * Everything a content pack is allowed to touch.
 *
 * The size is measured, not chosen: the 241 spell files import 72 distinct
 * core modules between them, 110 symbols in total. Eight namespaces is what
 * turns that into a surface someone can read.
 *
 * The reason this is achievable at all is that `GameObject.game` was already
 * typed as `GameObjectGameContext` — a structural interface, not the `Game`
 * class — so the transitive closure of everything here stops at 87 modules and
 * touches `Game`, `SceneManager` and every Vue component exactly zero times.
 * Half of this seam was built before anyone set out to build it.
 *
 * `asset` takes a plain string on purpose. Core keeps its generated `AssetKey`
 * union for its own art; a pack declares its keys in its own manifest and
 * type-checks them against its own generated union. Type safety does not
 * vanish, it stops at the boundary — which is exactly where `validate.ts`
 * takes over.
 */
export interface ContentApi {
  Spell: typeof Spell;
  SpellObject: typeof SpellObject;
  MissileSpellObject: typeof MissileSpellObject;
  AreaSpellObject: typeof AreaSpellObject;
  BeamSpellObject: typeof BeamSpellObject;
  HomingMissileSpellObject: typeof HomingMissileSpellObject;
  AoePulse: typeof AoePulse;

  units: { AttackableUnit: typeof AttackableUnit; Champion: typeof Champion; Pet: typeof Pet; Monster: typeof Monster };
  buffs: Record<string, unknown> & { Buff: typeof Buff; Slow: typeof Slow; Dash: typeof Dash };
  combat: typeof COMBAT;
  vfx: typeof VFX;
  helpers: typeof HELPERS;
  enums: typeof ENUMS;
  terrain: typeof TERRAIN;
  utils: typeof UTILS;

  asset(key: string): AssetHandle;
}

const COMBAT = Object.freeze({
  Reach,
  Vision,
  ExecuteTargeting,
  AttackTargeting,
  GlobalShot,
  TargetResolver,
});
const VFX = Object.freeze({ CastBar, CastTelegraph, ChargeRangeTelegraph, VfxGroup });
const HELPERS = Object.freeze({ ParticleSystem, TrailSystem, CombatText });
const ENUMS = Object.freeze({ ActionState, BuffAddType, EventType, StatusFlags });
const TERRAIN = Object.freeze({ wallOutlinesInArea, TerrainField });
const UTILS = Object.freeze({ VectorUtils, CollideUtils, Quadtree, SAT });

const BUFFS = Object.freeze({
  Buff,
  Airborne, Charm, Chilled, DamageOverTime, DamageReflect, Dash, Disarm, Fear,
  Ground, Invisible, Invulnerable, Nearsight, Phasing, Root, Shield, Silence,
  Slow, Speedup, Stasis, StatAmp, Stun, Taunt, Untargetable,
});

let cached: ContentApi | null = null;

/** Built once. Every pack in the process gets the same object identity. */
export function buildContentApi(): ContentApi {
  if (cached) return cached;
  cached = Object.freeze({
    Spell,
    SpellObject,
    MissileSpellObject,
    AreaSpellObject,
    BeamSpellObject,
    HomingMissileSpellObject,
    AoePulse,
    units: Object.freeze({ AttackableUnit, Champion, Pet, Monster }),
    buffs: BUFFS,
    combat: COMBAT,
    vfx: VFX,
    helpers: HELPERS,
    enums: ENUMS,
    terrain: TERRAIN,
    utils: UTILS,
    asset: (key: string) => AssetManager.get(key as never),
  }) as ContentApi;
  return cached;
}
```

If any import path above does not resolve, correct it against the real file rather than deleting the entry — every one of them appears in the measured import list.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/content/contentApi.test.ts && npm run typecheck:core 2>&1 | tail -5`
Expected: PASS, 4 cases; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/content/ContentApi.ts tests/content/contentApi.test.ts
git commit -m "feat(content): ContentApi, the surface a pack may touch

72 modules and 110 symbols, measured from what the 241 spell files
actually import, grouped into eight namespaces. The closure stops at 87
modules and reaches Game, SceneManager and Vue zero times, because
GameObject.game was already a structural context rather than the Game
class — half this seam existed before anyone set out to build it."
```

---

## Task 6: `PackRegistry` — qualified ids and the merged view

**Files:**
- Create: `src/content/PackRegistry.ts`
- Test: `tests/content/packRegistry.test.ts`

**Interfaces:**
- Consumes: `ContentPack`, `validatePack`.
- Produces: `class PackRegistry` with `install(pack: ContentPack): void`, `champions(): QualifiedChampion[]`, `spellClass(qualifiedId: string): SpellClass | null`, `maps(): QualifiedMap[]`, `monstersFilling(role: string): QualifiedMonster[]`, `qualify(packId: string, localId: string): string`, and `reset(): void`.

- [ ] **Step 1: Write the failing test**

`tests/content/packRegistry.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { PackRegistry } from '../../src/content/PackRegistry';
import type { ContentPack } from '../../src/content/ContentPack';

/**
 * Merging packs, and why ids carry their pack.
 *
 * Two packs may both call an ability `Fizz_E`; without a prefix the second
 * install silently replaces the first. Every id is `<packId>:<localId>`, the
 * author writes the local half, and the registry adds the rest.
 *
 * Maps are the one asymmetric section: champions from several packs are
 * concatenated, but a match has exactly one world, so maps are *listed* for
 * selection rather than merged.
 */
const pack = (id: string, extra: Partial<ContentPack> = {}): ContentPack =>
  ({
    manifest: { id, version: '1.0.0', coreRange: '^1' },
    ...extra,
  }) as ContentPack;

describe('PackRegistry', () => {
  let registry: PackRegistry;
  beforeEach(() => {
    registry = new PackRegistry();
  });

  it('prefixes every champion id with its pack', () => {
    registry.install(
      pack('ref', {
        spells: { Alpha_Q: class {} } as never,
        champions: [{ id: 'alpha', name: 'Alpha', image: null, spells: ['Alpha_Q'] }],
      })
    );
    expect(registry.champions()[0].id).toBe('ref:alpha');
    expect(registry.champions()[0].spells).toEqual(['ref:Alpha_Q']);
  });

  it('keeps two packs that use the same local id apart', () => {
    const A = class {};
    const B = class {};
    registry.install(pack('one', { spells: { Shared: A } as never }));
    registry.install(pack('two', { spells: { Shared: B } as never }));
    expect(registry.spellClass('one:Shared')).toBe(A);
    expect(registry.spellClass('two:Shared')).toBe(B);
  });

  it('returns null for an id no pack provides', () => {
    expect(registry.spellClass('missing:Nothing')).toBeNull();
  });

  it('concatenates champions across packs', () => {
    registry.install(
      pack('one', {
        spells: { Q: class {} } as never,
        champions: [{ id: 'a', name: 'A', image: null, spells: ['Q'] }],
      })
    );
    registry.install(
      pack('two', {
        spells: { Q: class {} } as never,
        champions: [{ id: 'b', name: 'B', image: null, spells: ['Q'] }],
      })
    );
    expect(registry.champions().map(c => c.id)).toEqual(['one:a', 'two:b']);
  });

  it('lists maps for selection rather than merging them', () => {
    // A match has many champions and exactly one world, so this section is a
    // choice, not a union — the asymmetry is deliberate.
    const map = (id: string) => ({
      id,
      size: 4000,
      terrain: { wall: [], bush: [], water: [] },
      factions: [{ id: 'solo' }],
      slots: { spawn: [], minion: [], structure: [], neutral: [] },
    });
    registry.install(pack('one', { maps: [map('arena')] as never }));
    registry.install(pack('two', { maps: [map('forest')] as never }));
    expect(registry.maps().map(m => m.id)).toEqual(['one:arena', 'two:forest']);
  });

  it('finds every monster that can fill a role, in install order', () => {
    registry.install(
      pack('one', {
        monsters: { big: { id: 'big', name: 'Big', fills: ['epic'], health: 1000 } } as never,
      })
    );
    registry.install(
      pack('two', {
        monsters: { huge: { id: 'huge', name: 'Huge', fills: ['epic'], health: 900 } } as never,
      })
    );
    expect(registry.monstersFilling('epic').map(m => m.id)).toEqual(['one:big', 'two:huge']);
    expect(registry.monstersFilling('buff')).toEqual([]);
  });

  it('refuses an invalid pack instead of half-installing it', () => {
    expect(() => registry.install({ manifest: { id: 'bad:id' } } as never)).toThrow(/id/);
    expect(registry.champions()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/content/packRegistry.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/content/PackRegistry"`.

- [ ] **Step 3: Write the registry**

`src/content/PackRegistry.ts`:

```ts
import { validatePack } from './validate';
import type { ChampionEntry, ContentPack, MapDefinition, MonsterDef, SpellClass } from './ContentPack';

/**
 * Installed packs, and the one view the rest of the engine reads.
 *
 * Ids are `<packId>:<localId>` because two packs may reasonably use the same
 * local name — an author writing `Fizz_E` should not have to know what anyone
 * else called theirs. The author writes the local half and never sees the
 * prefix; the registry is the only thing that joins them.
 *
 * The sections merge differently on purpose. Champions concatenate and spells
 * and monsters key by qualified id, so a second pack adds to the first. Maps
 * are *listed* — a match has many champions and exactly one world, so that
 * section is a choice made per match rather than a union.
 */
export interface QualifiedChampion extends Omit<ChampionEntry, 'id' | 'spells'> {
  id: string;
  packId: string;
  spells: string[];
}

export interface QualifiedMonster extends Omit<MonsterDef, 'id'> {
  id: string;
  packId: string;
}

export interface QualifiedMap extends Omit<MapDefinition, 'id'> {
  id: string;
  packId: string;
}

export const qualify = (packId: string, localId: string): string => `${packId}:${localId}`;

export class PackRegistry {
  private readonly packs: ContentPack[] = [];
  private readonly spells = new Map<string, SpellClass>();
  private readonly monsterList: QualifiedMonster[] = [];
  private readonly championList: QualifiedChampion[] = [];
  private readonly mapList: QualifiedMap[] = [];

  /**
   * Validate first, then write. A pack that fails leaves no trace — a
   * half-installed pack is worse than a refused one, because the failure
   * surfaces later and somewhere else.
   */
  install(pack: ContentPack): void {
    const result = validatePack(pack);
    if (!result.ok) {
      throw new Error(`content pack rejected:\n  ${result.errors.join('\n  ')}`);
    }
    const packId = pack.manifest.id;

    for (const [localId, spellClass] of Object.entries(pack.spells ?? {})) {
      this.spells.set(qualify(packId, localId), spellClass);
    }
    for (const entry of pack.champions ?? []) {
      this.championList.push({
        ...entry,
        packId,
        id: qualify(packId, entry.id),
        spells: entry.spells.map(localId => qualify(packId, localId)),
      });
    }
    for (const monster of Object.values(pack.monsters ?? {})) {
      this.monsterList.push({ ...monster, packId, id: qualify(packId, monster.id) });
    }
    for (const map of pack.maps ?? []) {
      this.mapList.push({ ...map, packId, id: qualify(packId, map.id) });
    }
    this.packs.push(pack);
  }

  champions(): readonly QualifiedChampion[] {
    return this.championList;
  }

  maps(): readonly QualifiedMap[] {
    return this.mapList;
  }

  spellClass(qualifiedId: string): SpellClass | null {
    return this.spells.get(qualifiedId) ?? null;
  }

  /**
   * Every monster that can occupy a slot with this role, in install order.
   *
   * A map slot names a role, never a monster, so a map author does not have to
   * know which monsters exist. Where several answer, install order decides and
   * the match config can override.
   */
  monstersFilling(role: string): readonly QualifiedMonster[] {
    const out: QualifiedMonster[] = [];
    for (const monster of this.monsterList) {
      if (monster.fills.includes(role)) out.push(monster);
    }
    return out;
  }

  reset(): void {
    this.packs.length = 0;
    this.championList.length = 0;
    this.monsterList.length = 0;
    this.mapList.length = 0;
    this.spells.clear();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/content/packRegistry.test.ts`
Expected: PASS, 7 cases.

- [ ] **Step 5: Commit**

```bash
git add src/content/PackRegistry.ts tests/content/packRegistry.test.ts
git commit -m "feat(content): PackRegistry — qualified ids and the merged view

Ids are <packId>:<localId> so two packs can both ship a Fizz_E. Champions
concatenate and spells key by qualified id; maps are listed rather than
merged, because a match has many champions and exactly one world."
```

---

## Task 7: `install.ts` and the reference pack

The loader and its first real consumer ship together: a loader with nothing to load proves nothing, and a pack written before there is an API to write it against is what bends the API around one consumer. This is the deliverable that makes core a playable game with content of its own.

**Files:**
- Create: `src/content/install.ts`, `packs/reference/pack.ts`, `packs/reference/spells/Vera_Q.ts`, `packs/reference/spells/Vera_W.ts`, `packs/reference/spells/Vera_E.ts`, `packs/reference/spells/Vera_R.ts`
- Test: `tests/content/install.test.ts`

**Interfaces:**
- Consumes: `buildContentApi`, `PackRegistry`, `ContentPackFactory`.
- Produces: `function installBundledPacks(registry: PackRegistry): void` and `const BUNDLED_PACKS: ContentPackFactory[]`.

- [ ] **Step 1: Write the failing test**

`tests/content/install.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/managers/AssetManager', () => ({
  default: { get: (key: string) => ({ key, path: key, status: 'ready', data: null }) },
}));

import { PackRegistry } from '../../src/content/PackRegistry';
import { installBundledPacks, BUNDLED_PACKS } from '../../src/content/install';

/**
 * The loader, and the one file batch 2 replaces.
 *
 * Stage 1 holds a static array of imported factories; Stage 2 will fetch a
 * bundle and `import(url)` it. Everything below this file is identical in both,
 * which is the entire reason the pack contract is a factory taking an API
 * rather than a module of exports.
 *
 * The reference pack is here because core has to be a complete game on its
 * own — it is the smoke test, the living documentation of `ContentApi`, and
 * the template someone copies to write their own.
 */
describe('installBundledPacks', () => {
  it('ships at least one pack, so core is playable with no content installed', () => {
    expect(BUNDLED_PACKS.length).toBeGreaterThan(0);
  });

  it('installs the reference pack and its champion', () => {
    const registry = new PackRegistry();
    installBundledPacks(registry);
    const ids = registry.champions().map(champion => champion.id);
    expect(ids).toContain('reference:vera');
  });

  it('every spell a bundled champion names resolves to a class', () => {
    // The failure this catches is a typo in a slot list, which is otherwise
    // invisible until someone picks that champion and the slot comes up empty.
    const registry = new PackRegistry();
    installBundledPacks(registry);
    for (const champion of registry.champions()) {
      for (const spellId of champion.spells) {
        expect(registry.spellClass(spellId), `${champion.id} -> ${spellId}`).toBeTypeOf('function');
      }
    }
  });

  it('hands every pack the same api object', () => {
    // Two copies of core in one process is the failure the factory shape
    // exists to prevent — `instanceof` stops answering and every pack spell
    // object misses its Z_INDEX_MAP key. Object identity is how that is
    // checked: each factory must receive the *same* api, not an equal one.
    const received: unknown[] = [];
    const spy = (factory: (api: never) => unknown) => (api: never) => {
      received.push(api);
      return factory(api);
    };
    const registry = new PackRegistry();
    const originals = [...BUNDLED_PACKS];
    BUNDLED_PACKS.splice(0, BUNDLED_PACKS.length, ...originals.map(spy as never));
    try {
      installBundledPacks(registry);
    } finally {
      BUNDLED_PACKS.splice(0, BUNDLED_PACKS.length, ...originals);
    }
    expect(received.length).toBe(originals.length);
    expect(new Set(received).size).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/content/install.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/content/install"`.

- [ ] **Step 3: Write one reference spell, to learn what the API is missing**

`packs/reference/spells/Vera_Q.ts`. Write it against the injected API only — no `@/` import may appear in this file.

```ts
import type { ContentApi } from '@/content/ContentApi';

/**
 * Vera's Q — a short straight bolt.
 *
 * The reference pack's job is to be the second consumer of `ContentApi`, so it
 * uses the base class, an asset, a buff and a particle system rather than the
 * smallest thing that would compile. An API shaped by exactly one consumer is
 * shaped *around* that consumer.
 *
 * Damage is scaled to the ~100 health pool the whole game is tuned against
 * (`docs/VFX_STANDARD.md`): abilities 15-35, ultimates 40-60.
 */
export const VERA_Q_DAMAGE = 22;
export const VERA_Q_RANGE = 420;
export const VERA_Q_SPEED = 12;
export const VERA_Q_COOLDOWN_MS = 6_000;
export const VERA_Q_MANA = 30;

export default function makeVeraQ(api: ContentApi) {
  /**
   * `MissileSpellObject` flies `position` -> `destination`, hits enemies it
   * overlaps, dies on arrival. A subclass normally overrides only `onHit`,
   * `draw` and the tuning fields.
   */
  class VeraQObject extends api.MissileSpellObject {
    speed = VERA_Q_SPEED;
    size = 16;
    damage = VERA_Q_DAMAGE;

    onHit(target: { takeDamage(amount: number, source: unknown): void }): void {
      target.takeDamage(this.damage, this.owner);
    }

    draw(): void {
      // Named for what it is in the effect, never for the quantity's generic
      // word: `fill`, `line`, `point` and `color` are p5 globals in this
      // project and a local of the same name silently shadows one.
      const bolt = this.position;
      push();
      noStroke();
      fill(120, 200, 255, 220);
      circle(bolt.x, bolt.y, this.size);
      fill(220, 245, 255, 160);
      circle(bolt.x, bolt.y, this.size * 0.5);
      pop();
    }
  }

  return class Vera_Q extends api.Spell {
    name = 'Tia Lam (Vera_Q)';
    image = api.asset('reference_vera_q');
    description =
      'Bắn một tia năng lượng thẳng, gây <span class="damage">22 sát thương</span> cho kẻ địch đầu tiên trúng.';
    // Milliseconds. `Spell.coolDown` is ms throughout — Malphite_Q is 8_000.
    coolDown = VERA_Q_COOLDOWN_MS;
    manaCost = VERA_Q_MANA;
    protected targetingMode = 'DIRECTION' as const;

    onSpellCast(context: { direction: { x: number; y: number } }): void {
      const shot = new VeraQObject(this.owner);
      // Never fall back to `context.direction` itself: it is (0,0) when the
      // cursor sits on the origin. `game.facing()` is the convention.
      const aim = this.owner.game.facing(this.owner, context.direction);
      shot.destination = this.owner.position
        .copy()
        .add(api.utils.VectorUtils.scale(aim, VERA_Q_RANGE));
      this.owner.game.objectManager.addObject(shot);
    }
  };
}
```

If `api.utils.VectorUtils` has no `scale`, use whatever the real module exports for "multiply this vector by a scalar" — check `src/utils/vector.utils.ts` and use the actual name. This is the first place the reference pack will find the API incomplete, and finding that is its job.

- [ ] **Step 4: Run the game's own seams against it**

Run: `npx vitest run tests/game/spells/castspec-frozen-seam.test.ts tests/game/spells/mana-spend-seam.test.ts`
Expected: PASS. If either scan does not reach `packs/`, that is correct for now — batch 2 exports them as re-pointable rules. Note in the commit message that the reference pack is not yet scanned.

- [ ] **Step 5: Write the other three spells and the pack factory**

Each of the three exercises a different corner of `ContentApi` on purpose — a buff, a dash, an area object — because a reference pack that only ever calls one part of the surface proves only that part.

`packs/reference/spells/Vera_W.ts`:

```ts
import type { ContentApi } from '@/content/ContentApi';

/** Vera's W — a self shield. Exercises `api.buffs` and a SELF cast. */
export const VERA_W_SHIELD = 30;
export const VERA_W_DURATION_MS = 3_000;
export const VERA_W_COOLDOWN_MS = 12_000;
export const VERA_W_MANA = 50;

export default function makeVeraW(api: ContentApi) {
  return class Vera_W extends api.Spell {
    name = 'Vỏ Sáng (Vera_W)';
    image = api.asset('reference_vera_w');
    description =
      'Tự khoác một <span class="buff">Lá Chắn 30</span> trong <span class="time">3 giây</span>.';
    coolDown = VERA_W_COOLDOWN_MS;
    manaCost = VERA_W_MANA;
    protected targetingMode = 'SELF' as const;

    onSpellCast(): void {
      const shield = new api.buffs.Shield(VERA_W_DURATION_MS, this.owner, this.owner);
      shield.amount = VERA_W_SHIELD;
      this.owner.addBuff(shield);
    }
  };
}
```

`packs/reference/spells/Vera_E.ts`:

```ts
import type { ContentApi } from '@/content/ContentApi';

/**
 * Vera's E — a short dash. Exercises `api.buffs.Dash`.
 *
 * The hook is `onDashUpdate`, never `onUpdate`. `Dash` puts the movement
 * itself in `Dash.prototype.onUpdate`, so an instance assignment replaces the
 * frame instead of hooking it and the champion plays the spell's logic
 * standing perfectly still. Camille E, Ekko E and Jarvan Q all shipped that
 * way unnoticed, because each still dealt its damage.
 */
export const VERA_E_DISTANCE = 260;
export const VERA_E_SPEED = 18;
export const VERA_E_COOLDOWN_MS = 10_000;
export const VERA_E_MANA = 40;

export default function makeVeraE(api: ContentApi) {
  return class Vera_E extends api.Spell {
    name = 'Bước Chớp (Vera_E)';
    image = api.asset('reference_vera_e');
    description = 'Lướt nhanh một đoạn ngắn theo hướng chỉ định.';
    coolDown = VERA_E_COOLDOWN_MS;
    manaCost = VERA_E_MANA;
    protected targetingMode = 'DIRECTION' as const;

    onSpellCast(context: { direction: { x: number; y: number } }): void {
      const aim = this.owner.game.facing(this.owner, context.direction);
      const landing = this.owner.position
        .copy()
        .add(api.utils.VectorUtils.scale(aim, VERA_E_DISTANCE));
      const dash = new api.buffs.Dash(this.owner, landing, VERA_E_SPEED);
      this.owner.addBuff(dash);
    }
  };
}
```

`packs/reference/spells/Vera_R.ts`:

```ts
import type { ContentApi } from '@/content/ContentApi';

/**
 * Vera's R — a ring that lands where it was aimed. Exercises `api.AoePulse`.
 *
 * 45 damage: ultimates are 40-60 against the ~100 health pool the whole game
 * is tuned to (`docs/VFX_STANDARD.md`). It hits each unit at most once.
 */
export const VERA_R_DAMAGE = 45;
export const VERA_R_RADIUS = 200;
export const VERA_R_RANGE = 500;
export const VERA_R_COOLDOWN_MS = 60_000;
export const VERA_R_MANA = 100;

export default function makeVeraR(api: ContentApi) {
  return class Vera_R extends api.Spell {
    name = 'Vòng Tận (Vera_R)';
    image = api.asset('reference_vera_r');
    description =
      'Gọi một vòng sáng tại vị trí chỉ định, gây <span class="damage">45 sát thương</span> cho mọi kẻ địch bên trong.';
    coolDown = VERA_R_COOLDOWN_MS;
    manaCost = VERA_R_MANA;
    protected targetingMode = 'POINT' as const;

    onSpellCast(context: { destination: { x: number; y: number } }): void {
      const pulse = new api.AoePulse(this.owner, {
        x: context.destination.x,
        y: context.destination.y,
        radius: VERA_R_RADIUS,
        damage: VERA_R_DAMAGE,
      });
      this.owner.game.objectManager.addObject(pulse);
    }
  };
}
```

`AoePulse` carries seven variants, each authored for one champion; read its real constructor in `src/game/gameObject/spellObjects/AoePulse.ts` and pass whichever variant is closest to a plain ring rather than inventing options it does not take.

**A `SpellObject` that paints past its own centre needs `getDisplayBoundingBox()`.** The default derives the box from `visionRadius`, which is 0 for a plain `SpellObject` — a zero-area box — so a 200px ring vanishes when its *centre* leaves the camera. If `AoePulse` does not already provide one, add it here; `tests/game/spells/aoe-display-bounds.test.ts` is the rule.

`packs/reference/pack.ts`:

```ts
import type { ContentApi } from '@/content/ContentApi';
import type { ContentPack } from '@/content/ContentPack';
import makeVeraQ from './spells/Vera_Q';
import makeVeraW from './spells/Vera_W';
import makeVeraE from './spells/Vera_E';
import makeVeraR from './spells/Vera_R';

/**
 * The pack core ships with, so core is a complete game holding no content
 * anyone else owns.
 *
 * It is three things at once and each one matters: the smoke test that the
 * seam works end to end, the living documentation an author reads to learn
 * `ContentApi`, and the second consumer that keeps the API from being shaped
 * around the Riot pack alone.
 *
 * Every id here is local. `PackRegistry` prefixes them with `reference:`.
 */
const referencePack = (api: ContentApi): ContentPack => ({
  manifest: { id: 'reference', version: '1.0.0', coreRange: '^1' },
  spells: {
    Vera_Q: makeVeraQ(api),
    Vera_W: makeVeraW(api),
    Vera_E: makeVeraE(api),
    Vera_R: makeVeraR(api),
  },
  champions: [
    {
      id: 'vera',
      name: 'Vera',
      image: null,
      spells: ['Vera_Q', 'Vera_W', 'Vera_E', 'Vera_R'],
    },
  ],
});

export default referencePack;
```

- [ ] **Step 6: Write the loader**

`src/content/install.ts`:

```ts
import { buildContentApi } from './ContentApi';
import type { ContentPackFactory } from './ContentPack';
import type { PackRegistry } from './PackRegistry';
import referencePack from '../../packs/reference/pack';

/**
 * Stage 1's loader, and the only file Stage 2 replaces.
 *
 * Here the factories are statically imported and the array is fixed. In Stage
 * 2 this becomes a fetch, an `import(blobUrl)` and a cache — and nothing below
 * it changes, because a pack is a factory taking core's API in both cases:
 *
 *     Stage 1  import factory from '@lol2d/content-riot'      -> factory(api)
 *     Stage 2  const { default: factory } = await import(url) -> factory(api)
 *
 * Keeping that one seam is what makes Stage 2 a change to this file rather
 * than a rewrite of every pack.
 */
export const BUNDLED_PACKS: ContentPackFactory[] = [referencePack];

/** Every pack gets the same api object, so there is one core in the process. */
export function installBundledPacks(registry: PackRegistry): void {
  const api = buildContentApi();
  for (const factory of BUNDLED_PACKS) {
    registry.install(factory(api));
  }
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/content/ && npm run verify 2>&1 | grep -E "Tests |Test Files |error|FAIL"`
Expected: PASS across `tests/content/`; full verify green.

- [ ] **Step 8: Commit**

```bash
git add src/content/install.ts packs/reference tests/content/install.test.ts
git commit -m "feat(content): the Stage-1 loader and a reference pack

install.ts is the one file Stage 2 replaces — its static array of imported
factories becomes a fetch and an import(url), and nothing below it moves,
because a pack is a factory taking core's API either way.

The reference pack is written before the API has to carry 241 spells, on
purpose: an API shaped by exactly one consumer is shaped around that
consumer. It also makes core a complete game holding no content anyone
else owns."
```

---

## Task 8: The boundary source scan

Ranh giới stays intact because a test says so, not because everyone remembers. This is the same idiom `tests/scenes/matchConfigChunk.test.ts` uses for the config panel's chunk rule, which is what has kept that boundary standing.

**Files:**
- Create: `tests/content/packBoundary.test.ts`
- Test: itself

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Write the test, and make it fail on purpose first**

`tests/content/packBoundary.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A pack may reach core through the injected API and nowhere else.
 *
 * This is the rule the whole extraction rests on. A pack that deep-imports
 * `@/game/gameObject/buffs/Slow` compiles and runs perfectly today and cannot
 * be extracted tomorrow — the failure is invisible until the directory moves
 * to another repository and every one of those specifiers stops resolving.
 *
 * A scan rather than a lint rule, for the same reason the other fifteen seams
 * in this repo are scans: it costs a millisecond, it closes the class rather
 * than an instance, and it is the shape of the mistake that `tsc` is happiest
 * to accept.
 *
 * `@/content/ContentApi` and `@/content/ContentPack` are the exceptions, and
 * they are type-only — the API arrives as an argument, never as an import.
 */
const PACKS_DIR = join(__dirname, '../../packs');

const ALLOWED = new Set(['@/content/ContentApi', '@/content/ContentPack']);

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...tsFilesUnder(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('the pack boundary', () => {
  const files = tsFilesUnder(PACKS_DIR);

  it('finds packs to scan, or this proves nothing', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('no pack file imports core outside the API', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = stripComments(readFileSync(file, 'utf8'));
      for (const match of source.matchAll(/from '(@\/[^']+)'/g)) {
        if (!ALLOWED.has(match[1])) offenders.push(`${file.slice(PACKS_DIR.length + 1)}: ${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no pack file imports core by relative path either', () => {
    // `../../src/...` is the same violation wearing a different specifier.
    const offenders: string[] = [];
    for (const file of files) {
      const source = stripComments(readFileSync(file, 'utf8'));
      for (const match of source.matchAll(/from '(\.\.[^']*)'/g)) {
        if (match[1].includes('/src/')) {
          offenders.push(`${file.slice(PACKS_DIR.length + 1)}: ${match[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Prove it can fail**

Temporarily add `import Slow from '@/game/gameObject/buffs/Slow';` to `packs/reference/spells/Vera_W.ts`.

Run: `npx vitest run tests/content/packBoundary.test.ts`
Expected: FAIL — `expected [ 'reference/spells/Vera_W.ts: @/game/gameObject/buffs/Slow' ] to deeply equal []`.

Remove the line and re-run. Expected: PASS.

- [ ] **Step 3: Add packs to the strict typecheck project**

`tsconfig.strict-core.json` does not mention `packs/`. Add it to the `include` array, after the `src/game/gameObject/buffs/**/*.ts` line, so a pack is type-checked as strictly as the code it calls into:

```json
    "packs/**/*.ts",
```

Note that this file's `include` also lists seven individual spells by path (`src/game/gameObject/spells/Lux_R.ts` and friends). Leave them; they move in batch 2 with the rest of the content.

Run: `npm run typecheck:core 2>&1 | tail -5`
Expected: clean. If `packs/` raises strict errors, fix the pack rather than removing the include — a pack author gets the strict compiler too.

- [ ] **Step 4: Full verify**

Run: `npm run verify 2>&1 | grep -E "Tests |Test Files |error|FAIL"`
Expected: green, with the new `tests/content/` files counted.

- [ ] **Step 5: Commit**

```bash
git add tests/content/packBoundary.test.ts tsconfig.strict-core.json
git commit -m "test(content): the pack boundary is enforced, not remembered

A pack that deep-imports @/game/gameObject/buffs/Slow compiles and runs
perfectly today and cannot be extracted tomorrow — the failure only
appears when the directory moves repositories and the specifier stops
resolving. Same idiom as matchConfigChunk, which is what has kept the
config panel's chunk boundary standing."
```

---

## Done when

- `npm run verify` is green.
- `tests/content/` holds the contract, validation, registry, API, loader and boundary tests, and each was shown to fail before its implementation existed.
- `src/game/` contains no import of `gameObject/spells/` from `Champion.ts` or `preset.ts`.
- `buffs/` resolves no `champ_`, `spell_` or `monster_` asset key.
- `packs/reference/` holds one playable champion written entirely against `ContentApi`.
- Nothing is pushed.

## Not in this batch

Migrating Riot content into `packs/riot/`, `MapDefinition` wiring into `TerrainMap`/`NavGrid`/`MinionSpawner`, removing `musterPointFor`, splitting `MonsterPreset` into slots and monsters, exporting the seams as re-pointable rules, and the reference map. Those are batch 2, and its plan should be written after this one lands — what batch 1 learns about `ContentApi` is what shapes it.

---

## Task 9: Recall is content, not a core mechanic

Task 1 moved `Recall` into `coreSpells/` on the grounds that going home is a mechanic every pack presupposes. That is wrong, and the user caught it: **recall presupposes a fountain, and a fountain is map content.** A battle-royale map — a forest where everyone farms and fights and the last one standing wins, which is explicitly in scope per the spec's §7 — has no fountain to return to. `BasicAttack` is genuinely universal; every unit in every conceivable pack can swing. `Recall` is not.

The fix is cheaper than it looks, because the defensive plumbing already exists: `Champion.ts:216,223` already call `this.recall?.update()` and `this.recall?.drawVfx()`; `Recall.ts:131-132` already degrades to `undefined` when no platform matches the team; and `Recall.ts:18-20` already declares a structural `TeamPlatform` so it never imports `Fountain`. The single thing asserting recall always exists is the field initialiser at `Champion.ts:137`.

**Files:**
- Move: `src/game/gameObject/coreSpells/Recall.ts` → `src/game/gameObject/spells/Recall.ts`
- Modify: `src/game/gameObject/coreSpells/index.ts`, `src/game/gameObject/attackableUnits/Champion.ts:137`, `src/game/preset.ts`, `scripts/generate-spell-catalog.mjs`, `src/content/ContentPack.ts`, `src/content/validate.ts`
- Test: `tests/content/recallIsContent.test.ts`, plus reverting four test files' `Recall` exclusions

**Interfaces:**
- Consumes: `ChampionEntry` from `src/content/ContentPack.ts`.
- Produces: `Champion.recall: Spell | null`; `ChampionEntry.recall?: string`. Batch 2 supplies the latter from a pack; batch 1 keeps the game working by having `preset.ts` set it, exactly as `preset.ts` already supplies `BasicAttack`.

- [ ] **Step 1: Write the failing test**

`tests/content/recallIsContent.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Recall is content, because it presupposes a fountain.
 *
 * It was briefly classified as a core mechanic alongside `BasicAttack`, on the
 * grounds that every pack presupposes a way home. Every pack does not: a map
 * with no spawn platform — a battle-royale forest, which the design explicitly
 * allows — has nowhere to recall to. `BasicAttack` is universal because every
 * unit can swing; `Recall` is a mechanic that only exists on maps that grant it.
 *
 * So `Champion` must not construct one. The class may hold a recall; it may not
 * assume it has one.
 */
const SRC = join(__dirname, '../../src');
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('recall is content', () => {
  it('Champion does not import or construct a Recall', () => {
    const source = stripComments(read('game/gameObject/attackableUnits/Champion.ts'));
    expect(source).not.toMatch(/new Recall\(/);
    expect(source).not.toMatch(/from '[^']*Recall'/);
  });

  it('Champion.recall is nullable, so a map without a fountain is expressible', () => {
    const source = stripComments(read('game/gameObject/attackableUnits/Champion.ts'));
    expect(source).toMatch(/recall\s*:\s*[^=;]*\|\s*null/);
  });

  it('the core spell barrel carries only the basic attack', () => {
    const source = stripComments(read('game/gameObject/coreSpells/index.ts'));
    expect(source).toMatch(/BasicAttack/);
    expect(source).not.toMatch(/Recall/);
  });

  it('a pack can declare a champion its way home', () => {
    const source = stripComments(read('content/ContentPack.ts'));
    expect(source).toMatch(/recall\?\s*:\s*string/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/content/recallIsContent.test.ts`
Expected: all four FAIL — `Champion.ts` still imports and constructs `Recall`, its field is non-nullable, the core barrel still exports `Recall`, and `ChampionEntry` has no `recall` field.

- [ ] **Step 3: Move the file back to content**

```bash
git mv src/game/gameObject/coreSpells/Recall.ts src/game/gameObject/spells/Recall.ts
```

**Do NOT add it to `src/game/gameObject/spells/index.ts`.** It was never in that barrel, which is exactly why it never appeared in the loadout picker: `scripts/generate-spell-catalog.mjs` builds the catalogue from the barrel. Leaving it out restores the pre-Task-1 state precisely.

In `src/game/gameObject/coreSpells/index.ts`, delete the `Recall` export line and adjust the doc comment — the barrel now carries one thing, the attack every unit has.

- [ ] **Step 4: Delete the machinery that existed only for Recall**

`scripts/generate-spell-catalog.mjs:70` holds `const CATALOG_HIDDEN_CORE_IDS = new Set(['Recall'])`, and line 131 filters the core barrel through it. Both exist solely because Task 1 put `Recall` into a barrel that feeds the catalogue. With `Recall` back in content and out of both barrels, delete the constant and the filter, and load `CoreSpells` directly.

Then find the four test files that hard-code a `Recall` exclusion — `tests/game/preset.catalog.test.ts`, `tests/game/spellRegistry.test.ts`, `tests/game/config/spellCatalog.test.ts`, `tests/game/spells/cancel-policy.test.ts` — and revert each exclusion. They were added in Task 1 for the same reason and are now describing a situation that no longer exists. If any of them fails after reverting, that is information: report it rather than re-adding the exclusion.

- [ ] **Step 5: Make `Champion.recall` a field the class does not fill**

`src/game/gameObject/attackableUnits/Champion.ts:137` currently reads:

```ts
  readonly recall: Recall = new Recall(this);
```

Replace the field and its doc comment with:

```ts
  /**
   * This champion's way home, or null on a map that grants none.
   *
   * Not built here. Recall needs a fountain to return to, and a fountain is
   * something a map supplies — a battle-royale map has none, and on one the
   * `B` key and the touch button do nothing rather than doing something
   * meaningless. `preset.ts` fills this in today; a content pack declares it
   * per champion (`ChampionEntry.recall`) once the boot path reads packs.
   */
  recall: Spell | null = null;
```

Drop the `Recall` import. Keep `this.recall?.update()` and `this.recall?.drawVfx()` — they already handle absence. Check `Champion.ts:271`'s `this.removeSpell(this.recall)` and guard it if it cannot take null.

- [ ] **Step 6: Have `preset.ts` supply it, so the game keeps working**

`preset.ts` already imports `BasicAttack` and uses it as the universal slot fallback; it is the layer where content decisions are made. Give it the same job for recall: import `Recall` from `@/game/gameObject/spells/Recall` and set `champion.recall = new Recall(champion)` wherever a champion is finished being built.

Find the right seam by reading how `preset.ts` and `Champion`'s constructor actually cooperate — `presetFromPlan` / `getChampionPresetFromLoadout` are the likely places. The requirement is behavioural: **pressing `B` in a normal match must work exactly as it does today**, and `npm run e2e` must not regress. If the only honest seam is inside `Champion`'s constructor taking an optional recall factory in its options, that is acceptable — what must not survive is the class hard-coding which spell it is.

- [ ] **Step 7: Add `recall` to the pack contract**

In `src/content/ContentPack.ts`, extend `ChampionEntry`:

```ts
export interface ChampionEntry {
  id: string;
  name: string;
  image: string | null;
  spells: string[];
  /** Local id of this champion's way home. Absent on a map that grants none. */
  recall?: string;
}
```

In `src/content/validate.ts`, `checkChampions` already verifies every id in `spells` is declared by the pack. Give `recall` the same treatment: if present it must be a string naming a spell the pack declares. Add a test case in `tests/content/validate.test.ts` for a champion whose `recall` names a spell that does not exist, and show it failing first.

In `src/content/PackRegistry.ts`, qualify it like the others — `QualifiedChampion.recall` becomes `packId:localId` or stays undefined.

- [ ] **Step 8: Verify**

Run: `npx vitest run tests/content/ && npm run verify 2>&1 | grep -E "Tests |Test Files |error|FAIL"`
Expected: green, at or above 3963 tests.

Then confirm the behaviour by hand or by driving it: a normal match still recalls on `B`. Report which you did.

- [ ] **Step 9: Commit**

```bash
git add src/game/gameObject/spells/Recall.ts src/game/gameObject/coreSpells/index.ts \
  src/game/gameObject/attackableUnits/Champion.ts src/game/preset.ts \
  scripts/generate-spell-catalog.mjs src/generated/spellCatalog.ts src/generated/spellModules.ts \
  src/content/ContentPack.ts src/content/validate.ts src/content/PackRegistry.ts \
  tests/content tests/game/preset.catalog.test.ts tests/game/spellRegistry.test.ts \
  tests/game/config/spellCatalog.test.ts tests/game/spells/cancel-policy.test.ts
git commit -m "refactor(content): recall is content, because it presupposes a fountain

Task 1 classified it as a mechanic every pack presupposes, alongside the
basic attack. Every pack does not: a map with no spawn platform has
nowhere to recall to, and lane-less N-player maps are explicitly in
scope. Champion may hold a recall; it may not assume it has one.

This also deletes CATALOG_HIDDEN_CORE_IDS and the four test-file Recall
exclusions, which existed only because Task 1 put Recall into a barrel
that feeds the loadout catalogue."
```
