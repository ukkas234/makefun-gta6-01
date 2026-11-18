// hud.js — DOM HUD + canvas minimap for Solmara.
// createHUD() -> { update(state), showMessage(text), setObjective(text),
// setMission(title), flash(text) }.
// state = { health, wanted, money, speed, clock, armed, driving,
//           minimap:{ player:{x,z,heading}, cars:[{x,z}], police:[{x,z}],
//                      peds:[{x,z}], marker:{x,z}|null, north }, screen }.
// DOM ids (created if the page does not already provide them):
// #hud, #hud-objective, #hud-mission, #hud-health-fill, #hud-stars,
// #hud-cash, #hud-speed, #hud-clock, #hud-messages, #hud-minimap,
// #hud-crosshair, #hud-flash.
// World extent for the minimap: x,z in [-260, 260]; south (+z) is the coast.
const WORLD = 260;
const MAP_SIZE = 168;

function el(tag, id, parent, css) {
  let node = document.getElementById(id);
  if (node) return node;
  node = document.createElement(tag);
  node.id = id;
  if (css) node.style.cssText = css;
  if (parent) parent.appendChild(node);
  return node;
}

export function createHUD() {
  const noop = {
    update() {}, showMessage() {}, setObjective() {}, setMission() {}, flash() {},
  };
  if (typeof document === 'undefined') return noop;

  let root = document.getElementById('hud');
  if (!root) {
    root = document.createElement('div');
    root.id = 'hud';
    root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:10;font-family:system-ui,Arial,sans-serif;color:#fff;';
    document.body.appendChild(root);
  }

  const top = el('div', 'hud-top', root, 'position:absolute;top:10px;left:50%;transform:translateX(-50%);text-align:center;');
  const missionEl = el('div', 'hud-mission', top, 'font-size:15px;font-weight:700;letter-spacing:1px;text-shadow:0 1px 3px #000;');
  const objectiveEl = el('div', 'hud-objective', top, 'font-size:13px;opacity:.9;text-shadow:0 1px 3px #000;');

  const stats = el('div', 'hud-stats', root, 'position:absolute;top:10px;right:12px;text-align:right;font-size:14px;text-shadow:0 1px 3px #000;');
  const cashEl = el('div', 'hud-cash', stats, 'font-weight:700;font-size:17px;');
  const clockEl = el('div', 'hud-clock', stats, '');
  const speedEl = el('div', 'hud-speed', stats, 'font-size:20px;font-weight:700;');
  const starsEl = el('div', 'hud-stars', stats, 'font-size:20px;letter-spacing:2px;color:#ffd23e;');

  const healthWrap = el('div', 'hud-health', root, 'position:absolute;top:12px;left:190px;width:180px;');
  el('div', 'hud-health-bar', healthWrap, 'height:12px;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.5);border-radius:6px;overflow:hidden;');
  const healthFill = el('div', 'hud-health-fill', document.getElementById('hud-health-bar'), 'height:100%;width:100%;background:#37d67a;');
  void healthWrap;

  const feed = el('div', 'hud-messages', root, 'position:absolute;left:12px;bottom:190px;max-width:340px;font-size:13px;text-shadow:0 1px 3px #000;');

  let minimap = document.getElementById('hud-minimap');
  if (!minimap) {
    minimap = document.createElement('canvas');
    minimap.id = 'hud-minimap';
    minimap.width = MAP_SIZE;
    minimap.height = MAP_SIZE;
    minimap.style.cssText = 'position:absolute;left:12px;bottom:12px;border:2px solid rgba(255,255,255,.65);border-radius:50%;background:#0c1420;';
    root.appendChild(minimap);
  }

  const crosshair = el('div', 'hud-crosshair', root, 'position:absolute;left:50%;top:50%;width:18px;height:18px;margin:-9px 0 0 -9px;display:none;');
  crosshair.innerHTML = '<div style="position:absolute;left:8px;top:0;width:2px;height:18px;background:#fff;"></div><div style="position:absolute;top:8px;left:0;width:18px;height:2px;background:#fff;"></div>';

  const flashEl = el('div', 'hud-flash', root, 'position:absolute;left:50%;top:38%;transform:translate(-50%,-50%);font-size:34px;font-weight:800;letter-spacing:2px;text-shadow:0 2px 8px #000;opacity:0;transition:opacity .4s;text-align:center;');

  const mctx = minimap.getContext('2d');
  let flashTimer = null;

  function toMap(x, z) {
    return [
      ((x + WORLD) / (WORLD * 2)) * MAP_SIZE,
      ((z + WORLD) / (WORLD * 2)) * MAP_SIZE,
    ];
  }

  function drawMinimap(mm) {
    if (!mctx || !mm) return;
    const g = mctx;
    g.clearRect(0, 0, MAP_SIZE, MAP_SIZE);
    g.save();
    g.beginPath();
    g.arc(MAP_SIZE / 2, MAP_SIZE / 2, MAP_SIZE / 2, 0, Math.PI * 2);
    g.clip();
    // Land.
    g.fillStyle = '#16241a';
    g.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
    // Coast / water along the south edge (+z = bottom of the map).
    g.fillStyle = '#1b6ea8';
    g.fillRect(0, MAP_SIZE - 10, MAP_SIZE, 10);
    g.fillStyle = '#d9c27a';
    g.fillRect(0, MAP_SIZE - 14, MAP_SIZE, 4);
    // Roads: grid every 52 m.
    g.strokeStyle = '#3a3f46';
    g.lineWidth = 4;
    for (let c = -260; c <= 260; c += 52) {
      const [px] = toMap(c, 0);
      const [, pz] = toMap(0, c);
      g.beginPath(); g.moveTo(px, 0); g.lineTo(px, MAP_SIZE); g.stroke();
      g.beginPath(); g.moveTo(0, pz); g.lineTo(MAP_SIZE, pz); g.stroke();
    }
    const dot = (x, z, color, r) => {
      const [px, py] = toMap(x, z);
      g.fillStyle = color;
      g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill();
    };
    if (mm.marker) {
      const [mx, my] = toMap(mm.marker.x, mm.marker.z);
      const pulse = 6 + 2 * Math.sin(Date.now() / 200);
      g.fillStyle = '#ffd23e';
      g.beginPath();
      g.moveTo(mx, my - pulse); g.lineTo(mx + pulse, my); g.lineTo(mx, my + pulse); g.lineTo(mx - pulse, my);
      g.closePath(); g.fill();
    }
    for (const c of mm.cars || []) dot(c.x, c.z, '#e8e8e8', 2);
    for (const p of mm.peds || []) dot(p.x, p.z, '#9aa0a6', 1.5);
    for (const p of mm.police || []) dot(p.x, p.z, '#4aa8ff', 3);
    if (mm.player) {
      const [px, py] = toMap(mm.player.x, mm.player.z);
      const a = mm.player.heading || 0;
      g.fillStyle = '#37d67a';
      g.beginPath();
      g.moveTo(px + Math.sin(a) * 7, py - Math.cos(a) * 7);
      g.lineTo(px + Math.sin(a + 2.5) * 5, py - Math.cos(a + 2.5) * 5);
      g.lineTo(px + Math.sin(a - 2.5) * 5, py - Math.cos(a - 2.5) * 5);
      g.closePath(); g.fill();
      g.strokeStyle = '#fff';
      g.lineWidth = 1;
      g.stroke();
    }
    g.restore();
    // North marker.
    g.fillStyle = '#fff';
    g.font = 'bold 11px system-ui, Arial, sans-serif';
    g.textAlign = 'center';
    g.fillText('N', MAP_SIZE / 2, 12);
  }

  return {
    update(state = {}) {
      const health = Math.max(0, Math.min(100, state.health ?? 100));
      healthFill.style.width = `${health}%`;
      healthFill.style.background = health > 50 ? '#37d67a' : health > 25 ? '#ffb02e' : '#e5484d';
      const wanted = Math.max(0, Math.min(5, state.wanted ?? 0));
      starsEl.textContent = '★'.repeat(wanted) + '☆'.repeat(5 - wanted);
      starsEl.style.visibility = wanted > 0 ? 'visible' : 'hidden';
      cashEl.textContent = `$${Math.floor(state.money ?? 0).toLocaleString('en-US')}`;
      const clock = state.clock ?? 10;
      const hh = Math.floor(clock) % 24;
      const mins = Math.floor((clock % 1) * 60);
      clockEl.textContent = `${String(hh).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
      if (state.driving) {
        speedEl.style.display = 'block';
        speedEl.textContent = `${Math.round(Math.abs(state.speed ?? 0) * 3.6)} km/h`;
      } else {
        speedEl.style.display = 'none';
      }
      crosshair.style.display = state.armed ? 'block' : 'none';
      root.style.display = state.screen === 'title' ? 'none' : 'block';
      drawMinimap(state.minimap);
    },

    showMessage(text) {
      if (!text) return;
      const div = document.createElement('div');
      div.textContent = text;
      div.style.cssText = 'margin-top:4px;background:rgba(0,0,0,.55);padding:3px 8px;border-radius:4px;';
      feed.appendChild(div);
      while (feed.children.length > 5) feed.removeChild(feed.firstChild);
      setTimeout(() => { if (div.parentNode) div.parentNode.removeChild(div); }, 6000);
    },

    setObjective(text) {
      objectiveEl.textContent = text || '';
    },

    setMission(title) {
      missionEl.textContent = title || '';
    },

    flash(text) {
      if (!text) return;
      flashEl.textContent = text;
      flashEl.style.opacity = '1';
      if (flashTimer) clearTimeout(flashTimer);
      flashTimer = setTimeout(() => { flashEl.style.opacity = '0'; }, 2200);
    },
  };
}
