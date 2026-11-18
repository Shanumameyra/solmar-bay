// main.js — boot + fixed-step loop + screens + shot staging.
//
// Fixed step 1/60 with an accumulator (MAX_FRAME 0.25). Title steps the
// world with an idle input (a living city behind the menu). Events from
// world.step are drained once per frame: main reads a COPY for SFX / FX /
// save triggers, then hud.update shifts them out into the feed.
// Busted/wasted screens run a 2.5 s timer, then play resumes at the
// respawn point (bust()/die() already moved the player there).
// ?shot=name stages a screenshot (draw twice, then window.__shotReady).

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { createWorld } from './world.js';
import { createRenderer } from './render.js';
import { createInput } from './input.js';
import { createPolice } from './police.js';
import { createMissions } from './missions.js';
import { createCombat } from './combat.js';
import { createHud } from './hud.js';
import { createMinimap } from './minimap.js';
import { createAudio } from './audio.js';
import { loadSave, saveGame, applySave } from './save.js';
import { createEffects } from './effects.js';
import { stageShot } from './shots.js';

const STEP = CONFIG.STEP ?? 1 / 60;
const MAX_FRAME = CONFIG.MAX_FRAME ?? 0.25;

function idleInput() {
  return {
    keys: new Set(),
    dx: 0,
    dy: 0,
    justPressed: new Set(),
    pointerLocked: false,
    endFrame() {},
  };
}

