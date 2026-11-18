// input.js — Solmar Bay: keyboard + mouse input.
// One createInput(canvas) owns every listener. The game loop reads a plain
// object each frame:
//   { moveX, moveY, run, lookDX, actionEnter, actionExit, actionPunch,
//     actionShoot, actionReload, actionHonk, actionMute, actionPause,
//     actionConfirm, weapon1, weapon2, mouseDown, pointerLocked }
// moveX/moveY are -1..1 (WASD), run is Shift. Edge-triggered actions
// (E, F, click...) are true for exactly one frame — call endFrame() after
// the update, or read them through consume(). A headless autopilot (the
// ?shot= staging in shots.js) can drive the same object with inject().
// Safe to import from Node: nothing touches the DOM until createInput runs.

const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'run', ShiftRight: 'run',
};

export function createInput(canvas) {
  const input = {
    // held keys, by logical name
    keys: new Set(),
    // edge-triggered actions, set by listeners, cleared by endFrame()
    pressed: new Set(),
    // mouse look delta accumulated since the last frame (px)
    lookDX: 0,
    lookDY: 0,
    mouseDown: false,
    pointerLocked: false,
    // autopilot override (shots.js): when set, readInput() uses this instead
    autopilot: null,
    // set to false to ignore real keyboard (e.g. while a menu is open)
    enabled: true,
    _canvas: canvas || null,
    _listeners: [],
    _onKeyDown: null,
    _onKeyUp: null,
    _onMouseMove: null,
    _onMouseDown: null,
    _onMouseUp: null,
    _onLockChange: null,
    _onClick: null,
  };

  if (canvas && typeof canvas.addEventListener === 'function') {
    attachListeners(input, canvas);
  }
  return input;
}

function attachListeners(input, canvas) {
  const add = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    input._listeners.push([target, type, fn, opts]);
  };

  input._onKeyDown = (e) => {
    if (!input.enabled) return;
    const name = KEYMAP[e.code];
    if (name) {
      if (!e.repeat) input.keys.add(name);
      e.preventDefault();
      return;
    }
    if (e.repeat) return;
    switch (e.code) {
      case 'KeyE': input.pressed.add('enter'); break;
      case 'KeyF': input.pressed.add('punch'); break;
      case 'KeyR': input.pressed.add('reload'); break;
      case 'KeyH': input.pressed.add('honk'); break;
      case 'KeyM': input.pressed.add('mute'); break;
      case 'KeyP':
      case 'Escape': input.pressed.add('pause'); break;
      case 'Enter': input.pressed.add('confirm'); break;
      case 'Digit1': input.pressed.add('weapon1'); break;
      case 'Digit2': input.pressed.add('weapon2'); break;
      case 'KeyB': input.pressed.add('buyAmmo'); break;
      default: break;
    }
  };
  input._onKeyUp = (e) => {
    const name = KEYMAP[e.code];
    if (name) input.keys.delete(name);
  };
  input._onMouseMove = (e) => {
    if (!input.pointerLocked) return;
    input.lookDX += e.movementX || 0;
    input.lookDY += e.movementY || 0;
  };
  input._onMouseDown = (e) => {
    if (e.button !== 0) return;
    input.mouseDown = true;
    input.pressed.add('shoot');
    if (!input.pointerLocked && input._canvas) {
      input._canvas.requestPointerLock();
    }
  };
  input._onMouseUp = (e) => {
    if (e.button === 0) input.mouseDown = false;
  };
  input._onLockChange = () => {
    input.pointerLocked = (typeof document !== 'undefined' &&
      document.pointerLockElement === input._canvas);
  };
  input._onClick = () => {
    if (!input.pointerLocked && input._canvas) input._canvas.requestPointerLock();
  };

  add(window, 'keydown', input._onKeyDown);
  add(window, 'keyup', input._onKeyUp);
  add(window, 'mousemove', input._onMouseMove);
  add(window, 'mousedown', input._onMouseDown);
  add(window, 'mouseup', input._onMouseUp);
  add(document, 'pointerlockchange', input._onLockChange);
  add(canvas, 'click', input._onClick);
}

/** Remove every listener (used when the game is torn down). */
export function detachInput(input) {
  for (const [target, type, fn, opts] of input._listeners) {
    target.removeEventListener(type, fn, opts);
  }
  input._listeners = [];
}

/**
 * Read the current frame's input as a plain snapshot object.
 * Autopilot (shots staging) wins over the real keyboard when set.
 * Mouse-look deltas are consumed here (reset to 0 after reading).
 */
export function readInput(input) {
  if (input.autopilot) {
    const snap = { ...input.autopilot };
    snap.lookDX = input.lookDX;
    input.lookDX = 0;
    input.lookDY = 0;
    return snap;
  }
  const k = input.keys;
  const snap = {
    moveX: (k.has('right') ? 1 : 0) - (k.has('left') ? 1 : 0),
    moveY: (k.has('up') ? 1 : 0) - (k.has('down') ? 1 : 0),
    run: k.has('run'),
    lookDX: input.lookDX,
    lookDY: input.lookDY,
    mouseDown: input.mouseDown,
    pointerLocked: input.pointerLocked,
    actionEnter: input.pressed.has('enter'),
    actionExit: input.pressed.has('enter'), // E both enters and exits
    actionPunch: input.pressed.has('punch'),
    actionShoot: input.pressed.has('shoot') || input.mouseDown,
    actionReload: input.pressed.has('reload'),
    actionHonk: input.pressed.has('honk'),
    actionMute: input.pressed.has('mute'),
    actionPause: input.pressed.has('pause'),
    actionConfirm: input.pressed.has('confirm'),
    weapon1: input.pressed.has('weapon1'),
    weapon2: input.pressed.has('weapon2'),
    buyAmmo: input.pressed.has('buyAmmo'),
  };
  input.lookDX = 0;
  input.lookDY = 0;
  return snap;
}

/** Clear edge-triggered presses at the end of a frame. */
export function endFrame(input) {
  input.pressed.clear();
}

/** True when a logical key is currently held. */
export function isDown(input, name) {
  return input.keys.has(name);
}

/**
 * Autopilot: hand the input object a scripted snapshot for scripted
 * sequences (the ?shot= staging). Pass null to hand control back to the
 * real keyboard. The snapshot uses the same fields as readInput().
 *   inject(input, { moveX: 0, moveY: 1, run: false, ... })
 */
export function inject(input, snapshot) {
  input.autopilot = snapshot ? { ...snapshot } : null;
}

/** A neutral (all-zero) snapshot — handy default for tests and menus. */
export function emptySnapshot() {
  return {
    moveX: 0, moveY: 0, run: false, lookDX: 0, lookDY: 0,
    mouseDown: false, pointerLocked: false,
    actionEnter: false, actionExit: false, actionPunch: false,
    actionShoot: false, actionReload: false, actionHonk: false,
    actionMute: false, actionPause: false, actionConfirm: false,
    weapon1: false, weapon2: false, buyAmmo: false,
  };
}

export default createInput;
