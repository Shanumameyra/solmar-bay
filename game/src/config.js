// config.js — Solmar Bay: every tunable number in one place.
// One unit in world space is one metre. All speeds are metres per second,
// all accelerations metres per second squared. Nothing here imports anything;
// every other module reads its numbers from here so the whole game stays
// consistent (the v4 on-foot bug was a speed/scale mismatch — this file is
// the single source of truth that prevents a repeat).

// ---------------------------------------------------------------- world ---
export const WORLD_SIZE = 400;            // city is WORLD_SIZE x WORLD_SIZE m
export const WORLD_HALF = WORLD_SIZE / 2; // 200 — world runs -200..+200 on x/z
export const BLOCK_COUNT = 8;             // 8 x 8 blocks
export const BLOCK_PITCH = 50;            // metres between street centrelines
export const STREET_WIDTH = 12;           // metres of asphalt per street
export const SIDEWALK_WIDTH = 3;          // metres of sidewalk each side
export const ROAD_HALF = STREET_WIDTH / 2;

// Street centrelines: 8 lines each way, evenly spaced across the city.
export const STREET_LINES = [-175, -125, -75, -25, 25, 75, 125, 175];

// ------------------------------------------------------------- districts --
export const DISTRICTS = {
  beach:    { name: 'Beachfront',   x0: -200, x1: -100, z0: -200, z1: 200,
              desc: 'sand, pier and palms on the west edge' },
  plaza:    { name: 'Market Plaza', x0: -50,  x1: 50,   z0: -50,  z1: 50,
              desc: 'stalls and Rosa\'s cafe at the centre' },
  downtown: { name: 'Downtown',     x0: 50,   x1: 200,  z0: -200, z1: -50,
              desc: 'towers and neon in the north-east' },
  port:     { name: 'Port / Docks', x0: 100,  x1: 200,  z0: -50,  z1: 200,
              desc: 'containers and cranes on the east edge' },
  barrios:  { name: 'Barrios',      x0: -100, x1: 100,  z0: 100,  z1: 200,
              desc: 'low colourful houses in the south' },
};

// -------------------------------------------------------------- player ----
export const PLAYER = {
  walkSpeed: 5,          // m/s — MUST stay >= 5 (v4 bug: effectively 0.1 m/s)
  runSpeed: 8,           // m/s while Shift is held
  radius: 0.45,          // collision radius, metres
  height: 1.8,
  hp: 100,
  turnSpeed: 10,         // rad/s facing turn rate on foot
  enterCarTime: 0.4,     // seconds for the enter-car animation
  punchRange: 2,         // metres
  punchDamage: 15,
  punchCooldown: 0.4,    // seconds
  pistolDamage: 25,
  pistolMag: 12,
  pistolReload: 1.2,     // seconds
  pistolRange: 60,       // metres (damage falloff beyond 30)
  pistolFalloffStart: 30,
};

// -------------------------------------------------------------- driving ---
export const CAR = {
  accel: 12,             // m/s^2
  brake: 20,             // m/s^2
  reverseAccel: 10,      // m/s^2
  topSpeed: 38,          // m/s (~137 km/h)
  sportsTopSpeed: 46,    // m/s (~166 km/h)
  reverseTopSpeed: 10,   // m/s
  maxSteer: 0.55,        // radians at standstill
  steerAtSpeed: 0.12,    // radians at top speed
  grip: 8,               // lateral grip (higher = less slide)
  handbrakeGrip: 2.2,    // grip while handbraking (drift)
  drag: 0.35,            // quadratic drag coefficient
  rollDrag: 0.6,         // linear rolling resistance
  hp: 100,
  radius: 1.6,           // collision radius used for car-vs-car checks
  length: 4.4,
  width: 2.0,
};

export const CAR_TYPES = {
  sedan:  { label: 'Solmar Sedan',  topSpeed: 34, accel: 11, color: 0x3a6ea5, price: 0 },
  coupe:  { label: 'Coupe',         topSpeed: 38, accel: 12, color: 0xc0392b, price: 0 },
  sports: { label: 'Solmar GT',     topSpeed: 46, accel: 15, color: 0xf1c40f, price: 0 },
  taxi:   { label: 'Taxi',          topSpeed: 34, accel: 11, color: 0xf39c12, price: 0 },
  van:    { label: 'Van',           topSpeed: 30, accel: 9,  color: 0x7f8c8d, price: 0 },
  truck:  { label: 'Box Truck',     topSpeed: 28, accel: 8,  color: 0x5d6d7e, price: 0 },
  police: { label: 'SBPD Cruiser',  topSpeed: 40, accel: 13, color: 0x2471a3, price: 0 },
};

