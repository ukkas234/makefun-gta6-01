// player.js — Solmara third-person on-foot character ("Danny Reyes").
//
// createPlayer(scene, city) -> { mesh, x, z, heading, speed, health, onFoot, car,
//   armed, update(dt, input, city, cameraYaw, world), takeDamage(n), setPosition(x, z),
//   getState(), enterCar(car), exitCar(x, z), reset() }
//
// Input contract (input.js): input.keys is a Set of KeyboardEvent.code strings,
// input.pressed(code) is edge-triggered, input.consumeClick() is true once per mouse
// click. cameraYaw is the orbit camera's rotation.y; the camera sits behind the player
// at player + (sin(cameraYaw), cos(cameraYaw)) * dist, so W moves the player along the
// camera's view forward (-sin(cameraYaw), -cos(cameraYaw)) on the ground.
// world (optional, from main.js): { targets: [{x, z, radius, alive, takeDamage}],
//   onShoot({hit, x, z}), onPunch({hit, x, z}) } — shooting / punching callbacks.
// Shooting is a hitscan raycast marched in steps and blocked by buildings
// (city.collideCircle), so a target behind a wall cannot be hit.
import * as THREE from '../vendor/three.module.js';

const WALK_SPEED = 4.5;
const RUN_SPEED = 7.5;
const ACCEL = 40;
const JUMP_VELOCITY = 7.5;
const GRAVITY = 22;
const PLAYER_RADIUS = 0.45;
const PUNCH_RANGE = 1.9;
const PUNCH_ARC = 1.1; // radians either side of facing
const PUNCH_DAMAGE = 15;
const PUNCH_COOLDOWN = 0.45;
const SHOT_RANGE = 60;
const SHOT_STEP = 0.4;
const SHOT_DAMAGE = 34;
const SHOT_COOLDOWN = 0.22;
const DAMAGE_GRACE = 0.3;
const MAX_HEALTH = 100;

function box(w, h, d, color, x, y, z) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color }),
  );
  m.position.set(x, y, z);
  return m;
}

