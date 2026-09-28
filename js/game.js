// City Breaker (Hex Warriors version) — connect → battle, blue (you) vs red (CPU).
// No building phase: every building claims a square zone, and you grow by
// breaking locked flag towers inside your zones to unlock what they hide.
import * as THREE from 'three';
import * as M from './models.js';

// ---------------------------------------------------------------- tuning
const COLS = 5;
const ROWS = 9;
const HALF_ROWS = Math.ceil(ROWS / 2);   // red half = rows [0, HALF_ROWS), mirrored into the blue half
const HOME = { blue: [2, ROWS - 2], red: [2, 1] };
const MODEL_SCALE = 0.66;     // buildings & rocks sit well inside their tile so paths show between them
const TILE = 0.9;             // tile size; the rest of each cell is the gap between tiles
// Zone = square of cells around a building (Chebyshev radius). It is both the
// building's reach (paths, tower shots) and the land it claims.
const ZONE = { squad: 1, tank: 2, heli: 2, cannon: 2, arrow: 2, quarry: 1 };
const PATH_COST = 5;           // bricks per new connection
const START_BRICKS = 10;
const BATTLE_INCOME = 2;       // both teams get this at the end of every battle
const UNITS_PER_PATH = 5;
const PHASE_TIME = 30;
const MAX_ROUNDS = 15;
const START_HP = 5;           // 1 floor
const CANNON_DMG = 1;
const CANNON_RATE = 0.35;
const CANNON_SPEED = 4;
const ARROW_RATE = 0.4;
const ARROW_SPEED = 4.5;
const QUARRY_YIELD = 2;
const MAX_HP = 20;            // 4 floors
const BLOCK_HALF = 0.42;      // half-size of a tile's blocking box for straight-line checks
const MAX_LINKS = 4;           // outgoing paths per sender building: 1 per floor, up to 4
const REVEAL_CHANCE = 0.5;     // broken rock → flag tower, destroyed enemy building → your building
// What a flag tower hides / what a captured enemy tile turns into: first a
// group (unit buildings 65% > artillery > resource), then a kind inside it.
const SPAWN_GROUPS = {
  unit: { weight: 65, kinds: { squad: 55, tank: 30, heli: 15 } },
  artillery: { weight: 27, kinds: { cannon: 60, arrow: 40 } },
  resource: { weight: 8, kinds: { quarry: 1 } },
};
const GROUP_OF = { squad: 'unit', tank: 'unit', heli: 'unit', cannon: 'artillery', arrow: 'artillery', quarry: 'resource' };
const RARITY = { squad: 'common', tank: 'mid', heli: 'rare', cannon: 'common', arrow: 'mid', quarry: 'rare' };

// What each sender building puts on a path every turn, per floor of the building
// (a 2-floor squad sends 10 soldiers, a 2-floor tank building sends 2 tanks).
const UNIT_TYPES = {
  squad: { unit: 'soldier', count: UNITS_PER_PATH, gap: 0.7, hp: 1, dmg: 1, speed: 0.55, alt: 0, gunRange: 0 },
  tank: { unit: 'tank', count: 1, gap: 1.7, hp: 5, dmg: 5, speed: 0.42, alt: 0, gunRange: 2 },
  heli: { unit: 'heli', count: 1, gap: 1.5, hp: 5, dmg: 5, speed: 0.5, alt: 0.9, gunRange: 1.5 },
};
const floorsOf = (e) => Math.max(1, Math.ceil(e.hp / 5));
const linkSlots = (e) => Math.min(MAX_LINKS, floorsOf(e));
const unitsPerTurn = (e) => UNIT_TYPES[e.kind].count * floorsOf(e);
const GUN_RATE = 0.8;

const INFO = {
  squad: { name: 'SQUAD', line: 'Sends 5 soldiers down each of its paths every battle.' },
  tank: { name: 'TANK', line: 'Sends a 5 hp tank that shoots units ahead and hits for 5.' },
  heli: { name: 'HELI', line: 'Sends a helicopter that flies over rocks, towers and water. Hits for 5.' },
  cannon: { name: 'CANNON', line: 'Feed it from a unit building: every point delivered = 1 cannon ball (a tank = 5). Hits the first thing in line.' },
  arrow: { name: 'ARROWS', line: 'Feed it from a unit building: every point delivered = 1 arrow that pierces to the edge of its zone.' },
  quarry: { name: 'QUARRY', line: `Connect a path to it: every unit you send in = +${QUARRY_YIELD} bricks.` },
};
const isSender = (e) => !!e && (e.kind === 'squad' || e.kind === 'tank' || e.kind === 'heli');
// Artillery never fires on its own: it shoots the ammo unit buildings deliver
// (1 shot per point), at the target it's aimed at or else the nearest one.
const isArtillery = (e) => !!e && (e.kind === 'cannon' || e.kind === 'arrow');
const canSource = (e) => isSender(e) || isArtillery(e);
const losMode = (e) => (e.kind === 'heli' ? 'air' : 'ground');
const zoneOf = (e) => ZONE[e.kind] ?? 0;
const zoneSize = (kind) => `${ZONE[kind] * 2 + 1}×${ZONE[kind] * 2 + 1}`;
const cheb = (a, c, r) => Math.max(Math.abs(a.c - c), Math.abs(a.r - r));
const inZone = (src, t) => cheb(src, t.c, t.r) <= zoneOf(src);

function pickWeighted(weights) {
  const entries = Object.entries(weights);
  let x = Math.random() * entries.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of entries) if ((x -= w) < 0) return k;
  return entries[0][0];
}
// group: 'unit' | 'artillery' | 'resource', or omitted to roll the group too
function rollKind(group) {
  const g = group || pickWeighted(Object.fromEntries(Object.entries(SPAWN_GROUPS).map(([k, v]) => [k, v.weight])));
  return pickWeighted(SPAWN_GROUPS[g].kinds);
}

// ---------------------------------------------------------------- DOM
const $ = (id) => document.getElementById(id);
const app = $('app');
const canvas = $('scene');
const labelsEl = $('labels');
const floatsEl = $('floats');
const goBtn = $('goBtn');
const modePill = $('modePill');
const bannerEl = $('banner');
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
const CAM_PITCH = THREE.MathUtils.degToRad(62);
let camDist = 20;
let shake = 0;

function addLights(target) {
  target.add(new THREE.HemisphereLight(0xe4f1ff, 0xf0a060, 1.55));
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.1);
  sun.position.set(-5, 11, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 10, bottom: -10, near: 1, far: 40 });
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

function buildEnvironment() {
  const rand = mulberry(7);
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), new THREE.MeshStandardMaterial({ color: 0xee9140, roughness: 1 }));
  sand.rotation.x = -Math.PI / 2;
  sand.position.y = -0.1;
  sand.receiveShadow = true;
  scene.add(sand);

  // sunken board bed with one raised tile per cell, so every cell reads on its own
  const bed = new THREE.Mesh(M.rbox(COLS + 0.18, 0.1, ROWS + 0.18, 0.06), M.mat(0xc46a28, { roughness: 1 }));
  bed.position.y = -0.1;
  bed.receiveShadow = true;
  scene.add(bed);
  const tileGeo = M.rbox(TILE, 0.1, TILE, 0.05);
  const tileMats = [M.mat(0xf6a24b, { roughness: 1 }), M.mat(0xf3993f, { roughness: 1 })];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const t = new THREE.Mesh(tileGeo, tileMats[(r + c) % 2]);
    t.position.set(cx(c), -0.04, cz(r));
    t.receiveShadow = true;
    scene.add(t);
  }

  // wooden fence rails around the board
  const wood = M.mat(0xe9c98a);
  const hw = COLS / 2 + 0.26, hh = ROWS / 2 + 0.26;
  const railH = 0.07;
  const rails = [
    [0, -hh, COLS + 0.58, 0.06], [0, hh, COLS + 0.58, 0.06],
    [-hw, 0, 0.06, ROWS + 0.58], [hw, 0, 0.06, ROWS + 0.58],
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
  for (let x = -8; x <= 8; x += 1.3 + rand() * 0.6) {
    addBoulder(x, -hh - 1.6 - rand() * 1.4, 0.9 + rand() * 0.9);
    addBoulder(x, -hh - 3.6 - rand() * 2, 1.2 + rand() * 1.2);
    addBoulder(x, hh + 1.6 + rand() * 1.2, 0.8 + rand() * 0.9);
  }
  for (let z = -hh; z <= hh; z += 1.2 + rand() * 0.9) {
    addBoulder(-hw - 2.2 - rand() * 1.6, z, 0.8 + rand() * 1.1);
    addBoulder(hw + 2.2 + rand() * 1.6, z, 0.8 + rand() * 1.1);
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
  for (let i = 0; i < 24; i++) {
    const side = rand() < 0.5 ? -1 : 1;
    addCactus(side * (hw + 0.45 + rand() * 1.5), (rand() - 0.5) * (ROWS + 1), 0.9 + rand() * 0.8);
  }
  for (let i = 0; i < 8; i++) {
    addCactus((rand() - 0.5) * (COLS + 3), -hh - 0.6 - rand() * 0.5, 0.9 + rand() * 0.6);
    addCactus((rand() - 0.5) * (COLS + 3), hh + 0.6 + rand() * 0.5, 0.9 + rand() * 0.6);
  }
}
buildEnvironment();

// ---------------------------------------------------------------- textures for paths & markers
// War Regions–style dotted lines. Dots are white so a material colour tints them.
function dotTexture(hollow) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  g.beginPath();
  g.arc(32, 32, 22, 0, Math.PI * 2);
  if (hollow) {
    g.lineWidth = 11;
    g.strokeStyle = '#fff';
    g.stroke();
  } else {
    g.fillStyle = '#fff';
    g.fill();
    g.lineWidth = 5;
    g.strokeStyle = 'rgba(0,0,0,.28)';
    g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
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

const dotTex = { ground: dotTexture(false), air: dotTexture(true) };
const borderTex = dotTexture(false);   // static copy for territory & zone outlines
const TEAM_DOT = { blue: 0x2f80ff, red: 0xf0303c };
const pathMat = {};
const borderMat = {};
for (const team of ['blue', 'red']) {
  pathMat[team] = {};
  for (const mode of ['ground', 'air']) {
    pathMat[team][mode] = new THREE.MeshBasicMaterial({ map: dotTex[mode], color: TEAM_DOT[team], transparent: true, depthWrite: false });
  }
  borderMat[team] = new THREE.MeshBasicMaterial({ map: borderTex, color: TEAM_DOT[team], transparent: true, depthWrite: false });
}
const aimMat = {
  blue: new THREE.MeshBasicMaterial({ map: dotTex.air, color: 0x8fd0ff, transparent: true, depthWrite: false }),
  red: new THREE.MeshBasicMaterial({ map: dotTex.air, color: 0xff8a8a, transparent: true, depthWrite: false }),
};
const dragMat = new THREE.MeshBasicMaterial({ map: dotTex.ground, transparent: true, depthWrite: false, color: 0xffffff });
const DOT_GAP = 0.26;

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
function disposeGroup(group) {
  for (const g of [...group.children]) {
    group.remove(g);
    g.traverse((o) => o.geometry && o.geometry.dispose());
  }
}

// square zone highlight shown while dragging from (or tapping) a building
const zoneGroup = new THREE.Group();
scene.add(zoneGroup);
const zoneFillMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false });
const zoneLineMat = new THREE.MeshBasicMaterial({ map: borderTex, color: 0xffffff, transparent: true, depthWrite: false });
function showZone(e, color = 0xffffff) {
  hideZone();
  const R = zoneOf(e);
  if (!R) return;
  const pad = 0.03;
  const x0 = cx(Math.max(0, e.c - R)) - 0.5 + pad, x1 = cx(Math.min(COLS - 1, e.c + R)) + 0.5 - pad;
  const z0 = cz(Math.max(0, e.r - R)) - 0.5 + pad, z1 = cz(Math.min(ROWS - 1, e.r + R)) + 0.5 - pad;
  zoneFillMat.color.set(color);
  zoneLineMat.color.set(color);
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), zoneFillMat);
  fill.rotation.x = -Math.PI / 2;
  fill.position.set((x0 + x1) / 2, 0.018, (z0 + z1) / 2);
  zoneGroup.add(fill);
  for (const [a, b, c, d] of [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]]) {
    zoneGroup.add(ribbon(a, b, c, d, 0.09, zoneLineMat, 0.03, 0.2));
  }
}
function hideZone() { disposeGroup(zoneGroup); }

