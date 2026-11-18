// main.js — Solmara boot + fixed 1/60 s loop + screens + glue.
// Imports every module per the design-doc contracts and wires them into one
// playable game. Exports nothing; runs boot() in the browser only.
// Conventions (design doc): ground y=0, x east, z south; a heading h faces
// (sin h, cos h) in (x, z), so h = PI/2 faces east (+x). The camera orbits
// with the same convention and player.cameraYaw is handed to player.js.
// World: 10x10 blocks, roads at -260..260 step 52.
import * as THREE from '../vendor/three.module.js';
import * as CONFIG from './config.js';
import { mulberry32 } from './random.js';
import { createWorld3D } from './render.js';
import { createCity } from './city.js';
import { createPlayer } from './player.js';
import { CAR_TYPES, createCar, driveCar } from './vehicles.js';
import { createTraffic } from './traffic.js';
import { createPolice } from './police.js';
import { MISSIONS, createMissionManager } from './missions.js';
import { createHUD } from './hud.js';
import { createAudio } from './audio.js';
import { loadSave, saveSave, clearSave } from './save.js';
import { createInput } from './input.js';
import { stageShot } from './shots.js';

const STEP = 1 / 60;
const DAY_LENGTH_S = 600; // one full game day per 10 real minutes
const POLICE_STATION = { x: -208, z: 208 };
const HOSPITAL = { x: 208, z: -208 };
const SPAWN = { x: 0, z: 26 };

// 10 hidden packages ($50 each), on sidewalks beside roads.
const PACKAGE_SPOTS = [
  { x: 26, z: -52 }, { x: -78, z: 26 }, { x: 130, z: -104 }, { x: -182, z: -78 },
  { x: 78, z: 182 }, { x: -26, z: 130 }, { x: 182, z: 26 }, { x: -130, z: -182 },
  { x: 52, z: -182 }, { x: -208, z: 104 },
];

const BALANCE = CONFIG.BALANCE ?? {};
const FINES = BALANCE.fines ?? { busted: 100, wasted: 50 };
const DECAY_SECONDS = BALANCE.decaySeconds ?? BALANCE.decay ?? 20;

const isBrowser = typeof document !== 'undefined' && typeof window !== 'undefined';

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function dist2(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }

if (isBrowser) boot();

