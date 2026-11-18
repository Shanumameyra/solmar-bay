// Solmar Bay — boot + the one loop (Worker B). Input is read every frame, the
// world advances in fixed 1/60 s steps (several in a slow frame, none in a fast
// one), and the renderer paints what is there. Screens: title, play, paused,
// busted, wasted. ?seed=N fixes the layout; ?shot=hero stages the one hero shot.
// (with &seed=N) stages that scene instead of running the loop, paints it
// twice and sets window.__shotReady for a screenshot.
//
// Input: createInput(canvas) returns the input object directly (listeners
// attach immediately); endFrame() clears dx/dy/justPressed after each fixed
// step. The title screen steps the world with an idle input so the city stays
// alive behind the menu. Events: world.step does NOT clear state.events per
// step, so main.js drains them once per frame (sfx -> audio, fxBurst ->
// effects, mission-complete -> save); hud.js then drains the rest for the
// feed. Police bust and combat death set state.screen; main.js turns that
// into the busted/wasted screen + 2.5 s timer. window.__GTA is the
// diagnostics + playtest hook.
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
import { createEffects } from './effects.js';
import { loadSave, applySave, saveGame, hasSave } from './save.js';
import { stageShot } from './shots.js';

const STEP = CONFIG.STEP;
/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed. */
const MAX_FRAME = CONFIG.MAX_FRAME;
const SAVE_EVERY = 30; // seconds between autosaves

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 7;

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const minimapCanvas = document.getElementById('minimap');
const startBtn = document.getElementById('start-btn');
const resumeBtn = document.getElementById('resume-btn');

// Idle input for the title screen (the city steps, the player does not move).
const IDLE_INPUT = {
  keys: new Set(),
  dx: 0,
  dy: 0,
  justPressed: new Set(),
  pointerLocked: false,
};

function buildGame() {
  const world = createWorld(seed);
  const state = world.state;
  const renderer = createRenderer(canvas);
  // Add the city (ground, sea, buildings, lights, signs, pier) to the
  // scene — without this the world is an empty gradient: only the cars,
  // peds and player render, and the ground is the sky background.
  renderer.buildScene(world.city);
  const input = createInput(canvas);
  const audio = createAudio();
  const effects = createEffects(renderer.scene, THREE);
  const hud = createHud(document);
  const minimap = createMinimap(minimapCanvas);
  const systems = {
    police: createPolice(),
    missions: createMissions(),
    combat: createCombat(),
  };
  return { world, state, renderer, input, audio, effects, hud, minimap, systems };
}

