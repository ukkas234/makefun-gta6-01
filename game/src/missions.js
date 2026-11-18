// missions.js — the five-mission story for Solmara.
// MISSIONS: [{ id, title, briefing, reward, start(game), update(dt, game),
// isDone }]. Each mission keeps its own state in a closure; start(game)
// resets it, so missions are replayable.
// createMissionManager(game) -> { active, start(i), update(dt), available() }.
// available() returns the indices unlocked so far (mission i unlocks when
// mission i-1 is in game.missionsDone).
// The game object passed in:
// { player, city, traffic, police, hud, audio, input, missionsDone,
//   setObjective(text), addMoney(n), showMessage(text),
//   spawnMarker(x,z,label), clearMarker(), onStoryComplete() }.
// Positions use the design-doc world: x east, z south, ground y=0,
// roads at -260..260 step 52.
export const SPOTS = {
  garage: { x: 208, z: 208 },
  safehouse: { x: -208, z: -208 },
  bank: { x: 0, z: -156 },
  briefcase: { x: -104, z: 104 },
  delivery1: { x: -208, z: 52 },
  delivery2: { x: 104, z: -208 },
  delivery3: { x: 208, z: -52 },
};

function dist(ax, az, bx, bz) {
  return Math.hypot(ax - bx, az - bz);
}

function playerPos(game) {
  const p = game.player;
  if (!p) return { x: 0, z: 0 };
  if (p.car) return { x: p.car.x, z: p.car.z };
  return { x: p.x, z: p.z };
}

function makeMission(def) {
  let st = null;
  return {
    id: def.id,
    title: def.title,
    briefing: def.briefing,
    reward: def.reward,
    start(game) {
      st = def.init(game);
      st.done = false;
      st.failed = false;
      return st;
    },
    update(dt, game) {
      if (!st || st.done || st.failed) return;
      def.tick(dt, game, st);
    },
    get isDone() { return !!(st && st.done); },
    get isFailed() { return !!(st && st.failed); },
    _state() { return st; },
  };
}

