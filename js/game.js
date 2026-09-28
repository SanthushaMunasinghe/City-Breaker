// City Breaker — build → connect → battle, blue (you) vs red (CPU) on a shared grid.
import * as THREE from 'three';
import * as M from './models.js';

// ---------------------------------------------------------------- tuning
const COLS = 7;
const ROWS = 11;
const RANGE = 3.5;            // connection radius in tiles (center to center)
const PATH_COST = 2;
const UNITS_PER_PATH = 5;
const PHASE_TIME = 30;
const MAX_ROUNDS = 15;
const START_BRICKS = 20;
const START_HP = 15;
const UNIT_SPEED = 1.7;       // tiles per second
const SPAWN_GAP = 0.32;
const CANNON_RANGE = 3.5;
const CANNON_DMG = 2;
const CANNON_RATE = 0.35;
const ARROW_RANGE = 2.5;
const ARROW_RATE = 0.5;
const QUARRY_YIELD = 2;
const SHIELD_HP = 5;
const MAX_HP = 40;
const BLOCK_HALF = 0.42;      // half-size of a tile's blocking box for straight-line checks

const CARDS = {
  normal: { name: 'NORMAL', cost: 10, hp: 10, tip: 'Sends units along paths' },
  cannon: { name: 'CANNON', cost: 15, hp: 10, tip: 'Supply units → shoots nearby targets' },
  arrow: { name: 'ARROWS', cost: 12, hp: 10, tip: 'Shoots enemy units nearby' },
  quarry: { name: 'QUARRY', cost: 12, hp: 10, tip: 'Supply units → +2 bricks each' },
  shield: { name: 'SHIELD', cost: 8, tip: 'Drop on your building: blocks 5 hits' },
};
const DECK = { normal: 4, cannon: 2, arrow: 2, quarry: 2, shield: 2 };

// ---------------------------------------------------------------- DOM
const $ = (id) => document.getElementById(id);
const app = $('app');
const canvas = $('scene');
const labelsEl = $('labels');
const floatsEl = $('floats');
const panel = $('panel');
const panelTitle = $('panelTitle');
const panelBody = $('panelBody');
const endBtn = $('endBtn');
const bubble = $('bubble');
const hand = $('hand');
const toastEl = $('toast');
const modal = $('modal');
const modalBox = $('modalBox');

// ---------------------------------------------------------------- three setup
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe8893a);
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
const CAM_PITCH = THREE.MathUtils.degToRad(58);
let camDist = 20;
let shake = 0;

function addLights(target) {
  target.add(new THREE.HemisphereLight(0xe4f1ff, 0xf0a060, 1.55));
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.1);
  sun.position.set(-5, 11, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 12, bottom: -12, near: 1, far: 40 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  target.add(sun);
  return sun;
}
addLights(scene);

const cx = (c) => c - (COLS - 1) / 2;
const cz = (r) => r - (ROWS - 1) / 2;
const inBounds = (c, r) => c >= 0 && c < COLS && r >= 0 && r < ROWS;

// seeded random for decoration so the desert looks the same every load
function mulberry(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tileTexture() {
  const T = 128;
  const cv = document.createElement('canvas');
  cv.width = COLS * T; cv.height = ROWS * T;
  const g = cv.getContext('2d');
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      g.fillStyle = (r + c) % 2 ? '#f59d45' : '#f6a24b';
      g.fillRect(c * T, r * T, T, T);
      g.fillStyle = 'rgba(255,255,255,.07)';
      g.fillRect(c * T + 6, r * T + 6, T - 12, 6);
    }
  }
  g.strokeStyle = 'rgba(196,105,30,.45)';
  g.lineWidth = 3;
  for (let c = 0; c <= COLS; c++) { g.beginPath(); g.moveTo(c * T, 0); g.lineTo(c * T, ROWS * T); g.stroke(); }
  for (let r = 0; r <= ROWS; r++) { g.beginPath(); g.moveTo(0, r * T); g.lineTo(COLS * T, r * T); g.stroke(); }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function buildEnvironment() {
  const rand = mulberry(7);
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), new THREE.MeshStandardMaterial({ color: 0xee9140, roughness: 1 }));
  sand.rotation.x = -Math.PI / 2;
  sand.position.y = -0.01;
  sand.receiveShadow = true;
  scene.add(sand);

  const board = new THREE.Mesh(new THREE.PlaneGeometry(COLS, ROWS), new THREE.MeshStandardMaterial({ map: tileTexture(), roughness: 1 }));
  board.rotation.x = -Math.PI / 2;
  board.receiveShadow = true;
  scene.add(board);

  // wooden fence rails around the board
  const wood = M.mat(0xe9c98a);
  const hw = COLS / 2 + 0.22, hh = ROWS / 2 + 0.22;
  const railH = 0.07;
  const rails = [
    [0, -hh, COLS + 0.5, 0.06], [0, hh, COLS + 0.5, 0.06],
    [-hw, 0, 0.06, ROWS + 0.5], [hw, 0, 0.06, ROWS + 0.5],
  ];
  for (const [x, z, w, d] of rails) {
    const m = new THREE.Mesh(M.box(w, railH, d), wood);
    m.position.set(x, 0.14, z);
    m.castShadow = true;
    scene.add(m);
  }
  for (const [x, z] of [[-hw, -hh], [hw, -hh], [-hw, hh], [hw, hh]]) {
    const p = new THREE.Mesh(M.box(0.1, 0.24, 0.1), wood);
    p.position.set(x, 0.12, z);
    p.castShadow = true;
    scene.add(p);
  }

  // low-poly boulders ringing the arena
  const rockCols = [0x8f5a43, 0x7c4b38, 0x9b664b, 0x6f4333];
  const boulderGeo = new THREE.DodecahedronGeometry(1, 0);
  const addBoulder = (x, z, s) => {
    const m = new THREE.Mesh(boulderGeo, M.mat(rockCols[Math.floor(rand() * rockCols.length)], { flatShading: true, roughness: 0.95 }));
    m.position.set(x, s * 0.25, z);
    m.scale.set(s * (0.9 + rand() * 0.5), s * (0.55 + rand() * 0.35), s * (0.8 + rand() * 0.4));
    m.rotation.set(rand() * 0.4, rand() * Math.PI, rand() * 0.4);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  };
  for (let x = -9; x <= 9; x += 1.3 + rand() * 0.6) {
    addBoulder(x, -hh - 1.6 - rand() * 1.4, 0.9 + rand() * 0.9);
    addBoulder(x, -hh - 3.6 - rand() * 2, 1.2 + rand() * 1.2);
    addBoulder(x, hh + 1.4 + rand() * 1.2, 0.8 + rand() * 0.9);
  }
  for (let z = -hh; z <= hh; z += 1.2 + rand() * 0.9) {
    addBoulder(-hw - 2.4 - rand() * 1.6, z, 0.8 + rand() * 1.1);
    addBoulder(hw + 2.4 + rand() * 1.6, z, 0.8 + rand() * 1.1);
  }
  // pebbles
  const peb = new THREE.DodecahedronGeometry(0.14, 0);
  for (let i = 0; i < 26; i++) {
    const side = rand() < 0.5 ? -1 : 1;
    const m = new THREE.Mesh(peb, M.mat(0x7d5140, { flatShading: true }));
    m.position.set(side * (hw + 0.4 + rand() * 1.4), 0.05, (rand() - 0.5) * (ROWS + 2));
    m.castShadow = true;
    scene.add(m);
  }

  // cacti
  const green = M.mat(0x4c9a3c, { roughness: 0.8 });
  const cyl = new THREE.CylinderGeometry(0.055, 0.06, 1, 8);
  const addCactus = (x, z, s) => {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(cyl, green); trunk.scale.y = 0.34; trunk.position.y = 0.17; g.add(trunk);
    const a1 = new THREE.Mesh(cyl, green); a1.scale.set(0.8, 0.16, 0.8); a1.position.set(0.09, 0.2, 0); a1.rotation.z = -0.9; g.add(a1);
    const a2 = new THREE.Mesh(cyl, green); a2.scale.set(0.8, 0.14, 0.8); a2.position.set(-0.08, 0.15, 0); a2.rotation.z = 0.9; g.add(a2);
    g.traverse((o) => { o.castShadow = true; });
    g.position.set(x, 0, z);
    g.scale.setScalar(s);
    g.rotation.y = rand() * Math.PI;
    scene.add(g);
  };
  for (let i = 0; i < 30; i++) {
    const side = rand() < 0.5 ? -1 : 1;
    addCactus(side * (hw + 0.45 + rand() * 1.5), (rand() - 0.5) * (ROWS + 1), 0.9 + rand() * 0.8);
  }
  for (let i = 0; i < 10; i++) {
    addCactus((rand() - 0.5) * (COLS + 3), -hh - 0.6 - rand() * 0.5, 0.9 + rand() * 0.6);
    addCactus((rand() - 0.5) * (COLS + 3), hh + 0.55 + rand() * 0.5, 0.9 + rand() * 0.6);
  }
}
buildEnvironment();

