// Asset loading: part and hangar GLBs, per-instance material cloning, paint, catalog thumbnails.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MODEL_IDS, PARTS, PART_LIST } from './catalog.js';

export const DEFAULT_COLORS = { main: '#ebebed', accent: '#0b0b0d' };
const templates = new Map();
let hangar = null;

export async function loadAssets(onProgress) {
  const loader = new GLTFLoader();
  let done = 0;
  const total = MODEL_IDS.length + 1;
  const tick = () => onProgress(++done / total);
  const jobs = MODEL_IDS.map((id) => loader.loadAsync(`assets/parts/${id}.glb`).then((g) => { templates.set(id, g.scene); tick(); }));
  jobs.push(loader.loadAsync('assets/hangar/hangar.glb').then((g) => { hangar = g.scene; tick(); }));
  await Promise.all(jobs);
}

export const getHangar = () => hangar;

export function paint(obj, colors) {
  const c = colors || DEFAULT_COLORS;
  obj.traverse((m) => {
    if (!m.isMesh) return;
    if (m.material.name === 'paint_main') m.material.color.set(c.main);
    if (m.material.name === 'paint_accent') m.material.color.set(c.accent);
  });
}

export function makePart(type, colors) {
  const def = PARTS[type];
  const obj = templates.get(type).clone(true);
  obj.traverse((m) => {
    if (!m.isMesh) return;
    m.material = m.material.clone();
    m.castShadow = true;
    m.receiveShadow = true;
  });
  paint(obj, colors);
  if (def.shell) {
    const shell = templates.get(def.shell).clone(true);
    shell.position.y = def.h / 2;
    shell.traverse((m) => {
      if (!m.isMesh) return;
      m.material = m.material.clone();
      m.material.transparent = true;
      m.material.opacity = 0.16;
      m.material.depthWrite = false;
      m.material.side = THREE.DoubleSide;
      m.userData.noPick = true;
      m.userData.shell = true;
    });
    paint(shell, colors);
    obj.add(shell);
  }
  return obj;
}

export function setTint(obj, hex, amount) {
  obj.traverse((m) => {
    if (!m.isMesh || !m.material.emissive || m.userData.shell) return;
    m.material.emissive.set(hex);
    m.material.emissiveIntensity = amount;
  });
}

export function renderThumbnails(size = 160) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.outputColorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(r);
  const scene = new THREE.Scene();
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(3, 5, 4);
  scene.add(key);
  const cam = new THREE.PerspectiveCamera(28, 1, 0.01, 200);
  const out = {};
  for (const def of PART_LIST) {
    const obj = makePart(def.id, null);
    obj.traverse((m) => { if (m.userData.shell) m.visible = false; });
    if (def.radialOnly) obj.rotation.y = Math.PI * 0.5;
    scene.add(obj);
    const box = new THREE.Box3().setFromObject(obj);
    const c = box.getCenter(new THREE.Vector3());
    const rad = box.getSize(new THREE.Vector3()).length() / 2;
    const dist = rad / Math.sin(THREE.MathUtils.degToRad(14)) * 1.02;
    cam.position.set(c.x + dist * 0.62, c.y + dist * 0.3, c.z + dist * 0.72);
    cam.lookAt(c);
    r.render(scene, cam);
    out[def.id] = canvas.toDataURL('image/png');
    scene.remove(obj);
  }
  pmrem.dispose();
  r.dispose();
  r.forceContextLoss();
  return out;
}