const markerSolid = tileMarkerTexture(false);
const markerDashed = tileMarkerTexture(true);
const markerPool = [];
function marker(i) {
  if (!markerPool[i]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(TILE, TILE),
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
function setDragLine(x1, z1, x2, z2, color, mode = 'ground') {
  if (dragLine) { scene.remove(dragLine); dragLine.children[0].geometry.dispose(); dragLine = null; }
  if (x1 == null) return;
  dragMat.color.set(color);
  dragMat.map = dotTex[mode];
  dragLine = ribbon(x1, z1, x2, z2, 0.17, dragMat, 0.06, DOT_GAP);
  scene.add(dragLine);
}

// ---------------------------------------------------------------- tips memory
const TIP_KEY = 'cb-hex-tips';
let seenTips = {};
try { seenTips = JSON.parse(localStorage.getItem(TIP_KEY) || '{}') || {}; } catch (_) { seenTips = {}; }
const seen = (id) => !!seenTips[id];
function markSeen(id) {
  seenTips[id] = 1;
  try { localStorage.setItem(TIP_KEY, JSON.stringify(seenTips)); } catch (_) { /* storage optional */ }
}
function resetTips() {
  seenTips = {};
  try { localStorage.removeItem(TIP_KEY); } catch (_) { /* storage optional */ }
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
    terrain: Array.from({ length: ROWS }, () => Array(COLS).fill('ground')),
    ents: [],
    paths: [],
    units: [],
    projectiles: [],
    spawns: [],
    nextId: 1,
    battleT: 0,
    settle: 0,
    earned: 0,
    stats: { destroyed: 0, lost: 0, bricks: 0, unlocked: 0 },
    tipQueue: [],
    battleHold: 0,
    paused: false,
  };
}

const entityAt = (c, r) => (inBounds(c, r) ? S.grid[r][c] : null);
const terrainAt = (c, r) => (inBounds(c, r) ? S.terrain[r][c] : 'edge');
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const buildings = (team) => S.ents.filter((e) => e.team === team);
const neutralColor = (e) => (e.kind === 'flag' ? 0x9aa0a8 : M.ROCK_COLOR);
const entColor = (e) => (e.team ? M.TEAM[e.team].body : neutralColor(e));

function addEntity(kind, team, c, r, hp, hidden = null) {
  const e = { id: S.nextId++, kind, team, c, r, hp, hidden, ammo: 0, cd: 0, alive: true, x: cx(c), z: cz(r), pop: 0, bump: 0 };
  e.obj = M.makeModel(kind, team || 'blue');
  e.obj.position.set(e.x, 0, e.z);
  e.obj.userData.ent = e;
  if (team === 'red' && e.obj.userData.turret) e.obj.userData.turret.rotation.y = Math.PI - 0.5;
  if (team === 'red' && e.obj.userData.roof) e.obj.userData.roof.rotation.y = Math.PI;
  if (kind === 'flag') e.obj.rotation.y = (Math.random() - 0.5) * 0.6;
  scene.add(e.obj);
  e.label = document.createElement('div');
  e.label.className = 'lbl ' + (team ? 'lbl-' + team : kind === 'flag' ? 'lbl-flag' : 'lbl-rock');
  labelsEl.appendChild(e.label);
  S.grid[r][c] = e;
  S.ents.push(e);
  refreshEntity(e);
  return e;
}

function entHeight(e) { return e.obj.userData.getHeight() * MODEL_SCALE; }

function refreshEntity(e) {
  if (isSender(e)) e.obj.userData.setFloors(floorsOf(e));
  if (e.kind === 'rock') {
    e.label.textContent = e.hp;
    e.label.classList.toggle('low', e.hp <= 5);
  } else if (e.kind === 'flag') {
    e.label.innerHTML = `<span>${e.hp}</span>`;
  } else {
    let html = `<span>${e.hp}</span>`;
    if (isArtillery(e)) html += `<i>●${e.ammo}</i>`;
    html = `<div class="row">${html}</div>`;
    if (isSender(e)) {
      // one circle per path slot; used slots are filled in
      const used = outLinks(e);
      html += '<div class="slots">';
      for (let i = 0; i < linkSlots(e); i++) html += `<em class="${i < used ? 'used' : ''}"></em>`;
      html += '</div>';
    }
    e.label.innerHTML = html;
  }
}

function removeEntity(e) {
  e.alive = false;
  S.grid[e.r][e.c] = null;
  S.ents.splice(S.ents.indexOf(e), 1);
  scene.remove(e.obj);
  e.label.remove();
  // units still marching at it vanish with the path
  for (const u of S.units) {
    if (u.alive && u.to === e) {
      const p = unitPos(u);
      killUnit(u, false);
      burst(p.x, p.y + 0.15, p.z, 0xdddddd, 3, 0.4);
    }
  }
  const before = S.paths.length;
  S.paths = S.paths.filter((p) => p.from !== e && p.to !== e);
  S.spawns = S.spawns.filter((sp) => S.paths.includes(sp.path));
  if (S.paths.length !== before) rebuildPaths();
}

// ---------------------------------------------------------------- territory
// Union of a team's building zones, outlined with a dotted line in team colour.
const terrGroup = { blue: new THREE.Group(), red: new THREE.Group() };
scene.add(terrGroup.blue, terrGroup.red);
const terrKey = { blue: '', red: '' };
const terrGrow = { blue: 1, red: 1 };
const BORDER_INSET = 0.1;

function zoneCells(team) {
  const inside = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  for (const e of buildings(team)) {
    const R = zoneOf(e);
    for (let r = e.r - R; r <= e.r + R; r++) for (let c = e.c - R; c <= e.c + R; c++) {
      if (inBounds(c, r)) inside[r][c] = true;
    }
  }
  return inside;
}

function territorySegments(inside) {
  const at = (c, r) => inBounds(c, r) && inside[r][c];
  const d = BORDER_INSET;
  const segs = [];
  const sides = [[0, -1], [1, 0], [0, 1], [-1, 0]];   // outward normals: up, right, down, left
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (!inside[r][c]) continue;
    for (const [nx, nz] of sides) {
      if (at(c + nx, r + nz)) continue;
      const tx = -nz, tz = nx;   // tangent along the edge
      const ex = cx(c) + nx * (0.5 - d), ez = cz(r) + nz * (0.5 - d);
      const ends = [1, -1].map((s) => {
        // convex corner: pull the end in; concave corner: push it out to meet the next side
        let k = 0.5;
        if (!at(c + tx * s, r + tz * s)) k -= d;
        else if (at(c + tx * s + nx, r + tz * s + nz)) k += d;
        return [ex + tx * s * k, ez + tz * s * k];
      });
      const [[ax, az], [bx, bz]] = ends;
      segs.push(nz !== 0
        ? { h: true, k: ez, a: Math.min(ax, bx), b: Math.max(ax, bx) }
        : { h: false, k: ex, a: Math.min(az, bz), b: Math.max(az, bz) });
    }
  }
  // merge collinear neighbours so the dots run evenly along each side
  segs.sort((p, q) => (p.h - q.h) || (p.k - q.k) || (p.a - q.a));
  const out = [];
  for (const s of segs) {
    const last = out[out.length - 1];
    if (last && last.h === s.h && Math.abs(last.k - s.k) < 1e-6 && s.a <= last.b + 1e-6) last.b = Math.max(last.b, s.b);
    else out.push({ ...s });
  }
  return out;
}

function rebuildTerritory() {
  for (const team of ['blue', 'red']) {
    const inside = zoneCells(team);
    const key = inside.flat().map((b) => (b ? 1 : 0)).join('');
    if (key === terrKey[team]) continue;
    const count = (k) => [...k].filter((ch) => ch === '1').length;
    const grew = terrKey[team] !== '' && count(key) > count(terrKey[team]);
    terrKey[team] = key;
    disposeGroup(terrGroup[team]);
    const y = team === 'blue' ? 0.024 : 0.022;
    for (const s of territorySegments(inside)) {
      const g = s.h ? ribbon(s.a, s.k, s.b, s.k, 0.075, borderMat[team], y, 0.2) : ribbon(s.k, s.a, s.k, s.b, 0.075, borderMat[team], y, 0.2);
      terrGroup[team].add(g);
    }
    terrGrow[team] = grew ? 0 : 1;
    applyTerrGrow(team);
    if (team === 'blue' && grew) queueTip('territoryGrew');
  }
}
function applyTerrGrow(team) {
  const k = 1 - Math.pow(1 - Math.min(1, terrGrow[team]), 3);
  for (const g of terrGroup[team].children) g.scale.x = Math.max(0.001, k);
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
// mode 'ground': rocks, towers, buildings, water and mountains block. 'air': only mountains block.
function losClear(a, b, mode = 'ground') {
  if (mode === 'ground') {
    for (const e of S.ents) {
      if (e === a || e === b) continue;
      if (segHitsBox(a.x, a.z, b.x, b.z, e.x, e.z, BLOCK_HALF)) return false;
    }
  }
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const t = S.terrain[r][c];
    if (t === 'ground' || (t === 'water' && mode === 'air')) continue;
    if (segHitsBox(a.x, a.z, b.x, b.z, cx(c), cz(r), BLOCK_HALF)) return false;
  }
  return true;
}

