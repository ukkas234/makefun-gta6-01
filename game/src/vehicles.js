// vehicles.js — Solmara car types, low-poly car meshes and arcade driving physics.
//
// Conventions (shared with player.js / traffic.js / police.js):
//   - Ground plane y = 0, x east, z south.
//   - heading is a rotation about Y; forward vector = (sin(heading), cos(heading)) in (x, z).
//     Meshes are built facing +Z, so mesh.rotation.y = heading faces them along forward.
//   - A car object is { mesh, x, z, heading, speed, type, color, isPlayer, isPolice,
//     length, width, radius, wheels[] }.
//   - driveCar() moves a car with axis-separated building collision via city.collideCircle.
import * as THREE from '../vendor/three.module.js';

/** Arcade tuning per type. topSpeed / accel are m/s and m/s^2. */
export const CAR_TYPES = {
  sedan: {
    topSpeed: 32, accel: 14, reverseSpeed: 10,
    colors: [0x3b82c4, 0xc0c8d0, 0x2e2e33, 0x7a1f1f, 0x1f6b4a],
    length: 4.4, width: 1.9,
  },
  taxi: {
    topSpeed: 30, accel: 13, reverseSpeed: 10,
    colors: [0xf2c230, 0xffd34d],
    length: 4.4, width: 1.9,
  },
  muscle: {
    topSpeed: 42, accel: 19, reverseSpeed: 11,
    colors: [0xc22a2a, 0x1c1c22, 0x2a4ac2, 0xe08a1e],
    length: 4.6, width: 2.0,
  },
  van: {
    topSpeed: 24, accel: 10, reverseSpeed: 9,
    colors: [0xd8d8d8, 0x4a6b8a, 0x8a6b4a],
    length: 5.2, width: 2.1,
  },
};

const WHEEL_R = 0.34;

function box(w, h, d, color, x, y, z, opts = {}) {
  const mat = new THREE.MeshLambertMaterial({
    color,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
  });
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

/**
 * Build a low-poly car facing +Z (front at +z). `color` is a hex number.
 * Returns a THREE.Group; the group's userData holds { wheels, headlights, taillights }.
 */
export function createCarMesh(type, color) {
  const spec = CAR_TYPES[type] ?? CAR_TYPES.sedan;
  const bodyColor = color ?? spec.colors[0];
  const { length: L, width: W } = spec;
  const group = new THREE.Group();

  // Main body + cabin. Vans get a tall boxy cabin; others a lower cabin set slightly back.
  const isVan = type === 'van';
  group.add(box(W, 0.55, L, bodyColor, 0, 0.55, 0));
  if (isVan) {
    group.add(box(W * 0.92, 0.85, L * 0.62, bodyColor, 0, 1.2, -0.5));
    group.add(box(W * 0.8, 0.5, 0.08, 0x1a2530, 0, 1.25, L * 0.32)); // windshield
  } else {
    group.add(box(W * 0.82, 0.5, L * 0.45, 0x1a2530, 0, 1.05, -0.25)); // cabin glass
    group.add(box(W * 0.84, 0.1, L * 0.42, bodyColor, 0, 1.32, -0.25)); // roof
  }
  // Taxi roof sign.
  if (type === 'taxi') {
    group.add(box(0.7, 0.16, 0.3, 0xf2c230, 0, 1.45, -0.25, { emissive: 0x8a6d00, emissiveIntensity: 0.6 }));
  }
  // Muscle hood scoop + spoiler.
  if (type === 'muscle') {
    group.add(box(0.7, 0.14, 0.9, 0x111111, 0, 0.88, L * 0.28));
    group.add(box(W * 0.9, 0.06, 0.3, 0x111111, 0, 1.0, -L * 0.48));
  }
  // Bumpers.
  group.add(box(W * 0.96, 0.18, 0.18, 0x222222, 0, 0.32, L / 2));
  group.add(box(W * 0.96, 0.18, 0.18, 0x222222, 0, 0.32, -L / 2));

  // Headlights (front, +z) and taillights (rear, -z). Kept in userData so the
  // main loop can brighten them at night.
  const headlights = [];
  const taillights = [];
  for (const sx of [-1, 1]) {
    const h = box(0.42, 0.14, 0.06, 0xfff6c0, sx * (W / 2 - 0.35), 0.62, L / 2 + 0.01,
      { emissive: 0xfff2a0, emissiveIntensity: 0.7 });
    group.add(h);
    headlights.push(h);
    const t = box(0.42, 0.14, 0.06, 0xaa1111, sx * (W / 2 - 0.35), 0.62, -L / 2 - 0.01,
      { emissive: 0xcc0000, emissiveIntensity: 0.5 });
    group.add(t);
    taillights.push(t);
  }

  // Wheels: cylinders with the axle along X; spin via rotateX (local X is the axle).
  const wheelGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.26, 10);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x141414 });
  const hubMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
  const wheels = [];
  for (const [wx, wz] of [[-W / 2, L / 3], [W / 2, L / 3], [-W / 2, -L / 3], [W / 2, -L / 3]]) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, WHEEL_R, wz);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.28, 8), hubMat);
    hub.rotation.z = Math.PI / 2;
    wheel.add(hub);
    group.add(wheel);
    wheels.push(wheel);
  }

  // Blob shadow: a dark disc under the car (renderer shadows stay OFF for perf).
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(Math.max(L, W) * 0.58, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  shadow.scale.set(1, L / Math.max(L, W), 1);
  group.add(shadow);

  group.userData.wheels = wheels;
  group.userData.headlights = headlights;
  group.userData.taillights = taillights;
  return group;
}