// ---------------------------------------------------------------- textures for paths & markers
function chevronTexture(fill, stroke) {
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 32;
  const g = cv.getContext('2d');
  g.fillStyle = fill;
  g.fillRect(0, 0, 64, 32);
  g.strokeStyle = stroke;
  g.lineWidth = 6;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath(); g.moveTo(20, 7); g.lineTo(36, 16); g.lineTo(20, 25); g.stroke();
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function dashTexture() {
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 16;
  const g = cv.getContext('2d');
  g.fillStyle = '#fff';
  g.beginPath(); g.roundRect(4, 1, 36, 14, 7); g.fill();
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}
function tileMarkerTexture(dashed) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  g.strokeStyle = '#fff';
  g.lineWidth = 9;
  if (dashed) g.setLineDash([22, 14]);
  g.beginPath(); g.roundRect(10, 10, 108, 108, 16); g.stroke();
  const t = new THREE.CanvasTexture(cv);
  return t;
}

const pathTex = {
  blue: chevronTexture('#2c7cff', 'rgba(255,255,255,.9)'),
  red: chevronTexture('#ee2f3b', 'rgba(255,255,255,.9)'),
};
const pathMat = {
  blue: new THREE.MeshBasicMaterial({ map: pathTex.blue, transparent: true, depthWrite: false }),
  red: new THREE.MeshBasicMaterial({ map: pathTex.red, transparent: true, depthWrite: false }),
};
const pathEdgeMat = {
  blue: new THREE.MeshBasicMaterial({ color: 0x0b3aa8, transparent: true, opacity: 0.85, depthWrite: false }),
  red: new THREE.MeshBasicMaterial({ color: 0x8e0d16, transparent: true, opacity: 0.85, depthWrite: false }),
};
const dragTex = dashTexture();
const dragMat = new THREE.MeshBasicMaterial({ map: dragTex, transparent: true, depthWrite: false, color: 0xffffff });

const pathGroup = new THREE.Group();
scene.add(pathGroup);

function ribbon(x1, z1, x2, z2, width, material, y, uvScale = 0.4) {
  const len = Math.max(0.001, Math.hypot(x2 - x1, z2 - z1));
  const geo = new THREE.PlaneGeometry(len, width);
  geo.translate(len / 2, 0, 0);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * len / uvScale);
  const m = new THREE.Mesh(geo, material);
  m.rotation.x = -Math.PI / 2;
  const g = new THREE.Group();
  g.add(m);
  g.position.set(x1, y, z1);
  g.rotation.y = Math.atan2(-(z2 - z1), x2 - x1);
  return g;
}

// markers: range ring, tile highlights, drag line
const rangeRing = new THREE.Mesh(
  new THREE.RingGeometry(RANGE - 0.05, RANGE, 72),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false }),
);
rangeRing.rotation.x = -Math.PI / 2;
rangeRing.position.y = 0.02;
rangeRing.visible = false;
scene.add(rangeRing);
const rangeFill = new THREE.Mesh(
  new THREE.CircleGeometry(RANGE, 72),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, depthWrite: false }),
);
rangeFill.rotation.x = -Math.PI / 2;
rangeFill.position.y = 0.015;
rangeFill.visible = false;
scene.add(rangeFill);

const markerSolid = tileMarkerTexture(false);
const markerDashed = tileMarkerTexture(true);
const markerPool = [];
function marker(i) {
  if (!markerPool[i]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.98, 0.98),
      new THREE.MeshBasicMaterial({ map: markerSolid, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.025;
    scene.add(m);
    markerPool[i] = m;
  }
  return markerPool[i];
}
function hideMarkers() { markerPool.forEach((m) => { m.visible = false; }); }
function showMarker(i, c, r, color, dashed = false, opacity = 0.9) {
  const m = marker(i);
  m.visible = true;
  m.position.x = cx(c);
  m.position.z = cz(r);
  m.material.map = dashed ? markerDashed : markerSolid;
  m.material.color.set(color);
  m.material.opacity = opacity;
}

let dragLine = null;
function setDragLine(x1, z1, x2, z2, color) {
  if (dragLine) { scene.remove(dragLine); dragLine.children[0].geometry.dispose(); dragLine = null; }
  if (x1 == null) return;
  dragMat.color.set(color);
  dragLine = ribbon(x1, z1, x2, z2, 0.14, dragMat, 0.06, 0.35);
  scene.add(dragLine);
}

// ---------------------------------------------------------------- game state
let S = null;

function newState() {
  return {
    round: 1,
    phase: 'intro',
    timer: 0,
    bricks: { blue: START_BRICKS, red: START_BRICKS },
    grid: Array.from({ length: ROWS }, () => Array(COLS).fill(null)),
    ents: [],
    paths: [],
    units: [],
    projectiles: [],
    spawns: [],
    hand: { blue: [], red: [] },
    selected: -1,
    nextId: 1,
    battleT: 0,
    settle: 0,
    earned: 0,
    stats: { destroyed: 0, lost: 0, bricks: 0 },
    tutorial: true,
    paused: false,
  };
}

const entityAt = (c, r) => (inBounds(c, r) ? S.grid[r][c] : null);
const isBuilding = (e) => e && e.kind !== 'rock';
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const buildings = (team) => S.ents.filter((e) => e.team === team);

function addEntity(kind, team, c, r, hp) {
  const e = { id: S.nextId++, kind, team, c, r, hp, shield: 0, ammo: 0, cd: 0, alive: true, x: cx(c), z: cz(r), pop: 0, bump: 0 };
  e.obj = M.makeModel(kind, team);
  e.obj.position.set(e.x, 0, e.z);
  e.obj.userData.ent = e;
  if (team === 'red' && e.obj.userData.turret) e.obj.userData.turret.rotation.y = Math.PI - 0.5;
  scene.add(e.obj);
  e.label = document.createElement('div');
  e.label.className = 'lbl ' + (team ? 'lbl-' + team : 'lbl-rock');
  labelsEl.appendChild(e.label);
  S.grid[r][c] = e;
  S.ents.push(e);
  refreshEntity(e);
  return e;
}

function entHeight(e) { return e.obj.userData.getHeight(); }

function refreshEntity(e) {
  if (e.kind === 'normal') e.obj.userData.setFloors(Math.max(1, Math.ceil(e.hp / 5)));
  if (e.shield > 0 && !e.shieldObj) {
    e.shieldObj = M.makeShield();
    e.obj.add(e.shieldObj);
  } else if (e.shield <= 0 && e.shieldObj) {
    e.obj.remove(e.shieldObj);
    e.shieldObj = null;
  }
  if (e.shieldObj) e.shieldObj.userData.setHeight(entHeight(e));
  if (e.kind === 'rock') {
    e.label.textContent = e.hp;
    e.label.classList.toggle('low', e.hp <= 5);
  } else {
    let html = `<span>${e.hp}</span>`;
    if (e.shield > 0) html += `<b>${e.shield}</b>`;
    if (e.kind === 'cannon' && e.ammo > 0) html += `<i>●${e.ammo}</i>`;
    e.label.innerHTML = html;
  }
}

function removeEntity(e) {
  e.alive = false;
  S.grid[e.r][e.c] = null;
  S.ents.splice(S.ents.indexOf(e), 1);
  scene.remove(e.obj);
  e.label.remove();
  const before = S.paths.length;
  S.paths = S.paths.filter((p) => p.from !== e && p.to !== e);
  if (S.paths.length !== before) rebuildPaths();
}

// ---------------------------------------------------------------- geometry checks
function segHitsBox(x1, z1, x2, z2, bx, bz, h) {
  let t0 = 0, t1 = 1;
  const d = [x2 - x1, z2 - z1], p = [x1, z1], mn = [bx - h, bz - h], mx = [bx + h, bz + h];
  for (let i = 0; i < 2; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (p[i] < mn[i] || p[i] > mx[i]) return false;
    } else {
      let ta = (mn[i] - p[i]) / d[i], tb = (mx[i] - p[i]) / d[i];
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) return false;
    }
  }
  return true;
}
function losClear(a, b) {
  for (const e of S.ents) {
    if (e === a || e === b) continue;
    if (segHitsBox(a.x, a.z, b.x, b.z, e.x, e.z, BLOCK_HALF)) return false;
  }
  return true;
}
function pathCrossesCell(c, r) {
  const x = cx(c), z = cz(r);
  return S.paths.some((p) => segHitsBox(p.from.x, p.from.z, p.to.x, p.to.z, x, z, BLOCK_HALF));
}

