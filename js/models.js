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

export function makeNormal(team) {
  const root = new THREE.Group();
  const floors = new THREE.Group();
  root.add(floors);
  root.userData.setFloors = (n) => {
    while (floors.children.length > n) floors.remove(floors.children[floors.children.length - 1]);
    while (floors.children.length < n) floors.add(floorMesh(team, floors.children.length));
  };
  root.userData.getHeight = () => floors.children.length * FLOOR_H;
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

const unitGeo = new THREE.SphereGeometry(0.095, 14, 10);
const headGeo = new THREE.SphereGeometry(0.062, 12, 8);
export function makeUnit(team) {
  const root = new THREE.Group();
  const body = mesh(unitGeo, mat(TEAM[team].body), 0, 0.1, 0);
  body.scale.set(1, 1.1, 1);
  root.add(body);
  root.add(mesh(headGeo, mat(TEAM[team].light), 0, 0.23, 0));
  return root;
}

export function makeModel(kind, team) {
  switch (kind) {
    case 'normal': return makeNormal(team);
    case 'cannon': return makeCannon(team);
    case 'arrow': return makeArrow(team);
    case 'quarry': return makeQuarry(team);
    case 'rock': return makeRock();
    case 'shield': return makeShield();
  }
  throw new Error('Unknown model ' + kind);
}
