// traffic.js — Solmara ambient traffic.
//
// createTraffic(scene, city, count) -> { cars, update(dt, playerPos), nearestCar(x, z, maxDist),
//   releaseCar(car), spawnCar() }
//
// AI cars are createCar() objects (vehicles.js) with an AI driver: they follow the road
// graph, turn at intersections, and stop when another car (or the player) is close ahead.
// Road graph handling is defensive: city.roadGraph may be {nodes, edges}, a plain node
// array, or {intersections}; if it is unusable, a 10x10 grid (roads at -260..260 step 52,
// per the design doc) is synthesized, so traffic works even before city.js lands.
// playerPos is the player object ({x, z, car}) or a plain {x, z}; the player's car is
// treated as an obstacle ahead, and an on-foot player crossing in front stops traffic.
import { createCar, driveCar, wrapAngle, CAR_TYPES } from './vehicles.js';

const ROAD_MIN = -260;
const ROAD_MAX = 260;
const ROAD_STEP = 52;
const STOP_DIST = 9;      // stop if something is this close ahead
const STOP_HALF_WIDTH = 2.3;
const LOOKAHEAD_NODE = 2; // metres from a node before picking the next one

function gridNodes() {
  const nodes = [];
  for (let x = ROAD_MIN; x <= ROAD_MAX; x += ROAD_STEP) {
    for (let z = ROAD_MIN; z <= ROAD_MAX; z += ROAD_STEP) {
      nodes.push({ x, z });
    }
  }
  return nodes;
}

// Build adjacency (node index -> [neighbour indices]) from a roadGraph of any of the
// shapes city.js might expose, or from the plain grid when nothing usable is given.
function buildGraph(city) {
  const rg = city?.roadGraph;
  let nodes = null;
  let edges = null;
  if (Array.isArray(rg)) nodes = rg;
  else if (rg && Array.isArray(rg.nodes)) { nodes = rg.nodes; edges = rg.edges ?? null; }
  else if (rg && Array.isArray(rg.intersections)) nodes = rg.intersections;
  if (!nodes || nodes.length < 2) {
    nodes = gridNodes();
    edges = null;
  }
  const key = (n) => `${n.x},${n.z}`;
  const indexOf = new Map(nodes.map((n, i) => [key(n), i]));
  const adj = nodes.map(() => []);
  const link = (a, b) => {
    if (a === b || a < 0 || b < 0) return;
    if (!adj[a].includes(b)) adj[a].push(b);
    if (!adj[b].includes(a)) adj[b].push(a);
  };
  if (Array.isArray(edges)) {
    for (const e of edges) {
      if (Array.isArray(e)) link(e[0], e[1]);
      else if (e && typeof e === 'object') link(e.from ?? e.a, e.to ?? e.b);
    }
  } else {
    // Grid adjacency: neighbours share an axis and are one step apart.
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const dx = Math.abs(nodes[i].x - nodes[j].x);
        const dz = Math.abs(nodes[i].z - nodes[j].z);
        if ((dx === ROAD_STEP && dz === 0) || (dz === ROAD_STEP && dx === 0)) link(i, j);
      }
    }
  }
  // Any node left isolated (bad graph data) gets grid neighbours by position.
  for (let i = 0; i < nodes.length; i += 1) {
    if (adj[i].length === 0) {
      for (let j = 0; j < nodes.length; j += 1) {
        if (i === j) continue;
        const dx = Math.abs(nodes[i].x - nodes[j].x);
        const dz = Math.abs(nodes[i].z - nodes[j].z);
        if ((dx === ROAD_STEP && dz === 0) || (dz === ROAD_STEP && dx === 0)) link(i, j);
      }
    }
  }
  return { nodes, adj, indexOf };
}

function randomRoadPoint(city, graph) {
  // Prefer a point actually on a road according to the city, else a grid point.
  for (let tries = 0; tries < 8; tries += 1) {
    const x = ROAD_MIN + Math.floor(Math.random() * 11) * ROAD_STEP;
    const z = ROAD_MIN + Math.random() * (ROAD_MAX - ROAD_MIN);
    if (!city || typeof city.isOnRoad !== 'function' || city.isOnRoad(x, z)) return { x, z };
  }
  const n = graph.nodes[Math.floor(Math.random() * graph.nodes.length)];
  return { x: n.x, z: n.z };
}