// ---------------------------------------------------------------- paths
const findPath = (from, to) => S.paths.find((p) => p.from === from && p.to === to);
const outLinks = (e) => S.paths.filter((p) => p.from === e).length;
const partnerOf = (p) => isSender(p.from) && S.paths.find((q) => q.from === p.to && q.to === p.from && q.team !== p.team && isSender(q.from));

function checkConnect(team, from, to) {
  if (!from || !to || from === to) return { ok: false, silent: true };
  if (from.team !== team || !canSource(from)) return { ok: false, reason: 'Quarries don\'t send anything' };
  if (findPath(from, to)) return { ok: false, silent: true, reason: 'Already connected' };
  if (!inZone(from, to)) return { ok: false, reason: 'Outside its zone' };
  if (isArtillery(from)) {
    if (to.team === team && !isSender(to)) return { ok: false, reason: 'Artillery only boosts unit buildings' };
    if (outLinks(from) >= 1) return { ok: false, reason: 'One aim per artillery: tap its path to remove' };
    if (!losClear(from, to, 'air')) return { ok: false, reason: 'Mountains block the shot' };
    if (S.bricks[team] < PATH_COST) return { ok: false, reason: `Need ${PATH_COST} bricks`, broke: true };
    return { ok: true, verb: `${to.team === team ? 'Boost floors' : 'Aim here'}  −${PATH_COST}` };
  }
  if (outLinks(from) >= linkSlots(from)) return { ok: false, reason: linkSlots(from) < MAX_LINKS ? 'No free slot: add a floor' : `Max ${MAX_LINKS} paths` };
  if (!losClear(from, to, losMode(from))) {
    return { ok: false, reason: from.kind === 'heli' ? 'Mountains block helicopters' : 'Path blocked' };
  }
  if (S.bricks[team] < PATH_COST) return { ok: false, reason: `Need ${PATH_COST} bricks`, broke: true };
  let verb = 'Attack!';
  if (to.kind === 'rock') verb = 'Mine rock';
  else if (to.kind === 'flag') verb = 'Capture!';
  else if (to.team === team) {
    verb = { cannon: 'Load cannon', arrow: 'Load arrows', quarry: 'Supply quarry' }[to.kind] || 'Reinforce';
    if (isSender(to) && findPath(to, from)) verb = 'Reverse path';
  }
  return { ok: true, verb: `${verb}  −${PATH_COST}` };
}

function connect(team, from, to) {
  const chk = checkConnect(team, from, to);
  if (!chk.ok) return chk;
  if (to.team === team && isSender(from) && isSender(to)) {
    const rev = findPath(to, from);
    if (rev) S.paths.splice(S.paths.indexOf(rev), 1);
  }
  S.bricks[team] -= PATH_COST;
  const p = { id: S.nextId++, team, from, to, grow: 0 };
  S.paths.push(p);
  rebuildPaths();
  if (team === 'blue') pathCostFx(p);
  updateHud();
  return chk;
}

// Tapping a path during connect removes it (no refund).
function pathAt(gp) {
  let best = null, bd = 0.24;
  for (const p of S.paths) {
    if (p.team !== 'blue') continue;
    const q = pointSegDist(gp.x, gp.z, p.from.x, p.from.z, p.to.x, p.to.z);
    if (q.d < bd && q.t > 0.08 && q.t < 0.92) { bd = q.d; best = p; }
  }
  return best;
}
function removePath(p) {
  S.paths.splice(S.paths.indexOf(p), 1);
  S.spawns = S.spawns.filter((sp) => sp.path !== p);
  const mx = (p.from.x + p.to.x) / 2, mz = (p.from.z + p.to.z) / 2;
  burst(mx, 0.1, mz, 0xffffff, 8, 0.6);
  rebuildPaths();
  updateHud();
  toast('Path removed');
}

function rebuildPaths() {
  disposeGroup(pathGroup);
  S.paths.forEach((p, i) => {
    const dx = p.to.x - p.from.x, dz = p.to.z - p.from.z, D = Math.hypot(dx, dz);
    const ux = dx / D, uz = dz / D;
    const sx = p.from.x + ux * 0.3, sz = p.from.z + uz * 0.3;
    const clash = partnerOf(p);
    const endD = clash ? D / 2 : D - 0.36;
    const ex = p.from.x + ux * endD, ez = p.from.z + uz * endD;
    const y = 0.035 + (i % 8) * 0.002;
    const g = new THREE.Group();
    if (isArtillery(p.from)) g.add(ribbon(sx, sz, ex, ez, 0.13, aimMat[p.team], y, DOT_GAP * 0.8));
    else g.add(ribbon(sx, sz, ex, ez, 0.17, pathMat[p.team][losMode(p.from)], y, DOT_GAP));
    g.userData.path = p;
    p.mesh = g;
    applyGrow(p);
    pathGroup.add(g);
  });
  if (S.ents) S.ents.filter(isSender).forEach(refreshEntity);
}
function applyGrow(p) {
  const k = 1 - Math.pow(1 - Math.min(1, p.grow), 3);
  for (const r of p.mesh.children) r.scale.x = Math.max(0.001, k);
}

// Two bricks hop from the counter onto the new path and get laid into it.
function pathCostFx(p) {
  const pill = document.querySelector('.brick-pill');
  pill.classList.remove('spend'); void pill.offsetWidth; pill.classList.add('spend');
  const ar = app.getBoundingClientRect();
  const br = pill.querySelector('.brick').getBoundingClientRect();
  const sx = br.left + br.width / 2 - ar.left, sy = br.top + br.height / 2 - ar.top;
  for (let i = 0; i < PATH_COST; i++) {
    const k = (i + 1) / (PATH_COST + 1);
    const wx = p.from.x + (p.to.x - p.from.x) * k, wz = p.from.z + (p.to.z - p.from.z) * k;
    const el = document.createElement('i');
    el.className = 'brick flybrick';
    el.style.transform = `translate(${sx}px, ${sy}px) scale(.8)`;
    floatsEl.appendChild(el);
    setTimeout(() => {
      const d = toScreen(wx, 0.05, wz);
      el.style.transform = `translate(${d.x}px, ${d.y}px) scale(.55) rotate(${i ? 20 : -20}deg)`;
    }, 30 + i * 140);
    setTimeout(() => {
      el.remove();
      burst(wx, 0.08, wz, 0xea612c, 5, 0.45);
    }, 560 + i * 140);
  }
  const mx = (p.from.x + p.to.x) / 2, mz = (p.from.z + p.to.z) / 2;
  setTimeout(() => floatText(mx, 0.5, mz, `−${PATH_COST}${BRICK}`, 'cost', 1300), 620);
}

// ---------------------------------------------------------------- map generation
const terrainGroup = new THREE.Group();
scene.add(terrainGroup);

// Terrain is placed in the red half and mirrored through the board centre.
function generateTerrain(home) {
  const T = Array.from({ length: ROWS }, () => Array(COLS).fill('ground'));
  const mirror = (c, r) => [COLS - 1 - c, ROWS - 1 - r];
  const nearHome = (c, r) => [home.red, home.blue].some(([hc, hr]) => Math.abs(c - hc) <= 1 && Math.abs(r - hr) <= 1);
  const set = (c, r, t) => {
    if (!inBounds(c, r) || r >= HALF_ROWS || nearHome(c, r) || T[r][c] !== 'ground') return false;
    const [mc, mr] = mirror(c, r);
    if (nearHome(mc, mr) || (mc === c && mr === r)) return false;
    T[r][c] = t;
    T[mr][mc] = t;
    return true;
  };
  // one small water pool
  for (let tries = 0; tries < 20; tries++) {
    const c = Math.floor(Math.random() * COLS), r = 3 + Math.floor(Math.random() * (HALF_ROWS - 3));
    if (!set(c, r, 'water')) continue;
    if (r !== HALF_ROWS - 1 && Math.random() < 0.3) {
      const [dc, dr] = [[1, 0], [-1, 0], [0, 1]][Math.floor(Math.random() * 3)];
      set(c + dc, r + dr, 'water');
    }
    break;
  }
  // maybe one mountain
  if (Math.random() < 0.35) {
    for (let tries = 0; tries < 20; tries++) {
      if (set(Math.floor(Math.random() * COLS), 3 + Math.floor(Math.random() * (HALF_ROWS - 3)), 'mountain')) break;
    }
  }
  return T;
}

function buildTerrainMeshes() {
  for (const o of [...terrainGroup.children]) terrainGroup.remove(o);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const t = S.terrain[r][c];
    if (t === 'ground') continue;
    const m = t === 'water' ? M.makeWaterTile() : M.makeMountain(c * 1.7 + r);
    m.position.set(cx(c), 0, cz(r));
    m.scale.set(TILE, 1, TILE);
    terrainGroup.add(m);
  }
}

function generateMap() {
  const home = HOME;
  const mid = HALF_ROWS - 1;   // centre row, mirrors onto itself
  for (let attempt = 0; attempt < 400; attempt++) {
    S.grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    S.ents.forEach((e) => { scene.remove(e.obj); e.label.remove(); });
    S.ents = [];
    S.terrain = generateTerrain(home);
    const blue = addEntity('squad', 'blue', ...home.blue, START_HP);
    const red = addEntity('squad', 'red', ...home.red, START_HP);
    // mirrored pairs (same hp, same hidden building) keep the map fair
    for (let r = 0; r < HALF_ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (r === mid && c > (COLS - 1) / 2) continue;
      if (S.terrain[r][c] !== 'ground' || entityAt(c, r)) continue;
      const band = cheb(red, c, r) <= 1 ? 0 : r === mid ? 2 : 1;
      const roll = Math.random();
      let kind = null, hp = 0, hidden = null;
      if (roll < 0.38) {
        kind = 'rock';
        hp = 5 * ([2, 2, 3][band] + (band && Math.random() < 0.5 ? 1 : 0));   // 10 near home, up to 20 mid-board
      } else if (roll < 0.72) {
        kind = 'flag';
        hp = [5, 10, 15][band];
        hidden = rollKind();
      }
      if (!kind) continue;
      addEntity(kind, null, c, r, hp, hidden);
      const mc = COLS - 1 - c, mr = ROWS - 1 - r;
      if (!entityAt(mc, mr)) addEntity(kind, null, mc, mr, hp, hidden);
    }
    const chained = ensureUnitChain();
    // home zone: the squad, at least one flag tower and one rock; the rest is random
    let flags = 0, rocks = 0;
    for (let r = blue.r - 1; r <= blue.r + 1; r++) for (let c = blue.c - 1; c <= blue.c + 1; c++) {
      if (!inBounds(c, r) || (c === blue.c && r === blue.r)) continue;
      const e = entityAt(c, r);
      if (e && e.kind === 'flag') flags++;
      else if (e && e.kind === 'rock') rocks++;
    }
    const totalFlags = S.ents.filter((e) => e.kind === 'flag').length;
    let openMid = 0;
    for (let c = 0; c < COLS; c++) if (!entityAt(c, mid) && S.terrain[mid][c] === 'ground') openMid++;
    if (chained && flags >= 1 && flags <= 4 && rocks >= 1 && totalFlags >= 8 && openMid >= 1) break;
  }
  buildTerrainMeshes();
  S.ents.forEach(refreshEntity);
}

