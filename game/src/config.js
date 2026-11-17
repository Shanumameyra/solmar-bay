// SOLMAR BAY — game constants. Single source of truth for every module.
// All distances in metres, all speeds in m/s, all times in seconds.
// The city is a flat XZ ground plane, +Y up, centred on the origin (0, 0).
export const CONFIG = {
  // Fixed-step simulation.
  STEP: 1 / 60,
  MAX_FRAME: 0.25,

  // ---- City layout ----
  CITY: {
    HALF: 200,            // city spans x,z in [-200, 200]
    BLOCKS: 8,            // 8 x 8 blocks
    PITCH: 48,            // block centre spacing
    BLOCK: 36,            // block size (building ground footprint zone)
    STREET: 12,           // street width (asphalt)
    SIDEWALK: 3,          // sidewalk width on each side of a street
    // Street centrelines (9 per axis, 48 m apart).
    STREETS: [-192, -144, -96, -48, 0, 48, 96, 144, 192],
    // Block centres (8 per axis).
    CENTRES: [-168, -120, -72, -24, 24, 72, 120, 168],
  },

  // ---- Districts (by block centre) ----
  // beach: west edge | plaza: centre 2x2 blocks | downtown: north-east |
  // port: east edge | barrios: south | market: ring around the plaza.
  DISTRICTS: {
    BEACH_X: -120,        // blocks with centre x <= -120 are beachfront
    DOWNTOWN_X: 48,       // x >= 48 and z <= -48 is downtown
    DOWNTOWN_Z: -48,
    PORT_X: 120,          // x >= 120 is the port / docks
    BARRIOS_Z: 96,        // z >= 96 is the barrios
    PLAZA_R: 48,          // |x|<=48 and |z|<=48 is the market plaza (open)
  },

  // ---- On-foot movement ----
  PLAYER: {
    WALK_SPEED: 5,
    RUN_SPEED: 8,
    RADIUS: 0.45,
    HEIGHT: 1.8,
    HEALTH: 100,
    PUNCH_RANGE: 2.0,
    PUNCH_DAMAGE: 15,
    PUNCH_COOLDOWN: 0.4,
    ENTER_RANGE: 3.2,
    CAMERA_HEIGHT: 1.7,
    CAMERA_BACK: 4.2,
  },

  // ---- Driving ----
  CAR: {
    ACCEL: 12,            // m/s^2
    TOP_SPEED: 38,        // m/s (~137 km/h)
    SPORTS_TOP: 46,       // sports car top speed
    BRAKE: 20,
    REVERSE_TOP: 10,
    STEER_MAX: 0.55,      // radians at standstill
    STEER_SPEED: 0.32,    // radians at top speed (speed-sensitive)
    HANDBRAKE_DRIFT: 0.9, // extra yaw rate while drifting
    DAMAGE_PER_HIT: 8,    // base collision damage
    HP: 100,
    SMOKE_HP: 35,         // smoke below this HP
    STALL_HP: 0,
    ENTER_TIME: 0.4,      // door-open beat (seconds)
  },

  // ---- Car models (built from boxes, distinct silhouettes) ----
  CAR_MODELS: {
    sedan:  { len: 4.4, wid: 1.9, hgt: 1.35, color: 0x3a6fd8, top: 38, name: 'Sedan' },
    sports: { len: 4.2, wid: 1.9, hgt: 1.15, color: 0xf5c518, top: 46, name: 'Sports' },
    taxi:   { len: 4.4, wid: 1.9, hgt: 1.4,  color: 0xf2b705, top: 38, name: 'Taxi' },
    truck:  { len: 6.2, wid: 2.3, hgt: 2.2,  color: 0x8a7d6b, top: 30, name: 'Truck' },
    van:    { len: 5.0, wid: 2.0, hgt: 1.9,  color: 0x9aa5b1, top: 34, name: 'Van' },
    police: { len: 4.5, wid: 1.9, hgt: 1.4,  color: 0x1e4fa3, top: 42, name: 'SBPD Cruiser' },
  },

  // ---- Traffic & pedestrians ----
  TRAFFIC: {
    COUNT: 10,
    CRUISE_SPEED: 9,      // m/s on streets
    STOP_DIST: 7,         // stop behind the car ahead
    LIGHT_CYCLE: 8,       // seconds per light phase
  },
  PEDS: {
    COUNT: 18,
    WALK_SPEED: 1.4,
    FLEE_SPEED: 3.4,
    FLEE_RADIUS: 18,      // flee when a threat is closer than this
  },

  // ---- Wanted / police (police.js implements; tiers live here) ----
  WANTED: {
    MAX_STARS: 5,
    HEAT: {
      STEAL_WITNESSED: 1, // stealing seen by a ped
      STEAL_POLICE: 2,    // stealing seen by police
      HIT_PED: 1,
      SHOT_NEAR_POLICE: 1,
      KILL_COP: 2,
    },
    // stars -> { cars, footCops, speedMul } (how many police respond)
    TIERS: [
      { stars: 0, cars: 0, foot: 0, speedMul: 1.0 },
      { stars: 1, cars: 1, foot: 0, speedMul: 1.0 },
      { stars: 2, cars: 2, foot: 0, speedMul: 1.05 },
      { stars: 3, cars: 3, foot: 2, speedMul: 1.12 },
      { stars: 4, cars: 4, foot: 4, speedMul: 1.2 },
      { stars: 5, cars: 5, foot: 6, speedMul: 1.3 },
    ],
    DECAY_SIGHT_LOST: 15, // seconds out of sight before cooldown starts
    DECAY_PER_STAR: 10,   // seconds per star lost during cooldown
    BUST_FINE: 200,
    BUST_FOOT_RANGE: 3,    // cop within this (m) for 2 s on foot -> busted
    BUST_FOOT_TIME: 2,
    BUST_CAR_RANGE: 4,    // police car within this (m), player speed < 2, for 3 s
    BUST_CAR_TIME: 3,
    BUST_CAR_SPEED: 2,
  },

  // ---- Missions (missions.js implements; data lives here) ----
  MISSIONS: [
    { id: 'M0', name: 'The Call', reward: 0, time: 0,
      intro: "Dario, it's Rosa. Come to the café." },
    { id: 'M1', name: 'The Pickup', reward: 300, time: 150,
      intro: 'Pick up the package at the docks, bring it to Rosa.',
      steps: ['Drive to the docks', 'Collect the package', 'Deliver to the café'] },
    { id: 'M2', name: 'Hot Wheels', reward: 500, time: 0,
      intro: 'Steal the yellow sports car at the beachfront. Bring it to the garage.',
      steps: ['Steal the yellow sports car', 'Deliver it to the garage'] },
    { id: 'M3', name: 'The Getaway', reward: 800, time: 150,
      intro: 'Three stars, three cruisers. Reach the safehouse in the barrios.',
      steps: ['Reach the safehouse', 'Lose the heat'] },
  ],
  TAXI_FARE: 45,
  CASH_PICKUP: 25,

  // ---- Combat ----
  COMBAT: {
    PISTOL_MAG: 12,
    PISTOL_DAMAGE: 25,
    PISTOL_RANGE: 40,
    PISTOL_FALLOFF: 30,   // damage halves past this range
    RELOAD_TIME: 1.2,
    AMMO_PRICE: 50,       // 12 rounds at the gun shop
    AMMO_PER_BUY: 12,
    POLICE_HP: 100,
    MEDKIT_HEAL: 50,
    DEATH_FINE: 100,
  },

  // ---- World state ----
  START: {
    MONEY: 150,
    TIME_OF_DAY: 17.67,   // 17:40 golden hour, fixed
    PLAYER_SPAWN: { x: 8, z: 30, angle: Math.PI }, // south of the plaza, facing it (north, -z). Angle convention (shared with Worker B): forward = (sin angle, cos angle); angle 0 = +z (south), PI = -z (north).
  },

  // ---- Named places (filled in by city.js; B reads them for missions) ----
  PLACES: {
    CAFE: 'cafe',         // Rosa's café, market plaza
    DOCKS: 'docks',       // port, east
    GARAGE: 'garage',     // south, barrios edge
    SAFEHOUSE: 'safehouse',
    HOSPITAL: 'hospital',
    PRECINCT: 'precinct',
    GUNSHOP: 'gunshop',
    BEACH_CAR: 'beachCar', // the yellow sports car for M2
  },

  // ---- Render budget ----
  RENDER: {
    MAX_DRAW_CALLS: 60,
    MAX_TRIS: 150000,
    SHADOW_MAP: 1024,
    FOG_NEAR: 220,
    FOG_FAR: 520,
    CAMERA_FOV: 62,
    CAMERA_NEAR: 0.1,
    CAMERA_FAR: 900,
  },

  // ---- Palette (bright golden hour, pastel + chrome) ----
  // Brightened 18 Nov: the first pass read too dark and gloomy on screen.
  // A higher sun + stronger hemisphere light + a lighter sky keep the
  // golden-hour warmth while the city reads as alive and sunlit.
  PALETTE: {
    SKY_TOP: 0x5a8ac0,
    SKY_HORIZON: 0xffc27a,
    SUN: 0xffe0b0,
    SUN_INTENSITY: 3.4,
    HEMI_SKY: 0xb8d0f0,
    HEMI_GROUND: 0x5a4632,
    HEMI_INTENSITY: 1.05,
    ASPHALT: 0x45484f,
    SIDEWALK: 0x9a9184,
    SAND: 0xd9b380,
    SEA: 0x3a8ab0,
    BUILDING_LOW: [0xe8b4a0, 0xf2d5a0, 0xa8c8d8, 0xd8a8b8, 0xc8d8a8],
    BUILDING_MID: [0xd8c8b8, 0xb8c8d8, 0xe8d8c8, 0xc8b8a8],
    BUILDING_TOWER: [0x8aa0b8, 0xa8b8d0, 0x7a90a8],
    GLASS: 0x2a3a4a,
    NEON: [0xff2d78, 0x00e5ff, 0xffd23d, 0x39ff88, 0xff7a1a],
  },
};

// Named landmark positions are written by buildCity() into this object so
// missions.js / shots.js can read them without importing the city module.
export const LANDMARKS = {
  cafe: { x: 0, z: -36 },
  docks: { x: 144, z: 48 },
  garage: { x: -24, z: 144 },
  safehouse: { x: -120, z: 144 },
  hospital: { x: 144, z: -72 },
  precinct: { x: 72, z: 144 },
  gunshop: { x: -72, z: 96 },
  beachCar: { x: -176, z: -72 },
  beach: { x: -156, z: 0 },
  downtown: { x: 120, z: -144 },
  plaza: { x: 0, z: 12 },
  pier: { x: -210, z: 48 },
  market: { x: 0, z: 24 },
};