// ---------------------------------------------------------------- paths
const findPath = (from, to) => S.paths.find((p) => p.from === from && p.to === to);
const partnerOf = (p) => S.paths.find((q) => q.from === p.to && q.to === p.from && q.team !== p.team);

function checkConnect(team, from, to) {
  if (!from || !to || from === to) return { ok: false, silent: true };
  if (from.team !== team || from.kind !== 'normal') return { ok: false, reason: 'Only normal buildings send units' };
  if (findPath(from, to)) return { ok: false, silent: true, reason: 'Already connected' };
  if (dist(from, to) > RANGE + 0.01) return { ok: false, reason: 'Out of range' };
  if (!losClear(from, to)) return { ok: false, reason: 'Path blocked' };
  if (S.bricks[team] < PATH_COST) return { ok: false, reason: `Need ${PATH_COST} bricks` };
  let verb = 'Attack!';
  if (to.kind === 'rock') verb = 'Mine rock';
  else if (to.team === team) {
    verb = { normal: 'Reinforce', arrow: 'Reinforce', cannon: 'Supply cannon', quarry: 'Supply quarry' }[to.kind];
    if (findPath(to, from)) verb = 'Reverse path';
  }
  return { ok: true, verb };
}

function connect(team, from, to) {
  const chk = checkConnect(team, from, to);
  if (!chk.ok) return chk;
  if (to.team === team) {
    const rev = findPath(to, from);
    if (rev) S.paths.splice(S.paths.indexOf(rev), 1);
  }
  S.bricks[team] -= PATH_COST;
  S.paths.push({ id: S.nextId++, team, from, to, grow: 0 });
  rebuildPaths();
  updateHud();
  return chk;
}

function rebuildPaths() {
  for (const g of [...pathGroup.children]) {
    pathGroup.remove(g);
    g.traverse((o) => o.geometry && o.geometry.dispose());
  }
  S.paths.forEach((p, i) => {
    const dx = p.to.x - p.from.x, dz = p.to.z - p.from.z, D = Math.hypot(dx, dz);
    const ux = dx / D, uz = dz / D;
    const sx = p.from.x + ux * 0.3, sz = p.from.z + uz * 0.3;
    const clash = partnerOf(p);
    const endD = clash ? D / 2 : D - 0.36;
    const ex = p.from.x + ux * endD, ez = p.from.z + uz * endD;
    const y = 0.03 + (i % 8) * 0.002;
    const g = new THREE.Group();
    g.add(ribbon(sx, sz, ex, ez, 0.25, pathEdgeMat[p.team], y));
    g.add(ribbon(sx, sz, ex, ez, 0.18, pathMat[p.team], y + 0.001));
    g.userData.path = p;
    p.mesh = g;
    applyGrow(p);
    pathGroup.add(g);
  });
}
function applyGrow(p) {
  const k = 1 - Math.pow(1 - Math.min(1, p.grow), 3);
  for (const r of p.mesh.children) r.scale.x = Math.max(0.001, k);
}

// ---------------------------------------------------------------- map generation
function generateMap() {
  const home = { blue: [3, 9], red: [3, 1] };
  for (let attempt = 0; attempt < 300; attempt++) {
    S.grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    S.ents.forEach((e) => { scene.remove(e.obj); e.label.remove(); });
    S.ents = [];
    const blue = addEntity('normal', 'blue', ...home.blue, START_HP);
    const red = addEntity('normal', 'red', ...home.red, START_HP);
    // mirrored rock pairs keep the map fair
    const cells = [];
    for (let r = 0; r <= 5; r++) for (let c = 0; c < COLS; c++) {
      if (r === 5 && c > 3) continue;
      if (entityAt(c, r) || entityAt(COLS - 1 - c, ROWS - 1 - r)) continue;
      if (Math.abs(c - home.red[0]) + Math.abs(r - home.red[1]) <= 1) continue;
      cells.push([c, r]);
    }
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    const pairs = 13;
    for (let i = 0; i < pairs && i < cells.length; i++) {
      const [c, r] = cells[i];
      const centre = 1 - Math.abs(r - 5) / 5;
      const hp = 5 * Math.max(1, Math.min(5, Math.round(1 + centre * 3 + Math.random() * 1.6)));
      addEntity('rock', null, c, r, hp);
      const mc = COLS - 1 - c, mr = ROWS - 1 - r;
      if (!entityAt(mc, mr)) addEntity('rock', null, mc, mr, hp);
    }
    const reachable = S.ents.filter((e) => e.kind === 'rock' && dist(blue, e) <= RANGE && losClear(blue, e)).length;
    let freeNear = 0;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (!entityAt(c, r) && Math.hypot(cx(c) - blue.x, cz(r) - blue.z) <= 2.3) freeNear++;
    }
    // at least one open lane between the two halves
    let lane = false;
    for (let c = 0; c < COLS && !lane; c++) if (!entityAt(c, 4) && !entityAt(c, 5) && !entityAt(c, 6)) lane = true;
    if (reachable >= 3 && reachable <= 6 && freeNear >= 5 && lane) break;
  }
  S.ents.forEach(refreshEntity);
}

// ---------------------------------------------------------------- effects
const particles = [];
const partGeo = new THREE.BoxGeometry(0.09, 0.09, 0.09);
function burst(x, y, z, color, n = 8, power = 1) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(partGeo, M.mat(color));
    m.position.set(x, y, z);
    m.castShadow = true;
    const a = Math.random() * Math.PI * 2;
    const sp = (0.8 + Math.random() * 1.6) * power;
    particles.push({ m, vx: Math.cos(a) * sp, vy: (1.5 + Math.random() * 2) * power, vz: Math.sin(a) * sp, life: 0.7 + Math.random() * 0.4 });
    m.scale.setScalar(0.6 + Math.random() * 0.9 * power);
    scene.add(m);
  }
}
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    p.vy -= 9 * dt;
    p.m.position.x += p.vx * dt;
    p.m.position.y = Math.max(0.04, p.m.position.y + p.vy * dt);
    p.m.position.z += p.vz * dt;
    p.m.rotation.x += dt * 6;
    p.m.rotation.z += dt * 4;
    if (p.life < 0.25) p.m.scale.multiplyScalar(0.85);
    if (p.life <= 0) { scene.remove(p.m); particles.splice(i, 1); }
  }
}

const tmpV = new THREE.Vector3();
function toScreen(x, y, z) {
  tmpV.set(x, y, z).project(camera);
  return { x: (tmpV.x + 1) / 2 * app.clientWidth, y: (1 - tmpV.y) / 2 * app.clientHeight, behind: tmpV.z > 1 };
}
function floatText(x, y, z, text, cls = '') {
  const p = toScreen(x, y, z);
  const el = document.createElement('div');
  el.className = 'float ' + cls;
  el.innerHTML = text;
  el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
  floatsEl.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}
const BRICK = '<i class="brick"></i>';

let toastTimer = 0;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1500);
}