// Flag towers hiding unit buildings, chained zone to zone from the home base.
// Returns the zones (c, r, R) blue can eventually send units from.
function unitReach(team) {
  const home = buildings(team).find(isSender);
  if (!home) return [];
  const reach = [{ c: home.c, r: home.r, R: zoneOf(home) }];
  const used = new Set();
  for (let grew = true; grew;) {
    grew = false;
    for (const f of S.ents) {
      if (f.kind !== 'flag' || used.has(f) || GROUP_OF[f.hidden] !== 'unit') continue;
      if (reach.some((n) => cheb(n, f.c, f.r) <= n.R)) {
        reach.push({ c: f.c, r: f.r, R: ZONE[f.hidden] });
        used.add(f);
        grew = true;
      }
    }
  }
  return reach;
}

// Never leave a player boxed in: unit-building flag towers must chain from the
// home base across the centre row. Fix the map (mirrored) until they do.
function ensureUnitChain() {
  const mid = HALF_ROWS - 1;
  for (let guard = 0; guard < 12; guard++) {
    const reach = unitReach('blue');
    if (Math.min(...reach.map((n) => n.r - n.R)) < mid) return true;
    const cands = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (S.terrain[r][c] !== 'ground' || !reach.some((n) => cheb(n, c, r) <= n.R)) continue;
      const e = entityAt(c, r);
      if (e && (e.team || (e.kind === 'flag' && GROUP_OF[e.hidden] === 'unit'))) continue;
      cands.push({ c, r, pref: !e ? 1 : e.kind === 'flag' ? 0 : 2, k: Math.random() });
    }
    if (!cands.length) return false;
    // push toward the enemy; re-roll a flag first, then use an empty tile, rocks last
    cands.sort((a, b) => (a.r - b.r) || (a.pref - b.pref) || (a.k - b.k));
    const { c, r } = cands[0];
    const hidden = rollKind('unit');
    for (const [cc, rr] of [[c, r], [COLS - 1 - c, ROWS - 1 - r]]) {
      const e = entityAt(cc, rr);
      if (e && e.kind === 'flag') { e.hidden = hidden; continue; }
      if (e) removeEntity(e);
      const band = [HOME.blue, HOME.red].some(([hc, hr]) => Math.max(Math.abs(hc - cc), Math.abs(hr - rr)) <= 1) ? 0 : rr === mid ? 2 : 1;
      addEntity('flag', null, cc, rr, [5, 10, 15][band], hidden);
    }
  }
  return false;
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
function floatText(x, y, z, text, cls = '', life = 1000) {
  const p = toScreen(x, y, z);
  const el = document.createElement('div');
  el.className = 'float ' + cls;
  el.innerHTML = text;
  el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
  floatsEl.appendChild(el);
  setTimeout(() => el.remove(), life);
}
const BRICK = '<i class="brick"></i>';

let toastTimer = 0;
function toast(msg, ms = 1500) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
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
  const dealt = Math.min(amount, e.hp);
  e.hp -= dealt;
  e.bump = 1;
  const h = entHeight(e);
  if (e.kind !== 'flag') earn(team, dealt, e.x, h + 0.3, e.z);   // flag towers pay with a building, not bricks
  burst(e.x, h * 0.6, e.z, entColor(e), 3, 0.6);
  if (e.hp <= 0) destroy(e, team);
  else {
    if (isSender(e) && outLinks(e) > linkSlots(e)) {
      const mine = S.paths.filter((p) => p.from === e);
      for (const p of mine.slice(linkSlots(e))) S.paths.splice(S.paths.indexOf(p), 1);
      S.spawns = S.spawns.filter((sp) => S.paths.includes(sp.path));
      rebuildPaths();
    }
    refreshEntity(e);
  }
}

function destroy(e, byTeam) {
  const h = entHeight(e);
  burst(e.x, h / 2, e.z, entColor(e), 18, 1.3);
  burst(e.x, h / 2, e.z, 0x9a9ea6, 6, 1);
  shake = Math.max(shake, e.team ? 0.18 : 0.08);
  if (e.team && byTeam === 'blue') S.stats.destroyed++;
  if (e.team === 'blue') S.stats.lost++;
  const { c, r, kind, team, hidden } = e;
  removeEntity(e);
  if (kind === 'flag') {
    if (byTeam) unlock(hidden, byTeam, c, r, 'flag');
  } else if (kind === 'rock') {
    if (Math.random() < REVEAL_CHANCE) spawnFlag(c, r, START_HP, byTeam);
  } else if (team && byTeam && team !== byTeam && Math.random() < REVEAL_CHANCE) {
    unlock(rollKind(), byTeam, c, r, 'enemy');
  }
  rebuildTerritory();
  updateHud();
}

// A new building pops out of the rubble for `team`.
function unlock(kind, team, c, r, via) {
  const e = addEntity(kind, team, c, r, START_HP);
  e.pop = 1;
  burst(e.x, 0.3, e.z, M.TEAM[team].body, 14, 1.1);
  burst(e.x, 0.3, e.z, 0xffe066, 8, 0.9);
  shake = Math.max(shake, 0.12);
  const who = team === 'blue' ? (via === 'enemy' ? 'CAPTURED!' : 'UNLOCKED!') : 'CPU GOT';
  floatText(e.x, 1.1, e.z, `<span>${who}</span><b>${INFO[kind].name}</b>`, 'unlock ' + team, 1900);
  if (team === 'blue') {
    S.stats.unlocked++;
    queueTip('unlock:' + kind);
    if (via === 'enemy') queueTip('enemyCapture');
  }
  return e;
}

function spawnFlag(c, r, hp, byTeam, kind = rollKind()) {
  const e = addEntity('flag', null, c, r, hp, kind);
  e.pop = 1;
  burst(e.x, 0.2, e.z, 0xc4c8ce, 8, 0.7);
  floatText(e.x, 1.2, e.z, '?', 'reveal', 1100);
  if (byTeam === 'blue') queueTip('rockReveal');
  return e;
}

// n units' worth of supplies arriving at a friendly building
function friendlyDelivery(e, team, n = 1) {
  const h = entHeight(e);
  if (isSender(e)) {
    if (e.hp < MAX_HP) {
      const floorsBefore = floorsOf(e);
      e.hp = Math.min(MAX_HP, e.hp + n);
      e.bump = 0.6;
      if (team === 'blue' && isSender(e) && floorsOf(e) > floorsBefore) floatText(e.x, h + 0.4, e.z, '+1 floor', 'heal');
    }
  } else if (isArtillery(e)) {
    e.ammo += n;
    e.bump = 0.6;
    if (team === 'blue') floatText(e.x, h + 0.35, e.z, `+${n} ●`, 'heal');
  } else if (e.kind === 'quarry') {
    earn(team, QUARRY_YIELD * n, e.x, h + 0.3, e.z);
    e.bump = 0.6;
  }
  refreshEntity(e);
}

// ---------------------------------------------------------------- units
function spawnUnit(p) {
  const T = UNIT_TYPES[p.from.kind];
  const dx = p.to.x - p.from.x, dz = p.to.z - p.from.z, D = Math.hypot(dx, dz);
  const u = {
    type: T.unit, team: p.team, path: p, from: p.from, to: p.to, ux: dx / D, uz: dz / D, D, s: 0.4,
    hp: T.hp, maxHp: T.hp, dmg: T.dmg, speed: T.speed, alt: T.alt, gunRange: T.gunRange, cd: 0.3,
    alive: true, phase: Math.random() * 6,
  };
  const heading = Math.atan2(-u.uz, u.ux);
  if (u.type === 'soldier') {
    u.mesh = M.makeSoldier(p.team);
    u.mesh.scale.setScalar(1.3);
    u.mesh.rotation.y = heading + Math.PI / 2;
  } else if (u.type === 'tank') {
    u.mesh = M.makeTank(p.team);
    u.mesh.scale.setScalar(1.25);
    u.mesh.rotation.y = heading;
  } else {
    u.mesh = M.makeHeli(p.team);
    u.mesh.scale.setScalar(1.3);
    u.mesh.rotation.y = heading;
    u.shadow = M.makeBlobShadow(0.55);
    scene.add(u.shadow);
  }
  if (u.maxHp > 1) {
    u.label = document.createElement('div');
    u.label.className = 'ulbl ulbl-' + u.team;
    labelsEl.appendChild(u.label);
    refreshUnitLabel(u);
  }
  u.mesh.position.set(p.from.x + u.ux * u.s, u.alt, p.from.z + u.uz * u.s);
  scene.add(u.mesh);
  S.units.push(u);
}
function refreshUnitLabel(u) {
  if (!u.label) return;
  let html = '';
  for (let i = 0; i < u.maxHp; i++) html += `<i class="${i < u.hp ? 'on' : ''}"></i>`;
  u.label.innerHTML = html;
}
function unitPos(u) { return u.mesh.position; }
function killUnit(u, fx = true) {
  if (!u.alive) return;
  u.alive = false;
  scene.remove(u.mesh);
  if (u.shadow) scene.remove(u.shadow);
  if (u.label) u.label.remove();
  const p = unitPos(u);
  if (fx) burst(p.x, p.y + 0.15, p.z, M.TEAM[u.team].body, u.maxHp > 1 ? 12 : 4, u.maxHp > 1 ? 1 : 0.5);
  if (fx && u.maxHp > 1) shake = Math.max(shake, 0.06);
}
// Damaging units pays 1 brick per hp removed (soldier = 1, tank/heli = 5 in total).
function hurtUnit(u, n, byTeam) {
  if (!u.alive) return;
  const dealt = Math.min(n, u.hp);
  u.hp -= n;
  if (byTeam && dealt > 0) {
    const p = unitPos(u);
    earn(byTeam, dealt, p.x, p.y + 0.4, p.z);
  }
  if (u.hp <= 0) killUnit(u);
  else {
    refreshUnitLabel(u);
    const p = unitPos(u);
    burst(p.x, p.y + 0.2, p.z, 0xffe08a, 3, 0.4);
  }
}

// ---------------------------------------------------------------- projectiles
// Tracer from a tank/heli gun: homes on its target unit.
function fireBullet(u, target) {
  const mesh = new THREE.Mesh(M.box(0.07, 0.07, 0.07), M.mat(0xffd84a, { emissive: 0xffb000, emissiveIntensity: 0.6 }));
  const p = unitPos(u);
  mesh.position.set(p.x, p.y + 0.18, p.z);
  scene.add(mesh);
  S.projectiles.push({ kind: 'bullet', team: u.team, mesh, x0: p.x, y0: p.y + 0.18, z0: p.z, target, t: 0, dur: 0.25 });
}

