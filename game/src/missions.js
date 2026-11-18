// missions.js — Solmar Bay story missions + taxi side jobs.
// Sequential missions from Mama Rosa, per DESIGN.md:
//   M0 "The Call"    - come to the cafe (marker at the plaza). Reward $0.
//   M1 "The Pickup"  - drive to the docks, collect the package, deliver to
//                      Rosa's cafe within 150 s. Reward $300.
//   M2 "Hot Wheels"  - steal the marked yellow sports car at the beachfront
//                      and bring it to the garage (south). Stealing it gives
//                      2 stars immediately. Reward $500.
//   M3 "The Getaway" - reach the safehouse (barrios) in 150 s with 3 stars
//                      and 3 police cars chasing. Reward $800 + story beat.
// After M3: free roam + repeatable taxi jobs + missions replayable for half
// reward ("Rosa calls again"). Mission fail (timer expires or busted) ->
// retry from the mission start, keeping cash earned.
//
// complete() is the money path: it advances G.missionIndex and adds the
// reward to G.money, saves, toasts and plays the jingle. It is guarded
// against double-completion.
//
// The module reads the player only through G.getPlayerPos / G.isInCar /
// G.getCurrentVehicle (adapters owned by main.js) and builds its own
// marker beacon meshes from G.THREE, so it never depends on the internals
// of the player / vehicle / city modules. Marker positions come from
// G.layout with the same defaults main.js uses, and every marker sits on
// a street, the beach or an open yard so it is reachable whatever the
// city module builds inside the blocks.

export const DEFAULT_LAYOUT = {
  cafe: { x: 0, z: 22 }, // Rosa's cafe, plaza south edge (on the street)
  docks: { x: 182, z: 24 }, // package marker, open container yard
  sportsCar: { x: -182, z: -60 }, // yellow sports car, beachfront sand
  garage: { x: 28, z: 172 }, // south garage, street intersection
  safehouse: { x: -100, z: 172 }, // barrios safehouse, south street
  hospital: { x: -152, z: 172 },
  precinct: { x: 152, z: 172 },
  gunshop: { x: 78, z: -28 },
  spawn: { x: 0, z: 26 },
};

function buildMissions(layout) {
  return [
    {
      id: 'M0',
      name: 'The Call',
      reward: 0,
      intro: "Dario, it's Rosa. Come to the cafe. We need to talk.",
      completeLine: "Good, you're here. Listen — I have a job for you.",
      steps: [
        {
          type: 'goto',
          pos: { ...layout.cafe },
          radius: 6,
          text: 'Go to Rosa\'s cafe in the Market Plaza',
        },
      ],
    },
    {
      id: 'M1',
      name: 'The Pickup',
      reward: 300,
      intro: 'A package is waiting at the docks. Pick it up, bring it back here.',
      completeLine: 'Clean run. The package is safe — and so are you. For now.',
      steps: [
        {
          type: 'pickup',
          pos: { ...layout.docks },
          radius: 5,
          text: 'Drive to the docks and collect the package',
        },
        {
          type: 'deliver',
          pos: { ...layout.cafe },
          radius: 6,
          timeLimit: 150,
          text: "Deliver the package to Rosa's cafe",
        },
      ],
    },
    {
      id: 'M2',
      name: 'Hot Wheels',
      reward: 500,
      intro: 'There is a yellow sports car parked at the beachfront. Bring it to my garage. Quietly.',
      completeLine: 'Beautiful car. The buyer will be very happy.',
      steps: [
        {
          type: 'steal',
          pos: { ...layout.sportsCar },
          radius: 6,
          text: 'Steal the yellow sports car at the beachfront',
        },
        {
          type: 'deliver',
          pos: { ...layout.garage },
          radius: 7,
          text: 'Bring the sports car to the garage (south)',
        },
      ],
    },
    {
      id: 'M3',
      name: 'The Getaway',
      reward: 800,
      intro: "They know, Dario! Three stars on you — lose them and get to the safehouse. GO!",
      completeLine: "You're free of the debt — for now. Solmar Bay is yours, Dario.",
      steps: [
        {
          type: 'escape',
          pos: { ...layout.safehouse },
          radius: 7,
          timeLimit: 150,
          text: 'Reach the safehouse in the barrios — lose the cops!',
        },
      ],
    },
  ];
}