// ---------------------------------------------------------------- combat
function earn(team, n, x, y, z) {
  S.bricks[team] += n;
  if (team === 'blue') {
    S.earned += n;
    S.stats.bricks += n;
    floatText(x, y, z, `+${n}${BRICK}`);
    const pill = document.querySelector('.brick-pill');
    pill.classList.remove('bump'); void pill.offsetWidth; pill.classList.add('bump');
  }
  updateHud();
}

function damage(e, amount, team) {
  if (!e.alive) return;
  let dealt = 0;
  for (let i = 0; i < amount && e.hp > 0; i++) {
    if (e.shield > 0) e.shield--; else e.hp--;
    dealt++;
  }
  e.bump = 1;
  const h = entHeight(e);
  earn(team, dealt, e.x, h + 0.3, e.z);
  burst(e.x, h * 0.7, e.z, e.kind === 'rock' ? M.ROCK_COLOR : M.TEAM[e.team].body, 3, 0.6);
  if (e.hp <= 0) destroy(e, team);
  else refreshEntity(e);
}

function destroy(e, byTeam) {
  const h = entHeight(e);
  const color = e.kind === 'rock' ? M.ROCK_COLOR : M.TEAM[e.team].body;
  burst(e.x, h / 2, e.z, color, 18, 1.3);
  burst(e.x, h / 2, e.z, 0x9a9ea6, 6, 1);
  shake = Math.max(shake, e.kind === 'rock' ? 0.08 : 0.18);
  if (e.team && byTeam === 'blue') S.stats.destroyed++;
  if (e.team === 'blue') S.stats.lost++;
  removeEntity(e);
  updateHud();
}

function friendlyDelivery(e, team) {
  const h = entHeight(e);
  if (e.kind === 'normal' || e.kind === 'arrow') {
    if (e.hp < MAX_HP) {
      e.hp++;
      e.bump = 0.6;
      if (team === 'blue' && e.hp % 5 === 1 && e.kind === 'normal') floatText(e.x, h + 0.4, e.z, '+1 floor', 'heal');
    }
  } else if (e.kind === 'cannon') {
    e.ammo++;
  } else if (e.kind === 'quarry') {
    earn(team, QUARRY_YIELD, e.x, h + 0.3, e.z);
    e.bump = 0.6;
  }
  refreshEntity(e);
}

function spawnUnit(p) {
  const dx = p.to.x - p.from.x, dz = p.to.z - p.from.z, D = Math.hypot(dx, dz);
  const u = { team: p.team, path: p, from: p.from, to: p.to, ux: dx / D, uz: dz / D, D, s: 0.4, alive: true, phase: Math.random() * 6 };
  u.mesh = M.makeUnit(p.team);
  u.mesh.scale.setScalar(1.35);
  u.mesh.position.set(p.from.x + u.ux * u.s, 0, p.from.z + u.uz * u.s);
  scene.add(u.mesh);
  S.units.push(u);
}
function killUnit(u, fx = true) {
  if (!u.alive) return;
  u.alive = false;
  scene.remove(u.mesh);
  if (fx) burst(u.mesh.position.x, 0.15, u.mesh.position.z, M.TEAM[u.team].body, 4, 0.5);
}

function fire(kind, src, target, onHit) {
  const y0 = kind === 'ball' ? 0.75 : 1.05;
  let mesh;
  if (kind === 'ball') {
    mesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), M.mat(0x2a2d33));
  } else {
    mesh = new THREE.Mesh(M.box(0.3, 0.03, 0.03), M.mat(0x6b4522));
  }
  mesh.castShadow = true;
  scene.add(mesh);
  const turret = src.obj.userData.turret;
  if (turret) {
    const tp = target.mesh ? target.mesh.position : target;
    turret.rotation.y = Math.atan2(-(tp.z - src.z), tp.x - src.x);
  }
  S.projectiles.push({ kind, mesh, x0: src.x, y0, z0: src.z, target, t: 0, dur: kind === 'ball' ? 0.65 : 0.22, onHit });
  src.bump = 0.5;
}

function nearestTarget(src, team, range) {
  let best = null, bd = Infinity;
  for (const e of S.ents) {
    if (e.team === team) continue;
    const d = dist(src, e);
    if (d > range) continue;
    const score = d + (e.kind === 'rock' ? 100 : 0);  // enemies first
    if (score < bd) { bd = score; best = e; }
  }
  return best;
}

function updateBattle(dt) {
  S.battleT += dt;
  // spawn
  for (let i = S.spawns.length - 1; i >= 0; i--) {
    const sp = S.spawns[i];
    if (S.battleT >= sp.t) {
      if (S.paths.includes(sp.path)) spawnUnit(sp.path);
      S.spawns.splice(i, 1);
    }
  }
  // move
  for (const u of S.units) {
    if (!u.alive) continue;
    u.s += UNIT_SPEED * dt;
    const x = u.from.x + u.ux * u.s, z = u.from.z + u.uz * u.s;
    u.mesh.position.set(x, Math.abs(Math.sin(u.s * 9 + u.phase)) * 0.07, z);
  }
  // head-on clashes on opposing links
  for (const p of S.paths) {
    if (p.team !== 'blue') continue;
    const q = partnerOf(p);
    if (!q) continue;
    for (;;) {
      let b = null, r = null;
      for (const u of S.units) {
        if (!u.alive) continue;
        if (u.path === p && (!b || u.s > b.s)) b = u;
        if (u.path === q && (!r || u.s > r.s)) r = u;
      }
      if (!b || !r || b.s + r.s < b.D - 0.1) break;
      killUnit(b); killUnit(r);
      burst(b.mesh.position.x, 0.2, b.mesh.position.z, 0xffe08a, 5, 0.7);
    }
  }
  // arrivals
  for (const u of S.units) {
    if (!u.alive || u.s < u.D - 0.46) continue;
    killUnit(u, false);
    const t = u.to;
    if (!t.alive) { burst(u.mesh.position.x, 0.15, u.mesh.position.z, 0xcccccc, 3, 0.4); continue; }
    if (t.team === u.team) friendlyDelivery(t, u.team);
    else damage(t, 1, u.team);
  }
  S.units = S.units.filter((u) => u.alive);

  // towers
  for (const e of [...S.ents]) {
    if (!e.alive) continue;
    e.cd -= dt;
    if (e.cd > 0) continue;
    if (e.kind === 'cannon' && e.ammo > 0) {
      const tgt = nearestTarget(e, e.team, CANNON_RANGE);
      if (tgt) {
        e.ammo--;
        e.cd = CANNON_RATE;
        const team = e.team;
        fire('ball', e, { x: tgt.x, y: entHeight(tgt) * 0.8, z: tgt.z }, () => { if (tgt.alive) damage(tgt, CANNON_DMG, team); });
        refreshEntity(e);
      }
    } else if (e.kind === 'arrow') {
      let best = null, bd = ARROW_RANGE;
      for (const u of S.units) {
        if (!u.alive || u.team === e.team || u.targeted) continue;
        const d = Math.hypot(u.mesh.position.x - e.x, u.mesh.position.z - e.z);
        if (d < bd) { bd = d; best = u; }
      }
      if (best) {
        best.targeted = true;
        e.cd = ARROW_RATE;
        const u = best;
        fire('arrow', e, u, () => killUnit(u));
      }
    }
  }
  updateProjectiles(dt);

  const cannonsBusy = S.ents.some((e) => e.kind === 'cannon' && e.ammo > 0 && nearestTarget(e, e.team, CANNON_RANGE));
  const busy = S.spawns.length || S.units.length || S.projectiles.length || cannonsBusy;
  if (!busy) {
    S.settle += dt;
    if (S.settle > 0.7) endBattle();
  } else S.settle = 0;
}

