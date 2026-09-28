// 3D models for City Breaker. Everything is built from simple rounded boxes
// so the look stays close to the chunky low-poly mockups.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const FLOOR_H = 0.37;

export const TEAM = {
  blue: { body: 0x1f6dff, top: 0x3a86ff, win: 0x0a1d58, light: 0x9cc8ff, dark: 0x0b3aa8, css: '#1f6dff' },
  red: { body: 0xe4222e, top: 0xf23a45, win: 0x4a0710, light: 0xffa3a8, dark: 0x8e0d16, css: '#e4222e' },
};
export const ROCK_COLOR = 0x676b73;

const matCache = new Map();
export function mat(color, extra = {}) {
  const key = color + JSON.stringify(extra);
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0, ...extra }));
  }
  return matCache.get(key);
}

const geoCache = new Map();
export function rbox(w, h, d, r = 0.07) {
  const key = `rb${w},${h},${d},${r}`;
  if (!geoCache.has(key)) geoCache.set(key, new RoundedBoxGeometry(w, h, d, 3, r));
  return geoCache.get(key);
}
export function box(w, h, d) {
  const key = `b${w},${h},${d}`;
  if (!geoCache.has(key)) geoCache.set(key, new THREE.BoxGeometry(w, h, d));
  return geoCache.get(key);
}

function mesh(geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// Windows on the front (+z, facing camera) and both sides.
function addWindows(group, team, y, half, front = [-0.22, 0, 0.22], side = [0], size = [0.15, 0.12]) {
  const wm = mat(TEAM[team].win, { roughness: 0.4 });
  for (const x of front) group.add(mesh(box(size[0], size[1], 0.03), wm, x, y, half + 0.004));
  for (const z of side) {
    group.add(mesh(box(0.03, size[1], size[0]), wm, half + 0.004, y, z));
    group.add(mesh(box(0.03, size[1], size[0]), wm, -half - 0.004, y, z));
  }
}

function floorMesh(team, i) {
  const g = new THREE.Group();
  g.add(mesh(rbox(0.8, FLOOR_H - 0.035, 0.8, 0.08), mat(TEAM[team].body), 0, FLOOR_H / 2, 0));
  addWindows(g, team, FLOOR_H / 2, 0.4);
  g.position.y = i * FLOOR_H;
  return g;
}

// Sender buildings: a floor stack (1 floor = 5 hp) plus a roof accessory
// that tells the three types apart.
export function makeSender(team, type = 'squad') {
  const root = new THREE.Group();
  const floors = new THREE.Group();
  root.add(floors);
  const roof = new THREE.Group();
  root.add(roof);
  if (type === 'squad') {
    roof.add(mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.34, 6), mat(0xdcdcdc), 0.24, 0.17, -0.2));
    const flag = mesh(box(0.2, 0.12, 0.02), mat(TEAM[team].top), 0.34, 0.28, -0.2);
    roof.add(flag);
  } else if (type === 'tank') {
    const t = makeTank(team);
    t.scale.setScalar(1.25);
    t.rotation.y = 0.5;
    roof.add(t);
  } else if (type === 'heli') {
    roof.add(mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.03, 24), mat(0x3c4048), 0, 0.015, 0));
    roof.add(mesh(box(0.05, 0.012, 0.26), mat(0xffffff), -0.08, 0.035, 0));
    roof.add(mesh(box(0.05, 0.012, 0.26), mat(0xffffff), 0.08, 0.035, 0));
    roof.add(mesh(box(0.14, 0.012, 0.05), mat(0xffffff), 0, 0.035, 0));
    const h = makeHeli(team);
    h.scale.setScalar(1.1);
    h.position.y = 0.04;
    h.rotation.y = 0.6;
    roof.add(h);
    roof.userData.rotor = h.userData.rotor;
  }
  root.userData.roof = roof;
  root.userData.setFloors = (n) => {
    while (floors.children.length > n) floors.remove(floors.children[floors.children.length - 1]);
    while (floors.children.length < n) {
      const i = floors.children.length;
      const f = floorMesh(team, i);
      if (type === 'tank' && i === 0) {
        // garage door on the ground floor
        f.add(mesh(box(0.42, 0.24, 0.03), mat(0x2a2e36), 0, 0.14, 0.412));
        for (const y of [0.07, 0.13, 0.19]) f.add(mesh(box(0.4, 0.012, 0.035), mat(0x4a505b), 0, y, 0.414));
      }
      floors.add(f);
    }
    roof.position.y = floors.children.length * FLOOR_H;
  };
  root.userData.getHeight = () => floors.children.length * FLOOR_H + (type === 'squad' ? 0.1 : 0.25);
  root.userData.setFloors(2);
  return root;
}