const TAXI_MIN_FARE = 25;
const TAXI_MAX_FARE = 60;

export function createMissions(G) {
  const THREE = G && G.THREE;
  const scene = G && G.scene;
  const hasGL = !!(THREE && scene);
  const layout = Object.assign({}, DEFAULT_LAYOUT, (G && G.layout) || {});
  const table = buildMissions(layout);

  let stepIndex = 0;
  let stepTimer = 0; // counts down while the current step has a timeLimit
  let stepTimerActive = false;
  let completing = false;
  let freeRoam = false;
  let replayMode = false; // replaying after M3 -> half reward
  let marker = null; // { group, ring, beam, pos }
  let pulse = 0;

  // --- taxi side job ---
  const taxi = {
    active: false,
    phase: 'none', // 'pickup' | 'dropoff'
    customerPos: null,
    destPos: null,
    fare: 0,
    marker: null,
  };

  // --- helpers ------------------------------------------------------------
  function playerPos() {
    if (G && typeof G.getPlayerPos === 'function') {
      const p = G.getPlayerPos();
      if (p) return p;
    }
    if (G && G.player && G.player.pos) return G.player.pos;
    return { x: 0, y: 0, z: 0 };
  }

  function playerInCar() {
    if (G && typeof G.isInCar === 'function') return !!G.isInCar();
    if (G && G.player) return !!G.player.inCar;
    return false;
  }

  function currentVehicle() {
    if (G && typeof G.getCurrentVehicle === 'function') return G.getCurrentVehicle();
    if (G && G.player) return G.player.inCar || null;
    return null;
  }

  function distTo(pos) {
    const p = playerPos();
    const dx = p.x - pos.x;
    const dz = p.z - pos.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  function toast(msg, kind) {
    if (G && G.hud && typeof G.hud.toast === 'function') G.hud.toast(msg, kind || 'info');
  }

  function dialogue(line) {
    if (G && G.hud && typeof G.hud.setDialogue === 'function') G.hud.setDialogue(line);
  }

  // --- marker beacon --------------------------------------------------------
  function buildMarkerMesh(color) {
    if (!hasGL) return null;
    const group = new THREE.Group();
    const beamMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.22, depthWrite: false,
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 26, 16, 1, true), beamMat);
    beam.position.y = 13;
    const ringMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.85, depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.8, 2.6, 32), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.12;
    const coreMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 10), coreMat);
    core.position.y = 1.4;
    group.add(beam, ring, core);
    group.visible = false;
    scene.add(group);
    return { group, ring, beam, core };
  }

  function destroyMarker(m) {
    if (!m || !hasGL) return;
    scene.remove(m.group);
    m.group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });
  }

  function placeMarker(pos, color) {
    if (!hasGL) {
      marker = { group: null, ring: null, beam: null, core: null, pos: { ...pos } };
      return;
    }
    if (!marker) marker = buildMarkerMesh(color || 0xffd21f);
    marker.pos = { ...pos };
    marker.group.position.set(pos.x, 0, pos.z);
    marker.group.visible = true;
  }

  function hideMarker() {
    if (marker && marker.group) marker.group.visible = false;
    marker = null;
  }

  function placeTaxiMarker(pos, color) {
    if (!hasGL) {
      taxi.marker = { group: null, pos: { ...pos } };
      return;
    }
    if (!taxi.marker) taxi.marker = buildMarkerMesh(color || 0x22ff88);
    taxi.marker.pos = { ...pos };
    taxi.marker.group.position.set(pos.x, 0, pos.z);
    taxi.marker.group.visible = true;
  }

  function hideTaxiMarker() {
    if (taxi.marker && taxi.marker.group) taxi.marker.group.visible = false;
    taxi.marker = null;
  }

  function randomStreetPos(near, minR, maxR) {
    const streets = [-175, -125, -75, -25, 25, 75, 125, 175];
    for (let tries = 0; tries < 20; tries++) {
      const onVertical = Math.random() < 0.5;
      const s = streets[Math.floor(Math.random() * streets.length)];
      const along = -180 + Math.random() * 360;
      const x = onVertical ? s : along;
      const z = onVertical ? along : s;
      const d = Math.sqrt((x - near.x) ** 2 + (z - near.z) ** 2);
      if (d >= minR && d <= maxR) return { x, z };
    }
    return { x: near.x + 60, z: near.z };
  }

  // --- mission flow -----------------------------------------------------------
  function currentDef() {
    const idx = (G && G.missionIndex) || 0;
    if (idx < 0 || idx >= table.length) return null;
    return table[idx];
  }

  function currentStep() {
    const def = currentDef();
    if (!def) return null;
    return def.steps[Math.min(stepIndex, def.steps.length - 1)] || null;
  }

  function stageStep() {
    const def = currentDef();
    const step = currentStep();
    if (!def || !step) return;
    placeMarker(step.pos, step.type === 'escape' ? 0xff5533 : 0xffd21f);
    stepTimerActive = typeof step.timeLimit === 'number';
    stepTimer = stepTimerActive ? step.timeLimit : 0;
    dialogue(step.text);
    if (G && G.hud && typeof G.hud.setObjective === 'function') {
      G.hud.setObjective(step.text, distTo(step.pos));
    }
    // Mission-start side effects.
    if (def.id === 'M3' && stepIndex === 0) {
      if (G.police) {
        G.police.setWanted(3, 'mission');
        G.police.forceChase(3);
      }
      if (G.audio) G.audio.phoneRing();
    }
    if (def.id === 'M2' && stepIndex === 0) {
      api._stealHeatApplied = false;
      if (typeof G.spawnSportsCar === 'function') G.spawnSportsCar();
    }
  }

  function startMission(idx) {
    stepIndex = 0;
    stepTimer = 0;
    stepTimerActive = false;
    completing = false;
    const def = table[idx];
    if (!def) return false;
    if (G) G.missionIndex = idx;
    if (def.intro) dialogue(def.intro);
    toast(`${def.id} — ${def.name}`, 'mission');
    if (G.audio) G.audio.phoneRing();
    stageStep();
    if (G.emit) G.emit('mission-start', { id: def.id, index: idx });
    return true;
  }

  function advanceStep() {
    const def = currentDef();
    if (!def) return;
    stepIndex += 1;
    if (stepIndex >= def.steps.length) {
      api.complete();
      return;
    }
    stageStep();
    if (G.audio) G.audio.sfx('pickup');
  }

  const api = {
    table,
    taxi,

    get stepIndex() {
      return stepIndex;
    },
    get stepTimer() {
      return stepTimer;
    },
    get freeRoam() {
      return freeRoam;
    },
    get replayMode() {
      return replayMode;
    },

    current: currentDef,
    currentStep,

    // Start (or restart) mission idx from its first step.
    start: startMission,

    // Begin whatever mission G.missionIndex points at (boot / continue).
    startCurrent() {
      const idx = (G && G.missionIndex) || 0;
      if (idx >= table.length) {
        freeRoam = true;
        return false;
      }
      return startMission(idx);
    },

    // THE money path. Advances G.missionIndex, adds the reward to G.money,
    // updates stats + best cash, saves, toasts and plays the jingle.
    // Returns { before, after, reward, indexBefore, indexAfter } or null
    // when there is no active mission / a completion is already running.
    complete() {
      const def = currentDef();
      if (!def || completing || !G) return null;
      completing = true;
      const indexBefore = G.missionIndex || 0;
      const moneyBefore = G.money || 0;
      const reward = replayMode ? Math.floor(def.reward / 2) : def.reward;
      G.money = moneyBefore + reward;
      G.missionIndex = indexBefore + 1;
      if (!G.stats) G.stats = { missionsDone: 0, carsStolen: 0, busted: 0, bestCash: 0 };
      G.stats.missionsDone = (G.stats.missionsDone || 0) + 1;
      G.stats.bestCash = Math.max(G.stats.bestCash || 0, G.money);
      hideMarker();
      if (def.completeLine) dialogue(def.completeLine);
      toast(
        reward > 0
          ? `Mission complete +$${reward} — ${def.name}`
          : `Mission complete — ${def.name}`,
        'mission',
      );
      if (G.audio) G.audio.jingle();
      if (G.effects) {
        const p = playerPos();
        G.effects.sparkle(p.x, 1.5, p.z, 0xffd700);
      }
      if (G.save) G.save.save();
      if (G.emit) {
        G.emit('mission-complete', {
          id: def.id, reward, indexBefore, indexAfter: G.missionIndex,
        });
      }
      completing = false;
      stepIndex = 0;
      stepTimer = 0;
      stepTimerActive = false;

      if (G.missionIndex >= table.length) {
        // Story done: free roam, missions replayable at half reward.
        freeRoam = true;
        toast('Story complete! Free roam — taxi jobs pay, Rosa calls again.', 'mission');
        if (G.hud && typeof G.hud.setObjective === 'function') {
          G.hud.setObjective('Free roam — take taxi fares, or replay missions', 0);
        }
      } else {
        startMission(G.missionIndex);
      }
      return {
        before: moneyBefore,
        after: G.money,
        reward,
        indexBefore,
        indexAfter: G.missionIndex,
      };
    },

    // Fail the current mission: toast, re-stage it from step 0, keep cash.
    // Called on timer expiry and on busted (main.js calls onBusted()).
    fail(reason) {
      const def = currentDef();
      if (!def || !G) return false;
      toast(`Mission failed — ${reason || 'try again'}`, 'fail');
      if (G.audio) G.audio.sting();
      stepIndex = 0;
      stepTimer = 0;
      stepTimerActive = false;
      if (G.police && def.id === 'M3') G.police.clearWanted();
      stageStep();
      if (G.emit) G.emit('mission-fail', { id: def.id, reason: reason || '' });
      return true;
    },

    // Busted during a mission -> retry from the mission start.
    onBusted() {
      if (freeRoam) return false;
      return api.fail('busted by the SBPD');
    },

    // After the story, replay missions at half reward.
    replay() {
      if (!freeRoam) return false;
      replayMode = true;
      freeRoam = false;
      toast("Rosa calls again — missions pay half this time.", 'mission');
      return startMission(1); // M1 is the first paid job
    },

    // --- taxi side job --------------------------------------------------
    startTaxi() {
      if (taxi.active) return false;
      const p = playerPos();
      taxi.customerPos = randomStreetPos(p, 25, 80);
      taxi.destPos = randomStreetPos(taxi.customerPos, 60, 160);
      taxi.fare = TAXI_MIN_FARE + Math.floor(
        Math.random() * (TAXI_MAX_FARE - TAXI_MIN_FARE + 1),
      );
      taxi.phase = 'pickup';
      taxi.active = true;
      placeTaxiMarker(taxi.customerPos, 0x22ff88);
      toast('Taxi customer waving nearby — pick them up!', 'taxi');
      return true;
    },

    cancelTaxi() {
      taxi.active = false;
      taxi.phase = 'none';
      taxi.customerPos = null;
      taxi.destPos = null;
      hideTaxiMarker();
    },

    // --- per-frame --------------------------------------------------------
    update(dt) {
      const step = Math.min(dt || 0.016, 0.05);
      pulse += step;

      // Marker pulse (ring scale + beam opacity).
      if (marker && marker.group && marker.group.visible) {
        const s = 1 + Math.sin(pulse * 4) * 0.12;
        if (marker.ring) marker.ring.scale.set(s, s, 1);
        if (marker.beam) marker.beam.material.opacity = 0.16 + Math.sin(pulse * 4) * 0.08;
        if (marker.core) marker.core.position.y = 1.4 + Math.sin(pulse * 3) * 0.25;
      }
      if (taxi.marker && taxi.marker.group && taxi.marker.group.visible) {
        const s = 1 + Math.sin(pulse * 5) * 0.15;
        if (taxi.marker.ring) taxi.marker.ring.scale.set(s, s, 1);
      }

      if (!G || G.state !== 'playing') return;

      // --- mission step checks ---
      const def = currentDef();
      const cur = currentStep();
      if (def && cur && !completing) {
        if (stepTimerActive) {
          stepTimer -= step;
          if (stepTimer <= 0) {
            stepTimer = 0;
            stepTimerActive = false;
            api.fail('time ran out');
            return;
          }
        }
        const d = distTo(cur.pos);
        let done = false;
        if (cur.type === 'goto' || cur.type === 'pickup' || cur.type === 'deliver') {
          done = d <= cur.radius;
        } else if (cur.type === 'steal') {
          // Done when the player is inside the marked sports car.
          const veh = currentVehicle();
          const inSports = !!(veh && (veh.isSportsCar || veh.sportsCar || veh.marked));
          done = playerInCar() && (inSports || d <= cur.radius);
          if (playerInCar() && !inSports && d <= cur.radius && G.police) {
            // Player stole some other car at the beachfront: still counts
            // as a steal for the step, but no sports-car bonus.
          }
          if (done && !api._stealHeatApplied && G.police) {
            api._stealHeatApplied = true;
            G.police.setWanted(2, 'steal');
            if (G.stats) G.stats.carsStolen = (G.stats.carsStolen || 0) + 1;
          }
        } else if (cur.type === 'escape') {
          done = d <= cur.radius;
        }
        if (done) {
          if (cur.type === 'pickup') {
            toast('Package collected — deliver it to Rosa!', 'mission');
            if (G.audio) G.audio.sfx('pickup');
            if (G.effects) G.effects.sparkle(cur.pos.x, 1.5, cur.pos.z, 0xffd700);
          }
          if (cur.type === 'steal') {
            toast('Sports car stolen — get it to the garage!', 'mission');
          }
          advanceStep();
          return;
        }
        // Live objective distance on the HUD.
        if (G.hud && typeof G.hud.setObjective === 'function') {
          G.hud.setObjective(cur.text, d, stepTimerActive ? stepTimer : null);
        }
      } else if (freeRoam) {
        // In free roam, offer a taxi job when none is running.
        if (!taxi.active && Math.random() < step * 0.02) api.startTaxi();
      }

      // --- taxi checks ---
      if (taxi.active) {
        if (taxi.phase === 'pickup' && taxi.customerPos) {
          const dx = playerPos().x - taxi.customerPos.x;
          const dz = playerPos().z - taxi.customerPos.z;
          if (Math.sqrt(dx * dx + dz * dz) <= 5) {
            taxi.phase = 'dropoff';
            placeTaxiMarker(taxi.destPos, 0x22ff88);
            toast('Passenger aboard — take them to the marker!', 'taxi');
            if (G.audio) G.audio.sfx('pickup');
          }
        } else if (taxi.phase === 'dropoff' && taxi.destPos) {
          const dx = playerPos().x - taxi.destPos.x;
          const dz = playerPos().z - taxi.destPos.z;
          if (Math.sqrt(dx * dx + dz * dz) <= 6) {
            const fare = taxi.fare;
            G.money = (G.money || 0) + fare;
            if (G.stats) G.stats.bestCash = Math.max(G.stats.bestCash || 0, G.money);
            toast(`Taxi fare +$${fare}`, 'taxi');
            if (G.audio) G.audio.sfx('cash');
            api.cancelTaxi();
            if (G.save) G.save.save();
          }
        }
      }
    },

    // Marker position for the minimap / HUD (null when no mission).
    markerPos() {
      const cur = currentStep();
      if (!cur || freeRoam) {
        if (taxi.active && taxi.phase === 'pickup') return taxi.customerPos;
        if (taxi.active && taxi.phase === 'dropoff') return taxi.destPos;
        return null;
      }
      return cur.pos;
    },

    objectiveText() {
      const cur = currentStep();
      if (cur) return cur.text;
      if (freeRoam) return 'Free roam — take taxi fares, or replay missions';
      return '';
    },

    distanceToMarker() {
      const pos = api.markerPos();
      return pos ? distTo(pos) : 0;
    },

    // Reset everything (new game).
    reset() {
      stepIndex = 0;
      stepTimer = 0;
      stepTimerActive = false;
      completing = false;
      freeRoam = false;
      replayMode = false;
      api._stealHeatApplied = false;
      hideMarker();
      api.cancelTaxi();
      if (G) G.missionIndex = 0;
      startMission(0);
    },

    dispose() {
      destroyMarker(marker);
      marker = null;
      destroyMarker(taxi.marker);
      taxi.marker = null;
    },
  };

  return api;
}