function updateProjectiles(dt) {
  for (let i = S.projectiles.length - 1; i >= 0; i--) {
    const pr = S.projectiles[i];
    pr.t += dt / pr.dur;
    const k = Math.min(1, pr.t);
    if (pr.kind === 'ball') {
      const tg = pr.target;
      pr.mesh.position.set(
        pr.x0 + (tg.x - pr.x0) * k,
        pr.y0 + (tg.y - pr.y0) * k + Math.sin(k * Math.PI) * 1.4,
        pr.z0 + (tg.z - pr.z0) * k,
      );
    } else {
      const u = pr.target;
      const tx = u.mesh.position.x, tz = u.mesh.position.z;
      const x = pr.x0 + (tx - pr.x0) * k, z = pr.z0 + (tz - pr.z0) * k, y = pr.y0 + (0.15 - pr.y0) * k;
      pr.mesh.position.set(x, y, z);
      pr.mesh.rotation.y = Math.atan2(-(tz - pr.z0), tx - pr.x0);
    }
    if (pr.t >= 1) {
      scene.remove(pr.mesh);
      S.projectiles.splice(i, 1);
      pr.onHit();
      if (pr.kind === 'ball') burst(pr.mesh.position.x, pr.mesh.position.y, pr.mesh.position.z, 0x3a3d44, 5, 0.8);
    }
  }
}