export function makeCannon(team) {
  const root = new THREE.Group();
  root.add(mesh(rbox(0.8, 0.52, 0.8, 0.08), mat(TEAM[team].body), 0, 0.26, 0));
  addWindows(root, team, 0.17, 0.4, [-0.15, 0.15], [0], [0.12, 0.09]);
  addWindows(root, team, 0.36, 0.4, [-0.15, 0.15], [0], [0.12, 0.09]);
  const turret = new THREE.Group();
  turret.position.y = 0.52;
  turret.add(mesh(rbox(0.5, 0.3, 0.5, 0.07), mat(TEAM[team].top), 0, 0.15, 0));
  const barrelMat = mat(0x8d939c, { roughness: 0.5 });
  const barrel = mesh(new THREE.CylinderGeometry(0.085, 0.1, 0.55, 16), barrelMat, 0.32, 0.18, 0);
  barrel.rotation.z = Math.PI / 2;
  turret.add(barrel);
  const muzzle = mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.07, 16), mat(0x5b6068), 0.59, 0.18, 0);
  muzzle.rotation.z = Math.PI / 2;
  turret.add(muzzle);
  const hole = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.08, 12), mat(0x1c1f24), 0.6, 0.18, 0);
  hole.rotation.z = Math.PI / 2;
  turret.add(hole);
  turret.rotation.y = 0.5;
  root.add(turret);
  root.userData.turret = turret;
  root.userData.getHeight = () => 0.85;
  return root;
}

export function makeArrow(team) {
  const root = new THREE.Group();
  root.add(mesh(rbox(0.62, 0.8, 0.62, 0.07), mat(TEAM[team].body), 0, 0.4, 0));
  const wm = mat(TEAM[team].win);
  for (const y of [0.25, 0.55]) root.add(mesh(box(0.07, 0.17, 0.03), wm, 0, y, 0.314));
  root.add(mesh(rbox(0.8, 0.12, 0.8, 0.04), mat(TEAM[team].top), 0, 0.85, 0));
  for (const [x, z] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) {
    root.add(mesh(rbox(0.17, 0.17, 0.17, 0.03), mat(TEAM[team].body), x, 1.0, z));
  }
  const turret = new THREE.Group();
  turret.position.y = 0.97;
  const wood = mat(0x8b5a2b);
  turret.add(mesh(box(0.4, 0.06, 0.08), wood, 0.05, 0, 0));
  const bow = mesh(new THREE.TorusGeometry(0.17, 0.028, 6, 14, Math.PI), mat(0x5e3a18), 0.16, 0, 0);
  bow.rotation.x = Math.PI / 2;
  bow.rotation.z = -Math.PI / 2;
  turret.add(bow);
  turret.add(mesh(box(0.34, 0.025, 0.025), mat(0xe8e0cc), 0.12, 0.05, 0));
  root.add(turret);
  root.userData.turret = turret;
  root.userData.getHeight = () => 1.1;
  return root;
}

export function makeQuarry(team) {
  const root = new THREE.Group();
  root.add(mesh(rbox(0.8, 0.44, 0.8, 0.08), mat(TEAM[team].body), 0, 0.22, 0));
  addWindows(root, team, 0.22, 0.4, [-0.24, -0.04], [-0.15, 0.15]);
  root.add(mesh(rbox(0.62, 0.14, 0.62, 0.04), mat(0x50545b), 0, 0.5, 0));
  const stone = mat(0x9ea3ab, { flatShading: true });
  const sg = new THREE.DodecahedronGeometry(0.1, 0);
  const pile = [[-0.13, 0.62, -0.1], [0.1, 0.62, -0.12], [0, 0.63, 0.1], [-0.12, 0.62, 0.13], [0.14, 0.61, 0.1], [0, 0.72, 0]];
  pile.forEach(([x, y, z], i) => {
    const s = mesh(sg, stone, x, y, z);
    s.rotation.set(i, i * 2, i * 0.5);
    root.add(s);
  });
  const ramp = mesh(box(0.2, 0.04, 0.6), mat(0x474b52), 0.25, 0.3, 0.52);
  ramp.rotation.x = 0.62;
  root.add(ramp);
  for (const t of [0.2, 0.5]) {
    const s = mesh(new THREE.DodecahedronGeometry(0.06, 0), stone, 0.25, 0.46 - t * 0.33 + 0.05, 0.3 + t * 0.44);
    root.add(s);
  }
  root.userData.getHeight = () => 0.75;
  return root;
}

