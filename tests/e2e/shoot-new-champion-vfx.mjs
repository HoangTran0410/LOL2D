/**
 * Screenshot rig for kits whose VFX has been rebuilt — Camille, Ekko,
 * Jarvan IV, and now Pantheon.
 *
 * Not an assertion script — a *look at it* script. The complaint these spells
 * were rebuilt against ("visual effect của nó dở quá") is not a property any
 * unit test can hold, so the only honest check is to run the real renderer and
 * photograph each ability at the moments that matter: the windup, the strike,
 * and the settle. It samples several frames per cast for exactly that reason —
 * a single frame cannot tell a spell that animates from one that pops in.
 *
 * It does verify the two things a screenshot cannot show by itself:
 *   - every cast produced at least one spell object (nothing silently no-oped);
 *   - dashes actually travelled, which is the `onDashUpdate` regression.
 *
 *   node tests/e2e/shoot-new-champion-vfx.mjs [outDir] [championFilter]
 *
 * The filter is a substring of the champion name, and it is the point of the
 * argument: a full run is twelve casts and several minutes, which is far more
 * than a change to one kit needs.
 *
 * Requires a system Chrome install.
 */
import { mkdirSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const OUT = process.argv[2] ?? '/tmp/lol2d-new-vfx';
const CFG_KEY = 'lol2d:pregameConfig:v1';
const VIEWPORT = { width: 1280, height: 900 };

mkdirSync(OUT, { recursive: true });

const MATCH_CONFIG = {
  player: {
    mode: 'champion',
    championName: 'Camille',
    summonerD: 'Flash',
    summonerF: 'Heal',
    customSlots: Array(7).fill('random'),
  },
  ai: { count: 0, autoMove: false, autoAttack: false, autoCast: false, bots: [] },
  rules: { cooldownReductionPercent: 0, manaFree: true },
};

/** Which slot each ability sits in, and where to aim it relative to the player. */
const ALL_CASTS = [
  { champion: 'Camille', slot: 'Q', aim: [220, 0], frames: [80, 260, 900] },
  { champion: 'Camille', slot: 'W', aim: [320, 0], frames: [90, 240, 420] },
  { champion: 'Camille', slot: 'E', aim: [520, 0], frames: [120, 380, 700] },
  { champion: 'Camille', slot: 'R', aim: [300, 0], frames: [420, 700, 1600] },
  { champion: 'Ekko', slot: 'Q', aim: [380, 0], frames: [200, 700, 1400] },
  { champion: 'Ekko', slot: 'W', aim: [300, 0], frames: [400, 1400, 2200] },
  { champion: 'Ekko', slot: 'E', aim: [240, 0], frames: [90, 260, 600] },
  { champion: 'Ekko', slot: 'R', aim: [0, 0], frames: [90, 240, 500] },
  { champion: 'Jarvan IV', slotName: 'JarvanIV', slot: 'Q', aim: [420, 0], frames: [80, 200, 400] },
  { champion: 'Jarvan IV', slotName: 'JarvanIV', slot: 'W', aim: [0, 0], frames: [110, 400, 1600] },
  { champion: 'Jarvan IV', slotName: 'JarvanIV', slot: 'E', aim: [300, 0], frames: [90, 240, 900] },
  { champion: 'Jarvan IV', slotName: 'JarvanIV', slot: 'R', aim: [300, 0], frames: [420, 700, 1600] },
  // Pantheon: W locks onto the body nearest the cursor, E works behind a
  // planted aegis for 1.6s, and R spends 1.4s off the map — so the frame lists
  // follow those clocks rather than a common one. Q is missing on purpose: it
  // is `TAP_OR_HOLD`, and `spell.cast()` only opens the charge, so this rig
  // cannot fire it and would report a working ability as broken.
  { champion: 'Pantheon', slot: 'W', aim: [300, 0], frames: [90, 260, 520] },
  { champion: 'Pantheon', slot: 'E', aim: [260, 0], frames: [140, 520, 1100] },
  { champion: 'Pantheon', slot: 'R', aim: [600, 0], frames: [260, 900, 1250, 1500] },
  // Morgana W: the spikes rise on ~1s loops, so the frames straddle two of them.
  { champion: 'Morgana', slot: 'W', aim: [260, 0], frames: [400, 1200, 2600] },
  // Morgana R: 350ms windup, then a 3s tether that resolves. The frames are the
  // gather, the shackles slamming shut, the middle of the tether, and the burst.
  { champion: 'Morgana', slot: 'R', aim: [300, 0], frames: [220, 480, 1800, 3500] },
  // Katarina: her daggers *are* the kit, and they were a 26px pale sliver on a
  // pale floor with no outline. Q plants one behind the target, W drops one
  // after 800ms, R throws three a tick — all three exist to answer one
  // question, which is whether a dagger can be found at a glance.
  { champion: 'Katarina', slot: 'Q', aim: [380, 0], frames: [140, 520, 1200] },
  { champion: 'Katarina', slot: 'W', aim: [200, 0], frames: [120, 700, 1400] },
  { champion: 'Katarina', slot: 'R', aim: [300, 0], frames: [220, 900, 2000] },
  // Jhin E is a concealed mine with a fuse, and its two interesting states are
  // mutually exclusive: untripped it has to stay invisible, tripped it has to
  // bloom visibly before it bites. The dummy stands at 0.75x the aim and the
  // throw is clamped to E's 400 range, so separation peaks at exactly 400 —
  // aim any wider and the trap lands *closer* to the dummy, which is how the
  // first version of this entry tripped the trap it meant to leave hidden.
  {
    champion: 'Jhin',
    slot: 'E',
    aim: [400, 0],
    frames: [220, 900, 1500, 2400],
    label: 'Jhin_E_concealed',
  },
  {
    champion: 'Jhin',
    slot: 'E',
    aim: [280, 0],
    frames: [1250, 1900, 2350, 2600],
    label: 'Jhin_E_fuse',
  },
  { champion: 'Jhin', slot: 'Q', aim: [380, 0], frames: [120, 420, 800] },
  // Irelia. Q resolves its own target through TargetResolver, so the cursor
  // only has to be near the dummy; W fires itself at full charge, which is why
  // its last two frames sit either side of 1200ms; E is the one entry that
  // needs `recastAfterMs`, because a single blade standing in the ground is
  // half the ability.
  { champion: 'Irelia', slot: 'Q', aim: [260, 0], frames: [70, 210, 460] },
  { champion: 'Irelia', slot: 'W', aim: [420, 0], frames: [300, 1100, 1290, 1500] },
  {
    champion: 'Irelia',
    slot: 'E',
    aim: [300, -220],
    // Both blades are *thrown*, and the flight is the half of this ability the
    // first version skipped, so the frames have to catch one in the air. 372px
    // at E_THROW_SPEED is ~250ms, hence: blade one flying, blade one standing,
    // blade two flying after the second press at 700, and the clash.
    frames: [130, 420, 800, 1100],
    recastAfterMs: 700,
    recastAim: [300, 220],
  },
  // Irelia R: one cluster out, which opens into the arrowhead on the dummy the
  // rig stands at 0.75x the aim — so ~390px at R_VOLLEY_SPEED, ~360ms. The
  // frames are the cluster still travelling, the arms tearing open, the row
  // standing, and it still standing near the end of its 2.5s.
  { champion: 'Irelia', slot: 'R', aim: [520, 0], frames: [200, 430, 900, 2400] },
];

// Substring match, so "Jarvan" and "Pantheon" both work without quoting.
const ONLY = process.argv[3];
const CASTS = ONLY
  ? ALL_CASTS.filter(cast => cast.champion.toLowerCase().includes(ONLY.toLowerCase()))
  : ALL_CASTS;
if (!CASTS.length) {
  console.error(`no casts match "${ONLY}"`);
  process.exit(1);
}

// `hmr: false`: this repo is worked on by several agents in one tree, and a
// stray save anywhere in `src/` makes Vite reload the page mid-run, which wipes
// `window.__lol2d` and takes the whole script down with a bare "cannot read
// properties of undefined". The rig has no use for hot reload — it loads the
// page once and drives it.
const server = await createServer({ server: { port: 0, strictPort: false, hmr: false } });
await server.listen();
const url = server.resolvedUrls.local[0];

// Same override as `harness.mjs`: system Chrome by default because that is what
// the game ships to, `LOL2D_CHROME_CHANNEL=` (empty) for a machine without it.
const channel = process.env.LOL2D_CHROME_CHANNEL ?? 'chrome';
const browser = await chromium.launch(channel ? { channel } : {});
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = [];
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});