// ---------------------------------------------------------------- CPU
function cpuConnect() {
  const team = 'red';
  const reserve = S.round >= 2 ? Math.min(8, Math.floor(S.bricks.red * 0.25)) : 0;
  const maxNew = 2 + Math.floor(S.round / 3);
  const cands = [];
  for (const src of buildings(team).filter((e) => e.kind === 'normal')) {
    for (const t of S.ents) {
      if (t === src || findPath(src, t)) continue;
      if (dist(src, t) > RANGE || !losClear(src, t)) continue;
      let score;
      if (t.kind === 'rock') score = 6 + (t.hp <= 10 ? 3 : 0) - t.hp * 0.1;
      else if (t.team !== team) {
        score = 14 + Math.max(0, 20 - t.hp) * 0.3 + (t.kind === 'normal' ? 2 : 0);
        if (findPath(t, src)) score += 5;  // meet the attack head-on
      } else {
        if (findPath(t, src)) continue;
        if (t.kind === 'cannon') score = nearestTarget(t, team, CANNON_RANGE) ? 10 : 1;
        else if (t.kind === 'quarry') score = 8;
        else score = t.hp < 10 ? 5 : 0.5;
      }
      cands.push({ src, t, score: score + Math.random() * 3 });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  let made = 0;
  for (const c of cands) {
    if (made >= maxNew || S.bricks.red - PATH_COST < reserve) break;
    if (c.score < 2) break;
    if (connect(team, c.src, c.t).ok) made++;
  }
}

function cpuBuild() {
  const team = 'red';
  const hand = [...S.hand.red];
  const mine = buildings(team);
  const normals = mine.filter((e) => e.kind === 'normal');
  const threatened = mine.filter((e) => S.paths.some((p) => p.team === 'blue' && p.to === e)).sort((a, b) => a.hp - b.hp);
  const pri = (k) => ({
    normal: normals.length < 3 ? 10 : 5,
    cannon: mine.some((e) => e.kind === 'cannon') ? 4 : 7,
    arrow: threatened.length ? 7 : 2,
    quarry: mine.some((e) => e.kind === 'quarry') ? 2 : 5,
    shield: threatened.some((e) => !e.shield) ? 8 : 0,
  })[k] + Math.random() * 2;
  hand.sort((a, b) => pri(b) - pri(a));
  let built = 0;
  for (const kind of hand) {
    if (built >= 2) break;
    if (S.bricks.red - CARDS[kind].cost < PATH_COST) continue;
    if (pri(kind) < 2) continue;
    let spot = null;
    if (kind === 'shield') {
      const t = threatened.find((e) => !e.shield);
      if (t) spot = [t.c, t.r];
    } else {
      spot = cpuPickTile(kind, normals);
    }
    if (spot && place(team, kind, spot[0], spot[1])) built++;
  }
}

function cpuPickTile(kind, normals) {
  let best = null, bs = -Infinity;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (canPlace('red', kind, c, r) !== true) continue;
    const p = { x: cx(c), z: cz(r) };
    const near = normals.filter((n) => dist(n, p) <= 2.6);
    if (!near.length) continue;
    const feeder = normals.some((n) => dist(n, p) <= RANGE && losClear(n, p));
    let score = Math.random() * 1.5;
    const around = S.ents.filter((e) => dist(e, p) <= RANGE && losClear(p, e));
    if (kind === 'normal') {
      score += around.filter((e) => e.kind === 'rock').length + around.filter((e) => e.team === 'blue').length * 2 + r * 0.25;
    } else if (kind === 'cannon') {
      if (!feeder) continue;
      score += S.ents.filter((e) => e.team === 'blue' && dist(e, p) <= CANNON_RANGE).length * 3
        + S.ents.filter((e) => e.kind === 'rock' && dist(e, p) <= CANNON_RANGE).length * 0.4;
    } else if (kind === 'quarry') {
      if (!feeder) continue;
      score += 4 - r * 0.3;
    } else if (kind === 'arrow') {
      score += S.paths.filter((q) => q.team === 'blue' && q.to.team === 'red' && dist(q.to, p) <= ARROW_RANGE).length * 3;
    }
    if (score > bs) { bs = score; best = [c, r]; }
  }
  return best;
}

// ---------------------------------------------------------------- building placement
function canPlace(team, kind, c, r) {
  if (!inBounds(c, r)) return 'Off the board';
  const e = entityAt(c, r);
  if (kind === 'shield') {
    if (!e || e.team !== team) return 'Drop on your building';
    if (e.shield > 0) return 'Already shielded';
    return true;
  }
  if (e) return 'Tile occupied';
  if (pathCrossesCell(c, r)) return 'A path crosses this tile';
  return true;
}

function place(team, kind, c, r) {
  if (canPlace(team, kind, c, r) !== true) return false;
  if (S.bricks[team] < CARDS[kind].cost) return false;
  S.bricks[team] -= CARDS[kind].cost;
  const idx = S.hand[team].indexOf(kind);
  if (idx >= 0) S.hand[team].splice(idx, 1);
  if (kind === 'shield') {
    const e = entityAt(c, r);
    e.shield = SHIELD_HP;
    e.bump = 1;
    refreshEntity(e);
    burst(e.x, 0.3, e.z, 0x8fdcff, 8, 0.7);
  } else {
    const e = addEntity(kind, team, c, r, CARDS[kind].hp);
    e.pop = 1;
    burst(e.x, 0.1, e.z, 0xe0a060, 8, 0.6);
  }
  updateHud();
  return true;
}

function drawHand() {
  const bag = [];
  for (const [k, w] of Object.entries(DECK)) for (let i = 0; i < w; i++) bag.push(k);
  const pick = () => {
    const h = [];
    const pool = [...bag];
    for (let i = 0; i < 4; i++) h.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    return h;
  };
  S.hand.blue = pick();
  S.hand.red = pick();
}

// ---------------------------------------------------------------- phases
function startMatch() {
  for (const e of S ? [...S.ents] : []) { scene.remove(e.obj); e.label.remove(); }
  for (const u of S ? S.units : []) scene.remove(u.mesh);
  for (const p of S ? S.projectiles : []) scene.remove(p.mesh);
  S = newState();
  generateMap();
  rebuildPaths();
  startConnect();
}

function startBuild() {
  S.phase = 'build';
  S.timer = PHASE_TIME;
  S.selected = -1;
  drawHand();
  renderPanel();
  updateHud();
}
function endBuild() {
  cancelDrag();
  cpuBuild();
  startConnect();
}

function startConnect() {
  S.phase = 'connect';
  S.timer = PHASE_TIME;
  // safety net: a team with no income and no bricks could never act again
  for (const team of ['blue', 'red']) {
    if (S.bricks[team] < PATH_COST && !S.paths.some((p) => p.team === team)) {
      S.bricks[team] = PATH_COST;
      if (team === 'blue') toast(`Emergency supply: ${PATH_COST} bricks`);
    }
  }
  renderPanel();
  updateHud();
}
function endConnect() {
  cancelDrag();
  cpuConnect();
  startBattle();
}

function startBattle() {
  S.phase = 'battle';
  S.battleT = 0;
  S.settle = 0;
  S.earned = 0;
  S.spawns = [];
  for (const p of S.paths) {
    for (let i = 0; i < UNITS_PER_PATH; i++) S.spawns.push({ path: p, t: 0.3 + i * SPAWN_GAP });
  }
  renderPanel();
  updateHud();
}

function endBattle() {
  S.units.forEach((u) => scene.remove(u.mesh));
  S.units = [];
  const b = buildings('blue').length, r = buildings('red').length;
  if (b === 0 || r === 0 || S.round >= MAX_ROUNDS) {
    let win;
    if (b === 0 || r === 0) win = b > 0;
    else if (b !== r) win = b > r;
    else win = buildings('blue').reduce((s, e) => s + e.hp, 0) >= buildings('red').reduce((s, e) => s + e.hp, 0);
    S.phase = 'over';
    renderPanel();
    updateHud();
    setTimeout(() => showResult(win, b, r), 600);
    return;
  }
  S.round++;
  startBuild();
}

function endPhase() {
  if (S.phase === 'build') endBuild();
  else if (S.phase === 'connect') endConnect();
}
endBtn.addEventListener('click', endPhase);

// ---------------------------------------------------------------- HUD / panel
const PHASE_NAME = { build: 'BUILD', connect: 'CONNECT', battle: 'BATTLE', over: 'GAME OVER', intro: 'READY' };
let lastTimerText = '';
function updateHud() {
  if (!S) return;
  $('phasePill').textContent = `${S.round} • ${PHASE_NAME[S.phase]}`;
  $('brickCount').textContent = S.bricks.blue;
  $('blueCount').textContent = buildings('blue').length;
  $('redCount').textContent = buildings('red').length;
  updateTimer();
  if (S.phase === 'build') refreshCards();
  if (S.phase === 'battle') {
    const el = $('earned');
    if (el) el.textContent = `+${S.earned}`;
  }
}
function updateTimer() {
  let t;
  if (S.phase === 'build' || S.phase === 'connect') t = `${PHASE_NAME[S.phase]} • ${Math.ceil(S.timer)}s`;
  else if (S.phase === 'battle') t = 'UNITS MOVING';
  else t = `ROUND ${S.round} / ${MAX_ROUNDS}`;
  if (t !== lastTimerText) {
    $('timerText').textContent = t;
    lastTimerText = t;
    document.querySelector('.timer-pill').classList.toggle('hurry', (S.phase === 'build' || S.phase === 'connect') && S.timer <= 5);
  }
}

let icons = {};
function renderPanel() {
  panelBody.innerHTML = '';
  if (S.phase === 'build') {
    panelTitle.textContent = 'DRAW COMPLETE • CHOOSE A CARD';
    S.hand.blue.forEach((kind, i) => {
      const el = document.createElement('div');
      el.className = 'card';
      el.dataset.idx = i;
      el.innerHTML = `<img src="${icons[kind]}" alt=""><div class="nm">${CARDS[kind].name}</div><div class="cost">${BRICK}${CARDS[kind].cost}</div>`;
      el.addEventListener('pointerdown', (ev) => cardDown(ev, i));
      panelBody.appendChild(el);
    });
    for (let i = S.hand.blue.length; i < 4; i++) {
      const el = document.createElement('div');
      el.className = 'card empty';
      el.textContent = 'BUILT';
      panelBody.appendChild(el);
    }
    endBtn.textContent = 'END BUILD';
    endBtn.disabled = false;
    refreshCards();
  } else if (S.phase === 'connect') {
    panelTitle.textContent = S.round === 1 ? 'OPENING ROUND • CONNECT FIRST' : 'CONNECT • DRAG A PATH';
    panelBody.innerHTML = `
      <div class="info"><div class="big">${BRICK}${PATH_COST}</div><div class="small">per new<br>path</div></div>
      <div class="info"><div class="big">${UNITS_PER_PATH}</div><div class="small">units per<br>path / turn</div></div>
      <div class="info wide">
        <p>Drag from a <b>blue building</b> to a rock, enemy or your own building in range.</p>
        <p>Tap your path to erase it.</p>
      </div>`;
    endBtn.textContent = 'END TURN';
    endBtn.disabled = false;
  } else if (S.phase === 'battle') {
    panelTitle.textContent = 'BATTLE • UNITS ON THE MOVE';
    const mine = S.paths.filter((p) => p.team === 'blue').length;
    const theirs = S.paths.filter((p) => p.team === 'red').length;
    panelBody.innerHTML = `
      <div class="info"><div class="big"><span class="swatch" style="background:#1f6dff"></span>${mine * UNITS_PER_PATH}</div><div class="small">your units</div></div>
      <div class="info"><div class="big"><span class="swatch" style="background:#e4222e"></span>${theirs * UNITS_PER_PATH}</div><div class="small">enemy units</div></div>
      <div class="info"><div class="big">${BRICK}<span id="earned">+0</span></div><div class="small">bricks earned</div></div>`;
    endBtn.textContent = 'BATTLE…';
    endBtn.disabled = true;
  } else {
    panelTitle.textContent = 'MATCH OVER';
    endBtn.textContent = 'PLAY AGAIN';
    endBtn.disabled = true;
  }
}

function refreshCards() {
  panelBody.querySelectorAll('.card:not(.empty)').forEach((el) => {
    const i = +el.dataset.idx;
    const kind = S.hand.blue[i];
    if (!kind) return;
    el.classList.toggle('poor', S.bricks.blue < CARDS[kind].cost);
    el.classList.toggle('sel', S.selected === i);
  });
}

// ---------------------------------------------------------------- icons (rendered from the real models)
function renderIcons() {
  const size = 200;
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setSize(size, size);
  r.setPixelRatio(1);
  r.outputColorSpace = THREE.SRGBColorSpace;
  const sc = new THREE.Scene();
  sc.add(new THREE.HemisphereLight(0xe4f1ff, 0x6080b0, 1.7));
  const sun = new THREE.DirectionalLight(0xffffff, 2.0);
  sun.position.set(-3, 6, 5);
  sc.add(sun);
  const cam = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
  const out = {};
  for (const kind of Object.keys(CARDS)) {
    let model;
    if (kind === 'shield') {
      model = new THREE.Group();
      const inner = M.makeNormal('blue');
      inner.userData.setFloors(1);
      model.add(inner);
      const sh = M.makeShield();
      sh.userData.setHeight(0.32);
      model.add(sh);
    } else {
      model = M.makeModel(kind, 'blue');
    }
    sc.add(model);
    const h = model.userData.getHeight ? model.userData.getHeight() : 0.65;
    const look = new THREE.Vector3(0.04, h * 0.45, 0);
    const d = 2.7 + h * 0.9;
    cam.position.set(look.x + d * 0.42, look.y + d * 0.5, look.z + d * 0.76);
    cam.lookAt(look);
    r.render(sc, cam);
    out[kind] = r.domElement.toDataURL();
    sc.remove(model);
  }
  r.dispose();
  r.forceContextLoss();
  return out;
}

// ---------------------------------------------------------------- input
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function setRay(ev) {
  const rect = canvas.getBoundingClientRect();
  ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
}
function groundPoint(ev) {
  setRay(ev);
  const o = raycaster.ray.origin, d = raycaster.ray.direction;
  const t = -o.y / d.y;
  return { x: o.x + d.x * t, z: o.z + d.z * t };
}
function cellAt(pt) {
  const c = Math.round(pt.x + (COLS - 1) / 2), r = Math.round(pt.z + (ROWS - 1) / 2);
  return inBounds(c, r) ? { c, r } : null;
}
function pickEntity(ev) {
  setRay(ev);
  const hits = raycaster.intersectObjects(S.ents.map((e) => e.obj), true);
  for (const h of hits) {
    let o = h.object;
    while (o && !o.userData.ent) o = o.parent;
    if (o && o.userData.ent.alive) return o.userData.ent;
  }
  const cell = cellAt(groundPoint(ev));
  return cell ? entityAt(cell.c, cell.r) : null;
}
function overPanel(ev) {
  return ev.clientY > panel.getBoundingClientRect().top;
}

let drag = null;

function showBubble(text, x, y, cls = '') {
  bubble.textContent = text;
  bubble.className = 'bubble ' + cls;
  const half = bubble.offsetWidth / 2 + 6;
  x = Math.min(app.clientWidth - half, Math.max(half, x));
  bubble.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
}
function hideBubble() { bubble.classList.add('hidden'); }
function appXY(ev) {
  const r = app.getBoundingClientRect();
  return { x: ev.clientX - r.left, y: ev.clientY - r.top };
}

canvas.addEventListener('pointerdown', (ev) => {
  if (!S || S.paused) return;
  if (S.phase === 'connect') {
    const e = pickEntity(ev);
    if (e && e.team === 'blue' && e.kind === 'normal') {
      drag = { type: 'connect', src: e, id: ev.pointerId };
      rangeRing.visible = rangeFill.visible = true;
      rangeRing.position.set(e.x, 0.02, e.z);
      rangeFill.position.set(e.x, 0.015, e.z);
      let i = 0;
      hideMarkers();
      for (const t of S.ents) {
        if (t === e || findPath(e, t)) continue;
        if (dist(e, t) <= RANGE && losClear(e, t)) showMarker(i++, t.c, t.r, t.team === 'blue' ? 0x7fd0ff : 0xffffff, false, 0.75);
      }
      showMarker(i++, e.c, e.r, 0x7fd0ff, false, 1);
      e.bump = 0.5;
    } else if (e && e.team === 'blue') {
      toast('Only normal buildings send units');
    } else {
      drag = { type: 'tap', x: ev.clientX, y: ev.clientY, id: ev.pointerId };
    }
  } else if (S.phase === 'build' && S.selected >= 0) {
    drag = { type: 'tap', x: ev.clientX, y: ev.clientY, id: ev.pointerId };
  }
});

function cardDown(ev, i) {
  if (!S || S.phase !== 'build' || S.paused) return;
  ev.preventDefault();
  const kind = S.hand.blue[i];
  if (S.bricks.blue < CARDS[kind].cost) {
    const el = ev.currentTarget;
    el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
    toast('Not enough bricks');
    return;
  }
  drag = { type: 'card', idx: i, kind, x: ev.clientX, y: ev.clientY, moved: false, id: ev.pointerId, el: ev.currentTarget };
}

window.addEventListener('pointermove', (ev) => {
  if (!drag || ev.pointerId !== drag.id) return;
  if (drag.type === 'connect') moveConnect(ev);
  else if (drag.type === 'card') moveCard(ev);
});

function moveConnect(ev) {
  const src = drag.src;
  const gp = groundPoint(ev);
  let tgt = pickEntity(ev);
  if (tgt === src) tgt = null;
  const p = appXY(ev);
  if (tgt) {
    const chk = checkConnect('blue', src, tgt);
    drag.tgt = tgt;
    drag.chk = chk;
    const color = chk.ok ? 0x6dff9a : (chk.reason === 'Already connected' ? 0xffffff : 0xff5a5a);
    setDragLine(src.x, src.z, tgt.x, tgt.z, color);
    const sp = toScreen(tgt.x, entHeight(tgt) + 0.35, tgt.z);
    showBubble(chk.ok ? chk.verb : (chk.reason || 'Cancel'), sp.x, sp.y - 8, chk.ok ? 'good' : 'bad');
  } else {
    drag.tgt = null;
    const far = Math.hypot(gp.x - src.x, gp.z - src.z) > RANGE;
    setDragLine(src.x, src.z, gp.x, gp.z, far ? 0xff5a5a : 0xffffff);
    showBubble(far ? 'Out of range' : 'Drag to a target', p.x, p.y - 34, far ? 'bad' : '');
  }
}

function moveCard(ev) {
  if (!drag.moved && Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) > 8) {
    drag.moved = true;
    drag.el.classList.add('dragging');
    S.selected = -1;
    refreshCards();
    if (drag.kind !== 'shield') {
      drag.ghost = M.makeModel(drag.kind, 'blue');
      drag.ghost.traverse((o) => {
        if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.6; o.castShadow = false; }
      });
      scene.add(drag.ghost);
    }
  }
  if (!drag.moved) return;
  hideMarkers();
  const cell = overPanel(ev) ? null : cellAt(groundPoint(ev));
  drag.cell = cell;
  if (drag.ghost) drag.ghost.visible = !!cell;
  if (!cell) { hideBubble(); return; }
  const ok = canPlace('blue', drag.kind, cell.c, cell.r);
  showMarker(0, cell.c, cell.r, ok === true ? 0x9ff3ff : 0xff5a5a, true, 1);
  if (drag.ghost) drag.ghost.position.set(cx(cell.c), 0.05, cz(cell.r));
  const e = entityAt(cell.c, cell.r);
  const sp = toScreen(cx(cell.c), (e ? entHeight(e) : 0.3) + 0.5, cz(cell.r));
  const hint = drag.kind === 'shield' ? 'Drop on your building' : 'Place on an empty tile';
  showBubble(ok === true ? hint : ok, sp.x, sp.y, ok === true ? '' : 'bad');
}