export function makeRock() {
  const root = new THREE.Group();
  root.add(mesh(rbox(0.86, 0.62, 0.86, 0.1), mat(ROCK_COLOR), 0, 0.31, 0));
  root.userData.getHeight = () => 0.62;
  return root;
}

// Locked building: a grey stone tower flying a grey flag. What it hides is
// only revealed when somebody breaks it.
export function makeFlagTower() {
  const root = new THREE.Group();
  const stone = mat(0x9398a1), dark = mat(0x70757e), slit = mat(0x3d4048);
  root.add(mesh(rbox(0.7, 0.14, 0.7, 0.05), dark, 0, 0.07, 0));
  root.add(mesh(rbox(0.5, 0.62, 0.5, 0.06), stone, 0, 0.45, 0));
  root.add(mesh(box(0.14, 0.2, 0.03), slit, 0, 0.26, 0.252));
  root.add(mesh(box(0.07, 0.12, 0.03), slit, 0, 0.56, 0.252));
  root.add(mesh(rbox(0.64, 0.1, 0.64, 0.03), mat(0xa9aeb6), 0, 0.8, 0));
  for (const [x, z] of [[-0.24, -0.24], [0.24, -0.24], [-0.24, 0.24], [0.24, 0.24]]) {
    root.add(mesh(rbox(0.14, 0.13, 0.14, 0.03), stone, x, 0.91, z));
  }
  root.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.62, 6), mat(0xdcdcdc), 0, 1.16, 0));
  const flag = new THREE.Group();
  flag.position.set(0, 1.36, 0);
  flag.add(mesh(box(0.3, 0.18, 0.02), mat(0xc4c8ce), 0.16, 0, 0));
  root.add(flag);
  root.userData.flag = flag;
  root.userData.getHeight = () => 1.5;
  return root;
}

const domeMat = new THREE.MeshStandardMaterial({
  color: 0x8fdcff, emissive: 0x3aa7ff, emissiveIntensity: 0.35, transparent: true, opacity: 0.3,
  depthWrite: false, roughness: 0.2, side: THREE.DoubleSide,
});
// Reinforce shield: a covered guard wall around the tile.
export function makeShield() {
  const root = new THREE.Group();
  const wall = mat(0xa6abb3);
  const H = 0.24;
  root.add(mesh(rbox(0.98, H, 0.08, 0.03), wall, 0, H / 2, 0.47));
  root.add(mesh(rbox(0.98, H, 0.08, 0.03), wall, 0, H / 2, -0.47));
  root.add(mesh(rbox(0.08, H, 0.98, 0.03), wall, 0.47, H / 2, 0));
  root.add(mesh(rbox(0.08, H, 0.98, 0.03), wall, -0.47, H / 2, 0));
  for (const t of [-0.34, 0, 0.34]) {
    root.add(mesh(box(0.13, 0.1, 0.1), wall, t, H + 0.05, 0.47));
    root.add(mesh(box(0.13, 0.1, 0.1), wall, t, H + 0.05, -0.47));
    root.add(mesh(box(0.1, 0.1, 0.13), wall, 0.47, H + 0.05, t));
    root.add(mesh(box(0.1, 0.1, 0.13), wall, -0.47, H + 0.05, t));
  }
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.66, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
  dome.renderOrder = 2;
  root.add(dome);
  root.userData.setHeight = (h) => { dome.scale.y = Math.max(0.9, (h + 0.25) / 0.66); };
  root.userData.setHeight(0.6);
  return root;
}

// ---------------------------------------------------------------- units
const legGeo = new THREE.BoxGeometry(0.045, 0.09, 0.05);
export function makeSoldier(team) {
  const root = new THREE.Group();
  const c = TEAM[team];
  const legs = [mesh(legGeo, mat(0x2b2f38), -0.035, 0.045, 0), mesh(legGeo, mat(0x2b2f38), 0.035, 0.045, 0)];
  legs.forEach((l) => root.add(l));
  root.add(mesh(rbox(0.13, 0.12, 0.09, 0.03), mat(c.body), 0, 0.15, 0));
  root.add(mesh(new THREE.SphereGeometry(0.05, 10, 8), mat(0xf2c9a0), 0, 0.25, 0));
  const helmet = mesh(new THREE.SphereGeometry(0.058, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(c.dark), 0, 0.26, 0);
  root.add(helmet);
  root.add(mesh(box(0.025, 0.025, 0.14), mat(0x3a3d44), 0.075, 0.16, 0.03));
  root.userData.legs = legs;
  return root;
}

export function makeTank(team) {
  const root = new THREE.Group();
  const c = TEAM[team];
  const track = mat(0x2d3038);
  root.add(mesh(rbox(0.1, 0.1, 0.36, 0.04), track, -0.11, 0.05, 0));
  root.add(mesh(rbox(0.1, 0.1, 0.36, 0.04), track, 0.11, 0.05, 0));
  root.add(mesh(rbox(0.24, 0.09, 0.32, 0.03), mat(c.body), 0, 0.11, 0));
  const turret = new THREE.Group();
  turret.position.y = 0.16;
  turret.add(mesh(rbox(0.16, 0.08, 0.16, 0.03), mat(c.top), 0, 0.03, 0));
  const barrel = mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.22, 8), mat(0x5b6068), 0.13, 0.04, 0);
  barrel.rotation.z = Math.PI / 2;
  turret.add(barrel);
  root.add(turret);
  root.userData.turret = turret;
  return root;
}

