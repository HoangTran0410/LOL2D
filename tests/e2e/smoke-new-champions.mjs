/**
 * Does every ability on the new roster actually fire in the real game?
 *
 * Forty spells were written by five agents in parallel against a spec, and
 * `verify` says they compile and their unit tests pass. Neither of those runs
 * `draw()`. What is left to find is the class of bug that only exists once p5
 * is real and a frame is running: a null read inside a draw, a missing global,
 * an effect that constructs and then throws on its first update — all of which
 * present as a working build and a dead champion.
 *
 * Deliberately *not* a screenshot rig; `shoot-new-champion-vfx.mjs` is that,
 * and it costs minutes per champion. This one asks the three questions a
 * number can answer:
 *
 *   1. no page error while the ability is on screen,
 *   2. the cast was *accepted* (the spell left READY),
 *   3. something happened — an object, a buff, or the caster moved.
 *
 * The third is deliberately a disjunction. "Spawned an object" alone would
 * fail every ability whose whole payload is a buff on the caster (Darius W,
 * Xin Zhao Q, Master Yi E, Ezreal W, Tryndamere Q), and calling those broken
 * would be the test being wrong rather than the game.
 *
 *   node tests/e2e/smoke-new-champions.mjs [championFilter]
 *
 * Requires a system Chrome install.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';

const CFG_KEY = 'lol2d:pregameConfig:v1';

/** [preset display name, spell class prefix] — they differ where a name has a space. */
const ROSTER = [
  ['Darius', 'Darius'],
  ['Renekton', 'Renekton'],
  ['Xin Zhao', 'XinZhao'],
  ['Tryndamere', 'Tryndamere'],
  ['Master Yi', 'MasterYi'],
  ['Malzahar', 'Malzahar'],
  ['Ezreal', 'Ezreal'],
  ['Caitlyn', 'Caitlyn'],
  ['Soraka', 'Soraka'],
  ['Brand', 'Brand'],
];

const ONLY = process.argv[2];
const CASTS = [];
for (const [champion, prefix] of ROSTER) {
  if (ONLY && !champion.toLowerCase().includes(ONLY.toLowerCase())) continue;
  for (const slot of ['Q', 'W', 'E', 'R']) CASTS.push({ champion, prefix, slot });
}
if (CASTS.length === 0) {
  console.error(`no champion matches "${ONLY}"`);
  process.exit(1);
}

/**
 * How long to watch one cast. Long enough for the slowest thing on this roster
 * to resolve — Master Yi W and Malzahar R are 2s channels — because a spell
 * that throws does it on some later frame, not the first.
 */
const OBSERVE_MS = 2_400;
const SAMPLE_MS = 300;

const MATCH_CONFIG = {
  player: {
    mode: 'champion',
    championName: 'Darius',
    summonerD: 'Flash',
    summonerF: 'Heal',
    customSlots: Array(7).fill('random'),
  },
  ai: { count: 0, autoMove: false, autoAttack: false, autoCast: false, bots: [] },
  rules: { cooldownReductionPercent: 0, manaFree: true },
  world: { jungle: false, minions: false },
};

// `hmr: false`: several agents share this tree and a stray save mid-run would
// reload the page and wipe `window.__lol2d` under us.
const server = await createServer({ server: { port: 0, strictPort: false, hmr: false } });
await server.listen();
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

let errors = [];
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});

const rows = [];
const failures = [];

