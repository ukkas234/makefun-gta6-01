// Procedural Solmara: 10x10 block grid, coast + beach + water to the south, low-poly
// hills around the other edges. All geometry is generated here from a seeded RNG;
// all textures are canvas-generated (see textures.js). No external assets.
//
// createCity(scene, rng) → {
//   group, colliders, roadGraph, spawnPoints, buildings,
//   isOnRoad(x,z), nearestRoadPoint(x,z), collideCircle(x,z,r), pushOut(x,z,r),
//   isOnBeach(x,z), isInWater(x,z), setNightFactor(f), setNight(f), update(dt),
//   nightFactor, bounds, roadLines, blockLines, water
// }
//
// Positions: ground plane y=0, x east, z south. Colliders are AABBs {x, z, hx, hz}
// of buildings and trees; roads are drivable everywhere else.
import * as THREE from '../vendor/three.module.js';
import { BLOCK_LINES, CITY, COLORS, ROAD_LINES } from './config.js';
import { mulberry32, pick, randInt, range } from './random.js';
import {
  asphaltTexture,
  facadeGlowTexture,
  facadeTexture,
  grassTexture,
  neonTexture,
  roofTexture,
  sandTexture,
  sidewalkTexture,
  waterTexture,
} from './textures.js';

const HALF = CITY.half;

/** Facade material sets shared by all buildings (8 sets keep texture memory low). */
function makeFacadeSets() {
  const sets = [];
  for (let i = 0; i < 8; i += 1) {
    const variant = i % 6;
    const seed = Math.floor(i / 6);
    sets.push({
      day: facadeTexture(variant, false, seed),
      glow: facadeGlowTexture(variant, seed),
    });
  }
  return sets;
}

