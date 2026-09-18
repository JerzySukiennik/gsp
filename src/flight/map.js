// Orbital map view: lit planet globe, conic orbit lines, apsis / impact / vessel markers as screen labels.
import * as THREE from 'three';
import { P, heightAt, planetAngle, SUN } from './planet.js';
import { elements, orbitPoints, pointAt, impact } from './orbit.js';

const KM = 0.001;
let globeTex = null;

function bakeGlobe() {
  if (globeTex) return globeTex;
  const W = 768, H = 384, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d'), img = x.createImageData(W, H), mix = (a, b, t) => a + (b - a) * Math.min(1, Math.max(0, t));
  for (let py = 0; py < H; py++) {
    const th = ((py + 0.5) / H) * Math.PI, st = Math.sin(th), y = Math.cos(th);
    for (let px = 0; px < W; px++) {
      const ph = ((px + 0.5) / W) * Math.PI * 2;
      const h = heightAt(-Math.cos(ph) * st, y, Math.sin(ph) * st, 3500);
      let r, g, b;
      if (h < 0) { const d = Math.min(1, -h / 2500); r = mix(18, 4, d); g = mix(78, 22, d); b = mix(104, 58, d); }
      else {
        const t = h / 1700; r = mix(52, 112, t); g = mix(86, 100, t); b = mix(34, 58, t);
        if (h < 25) { r = 186; g = 170; b = 124; }
        if (h > 1900) { const k = (h - 1900) / 1200; r = mix(r, 96, k); g = mix(g, 90, k); b = mix(b, 86, k); }
        const snow = Math.abs(y) > 0.86 ? 1 : (h - 3000) / 600;
        if (snow > 0) { r = mix(r, 238, snow); g = mix(g, 242, snow); b = mix(b, 248, snow); }
      }
      const i = (py * W + px) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  globeTex = new THREE.CanvasTexture(c);
  globeTex.colorSpace = THREE.SRGBColorSpace;
  return globeTex;
}

export class MapView {
  constructor(labelRoot) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020308);
    this.camera = new THREE.PerspectiveCamera(45, 1, 1, 2e6);
    this.cam = { theta: 0.8, phi: 1.1, dist: 2600 };
    this.globe = new THREE.Mesh(new THREE.SphereGeometry(P.R * KM, 96, 64), new THREE.MeshLambertMaterial({ map: bakeGlobe() }));
    this.scene.add(this.globe);
    const halo = new THREE.Mesh(new THREE.SphereGeometry((P.R + P.atmo) * KM, 64, 48), new THREE.ShaderMaterial({
      transparent: true, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false,
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying vec3 vN; varying vec3 vV; void main(){ float k = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.6); gl_FragColor = vec4(vec3(0.25, 0.5, 1.0) * (1.0 - k) * 0.9, 1.0); }',
    }));
    this.scene.add(halo);
    const sun = new THREE.DirectionalLight(0xffffff, 3);
    sun.position.copy(SUN).multiplyScalar(1e5);
    this.scene.add(sun, new THREE.AmbientLight(0x30384a, 1.2));
    this.lines = new Map();
    this.labelRoot = labelRoot;
    this.labels = new Map();
    this.focus = new THREE.Vector3();
  }

  line(key, color, opacity) {
    let l = this.lines.get(key);
    if (!l) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(258 * 3), 3));
      l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
      l.frustumCulled = false;
      this.scene.add(l); this.lines.set(key, l);
    }
    return l;
  }

  label(key, cls) {
    let e = this.labels.get(key);
    if (!e) { e = document.createElement('div'); e.className = `maplabel ${cls}`; this.labelRoot.append(e); this.labels.set(key, e); }
    return e;
  }

  place(e, pos, html) {
    const p = pos.clone().multiplyScalar(KM).project(this.camera);
    const hiddenByGlobe = (() => { const o = this.camera.position, d = pos.clone().multiplyScalar(KM).sub(o), len = d.length(); d.normalize(); const b = o.dot(d), c = o.lengthSq() - (P.R * KM) ** 2, h = b * b - c; if (h < 0) return false; const t = -b - Math.sqrt(h); return t > 0 && t < len; })();
    if (p.z > 1 || hiddenByGlobe) { e.style.display = 'none'; return; }
    e.style.display = 'block';
    e.style.transform = `translate(${((p.x + 1) / 2) * innerWidth}px, ${((1 - p.y) / 2) * innerHeight}px)`;
    e.innerHTML = html;
  }

  orbit(dx, dy) { this.cam.theta -= dx * 0.005; this.cam.phi = THREE.MathUtils.clamp(this.cam.phi - dy * 0.005, 0.05, 3.09); }
  zoom(d) { this.cam.dist = THREE.MathUtils.clamp(this.cam.dist * Math.exp(d * 0.0012), 650, 60000); }

  update(sim, fmtDist, fmtTime) {
    this.globe.rotation.y = planetAngle(sim.ut);
    const used = new Set(), usedL = new Set();
    for (const c of sim.crafts) {
      const active = c === sim.active;
      if (c.debris && !active && c.r.length() - P.R < P.atmo) continue;
      const still = c.landed || c.clamped;
      const o = elements(c.r, c.v);
      if (!still) {
        const l = this.line(c.id, active ? 0x6fd3ff : 0x8a8f98, active ? 1 : 0.45);
        const pts = orbitPoints(o, 256), arr = l.geometry.attributes.position.array;
        pts.forEach((p, i) => arr.set([p.x * KM, p.y * KM, p.z * KM], i * 3));
        l.geometry.setDrawRange(0, pts.length); l.geometry.attributes.position.needsUpdate = true;
        l.visible = true; used.add(c.id);
      }
      usedL.add(`v${c.id}`);
      this.place(this.label(`v${c.id}`, active ? 'vessel' : 'other'), c.r, active ? '' : c.name);
      if (!active || still) continue;
      if (o.e < 1 && o.ap > 0) { usedL.add('ap'); this.place(this.label('ap', 'apsis'), pointAt(o, Math.PI), `<b>Ap</b> ${fmtDist(o.ap)}<i>T−${fmtTime(o.tAp)}</i>`); }
      if (o.pe > 0) { usedL.add('pe'); this.place(this.label('pe', 'apsis'), pointAt(o, 0), `<b>Pe</b> ${fmtDist(o.pe)}<i>T−${fmtTime(o.tPe)}</i>`); }
      const hit = impact(o, P.R + 50);
      if (hit && Number.isFinite(hit.t)) {
        const a = -P.omega * hit.t, cs = Math.cos(a), sn = Math.sin(a), p = hit.point;
        const onGround = new THREE.Vector3(p.x * cs + p.z * sn, p.y, -p.x * sn + p.z * cs);
        usedL.add('hit'); this.place(this.label('hit', 'impact'), onGround, `<b>Impact</b><i>T−${fmtTime(hit.t)}</i>`);
      }
    }
    for (const [k, l] of this.lines) if (!used.has(k)) l.visible = false;
    for (const [k, e] of this.labels) if (!usedL.has(k)) e.style.display = 'none';
    if (sim.active) this.focus.lerp(sim.active.r.clone().multiplyScalar(KM).multiplyScalar(0), 1);
    const c = this.cam, sp = Math.sin(c.phi);
    this.camera.position.set(Math.sin(c.theta) * sp * c.dist, Math.cos(c.phi) * c.dist, Math.cos(c.theta) * sp * c.dist);
    this.camera.lookAt(0, 0, 0);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  hide() { for (const e of this.labels.values()) e.style.display = 'none'; }
  destroy() { for (const e of this.labels.values()) e.remove(); }
}