export function makeHeli(team) {
  const root = new THREE.Group();
  const c = TEAM[team];
  const body = mesh(new THREE.SphereGeometry(0.11, 14, 10), mat(c.body), 0, 0.12, 0);
  body.scale.set(1.35, 0.9, 1);
  root.add(body);
  root.add(mesh(new THREE.SphereGeometry(0.06, 10, 8), mat(0xbfe6ff, { roughness: 0.2 }), 0.09, 0.14, 0));
  root.add(mesh(box(0.24, 0.035, 0.035), mat(c.body), -0.2, 0.14, 0));
  root.add(mesh(box(0.02, 0.09, 0.06), mat(c.dark), -0.31, 0.17, 0));
  for (const z of [-0.07, 0.07]) root.add(mesh(box(0.24, 0.015, 0.015), mat(0x2d3038), 0, 0.01, z));
  root.add(mesh(box(0.02, 0.06, 0.02), mat(0x2d3038), 0, 0.22, 0));
  const rotor = new THREE.Group();
  rotor.position.y = 0.25;
  rotor.add(mesh(box(0.5, 0.01, 0.04), mat(0x2d3038)));
  rotor.add(mesh(box(0.04, 0.01, 0.5), mat(0x2d3038)));
  root.add(rotor);
  root.userData.rotor = rotor;
  return root;
}

const shadowTex = (() => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 4, 32, 32, 30);
  grd.addColorStop(0, 'rgba(0,0,0,.35)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
})();
export function makeBlobShadow(size = 0.4) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.02;
  return m;
}

// ---------------------------------------------------------------- terrain
const waterTex = (() => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = '#39a9e6';
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(255,255,255,.35)';
  g.lineWidth = 3;
  g.lineCap = 'round';
  for (const [x, y] of [[10, 16], [38, 30], [16, 48], [46, 56]]) {
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 6, y - 4, x + 12, y); g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
export { waterTex };
export function makeWaterTile() {
  const root = new THREE.Group();
  const bed = new THREE.Mesh(box(1, 0.02, 1), mat(0xd9803a));
  bed.position.y = -0.004;
  root.add(bed);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ map: waterTex, roughness: 0.25, transparent: true, opacity: 0.95 }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.012;
  water.receiveShadow = true;
  root.add(water);
  return root;
}

export function makeMountain(seed = 0) {
  const root = new THREE.Group();
  root.add(mesh(rbox(1, 0.5, 1, 0.1), mat(0xb86f36), 0, 0.25, 0));
  const rock = mat(0x94603f, { flatShading: true, roughness: 0.95 });
  const peak = mesh(new THREE.ConeGeometry(0.42, 0.62, 6), rock, -0.06, 0.8, -0.05);
  peak.rotation.y = seed;
  root.add(peak);
  const p2 = mesh(new THREE.ConeGeometry(0.26, 0.38, 5), rock, 0.24, 0.68, 0.18);
  p2.rotation.y = seed * 2;
  root.add(p2);
  root.add(mesh(new THREE.ConeGeometry(0.15, 0.14, 6), mat(0xf4efe6, { flatShading: true }), -0.06, 1.05, -0.05));
  return root;
}

export function makeModel(kind, team) {
  switch (kind) {
    case 'squad':
    case 'tank':
    case 'heli': return makeSender(team, kind);
    case 'cannon': return makeCannon(team);
    case 'arrow': return makeArrow(team);
    case 'quarry': return makeQuarry(team);
    case 'rock': return makeRock();
    case 'flag': return makeFlagTower();
    case 'shield': return makeShield();
  }
  throw new Error('Unknown model ' + kind);
}
