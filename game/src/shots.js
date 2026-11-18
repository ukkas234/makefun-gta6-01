// shots.js — deterministic staged scenes for the 4 competition screenshots.
// stageShot(name, game) positions the player, cars, police and time of day
// for one shot, then marks window.__shotReady = true. main.js paints twice
// around the call (runShot path) instead of starting the game loop.
// Names: start | drive | chase | night. All positions are fixed literals
// (seed is accepted for the ?shot=…&seed= contract but the scenes are fully
// deterministic, so every seed stages the same frame).
// The game object passed in:
// { player, traffic, police, world, hud, setTimeOfDay(hours),
//   setObjective(text), showScreen(name), spawnMarker(x,z,label),
//   clearMarker(), money, setMoney(n) } — every access is defensive so a
// missing piece degrades instead of throwing.
export function stageShot(name, game, seed = 1) {
  void seed;
  const g = game || {};
  const setTime = (hours) => {
    if (typeof g.setTimeOfDay === 'function') g.setTimeOfDay(hours);
    else if (g.world && typeof g.world.setTimeOfDay === 'function') g.world.setTimeOfDay(hours / 24);
  };
  const placePlayerCar = (type, x, z, heading, speed) => {
    const p = g.player;
    if (!p) return;
    if (p.car) {
      p.car.x = x; p.car.z = z; p.car.heading = heading; p.car.speed = speed;
      p.x = x; p.z = z; p.heading = heading; p.speed = speed;
    } else if (typeof g.enterCar === 'function') {
      g.enterCar(type, x, z, heading, speed);
    } else {
      p.x = x; p.z = z; p.heading = heading; p.speed = speed;
    }
  };
  const placePlayerOnFoot = (x, z, heading) => {
    const p = g.player;
    if (!p) return;
    if (p.car && typeof g.exitCar === 'function') g.exitCar();
    if (p.car) { p.car = null; p.onFoot = true; }
    p.x = x; p.z = z; p.heading = heading; p.speed = 0; p.onFoot = true;
  };
  const placeTraffic = (spots) => {
    const cars = (g.traffic && g.traffic.cars) || [];
    spots.forEach((s, i) => {
      const car = cars[i];
      if (!car) return;
      car.x = s[0]; car.z = s[1]; car.heading = s[2] ?? 0; car.speed = s[3] ?? 0;
      // Shot mode never runs the game loop, so sync the mesh here too —
      // otherwise the car keeps rendering at its random spawn position.
      if (car.mesh) { car.mesh.position.set(s[0], 0, s[1]); car.mesh.rotation.y = s[2] ?? 0; }
    });
  };
  const placePolice = (spots) => {
    if (!g.police) return;
    if (typeof g.police.setWanted === 'function') g.police.setWanted(0);
    else if (typeof g.police.reset === 'function') g.police.reset();
    const cops = g.police.cars || [];
    spots.forEach((s, i) => {
      let car = cops[i];
      // Shot mode never runs update(), so no police cars exist yet: spawn
      // one per spot on demand (spawnCar picks a road point near the
      // player; the staged position below overwrites wherever it lands).
      if (!car && typeof g.police.spawnCar === 'function') {
        try {
          g.police.spawnCar(g.player || { x: 0, z: 0 });
        } catch {
          // Spawn failed: keep today's behaviour and skip this spot.
        }
        car = (g.police.cars || [])[i];
      }
      if (!car) return;
      car.x = s[0]; car.z = s[1]; car.heading = s[2] ?? 0; car.speed = s[3] ?? 0;
      // Shot mode never runs the game loop, so sync the mesh here too —
      // otherwise the car keeps rendering at its random spawn position.
      if (car.mesh) { car.mesh.position.set(s[0], 0, s[1]); car.mesh.rotation.y = s[2] ?? 0; }
    });
  };
  const setWanted = (n) => {
    if (!g.police) return;
    if (typeof g.police.setWanted === 'function') g.police.setWanted(n);
    else {
      if (typeof g.police.reset === 'function') g.police.reset();
      for (let i = 0; i < n; i++) g.police.addWanted(1);
    }
  };

  if (typeof g.clearMarker === 'function') g.clearMarker();
  if (g.hud) {
    g.hud.setMission('');
    g.hud.setObjective('');
  }

  switch (name) {
    case 'start': {
      // Title screen: Danny on foot in the central plaza, morning light.
      setTime(10);
      placePlayerOnFoot(0, 26, Math.PI);
      placeTraffic([
        [-52, 0, 0, 8], [52, -52, Math.PI / 2, 6], [0, 104, -Math.PI / 2, 0],
        [104, 52, Math.PI, 7], [-104, -104, 0, 5],
      ]);
      placePolice([]);
      setWanted(0);
      if (typeof g.showScreen === 'function') g.showScreen('title');
      break;
    }
    case 'drive': {
      // Daytime driving: Danny in a muscle car heading east down a main road.
      setTime(14);
      placePlayerCar('muscle', -104, 0, Math.PI / 2, 18);
      placeTraffic([
        [-52, 0, Math.PI / 2, 12], [52, 0, Math.PI / 2, 10], [-156, 52, -Math.PI / 2, 9],
        [0, -52, 0, 7], [156, 52, Math.PI, 6],
      ]);
      placePolice([]);
      setWanted(0);
      if (typeof g.showScreen === 'function') g.showScreen('play');
      break;
    }
    case 'chase': {
      // Dusk police chase: 3 stars, two police cars closing in head-on
      // ahead of the player in the oncoming lane (in frame of the chase cam).
      setTime(16.5);
      placePlayerCar('muscle', -52, 0, Math.PI / 2, 22);
      placeTraffic([
        [52, 0, Math.PI / 2, 14], [104, 52, 0, 8], [-156, -52, Math.PI / 2, 10],
      ]);
      placePolice([
        [-24, 3, -Math.PI / 2, 18], [-4, -3, -Math.PI / 2, 18],
      ]);
      // Placing police resets wanted first; re-apply 3 stars after.
      setWanted(3);
      if (typeof g.showScreen === 'function') g.showScreen('play');
      break;
    }
    case 'night': {
      // Night neon: Danny driving a taxi past the neon block, mission done.
      setTime(22);
      placePlayerCar('taxi', -26, 104, 0, 9);
      placeTraffic([
        [26, 104, 0, 8], [104, 104, Math.PI, 7], [-104, 156, -Math.PI / 2, 6],
        [0, 52, Math.PI / 2, 5],
      ]);
      placePolice([]);
      setWanted(0);
      if (g.hud) g.hud.flash('MISSION COMPLETE');
      if (typeof g.showScreen === 'function') g.showScreen('play');
      break;
    }
    default: {
      setTime(12);
      placePlayerOnFoot(0, 26, Math.PI);
      if (typeof g.showScreen === 'function') g.showScreen('title');
      break;
    }
  }

  if (typeof window !== 'undefined') window.__shotReady = true;
}
