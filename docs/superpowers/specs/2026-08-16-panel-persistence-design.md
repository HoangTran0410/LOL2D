# Practice panel persistence — design

Date: 2026-08-16
Status: approved, ready to implement
Supersedes one rule in: `docs/superpowers/specs/2026-08-15-practice-panel-design.md`

## The problem

The in-game panel is now a strict superset of the pregame setup screen for match
configuration — it edits the player's and every bot's loadout, and it sets
behaviour flags **per bot** where the setup screen only sets them globally. The
setup screen's only unique control is `InputModePanel` (touch vs pointer), which
is a device preference, not a match setting.

And the panel deliberately persists nothing. So the better surface is the one
whose work is thrown away on reload.

## The reversal, stated plainly

The practice panel was built to a rule the user set at the start: *"chỉ sửa trận
hiện tại"* — mutate the running match, never write storage. That rule is now
reversed for match configuration. Three places assert it and all three must
change, not be quietly contradicted:

- `MatchDirector.ts`'s file comment.
- `PracticePanel.vue` / `practice/panelTab.ts` comments that cite the rule.
- `tests/e2e/drive-practice-panel.mjs`'s `pregameConfigUntouched` check, which
  must become its opposite: the config *is* touched, and by the right amount.

**The setup screen is not deleted here.** Persistence is the whole of the value;
deleting the screen is cleanup that costs two large e2e scripts
(`drive-pregame-config.mjs` 34KB, `drive-kit-builder.mjs` 29KB) and can follow
once the panel has been lived with. Doing them together would couple a change
that is certainly wanted to one that is merely probably wanted.

## What persists, and what must not

**Persists** — written to `lol2d:pregameConfig:v1` on every panel mutation:

- Player loadout, bot loadouts, bot count.
- Per-bot behaviour flags (`autoMove`, `autoAttack`, `autoCast`).
- Match rules: cooldown reduction, URF.
- World: jungle on/off, minions on/off. **New fields** — `PregameConfig` has no
  home for these today.

**Does not persist** — session state, and the line is not arbitrary: these are
things a player switches on to try something, and inheriting them silently into
the next visit would read as the game being broken.

- Every cheat: invulnerability, reveal-the-whole-map, stack counts.
- Debug overlay flags.

Zoom already persists under its own key (`lol2d.zoomFactor`) and stays there —
it is a device preference like input mode, not a match setting.

## The schema change

`AIConfig` holds global `autoMove` / `autoAttack` / `autoCast` plus
`bots: readonly ChampionLoadout[]`. Add a parallel array:

```ts
botBehaviours: readonly BotBehaviour[];
```

one entry per slot, `AI_COUNT_MAX` long, same shape as `bots`.

Migration follows the pattern `PregameConfig.ts`'s own header already
documents for `ai.bots`: a stored config without `botBehaviours` gets a full
array, **each entry seeded from the global flags** — so an existing player's
saved global choice becomes their per-bot starting point rather than being
dropped. `sanitizePregameConfig` validates it the same way it validates `bots`.

The three global flags **stay**. They are what the setup screen's
`AiConfigPanel` edits, and they become the default applied to a bot added
without a per-bot choice. Removing them would break the setup screen, which
this change explicitly does not touch.

## Where the writes go

`MatchDirector` already owns every live-match mutation, so it is where the
persistence hook belongs — one place, not scattered through the tabs. Each
mutating method writes the config after mutating the match.

**Write the whole config, derived from live state, rather than patching
fields.** A patch-per-field scheme has to be kept in step with the panel's
controls forever; deriving the config from the roster and rules that actually
exist cannot drift from what the player is looking at.

Beware the paused-panel trap ([[lol2d-paused-panel-trap]], and
`MatchDirector.bots()`'s own comment): the panel holds the match paused, so
`ObjectManager.update()` has not run. Any derivation must read both
`objects` and `_objectToBeAdd` and skip `toRemove`, exactly as `bots()` does —
otherwise a bot added and then persisted in the same paused session is written
out as absent.

## Reset

Persisting everything removes the clean slate every new match used to be. A
**"Đặt lại mặc định"** button goes at the bottom of the Trận đấu tab, beside the
exit, and needs the same two-step confirm for the same reason: it is not
recoverable, and it sits next to another irreversible control.

It writes `DEFAULT_PREGAME_CONFIG` and applies it to the running match, so the
button does what it says immediately rather than at the next match.

## Testing

- Round trip: set a per-bot flag, a CDR value and jungle off; read
  `localStorage` and assert the stored config matches; then boot a fresh `Game`
  from it and assert the match matches.
- Migration: a stored v-current config with no `botBehaviours` loads with one
  entry per slot, each seeded from the global flags — not from
  `DEFAULT_PREGAME_CONFIG`'s.
- **Cheats do not leak**: switch on invulnerability, reveal-map and a debug
  flag, then assert the stored config contains none of them. This is the test
  that stops the persistence hook from being widened carelessly later.
- Paused derivation: add a bot while paused, persist, and assert the stored
  config has it. This fails against any implementation that reads only
  `objectManager.objects`.
- Reset restores defaults in storage **and** in the running match.

## Files

- Modify: `src/game/config/PregameConfig.ts` (schema + migration),
  `src/game/MatchDirector.ts` (persist hook, reset), `src/game/hud/practice/RulesTab.vue`
  (reset button), the three comment/assertion sites listed above
- Test: `tests/game/config/`, `tests/game/practice/`,
  `tests/e2e/drive-practice-panel.mjs`