// Straight shot from a tower. Cannon balls stop at the first thing in line,
// arrows pierce everything until a mountain or the board edge.
function fireShot(kind, src, tx, tz, aim = null) {
  let dx = tx - src.x, dz = tz - src.z;
  const L = Math.hypot(dx, dz) || 1;
  dx /= L; dz /= L;
  const turret = src.obj.userData.turret;
  if (turret) turret.rotation.y = Math.atan2(-dz, dx);
  let mesh;
  if (kind === 'ball') {
    mesh = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), M.mat(0x2a2d33));
  } else {
    mesh = new THREE.Group();
    mesh.add(new THREE.Mesh(M.box(0.36, 0.03, 0.03), M.mat(0x6b4522)));
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.08, 6), M.mat(0xc9ced6));
    tip.rotation.z = -Math.PI / 2;
    tip.position.x = 0.2;
    mesh.add(tip);
    mesh.rotation.y = Math.atan2(-dz, dx);
  }
  mesh.traverse((o) => { o.castShadow = true; });
  const y = kind === 'ball' ? 0.62 : 0.95;
  mesh.position.set(src.x, y, src.z);
  scene.add(mesh);
  S.projectiles.push({
    kind, mesh, team: src.team, src, x: src.x, z: src.z, y, dx, dz,
    speed: kind === 'ball' ? CANNON_SPEED : ARROW_SPEED,
    reach: zoneOf(src) + 0.5, hit: new Set(), aim: aim && aim.team === src.team ? aim : null,
  });
  src.bump = 0.5;
}

function pointSegDist(px, pz, x1, z1, x2, z2) {
  const dx = x2 - x1, dz = z2 - z1, L2 = dx * dx + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / L2));
  return { d: Math.hypot(px - (x1 + dx * t), pz - (z1 + dz * t)), t };
}
function segHitsMountain(x1, z1, x2, z2) {
  let best = null;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (S.terrain[r][c] !== 'mountain') continue;
    if (segHitsBox(x1, z1, x2, z2, cx(c), cz(r), 0.45)) {
      const t = pointSegDist(cx(c), cz(r), x1, z1, x2, z2).t;
      if (!best || t < best) best = t;
    }
  }
  return best;
}

function updateProjectiles(dt) {
  const hw = COLS / 2 + 0.2, hh = ROWS / 2 + 0.2;
  for (let i = S.projectiles.length - 1; i >= 0; i--) {
    const pr = S.projectiles[i];
    if (pr.kind === 'bullet') {
      pr.t += dt / pr.dur;
      const k = Math.min(1, pr.t);
      const tp = unitPos(pr.target);
      pr.mesh.position.set(pr.x0 + (tp.x - pr.x0) * k, pr.y0 + (tp.y + 0.15 - pr.y0) * k, pr.z0 + (tp.z - pr.z0) * k);
      if (pr.t >= 1) {
        scene.remove(pr.mesh);
        S.projectiles.splice(i, 1);
        hurtUnit(pr.target, 1, pr.team);
      }
      continue;
    }
    const step = pr.speed * dt;
    const x1 = pr.x, z1 = pr.z, x2 = x1 + pr.dx * step, z2 = z1 + pr.dz * step;
    // everything the shot could hit along this step, ordered by distance
    const hits = [];
    for (const u of S.units) {
      if (!u.alive || u.team === pr.team || pr.hit.has(u)) continue;
      const q = pointSegDist(u.mesh.position.x, u.mesh.position.z, x1, z1, x2, z2);
      if (q.d < 0.22) hits.push({ t: q.t, unit: u });
    }
    for (const e of S.ents) {
      if ((e.team === pr.team && e !== pr.aim) || e === pr.src || pr.hit.has(e) || !inZone(pr.src, e)) continue;
      if (segHitsBox(x1, z1, x2, z2, e.x, e.z, BLOCK_HALF)) hits.push({ t: pointSegDist(e.x, e.z, x1, z1, x2, z2).t, ent: e });
    }
    const wall = segHitsMountain(x1, z1, x2, z2);
    hits.sort((a, b) => a.t - b.t);
    let stop = false;
    for (const h of hits) {
      if (wall !== null && h.t > wall) break;
      pr.hit.add(h.unit || h.ent);
      if (h.unit) hurtUnit(h.unit, 1, pr.team);
      else if (h.ent.team === pr.team) boost(h.ent, pr.team);
      else damage(h.ent, pr.kind === 'ball' ? CANNON_DMG : 1, pr.team);
      if (pr.kind === 'ball') { stop = true; break; }
    }
    pr.x = x2; pr.z = z2;
    pr.mesh.position.set(x2, pr.y, z2);
    if (wall !== null) stop = true;
    // arrows pierce, but only until they leave the tower's zone
    if (Math.abs(x2) > hw || Math.abs(z2) > hh || Math.max(Math.abs(x2 - pr.src.x), Math.abs(z2 - pr.src.z)) > pr.reach) stop = true;
    if (stop) {
      scene.remove(pr.mesh);
      S.projectiles.splice(i, 1);
      // arrows snap apart at the end of their range
      if (pr.kind === 'ball') burst(x2, pr.y, z2, 0x3a3d44, 5, 0.7);
      else { burst(x2, pr.y, z2, 0x8a5a2b, 5, 0.6); burst(x2, pr.y, z2, 0xe8e0cc, 2, 0.5); }
    }
  }
}

// A friendly unit building hit by an aimed shot gains 1 hp (floors every 5).
function boost(e, team) {
  if (e.hp >= MAX_HP) return;
  const before = floorsOf(e);
  e.hp += 1;
  e.bump = 0.6;
  burst(e.x, entHeight(e), e.z, 0x8fe3ff, 3, 0.5);
  if (team === 'blue' && floorsOf(e) > before) floatText(e.x, entHeight(e) + 0.4, e.z, '+1 floor', 'heal');
  refreshEntity(e);
}

// Artillery fires at its aimed target if it has one. Otherwise: the nearest
// enemy unit in its zone, then whatever is nearest (never your own buildings).
function towerTarget(src) {
  const aim = S.paths.find((p) => p.from === src);
  if (aim && aim.to.alive) return aim.to;
  const R = zoneOf(src);
  let best = null, bd = Infinity;
  for (const u of S.units) {
    if (!u.alive || u.team === src.team) continue;
    const p = unitPos(u);
    if (Math.max(Math.abs(p.x - src.x), Math.abs(p.z - src.z)) > R + 0.5) continue;
    const d = Math.hypot(p.x - src.x, p.z - src.z);
    if (d < bd && losClear(src, p, 'air')) { bd = d; best = { x: p.x, z: p.z }; }
  }
  if (best) return best;
  for (const e of S.ents) {
    if (e.team === src.team || !inZone(src, e)) continue;
    const d = dist(src, e);
    if (d < bd && losClear(src, e, 'air')) { bd = d; best = e; }
  }
  return best;
}

function updateBattle(dt) {
  if (S.battleHold > 0) { S.battleHold -= dt; return; }
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
    u.s += u.speed * dt;
    const x = u.from.x + u.ux * u.s, z = u.from.z + u.uz * u.s;
    let y = u.alt;
    if (u.type === 'soldier') {
      y = Math.abs(Math.sin(u.s * 11 + u.phase)) * 0.04;
      const sw = Math.sin(u.s * 22 + u.phase) * 0.5;
      u.mesh.userData.legs[0].rotation.x = sw;
      u.mesh.userData.legs[1].rotation.x = -sw;
    } else if (u.type === 'tank') {
      y = Math.abs(Math.sin(u.s * 30)) * 0.01;
    } else {
      y = u.alt + Math.sin(S.battleT * 3 + u.phase) * 0.05;
      u.mesh.userData.rotor.rotation.y += dt * 30;
      u.shadow.position.set(x, 0.03, z);
    }
    u.mesh.position.set(x, y, z);
  }
  // vehicle guns shoot enemy units on their own path ahead of them
  // (tanks: any unit up to 2 tiles; helis: ground units only)
  for (const u of S.units) {
    if (!u.alive || !u.gunRange) continue;
    u.cd -= dt;
    if (u.cd > 0) continue;
    let best = null, bd = u.gunRange;
    const p = unitPos(u);
    for (const o of S.units) {
      if (!o.alive || o.team === u.team) continue;
      if (u.type === 'heli' && o.type === 'heli') continue;
      const rx = o.mesh.position.x - p.x, rz = o.mesh.position.z - p.z;
      const along = rx * u.ux + rz * u.uz;
      const across = Math.abs(rx * u.uz - rz * u.ux);
      if (along < -0.15 || across > 0.45) continue;
      if (along < bd) { bd = along; best = o; }
    }
    if (!best) continue;
    u.cd = GUN_RATE;
    if (u.type === 'tank') {
      const a = Math.atan2(-(best.mesh.position.z - p.z), best.mesh.position.x - p.x);
      u.mesh.userData.turret.rotation.y = a - u.mesh.rotation.y;
    }
    fireBullet(u, best);
  }
  // head-on clashes on opposing links: front units trade hit points
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
      const k = Math.min(b.hp, r.hp);
      const pos = unitPos(b);
      burst(pos.x, pos.y + 0.2, pos.z, 0xffe08a, 5, 0.7);
      hurtUnit(b, k, r.team);
      hurtUnit(r, k, b.team);
    }
  }
  // arrivals
  for (const u of S.units) {
    if (!u.alive || u.s < u.D - 0.46) continue;
    const t = u.to;
    const pos = unitPos(u).clone();
    killUnit(u, false);
    if (!t.alive) { burst(pos.x, 0.15, pos.z, 0xcccccc, 3, 0.4); continue; }
    if (t.team === u.team) friendlyDelivery(t, u.team, u.dmg);
    else damage(t, u.dmg, u.team);
  }
  S.units = S.units.filter((u) => u.alive);

  // artillery: one shot per point of ammo
  for (const e of [...S.ents]) {
    if (!e.alive || !isArtillery(e)) continue;
    e.cd -= dt;
    if (e.cd > 0 || e.ammo <= 0) continue;
    const tgt = towerTarget(e);
    if (!tgt) continue;
    e.ammo--;
    e.cd = e.kind === 'cannon' ? CANNON_RATE : ARROW_RATE;
    fireShot(e.kind === 'cannon' ? 'ball' : 'arrow', e, tgt.x, tgt.z, tgt.alive !== undefined ? tgt : null);
    refreshEntity(e);
  }
  updateProjectiles(dt);
  S.units = S.units.filter((u) => u.alive);

  const cannonsBusy = S.ents.some((e) => isArtillery(e) && e.ammo > 0 && towerTarget(e));
  const busy = S.spawns.length || S.units.length || S.projectiles.length || cannonsBusy;
  if (!busy) {
    S.settle += dt;
    if (S.settle > 1.1) endBattle();
  } else S.settle = 0;
}