window.addEventListener('pointerup', (ev) => {
  if (!drag || ev.pointerId !== drag.id) return;
  const d = drag;
  if (d.type === 'connect') {
    if (d.tgt) {
      const res = connect('blue', d.src, d.tgt);
      if (res.ok) {
        S.tutorial = false;
        toast(`${res.verb} • −${PATH_COST} bricks`);
      } else if (res.reason && !res.silent) toast(res.reason);
    }
  } else if (d.type === 'card') {
    if (d.moved) {
      if (d.cell && canPlace('blue', d.kind, d.cell.c, d.cell.r) === true) {
        place('blue', d.kind, d.cell.c, d.cell.r);
        renderPanel();
      } else if (d.cell) toast(canPlace('blue', d.kind, d.cell.c, d.cell.r));
    } else {
      S.selected = S.selected === d.idx ? -1 : d.idx;
      refreshCards();
      if (S.selected >= 0) toast('Tap a tile to place');
    }
  } else if (d.type === 'tap' && Math.hypot(ev.clientX - d.x, ev.clientY - d.y) < 10) {
    tapBoard(ev);
  }
  cancelDrag();
});
window.addEventListener('pointercancel', () => cancelDrag());

function tapBoard(ev) {
  const gp = groundPoint(ev);
  if (S.phase === 'connect') {
    // erase the nearest own path segment under the finger
    let best = null, bd = 0.22;
    for (const p of S.paths) {
      if (p.team !== 'blue') continue;
      const ax = p.from.x, az = p.from.z, bx = p.to.x, bz = p.to.z;
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
      const t = Math.max(0, Math.min(1, ((gp.x - ax) * dx + (gp.z - az) * dz) / L2));
      const d = Math.hypot(gp.x - (ax + dx * t), gp.z - (az + dz * t));
      if (d < bd) { bd = d; best = p; }
    }
    if (best) {
      S.paths.splice(S.paths.indexOf(best), 1);
      rebuildPaths();
      toast('Path erased (no refund)');
    }
  } else if (S.phase === 'build' && S.selected >= 0) {
    const cell = cellAt(gp);
    const kind = S.hand.blue[S.selected];
    if (!cell || !kind) return;
    const ok = canPlace('blue', kind, cell.c, cell.r);
    if (ok !== true) { toast(ok); return; }
    if (S.bricks.blue < CARDS[kind].cost) { toast('Not enough bricks'); return; }
    place('blue', kind, cell.c, cell.r);
    S.selected = -1;
    renderPanel();
  }
}

function cancelDrag() {
  if (drag && drag.ghost) scene.remove(drag.ghost);
  if (drag && drag.el) drag.el.classList.remove('dragging');
  drag = null;
  setDragLine(null);
  rangeRing.visible = rangeFill.visible = false;
  hideMarkers();
  hideBubble();
}

