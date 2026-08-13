import { Circle } from '../libs/quadtree';
import { SpellHotKeys } from './constants';
import AttackableUnit from './gameObject/attackableUnits/AttackableUnit';
import Champion from './gameObject/attackableUnits/Champion';
import AIChampion from './gameObject/attackableUnits/AIChampion';
import Monster from './gameObject/attackableUnits/Monster';
import Camera from './gameObject/map/Camera';
import FogOfWar from './gameObject/map/FogOfWar';
import TerrainMap from './gameObject/map/TerrainMap';
import Fountain from './gameObject/structures/Fountain';
import Turret from './gameObject/structures/Turret';
import InGameHUD from './hud/InGameHUD';
import {
  FountainPreset,
  MonsterPreset,
  getChampionPresetRandom,
  getTurretPositions,
} from './preset';
import ObjectManager, { PredefinedFilters } from './managers/ObjectManager';
import MinionSpawner from './managers/MinionSpawner';
import NavigationSystem from './nav/NavigationSystem';
import EventManager from '../managers/EventManager';
import { uuidv4 } from '../utils';
import SpellInputController from './spell/input/SpellInputController';
import TargetResolver, {
  defaultIsTargetable,
  defaultTargetInfo,
} from './spell/targeting/TargetResolver';
import type GameObject from './gameObject/GameObject';
import type Spell from './gameObject/Spell';
import type { CastContext, Vec2 } from './spell/runtime/types';

export default class Game {
  readonly mapSize = 6400;
  readonly fps = 60;

  camera!: Camera;
  objectManager!: ObjectManager;
  eventManager!: EventManager;
  terrainMap!: TerrainMap;
  navigation!: NavigationSystem;
  fogOfWar!: FogOfWar;
  inGameHUD!: InGameHUD;
  player!: Champion;
  spellInputController!: SpellInputController;
  minionSpawner!: MinionSpawner;

  fountains: Fountain[] = [];
  turrets: Turret[] = [];
  monsters: Monster[] = [];

  clickedPoint = { x: 0, y: 0, size: 0 };
  worldMouse!: p5.Vector;
  paused = false;

  constructor() {
    this.worldMouse = createVector(0, 0);
    this.camera = new Camera();
    this.objectManager = new ObjectManager(this);
    this.eventManager = new EventManager();
    this.terrainMap = new TerrainMap(this, this.mapSize);
    // The map is static, so every unit's routing is derived from the wall layer
    // once here — about 7ms and 1.6MB for the whole game — rather than per unit
    // per frame. Built off the same Obstacle list the collision push-out uses,
    // so there is one source of truth for where the walls are.
    this.navigation = new NavigationSystem(this.terrainMap.wallPolygons(), this.mapSize);
    this.fogOfWar = new FogOfWar(this);
    this.inGameHUD = new InGameHUD(this);

    // fountains first: randomSpawnPoint() is defined in terms of them, and both
    // the player and every AI champion are placed with it
    this.spawnFountains();

    this.player = new Champion({
      game: this,
      position: this.randomSpawnPoint(),
      preset: getChampionPresetRandom(),
    });
    this.objectManager.addObject(this.player);
    this.spellInputController = new SpellInputController({
      keyBindings: SpellHotKeys,
      getSpell: slot => this.player.spells[slot],
      createContext: (_spell, slot) => {
        const spell = this.player.spells[slot];
        return spell ? this.createSpellContext(spell, this.player, this.worldMouse) : undefined;
      },
    });

    for (let i = 0; i < 5; i++) {
      this.objectManager.addObject(
        new AIChampion({
          game: this,
          position: this.randomSpawnPoint(),
          preset: getChampionPresetRandom(),
        })
      );
    }

    // anything reading `isAllied` needs this.player, so these come after it
    this.spawnJungle();
    this.spawnTurrets();
    // the spawner reads teams off the fountains, so it comes after them
    this.minionSpawner = new MinionSpawner(this);

    this.camera.target = this.player.position;
    this.camera.position = this.player.position.copy();
  }

  spawnFountains() {
    for (const preset of FountainPreset) {
      const fountain = new Fountain({ game: this, preset });
      this.fountains.push(fountain);
      this.objectManager.addObject(fountain);
    }
  }

  spawnJungle() {
    for (const key in MonsterPreset) {
      const monster = new Monster({ game: this, preset: MonsterPreset[key] });
      this.monsters.push(monster);
      this.objectManager.addObject(monster);
    }
  }

  spawnTurrets() {
    for (const { x, y, teamId } of getTurretPositions()) {
      const turret = new Turret({ game: this, position: createVector(x, y), teamId });
      this.turrets.push(turret);
      this.objectManager.addObject(turret);
    }
  }

  pause() { this.paused = true; }
  unpause() { this.paused = false; }