// ---------------------------------------------------------------- CPU
function cpuConnect() {
  const team = 'red';
  const maxNew = Math.min(Math.floor(S.bricks.red / PATH_COST), 2 + Math.floor(S.round / 3));
  const cands = [];
  for (const src of buildings(team).filter(isSender)) {
    const heavy = src.kind !== 'squad';
    for (const t of S.ents) {
      if (t === src || findPath(src, t)) continue;
      if (!inZone(src, t) || !losClear(src, t, losMode(src))) continue;
      let score;
      if (t.kind === 'flag') {
        score = 16 + Math.max(0, 15 - t.hp) * 0.3 + (S.paths.some((p) => p.team === 'blue' && p.to === t) ? 3 : 0);
      } else if (t.kind === 'rock') {
        score = 6 + (t.hp <= 5 ? 3 : 0) - t.hp * 0.1 + (S.bricks.red < 4 ? 3 : 0) + (heavy && t.hp >= 10 ? 2 : 0);
      } else if (t.team !== team) {
        score = 14 + Math.max(0, 20 - t.hp) * 0.3 + (isSender(t) ? 2 : 0) + (heavy ? 3 : 0);
        if (findPath(t, src)) score += 5;  // meet the attack head-on
      } else {
        if (findPath(t, src)) continue;
        if (isArtillery(t)) score = towerTarget(t) ? 10 : 1;
        else if (t.kind === 'quarry') score = 8;
        else score = t.hp < 10 ? 5 : 0.5;
      }
      cands.push({ src, t, score: score + Math.random() * 3 });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  let made = 0;
  for (const c of cands) {
    if (made >= maxNew) break;
    if (c.score < 2) break;
    if (connect(team, c.src, c.t).ok) made++;
  }
}

// ---------------------------------------------------------------- phases
function startMatch() {
  for (const e of S ? [...S.ents] : []) { scene.remove(e.obj); e.label.remove(); }
  for (const u of S ? S.units : []) killUnit(u, false);
  for (const p of S ? S.projectiles : []) scene.remove(p.mesh);
  cancelDrag();
  S = newState();
  terrKey.blue = terrKey.red = '';
  generateMap();
  rebuildPaths();
  rebuildTerritory();
  startConnect();
}

function startConnect() {
  S.phase = 'connect';
  S.timer = PHASE_TIME;
  if (S.round > 1 && S.bricks.blue < PATH_COST) queueTip('broke');
  showBanner('ARRANGE', S.round === 1 ? 'Connect your buildings' : `Round ${S.round} • draw paths, then READY`);
  updateHud();
}
function endConnect() {
  cancelDrag();
  cpuConnect();
  startBattle();
}

function startBattle() {
  S.phase = 'battle';
  S.battleHold = 1.3;
  showBanner('BATTLE!', 'Units attack', 'battle');
  S.battleT = 0;
  S.settle = 0;
  S.earned = 0;
  S.spawns = [];
  for (const p of S.paths) {
    if (!isSender(p.from)) continue;   // artillery aim lines carry no units
    const n = unitsPerTurn(p.from);
    for (let i = 0; i < n; i++) S.spawns.push({ path: p, t: 0.4 + i * UNIT_TYPES[p.from.kind].gap });
  }
  if (S.paths.some((p) => p.team === 'blue')) queueTip('firstBattle', 1700);
  updateHud();
}

function endBattle() {
  S.units.forEach((u) => killUnit(u, false));
  S.units = [];
  const b = buildings('blue').length, r = buildings('red').length;
  if (b === 0 || r === 0 || S.round >= MAX_ROUNDS) {
    let win;
    if (b === 0 || r === 0) win = b > 0;
    else if (b !== r) win = b > r;
    else win = buildings('blue').reduce((s, e) => s + e.hp, 0) >= buildings('red').reduce((s, e) => s + e.hp, 0);
    S.phase = 'over';
    updateHud();
    setTimeout(() => showResult(win, b, r), 600);
    return;
  }
  // battle income for both sides
  for (const team of ['blue', 'red']) S.bricks[team] += BATTLE_INCOME;
  const home = buildings('blue')[0];
  if (home) floatText(home.x, entHeight(home) + 0.5, home.z, `INCOME +${BATTLE_INCOME}${BRICK}`, 'heal', 1600);
  const pill = document.querySelector('.brick-pill');
  pill.classList.remove('bump'); void pill.offsetWidth; pill.classList.add('bump');
  S.round++;
  startConnect();
}

function endPhase() {
  if (S.phase === 'connect') endConnect();
}
goBtn.addEventListener('click', () => { if (S && !S.paused) endPhase(); });

// ---------------------------------------------------------------- HUD
const PHASE_NAME = { connect: 'CONNECT', battle: 'BATTLE', over: 'GAME OVER', intro: 'READY' };
let lastTimerText = '';
function updateHud() {
  if (!S) return;
  $('phasePill').textContent = `${S.round} • ${PHASE_NAME[S.phase]}`;
  $('brickCount').textContent = S.bricks.blue;
  $('blueCount').textContent = buildings('blue').length;
  $('redCount').textContent = buildings('red').length;
  const connecting = S.phase === 'connect';
  const hasPath = S.paths.some((p) => p.team === 'blue');
  // first turn: READY only shows up once you've drawn a path
  const ready = connecting && (S.round > 1 || hasPath);
  goBtn.classList.toggle('show', ready);
  goBtn.classList.toggle('pulse', ready && S.round === 1);
  modePill.className = 'mode-pill';
  if (S.phase === 'battle') { modePill.textContent = '⚔ BATTLE'; modePill.classList.add('show', 'battle'); }
  else if (connecting && !ready) { modePill.textContent = 'DRAW A PATH'; modePill.classList.add('show', 'hint'); }
  app.classList.toggle('mode-battle', S.phase === 'battle');
  $('phasePill').classList.toggle('battle', S.phase === 'battle');
  updateTimer();
}

// Big ribbon across the board when the mode changes. Waits for any open popup.
let pendingBanner = null;
function showBanner(title, sub, cls = '') {
  if (modal.classList.contains('open')) { pendingBanner = [title, sub, cls]; return; }
  pendingBanner = null;
  bannerEl.querySelector('b').textContent = title;
  bannerEl.querySelector('span').textContent = sub;
  bannerEl.className = 'banner ' + cls;
  void bannerEl.offsetWidth;
  bannerEl.classList.add('show');
}
bannerEl.addEventListener('animationend', () => bannerEl.classList.remove('show'));
function updateTimer() {
  let t;
  if (S.phase === 'connect') t = S.round === 1 ? 'CONNECT • NO RUSH' : `CONNECT • ${Math.ceil(S.timer)}s`;
  else if (S.phase === 'battle') t = `BATTLE • +${S.earned}`;
  else t = `ROUND ${S.round} / ${MAX_ROUNDS}`;
  if (t !== lastTimerText) {
    $('timerText').innerHTML = S.phase === 'battle' ? `${t} ${BRICK}` : t;
    lastTimerText = t;
    document.querySelector('.timer-pill').classList.toggle('hurry', S.phase === 'connect' && S.round > 1 && S.timer <= 5);
  }
}

// ---------------------------------------------------------------- icons (rendered from the real models)
const ICON_KINDS = ['squad', 'tank', 'heli', 'cannon', 'arrow', 'quarry', 'flag', 'rock'];
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
  for (const kind of ICON_KINDS) {
    const model = M.makeModel(kind, 'blue');
    sc.add(model);
    const h = model.userData.getHeight ? model.userData.getHeight() : 0.65;
    const look = new THREE.Vector3(0.04, h * 0.45, 0);
    const d = 1.75 + h * 0.75;
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
let icons = {};

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
function pickEntity(ev, meshOnly = false) {
  setRay(ev);
  const hits = raycaster.intersectObjects(S.ents.map((e) => e.obj), true);
  for (const h of hits) {
    let o = h.object;
    while (o && !o.userData.ent) o = o.parent;
    if (o && o.userData.ent.alive) return o.userData.ent;
  }
  if (meshOnly) return null;
  const cell = cellAt(groundPoint(ev));
  return cell ? entityAt(cell.c, cell.r) : null;
}

let drag = null;

function showBubble(text, x, y, cls = '') {
  bubble.textContent = text;
  bubble.className = 'bubble ' + cls;
  const half = bubble.offsetWidth / 2 + 6;
  x = Math.min(app.clientWidth - half, Math.max(half, x));
  bubble.style.transform = `translate(${x}px, ${y}px) translate(-50%, ${cls.includes('below') ? 0 : -100}%)`;
}
function hideBubble() { bubble.classList.add('hidden'); }
function appXY(ev) {
  const r = app.getBoundingClientRect();
  return { x: ev.clientX - r.left, y: ev.clientY - r.top };
}

function describe(e) {
  if (e.kind === 'flag') return 'Locked building: break it to unlock it';
  if (e.kind === 'rock') return 'Rock: every hit = +1 brick';
  const who = e.team === 'blue' ? '' : 'CPU ';
  return `${who}${INFO[e.kind].name}: ${INFO[e.kind].line}`;
}

// valid targets light up while dragging from a sender
function showTargets(src) {
  hideMarkers();
  let i = 0;
  for (const t of S.ents) {
    if (t === src) continue;
    const chk = checkConnect('blue', src, t);
    if (!chk.ok && !chk.broke) continue;
    const color = t.kind === 'flag' ? 0xffe066 : t.team === 'blue' ? 0x7fd0ff : t.team === 'red' ? 0xff8a8a : 0xffffff;
    showMarker(i++, t.c, t.r, color, false, 0.85);
  }
  showMarker(i++, src.c, src.r, 0x7fd0ff, false, 1);
}

canvas.addEventListener('pointerdown', (ev) => {
  if (!S || S.paused) return;
  const hit = pickEntity(ev, true);
  const onPath = S.phase === 'connect' && !hit ? pathAt(groundPoint(ev)) : null;
  const e = hit || (onPath ? null : pickEntity(ev));
  if (S.phase === 'connect' && e && e.team === 'blue' && canSource(e)) {
    drag = { type: 'connect', src: e, id: ev.pointerId };
    showZone(e);
    showTargets(e);
    e.bump = 0.5;
    return;
  }
  if (e && e.team && S.phase !== 'over') {
    // peek at any building's zone
    drag = { type: 'peek', id: ev.pointerId };
    showZone(e, e.team === 'blue' ? 0xffffff : 0xffb0b0);
    toast(describe(e), 2200);
    return;
  }
  if (S.phase === 'connect') {
    // swipe across your own paths to cut them (a tap describes what's there)
    const gp = groundPoint(ev);
    drag = { type: 'cut', start: gp, last: gp, cut: 0, id: ev.pointerId, ent: e, path: onPath, x: ev.clientX, y: ev.clientY };
  } else if (e) {
    toast(describe(e), 2200);
  }
});

window.addEventListener('pointermove', (ev) => {
  if (!drag || ev.pointerId !== drag.id) return;
  if (drag.type === 'connect') moveConnect(ev);
  else if (drag.type === 'cut') moveCut(ev);
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
    setDragLine(src.x, src.z, tgt.x, tgt.z, color, isArtillery(src) ? 'air' : losMode(src));
    const sp = toScreen(tgt.x, entHeight(tgt) + 0.35, tgt.z);
    showBubble(chk.ok ? chk.verb : (chk.reason || 'Cancel'), sp.x, sp.y - 8, chk.ok ? 'good' : 'bad');
  } else {
    drag.tgt = null;
    const cell = cellAt(gp);
    const far = !cell || cheb(src, cell.c, cell.r) > zoneOf(src);
    setDragLine(src.x, src.z, gp.x, gp.z, far ? 0xff5a5a : 0xffffff, losMode(src));
    showBubble(far ? 'Outside its zone' : 'Drag to a target', p.x, p.y - 34, far ? 'bad' : '');
  }
}

function segsCross(ax, az, bx, bz, cx1, cz1, dx1, dz1) {
  const o = (px, pz, qx, qz, rx, rz) => Math.sign((qx - px) * (rz - pz) - (qz - pz) * (rx - px));
  return o(ax, az, bx, bz, cx1, cz1) !== o(ax, az, bx, bz, dx1, dz1)
    && o(cx1, cz1, dx1, dz1, ax, az) !== o(cx1, cz1, dx1, dz1, bx, bz);
}

function moveCut(ev) {
  const gp = groundPoint(ev);
  const a = drag.last;
  setDragLine(drag.start.x, drag.start.z, gp.x, gp.z, 0xff5a5a);
  let changed = false;
  for (const p of [...S.paths]) {
    if (p.team !== 'blue') continue;
    if (!segsCross(a.x, a.z, gp.x, gp.z, p.from.x, p.from.z, p.to.x, p.to.z)) continue;
    S.paths.splice(S.paths.indexOf(p), 1);
    drag.cut++;
    changed = true;
    burst(gp.x, 0.1, gp.z, 0xffffff, 6, 0.6);
  }
  if (changed) { rebuildPaths(); updateHud(); }
  drag.last = gp;
}

window.addEventListener('pointerup', (ev) => {
  if (!drag || ev.pointerId !== drag.id) return;
  const d = drag;
  if (d.type === 'connect') {
    if (d.tgt) {
      const res = connect('blue', d.src, d.tgt);
      if (res.ok) {
        if (!seen('firstPath')) { markSeen('firstPath'); queueTip('afterFirstPath'); }
      } else if (res.reason && !res.silent) {
        toast(res.reason);
        if (res.broke) queueTip('broke');
      }
    }
  } else if (d.type === 'cut') {
    const tap = Math.hypot(ev.clientX - d.x, ev.clientY - d.y) < 10;
    if (d.cut) toast(`${d.cut} path${d.cut > 1 ? 's' : ''} cut`);
    else if (tap && d.path && S.paths.includes(d.path)) removePath(d.path);
    else if (tap && d.ent) toast(describe(d.ent), 2200);
  }
  cancelDrag();
});
window.addEventListener('pointercancel', () => cancelDrag());

function cancelDrag() {
  drag = null;
  setDragLine(null);
  hideZone();
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
  const top = $('hudRow2').getBoundingClientRect().bottom - appTop + 2;
  const bottom = h - 10;
  const availW = w - 6, availH = bottom - top;
  const hw = COLS / 2 + 0.12, hh = ROWS / 2 + 0.12;
  const pts = [[-hw, 0, -hh], [hw, 0, -hh], [-hw, 0, hh], [hw, 0, hh], [-hw * 0.6, 1.1, -hh + 0.5], [hw * 0.6, 1.1, -hh + 0.5]];
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
  camera.updateMatrixWorld();
  // labels scale with the on-screen size of a cell
  const a = toScreen(-0.5, 0, 0), c = toScreen(0.5, 0, 0);
  app.style.setProperty('--k', Math.max(0.85, Math.min(1.6, (c.x - a.x) / 62)).toFixed(3));
}
window.addEventListener('resize', fitCamera);

// ---------------------------------------------------------------- per-frame
function updateLabels() {
  for (const e of S.ents) {
    // rocks: number on the top face; flag towers: a sign on the tower; buildings: just above the roof
    const rock = e.kind === 'rock' || e.kind === 'flag';
    const p = toScreen(e.x, rock ? 0.62 * MODEL_SCALE : entHeight(e) + 0.08, e.z);
    e.label.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, ${rock ? -50 : -100}%)`;
  }
  for (const u of S.units) {
    if (!u.alive || !u.label) continue;
    const m = u.mesh.position;
    const p = toScreen(m.x, m.y + 0.5, m.z);
    u.label.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%)`;
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
    e.obj.scale.set(sx * MODEL_SCALE, sy * MODEL_SCALE, sx * MODEL_SCALE);
    if (e.kind === 'arrow' && S.phase !== 'battle') e.obj.userData.turret.rotation.y += dt * 0.6;
    if (e.kind === 'flag') e.obj.userData.flag.rotation.y = Math.sin(time * 2.6 + e.id) * 0.35;
    const roof = e.obj.userData.roof;
    if (roof && roof.userData.rotor) roof.userData.rotor.rotation.y += dt * 4;
  }
}

// Coach hand: until the first path is drawn, show the drag from home to a flag tower.
function hintPair() {
  for (const src of buildings('blue').filter(isSender)) {
    if (outLinks(src) >= linkSlots(src)) continue;
    const ok = (t) => !findPath(src, t) && inZone(src, t) && losClear(src, t, losMode(src));
    const t = S.ents.filter((t) => t.kind === 'flag' && ok(t)).sort((a, b) => a.hp - b.hp)[0]
      || S.ents.filter((t) => t.kind === 'rock' && ok(t)).sort((a, b) => a.hp - b.hp)[0];
    if (t) return { src, t };
  }
  return null;
}
let hintOn = false;
function updateHand(time) {
  const first = S.round === 1 && S.phase === 'connect' && !drag && !S.paused;
  const hasPath = S.paths.some((p) => p.team === 'blue');
  if (first && hasPath && goBtn.offsetParent) {
    // point up at READY with a little tap bob
    hintOn = true;
    const ar = app.getBoundingClientRect(), br = goBtn.getBoundingClientRect();
    const x = br.left + br.width / 2 - ar.left, y = br.bottom - ar.top;
    const bob = Math.abs(Math.sin(time * 4)) * 10;
    hand.classList.remove('hidden');
    hand.style.opacity = 1;
    hand.style.transform = `translate(${x - 14}px, ${y + 2 + bob}px)`;
    showBubble('Tap READY to start the battle', x, y + 62, 'below');
    return;
  }
  const pair = first && !hasPath && S.bricks.blue >= PATH_COST && hintPair();
  if (!pair) {
    hand.classList.add('hidden');
    if (hintOn && !drag) hideBubble();
    hintOn = false;
    return;
  }
  hintOn = true;
  const { src, t } = pair;
  const k = (time % 2.2) / 2.2;
  const e = Math.min(1, Math.max(0, (k - 0.15) / 0.6));
  const ease = e * e * (3 - 2 * e);
  const a = toScreen(src.x, 0.4, src.z), b = toScreen(t.x, 0.4, t.z);
  hand.classList.remove('hidden');
  hand.style.opacity = k > 0.88 ? (1 - (k - 0.88) / 0.12) : 1;
  hand.style.transform = `translate(${a.x + (b.x - a.x) * ease - 14}px, ${a.y + (b.y - a.y) * ease - 4}px)`;
  const bp = toScreen(t.x, entHeight(t) + 0.45, t.z);
  showBubble(t.kind === 'flag' ? 'Drag here to capture it!' : 'Drag to a rock to mine it', bp.x, bp.y - 6);
}

let last = performance.now();
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
    if (S.phase === 'connect') {
      if (S.round > 1) S.timer -= dt;   // first turn waits for you
      if (S.timer <= 0) endPhase();
      else updateTimer();
    } else if (S.phase === 'battle') {
      updateBattle(dt);
    }
  }
  if (S) {
    for (const p of S.paths) if (p.grow < 1) { p.grow = Math.min(1, p.grow + dt * 4); applyGrow(p); }
    for (const team of ['blue', 'red']) if (terrGrow[team] < 1) { terrGrow[team] = Math.min(1, terrGrow[team] + dt * 2); applyTerrGrow(team); }
    animateEntities(dt, time);
    updateLabels();
    updateHand(time);
    pumpTips();
  }
  dotTex.ground.offset.x -= dt * 1.2;
  dotTex.air.offset.x -= dt * 1.2;
  M.waterTex.offset.x += dt * 0.05;
  M.waterTex.offset.y += dt * 0.03;
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
let slideNav = null;   // swipe handler for the open slide deck
function openModal(html, cls = '') {
  modalBox.className = 'modal-box ' + cls;
  modalBox.innerHTML = html;
  modal.classList.add('open');
  slideNav = null;
  if (S) S.paused = true;
  cancelDrag();
}
function closeModal() {
  modal.classList.remove('open');
  slideNav = null;
  if (S) S.paused = false;
  if (pendingBanner) showBanner(...pendingBanner);
}
let swipeX = null;
modalBox.addEventListener('pointerdown', (ev) => { swipeX = ev.clientX; });
modalBox.addEventListener('pointerup', (ev) => {
  if (swipeX == null || !slideNav) return;
  const dx = ev.clientX - swipeX;
  swipeX = null;
  if (Math.abs(dx) > 40) slideNav(dx < 0 ? 1 : -1);
});

const img = (kind, cls = '') => `<img class="${cls}" src="${icons[kind]}" alt="">`;

// little board sketch: a building, its 3×3 zone in blue dots, flag towers around it
function zoneArt() {
  const s = 27, g = 3, o = 3;
  const at = (i) => o + i * (s + g);
  let cells = '';
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
    cells += `<rect x="${at(c)}" y="${at(r)}" width="${s}" height="${s}" rx="5" fill="${(r + c) % 2 ? '#f3993f' : '#f6a24b'}"/>`;
  }
  const z0 = at(1) + 3, z1 = at(4) - g - 3;
  return `<svg viewBox="0 0 150 150">${cells}
    <rect x="${z0}" y="${z0}" width="${z1 - z0}" height="${z1 - z0}" rx="6" fill="rgba(47,128,255,.12)" stroke="#2f80ff" stroke-width="4.5" stroke-dasharray="0.1 9" stroke-linecap="round"/>
    <image href="${icons.squad}" x="${at(2) - 12}" y="${at(2) - 16}" width="52" height="52"/>
    <image href="${icons.flag}" x="${at(3) - 6}" y="${at(1) - 12}" width="40" height="40"/>
    <image href="${icons.flag}" x="${at(0) - 6}" y="${at(3) - 12}" width="40" height="40"/>
    <image href="${icons.rock}" x="${at(1) - 4}" y="${at(3) - 8}" width="36" height="36"/>
  </svg>`;
}