function runShot(name) {
  const g = buildGame();
  const { world, state, renderer, hud, minimap, systems, effects } = g;
  const info = stageShot(name, world, systems);
  renderer.snapCamera();
  // Draw twice so particles / HUD settle, then signal the screenshot runner.
  let painted = 0;
  function paint() {
    // Shot mode has no game loop, so a burst staged by stageShot (e.g.
    // the hero shot's dust puff) would never fire — drain it here on the
    // first paint, and advance it ~0.35 s on the second so it reads as a
    // cloud, not a point cluster, at screenshot time.
    if (painted === 0 && state.fxBurst && effects) {
      const b = state.fxBurst;
      effects.burst(b.type, b.x, b.y ?? 1, b.z, b);
      state.fxBurst = null;
    }
    if (painted === 1 && effects) effects.update(0.35);
    renderer.draw(state, effects);
    effects.applyCamera(renderer.camera, 1 / 60);
    hud.update(state, 'play', 0);
    minimap.draw(state);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else {
      window.__GTA = {
        shotReady: true,
        shot: name,
        screen: 'play',
        wanted: state.wanted || 0,
        money: state.money || 0,
        mission: (state.mission && state.mission.objective) || '',
        policeCars: (state.cars || []).filter((c) => c.isPolice).length,
        info,
        state,
      };
      window.__shotReady = true;
    }
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const g = buildGame();
  const { world, state, renderer, input, audio, effects, hud, minimap, systems } = g;
  let screen = 'title';
  let accumulator = 0;
  let last = performance.now();
  let saveT = 0;
  let frames = 0;
  let fpsT = 0;
  let fps = 0;
  let endTimer = 0;

  // Restore a save, if one exists (loadSave returns {ok, data}).
  const res = loadSave();
  if (res.ok) {
    const saved = res.data;
    applySave(state, saved);
    systems.missions.loadIndex(saved.missionIndex);
    if (saved.muted) audio.setMuted(true);
    if (startBtn) startBtn.textContent = 'CONTINUE — $' + Math.floor(state.money || 0);
  }

  function announce(message) {
    if (status) status.textContent = message;
  }

  function doSave() {
    state.muted = audio.muted;
    saveGame(state);
  }

  function startGame() {
    if (screen === 'title' && !hasSave()) {
      // Fresh start: reset the systems (the world is already fresh).
      systems.police.reset();
      systems.missions.reset();
      systems.combat.reset();
    }
    audio.init();
    screen = 'play';
    announce("Playing. Follow the objective — head to Rosa's café.");
  }

  function handleActions() {
    const jp = input.justPressed;
    if (jp.has('Enter') || jp.has('Space')) {
      if (screen === 'title') startGame();
      else if (screen === 'busted' || screen === 'wasted') endTimer = 0;
    }
    if (jp.has('Escape') || jp.has('KeyP')) {
      if (screen === 'play') {
        screen = 'paused';
        announce('Paused.');
        doSave();
      } else if (screen === 'paused') {
        screen = 'play';
        announce('Playing.');
      }
    }
    if (jp.has('KeyM')) {
      audio.setMuted(!audio.muted);
      hud.showMessage(audio.muted ? 'Sound muted' : 'Sound on', '');
    }
  }

  // Play sound + particle events queued by the systems this frame.
  // Called BEFORE hud.update, so hud can drain the rest for the feed.
  function drainFxEvents() {
    const evts = state.events || [];
    for (const e of evts) {
      if (e.type === 'sfx' && audio) audio.sfx(e.name || e.text);
      else if (e.type === 'mission-complete') doSave();
    }
    if (state.fxBurst && effects) {
      const b = state.fxBurst;
      effects.burst(b.type, b.x, b.y ?? 1, b.z, b);
      state.fxBurst = null;
    }
    if (state.shakeTrauma > 0 && effects) {
      effects.addTrauma(state.shakeTrauma);
      state.shakeTrauma = 0;
    }
  }

  function stepWorld(dt) {
    // Title screen: the city stays alive behind the menu (no input).
    const inp = screen === 'play' ? input : IDLE_INPUT;
    world.step(STEP, inp, systems);
    // Screen transitions from systems.
    if (state.screen === 'busted' && screen === 'play') {
      state.screen = 'play';
      screen = 'busted';
      endTimer = 2.5;
      announce(`Busted by the SBPD. $${CONFIG.WANTED.BUST_FINE} fine.`);
      doSave();
    } else if (state.screen === 'wasted' && screen === 'play') {
      state.screen = 'play';
      screen = 'wasted';
      endTimer = 2.5;
      announce(`Wasted. $${CONFIG.COMBAT.DEATH_FINE} hospital bill.`);
      doSave();
    }
    input.endFrame();
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const realDt = Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    frames += 1;
    fpsT += realDt;
    if (fpsT >= 1) {
      fps = Math.round(frames / fpsT);
      frames = 0;
      fpsT = 0;
    }
    handleActions();
    if (screen === 'play' || screen === 'title') {
      accumulator += realDt;
      while (accumulator >= STEP && (screen === 'play' || screen === 'title')) {
        stepWorld(STEP);
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
      // Busted / wasted: wait, then respawn into play.
      if (screen === 'busted' || screen === 'wasted') {
        endTimer -= realDt;
        if (endTimer <= 0) screen = 'play';
      }
    }
    // Sound + particles for this frame's events (before the HUD drains them).
    drainFxEvents();
    // Audio: engine + siren follow the world.
    if (audio) audio.update(realDt, state, screen === 'play', input);
    // Effects: trauma shake + particles.
    if (effects) effects.update(realDt);
    // HUD + minimap.
    hud.update(state, screen, realDt);
    minimap.draw(state);
    // Render, then apply the camera shake (the renderer places the camera).
    renderer.draw(state, effects);
    if (effects) effects.applyCamera(renderer.camera, realDt);
    // Autosave while playing.
    if (screen === 'play') {
      saveT += realDt;
      if (saveT >= SAVE_EVERY) {
        saveT = 0;
        doSave();
      }
    }
    // Diagnostics + playtest hook.
    window.__GTA = {
      shotReady: false,
      screen,
      fps,
      wanted: state.wanted || 0,
      money: state.money || 0,
      mission: (state.mission && state.mission.objective) || '',
      inCar: !!(state.player && state.player.inCar),
      speed: state.player ? Math.abs(state.player.speed || 0) : 0,
      hp: state.player ? state.player.hp : 0,
      policeCars: (state.cars || []).filter((c) => c.isPolice).length,
      state,
      debug: {
        teleport: (x, z, angle, car) => world.teleport(x, z, angle, car),
        addHeat: (n, reason) => world.addHeat(n, reason),
        startMission: (i) => systems.missions.start(i, state),
        damagePlayer: (n) => world.damagePlayer(n),
      },
    };
  }

  // Clicking Start / Resume also starts (pointer users).
  if (startBtn) startBtn.addEventListener('click', () => { if (screen === 'title') startGame(); });
  if (resumeBtn) resumeBtn.addEventListener('click', () => { if (screen === 'paused') { screen = 'play'; announce('Playing.'); } });
  // First gesture unlocks audio.
  window.addEventListener('pointerdown', () => audio.init(), { once: true });
  window.addEventListener('keydown', () => audio.init(), { once: true });
  // Leaving the tab pauses a running game rather than letting it run unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === 'play') {
      screen = 'paused';
      announce('Paused.');
      doSave();
    }
  });

  announce('Solmar Bay. Press Enter or click Start.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