export function buildGame() {
  const params = new URLSearchParams(window.location.search);
  const seed = parseInt(params.get('seed') || '7', 10) || 7;
  const shot = params.get('shot');

  const canvas = document.getElementById('game-canvas');
  const world = createWorld(seed);
  const state = world.state;

  const renderer = createRenderer(canvas);
  // THE one line the whole city depends on: without it the ground,
  // streets, buildings, palms, port and pier never render.
  renderer.buildScene(world.city);

  const input = createInput(canvas);
  const police = createPolice();
  const missions = createMissions();
  const combat = createCombat();
  const audio = createAudio();
  const effects = createEffects(renderer.scene, THREE);
  const hud = createHud(document);
  const minimap = createMinimap(document.getElementById('minimap'));
  const systems = { police, missions, combat, audio, effects };

  // Load a save (if any) before the first frame.
  const loaded = loadSave();
  if (loaded.ok) {
    applySave(state, loaded.data);
    missions.loadIndex(loaded.data.missionIndex);
    audio.setMuted(!!loaded.data.muted);
    state.muted = !!loaded.data.muted;
  }
  const continueBtn = document.getElementById('continue-btn');
  if (continueBtn) continueBtn.style.display = loaded.ok ? '' : 'none';

  state.screen = 'title';
  state.screenT = 0;

  const ctx = {
    world,
    state,
    renderer,
    input,
    systems,
    police,
    missions,
    combat,
    audio,
    effects,
    hud,
    minimap,
    seed,
    shot,
    lastSaveAt: 0,
    autoSaveT: 0,
  };

  window.__GTA = {
    shotReady: false,
    screen: state.screen,
    wanted: state.wanted,
    money: state.money,
    mission: state.mission?.index ?? 0,
    speed: 0,
    health: state.player?.hp ?? 100,
    debug: {
      teleport: (x, z, angle, car) => world.teleport(x, z, angle, car),
      addHeat: (n, reason) => world.addHeat(n, reason),
      startMission: (i) => missions.start(i, state),
      damagePlayer: (n) => world.damagePlayer(n),
    },
  };

  function startGame() {
    if (state.screen !== 'title') return;
    audio.init();
    state.screen = 'play';
    if (missions.index === 0 && missions.phase === 'idle') missions.start(0, state);
    pushStatus('Playing Solmar Bay.');
  }

  function pauseGame() {
    if (state.screen !== 'play') return;
    state.screen = 'paused';
    saveGame(state);
    audio.stopAll();
    pushStatus('Paused.');
  }

  function resumeGame() {
    if (state.screen !== 'paused') return;
    state.screen = 'play';
    pushStatus('Playing Solmar Bay.');
  }

  function restartGame() {
    world.reset();
    police.reset();
    missions.reset();
    combat.reset();
    state.screen = 'play';
    missions.start(0, state);
    pushStatus('Playing Solmar Bay.');
  }

  function quitToTitle() {
    saveGame(state);
    audio.stopAll();
    state.screen = 'title';
    pushStatus('Solmar Bay — title screen. Press Enter to start.');
  }

  function pushStatus(text) {
    const el = document.getElementById('status');
    if (el) el.textContent = text;
  }

  function toggleMute() {
    audio.setMuted(!audio.muted);
    state.muted = audio.muted;
    const btn = document.getElementById('mute-btn');
    if (btn) btn.textContent = audio.muted ? 'Unmute (M)' : 'Mute (M)';
  }

  // Buttons (guarded — the page may not have all of them).
  const on = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
  };
  on('start-btn', startGame);
  on('continue-btn', startGame);
  on('resume-btn', resumeGame);
  on('restart-btn', restartGame);
  on('quit-btn', quitToTitle);
  on('mute-btn', toggleMute);

  // Audio starts only after a user gesture (autoplay policy).
  window.addEventListener('pointerdown', () => audio.init(), { once: true });
  window.addEventListener('keydown', () => audio.init(), { once: true });
  window.addEventListener('resize', () => renderer.resize && renderer.resize());

  // Hidden tab pauses the game.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.screen === 'play') pauseGame();
  });

  // Drain one frame of transient events: SFX / FX / save triggers.
  // Reads a COPY — hud.update shifts the real queue out afterwards.
  function drainEvents() {
    for (const ev of [...(state.events || [])]) {
      const p = state.player || {};
      switch (ev.type) {
        case 'sfx':
          audio.sfx(ev.name);
          break;
        case 'missionComplete':
          audio.sfx('jingle');
          saveGame(state);
          break;
        case 'busted':
        case 'wasted':
          audio.sfx('busted');
          saveGame(state);
          break;
        case 'missionFailed':
          audio.sfx('busted');
          break;
        case 'gunshot':
          audio.sfx('gunshot');
          effects.feedback('shot', p.x, 1.4, p.z);
          break;
        case 'pickup':
        case 'taxi':
        case 'heal':
        case 'ammo':
          audio.sfx('pickup');
          break;
        case 'damage':
          effects.addTrauma(0.35);
          break;
        case 'carDamage':
          effects.addTrauma(0.25);
          break;
        default:
          break;
      }
    }
    if (state.fxBurst) {
      const b = state.fxBurst;
      state.fxBurst = null;
      effects.burst(b.type, b.x, b.y ?? 1, b.z);
    }
    if (state.shakeTrauma) {
      effects.addTrauma(state.shakeTrauma);
      state.shakeTrauma = 0;
    }
  }

  function paint(dt) {
    drainEvents();
    hud.update(state, state.screen, dt);
    minimap.draw(state);
    renderer.draw(state, effects);
    effects.applyCamera(renderer.camera, dt);
    const g = window.__GTA;
    g.screen = state.screen;
    g.wanted = state.wanted;
    g.money = state.money;
    g.mission = state.mission?.index ?? 0;
    g.health = state.player?.hp ?? 100;
    const spd = state.player?.car
      ? state.player.car.speed ?? 0
      : state.player?.speed ?? 0;
    g.speed = Math.round(spd * 3.6);
  }

  // Shot mode: stage, paint twice, signal ready. No game loop — the frame
  // is static for the screenshot.
  function runShot(name) {
    stageShot(name, world, systems);
    // A staged fxBurst (mission glint, muzzle) needs particles advanced
    // once — shot mode has no loop to do it.
    if (state.fxBurst) {
      const b = state.fxBurst;
      state.fxBurst = null;
      effects.burst(b.type, b.x, b.y ?? 1, b.z);
      effects.update(0.35);
    }
    paint(1 / 60);
    paint(1 / 60);
    window.__shotReady = true;
    window.__GTA.shotReady = true;
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - frame._last) / 1000 || 0, MAX_FRAME);
    frame._last = now;
    if (dt <= 0) {
      paint(0);
      return;
    }

    // UI keys, read BEFORE the fixed steps clear justPressed.
    const pressed = new Set(input.justPressed || []);
    if (pressed.has('Enter') && state.screen === 'title') startGame();
    if (pressed.has('Escape') || pressed.has('KeyP')) {
      if (state.screen === 'play') pauseGame();
      else if (state.screen === 'paused') resumeGame();
    }
    if (pressed.has('KeyM')) toggleMute();

    if (state.screen === 'play') {
      frame._acc = (frame._acc || 0) + dt;
      let steps = 0;
      while (frame._acc >= STEP && steps < 5) {
        world.step(STEP, input, systems);
        input.endFrame();
        frame._acc -= STEP;
        steps++;
      }
      if (steps === 5) frame._acc = 0;
      // 30 s autosave.
      ctx.autoSaveT += dt;
      if (ctx.autoSaveT >= 30) {
        ctx.autoSaveT = 0;
        saveGame(state);
      }
    } else if (state.screen === 'title') {
      frame._acc = (frame._acc || 0) + dt;
      const idle = idleInput();
      let steps = 0;
      while (frame._acc >= STEP && steps < 5) {
        world.step(STEP, idle, systems);
        frame._acc -= STEP;
        steps++;
      }
      if (steps === 5) frame._acc = 0;
    } else if (state.screen === 'busted' || state.screen === 'wasted') {
      state.screenT -= dt;
      if (state.screenT <= 0) {
        state.screenT = 0;
        state.screen = 'play';
      }
    }
    // 'paused': the world holds still.

    paint(dt);
  }
  frame._last = performance.now();
  frame._acc = 0;

  if (shot) {
    runShot(shot);
  } else {
    requestAnimationFrame(frame);
  }
  return ctx;
}

// Boot in the browser only — importing this module in node (tests) must
// not touch the DOM.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  buildGame();
}