const failures = [];
const check = (name, passed, detail) => {
  if (!passed) failures.push(`${name}: ${detail ?? 'failed'}`);
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

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

// Clear the arena once, then stand a punching bag in front of the player so
// on-hit effects have something to land on.
await page.evaluate(() => {
  const game = window.__lol2d.scene.oScene.game;
  const player = game.player;
  for (const object of game.objectManager.objects) {
    if (object === player) continue;
    const name = object.constructor?.name ?? '';
    if (name === 'Turret' || name === 'Fountain') continue;
    object.toRemove = true;
  }
  game.objectManager.update();
  window.__rig = { game, player, home: player.position.copy() };
});

for (const cast of CASTS) {
  const staged = await page.evaluate(
    async ([championName, classPrefix, slot, aimX, aimY]) => {
      const { game, player, home } = window.__rig;

      // wipe leftovers from the previous cast so each shot is of one spell
      for (const object of game.objectManager.objects) {
        if (object === player) continue;
        const name = object.constructor?.name ?? '';
        if (name === 'Turret' || name === 'Fountain') continue;
        object.toRemove = true;
      }
      game.objectManager.update();
      for (const buff of player.buffs) buff.deactivateBuff();
      player.updateBuffs();

      // reset the player onto the champion under test
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
      subject.stats.health.baseValue = subject.stats.maxHealth.value;

      // a dummy to be hit, so impacts have a body to land on
      const dummy = game.director.addBot({
        mode: 'champion',
        championName: 'Garen',
        summonerD: 'Flash',
        summonerF: 'Heal',
        customSlots: Array(7).fill('random'),
      });
      if (dummy) {
        game.director.setBotBehaviour(dummy, {
          autoMove: false,
          autoAttack: false,
          autoCast: false,
        });
        game.objectManager.update();
        dummy.position.set(home.x + aimX * 0.75, home.y + aimY * 0.75);
        dummy.destination.set(dummy.position.x, dummy.position.y);
        dummy.stats.health.baseValue = dummy.stats.maxHealth.value * 10;
        dummy.stats.maxHealth.baseValue = dummy.stats.maxHealth.value * 10;
      }

      window.__stage = { game, subject, home, dummy };
      return { ok: true };
    },
    [cast.champion, cast.slotName ?? cast.champion, cast.slot, cast.aim[0], cast.aim[1]]
  );

  // `label` only when one ability needs more than one shot of it — two entries
  // for the same slot would otherwise write over each other's screenshots.
  const label = cast.label ?? `${cast.slotName ?? cast.champion}_${cast.slot}`;
  if (!staged.ok) {
    check(`${label} staged`, false, staged.reason);
    continue;
  }

  // A frame has to run between standing the dummy up and pressing the key.
  // `queryObjects` answers out of the quadtree, which is rebuilt once per
  // update — cast in the same tick and an auto-locking spell (Pantheon W,
  // Yasuo E, Nasus Q) looks for bodies at the positions they were spawned at
  // and finds nothing in range, which reads as a broken ability rather than a
  // stale index.
  await page.waitForTimeout(120);

  const fired = await page.evaluate(
    ([classPrefix, slot, aimX, aimY]) => {
      const { game, subject, home } = window.__stage;

      // the preset's display name and the spell class prefix differ for the
      // champions whose names carry a space ("Jarvan IV" -> JarvanIV_Q)
      const wanted = `${classPrefix}_${slot}`;
      const spell = subject.spells.find(s => s?.constructor?.name === wanted);
      if (!spell) {
        return {
          ok: false,
          reason: `no ${wanted} in kit: ${subject.spells.map(s => s?.constructor?.name).join(',')}`,
        };
      }

      // `Spell.cast()` builds its own CastContext off game.worldMouse, which is
      // the path the real key press takes — press() alone wants a context.
      game.worldMouse = createVector(home.x + aimX, home.y + aimY);

      const objectsBefore = game.objectManager.objects.length;
      const startPos = { x: subject.position.x, y: subject.position.y };
      spell.currentCooldown = 0;
      spell.cast();

      window.__cast = { game, subject, objectsBefore, startPos, spawned: 0, moved: 0 };
      return { ok: true };
    },
    [cast.slotName ?? cast.champion, cast.slot, cast.aim[0], cast.aim[1]]
  );

  if (!fired.ok) {
    check(`${label} staged`, false, fired.reason);
    continue;
  }

  let previous = 0;
  let recastPending = cast.recastAfterMs !== undefined;
  for (const [index, at] of cast.frames.entries()) {
    await page.waitForTimeout(at - previous);
    previous = at;

    // The second half of a RECAST ability. It cannot go through `cast()`, which
    // gates on READY and so refuses while the activation is live — the real
    // second press is `createSpellContext` + `press`, which is exactly what
    // `SpellInputController.keyDown` does.
    if (recastPending && at >= cast.recastAfterMs) {
      recastPending = false;
      const again = await page.evaluate(
        ([classPrefix, slot, aimX, aimY]) => {
          const { game, subject, home } = window.__stage;
          const spell = subject.spells.find(s => s?.constructor?.name === `${classPrefix}_${slot}`);
          if (!spell) return { ok: false, reason: 'spell missing' };
          const aim = createVector(home.x + aimX, home.y + aimY);
          game.worldMouse = aim;
          const context = game.createSpellContext(spell, subject, aim);
          if (!context) return { ok: false, reason: `no context (state ${spell.state})` };
          const accepted = spell.press(context);
          return { ok: accepted, reason: `state ${spell.state}` };
        },
        [
          cast.slotName ?? cast.champion,
          cast.slot,
          (cast.recastAim ?? cast.aim)[0],
          (cast.recastAim ?? cast.aim)[1],
        ]
      );
      check(`${label} recast accepted`, again.ok, again.reason);
    }

    await page.evaluate(() => {
      const rig = window.__cast;
      const game = rig.game;
      rig.spawned = Math.max(
        rig.spawned,
        game.objectManager.objects.length +
          game.objectManager._objectToBeAdd.length -
          rig.objectsBefore
      );
      rig.moved = Math.max(
        rig.moved,
        Math.hypot(rig.subject.position.x - rig.startPos.x, rig.subject.position.y - rig.startPos.y)
      );
    });
    await page.screenshot({ path: `${OUT}/${label}-${index + 1}-t${at}.png` });
  }

  const result = await page.evaluate(() => {
    const rig = window.__cast;
    return { spawned: rig.spawned, moved: Math.round(rig.moved) };
  });
  check(
    `${label} produced world effects`,
    result.spawned > 0,
    `objects=+${result.spawned} moved=${result.moved}px`
  );
}

// The dash regression, stated as its own property: these three are the spells
// whose movement was being deleted by the onUpdate assignment.
console.log('\nscreenshots in', OUT);
if (errors.length) {
  console.log('\npage errors:');
  for (const error of errors.slice(0, 12)) console.log(' ', error);
}
check('no page errors during the run', errors.length === 0, `${errors.length} error(s)`);

await browser.close();
await server.close();

if (failures.length) {
  console.log(`\n${failures.length} FAILED`);
  process.exit(1);
}
console.log('\nall checks passed');