export function createCity(scene, rngInput) {
  const rng = typeof rngInput === 'function' ? rngInput : mulberry32(typeof rngInput === 'number' ? rngInput : CITY.seed);
  const group = new THREE.Group();
  group.name = 'solmara-city';
  scene.add(group);

  const colliders = [];
  const buildings = [];
  const facadeMats = [];
  const neonMats = [];
  const lampMats = [];
  let nightFactor = 0;

  // ---- shared materials / textures -------------------------------------------
  const facadeSets = makeFacadeSets();
  const roofTex = roofTexture();
  const roofMat = new THREE.MeshLambertMaterial({ map: roofTex, color: 0xffffff });
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x1c1e22 });
  const facadeMaterials = facadeSets.map((set) => {
    const mat = new THREE.MeshLambertMaterial({
      map: set.day,
      emissiveMap: set.glow,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0,
    });
    facadeMats.push(mat);
    return mat;
  });
  const grassTex = grassTexture();
  grassTex.repeat.set(40, 40);
  const sandTex = sandTexture();
  sandTex.repeat.set(24, 3);
  const sidewalkTex = sidewalkTexture();
  sidewalkTex.repeat.set(3, 3);
  const asphaltTexV = asphaltTexture();
  asphaltTexV.repeat.set(1, 22);
  const asphaltTexH = asphaltTexture();
  asphaltTexH.repeat.set(22, 1);
  const waterTex = waterTexture();
  waterTex.repeat.set(8, 4);

  const groundMat = new THREE.MeshLambertMaterial({ map: grassTex, color: 0xffffff });
  const sandMat = new THREE.MeshLambertMaterial({ map: sandTex, color: 0xffffff });
  const sidewalkMat = new THREE.MeshLambertMaterial({ map: sidewalkTex, color: 0xffffff });
  const asphaltMatV = new THREE.MeshLambertMaterial({ map: asphaltTexV, color: 0xffffff });
  const asphaltMatH = new THREE.MeshLambertMaterial({ map: asphaltTexH, color: 0xffffff });
  const waterMat = new THREE.MeshLambertMaterial({
    map: waterTex,
    color: 0x9fd4e8,
    transparent: true,
    opacity: 0.92,
  });

  function addMesh(geometry, material, x, y, z, parent = group) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  // ---- ground, beach, water ---------------------------------------------------
  const ground = addMesh(new THREE.PlaneGeometry(1160, 1160), groundMat, 0, -0.08, 30);
  ground.rotation.x = -Math.PI / 2;
  const beach = addMesh(new THREE.PlaneGeometry(580, CITY.beachEnd - CITY.beachStart), sandMat, 0, 0.0, (CITY.beachStart + CITY.beachEnd) / 2);
  beach.rotation.x = -Math.PI / 2;
  const water = addMesh(new THREE.PlaneGeometry(1160, 320), waterMat, 0, -0.25, CITY.waterStart + 160);
  water.rotation.x = -Math.PI / 2;

  // ---- roads ------------------------------------------------------------------
  const roadGeoV = new THREE.PlaneGeometry(CITY.roadWidth, CITY.size);
  const roadGeoH = new THREE.PlaneGeometry(CITY.size, CITY.roadWidth);
  for (const line of ROAD_LINES) {
    const v = addMesh(roadGeoV, asphaltMatV, line, 0.01, 0);
    v.rotation.x = -Math.PI / 2;
    const h = addMesh(roadGeoH, asphaltMatH, 0, 0.015, line);
    h.rotation.x = -Math.PI / 2;
  }

  // ---- sidewalks (one slab per block, buildings sit on top) -------------------
  const sidewalkGeo = new THREE.PlaneGeometry(42, 42);
  for (const bx of BLOCK_LINES) {
    for (const bz of BLOCK_LINES) {
      const slab = addMesh(sidewalkGeo, sidewalkMat, bx, 0.02, bz);
      slab.rotation.x = -Math.PI / 2;
    }
  }

  // ---- buildings ---------------------------------------------------------------
  const boxGeoCache = new Map();
  function boxGeometry(w, h, d) {
    const key = `${w}|${h}|${d}`;
    if (!boxGeoCache.has(key)) boxGeoCache.set(key, new THREE.BoxGeometry(w, h, d));
    return boxGeoCache.get(key);
  }

  function buildingSlots(count) {
    if (count === 1) return [{ cx: 0, cz: 0, w: range(rng, 22, 30), d: range(rng, 22, 30) }];
    if (count === 2) {
      return [
        { cx: -10, cz: 0, w: range(rng, 13, 15), d: range(rng, 20, 28) },
        { cx: 10, cz: 0, w: range(rng, 13, 15), d: range(rng, 20, 28) },
      ];
    }
    if (count === 3) {
      return [
        { cx: -10, cz: -10, w: range(rng, 13, 15), d: range(rng, 13, 15) },
        { cx: 10, cz: -10, w: range(rng, 13, 15), d: range(rng, 13, 15) },
        { cx: 0, cz: 10, w: range(rng, 24, 28), d: range(rng, 12, 14) },
      ];
    }
    return [
      { cx: -10, cz: -10, w: range(rng, 13, 15), d: range(rng, 13, 15) },
      { cx: 10, cz: -10, w: range(rng, 13, 15), d: range(rng, 13, 15) },
      { cx: -10, cz: 10, w: range(rng, 13, 15), d: range(rng, 13, 15) },
      { cx: 10, cz: 10, w: range(rng, 13, 15), d: range(rng, 13, 15) },
    ];
  }

  function heightFor(bx, bz) {
    const centreDist = Math.max(Math.abs(bx), Math.abs(bz));
    const hMax = centreDist < 60 ? 60 : centreDist < 120 ? 40 : centreDist < 170 ? 26 : 18;
    let h = range(rng, 8, hMax);
    if (rng() < 0.14) h = hMax;
    return Math.round(h);
  }

  let blockIndex = 0;
  for (const bx of BLOCK_LINES) {
    for (const bz of BLOCK_LINES) {
      const centreDist = Math.max(Math.abs(bx), Math.abs(bz));
      const downtown = centreDist < 120;
      const count = downtown ? randInt(rng, 2, 4) : randInt(rng, 1, 3);
      const slots = buildingSlots(count);
      for (const slot of slots) {
        const w = slot.w;
        const d = slot.d;
        const h = heightFor(bx, bz);
        const x = bx + slot.cx + range(rng, -1, 1);
        const z = bz + slot.cz + range(rng, -1, 1);
        const setIndex = randInt(rng, 0, facadeSets.length - 1);
        const facadeMat = facadeMaterials[setIndex];
        const mesh = new THREE.Mesh(boxGeometry(w, h, d), [facadeMat, facadeMat, roofMat, darkMat, facadeMat, facadeMat]);
        mesh.position.set(x, h / 2 + 0.02, z);
        group.add(mesh);
        colliders.push({ x, z, hx: w / 2, hz: d / 2 });
        buildings.push({ mesh, x, z, w, d, h, hx: w / 2, hz: d / 2, variant: setIndex, blockX: bx, blockZ: bz, downtown });
        // Rooftop AC box on some taller buildings.
        if (h > 20 && rng() < 0.35) {
          const ac = addMesh(new THREE.BoxGeometry(3, 1.2, 2.4), darkMat, x + range(rng, -w / 4, w / 4), h + 0.6, z + range(rng, -d / 4, d / 4));
          ac.position.y = h + 0.02 + 0.6;
        }
      }
      blockIndex += 1;
    }
  }

  // ---- neon signs ---------------------------------------------------------------
  const NEON_SIGNS = [
    ['SOLMARA', '#ff4fa3'],
    ['HOTEL LUNA', '#35e0ff'],
    ['NEON BAR', '#ff4fa3'],
    ['CASINO', '#ffd23f'],
    ['TACOS', '#52ff8a'],
    ['24H MART', '#35e0ff'],
    ['PALMS', '#52ff8a'],
    ['PIER 9', '#ffd23f'],
    ['DANCE', '#ff4fa3'],
    ['RAMEN', '#35e0ff'],
  ];
  function addNeonSign(text, color, x, y, z, width = 14) {
    const tex = neonTexture(text, color);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.35, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 4), mat);
    mesh.position.set(x, y, z);
    group.add(mesh);
    neonMats.push({ mat, day: 0.35, night: 1 });
    return mesh;
  }
  const downtownBuildings = buildings.filter((b) => b.downtown && b.h > 18);
  for (let i = 0; i < NEON_SIGNS.length && i < downtownBuildings.length; i += 1) {
    const b = downtownBuildings[Math.floor((i / NEON_SIGNS.length) * downtownBuildings.length)];
    const [text, color] = NEON_SIGNS[i];
    addNeonSign(text, color, b.x, Math.min(b.h * 0.72, b.h - 3), b.z + b.hz + 0.08, Math.min(16, b.w + 2));
  }

  // ---- streetlights (every other intersection) ----------------------------------
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.13, 5.5, 6);
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x2b2d33 });
  const lampGeo = new THREE.SphereGeometry(0.3, 8, 6);
  for (let ix = 0; ix < ROAD_LINES.length; ix += 2) {
    for (let iz = 0; iz < ROAD_LINES.length; iz += 2) {
      const x = ROAD_LINES[ix] + 7.2;
      const z = ROAD_LINES[iz] + 7.2;
      addMesh(poleGeo, poleMat, x, 2.75, z);
      const lampMat = new THREE.MeshBasicMaterial({ color: 0x8a7a5a });
      const lamp = addMesh(lampGeo, lampMat, x, 5.6, z);
      lamp.scale.y = 0.7;
      lampMats.push({ mat: lampMat, day: new THREE.Color(0x8a7a5a), night: new THREE.Color(COLORS.lampWarm) });
    }
  }

  // ---- trees: street trees + beach palms -----------------------------------------
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 2.6, 6);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2f });
  const leafGeo = new THREE.IcosahedronGeometry(1.7, 0);
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x3f7031, flatShading: true });
  const palmLeafMat = new THREE.MeshLambertMaterial({ color: 0x2f7a3a, flatShading: true });
  function addTree(x, z, palm) {
    addMesh(trunkGeo, trunkMat, x, 1.3, z);
    const leaves = addMesh(leafGeo, palm ? palmLeafMat : leafMat, x, palm ? 3.6 : 3.4, z);
    leaves.scale.y = palm ? 0.55 : 1;
    colliders.push({ x, z, hx: 0.45, hz: 0.45 });
  }
  for (let i = 0; i < 26; i += 1) {
    const bx = pick(rng, BLOCK_LINES);
    const bz = pick(rng, BLOCK_LINES);
    addTree(bx + (rng() < 0.5 ? -18.5 : 18.5), bz + (rng() < 0.5 ? -18.5 : 18.5), false);
  }
  for (let i = 0; i < 14; i += 1) {
    addTree(-250 + i * 38 + range(rng, -6, 6), 272 + range(rng, -4, 10), true);
  }

  // ---- hills backdrop (north, west, east) -----------------------------------------
  const hillMat = new THREE.MeshLambertMaterial({ color: COLORS.hill, flatShading: true });
  const hillMatFar = new THREE.MeshLambertMaterial({ color: COLORS.hillFar, flatShading: true });
  function addHill(x, z, radius, height, far) {
    const hill = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 7), far ? hillMatFar : hillMat);
    hill.position.set(x, height / 2 - 2, z);
    hill.rotation.y = rng() * Math.PI;
    group.add(hill);
  }
  for (let i = 0; i < 9; i += 1) addHill(-400 + i * 100 + range(rng, -20, 20), -345 - range(rng, 0, 70), range(rng, 55, 105), range(rng, 35, 85), i % 2 === 0);
  for (let i = 0; i < 5; i += 1) addHill(-365 - range(rng, 0, 50), -200 + i * 120, range(rng, 50, 90), range(rng, 30, 65), i % 2 === 0);
  for (let i = 0; i < 5; i += 1) addHill(365 + range(rng, 0, 50), -200 + i * 120, range(rng, 50, 90), range(rng, 30, 65), i % 2 === 0);

  // ---- landmarks + spawn points ----------------------------------------------------
  function buildingInBlock(bx, bz) {
    let best = null;
    for (const b of buildings) {
      if (b.blockX === bx && b.blockZ === bz) {
        if (!best || b.h > best.h) best = b;
      }
    }
    return best;
  }
  function landmarkSign(bx, bz, text, color) {
    const b = buildingInBlock(bx, bz);
    if (!b) return null;
    return addNeonSign(text, color, b.x, Math.min(b.h * 0.8, b.h - 2.5), b.z + b.hz + 0.08, Math.min(18, b.w + 4));
  }
  landmarkSign(26, -26, 'BANK OF SOLMARA', '#ffd23f');
  landmarkSign(-78, 78, 'HOSPITAL', '#35e0ff');
  landmarkSign(78, 130, 'POLICE', '#2f6df6');
  landmarkSign(-182, 182, 'GARAGE', '#35e0ff');
  landmarkSign(182, -182, 'SAFEHOUSE', '#52ff8a');

  const spawnPoints = {
    player: { x: 0, z: 208 },
    garage: { x: -182, z: 208 },
    bank: { x: 26, z: 0 },
    safehouse: { x: 182, z: -208 },
    hospital: { x: -78, z: 52 },
    policeStation: { x: 78, z: 104 },
    packages: [],
  };
  for (let i = 0; i < 10; i += 1) {
    if (i < 8) {
      const bx = pick(rng, BLOCK_LINES);
      const bz = pick(rng, BLOCK_LINES);
      spawnPoints.packages.push({
        x: bx + (rng() < 0.5 ? -18.5 : 18.5),
        z: bz + (rng() < 0.5 ? -18.5 : 18.5),
      });
    } else {
      spawnPoints.packages.push({ x: -180 + i * 90 + range(rng, -20, 20), z: 274 + range(rng, -3, 8) });
    }
  }
  spawnPoints.list = [
    { name: 'player', ...spawnPoints.player },
    { name: 'garage', ...spawnPoints.garage },
    { name: 'bank', ...spawnPoints.bank },
    { name: 'safehouse', ...spawnPoints.safehouse },
    { name: 'hospital', ...spawnPoints.hospital },
    { name: 'policeStation', ...spawnPoints.policeStation },
  ];

  // ---- road graph: 11x11 intersection nodes, edges to right/down neighbours -------
  const nodes = [];
  const nodeIndex = new Map();
  for (let iz = 0; iz < ROAD_LINES.length; iz += 1) {
    for (let ix = 0; ix < ROAD_LINES.length; ix += 1) {
      const id = iz * ROAD_LINES.length + ix;
      nodes.push({ id, ix, iz, x: ROAD_LINES[ix], z: ROAD_LINES[iz] });
      nodeIndex.set(`${ROAD_LINES[ix]},${ROAD_LINES[iz]}`, id);
    }
  }
  const edges = [];
  const adjacency = new Map(nodes.map((n) => [n.id, []]));
  function link(a, b) {
    edges.push({ a, b, length: CITY.pitch });
    adjacency.get(a).push(b);
    adjacency.get(b).push(a);
  }
  for (const n of nodes) {
    if (n.ix < ROAD_LINES.length - 1) link(n.id, n.id + 1);
    if (n.iz < ROAD_LINES.length - 1) link(n.id, n.id + ROAD_LINES.length);
  }
  const roadGraph = {
    nodes,
    edges,
    adjacency,
    nodeAt(ix, iz) {
      if (ix < 0 || iz < 0 || ix >= ROAD_LINES.length || iz >= ROAD_LINES.length) return null;
      return nodes[iz * ROAD_LINES.length + ix];
    },
    nearestNode(x, z) {
      let best = nodes[0];
      let bestD = Infinity;
      for (const n of nodes) {
        const d = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z);
        if (d < bestD) {
          bestD = d;
          best = n;
        }
      }
      return best;
    },
    neighbours(id) {
      return (adjacency.get(id) || []).map((other) => nodes[other]);
    },
    neighboursOf(id) {
      return (adjacency.get(id) || []).map((other) => nodes[other]);
    },
  };

  // ---- queries ----------------------------------------------------------------------
  function distToLine(v, lines) {
    let best = Infinity;
    for (const line of lines) best = Math.min(best, Math.abs(v - line));
    return best;
  }
  function nearestLine(v) {
    let best = ROAD_LINES[0];
    let bestD = Infinity;
    for (const line of ROAD_LINES) {
      const d = Math.abs(v - line);
      if (d < bestD) {
        bestD = d;
        best = line;
      }
    }
    return best;
  }

  function isOnRoad(x, z) {
    if (x < -HALF - 6 || x > HALF + 6 || z < -HALF - 6 || z > HALF + 6) return false;
    return distToLine(x, ROAD_LINES) <= CITY.roadWidth / 2 || distToLine(z, ROAD_LINES) <= CITY.roadWidth / 2;
  }

  function nearestRoadPoint(x, z) {
    const vx = nearestLine(x);
    const hz = nearestLine(z);
    let px = x;
    let pz = z;
    if (Math.abs(x - vx) <= Math.abs(z - hz)) px = vx;
    else pz = hz;
    return {
      x: Math.max(-HALF, Math.min(HALF, px)),
      z: Math.max(-HALF, Math.min(HALF, pz)),
    };
  }

  function collideCircle(x, z, r) {
    for (const c of colliders) {
      const cx = Math.max(c.x - c.hx, Math.min(x, c.x + c.hx));
      const cz = Math.max(c.z - c.hz, Math.min(z, c.z + c.hz));
      const dx = x - cx;
      const dz = z - cz;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }

  /**
   * Push a circle out of every collider it touches; returns corrected {x, z, collided}.
   * Iterates to a fixpoint because pushing out of one building can land inside
   * a neighbour (buildings in one block stand a few metres apart).
   */
  function pushOut(x, z, r) {
    let px = x;
    let pz = z;
    let collided = false;
    for (let pass = 0; pass < 4; pass += 1) {
      let moved = false;
      for (const c of colliders) {
        const cx = Math.max(c.x - c.hx, Math.min(px, c.x + c.hx));
        const cz = Math.max(c.z - c.hz, Math.min(pz, c.z + c.hz));
        const dx = px - cx;
        const dz = pz - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        collided = true;
        moved = true;
        const overlapX = c.hx + r - Math.abs(px - c.x);
        const overlapZ = c.hz + r - Math.abs(pz - c.z);
        if (overlapX < overlapZ) px = c.x + (px >= c.x ? overlapX : -overlapX);
        else pz = c.z + (pz >= c.z ? overlapZ : -overlapZ);
      }
      if (!moved) break;
    }
    return { x: px, z: pz, collided };
  }

  function isOnBeach(x, z) {
    return z >= CITY.beachStart && z < CITY.beachEnd && Math.abs(x) <= 290;
  }
  function isInWater(x, z) {
    return z >= CITY.waterStart;
  }

  // ---- day/night ----------------------------------------------------------------------
  function setNightFactor(f) {
    nightFactor = Math.max(0, Math.min(1, f));
    for (const mat of facadeMats) mat.emissiveIntensity = nightFactor * 0.9;
    for (const entry of neonMats) entry.mat.opacity = entry.day + (entry.night - entry.day) * nightFactor;
    for (const entry of lampMats) entry.mat.color.copy(entry.day).lerp(entry.night, nightFactor);
  }
  /** Alias: some callers say setNight. */
  const setNight = setNightFactor;

  function update(dt) {
    waterTex.offset.y += dt * 0.02;
    waterTex.offset.x += dt * 0.005;
  }

  const api = {
    group,
    colliders,
    roadGraph,
    spawnPoints,
    buildings,
    isOnRoad,
    nearestRoadPoint,
    collideCircle,
    pushOut,
    isOnBeach,
    isInWater,
    setNightFactor,
    setNight,
    update,
    get nightFactor() {
      return nightFactor;
    },
    bounds: { min: -HALF, max: HALF, beachStart: CITY.beachStart, waterStart: CITY.waterStart },
    roadLines: ROAD_LINES,
    blockLines: BLOCK_LINES,
    water,
    ground,
  };
  // Let render.js drive night materials through setTimeOfDay: the scene is the
  // one object both modules share, so the city registers itself on it.
  scene.userData.solmaraCity = api;
  return api;
}
