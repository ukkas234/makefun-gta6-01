// Solmara — shared constants. Every tuning number and colour in one place.
// The city is a 10x10 block grid on the ground plane y=0, x east, z south.
// Roads run at x,z = -260..260 in steps of 52 m (block 40 m + road 12 m).
// No network, no build step: plain ES module, imported with relative paths.

/** Fixed simulation step, in seconds: 60 updates a second whatever the display rate. */
export const STEP = 1 / 60;

/** World seed used when no ?seed= is given to the page. */
export const DEFAULT_SEED = 1;

/** City geometry. `half` is the outer road line; the drivable grid spans -260..260. */
export const CITY = {
  blocks: 10,
  blockSize: 40,
  roadWidth: 12,
  pitch: 52,
  half: 260,
  size: 520,
  min: -260,
  max: 260,
  /** Beach strip south of the last road (z = 260..292), water beyond it. */
  beachStart: 260,
  beachEnd: 292,
  waterStart: 292,
  /** Low-poly hills sit outside this radius from the centre. */
  hillsRadius: 300,
  seed: DEFAULT_SEED,
};

/** Aliases kept short for the modules that use them most. */
export const BLOCK = CITY.blockSize;
export const ROAD = CITY.roadWidth;
export const PITCH = CITY.pitch;

/** Road centre lines, in metres: -260, -208, …, 260 (11 lines per axis). */
export const ROAD_LINES = [];
for (let i = 0; i <= CITY.blocks; i += 1) ROAD_LINES.push(CITY.min + i * CITY.pitch);

/** Block centre lines: -234, -182, …, 234 (10 per axis). */
export const BLOCK_LINES = [];
for (let i = 0; i < CITY.blocks; i += 1) BLOCK_LINES.push(CITY.min + CITY.roadWidth / 2 + CITY.blockSize / 2 + i * CITY.pitch);

/** Keyboard controls (event.code values). */
export const KEYS = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  up: 'ArrowUp',
  down: 'ArrowDown',
  leftArrow: 'ArrowLeft',
  rightArrow: 'ArrowRight',
  run: 'ShiftLeft',
  runRight: 'ShiftRight',
  jump: 'Space',
  handbrake: 'Space',
  interact: 'KeyE',
  punch: 'KeyF',
  weapon: 'KeyQ',
  flip: 'KeyR',
  mute: 'KeyM',
  pause: 'KeyP',
  escape: 'Escape',
  confirm: 'Enter',
};

/** Palette: UI + world colours. Original Solmara look, no borrowed IP. */
export const COLORS = {
  skyDay: 0x87b5e0,
  skyDusk: 0xe8956a,
  skyNight: 0x0a1226,
  fogDay: 0x9db8cc,
  fogNight: 0x0a1226,
  sunDay: 0xfff2d8,
  sunDusk: 0xff9a52,
  moon: 0x9db8ff,
  asphalt: 0x2e2f33,
  sidewalk: 0x8f8d86,
  grass: 0x4d7a3a,
  sand: 0xd9c28a,
  water: 0x1d6f8e,
  hill: 0x3d5c33,
  hillFar: 0x2e4a2c,
  buildingRoof: 0x3a3d44,
  neonPink: 0xff4fa3,
  neonCyan: 0x35e0ff,
  neonYellow: 0xffd23f,
  neonGreen: 0x52ff8a,
  lampWarm: 0xffc46b,
  health: 0x58d364,
  wanted: 0xffd23f,
  money: 0x7ee787,
  police: 0x2f6df6,
  taxi: 0xffc61a,
};

/** Backwards-compatible alias: several modules import PALETTE. */
export const PALETTE = COLORS;

/** System font stack only — no webfonts, no network. */
export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Save key in localStorage (see save.js). */
export const SAVE_KEY = 'solmara-save-v1';

/** On-foot player tuning. */
export const PLAYER = {
  walkSpeed: 5,
  runSpeed: 9,
  accel: 40,
  radius: 0.55,
  height: 1.8,
  jumpSpeed: 7.5,
  gravity: 20,
  maxHealth: 100,
  punchRange: 1.6,
  punchDamage: 15,
  punchCooldown: 0.45,
};

/** Pistol tuning (hitscan, infinite ammo). */
export const PISTOL = {
  damage: 34,
  range: 60,
  cooldown: 0.28,
  spread: 0.012,
};

/** Game clock: one in-game hour per CLOCK_SECONDS real seconds. */
export const CLOCK = {
  startHour: 9,
  secondsPerGameHour: 60,
  dayStart: 6,
  nightStart: 19,
};

/** Economy and wanted-system balance. */
export const BALANCE = {
  rewards: {
    m1: 200,
    m2: 350,
    m3: 400,
    m4: 500,
    m5: 1500,
    package: 50,
  },
  fines: {
    busted: 100,
    wasted: 50,
  },
  /** Wanted decays by 1 star per this many seconds while hidden (no cop within 60 m). */
  wantedDecaySeconds: 20,
  wantedHiddenRadius: 60,
  /** Distance (m) at which a witness can see a car theft. */
  witnessRadius: 45,
  /** On-foot cop within this distance for this long busts the player. */
  bustDistance: 2,
  bustSeconds: 2,
  startMoney: 150,
  maxWanted: 5,
};

/** Mission rewards by mission id (same numbers as BALANCE.rewards, keyed for missions.js). */
export const MISSION_REWARDS = {
  m1: 200,
  m2: 350,
  m3: 400,
  m4: 500,
  m5: 1500,
};

/** Traffic / police tuning shared by traffic.js and police.js. */
export const TRAFFIC = {
  count: 26,
  pedCount: 30,
  carSpacing: 9,
  cruiseSpeed: 9,
  policeCruiseSpeed: 14,
  policeChaseSpeed: 19,
  copRunSpeed: 6.5,
};
