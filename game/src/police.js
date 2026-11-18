// police.js — Solmara wanted system + police.
//
// createPolice(scene, city) -> { wanted, addWanted(n), update(dt, player, cars),
//   reset(), nearestCopDist(x, z), cars, foot, cops }
//
// Rules (design doc):
//   - wanted 0-5 stars. +1 for stealing in sight / hitting a ped / shooting /
//     ramming a cop (main.js calls addWanted for those events).
//   - Decay: -1 per 20 s while hidden (no cop within 60 m of the player).
//   - Police count scales with stars: 1 star = 1 patrol car, +1 car per star
//     (cap 4 cars), plus on-foot cops from 1 star up (2, then 4 at 3 stars, 6 at 5).
//   - Police cars chase and ram the player's car; on-foot cops chase the player.
//   - A cop within 2 m of the on-foot player for a continuous 2 s -> BUSTED:
//     update() returns { busted: true, wanted } in that frame.
//   - Cop entities (cars and foot cops) expose { x, z, radius, alive, takeDamage }
//     so the player's hitscan shooting / punching can target them via main.js,
//     which passes them in the player's world.targets list.
//   - Police cars are vehicles.js sedans in black-and-white with a red/blue light
//     bar; on-foot cops are simple box characters in dark-blue uniform.
import * as THREE from '../vendor/three.module.js';
import { createCar, driveCar, wrapAngle } from './vehicles.js';

const MAX_WANTED = 5;
const DECAY_HIDDEN_SECONDS = 20;
const HIDDEN_DIST = 60;
const BUST_DIST = 2;
const BUST_TIME = 2;
const COP_CAR_SPEED = 1; // full throttle; sedan topSpeed 32 m/s
const FOOT_COP_SPEED = 5.6; // faster than walking (4.5), slower than running (7.5)
const SPAWN_DIST_MIN = 60;
const SPAWN_DIST_MAX = 110;
const DESPAWN_DIST = 350;
const ROAD_MIN = -260;
const ROAD_MAX = 260;
const ROAD_STEP = 52;

function box(w, h, d, color, x, y, z, opts = {}) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({
      color, emissive: opts.emissive ?? 0x000000, emissiveIntensity: opts.emissiveIntensity ?? 1,
    }),
  );
  m.position.set(x, y, z);
  return m;
}

function buildFootCopMesh() {
  const g = new THREE.Group();
  const legGeo = new THREE.BoxGeometry(0.16, 0.75, 0.16);
  legGeo.translate(0, -0.375, 0);
  const legMat = new THREE.MeshLambertMaterial({ color: 0x1a2333 });
  const legL = new THREE.Mesh(legGeo, legMat);
  legL.position.set(-0.11, 0.78, 0);
  const legR = new THREE.Mesh(legGeo, legMat);
  legR.position.set(0.11, 0.78, 0);
  const torso = box(0.52, 0.62, 0.28, 0x22345c, 0, 1.12, 0); // dark-blue uniform
  const badge = box(0.1, 0.1, 0.02, 0xf2c230, -0.14, 1.28, 0.15);
  const armGeo = new THREE.BoxGeometry(0.13, 0.6, 0.13);
  armGeo.translate(0, -0.3, 0);
  const armMat = new THREE.MeshLambertMaterial({ color: 0x22345c });
  const armL = new THREE.Mesh(armGeo, armMat);
  armL.position.set(-0.33, 1.38, 0);
  const armR = new THREE.Mesh(armGeo, armMat);
  armR.position.set(0.33, 1.38, 0);
  const head = box(0.3, 0.3, 0.28, 0xd9a066, 0, 1.6, 0);
  const cap = box(0.34, 0.1, 0.32, 0x1a2333, 0, 1.78, 0);
  const brim = box(0.32, 0.04, 0.16, 0x1a2333, 0, 1.74, 0.22);
  g.add(legL, legR, torso, badge, armL, armR, head, cap, brim);
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.45, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  g.add(shadow);
  g.userData = { legL, legR, armL, armR };
  return g;
}

