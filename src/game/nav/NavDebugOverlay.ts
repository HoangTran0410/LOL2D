import type { Rectangle } from '@/libs/quadtree';
import AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import type GameObject from '@/game/gameObject/GameObject';
import type NavigationSystem from './NavigationSystem';
import type { PathAgentState } from './PathAgent';

/**
 * The debug view onto navigation, toggled in-game with `N`
 * (`Game.keyPressed`) and off by default. Built for the exact complaint that
 * prompted it: "I can't walk close to a wall, and sometimes a click walks me
 * straight at one" — so this draws the thing that is actually wrong, rather
 * than logging numbers nobody can act on.
 *
 * Lives in `src/game/nav/` rather than `Game.ts` because it belongs next to
 * what it draws, and because another change was landing in `Game.ts`
 * concurrently — that file keeps exactly one line, calling this. It is not
 * held to the "stays testable in a plain node environment" rule the rest of
 * this folder is: drawing needs p5's globals, same trade `TerrainMap.draw()`
 * and every other renderer in this codebase already makes.
 */

/** The slice of `Game` this overlay needs. Keeps it off the `Game` type. */
export interface NavDebugHost {
  navigation: NavigationSystem;
  objectManager: { objects: GameObject[] };
  camera: { getBoundingBox(): Rectangle; constantSize?(px: number): number };
  player: AttackableUnit;
}

const STATE_COLOR: Record<PathAgentState, [number, number, number]> = {
  IDLE: [140, 140, 140],
  DIRECT: [110, 220, 110],
  PENDING: [240, 210, 70],
  FOLLOWING: [90, 220, 255],
  BLOCKED: [255, 90, 90],
};

/** Cap on cells drawn in one frame, so an extreme zoom-out cannot spike a frame. */
const MAX_FIELD_CELLS = 20_000;

export function drawNavDebug(host: NavDebugHost): void {
  if (!host.navigation.debugRoutes) return;
  drawClearanceField(host);
  drawRoutes(host);
  drawAgentStates(host);
}

/**
 * The clearance field, thresholded at the player's own *terrain* radius —
 * the capped one navigation and wall push-out actually use, so the band this
 * paints is the band the player is really held out of rather than one derived
 * from a drawn size terrain stopped taking literally. Which
 * cells are wall, which are the moat `NavGrid.requiredClearance` leaves
 * around one (ground a body this size physically fits on but navigation
 * still refuses), and — implicitly, left undecorated — which are genuinely
 * walkable. Only the two problem categories are drawn so the overlay reads
 * as "here is what's wrong" rather than painting the whole map.
 */
function drawClearanceField(host: NavDebugHost): void {
  const { grid } = host.navigation;
  const bounds = host.camera.getBoundingBox();
  const radius = host.player.terrainRadius;
  const required = grid.requiredClearance(radius);

  const fromX = grid.cellX(bounds.x);
  const fromY = grid.cellY(bounds.y);
  const toX = grid.cellX(bounds.x + bounds.w);
  const toY = grid.cellY(bounds.y + bounds.h);

  const cells = (toX - fromX + 1) * (toY - fromY + 1);
  const stride = cells > MAX_FIELD_CELLS ? Math.ceil(Math.sqrt(cells / MAX_FIELD_CELLS)) : 1;

  push();
  noStroke();
  for (let cy = fromY; cy <= toY; cy += stride) {
    for (let cx = fromX; cx <= toX; cx += stride) {
      const clearance = grid.clearance[cy * grid.cols + cx];
      if (clearance >= required) continue; // genuinely walkable: leave it undecorated

      const size = grid.cellSize * stride;
      const x = cx * grid.cellSize;
      const y = cy * grid.cellSize;
      // `<= 0`, not `=== 0`: a cell inside a wall carries how deep it is as a
      // negative number now (see NavGrid.clearance), and painting those as the
      // orange "fits but refused" moat would say the opposite of the truth.
      if (clearance <= 0) {
        fill(150, 30, 30, 130); // wall
      } else {
        // the moat: a body this size fits here, navigation still says no
        fill(230, 150, 40, 110);
      }
      rect(x, y, size, size);
    }
  }
  pop();
}

/** Every unit's remaining route, same drawing `Game.drawRoutes` used to do. */
function drawRoutes(host: NavDebugHost): void {
  push();
  for (const object of host.objectManager.objects) {
    if (!(object instanceof AttackableUnit)) continue;
    const agent = object.pathAgent;
    if (!agent || agent.state !== 'FOLLOWING') continue;

    let fromX = object.position.x;
    let fromY = object.position.y;
    stroke(90, 220, 255, 190);
    strokeWeight(3);
    noFill();
    for (let i = agent.waypointIndex; i + 1 < agent.waypoints.length; i += 2) {
      line(fromX, fromY, agent.waypoints[i], agent.waypoints[i + 1]);
      fromX = agent.waypoints[i];
      fromY = agent.waypoints[i + 1];
    }

    noStroke();
    fill(90, 220, 255, 220);
    for (let i = agent.waypointIndex; i + 1 < agent.waypoints.length; i += 2) {
      circle(agent.waypoints[i], agent.waypoints[i + 1], 12);
    }
    fill(255, 210, 90, 230);
    circle(agent.goalX, agent.goalY, 20);
  }
  pop();
}

/**
 * `IDLE`/`DIRECT`/`PENDING`/`FOLLOWING`/`BLOCKED`, colour-coded, over every
 * unit that has ever taken a route order. The player's own tag is drawn
 * larger — reading a teammate's state is occasionally useful, reading your
 * own is the entire point of turning this on.
 */
function drawAgentStates(host: NavDebugHost): void {
  push();
  textAlign(CENTER, BOTTOM);
  // Overlay, not world — see Camera.constantSize.
  const k = host.camera?.constantSize?.(1) ?? 1;
  for (const object of host.objectManager.objects) {
    if (!(object instanceof AttackableUnit) || !object.pathAgent) continue;

    const isPlayer = object === host.player;
    const [r, g, b] = STATE_COLOR[object.pathAgent.state];
    noStroke();
    fill(r, g, b, 255);
    textSize((isPlayer ? 16 : 11) * k);
    const size = object.animatedValues.displaySize;
    text(
      object.pathAgent.state,
      object.position.x,
      object.position.y - size / 2 - (isPlayer ? 34 : 18) * k
    );
  }
  pop();
}
