// Solmar Bay — configuration & data tables (Worker A, v2 rebuild).
// Every tunable number lives here so the other modules stay thin.
// Heading convention (shared): a heading/angle `a` means forward =
// (sin(a), 0, cos(a)) in world space; angle 0 = +z (south), PI = -z (north).

export const STEP = 1 / 60;
export const MAX_FRAME = 0.25;

export const CONFIG = {
  STEP,
  MAX_FRAME,

  CITY: {
    HALF: 200,
    // Street centrelines, 48 m apart. Blocks sit between them (36 m wide).
    STREETS: [-192, -144, -96, -48, 0, 48, 96, 144, 192],
    // Block centres.
    CENTRES: [-168, -120, -72, -24, 24, 72, 120, 168],
    STREET_WIDTH: 12,
    BLOCK: 48,
  },

  // District regions, checked in order (first match wins; 'uptown' is the
  // catch-all). Used by city.districtAt(x, z).
  DISTRICTS: [
    { name: 'beach',    minX: -216, maxX: -168, minZ: -216, maxZ: 216 },
    { name: 'downtown', minX: 48,   maxX: 200,  minZ: -200, maxZ: -48 },
    { name: 'port',     minX: 96,   maxX: 200,  minZ: 0,    maxZ: 96 },
    { name: 'market',   minX: -48,  maxX: 48,   minZ: -48,  maxZ: 48 },
    { name: 'barrios',  minX: -200, maxX: 200,  minZ: 96,   maxZ: 200 },
    { name: 'uptown',   minX: -200, maxX: 200,  minZ: -200, maxZ: 200 },
  ],

  PLAYER: {
    WALK: 5,
    RUN: 8,
    HEALTH: 100,
    PUNCH_RANGE: 2.0,
    PUNCH_DAMAGE: 15,
    PUNCH_COOLDOWN: 0.4,
    ENTER_RANGE: 3.2,
  },

  CAR: {
    ACCEL: 12,
    TOP: 38,
    SPORTS_TOP: 46,
    BRAKE: 20,
    REVERSE: 10,
    HP: 100,
  },

  // Car models. len/wid/hgt in metres; topSpeed in m/s.
  // The renderer builds each model from boxes with these dims + colours.
  CAR_MODELS: {
    sedan: {
      name: 'Comet', len: 4.4, wid: 1.9, hgt: 1.35, topSpeed: 38, accel: 12,
      colors: [0x3a6fd8, 0xd8d8d8, 0x2a2a2e, 0xc8b8a0, 0x7a9a6a],
    },
    sports: {
      name: 'Vespera GT', len: 4.3, wid: 1.95, hgt: 1.2, topSpeed: 46, accel: 14,
      colors: [0xffd23d, 0xff2d92, 0xe01e37],
    },
    taxi: {
      name: 'Solmar Cab', len: 4.4, wid: 1.9, hgt: 1.4, topSpeed: 38, accel: 12,
      colors: [0xffc21c],
    },
    truck: {
      name: 'Hauler', len: 6.8, wid: 2.4, hgt: 2.9, topSpeed: 30, accel: 9,
      colors: [0xd8d8d8, 0x4a7a3a],
    },
    van: {
      name: 'Mover', len: 5.2, wid: 2.1, hgt: 2.2, topSpeed: 34, accel: 10,
      colors: [0x8a8a92, 0x5a6a8a],
    },
    police: {
      name: 'SBPD Cruiser', len: 4.5, wid: 1.95, hgt: 1.45, topSpeed: 42, accel: 13,
      colors: [0xf2f2f2],
    },
    tank: {
      name: 'SBPD Armor', len: 5.6, wid: 3.0, hgt: 2.3, topSpeed: 26, accel: 8,
      colors: [0x5a6a4a],
    },
  },

  TRAFFIC: { COUNT: 10, CRUISE: 9 },
  PEDS: { COUNT: 18, WALK: 1.4, FLEE: 3.4, FLEE_RADIUS: 18 },

  WANTED: {
    MAX_STARS: 5,
    HEAT: {
      STEAL_WITNESSED: 1,
      STEAL_POLICE: 2,
      HIT_PED: 1,
      SHOT_NEAR_POLICE: 1,
      KILL_COP: 2,
    },
    // Per star: how many police cars / on-foot cops respond, and their speed.
    TIERS: [
      { cars: 0, foot: 0, speedMul: 1.0 },
      { cars: 1, foot: 0, speedMul: 1.0 },
      { cars: 2, foot: 0, speedMul: 1.05 },
      { cars: 3, foot: 2, speedMul: 1.1 },
      { cars: 4, foot: 4, speedMul: 1.15 },
      { cars: 5, foot: 6, speedMul: 1.2 },
    ],
    DECAY_SIGHT_LOST: 15,
    DECAY_PER_STAR: 10,
    BUST_FINE: 200,
    BUST_FOOT_RANGE: 3,
    BUST_FOOT_TIME: 2,
    BUST_CAR_RANGE: 4,
    BUST_CAR_TIME: 3,
    BUST_CAR_SPEED: 2,
  },

  // Missions (sequential, from Mama Rosa). steps: [{ text, target, dialogue }]
  // where target is a LANDMARKS key; missions.js turns it into a marker.
  MISSIONS: [
    {
      id: 'M0', name: 'The Call', reward: 0, time: 0,
      intro: "Rosa: Dario, it's Rosa. Come to the café. We need to talk.",
      steps: [
        {
          text: "Go to Rosa's café", target: 'cafe',
          dialogue: "Rosa: Dario, it's Rosa. Come to the café. We need to talk.",
        },
      ],
    },
    {
      id: 'M1', name: 'The Pickup', reward: 300, time: 150,
      intro: 'Rosa: A package is waiting at the docks. Bring it to me.',
      steps: [
        {
          text: 'Drive to the docks', target: 'docks',
          dialogue: "Rosa: The package is at the docks, D. Don't keep me waiting.",
        },
        {
          text: 'Collect the package', target: 'docks',
          dialogue: 'Rosa: Grab it and go. Port security is nosy today.',
        },
        {
          text: "Deliver it to Rosa's café", target: 'cafe',
          dialogue: 'Rosa: Bring it home, D. Then we talk money.',
        },
      ],
    },
    {
      id: 'M2', name: 'Hot Wheels', reward: 500, time: 0,
      intro: "Rosa: I need that yellow Vespera on the beachfront. Don't scratch it.",
      steps: [
        {
          text: 'Steal the yellow sports car', target: 'beachCar',
          dialogue: "Rosa: Yellow Vespera, beachfront. It's yours now — take it.",
        },
        {
          text: 'Bring it to the garage', target: 'garage',
          dialogue: 'Rosa: Garage, south side. Quick and clean.',
        },
      ],
    },
    {
      id: 'M3', name: 'The Getaway', reward: 800, time: 150,
      intro: 'Rosa: The SBPD knows. Lose them and get to the safehouse.',
      steps: [
        {
          text: 'Reach the safehouse', target: 'safehouse',
          dialogue: "Rosa: Safehouse, barrios. Lose the cops first — or don't come at all.",
        },
      ],
    },
  ],

  TAXI_FARE: 45,
  CASH_PICKUP: 25,

  COMBAT: {
    PISTOL_MAG: 12,
    PISTOL_DAMAGE: 25,
    PISTOL_RANGE: 40,
    PISTOL_FALLOFF: 30,
    RELOAD_TIME: 1.2,
    AMMO_PRICE: 50,
    AMMO_PER_BUY: 12,
    POLICE_HP: 100,
    MEDKIT_HEAL: 50,
    DEATH_FINE: 100,
  },

  START: {
    MONEY: 150,
    TIME_OF_DAY: 17.67, // 17:40, golden hour (fixed for screenshot consistency)
    PLAYER_SPAWN: { x: 8, z: 30, angle: Math.PI },
  },

  // Named places (minimap labels + mission targets share these coords).
  PLACES: {
    cafe:      { x: 0,    z: -36,  label: "Rosa's Café" },
    docks:     { x: 144,  z: 48,   label: 'Port of Solmar' },
    garage:    { x: -24,  z: 144,  label: 'Garage' },
    safehouse: { x: -120, z: 144,  label: 'Safehouse' },
    hospital:  { x: 144,  z: -72,  label: 'Hospital' },
    precinct:  { x: 72,   z: 144,  label: 'SBPD Precinct' },
    gunshop:   { x: -72,  z: 96,   label: 'Gun Shop' },
    beach:     { x: -156, z: 0,    label: 'Beachfront' },
    downtown:  { x: 120,  z: -144, label: 'Downtown' },
    plaza:     { x: 0,    z: 12,   label: 'Market Plaza' },
    pier:      { x: -210, z: 48,   label: 'Pier 9' },
    market:    { x: 0,    z: 24,   label: 'Market' },
  },

  RENDER: {
    CAMERA_FOV: 62,
    MAX_DRAW_CALLS: 60,
    // Bright golden hour (finisher lesson: sun 4.2, hemi 1.0, exposure 1.32).
    SUN: 4.2,
    HEMI: 1.0,
    EXPOSURE: 1.32,
    FOG_NEAR: 200,
    FOG_FAR: 460,
  },

  // Top-level aliases of the lighting values (same numbers as RENDER).
  SUN: 4.2,
  HEMI: 1.0,
  EXPOSURE: 1.32,
  FOG_NEAR: 200,
  FOG_FAR: 460,
  SUN_INTENSITY: 4.2,
  HEMI_INTENSITY: 1.0,
  // Grouped alias for readers that expect a LIGHTS block.
  LIGHTS: { SUN: 4.2, HEMI: 1.0, EXPOSURE: 1.32, FOG_NEAR: 200, FOG_FAR: 460 },

  // Bright golden-hour palette: light facades, warm sun, turquoise sea.
  PALETTE: {
    skyTop: 0x3d1e55,
    skyHorizon: 0xff7a4a,
    sun: 0xffd9a0,
    hemiSky: 0xffe6c4,
    hemiGround: 0x8a6f5a,
    fill: 0xffc0a8,
    fog: 0xffc9a3,
    sea: 0x0e7d9e,
    seaDeep: 0x0a5a7a,
    sand: 0xe8c98f,
    asphalt: 0x3a3f45,
    sidewalk: 0xb8b0a4,
    windowBase: 0xc8ccd2,
    buildingLow: [0xf2c9a0, 0xf7b8b8, 0xa8d8c8, 0xf7e6a8, 0xd8b8e8, 0x9fc8e8],
    buildingMid: [0xe8a878, 0xd8a0a8, 0x88b8c8, 0xc8b878, 0xa8a8d8],
    tower: [0x8a97a8, 0x7a8a9a, 0xa89a8a, 0x9a8a7a],
    beach: [0xf2a58a, 0xe88a7a, 0xf7c8a0, 0xe8b8a0],
    cornice: 0xf2ead8,
  },
};

// Mission / story landmarks. Each is a marker point (on a street or plaza),
// not a building position — the building sits in the neighbouring block.
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