try {
  await page.addInitScript(
    ([key, config]) => window.localStorage.setItem(key, JSON.stringify(config)),
    [CFG_KEY, MATCH_CONFIG]
  );
  await page.goto(url, { waitUntil: 'load' });
  await page.click('#play-btn');
  await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.objectManager, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(1_500);

  await page.evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    window.__rig = { game, home: game.player.position.copy() };
  });

  for (const cast of CASTS) {
    const label = `${cast.prefix}_${cast.slot}`;
    errors = [];

    const staged = await page.evaluate(
      ([championName]) => {
        const { game, home } = window.__rig;
        const player = game.player;

        // One cast per arena: leftovers from the last ability would be counted
        // as this one's, and a lingering zone would keep ticking into it.
        for (const object of game.objectManager.objects) {
          if (object === player) continue;
          const name = object.constructor?.name ?? '';
          if (name === 'Turret' || name === 'Fountain') continue;
          object.toRemove = true;
        }
        game.objectManager.update();
        for (const buff of player.buffs) buff.deactivateBuff();
        player.updateBuffs();

        game.director.applyLoadout(player, {
          mode: 'champion',
          championName,
          summonerD: 'Flash',
          summonerF: 'Heal',
          customSlots: Array(7).fill('random'),
        });
        game.objectManager.update();

        const subject = game.player;
        subject.position.set(home.x, home.y);
        subject.destination.set(home.x, home.y);
        subject.stats.mana.baseValue = subject.stats.maxMana.value;
        subject.stats.health.baseValue = subject.stats.maxHealth.value * 0.6;

        // A body to aim at, well inside every range on this roster, and fat
        // enough to survive being hit forty times.
        const dummy = game.director.addBot({
          mode: 'champion',
          championName: 'Garen',
          summonerD: 'Flash',
          summonerF: 'Heal',
          customSlots: Array(7).fill('random'),
        });
        if (!dummy) return { ok: false, reason: 'no dummy' };
        game.director.setBotBehaviour(dummy, {
          autoMove: false,
          autoAttack: false,
          autoCast: false,
        });
        game.objectManager.update();
        dummy.position.set(home.x + 240, home.y);
        dummy.destination.set(dummy.position.x, dummy.position.y);
        dummy.stats.maxHealth.baseValue = 100_000;
        dummy.stats.health.baseValue = 100_000;

        window.__stage = { game, subject, home, dummy };
        return { ok: true };
      },
      [cast.champion]
    );

    if (!staged.ok) {
      rows.push({ label, ok: false, detail: staged.reason });
      failures.push(`${label}: ${staged.reason}`);
      continue;
    }

    // The quadtree is rebuilt once per update, so an auto-locking spell cast in
    // the same tick the dummy was placed looks for a body the index has not
    // seen yet and reports a working ability as broken.
    await page.waitForTimeout(150);

    const fired = await page.evaluate(
      ([prefix, slot]) => {
        const { game, subject, home } = window.__stage;
        const wanted = `${prefix}_${slot}`;
        const spell = subject.spells.find(s => s?.constructor?.name === wanted);
        if (!spell) {
          return {
            ok: false,
            reason: `not in kit (${subject.spells.map(s => s?.constructor?.name).join(',')})`,
          };
        }

        // `game.createSpellContext` and then `press`, which is exactly what
        // `SpellInputController.keyDown` does. `Spell.cast()` is *not* the same
        // path: it builds a bare context with no `target`, so a UNIT spell —
        // whose whole job is resolving one — is handed nothing to act on and
        // silently declines. Seven of the forty looked broken for that reason
        // and were not.
        game.worldMouse = createVector(home.x + 240, home.y);
        spell.currentCooldown = 0;

        window.__cast = {
          game,
          subject,
          spell,
          objectsBefore: game.objectManager.objects.length,
          buffsBefore: subject.buffs.length,
          startPos: { x: subject.position.x, y: subject.position.y },
          spawned: 0,
          buffed: 0,
          moved: 0,
        };
        const context = game.createSpellContext(spell, subject, {
          x: home.x + 240,
          y: home.y,
        });
        if (!context) return { ok: false, reason: 'no cast context (target refused?)' };
        const accepted = spell.press(context);
        return { ok: true, accepted, stateAfter: String(spell.state) };
      },
      [cast.prefix, cast.slot]
    );

    if (!fired.ok) {
      rows.push({ label, ok: false, detail: fired.reason });
      failures.push(`${label}: ${fired.reason}`);
      continue;
    }

    for (let elapsed = 0; elapsed < OBSERVE_MS; elapsed += SAMPLE_MS) {
      await page.waitForTimeout(SAMPLE_MS);
      await page.evaluate(() => {
        const rig = window.__cast;
        const manager = rig.game.objectManager;
        rig.spawned = Math.max(
          rig.spawned,
          manager.objects.length + manager._objectToBeAdd.length - rig.objectsBefore
        );
        rig.buffed = Math.max(rig.buffed, rig.subject.buffs.length - rig.buffsBefore);
        rig.moved = Math.max(
          rig.moved,
          Math.hypot(
            rig.subject.position.x - rig.startPos.x,
            rig.subject.position.y - rig.startPos.y
          )
        );
      });
    }

    const result = await page.evaluate(() => {
      const rig = window.__cast;
      return {
        spawned: rig.spawned,
        buffed: rig.buffed,
        moved: Math.round(rig.moved),
        accepted: String(rig.spell.state) !== 'READY' || rig.spell.currentCooldown > 0,
      };
    });

    const didSomething = result.spawned > 0 || result.buffed > 0 || result.moved > 2;
    const ok = errors.length === 0 && result.accepted && didSomething;
    const detail =
      `objects=+${result.spawned} buffs=+${result.buffed} moved=${result.moved}px` +
      `${result.accepted ? '' : ' NOT-ACCEPTED'}${errors.length ? ` ${errors[0].slice(0, 120)}` : ''}`;

    rows.push({ label, ok, detail });
    if (!ok) failures.push(`${label}: ${detail}`);
  }
} catch (error) {
  failures.push(`run: ${String(error).split('\n')[0]}`);
} finally {
  for (const row of rows)
    console.log(`${row.ok ? 'ok  ' : 'FAIL'}  ${row.label.padEnd(18)} ${row.detail}`);
  console.log(
    `\n${failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`}  ${rows.length} casts, ${CASTS.length} attempted`
  );
  await browser.close();
  await server.close();
}

process.exit(failures.length === 0 ? 0 : 1);