// ---------------------------------------------------------------- camera fit
const tmp = new THREE.Vector3();
function fitCamera() {
  const w = app.clientWidth, h = app.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.clearViewOffset();
  const appTop = app.getBoundingClientRect().top;
  const top = $('hudRow2').getBoundingClientRect().bottom - appTop + 6;
  const bottom = panel.getBoundingClientRect().top - appTop - 4;
  const availW = w - 12, availH = bottom - top;
  const hw = COLS / 2 + 0.3, hh = ROWS / 2 + 0.3;
  const pts = [[-hw, 0, -hh], [hw, 0, -hh], [-hw, 0, hh], [hw, 0, hh], [-hw, 1.1, -hh], [hw, 1.1, -hh]];
  const measure = (d) => {
    camera.position.set(0, Math.sin(CAM_PITCH) * d, Math.cos(CAM_PITCH) * d);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) {
      tmp.set(...p).project(camera);
      const sx = (tmp.x + 1) / 2 * w, sy = (1 - tmp.y) / 2 * h;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    return { x0, x1, y0, y1 };
  };
  let lo = 4, hi = 80;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    const b = measure(mid);
    if (b.x1 - b.x0 <= availW && b.y1 - b.y0 <= availH) hi = mid; else lo = mid;
  }
  camDist = hi;
  const b = measure(camDist);
  const shiftY = (b.y0 + b.y1) / 2 - (top + bottom) / 2;
  camera.setViewOffset(w, h, 0, shiftY, w, h);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', fitCamera);

// ---------------------------------------------------------------- per-frame
function updateLabels() {
  for (const e of S.ents) {
    const y = e.kind === 'rock' ? 0.63 : entHeight(e) + 0.3;
    const p = toScreen(e.x, y, e.z);
    e.label.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%)`;
  }
}

function animateEntities(dt, time) {
  for (const e of S.ents) {
    let sx = 1, sy = 1;
    if (e.pop > 0) {
      e.pop = Math.max(0, e.pop - dt * 3.5);
      const k = 1 - e.pop;
      const s = k < 0.7 ? k / 0.7 * 1.12 : 1.12 - (k - 0.7) / 0.3 * 0.12;
      sx = sy = Math.max(0.01, s);
    }
    if (e.bump > 0) {
      e.bump = Math.max(0, e.bump - dt * 5);
      sy *= 1 - Math.sin(e.bump * Math.PI) * 0.08;
      sx *= 1 + Math.sin(e.bump * Math.PI) * 0.05;
    }
    e.obj.scale.set(sx, sy, sx);
    if (e.kind === 'arrow' && S.phase !== 'battle') e.obj.userData.turret.rotation.y += dt * 0.6;
  }
}

function updateHand(time) {
  const show = S.tutorial && S.phase === 'connect' && !drag && !S.paused;
  if (!show) { hand.classList.add('hidden'); if (S.phase !== 'connect' || !drag) { /* keep bubble for drags */ } return; }
  const src = buildings('blue').find((e) => e.kind === 'normal');
  if (!src) return;
  if (!S.tutorialTarget || !S.tutorialTarget.alive) {
    S.tutorialTarget = S.ents.filter((t) => t.kind === 'rock' && dist(src, t) <= RANGE && losClear(src, t)).sort((a, b) => a.hp - b.hp)[0];
  }
  const t = S.tutorialTarget;
  if (!t) return;
  const k = (time % 2.2) / 2.2;
  const e = Math.min(1, Math.max(0, (k - 0.15) / 0.6));
  const ease = e * e * (3 - 2 * e);
  const a = toScreen(src.x, 0.4, src.z), b = toScreen(t.x, 0.4, t.z);
  hand.classList.remove('hidden');
  hand.style.opacity = k > 0.88 ? (1 - (k - 0.88) / 0.12) : 1;
  hand.style.transform = `translate(${a.x + (b.x - a.x) * ease - 14}px, ${a.y + (b.y - a.y) * ease - 4}px)`;
  const bp = toScreen(t.x, 0.9, t.z);
  showBubble('Drag to a rock to mine', bp.x, bp.y - 6);
}

let last = performance.now();
let tutorialBubbleOn = false;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const time = now / 1000;
  update(dt, time);
  renderer.render(scene, camera);
}

function update(dt, time) {
  if (S && !S.paused) {
    if (S.phase === 'build' || S.phase === 'connect') {
      S.timer -= dt;
      if (S.timer <= 0) endPhase();
      else updateTimer();
    } else if (S.phase === 'battle') {
      updateBattle(dt);
    }
  }
  if (S) {
    for (const p of S.paths) if (p.grow < 1) { p.grow = Math.min(1, p.grow + dt * 4); applyGrow(p); }
    animateEntities(dt, time);
    updateLabels();
    const wasTut = tutorialBubbleOn;
    tutorialBubbleOn = S.tutorial && S.phase === 'connect' && !drag && !S.paused;
    updateHand(time);
    if (wasTut && !tutorialBubbleOn && !drag) hideBubble();
  }
  pathTex.blue.offset.x -= dt * 1.4;
  pathTex.red.offset.x -= dt * 1.4;
  dragTex.offset.x -= dt * 2;
  updateParticles(dt);

  // camera shake
  camera.position.set(0, Math.sin(CAM_PITCH) * camDist, Math.cos(CAM_PITCH) * camDist);
  camera.lookAt(0, 0, 0);
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
    shake = Math.max(0, shake - dt * 0.6);
  }
}

// ---------------------------------------------------------------- modals
function openModal(html) {
  modalBox.innerHTML = html;
  modal.classList.add('open');
  if (S) S.paused = true;
}
function closeModal() {
  modal.classList.remove('open');
  if (S) S.paused = false;
}

const RULES = `
  <ul>
    <li><b>Build → Connect → Battle.</b> Both teams act at the same time. Each phase lasts ${PHASE_TIME}s, or press the button to finish early. Round 1 skips Build.</li>
    <li><b>Connect:</b> drag from a blue normal building to a rock, enemy or friendly building within its range. Each new path costs ${PATH_COST} bricks, no limit. Paths need a clear straight line but may cross each other. Tap a path to erase it (no refund).</li>
    <li><b>Battle:</b> every path sends ${UNITS_PER_PATH} units. Each hit on a rock or enemy earns 1 brick. When two enemy buildings attack each other, the armies clash in the middle.</li>
    <li><b>Friendly paths:</b> 5 units = +1 floor. Supply a <b>cannon</b> to fire at the nearest target, or a <b>quarry</b> for +${QUARRY_YIELD} bricks per unit. Draw a friendly path the other way to reverse it.</li>
    <li><b>Build:</b> drag an affordable card onto an empty tile. <b>Arrow towers</b> shoot enemy units nearby. <b>Shields</b> go on your building and absorb ${SHIELD_HP} hits.</li>
    <li>Destroy every enemy building to win, or have the most buildings after ${MAX_ROUNDS} rounds.</li>
  </ul>`;

function showIntro() {
  openModal(`
    <div class="eyebrow">BUILD · CONNECT · BATTLE</div>
    <h1>City Breaker</h1>
    ${RULES}
    <button class="btn" id="playBtn">LET'S PLAY</button>`);
  $('playBtn').onclick = () => { closeModal(); };
}
function showHelp() {
  openModal(`
    <div class="eyebrow">HOW TO PLAY</div>
    <h1>City Breaker</h1>
    ${RULES}
    <button class="btn" id="resumeBtn">RESUME</button>
    <button class="link" id="restartBtn">NEW MATCH</button>`);
  $('resumeBtn').onclick = closeModal;
  $('restartBtn').onclick = () => { closeModal(); startMatch(); };
}
function showResult(win, b, r) {
  openModal(`
    <div class="${win ? 'result-win' : 'result-lose'}">
      <div class="eyebrow">ROUND ${S.round} • MATCH OVER</div>
      <h1>${win ? 'Victory!' : 'Defeat'}</h1>
      <div class="stats">
        <div class="info"><div class="big">${b}</div><div class="small">your buildings</div></div>
        <div class="info"><div class="big">${r}</div><div class="small">enemy buildings</div></div>
        <div class="info"><div class="big">${S.stats.bricks}</div><div class="small">bricks earned</div></div>
      </div>
      <button class="btn" id="againBtn">PLAY AGAIN</button>
    </div>`);
  $('againBtn').onclick = () => { closeModal(); startMatch(); };
}
$('helpBtn').addEventListener('click', showHelp);

// ---------------------------------------------------------------- boot
async function boot() {
  try { await document.fonts.ready; } catch (_) { /* fonts optional */ }
  icons = renderIcons();
  startMatch();
  fitCamera();
  showIntro();
  requestAnimationFrame(frame);
  // debug hook for testing in the console
  window.CB = { get state() { return S; }, endPhase, connect, place, tick: (dt = 1 / 30) => { update(dt, performance.now() / 1000); renderer.render(scene, camera); } };
}
boot();