function introSlides(withGuide) {
  const slides = [
    {
      eyebrow: 'HOW IT WORKS • 1',
      art: zoneArt(),
      title: 'This is your land',
      text: `Every building claims the squares around it. The <b>blue dotted line</b> marks your land. A building can only reach what's inside its own square.`,
    },
    {
      eyebrow: 'HOW IT WORKS • 2',
      art: `${img('flag')}<span class="arrow">➜</span><span class="q">?</span>`,
      title: 'Capture flag towers',
      text: `Grey <b>flag towers</b> hide a random building. Drag from your building to one and your units break it. Whatever was inside becomes <b>yours</b>, and your land grows.`,
    },
    {
      eyebrow: 'HOW IT WORKS • 3',
      art: `<div class="cost">${BRICK}<span>× ${PATH_COST}</span></div>`,
      title: 'Paths cost bricks',
      text: `You start with <b>${START_BRICKS} ${BRICK}</b>. Each new path costs <b>${PATH_COST} ${BRICK}</b> and keeps working every battle until its target falls. After every battle you get <b>+${BATTLE_INCOME} ${BRICK}</b>.`,
    },
    {
      eyebrow: 'HOW IT WORKS • 4',
      art: `${img('rock')}<span class="arrow">➜</span><div class="cost"><span>+1</span>${BRICK}</div>`,
      title: 'Mine rocks for bricks',
      text: `Connect to <b>rocks</b> to mine them: every hit earns <b>+1 ${BRICK}</b>. Hitting enemies pays too. Flag towers pay nothing, but they give you a building.`,
    },
  ];
  if (withGuide) {
    slides.push({
      eyebrow: 'BUILDINGS',
      art: '',
      title: 'What can you find?',
      html: `<div class="guide">${Object.keys(INFO).map((k) => `
        <div class="g">${img(k)}<div class="t"><b>${INFO[k].name}</b><em class="${RARITY[k]}">${GROUP_OF[k].toUpperCase()} • ${RARITY[k].toUpperCase()}</em><br>${INFO[k].line} Zone ${zoneSize(k)}.</div></div>`).join('')}
        </div><p class="modal-copy"><b>Artillery</b> only fires ammo your unit buildings bring it. Drag from it to aim, even at your own unit building to add floors. Send units to your own unit building for <b>+1 floor = +1 path</b>. Destroyed enemy buildings may turn into yours.</p>`,
    });
  }
  return slides;
}