/**
 * Create a drivable car object. `color` is optional; defaults to the type's first color.
 * The mesh is NOT added to the scene — the caller owns scene membership.
 */
export function createCar(type, x, z, heading, color) {
  const spec = CAR_TYPES[type] ?? CAR_TYPES.sedan;
  const resolvedType = CAR_TYPES[type] ? type : 'sedan';
  const resolvedColor = color ?? spec.colors[0];
  const mesh = createCarMesh(resolvedType, resolvedColor);
  mesh.position.set(x, 0, z);
  mesh.rotation.y = heading;
  return {
    mesh,
    x, z, heading,
    speed: 0,
    steer: 0,
    type: resolvedType,
    color: resolvedColor,
    isPlayer: false,
    isPolice: false,
    length: spec.length,
    width: spec.width,
    // Collision radius used by traffic / police proximity checks.
    radius: spec.length * 0.42,
    wheels: mesh.userData.wheels,
  };
}

/** Wrap an angle to [-PI, PI]. */
export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

const CITY_LIMIT = 258;

/**
 * Arcade driving step. controls: { throttle: 0..1 (negative = reverse), steer: -1..1,
 * brake: 0..1 or boolean, handbrake: boolean }. Building collision comes from
 * city.collideCircle(x, z, r); a missing collideCircle means "no buildings".
 * Movement is axis-separated so cars slide along walls instead of sticking.
 */
export function driveCar(car, dt, controls, city) {
  const spec = CAR_TYPES[car.type] ?? CAR_TYPES.sedan;
  const throttle = controls.throttle ?? 0;
  const steer = Math.max(-1, Math.min(1, controls.steer ?? 0));
  const brake = controls.brake ? 1 : 0;
  const handbrake = !!controls.handbrake;

  // --- Longitudinal ---
  if (throttle > 0) {
    car.speed += throttle * spec.accel * dt;
  } else if (throttle < 0) {
    // Reverse (only from low forward speed, like a real gearbox).
    if (car.speed > 0.5) car.speed -= spec.accel * 1.4 * dt;
    else car.speed += throttle * spec.accel * 0.8 * dt;
  }
  if (brake) {
    if (car.speed > 0.5) car.speed -= 26 * dt;
    else car.speed -= 12 * dt; // brake while stopped/reversing backs up slowly
  }
  if (handbrake) car.speed -= car.speed * 1.6 * dt;
  // Drag + rolling resistance.
  car.speed -= car.speed * 0.35 * dt;
  if (Math.abs(car.speed) < 0.05 && throttle === 0 && !brake) car.speed = 0;
  car.speed = Math.max(-spec.reverseSpeed, Math.min(spec.topSpeed, car.speed));

  // --- Steering: sharper at low speed, plus extra yaw on handbrake. ---
  const speedFactor = Math.max(-1, Math.min(1, car.speed / 8));
  let turnRate = 2.1 / (1 + Math.abs(car.speed) * 0.04);
  if (handbrake) turnRate *= 1.7;
  car.heading += steer * turnRate * speedFactor * dt;
  car.steer = steer;

  // --- Move, axis-separated, with front/rear circle collision. ---
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  const dx = fx * car.speed * dt;
  const dz = fz * car.speed * dt;
  const collide = (x, z) => {
    if (!city || typeof city.collideCircle !== 'function') return false;
    const r = car.width * 0.55;
    const off = car.length * 0.32;
    return city.collideCircle(x + fx * off, z + fz * off, r)
      || city.collideCircle(x - fx * off, z - fz * off, r);
  };
  const nx = Math.max(-CITY_LIMIT, Math.min(CITY_LIMIT, car.x + dx));
  if (!collide(nx, car.z) && Math.abs(nx) <= CITY_LIMIT) car.x = nx;
  else car.speed *= 0.45;
  const nz = Math.max(-CITY_LIMIT, Math.min(CITY_LIMIT, car.z + dz));
  if (!collide(car.x, nz) && Math.abs(nz) <= CITY_LIMIT) car.z = nz;
  else car.speed *= 0.45;

  // --- Sync mesh + spin wheels. ---
  car.mesh.position.set(car.x, 0, car.z);
  car.mesh.rotation.y = car.heading;
  const spin = (car.speed * dt) / WHEEL_R;
  for (const wheel of car.wheels) wheel.rotateX(spin);
}
