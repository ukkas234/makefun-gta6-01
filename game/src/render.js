// Three.js world: renderer, camera, lights, sky, fog, day/night cycle.
// Shadows stay OFF by design (blob shadows only — see createBlobShadow, used by
// player.js / vehicles.js under cars and the player).
//
// createWorld3D(canvas) → {
//   scene, camera, renderer, sun, hemi, nightFactor, timeOfDay,
//   setTimeOfDay(t), isNight(), update(dt), render(), createBlobShadow(size),
//   resize()
// }
//
// setTimeOfDay takes game-clock hours (0..24) or a fraction of the day (0..1);
// 6:00 sunrise, 18:00 sunset. It also drives the city's night materials
// (lit windows, neon, lamps) via scene.userData.solmaraCity when present.
import * as THREE from '../vendor/three.module.js';
import { COLORS } from './config.js';

const SKY_DAY = new THREE.Color(COLORS.skyDay);
const SKY_DUSK = new THREE.Color(COLORS.skyDusk);
const SKY_NIGHT = new THREE.Color(COLORS.skyNight);
const FOG_DAY = new THREE.Color(COLORS.fogDay);
const FOG_NIGHT = new THREE.Color(COLORS.fogNight);
const SUN_DAY = new THREE.Color(COLORS.sunDay);
const SUN_DUSK = new THREE.Color(COLORS.sunDusk);
const MOON = new THREE.Color(COLORS.moon);

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

export function createWorld3D(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.shadowMap.enabled = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.skyDay);
  scene.fog = new THREE.Fog(COLORS.fogDay, 120, 700);

  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1500);
  camera.position.set(0, 42, 90);
  camera.lookAt(0, 0, 0);

  const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x4a5240, 0.9);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff2d8, 1.6);
  sun.position.set(120, 180, 60);
  scene.add(sun);
  scene.add(sun.target);

  let timeOfDay = 9;
  let nightFactor = 0;

  function resize() {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    if (canvas.width !== Math.floor(width * renderer.getPixelRatio()) || canvas.height !== Math.floor(height * renderer.getPixelRatio())) {
      renderer.setSize(width, height, false);
    }
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
  }

  /** t: game-clock time — either hours (0..24) or a fraction of the day (0..1).
   *  main.js passes a fraction (clockHours / 24); shots pass hours. Both work:
   *  values in [0, 1] are read as fractions, values above 1 as hours.
   *  6:00 sunrise, 12:00 noon, 18:00 sunset. Also drives the city's night
   *  materials (lit windows, neon, lamps) via scene.userData.solmaraCity,
   *  so callers only ever need this one call. */
  function setTimeOfDay(t) {
    const hours = t >= 0 && t <= 1 ? t * 24 : t;
    timeOfDay = ((hours % 24) + 24) % 24;
    // Daylight: 0 at night, 1 at noon, smooth ramps at dawn/dusk.
    const dayProgress = (timeOfDay - 6) / 12; // 0 at 06:00, 1 at 18:00
    const daylight = dayProgress <= 0 || dayProgress >= 1 ? 0 : Math.sin(dayProgress * Math.PI);
    // Dusk factor peaks near sunrise/sunset.
    const dusk = dayProgress > 0 && dayProgress < 1 ? clamp01(1 - Math.abs(dayProgress - 0.5) * 4) : 0;
    nightFactor = 1 - daylight;

    // Sky: day blue → dusk orange → night dark blue.
    const sky = new THREE.Color();
    if (daylight >= 0.999) sky.copy(SKY_DAY);
    else if (nightFactor >= 0.999) sky.copy(SKY_NIGHT);
    else if (dusk > 0) sky.copy(SKY_DAY).lerp(SKY_DUSK, dusk).lerp(SKY_NIGHT, nightFactor * 0.6);
    else sky.copy(SKY_DAY).lerp(SKY_NIGHT, nightFactor);
    scene.background = sky;
    scene.fog.color.copy(FOG_DAY).lerp(FOG_NIGHT, nightFactor);
    scene.fog.near = 120 + nightFactor * 40;
    scene.fog.far = 700 - nightFactor * 220;

    // Sun: high warm-white at noon, low orange at dusk, dim blue "moon" at night.
    const angle = dayProgress * Math.PI; // 0..PI while up
    if (daylight > 0) {
      sun.position.set(Math.cos(angle) * 220, Math.sin(angle) * 200 + 20, 80);
      sun.color.copy(SUN_DAY).lerp(SUN_DUSK, dusk);
      sun.intensity = 0.6 + daylight * 1.4;
    } else {
      const moonAngle = ((timeOfDay + 12) % 24 - 6) / 12 * Math.PI;
      sun.position.set(Math.cos(moonAngle) * 180, Math.max(40, Math.sin(moonAngle) * 160), -60);
      sun.color.copy(MOON);
      sun.intensity = 0.28;
    }
    sun.target.position.set(0, 0, 0);
    hemi.intensity = 0.35 + daylight * 0.85;
    hemi.color.setHex(0xbfd9ff).lerp(new THREE.Color(0x2a3a5f), nightFactor);
    hemi.groundColor.setHex(0x4a5240).lerp(new THREE.Color(0x1a1c22), nightFactor);
    // Drive the city's night materials (registered by city.js on the scene).
    const cityApi = scene.userData ? scene.userData.solmaraCity : null;
    if (cityApi && typeof cityApi.setNightFactor === 'function') cityApi.setNightFactor(nightFactor);
    return { timeOfDay, nightFactor, daylight, dusk };
  }

  function isNight() {
    return nightFactor > 0.6;
  }

  /**
   * Blob shadow: a flat dark circle placed just above the ground under a car or
   * the player. Cheap, no shadow maps. `size` is the circle diameter in metres.
   */
  function createBlobShadow(size = 2) {
    const geo = new THREE.CircleGeometry(size / 2, 20);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.03;
    mesh.renderOrder = 1;
    return mesh;
  }

  function render() {
    renderer.render(scene, camera);
  }

  function update() {
    resize();
    render();
  }

  window.addEventListener('resize', resize);
  resize();
  setTimeOfDay(timeOfDay);

  return {
    scene,
    camera,
    renderer,
    sun,
    hemi,
    get nightFactor() {
      return nightFactor;
    },
    get timeOfDay() {
      return timeOfDay;
    },
    setTimeOfDay,
    isNight,
    update,
    render,
    createBlobShadow,
    resize,
  };
}