// -------------------------------------------------------------- traffic ---
export const TRAFFIC = {
  carCount: 10,
  parkedCount: 8,
  pedCount: 26,
  cruiseSpeed: 9,        // m/s, city traffic cruise
  maxSpeed: 14,
  stopDistance: 7,       // metres to stop behind a car ahead
  pedWalkSpeed: 1.4,     // m/s
  pedRunSpeed: 4.5,      // m/s when fleeing
  lightCycle: 14,        // seconds per full red/green cycle
  lightGreen: 8,         // seconds of green within the cycle
};

// -------------------------------------------------------- wanted / police -
export const WANTED = {
  maxStars: 5,
  decayOutOfSight: 15,   // seconds out of police sight before decay starts
  decayInterval: 10,     // seconds per -1 star while decayed
  bustDistanceOnFoot: 3, // metres — cop this close for bustTime -> busted
  bustTimeOnFoot: 2,     // seconds
  bustDistanceInCar: 4,
  bustTimeInCar: 3,
  escapeDistance: 60,    // metres — beyond this + no line of sight = escaping
  escapeTime: 15,        // seconds of escape before cooldown
  stealWitnessed: 1,     // stars for stealing a car in view
  stealPoliceSaw: 2,     // stars if police see the theft
  hitPed: 1,
  shotNearPolice: 1,
  killCop: 2,
  bustFine: 200,         // dollars lost when busted
  deathFine: 100,        // dollars lost when wasted
};

// ------------------------------------------------------------- missions ---
export const MISSIONS = {
  rewardM1: 300,
  rewardM2: 500,
  rewardM3: 800,
  timeLimitM1: 150,      // seconds
  timeLimitM3: 150,
  taxiFareMin: 25,
  taxiFareMax: 60,
};

// -------------------------------------------------------------- economy ---
export const ECONOMY = {
  startMoney: 150,
  ammoPrice: 50,         // $ for 12 pistol rounds at the gun shop
  ammoRounds: 12,
  medkitHeal: 50,
  cashPickupMin: 20,
  cashPickupMax: 80,
  cashPickupCount: 6,
};

// ----------------------------------------------------------------- time ---
export const CLOCK = {
  startMinutes: 17 * 60 + 40, // 17:40 golden hour, fixed for the whole game
  fixed: true,                 // no day cycle — fixed light, consistent shots
};

// --------------------------------------------------------------- camera ---
export const CAMERA = {
  onFootDistance: 7,
  onFootHeight: 3.2,
  carDistance: 10,
  carHeight: 4.2,
  fov: 60,
  near: 0.1,
  far: 900,
  lerp: 6,               // camera follow smoothing (per second)
};

// ------------------------------------------------------------------ hud ---
export const HUD = {
  minimapSize: 160,      // px, matches the <canvas id="minimap"> in index.html
  messageLife: 4,        // seconds a feed message stays visible
};

// ----------------------------------------------------------------- save ---
export const SAVE_KEY = 'solmar-bay-save-v1';
export const SAVE_BACKUP_KEY = 'solmar-bay-save-v1.bak';
export const SAVE_INTERVAL = 30; // seconds between autosaves

// ----------------------------------------------------------------- shots --
export const SHOTS = {
  seed: 7,
  count: 4,
};

// -------------------------------------------------------------- palette ---
// Pastel + chrome, golden hour. Colours are hex numbers for three.js.
export const PALETTE = {
  skyTop: 0x2e5f8a,
  skyHorizon: 0xffb347,
  sun: 0xffd9a0,
  fog: 0xf2a65a,
  road: 0x2e3138,
  roadLine: 0xe8e8e8,
  sidewalk: 0x9a938a,
  sand: 0xe8d29a,
  sea: 0x2e7f9e,
  grass: 0x5d8a4a,
  buildingPastel: [0xf5c6a5, 0xf7d774, 0xa8d8c8, 0xf2a0a0, 0xc3b1e1, 0x9fc5e8],
  buildingGlass: [0x7fb3d5, 0x5dade2, 0x85c1e9],
  neon: [0xff5fa2, 0x39d0ff, 0xffe14d, 0x7dff9b, 0xff8c42],
  palmTrunk: 0x8a6d4b,
  palmLeaf: 0x3e8e41,
  policeBlue: 0x2471a3,
  policeWhite: 0xf4f6f7,
};

// One object for modules that want everything at once.
export const CONFIG = {
  WORLD_SIZE, WORLD_HALF, BLOCK_COUNT, BLOCK_PITCH, STREET_WIDTH,
  SIDEWALK_WIDTH, ROAD_HALF, STREET_LINES, DISTRICTS, PLAYER, CAR,
  CAR_TYPES, TRAFFIC, WANTED, MISSIONS, ECONOMY, CLOCK, CAMERA, HUD,
  SAVE_KEY, SAVE_BACKUP_KEY, SAVE_INTERVAL, SHOTS, PALETTE,
};
export default CONFIG;
