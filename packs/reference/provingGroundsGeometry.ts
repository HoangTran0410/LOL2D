import type { MapGeometry } from '@moba2d/core/content/ContentPack';

/**
 * Proving Grounds' heavy half — terrain, slots and its one lane. Lazy behind
 * `packs/reference/map.ts`'s `geometry`, the same split Summoner's Rift
 * uses, so this array of polygons never rides along in the `pregame` chunk.
 *
 * ## The corridor
 *
 * A single wall band runs the full width of the map at y:[1150,1250],
 * splitting it into a north half (jade's) and a south half (amber's), except
 * for an 80px-wide gap at x:[1150,1230]. That gap is the only way across —
 * both blocks span the *entire* map width outside it, so nothing routes
 * around the ends. 80px sits inside the 60-90px band the design spec calls
 * out: narrow enough that a champion's ~55px body (radius 27.5,
 * `NavGrid.requiredClearance` demanding 35.5px of clearance either side of
 * centre) barely fits, wide enough that the corridor is not merely a
 * doorway nothing could ever fail to path through.
 * `tests/content/referenceMap.test.ts`'s `wallGapWidths` measures this the
 * way `NavGrid.fromPolygons` rasterises, not the way the polygon reads on
 * paper — 5 free 16px cells at the shipped `NAV_CELL_SIZE`, i.e. 80px,
 * confirmed against the actual grid rather than assumed from the numbers
 * above.
 *
 * ## The structure row
 *
 * amber holds one turret guarding its side of the corridor; jade holds two.
 * Deliberately asymmetric — see `referenceMap`'s own header for why a
 * symmetric fixture would be the wrong one to ship.
 *
 * ## The rest
 *
 * One neutral slot (`role: 'warden'`), north of the corridor and framed by
 * two short wall "wings" so it reads as a place rather than a bare circle —
 * filled by `packs/reference/pack.ts`'s own `warden` monster, so Task 7's
 * role-fills-slot path is exercised by something other than the bundled
 * pack. One waystone pillar near the amber base is pure flavour, there only
 * to keep this from reading as two rectangles and a hallway.
 */
export const provingGroundsGeometry: MapGeometry = {
  terrain: {
    wall: [
      // The corridor's south block: x:[0,1150], y:[1150,1250].
      [
        { x: 0, y: 1150 },
        { x: 1150, y: 1150 },
        { x: 1150, y: 1250 },
        { x: 0, y: 1250 },
      ],
      // The corridor's north block: x:[1230,2400], y:[1150,1250]. The 80px
      // gap between the two is the only crossing — see this file's header.
      [
        { x: 1230, y: 1150 },
        { x: 2400, y: 1150 },
        { x: 2400, y: 1250 },
        { x: 1230, y: 1250 },
      ],
      // Wings framing the neutral slot at (1187, 700), clear of the corridor
      // band (y:[1150,1250]) and of each other.
      [
        { x: 1050, y: 600 },
        { x: 1100, y: 600 },
        { x: 1100, y: 800 },
        { x: 1050, y: 800 },
      ],
      [
        { x: 1275, y: 600 },
        { x: 1325, y: 600 },
        { x: 1325, y: 800 },
        { x: 1275, y: 800 },
      ],
      // A lone waystone near the amber base — flavour, not a chokepoint.
      [
        { x: 600, y: 1900 },
        { x: 680, y: 1900 },
        { x: 680, y: 1980 },
        { x: 600, y: 1980 },
      ],
    ],
    bush: [],
    water: [],
  },
  slots: {
    spawn: [
      { faction: 'amber', x: 300, y: 2100, r: 150 },
      { faction: 'jade', x: 2100, y: 300, r: 150 },
    ],
    minion: [
      { faction: 'amber', lane: 'mid', x: 650, y: 1750, scatter: 40 },
      { faction: 'jade', lane: 'mid', x: 1800, y: 600, scatter: 40 },
    ],
    structure: [
      { faction: 'amber', kind: 'turret', x: 700, y: 1700 },
      { faction: 'jade', kind: 'turret', x: 1700, y: 700 },
      { faction: 'jade', kind: 'turret', x: 1900, y: 500 },
    ],
    neutral: [{ role: 'warden', x: 1187, y: 700, r: 150 }],
  },
  lanes: [
    {
      id: 'mid',
      from: 'amber',
      to: 'jade',
      // Waypoint 0 is the amber fountain, the same convention
      // `src/game/lanes.ts` documents for Summoner's Rift. The three
      // waypoints at x:1187 thread the corridor gap (that x sits inside the
      // free x:[1150,1230] band); the rest hug each faction's own turret(s)
      // without sitting *on* one.
      //
      // A first cut of this path put `{700,1700}`/`{1700,700}` here
      // verbatim — the amber turret's own centre and one of jade's two —
      // which is exactly the bug `src/game/lanes.ts`'s own header and
      // `tests/content/laneTurretClearance.test.ts` exist to catch: a
      // straight-line `moveTo` walk drives into the turret's body, is
      // shoved around it by `UnitCollisionSystem`, and re-acquires the same
      // line on the far side. Every waypoint and every straight run between
      // two of them now clears every one of this map's three turrets by at
      // least ~115px — `laneTurretClearance.test.ts`'s own floor is 100px
      // for a run and 70px for a single point, and Summoner's Rift's real
      // paths hold 118-256px, so this sits at the tight end of that same
      // band on purpose (a 2400px map has far less room than a 6400px one)
      // rather than by accident.
      waypoints: [
        { x: 300, y: 2100 },
        { x: 300, y: 1820 },
        { x: 950, y: 1820 }, // passes ~120px south of the amber turret
        { x: 1187, y: 1300 },
        { x: 1187, y: 1200 },
        { x: 1187, y: 1000 },
        { x: 1450, y: 1000 },
        { x: 1450, y: 550 }, // passes ~115-390px west of jade's two turrets
        { x: 2100, y: 300 },
      ],
    },
  ],
};