function boot() {
  const params = new URLSearchParams(window.location.search);
  const shotName = params.get('shot');
  const seed = Number(params.get('seed') || '1') || 1;
  const rng = mulberry32(seed);

  let canvas = document.getElementById('game');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'game';
    document.body.appendChild(canvas);
  }

  const input = createInput(canvas);
  const world = createWorld3D(canvas);
  const city = createCity(world.scene, rng);
  const player = createPlayer(world.scene, city);
  const traffic = createTraffic(world.scene, city, 14);
  const police = createPolice(world.scene, city);
  const hud = createHUD();
  const audio = createAudio();

  const saveData = loadSave();
  audio.setMuted(!!saveData.muted);

  const S = {
    screen: 'title',
    money: saveData.money,
    missionsDone: [...saveData.missionsDone],
    packages: [...saveData.packages],
    clockHours: 10,
    camYaw: Math.PI,
    camPitch: 0.32,
    armed: false,
    muted: !!saveData.muted,
    decayTimer: 0,
    saveTimer: 0,
    dirty: false,
    storyDone: saveData.missionsDone.includes(MISSIONS.length - 1),
  };

  // ---- markers & packages (3D) -------------------------------------------
  let markerMesh = null;
  let markerPos = null;
  function spawnMarker(x, z, label) {
    clearMarker();
    markerPos = { x, z };
    const group = new THREE.Group();
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.2, 40, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd23e, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }),
    );
    beam.position.y = 20;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.5, 4, 24),
      new THREE.MeshBasicMaterial({ color: 0xffd23e, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.15;
    group.add(beam);
    group.add(ring);
    group.position.set(x, 0, z);
    world.scene.add(group);
    markerMesh = group;
    hud.setObjective(label ? `${label}` : '');
  }
  function clearMarker() {
    if (markerMesh) {
      world.scene.remove(markerMesh);
      markerMesh = null;
    }
    markerPos = null;
  }

  const packageMeshes = PACKAGE_SPOTS.map((spot, i) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.9, 0.9),
      new THREE.MeshBasicMaterial({ color: 0x37d67a }),
    );
    mesh.position.set(spot.x, 0.8, spot.z);
    mesh.visible = !S.packages.includes(i);
    world.scene.add(mesh);
    return { ...spot, mesh, index: i };
  });

  // ---- the game object handed to missions.js / shots.js ------------------
  const playerCars = [];
  function enterCar(type, x, z, heading, speed) {
    const car = createCar(type, x, z, heading);
    car.speed = speed || 0;
    car.isPlayer = true;
    player.car = car;
    player.onFoot = false;
    player.x = x;
    player.z = z;
    player.heading = heading;
    player.speed = car.speed;
    if (!playerCars.includes(car)) playerCars.push(car);
    return car;
  }
  function exitCar() {
    if (!player.car) return;
    const car = player.car;
    player.x = car.x + Math.cos(car.heading) * 2.5;
    player.z = car.z - Math.sin(car.heading) * 2.5;
    player.heading = car.heading;
    player.speed = 0;
    player.car = null;
    player.onFoot = true;
  }

  const game = {
    player, city, traffic, police, hud, audio, input,
    get missionsDone() { return S.missionsDone; },
    setObjective: (t) => hud.setObjective(t),
    addMoney: (n) => { S.money += n; S.dirty = true; },
    showMessage: (t) => hud.showMessage(t),
    spawnMarker, clearMarker,
    setTimeOfDay: (hours) => {
      S.clockHours = hours;
      world.setTimeOfDay(((hours % 24) + 24) % 24 / 24);
    },
    showScreen,
    enterCar, exitCar,
    save: persist,
    onStoryComplete: () => {
      S.storyDone = true;
      persist();
      showScreen('story');
    },
  };
  const missions = createMissionManager(game);

  // ---- screens ------------------------------------------------------------
  const screens = {};
  function ensureScreen(id, html, css) {
    let node = document.getElementById(id);
    if (!node) {
      node = document.createElement('div');
      node.id = id;
      node.style.cssText = css;
      node.innerHTML = html;
      document.body.appendChild(node);
    }
    screens[id] = node;
    return node;
  }
  const screenCSS = 'position:fixed;inset:0;display:none;align-items:center;justify-content:center;flex-direction:column;z-index:20;background:rgba(5,10,18,.72);color:#fff;font-family:system-ui,Arial,sans-serif;text-align:center;';
  const btnCSS = 'display:block;margin:6px auto;padding:10px 26px;min-width:260px;font-size:16px;color:#fff;background:#1d5fb8;border:1px solid #6ea8ff;border-radius:6px;cursor:pointer;';
  ensureScreen('screen-title', `
    <h1 style="font-size:56px;margin:0;letter-spacing:6px;">SOLMARA</h1>
    <p style="opacity:.85;margin:6px 0 20px;">Open-World Crime Sandbox &mdash; Danny Reyes</p>
    <button data-action="new" style="${btnCSS}">New Game</button>
    <button data-action="continue" style="${btnCSS}">Continue</button>
    <button data-action="missions" style="${btnCSS}">Missions</button>
    <button data-action="mute" style="${btnCSS}">Sound: <span id="mute-label">On</span></button>
    <p style="font-size:13px;opacity:.75;max-width:520px;margin-top:18px;">WASD move / drive &middot; mouse drag camera &middot; E enter, steal &amp; exit cars &middot; F punch &middot; Q pistol &middot; Shift run / handbrake &middot; Space jump / handbrake &middot; R flip car &middot; M mute &middot; Esc pause</p>
  `, screenCSS);
  ensureScreen('screen-pause', `
    <h1 style="font-size:36px;">PAUSED</h1>
    <button data-action="resume" style="${btnCSS}">Resume</button>
    <button data-action="missions" style="${btnCSS}">Missions</button>
    <button data-action="restart" style="${btnCSS}">Restart (New Game)</button>
    <button data-action="quit" style="${btnCSS}">Quit to Title</button>
  `, screenCSS);
  ensureScreen('screen-missions', `
    <h1 style="font-size:32px;">MISSIONS</h1>
    <div id="mission-list"></div>
    <button data-action="back" style="${btnCSS}">Back</button>
  `, screenCSS);
  ensureScreen('screen-busted', `
    <h1 style="font-size:44px;color:#6ea8ff;">BUSTED</h1>
    <p>The Solmara PD caught you. Fine: $${FINES.busted}.</p>
    <button data-action="resume" style="${btnCSS}">Continue</button>
  `, screenCSS);
  ensureScreen('screen-wasted', `
    <h1 style="font-size:44px;color:#e5484d;">WASTED</h1>
    <p>You wake up at St. Marina Hospital. Bill: $${FINES.wasted}.</p>
    <button data-action="resume" style="${btnCSS}">Continue</button>
  `, screenCSS);
  ensureScreen('screen-story', `
    <h1 style="font-size:40px;color:#ffd23e;">STORY COMPLETE</h1>
    <p>Danny Reyes pulled off the Big One and owns Solmara now.<br>Free roam continues — keep the city yours.</p>
    <button data-action="resume" style="${btnCSS}">Keep Playing</button>
    <button data-action="quit" style="${btnCSS}">Quit to Title</button>
  `, screenCSS);

  let returnTo = 'title';
  function showScreen(name) {
    S.screen = name;
    for (const [id, node] of Object.entries(screens)) {
      node.style.display = id === `screen-${name}` ? 'flex' : 'none';
    }
    if (name === 'missions') {
      const list = document.getElementById('mission-list');
      if (list) {
        const avail = missions.available();
        list.innerHTML = MISSIONS.map((m, i) => {
          const done = S.missionsDone.includes(i);
          const locked = !avail.includes(i) && !done;
          const label = done ? `✓ ${m.title} — $${m.reward} (done)` : locked ? `🔒 ${m.title} — finish mission ${i} first` : `${m.title} — $${m.reward}`;
          return `<button data-mission="${i}" ${locked ? 'disabled' : ''} style="${btnCSS}">${label}<br><span style="font-size:12px;opacity:.8;">${m.briefing}</span></button>`;
        }).join('');
        list.querySelectorAll('[data-mission]').forEach((b) => {
          b.addEventListener('click', () => {
            const i = Number(b.getAttribute('data-mission'));
            if (missions.start(i)) {
              audio.click();
              showScreen('play');
            }
          });
        });
      }
    }
    const muteLabel = document.getElementById('mute-label');
    if (muteLabel) muteLabel.textContent = S.muted ? 'Off' : 'On';
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    audio.resume();
    audio.click();
    if (action === 'new') newGame();
    else if (action === 'continue') continueGame();
    else if (action === 'missions') { returnTo = S.screen === 'pause' ? 'pause' : 'title'; showScreen('missions'); }
    else if (action === 'back') showScreen(returnTo);
    else if (action === 'resume') showScreen('play');
    else if (action === 'restart') newGame();
    else if (action === 'quit') { persist(); showScreen('title'); }
    else if (action === 'mute') toggleMute();
  });

  function toggleMute() {
    S.muted = !S.muted;
    audio.setMuted(S.muted);
    S.dirty = true;
    const muteLabel = document.getElementById('mute-label');
    if (muteLabel) muteLabel.textContent = S.muted ? 'Off' : 'On';
  }

  function resetWorld() {
    missions.cancel();
    clearMarker();
    police.reset();
    player.setPosition(SPAWN.x, SPAWN.z);
    player.health = 100;
    player.car = null;
    player.onFoot = true;
    player.heading = Math.PI;
    S.camYaw = Math.PI;
    S.camPitch = 0.32;
    S.clockHours = 10;
    S.armed = false;
    S.decayTimer = 0;
  }

  function newGame() {
    clearSave();
    S.money = 0;
    S.missionsDone = [];
    S.packages = [];
    S.storyDone = false;
    packageMeshes.forEach((p) => { p.mesh.visible = true; });
    resetWorld();
    hud.setMission('');
    hud.setObjective('Free roam — steal a car, or open Missions from the pause menu (Esc).');
    hud.showMessage('Welcome to Solmara, Danny. Make it yours.');
    showScreen('play');
  }

  function continueGame() {
    const d = loadSave();
    S.money = d.money;
    S.missionsDone = [...d.missionsDone];
    S.packages = [...d.packages];
    S.storyDone = d.missionsDone.includes(MISSIONS.length - 1);
    packageMeshes.forEach((p) => { p.mesh.visible = !S.packages.includes(p.index); });
    resetWorld();
    hud.setObjective('Free roam — Esc for pause & missions.');
    showScreen('play');
  }

  function persist() {
    saveSave({
      money: S.money,
      missionsDone: S.missionsDone,
      packages: S.packages,
      best: Math.max(loadSave().best, S.money),
      muted: S.muted,
    });
    S.dirty = false;
  }

  function respawn(point, fine, screen) {
    missions.cancel();
    police.reset();
    if (player.car) {
      player.car.isPlayer = false;
      player.car = null;
      player.onFoot = true;
    }
    S.money = Math.max(0, S.money - fine);
    player.setPosition(point.x, point.z);
    player.health = 100;
    S.armed = false;
    S.decayTimer = 0;
    persist();
    showScreen(screen);
  }

  // First gesture unlocks WebAudio.
  const unlock = () => audio.resume();
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });

  // ---- combat helpers ------------------------------------------------------
  function combatTargets() {
    const out = [];
    if (police.cops) for (const c of police.cops) out.push(c);
    if (traffic.peds) for (const p of traffic.peds) out.push(p);
    return out.filter((t) => t && !t.dead && typeof t.x === 'number');
  }
  function damageTarget(t, dmg) {
    if (typeof t.takeDamage === 'function') t.takeDamage(dmg);
    else if (typeof t.health === 'number') {
      t.health -= dmg;
      if (t.health <= 0) {
        t.dead = true;
        if (t.mesh) t.mesh.visible = false;
      }
    } else {
      t.dead = true;
      if (t.mesh) t.mesh.visible = false;
    }
  }
  function aimTarget(maxDist, maxAngle) {
    const fx = Math.sin(S.camYaw);
    const fz = Math.cos(S.camYaw);
    let best = null;
    let bestD = maxDist;
    for (const t of combatTargets()) {
      const dx = t.x - player.x;
      const dz = t.z - player.z;
      const d = Math.hypot(dx, dz);
      if (d > bestD || d < 0.5) continue;
      const dot = (dx * fx + dz * fz) / d;
      if (dot < Math.cos(maxAngle)) continue;
      best = t;
      bestD = d;
    }
    return best;
  }
  function shoot() {
    audio.shot();
    const t = aimTarget(45, 0.14);
    if (t) {
      damageTarget(t, 34);
      hud.showMessage('Hit!');
    }
    police.addWanted(1);
    if (traffic.fleeFrom) traffic.fleeFrom(player.x, player.z);
  }
  function punch() {
    audio.punch();
    const t = aimTarget(2.6, 1.1);
    if (t) {
      damageTarget(t, 34);
      police.addWanted(1);
      hud.showMessage('You landed a punch.');
    }
  }

  // ---- car enter / exit / steal --------------------------------------------
  function nearestUsableCar(x, z, maxDist) {
    let best = null;
    let bestD = maxDist;
    const consider = (car) => {
      if (!car) return;
      const d = dist2(x, z, car.x, car.z);
      if (d < bestD) { best = car; bestD = d; }
    };
    if (traffic.nearestCar) {
      const c = traffic.nearestCar(x, z, maxDist);
      if (c) consider(c);
    } else if (traffic.cars) {
      for (const c of traffic.cars) consider(c);
    }
    for (const c of playerCars) consider(c);
    return best;
  }
  function tryEnterExitCar() {
    if (!player.onFoot) {
      exitCar();
      hud.showMessage('You got out of the car.');
      return;
    }
    const car = nearestUsableCar(player.x, player.z, 4.5);
    if (!car) return;
    const wasTraffic = traffic.cars && traffic.cars.includes(car);
    if (wasTraffic) {
      if (typeof traffic.removeCar === 'function') traffic.removeCar(car);
      else traffic.cars.splice(traffic.cars.indexOf(car), 1);
      const copNear = police.nearestCopDist
        ? police.nearestCopDist(player.x, player.z) < 60
        : false;
      if (copNear) {
        police.addWanted(1);
        hud.showMessage('You stole a car in front of the cops! +1 star.');
      } else {
        hud.showMessage('You stole the car.');
      }
      if (!playerCars.includes(car)) playerCars.push(car);
    }
    car.isPlayer = true;
    player.car = car;
    player.onFoot = false;
    player.heading = car.heading;
  }
  function resetCar() {
    if (!player.car) return;
    const car = player.car;
    const p = city.nearestRoadPoint ? city.nearestRoadPoint(car.x, car.z) : { x: car.x, z: car.z };
    car.x = p.x;
    car.z = p.z;
    car.speed = 0;
    if (typeof car.heading === 'number') car.heading = Math.round(car.heading / (Math.PI / 2)) * (Math.PI / 2);
    player.x = car.x;
    player.z = car.z;
    hud.showMessage('Car flipped back onto its wheels.');
  }

  // ---- per-frame update ------------------------------------------------------
  function update(dt) {
    // Clock + day/night.
    S.clockHours = (S.clockHours + (dt / DAY_LENGTH_S) * 24) % 24;
    world.setTimeOfDay(S.clockHours / 24);

    // Camera orbit.
    S.camYaw -= input.mouseDX * 0.005;
    S.camPitch = clamp(S.camPitch + input.mouseDY * 0.003, 0.05, 1.1);

    // Global keys.
    if (input.pressed('KeyM')) toggleMute();
    if (input.pressed('Escape') || input.pressed('KeyP')) {
      showScreen('pause');
      return;
    }
    if (input.pressed('KeyQ')) {
      S.armed = !S.armed;
      hud.showMessage(S.armed ? 'Pistol drawn.' : 'Pistol holstered.');
    }
    if (input.pressed('KeyF')) punch();
    if (input.pressed('KeyR')) resetCar();
    if (input.pressed('KeyE')) tryEnterExitCar();
    if (input.consumeClick()) {
      if (S.armed) shoot();
      else punch();
    }

    // Movement: on foot via player.js, driving via vehicles.js.
    if (player.onFoot) {
      player.cameraYaw = S.camYaw;
      player.update(dt, input, city);
    } else if (player.car) {
      const car = player.car;
      const up = input.keys.has('KeyW') || input.keys.has('ArrowUp');
      const down = input.keys.has('KeyS') || input.keys.has('ArrowDown');
      const left = input.keys.has('KeyA') || input.keys.has('ArrowLeft');
      const right = input.keys.has('KeyD') || input.keys.has('ArrowRight');
      const handbrake = input.keys.has('ShiftLeft') || input.keys.has('ShiftRight') || input.keys.has('Space');
      driveCar(car, dt, {
        throttle: up ? 1 : down ? -0.6 : 0,
        steer: (left ? -1 : 0) + (right ? 1 : 0),
        brake: down ? 1 : 0,
        handbrake,
      }, city);
      player.x = car.x;
      player.z = car.z;
      player.heading = car.heading;
      player.speed = car.speed;
      if (player.mesh) player.mesh.visible = false;
    }
    if (player.mesh) player.mesh.visible = player.onFoot;

    // World life.
    traffic.update(dt, { x: player.x, z: player.z });
    const policeResult = police.update(dt, player, traffic.cars) || {};
    missions.update(dt);

    // Wanted decay while hidden from every cop.
    const copDist = police.nearestCopDist ? police.nearestCopDist(player.x, player.z) : Infinity;
    if (police.wanted > 0 && copDist > 60) {
      S.decayTimer += dt;
      if (S.decayTimer >= DECAY_SECONDS) {
        S.decayTimer = 0;
        if (typeof police.setWanted === 'function') police.setWanted(Math.max(0, police.wanted - 1));
        else police.addWanted(-1);
      }
    } else {
      S.decayTimer = 0;
    }

    // Hidden packages.
    if (player.onFoot) {
      for (const p of packageMeshes) {
        if (!p.mesh.visible) continue;
        if (dist2(player.x, player.z, p.x, p.z) < 2.2) {
          p.mesh.visible = false;
          S.packages.push(p.index);
          S.money += 50;
          S.dirty = true;
          audio.pickup();
          hud.showMessage(`Hidden package found! +$50 (${S.packages.length}/10).`);
          persist();
        }
      }
    }

    // Busted / wasted.
    if (policeResult.busted) {
      respawn(POLICE_STATION, FINES.busted, 'busted');
      return;
    }
    if (player.health <= 0) {
      respawn(HOSPITAL, FINES.wasted, 'wasted');
      return;
    }

    // Sound.
    const speed01 = player.car
      ? clamp(Math.abs(player.car.speed) / ((CAR_TYPES[player.car.type] || {}).topSpeed || 30), 0, 1)
      : clamp(Math.abs(player.speed || 0) / 12, 0, 1);
    audio.engine(speed01, !!player.car || Math.abs(player.speed || 0) > 0.5);
    audio.siren(police.wanted > 0);

    // HUD.
    hud.update({
      health: player.health,
      wanted: police.wanted,
      money: S.money,
      speed: player.car ? player.car.speed : player.speed,
      clock: S.clockHours,
      armed: S.armed,
      driving: !!player.car,
      screen: S.screen,
      minimap: {
        player: { x: player.x, z: player.z, heading: player.heading },
        cars: (traffic.cars || []).map((c) => ({ x: c.x, z: c.z })),
        police: (police.cars || []).map((c) => ({ x: c.x, z: c.z })),
        peds: (traffic.peds || []).map((p) => ({ x: p.x, z: p.z })),
        marker: markerPos,
        north: true,
      },
    });

    // Periodic save.
    S.saveTimer += dt;
    if (S.saveTimer > 5) {
      S.saveTimer = 0;
      if (S.dirty) persist();
    }
  }

  function renderFrame() {
    const px = player.x;
    const pz = player.z;
    const dist = player.car ? 11 : 8;
    const cy = Math.cos(S.camPitch);
    const sy = Math.sin(S.camPitch);
    const cx = px - Math.sin(S.camYaw) * cy * dist;
    const cz = pz - Math.cos(S.camYaw) * cy * dist;
    world.camera.position.set(cx, 2.5 + sy * dist, cz);
    world.camera.lookAt(px, 2, pz);
    if (typeof world.update === 'function') world.update(0);
    else if (world.renderer && world.scene) world.renderer.render(world.scene, world.camera);
  }

  // ---- fixed-step loop -------------------------------------------------------
  let last = 0;
  let acc = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (!last) last = now;
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25;
    if (S.screen === 'play') {
      acc += dt;
      let n = 0;
      while (acc >= STEP && n < 5) {
        update(STEP);
        acc -= STEP;
        n += 1;
        if (S.screen !== 'play') { acc = 0; break; }
      }
      if (n === 5) acc = 0;
    }
    renderFrame();
    input.update();
  }

  // ---- shots mode ------------------------------------------------------------
  if (shotName) {
    resetWorld();
    showScreen('play');
    stageShot(shotName, game, seed);
    // Sync HUD once so the frame shows the staged state.
    hud.update({
      health: player.health,
      wanted: police.wanted,
      money: S.money,
      speed: player.car ? player.car.speed : 0,
      clock: S.clockHours,
      armed: false,
      driving: !!player.car,
      screen: shotName === 'start' ? 'title' : 'play',
      minimap: {
        player: { x: player.x, z: player.z, heading: player.heading },
        cars: (traffic.cars || []).map((c) => ({ x: c.x, z: c.z })),
        police: (police.cars || []).map((c) => ({ x: c.x, z: c.z })),
        peds: (traffic.peds || []).map((p) => ({ x: p.x, z: p.z })),
        marker: markerPos,
        north: true,
      },
    });
    renderFrame();
    renderFrame();
    window.__shotReady = true;
    return;
  }

  // ---- normal boot -------------------------------------------------------------
  world.setTimeOfDay(S.clockHours / 24);
  showScreen('title');
  requestAnimationFrame(frame);
}