  fixedUpdate() {
    this.camera.update();
    this.worldMouse = this.camera.screenToWorld(mouseX, mouseY);
    // before objectManager.update(), so a minion released this frame is added
    // to the world in the same pass as everything else spawned this frame
    this.minionSpawner.update();
    // also before it: a route asked for last frame is in hand before the unit
    // that asked takes its next step. The pass is budgeted, so this is a few
    // hundred microseconds whatever the board looks like.
    this.navigation.update();
    this.objectManager.update();
    this.terrainMap.update();

    if (mouseIsPressed && mouseButton === RIGHT) {
      // Right click is one gesture with two meanings: on an enemy body it is an
      // attack order, on empty ground it is a move order (which also cancels any
      // attack order). One quadtree query per frame while the button is held,
      // for the local player only — the AI scans on an interval instead.
      const target = this.findAttackTargetUnderCursor();
      if (target) {
        this.player.orderAttack(target);
      } else {
        this.player.orderMove(this.worldMouse.x, this.worldMouse.y, true);
        this.clickedPoint = { x: this.worldMouse.x, y: this.worldMouse.y, size: 40 };
      }
    }
    this.clickedPoint.size *= 0.9;

    this.spellInputController.update(deltaTime);
  }

  update() {
    if (this.paused) return;
    this.fixedUpdate();
  }

  /**
   * The enemy body under the cursor, or null for empty ground. `willDraw` is
   * the fog of war's own visibility flag, so a unit hidden in the fog cannot be
   * ordered onto — you can only attack what you can see.
   *
   * The click has a few pixels of slack around it; the implicit collide filter
   * in queryObjects then requires the cursor circle to actually touch the body.
   */
  findAttackTargetUnderCursor(): AttackableUnit | null {
    const found = this.objectManager.queryObjects({
      area: new Circle({ x: this.worldMouse.x, y: this.worldMouse.y, r: 10 }),
      filters: [
        PredefinedFilters.type(AttackableUnit),
        PredefinedFilters.canTakeDamageFromTeam(this.player.teamId),
        (object: GameObject) => object.willDraw,
      ],
    });

    let nearest: AttackableUnit | null = null;
    let nearestDistance = Infinity;
    for (const unit of found) {
      const distance = p5.Vector.dist(this.worldMouse, unit.position);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = unit;
      }
    }
    return nearest;
  }

  draw() {
    if (this.paused) return;
    background(30);

    this.camera.makeDraw(() => {
      this.terrainMap.draw();
      if (this.clickedPoint.size > 0) {
        push();
        noStroke();
        fill('green');
        ellipse(this.clickedPoint.x, this.clickedPoint.y, this.clickedPoint.size);
        pop();
      }
      this.player.spells.forEach(spell => {
        if (spell.willDrawPreview) spell.drawPreview?.();
      });
      this.objectManager.draw();
      if (this.navigation.debugRoutes) this.drawRoutes();
    });

    this.fogOfWar.draw();
  }

  /**
   * Every unit's remaining route, when `navigation.debugRoutes` is on. Lives
   * here rather than in the nav module so that module stays free of p5 and
   * stays testable in a plain node environment.
   */
  drawRoutes(): void {
    push();
    for (const object of this.objectManager.objects) {
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

  destroy() {
    this.fogOfWar.destroy();
    this.inGameHUD.destroy();
  }

  /**
   * Spawn and respawn point (AttackableUnit.respawn() calls this too). Picking a
   * fountain rather than scattering everyone around the map centre is what makes
   * the platforms worth having: you come back on one and heal up before leaving.
   */
  randomSpawnPoint() {
    if (this.fountains.length > 0) {
      const fountain = this.fountains[Math.floor(random(this.fountains.length))];
      return fountain.randomPointInside();
    }

    return createVector(
      this.mapSize / 2 + random(-1000, 1000),
      this.mapSize / 2 + random(-1000, 1000)
    );
  }

  resize(w: number, h: number) { this.fogOfWar.resize(w, h); }

  createSpellContext(
    spell: Spell,
    caster: { readonly teamId?: unknown; readonly position: Vec2 },
    cursorWorld: Vec2
  ): CastContext | undefined {
    const result = TargetResolver.resolve(spell.castSpec.targeting, {
      spellId: spell.id,
      activationId: uuidv4(),
      startedAtMs: Date.now(),
      caster,
      casterTeamId: caster.teamId,
      origin: caster.position,
      cursorWorld,
      queryCandidates: () => this.objectManager.objects,
      isTargetable: defaultIsTargetable,
      getTargetInfo: defaultTargetInfo,
      ...spell.targetingRequest,
    });
    return result.ok ? result.context : undefined;
  }

  keyPressed(keyCode: number, repeated = false) {
    if (keyCode === 32 && !repeated) {
      this.camera.target = this.camera.target ? null! : this.player.position;
    }
    this.spellInputController.keyDown(keyCode, repeated);
  }

  keyReleased(keyCode: number) {
    this.spellInputController.keyUp(keyCode);
  }
}