function showSlides(slides, doneLabel, done, extra = '', bind = null) {
  let i = 0;
  const render = () => {
    const s = slides[i];
    const lastSlide = i === slides.length - 1;
    openModal(`
      <div class="eyebrow">${s.eyebrow}</div>
      ${s.art ? `<div class="slide-art">${s.art}</div>` : ''}
      <h1>${s.title}</h1>
      ${s.html || `<p class="modal-copy">${s.text}</p>`}
      <div class="dots">${slides.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div>
      <button class="btn" id="nextBtn">${lastSlide ? doneLabel : 'NEXT'}</button>
      ${extra}`);
    slideNav = (dir) => { const n = i + dir; if (n >= 0 && n < slides.length) { i = n; render(); } };
    $('nextBtn').onclick = () => { if (!lastSlide) { i++; render(); } else { closeModal(); if (done) done(); } };
    if (bind) bind();
  };
  render();
}

// ---------------------------------------------------------------- coach tips
function tipContent(id) {
  if (id.startsWith('unlock:')) {
    const k = id.slice(7);
    return {
      cls: 'unlock', eyebrow: `NEW ${GROUP_OF[k].toUpperCase()} • ${RARITY[k].toUpperCase()}`, art: img(k),
      title: `${INFO[k].name} unlocked!`,
      text: `${INFO[k].line}${isArtillery({ kind: k }) ? ' Drag from it to aim.' : ''} Its zone is <b>${zoneSize(k)}</b>.`,
    };
  }
  return {
    afterFirstPath: {
      eyebrow: 'PATH BUILT', art: `<div class="cost">−${PATH_COST}${BRICK}</div>`, title: 'Nice path!',
      text: `It cost <b>${PATH_COST} ${BRICK}</b>. It stays and sends units <b>every battle</b> until the target falls. <b>Tap a path</b> to remove it. When you're set, tap <b>READY</b>.`,
    },
    firstBattle: {
      eyebrow: 'BATTLE', art: img('squad'), title: 'Units march!',
      text: `Hits on rocks and enemies earn <b>+1 ${BRICK}</b>. When a flag tower breaks, its building is yours.`,
    },
    territoryGrew: {
      eyebrow: 'TERRITORY', art: zoneArt(), title: 'Your land grew!',
      text: `The blue dotted line moved out. New flag towers and rocks are in reach now, but only from a building whose square covers them.`,
    },
    broke: {
      eyebrow: 'LOW ON BRICKS', art: `<div class="cost">${BRICK}<span>0</span></div>`, title: 'Out of bricks',
      text: `New paths cost <b>${PATH_COST} ${BRICK}</b>. You get <b>+${BATTLE_INCOME} ${BRICK}</b> after every battle, and every hit on rocks and enemies pays <b>+1 ${BRICK}</b>. Mine rocks to refill.`,
    },
    rockReveal: {
      eyebrow: 'SURPRISE', art: `${img('rock')}<span class="arrow">➜</span>${img('flag')}`, title: 'A flag tower appeared!',
      text: `Broken rocks sometimes hide a locked building. Capture it before the CPU does!`,
    },
    enemyCapture: {
      eyebrow: 'CONQUEST', art: img('tank'), title: 'Enemy ground taken!',
      text: `Destroyed enemy buildings can turn into <b>yours</b>. Push into their land!`,
    },
  }[id];
}

// Tips wait a beat so the effect that triggered them (brick FX, unlock pop) plays first.
function queueTip(id, delay = 1500) {
  if (!S || seen(id) || S.tipQueue.includes(id)) return;
  S.tipQueue.push(id);
  S.tipAt = Math.max(S.tipAt || 0, performance.now() + delay);
}
function pumpTips() {
  if (!S.tipQueue.length || modal.classList.contains('open') || drag || S.phase === 'over') return;
  if (performance.now() < (S.tipAt || 0)) return;
  const id = S.tipQueue.shift();
  if (seen(id)) return;
  markSeen(id);
  const t = tipContent(id);
  if (!t) return;
  openModal(`
    <div class="eyebrow">${t.eyebrow}</div>
    <div class="slide-art">${t.art}</div>
    <h1>${t.title}</h1>
    <p class="modal-copy">${t.text}</p>
    <button class="btn" id="gotBtn">GOT IT</button>`, 'tip ' + (t.cls || ''));
  $('gotBtn').onclick = closeModal;
}

// ---------------------------------------------------------------- menus
function showIntro() {
  showSlides(introSlides(false), "LET'S PLAY");
}
function showHelp() {
  showSlides(introSlides(true), 'RESUME', null,
    '<button class="link" id="resetTips">SHOW TIPS AGAIN</button><button class="link" id="newMatchLink">NEW MATCH</button>',
    () => {
      $('resetTips').onclick = () => { resetTips(); toast('Tips will show again'); };
      $('newMatchLink').onclick = confirmRestart;
    });
}
function showResult(win, b, r) {
  openModal(`
    <div class="${win ? 'result-win' : 'result-lose'}">
      <div class="eyebrow">ROUND ${S.round} • MATCH OVER</div>
      <h1>${win ? 'Victory!' : 'Defeat'}</h1>
      <div class="stats">
        <div class="info"><div class="big">${b}</div><div class="small">your buildings</div></div>
        <div class="info"><div class="big">${S.stats.unlocked}</div><div class="small">unlocked</div></div>
        <div class="info"><div class="big">${S.stats.bricks}</div><div class="small">bricks earned</div></div>
      </div>
      <button class="btn" id="againBtn">PLAY AGAIN</button>
    </div>`);
  $('againBtn').onclick = () => { closeModal(); startMatch(); };
}
function showPause() {
  openModal(`
    <div class="eyebrow">ROUND ${S.round} • ${PHASE_NAME[S.phase]}</div>
    <h1>Paused</h1>
    <p class="modal-copy">The timer and battle are frozen.</p>
    <button class="btn" id="resumeBtn">RESUME</button>
    <button class="link" id="helpLink">HOW TO PLAY</button>
    <button class="link" id="restartLink">RESTART MATCH</button>`);
  $('resumeBtn').onclick = closeModal;
  $('helpLink').onclick = showHelp;
  $('restartLink').onclick = confirmRestart;
}
function confirmRestart() {
  openModal(`
    <div class="eyebrow">NEW MAP • ROUND 1</div>
    <h1>Restart match?</h1>
    <p class="modal-copy">Your current progress will be lost.</p>
    <button class="btn" id="yesBtn">RESTART</button>
    <button class="link" id="noBtn">CANCEL</button>`);
  $('yesBtn').onclick = () => { closeModal(); startMatch(); };
  $('noBtn').onclick = closeModal;
}
$('helpBtn').addEventListener('click', showHelp);
$('pauseBtn').addEventListener('click', showPause);
$('restartBtn').addEventListener('click', confirmRestart);

// ---------------------------------------------------------------- boot
async function boot() {
  try { await document.fonts.ready; } catch (_) { /* fonts optional */ }
  icons = renderIcons();
  showIntro();   // open first so the opening ARRANGE banner waits until it closes
  startMatch();
  S.paused = true;
  fitCamera();
  requestAnimationFrame(frame);
  // debug hook for testing in the console
  window.CB = {
    get state() { return S; }, endPhase, connect, addEntity, destroy, rollKind, spawnFlag, unlock, resetTips,
    setBricks(n, team = 'blue') { S.bricks[team] = n; updateHud(); },
    clearBoard() {
      for (const e of [...S.ents]) removeEntity(e);
      S.terrain = Array.from({ length: ROWS }, () => Array(COLS).fill('ground'));
      S.paths = [];
      rebuildPaths();
      buildTerrainMeshes();
      rebuildTerritory();
    },
    setTerrain(c, r, t) { S.terrain[r][c] = t; buildTerrainMeshes(); },
    tick: (dt = 1 / 30) => { update(dt, performance.now() / 1000); renderer.render(scene, camera); } };
}
boot();