export function createPolice(scene, city) {
  const api = {
    wanted: 0,
    cars: [],   // police car objects (vehicles.js cars + health/takeDamage)
    foot: [],   // on-foot cop entities
    addWanted,
    setWanted,
    spawnCar: spawnPoliceCar,
    update,
    reset,
    nearestCopDist,
  };
  // Convenience for main.js shooting targets: all shootable cop entities.
  Object.defineProperty(api, 'cops', {
    get() { return [...api.foot, ...api.cars]; },
  });

  let hiddenTimer = 0;   // seconds with no cop within HIDDEN_DIST (drives decay)
  let freshHeat = 0;     // seconds of guaranteed cop spawns after a fresh crime /
                         // after a star decays (the remaining stars send a new wave)
  let bustTimer = 0;
  let flashT = 0;

  function targetCarCount() {
    return Math.min(api.wanted, 4);
  }
  function targetFootCount() {
    if (api.wanted <= 0) return 0;
    if (api.wanted >= 5) return 6;
    if (api.wanted >= 3) return 4;
    return 2;
  }

  // A road point roughly `dist` from (x, z): snap with city.nearestRoadPoint when
  // available, else fall back to the design-doc road grid.
  function roadPointNear(x, z, dist) {
    for (let tries = 0; tries < 10; tries += 1) {
      const a = Math.random() * Math.PI * 2;
      const px = x + Math.cos(a) * dist;
      const pz = z + Math.sin(a) * dist;
      if (city && typeof city.nearestRoadPoint === 'function') {
        const p = city.nearestRoadPoint(px, pz);
        if (p && Math.hypot(p.x - x, p.z - z) < dist * 1.6) return { x: p.x, z: p.z };
      } else {
        const rx = Math.max(ROAD_MIN, Math.min(ROAD_MAX, Math.round(px / ROAD_STEP) * ROAD_STEP));
        const rz = Math.max(ROAD_MIN, Math.min(ROAD_MAX, Math.round(pz / ROAD_STEP) * ROAD_STEP));
        return { x: rx, z: rz };
      }
    }
    return { x: Math.max(ROAD_MIN, Math.min(ROAD_MAX, x)), z: Math.max(ROAD_MIN, Math.min(ROAD_MAX, z)) };
  }

  function addLightBar(car) {
    const bar = new THREE.Group();
    const red = box(0.34, 0.12, 0.5, 0xcc0000, -0.2, 1.42, -0.25,
      { emissive: 0xff0000, emissiveIntensity: 1 });
    const blue = box(0.34, 0.12, 0.5, 0x0044cc, 0.2, 1.42, -0.25,
      { emissive: 0x0044ff, emissiveIntensity: 1 });
    bar.add(red, blue);
    car.mesh.add(bar);
    car._lightRed = red;
    car._lightBlue = blue;
  }

  function spawnPoliceCar(player) {
    const spot = roadPointNear(player.x, player.z,
      SPAWN_DIST_MIN + Math.random() * (SPAWN_DIST_MAX - SPAWN_DIST_MIN));
    const heading = Math.atan2(player.x - spot.x, player.z - spot.z);
    const car = createCar('sedan', spot.x, spot.z, heading, 0x14161c);
    car.isPolice = true;
    // White doors: two thin white panels on the body sides.
    for (const sx of [-1, 1]) {
      car.mesh.add(box(0.02, 0.4, 1.6, 0xe8e8e8, sx * (car.width / 2 + 0.01), 0.62, -0.2));
    }
    addLightBar(car);
    car.health = 100;
    car.alive = true;
    car._removeAt = 0;
    car.takeDamage = (n) => {
      if (!car.alive) return;
      car.health -= n;
      if (car.health <= 0) {
        car.alive = false;
        car._removeAt = 4; // seconds until the wreck is towed (removed)
        car.mesh.rotation.z = 0.12; // disabled, tilted
      }
    };
    scene.add(car.mesh);
    api.cars.push(car);
    return car;
  }

  function spawnFootCop(x, z) {
    const mesh = buildFootCopMesh();
    mesh.position.set(x, 0, z);
    scene.add(mesh);
    const cop = {
      mesh,
      x, z,
      heading: 0,
      speed: 0,
      health: 50,
      alive: true,
      radius: 0.5,
      walkPhase: Math.random() * 6,
      _removeAt: 0,
      takeDamage(n) {
        if (!cop.alive) return;
        cop.health -= n;
        if (cop.health <= 0) {
          cop.alive = false;
          cop._removeAt = 3;
          mesh.rotation.x = -Math.PI / 2 + 0.15; // down
          mesh.position.y = 0.25;
        }
      },
    };
    api.foot.push(cop);
    return cop;
  }

  function removeCar(car) {
    scene.remove(car.mesh);
    const i = api.cars.indexOf(car);
    if (i >= 0) api.cars.splice(i, 1);
  }
  function removeFootCop(cop) {
    scene.remove(cop.mesh);
    const i = api.foot.indexOf(cop);
    if (i >= 0) api.foot.splice(i, 1);
  }

  function addWanted(n) {
    api.wanted = Math.max(0, Math.min(MAX_WANTED, api.wanted + n));
    if (n > 0) {
      hiddenTimer = 0;
      freshHeat = 5; // fresh crime: cops spawn even though none is near yet
    }
    return api.wanted;
  }

  // Set the wanted level directly, with no spawn/despawn side effects.
  // Shot staging relies on this: setWanted(3) after placing police cars
  // must only set the number, not wipe the staged cars via reset().
  // (main.js already guards for this method at the wanted-decay site.)
  function setWanted(n) {
    api.wanted = Math.max(0, Math.min(MAX_WANTED, n));
    return api.wanted;
  }

  function reset() {
    for (const car of [...api.cars]) removeCar(car);
    for (const cop of [...api.foot]) removeFootCop(cop);
    api.wanted = 0;
    hiddenTimer = 0;
    freshHeat = 0;
    bustTimer = 0;
  }

  function nearestCopDist(x, z) {
    let best = Infinity;
    for (const car of api.cars) {
      if (!car.alive) continue;
      best = Math.min(best, Math.hypot(car.x - x, car.z - z));
    }
    for (const cop of api.foot) {
      if (!cop.alive) continue;
      best = Math.min(best, Math.hypot(cop.x - x, cop.z - z));
    }
    return best;
  }

  function update(dt, player, cars = []) {
    flashT += dt;
    const px = player.x;
    const pz = player.z;
    const playerCar = player.onFoot ? null : player.car;

    // --- Wanted decay: -1 per 20 s while no cop is within 60 m. ---
    // Cops only (re)spawn while the player is hot (a cop is near) or during the
    // fresh-heat window after a crime / a decay tick; while hidden, far cops are
    // dropped instead of respawned, so the player can actually lose the heat.
    freshHeat = Math.max(0, freshHeat - dt);
    const nearest = nearestCopDist(px, pz);
    const hot = nearest <= HIDDEN_DIST || freshHeat > 0;
    if (api.wanted > 0) {
      if (nearest > HIDDEN_DIST) {
        hiddenTimer += dt;
        if (hiddenTimer >= DECAY_HIDDEN_SECONDS) {
          api.wanted = Math.max(0, api.wanted - 1);
          hiddenTimer = 0;
          freshHeat = 5; // remaining stars send a fresh wave
        }
      } else {
        hiddenTimer = 0;
      }
    }

    // --- Keep the force at the wanted level (only while hot). ---
    while (hot && api.cars.filter((c) => c.alive).length < targetCarCount()) spawnPoliceCar(player);
    while (api.cars.filter((c) => c.alive).length > targetCarCount()) {
      const extra = api.cars.find((c) => c.alive);
      if (extra) removeCar(extra);
      else break;
    }
    // On-foot cops deploy from patrol cars when the player is on foot; if the
    // player is driving, foot cops wait at their car.
    const wantFoot = player.onFoot ? targetFootCount() : 0;
    while (hot && api.foot.filter((c) => c.alive).length < wantFoot) {
      const anchor = api.cars.find((c) => c.alive);
      if (anchor) spawnFootCop(anchor.x + (Math.random() - 0.5) * 3, anchor.z + (Math.random() - 0.5) * 3);
      else break; // no patrol car to deploy from while hidden: nobody spawns
    }
    while (api.foot.filter((c) => c.alive).length > wantFoot) {
      const extra = api.foot.find((c) => c.alive);
      if (extra) removeFootCop(extra);
      else break;
    }

    // --- Police cars: chase the player (car or on foot), ram the player's car. ---
    for (const car of [...api.cars]) {
      if (!car.alive) {
        car._removeAt -= dt;
        if (car._removeAt <= 0) removeCar(car);
        continue;
      }
      // Too far away: if the player is hot the car re-joins the chase near the
      // player; if the player is hidden the car is dropped (it lost the trail).
      if (Math.hypot(car.x - px, car.z - pz) > DESPAWN_DIST) {
        if (hot) {
          const spot = roadPointNear(px, pz, SPAWN_DIST_MIN + Math.random() * 40);
          car.x = spot.x;
          car.z = spot.z;
          car.speed = 0;
        } else {
          removeCar(car);
          continue;
        }
      }
      const tx = playerCar ? playerCar.x : px;
      const tz = playerCar ? playerCar.z : pz;
      const dist = Math.hypot(tx - car.x, tz - car.z);
      const desired = Math.atan2(tx - car.x, tz - car.z);
      const steer = Math.max(-1, Math.min(1, wrapAngle(desired - car.heading) * 1.8));
      // A patrol car stops ~5 m short of an on-foot player (foot cops do the arrest);
      // against a player car it keeps pushing (ramming).
      const stopShort = !playerCar && dist < 5;
      // Don't rear-end traffic: brake if another car is right ahead.
      let blocked = false;
      if (!stopShort) {
        const fx = Math.sin(car.heading);
        const fz = Math.cos(car.heading);
        for (const o of cars) {
          if (o === car || o === playerCar) continue;
          const dx = o.x - car.x;
          const dz = o.z - car.z;
          const along = dx * fx + dz * fz;
          const perp = Math.abs(dx * fz - dz * fx);
          if (along > 0 && along < 7 && perp < 2.4) { blocked = true; break; }
        }
      }
      driveCar(car, dt, {
        throttle: stopShort || blocked ? 0 : COP_CAR_SPEED,
        steer,
        brake: stopShort || blocked,
        handbrake: false,
      }, city);

      // Ram: shove the player's car and scrub its speed on contact.
      if (playerCar && dist < playerCar.length * 0.5 + car.length * 0.5 + 0.4) {
        const pushX = (playerCar.x - car.x) / Math.max(dist, 0.01);
        const pushZ = (playerCar.z - car.z) / Math.max(dist, 0.01);
        playerCar.x += pushX * 3.5 * dt;
        playerCar.z += pushZ * 3.5 * dt;
        playerCar.speed *= (1 - 1.2 * dt);
        playerCar.mesh.position.set(playerCar.x, 0, playerCar.z);
      }

      // Flashing light bar: red and blue alternate.
      const phase = Math.sin(flashT * 12) > 0;
      if (car._lightRed) {
        car._lightRed.material.emissiveIntensity = phase ? 2.2 : 0.15;
        car._lightBlue.material.emissiveIntensity = phase ? 0.15 : 2.2;
      }
    }

    // --- On-foot cops: chase the player, arrest on contact. ---
    let busted = false;
    let anyClose = false;
    for (const cop of [...api.foot]) {
      if (!cop.alive) {
        cop._removeAt -= dt;
        if (cop._removeAt <= 0) removeFootCop(cop);
        continue;
      }
      if (!player.onFoot) {
        // Player drove off: foot cops hold position (they re-deploy from cars).
        cop.speed = 0;
        continue;
      }
      const dx = px - cop.x;
      const dz = pz - cop.z;
      const dist = Math.hypot(dx, dz);
      if (dist > DESPAWN_DIST) {
        // Lost the trail: rejoin from a patrol car while hot, else stand down.
        const anchor = api.cars.find((c) => c.alive);
        if (hot && anchor) { cop.x = anchor.x; cop.z = anchor.z; }
        else if (!hot) { removeFootCop(cop); continue; }
        else continue;
      }
      if (dist > 0.4) {
        cop.heading = Math.atan2(dx, dz);
        const step = FOOT_COP_SPEED * dt;
        const nx = cop.x + (dx / dist) * step;
        const nz = cop.z + (dz / dist) * step;
        const collide = city && typeof city.collideCircle === 'function'
          ? (x, z) => city.collideCircle(x, z, cop.radius) : () => false;
        if (!collide(nx, cop.z)) cop.x = nx;
        if (!collide(cop.x, nz)) cop.z = nz;
        cop.speed = FOOT_COP_SPEED;
      } else {
        cop.speed = 0;
      }
      // Walk-cycle animation.
      cop.walkPhase += cop.speed * dt * 2.2;
      const swing = cop.speed > 0 ? Math.sin(cop.walkPhase) * 0.5 : 0;
      cop.mesh.userData.legL.rotation.x = swing;
      cop.mesh.userData.legR.rotation.x = -swing;
      cop.mesh.userData.armL.rotation.x = -swing * 0.7;
      cop.mesh.userData.armR.rotation.x = swing * 0.7;
      cop.mesh.position.set(cop.x, 0, cop.z);
      cop.mesh.rotation.y = cop.heading;

      if (dist < BUST_DIST) anyClose = true;
    }
    if (anyClose) {
      bustTimer += dt;
      if (bustTimer >= BUST_TIME) {
        busted = true;
        bustTimer = 0;
      }
    } else {
      bustTimer = 0;
    }

    return { busted, wanted: api.wanted };
  }

  return api;
}