export const MISSIONS = [
  makeMission({
    id: 0,
    title: 'First Wheels',
    briefing: 'Steal any car (press E next to one) and drive it to the garage marked on the map.',
    reward: 200,
    init(game) {
      game.setObjective('Steal a car — press E next to any car');
      game.showMessage('Mission: First Wheels — steal any car.');
      return { phase: 'steal' };
    },
    tick(dt, game, st) {
      const p = game.player;
      if (!p) return;
      if (st.phase === 'steal') {
        if (p.car) {
          st.phase = 'drive';
          game.spawnMarker(SPOTS.garage.x, SPOTS.garage.z, 'Garage');
          game.setObjective('Drive to the garage');
          game.showMessage('Nice wheels. Now get to the garage.');
        }
        return;
      }
      const pos = playerPos(game);
      if (dist(pos.x, pos.z, SPOTS.garage.x, SPOTS.garage.z) < 9) {
        st.done = true;
      }
    },
  }),

  makeMission({
    id: 1,
    title: 'Hot Deliveries',
    briefing: 'Deliver 3 packages to the marked drop points within 150 seconds. Drive or run — just be quick.',
    reward: 350,
    init(game) {
      const drops = [SPOTS.delivery1, SPOTS.delivery2, SPOTS.delivery3];
      game.spawnMarker(drops[0].x, drops[0].z, 'Drop 1/3');
      game.setObjective('Deliver package 1/3 — 150 s left');
      game.showMessage('Mission: Hot Deliveries — 3 drops, 150 seconds.');
      return { drops, index: 0, timeLeft: 150 };
    },
    tick(dt, game, st) {
      st.timeLeft -= dt;
      if (st.timeLeft <= 0) {
        st.failed = true;
        game.clearMarker();
        game.setObjective('');
        game.showMessage('Too slow — the deliveries went cold. Try again from the pause menu.');
        return;
      }
      const target = st.drops[st.index];
      game.setObjective(`Deliver package ${st.index + 1}/3 — ${Math.ceil(st.timeLeft)} s left`);
      const pos = playerPos(game);
      if (dist(pos.x, pos.z, target.x, target.z) < 7) {
        game.audio.pickup();
        st.index += 1;
        if (st.index >= st.drops.length) {
          st.done = true;
          return;
        }
        const next = st.drops[st.index];
        game.spawnMarker(next.x, next.z, `Drop ${st.index + 1}/3`);
        game.showMessage(`Package ${st.index}/3 delivered. Next drop marked.`);
      }
    },
  }),

  makeMission({
    id: 2,
    title: 'Lose the Heat',
    briefing: 'You start this job at 2 stars. Break line of sight and stay hidden until the heat dies down to zero.',
    reward: 400,
    init(game) {
      if (game.police) {
        while (game.police.wanted < 2) game.police.addWanted(1);
      }
      game.setObjective('Lose the cops — get your wanted level to 0');
      game.showMessage('Mission: Lose the Heat — you are at 2 stars. Hide!');
      return {};
    },
    tick(dt, game, st) {
      if (game.police && game.police.wanted <= 0) st.done = true;
    },
  }),

  makeMission({
    id: 3,
    title: 'The Pickup',
    briefing: 'Pick up the briefcase on foot, then escape the 2-star chase to the safehouse.',
    reward: 500,
    init(game) {
      game.spawnMarker(SPOTS.briefcase.x, SPOTS.briefcase.z, 'Briefcase');
      game.setObjective('Go to the briefcase and pick it up on foot');
      game.showMessage('Mission: The Pickup — grab the briefcase.');
      return { phase: 'goto' };
    },
    tick(dt, game, st) {
      const p = game.player;
      if (!p) return;
      if (st.phase === 'goto') {
        if (!p.onFoot) return;
        if (dist(p.x, p.z, SPOTS.briefcase.x, SPOTS.briefcase.z) < 3.5) {
          st.phase = 'escape';
          if (game.police) {
            while (game.police.wanted < 2) game.police.addWanted(1);
          }
          game.audio.pickup();
          game.spawnMarker(SPOTS.safehouse.x, SPOTS.safehouse.z, 'Safehouse');
          game.setObjective('Escape to the safehouse');
          game.showMessage('Got it! Lose the cops and reach the safehouse.');
        }
        return;
      }
      const pos = playerPos(game);
      if (dist(pos.x, pos.z, SPOTS.safehouse.x, SPOTS.safehouse.z) < 9) {
        st.done = true;
      }
    },
  }),

  makeMission({
    id: 4,
    title: 'The Big One',
    briefing: 'Drive to the bank, go in on foot and hold E for 3 seconds to grab the cash, then escape a 3-star chase to the safehouse.',
    reward: 1500,
    init(game) {
      game.spawnMarker(SPOTS.bank.x, SPOTS.bank.z, 'Bank');
      game.setObjective('Drive to the bank');
      game.showMessage('Mission: The Big One — hit the bank.');
      return { phase: 'bank', hold: 0 };
    },
    tick(dt, game, st) {
      const p = game.player;
      if (!p) return;
      if (st.phase === 'bank') {
        const pos = playerPos(game);
        if (dist(pos.x, pos.z, SPOTS.bank.x, SPOTS.bank.z) < 9) {
          st.phase = 'vault';
          game.setObjective('Go in on foot — hold E at the vault for 3 s');
          game.showMessage('Inside. Hold E at the vault.');
        }
        return;
      }
      if (st.phase === 'vault') {
        const near = p.onFoot && dist(p.x, p.z, SPOTS.bank.x, SPOTS.bank.z) < 7;
        const holding = near && game.input && game.input.keys.has('KeyE');
        if (holding) {
          st.hold += dt;
          game.setObjective(`Grabbing the cash… ${Math.ceil(3 - st.hold)} s`);
          if (st.hold >= 3) {
            st.phase = 'escape';
            if (game.police) {
              while (game.police.wanted < 3) game.police.addWanted(1);
            }
            game.audio.sting();
            game.spawnMarker(SPOTS.safehouse.x, SPOTS.safehouse.z, 'Safehouse');
            game.setObjective('Escape to the safehouse — 3 stars!');
            game.showMessage('Cash grabbed! Run for the safehouse!');
          }
        } else {
          st.hold = 0;
          game.setObjective('Go in on foot — hold E at the vault for 3 s');
        }
        return;
      }
      const pos = playerPos(game);
      if (dist(pos.x, pos.z, SPOTS.safehouse.x, SPOTS.safehouse.z) < 9) {
        st.done = true;
      }
    },
  }),
];

export function createMissionManager(game) {
  let active = null;
  let activeIndex = -1;

  return {
    get active() { return active; },
    get activeIndex() { return activeIndex; },

    available() {
      const done = game.missionsDone || [];
      const out = [];
      for (let i = 0; i < MISSIONS.length; i++) {
        if (i === 0 || done.includes(i - 1)) out.push(i);
      }
      return out;
    },

    start(i) {
      if (i < 0 || i >= MISSIONS.length) return false;
      if (!this.available().includes(i)) return false;
      if (active) game.clearMarker();
      activeIndex = i;
      active = MISSIONS[i];
      active.start(game);
      if (game.hud) game.hud.setMission(`Mission: ${active.title}`);
      if (game.audio) game.audio.click();
      return true;
    },

    cancel() {
      if (!active) return;
      active = null;
      activeIndex = -1;
      game.clearMarker();
      if (game.hud) {
        game.hud.setMission('');
        game.hud.setObjective('');
      }
    },

    update(dt) {
      if (!active) return;
      active.update(dt, game);
      if (active.isDone) {
        const reward = active.reward;
        const title = active.title;
        const idx = activeIndex;
        active = null;
        activeIndex = -1;
        game.clearMarker();
        if (game.hud) {
          game.hud.setMission('');
          game.hud.setObjective('');
          game.hud.flash('MISSION COMPLETE');
        }
        game.addMoney(reward);
        if (game.audio) game.audio.sting();
        game.showMessage(`Mission complete: ${title} — +$${reward}.`);
        if (!game.missionsDone.includes(idx)) game.missionsDone.push(idx);
        if (game.save) game.save();
        if (idx === MISSIONS.length - 1 && game.onStoryComplete) game.onStoryComplete();
      } else if (active.isFailed) {
        active = null;
        activeIndex = -1;
        if (game.hud) {
          game.hud.setMission('');
          game.hud.setObjective('');
        }
      }
    },
  };
}