export function createTraffic(scene, city, count = 14) {
  const graph = buildGraph(city);
  const { nodes, adj } = graph;
  const cars = [];
  const types = Object.keys(CAR_TYPES);

  function pickNextNode(fromIdx, prevIdx) {
    const options = adj[fromIdx] ?? [];
    if (options.length === 0) return fromIdx;
    // Prefer going straight (same direction as we arrived), then turn; avoid U-turns
    // unless the node is a dead end.
    const straight = [];
    const turns = [];
    for (const o of options) {
      if (o === prevIdx) continue; // U-turn
      const dx = nodes[o].x - nodes[fromIdx].x;
      const dz = nodes[o].z - nodes[fromIdx].z;
      const px = nodes[fromIdx].x - nodes[prevIdx ?? fromIdx].x;
      const pz = nodes[fromIdx].z - nodes[prevIdx ?? fromIdx].z;
      if (prevIdx === undefined || (dx === px && dz === pz)) straight.push(o);
      else turns.push(o);
    }
    const pool = straight.length > 0 && Math.random() < 0.62 ? straight : turns;
    if (pool.length === 0) return options[Math.floor(Math.random() * options.length)];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function spawnCar() {
    const type = types[Math.floor(Math.random() * types.length)];
    const fromIdx = Math.floor(Math.random() * nodes.length);
    const toIdx = pickNextNode(fromIdx, undefined);
    const from = nodes[fromIdx];
    const to = nodes[toIdx];
    // Start a little way along the edge so cars are spread over roads, not stacked
    // on intersections.
    const t = Math.random() * 0.8;
    const x = from.x + (to.x - from.x) * t;
    const z = from.z + (to.z - from.z) * t;
    const heading = Math.atan2(to.x - from.x, to.z - from.z);
    const car = createCar(type, x, z, heading);
    car.isPlayer = false;
    scene.add(car.mesh);
    const ai = {
      car,
      fromIdx,
      toIdx,
      cruise: 7 + Math.random() * 5, // m/s, per-car personality
      stuckTimer: 0,
      lastX: x,
      lastZ: z,
    };
    car._ai = ai;
    cars.push(car);
    return car;
  }

  // Parked cars: a stationary car the player can steal. It joins traffic.cars
  // (so nearestCar / the minimap / police obstacle checks see it) but gets no
  // _ai, so update() never drives it.
  function parkCar(type, x, z, heading, color) {
    const car = createCar(type, x, z, heading, color);
    car.isPlayer = false;
    scene.add(car.mesh);
    cars.push(car);
    return car;
  }

  for (let i = 0; i < count; i += 1) spawnCar();

  // Is `other` close ahead of `car` (same lane-ish), so `car` should stop?
  function blockedAhead(car, others) {
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    for (const o of others) {
      if (o === car) continue;
      const dx = o.x - car.x;
      const dz = o.z - car.z;
      const dist = Math.hypot(dx, dz);
      if (dist > STOP_DIST + (o.radius ?? 1.5)) continue;
      const along = dx * fx + dz * fz;
      const perp = Math.abs(dx * fz - dz * fx);
      if (along > 0 && along < STOP_DIST + (o.radius ?? 1.5) && perp < STOP_HALF_WIDTH) return true;
    }
    return false;
  }

  function update(dt, playerPos) {
    const playerCar = playerPos?.car ?? null;
    const obstacles = [...cars];
    if (playerCar) obstacles.push(playerCar);
    // An on-foot player is an obstacle too (traffic stops for a crossing pedestrian).
    const playerOnFoot = playerPos && !playerCar && typeof playerPos.x === 'number'
      ? { x: playerPos.x, z: playerPos.z, radius: 0.5 } : null;
    if (playerOnFoot) obstacles.push(playerOnFoot);

    for (const car of [...cars]) {
      const ai = car._ai;
      if (!ai) continue;
      const target = nodes[ai.toIdx];

      // Reached the target intersection: pick the next leg.
      const distToNode = Math.hypot(target.x - car.x, target.z - car.z);
      if (distToNode < LOOKAHEAD_NODE) {
        const arrived = ai.toIdx;
        const prev = ai.fromIdx; // leg we arrived on — U-turns are avoided
        ai.fromIdx = arrived;
        ai.toIdx = pickNextNode(arrived, prev);
      }

      const desired = Math.atan2(nodes[ai.toIdx].x - car.x, nodes[ai.toIdx].z - car.z);
      const steer = Math.max(-1, Math.min(1, wrapAngle(desired - car.heading) * 1.6));
      const blocked = blockedAhead(car, obstacles);
      const throttle = blocked ? 0 : Math.min(1, ai.cruise / (CAR_TYPES[car.type].topSpeed));
      driveCar(car, dt, {
        throttle,
        steer,
        brake: blocked,
        handbrake: false,
      }, city);

      // Stuck (wedged on a building / another car): teleport to a fresh road point.
      const moved = Math.hypot(car.x - ai.lastX, car.z - ai.lastZ);
      if (moved < 0.05 && throttle > 0) ai.stuckTimer += dt;
      else ai.stuckTimer = 0;
      ai.lastX = car.x;
      ai.lastZ = car.z;
      if (ai.stuckTimer > 5) {
        const spot = randomRoadPoint(city, graph);
        car.x = spot.x;
        car.z = spot.z;
        car.speed = 0;
        const near = nearestNode(spot.x, spot.z);
        ai.fromIdx = near;
        ai.toIdx = pickNextNode(near, undefined);
        car.heading = Math.atan2(nodes[ai.toIdx].x - car.x, nodes[ai.toIdx].z - car.z);
        ai.stuckTimer = 0;
      }
    }
  }

  function nearestNode(x, z) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < nodes.length; i += 1) {
      const d = (nodes[i].x - x) ** 2 + (nodes[i].z - z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function nearestCar(x, z, maxDist) {
    let best = null;
    let bestD = maxDist;
    for (const car of cars) {
      const d = Math.hypot(car.x - x, car.z - z);
      if (d < bestD) { bestD = d; best = car; }
    }
    return best;
  }

  // Stealing: hand a traffic car to main.js (driver flees). The car leaves the
  // traffic list but its mesh stays in the scene under the caller's ownership.
  function releaseCar(car) {
    const i = cars.indexOf(car);
    if (i >= 0) cars.splice(i, 1);
    if (car._ai) delete car._ai;
  }

  return { cars, update, nearestCar, releaseCar, spawnCar, parkCar };
}