function buildPlayerMesh() {
  const g = new THREE.Group();
  // Legs (pivot at hip: geometry translated so rotation.x swings them).
  const legGeo = new THREE.BoxGeometry(0.16, 0.75, 0.16);
  legGeo.translate(0, -0.375, 0);
  const legMat = new THREE.MeshLambertMaterial({ color: 0x2b3a55 });
  const legL = new THREE.Mesh(legGeo, legMat);
  legL.position.set(-0.11, 0.78, 0);
  const legR = new THREE.Mesh(legGeo, legMat);
  legR.position.set(0.11, 0.78, 0);
  // Torso: teal jacket.
  const torso = box(0.52, 0.62, 0.28, 0x1f8a70, 0, 1.12, 0);
  // Arms (pivot at shoulder).
  const armGeo = new THREE.BoxGeometry(0.13, 0.6, 0.13);
  armGeo.translate(0, -0.3, 0);
  const armMat = new THREE.MeshLambertMaterial({ color: 0x1f8a70 });
  const armL = new THREE.Mesh(armGeo, armMat);
  armL.position.set(-0.33, 1.38, 0);
  const armR = new THREE.Mesh(armGeo, armMat);
  armR.position.set(0.33, 1.38, 0);
  // Head + cap.
  const head = box(0.3, 0.3, 0.28, 0xd9a066, 0, 1.6, 0);
  const cap = box(0.34, 0.1, 0.32, 0xc22a2a, 0, 1.78, 0);
  const brim = box(0.32, 0.04, 0.16, 0xc22a2a, 0, 1.74, 0.22);
  // Pistol, held in the right hand; only visible while armed.
  const pistol = box(0.06, 0.12, 0.3, 0x181818, 0.33, 1.05, 0.18);
  pistol.visible = false;

  g.add(legL, legR, torso, armL, armR, head, cap, brim, pistol);

  // Blob shadow.
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.45, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  g.add(shadow);

  g.userData = { legL, legR, armL, armR, pistol, torso };
  return g;
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function createPlayer(scene, city) {
  const mesh = buildPlayerMesh();
  scene.add(mesh);

  const p = {
    mesh,
    x: 0, z: 0, y: 0, vy: 0,
    heading: 0,
    speed: 0,
    health: MAX_HEALTH,
    onFoot: true,
    car: null,
    armed: false,
    punchCooldown: 0,
    shootCooldown: 0,
    damageCooldown: 0,
    punchTimer: 0,
    walkPhase: 0,
    grounded: true,
    _prevKeys: new Set(),
  };

  // Edge-triggered key helper: uses input.pressed() when present, else tracks the
  // keys Set itself (input.js in the design doc provides pressed()).
  function wasPressed(input, code) {
    if (input && typeof input.pressed === 'function') return input.pressed(code);
    const keys = input?.keys;
    if (!keys) return false;
    const now = keys.has(code);
    const was = p._prevKeys.has(code);
    return now && !was;
  }
  function clicked(input) {
    if (input && typeof input.consumeClick === 'function') return input.consumeClick();
    return false;
  }

  function syncMesh() {
    mesh.position.set(p.x, p.y, p.z);
    mesh.rotation.y = p.heading;
  }

  function setPosition(x, z) {
    p.x = x;
    p.z = z;
    p.y = 0;
    p.vy = 0;
    p.grounded = true;
    p.speed = 0;
    syncMesh();
  }

  function takeDamage(n) {
    if (p.damageCooldown > 0 || p.health <= 0) return p.health;
    p.health = Math.max(0, p.health - n);
    p.damageCooldown = DAMAGE_GRACE;
    return p.health;
  }

  function getState() {
    return {
      x: p.x, z: p.z, y: p.y, heading: p.heading, speed: p.speed,
      health: p.health, onFoot: p.onFoot, armed: p.armed, car: p.car,
    };
  }

  function enterCar(car) {
    p.onFoot = false;
    p.car = car;
    p.y = 0;
    p.vy = 0;
    mesh.visible = false;
  }

  function exitCar(x, z) {
    p.onFoot = true;
    p.car = null;
    mesh.visible = true;
    setPosition(x, z);
  }

  function reset() {
    p.health = MAX_HEALTH;
    p.armed = false;
    p.punchCooldown = 0;
    p.shootCooldown = 0;
    p.damageCooldown = 0;
    p.punchTimer = 0;
    if (p.car) exitCar(p.x, p.z);
    mesh.userData.pistol.visible = false;
  }

  // --- Combat ---------------------------------------------------------------
  // Nearest living target whose centre is within `range` and inside `arc`
  // radians of `dirX/dirZ`, with no building between player and target.
  function findMeleeTarget(targets, range, arc) {
    if (!targets) return null;
    const fx = Math.sin(p.heading);
    const fz = Math.cos(p.heading);
    let best = null;
    let bestDist = range;
    for (const t of targets) {
      if (t.alive === false) continue;
      const dx = t.x - p.x;
      const dz = t.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > range + (t.radius ?? 0.5)) continue;
      const dot = (dx * fx + dz * fz) / Math.max(d, 0.001);
      if (dot < Math.cos(arc)) continue;
      // Buildings block the punch (cheap step march, same as the shot ray).
      let blocked = false;
      if (city && typeof city.collideCircle === 'function') {
        for (let s = 0.4; s < d; s += 0.4) {
          if (city.collideCircle(p.x + (dx / d) * s, p.z + (dz / d) * s, 0.2)) { blocked = true; break; }
        }
      }
      if (blocked) continue;
      if (d < bestDist) { best = t; bestDist = d; }
    }
    return best;
  }

  function punch(world) {
    if (p.punchCooldown > 0) return;
    p.punchCooldown = PUNCH_COOLDOWN;
    p.punchTimer = 0.28;
    const target = findMeleeTarget(world?.targets, PUNCH_RANGE, PUNCH_ARC);
    if (target && typeof target.takeDamage === 'function') target.takeDamage(PUNCH_DAMAGE, 'punch');
    world?.onPunch?.({ hit: target, x: p.x, z: p.z });
  }

  function shoot(world, dirX, dirZ) {
    if (p.shootCooldown > 0) return;
    p.shootCooldown = SHOT_COOLDOWN;
    const targets = world?.targets ?? [];
    let hit = null;
    let hitDist = SHOT_RANGE;
    let hitX = p.x + dirX * SHOT_RANGE;
    let hitZ = p.z + dirZ * SHOT_RANGE;
    // March the ray; a building ends it, a target whose centre passes within its
    // radius of the ray is hit (nearest such target wins).
    for (let s = SHOT_STEP; s <= SHOT_RANGE; s += SHOT_STEP) {
      const rx = p.x + dirX * s;
      const rz = p.z + dirZ * s;
      if (city && typeof city.collideCircle === 'function' && city.collideCircle(rx, rz, 0.15)) {
        hitX = rx;
        hitZ = rz;
        hitDist = s;
        break;
      }
      for (const t of targets) {
        if (t.alive === false) continue;
        const dx = t.x - rx;
        const dz = t.z - rz;
        const r = (t.radius ?? 0.5) + 0.15;
        if (dx * dx + dz * dz < r * r && s < hitDist) {
          hit = t;
          hitDist = s;
          hitX = rx;
          hitZ = rz;
        }
      }
      if (hit) break;
    }
    if (hit && typeof hit.takeDamage === 'function') hit.takeDamage(SHOT_DAMAGE, 'shot');
    world?.onShoot?.({ hit, x: hitX, z: hitZ, dist: hitDist });
  }

  // --- Per-frame update -----------------------------------------------------
  function update(dt, input, cityArg, cameraYaw = 0, world = {}) {
    const c = cityArg ?? city;
    p.punchCooldown = Math.max(0, p.punchCooldown - dt);
    p.shootCooldown = Math.max(0, p.shootCooldown - dt);
    p.damageCooldown = Math.max(0, p.damageCooldown - dt);
    p.punchTimer = Math.max(0, p.punchTimer - dt);

    // In a car the mesh is hidden and the body follows the car; main.js drives it.
    if (!p.onFoot) {
      if (p.car) {
        p.x = p.car.x;
        p.z = p.car.z;
        p.heading = p.car.heading;
        p.speed = Math.abs(p.car.speed);
      }
      p._prevKeys = new Set(input?.keys ?? []);
      return;
    }

    const keys = input?.keys ?? new Set();

    // --- Camera-relative movement ---
    const viewX = -Math.sin(cameraYaw);
    const viewZ = -Math.cos(cameraYaw);
    const rightX = Math.cos(cameraYaw);
    const rightZ = -Math.sin(cameraYaw);
    let mx = 0;
    let mz = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) { mx += viewX; mz += viewZ; }
    if (keys.has('KeyS') || keys.has('ArrowDown')) { mx -= viewX; mz -= viewZ; }
    if (keys.has('KeyD') || keys.has('ArrowRight')) { mx += rightX; mz += rightZ; }
    if (keys.has('KeyA') || keys.has('ArrowLeft')) { mx -= rightX; mz -= rightZ; }
    const moving = mx !== 0 || mz !== 0;
    if (moving) {
      const len = Math.hypot(mx, mz);
      mx /= len;
      mz /= len;
    }
    const running = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const targetSpeed = moving ? (running ? RUN_SPEED : WALK_SPEED) : 0;
    p.speed += Math.max(-ACCEL * dt, Math.min(ACCEL * dt, targetSpeed - p.speed));

    // Axis-separated move so the player slides along building walls.
    const collide = (x, z) => c && typeof c.collideCircle === 'function'
      ? c.collideCircle(x, z, PLAYER_RADIUS) : false;
    const nx = p.x + mx * p.speed * dt;
    if (!collide(nx, p.z)) p.x = nx;
    const nz = p.z + mz * p.speed * dt;
    if (!collide(p.x, nz)) p.z = nz;

    // Face the movement direction; while armed, face the camera view instead.
    if (moving) p.heading = Math.atan2(mx, mz);
    if (p.armed) p.heading = Math.atan2(viewX, viewZ);

    // --- Jump (Space, on foot only) ---
    if (wasPressed(input, 'Space') && p.grounded) {
      p.vy = JUMP_VELOCITY;
      p.grounded = false;
    }
    if (!p.grounded) {
      p.vy -= GRAVITY * dt;
      p.y += p.vy * dt;
      if (p.y <= 0) {
        p.y = 0;
        p.vy = 0;
        p.grounded = true;
      }
    }

    // --- Combat input ---
    if (wasPressed(input, 'KeyQ')) {
      p.armed = !p.armed;
      mesh.userData.pistol.visible = p.armed;
    }
    if (wasPressed(input, 'KeyF')) punch(world);
    if (clicked(input)) {
      if (p.armed) shoot(world, viewX, viewZ);
      else punch(world);
    }

    // --- Walk / punch animation ---
    const u = mesh.userData;
    p.walkPhase += p.speed * dt * 2.2;
    const swing = moving && p.grounded ? Math.sin(p.walkPhase) * 0.55 : 0;
    u.legL.rotation.x = swing;
    u.legR.rotation.x = -swing;
    if (p.punchTimer > 0) {
      u.armR.rotation.x = -1.6; // punch extended forward
      u.armL.rotation.x = 0.4;
    } else if (p.armed) {
      u.armR.rotation.x = -1.2; // pistol aimed forward
      u.armL.rotation.x = -0.4;
    } else {
      u.armL.rotation.x = -swing * 0.7;
      u.armR.rotation.x = swing * 0.7;
    }
    // Slight bob while running.
    const bob = moving && p.grounded ? Math.abs(Math.sin(p.walkPhase)) * 0.05 : 0;

    syncMesh();
    mesh.position.y = p.y + bob;

    p._prevKeys = new Set(keys);
  }

  setPosition(0, 0);
  return {
    mesh,
    get x() { return p.x; },
    set x(v) { p.x = v; },
    get z() { return p.z; },
    set z(v) { p.z = v; },
    get heading() { return p.heading; },
    set heading(v) { p.heading = v; },
    get speed() { return p.speed; },
    set speed(v) { p.speed = v; },
    get y() { return p.y; },
    get health() { return p.health; },
    set health(v) { p.health = Math.max(0, Math.min(MAX_HEALTH, v)); },
    get onFoot() { return p.onFoot; },
    set onFoot(v) { p.onFoot = !!v; },
    get armed() { return p.armed; },
    get car() { return p.car; },
    set car(v) { p.car = v; },
    update,
    takeDamage,
    setPosition,
    getState,
    enterCar,
    exitCar,
    reset,
  };
}
