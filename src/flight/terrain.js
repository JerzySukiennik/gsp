// Planet surface: cube-sphere quadtree LOD with skirts, terrain and ocean shaders, instanced trees.
import * as THREE from 'three';
import { P, heightAt, SITE } from './planet.js';

const N = 32, G = N + 3, MAX_DEPTH = 17, TREE_DEPTH = 11, SPLIT = 1.7;
const FACES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map(([x, y, z]) => {
  const n = new THREE.Vector3(x, y, z);
  const u = new THREE.Vector3(y, z, x), v = new THREE.Vector3().crossVectors(n, u);
  return { n, u, v };
});

const INDEX = (() => {
  const idx = [];
  for (let j = 0; j < G - 1; j++) for (let i = 0; i < G - 1; i++) { const a = j * G + i, b = a + 1, c = a + G, d = c + 1; idx.push(a, b, c, b, d, c); }
  return new THREE.BufferAttribute(new Uint32Array(idx), 1);
})();

const NOISE_GLSL = `
float hash3(vec3 p){ p = mod(p, 1024.0); p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash3(i), hash3(i+vec3(1,0,0)), f.x), mix(hash3(i+vec3(0,1,0)), hash3(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash3(i+vec3(0,0,1)), hash3(i+vec3(1,0,1)), f.x), mix(hash3(i+vec3(0,1,1)), hash3(i+vec3(1,1,1)), f.x), f.y), f.z); }`;

const VERT = `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aH;
uniform vec3 uOffset; uniform vec3 uCenterUnit;
varying vec3 vN; varying vec3 vUp; varying float vH; varying vec3 vW; varying vec3 vView;
void main(){
  vH = aH; vW = position + uOffset;
  vUp = normalize(mat3(modelMatrix) * normalize(uCenterUnit * ${P.R.toFixed(1)} + position));
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = (modelMatrix * vec4(position, 1.0)).xyz - cameraPosition;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;

const LAND_FRAG = `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uSun; uniform vec3 uAmbient; uniform float uSunK;
varying vec3 vN; varying vec3 vUp; varying float vH; varying vec3 vW; varying vec3 vView;
${NOISE_GLSL}
void main(){
  #include <logdepthbuf_fragment>
  float dist = length(vView);
  vec3 N = normalize(vN);
  float slope = 1.0 - clamp(dot(N, normalize(vUp)), 0.0, 1.0);
  float near = 1.0 - smoothstep(600.0, 4000.0, dist);
  float d1 = vnoise(vW * 0.35), d2 = vnoise(vW * 0.045), d3 = vnoise(vW * 0.006);
  float detail = mix(1.0, 0.78 + 0.26 * d1 + 0.18 * d2, near) * (0.9 + 0.2 * d3);
  float lat = abs(normalize(vUp).y);
  vec3 sand = vec3(0.70, 0.64, 0.46), grass = vec3(0.17, 0.30, 0.09), dry = vec3(0.40, 0.37, 0.19), rock = vec3(0.30, 0.28, 0.26), snow = vec3(0.92, 0.94, 0.97), bed = vec3(0.10, 0.16, 0.16);
  vec3 c = mix(grass, dry, smoothstep(300.0, 1700.0, vH + d3 * 500.0));
  c = mix(c, vec3(0.13, 0.24, 0.08), smoothstep(0.35, 0.8, d3) * (1.0 - smoothstep(900.0, 1500.0, vH)) * 0.7);
  c = mix(sand, c, smoothstep(4.0, 22.0, vH + d2 * 8.0));
  c = mix(c, rock, smoothstep(0.10, 0.30, slope + d2 * 0.06));
  float snowLine = mix(2900.0, 250.0, smoothstep(0.55, 0.92, lat));
  c = mix(c, snow, smoothstep(snowLine, snowLine + 500.0, vH + d3 * 600.0) * (1.0 - smoothstep(0.35, 0.6, slope)));
  c = mix(bed, c, smoothstep(-40.0, 2.0, vH));
  c *= detail;
  float ndl = max(dot(N, uSun), 0.0);
  float horizon = smoothstep(-0.08, 0.12, dot(normalize(vUp), uSun));
  vec3 lit = c * (uAmbient + vec3(1.0, 0.96, 0.9) * ndl * horizon * uSunK);
  gl_FragColor = vec4(lit, 1.0);
}`;

const SEA_FRAG = `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uSun; uniform vec3 uAmbient; uniform float uSunK; uniform float uTime; uniform vec3 uSky;
varying vec3 vN; varying vec3 vUp; varying float vH; varying vec3 vW; varying vec3 vView;
${NOISE_GLSL}
void main(){
  #include <logdepthbuf_fragment>
  float dist = length(vView);
  vec3 up = normalize(vUp), V = -normalize(vView);
  float k = 1.0 - smoothstep(300.0, 9000.0, dist);
  vec3 q = vW * 0.18 + vec3(uTime * 0.35, 0.0, uTime * 0.22);
  vec3 g = vec3(vnoise(q) - vnoise(q + vec3(0.9, 0.0, 0.0)), 0.0, vnoise(q) - vnoise(q + vec3(0.0, 0.0, 0.9)));
  vec3 q2 = vW * 0.02 - vec3(uTime * 0.1);
  g += 1.6 * vec3(vnoise(q2) - vnoise(q2 + vec3(0.9, 0.0, 0.0)), 0.0, vnoise(q2) - vnoise(q2 + vec3(0.0, 0.0, 0.9)));
  vec3 N = normalize(up + (g - up * dot(g, up)) * (0.55 * k + 0.05));
  float depth = clamp(vH / 60.0, 0.0, 1.0);
  vec3 water = mix(vec3(0.05, 0.30, 0.32), vec3(0.008, 0.045, 0.11), depth);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  float horizon = smoothstep(-0.08, 0.12, dot(up, uSun));
  vec3 H = normalize(uSun + V);
  float spec = pow(max(dot(N, H), 0.0), mix(60.0, 900.0, k)) * mix(1.2, 22.0, k) * horizon;
  vec3 col = water * (uAmbient * 1.4 + vec3(max(dot(N, uSun), 0.0)) * horizon * uSunK) * (1.0 - fres) + uSky * fres + vec3(1.0, 0.95, 0.85) * spec * uSunK;
  gl_FragColor = vec4(col, 1.0);
}`;

class Node {
  constructor(face, x, y, size, depth, parent) { Object.assign(this, { face, x, y, size, depth, parent, children: null, mesh: null, sea: null, trees: null, ready: false }); const f = FACES[face]; this.centerUnit = new THREE.Vector3().copy(f.n).addScaledVector(f.u, x + size / 2).addScaledVector(f.v, y + size / 2).normalize(); this.edge = size * P.R * 0.82; }
}

export class Terrain {
  constructor(scene, treeTemplate) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.uniforms = { uSun: { value: new THREE.Vector3(1, 0, 0) }, uAmbient: { value: new THREE.Color(0.1, 0.12, 0.16) }, uSunK: { value: 1 }, uTime: { value: 0 }, uSky: { value: new THREE.Color(0.4, 0.6, 0.9) } };
    const mk = (frag) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms: { ...this.uniforms, uOffset: { value: new THREE.Vector3() }, uCenterUnit: { value: new THREE.Vector3() } } });
    this.land = mk(LAND_FRAG);
    this.seaMat = mk(SEA_FRAG);
    this.roots = FACES.map((_, i) => new Node(i, -1, -1, 2, 0, null));
    this.queue = [];
    this.treeGeo = null;
    if (treeTemplate) {
      const meshes = [];
      treeTemplate.traverse((m) => { if (m.isMesh) meshes.push(m); });
      this.treeParts = meshes.map((m) => ({ geo: m.geometry, mat: m.material }));
    }
    for (const r of this.roots) this.build(r);
    this.rot = new THREE.Quaternion();
  }

  build(node) {
    const f = FACES[node.face], step = node.size / N, spacing = node.edge / N;
    const H = new Float32Array(G * G), U = new Float64Array(G * G * 3);
    let minH = Infinity;
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const a = node.x + (i - 1) * step, b = node.y + (j - 1) * step;
      let px = f.n.x + f.u.x * a + f.v.x * b, py = f.n.y + f.u.y * a + f.v.y * b, pz = f.n.z + f.u.z * a + f.v.z * b;
      const l = Math.hypot(px, py, pz); px /= l; py /= l; pz /= l;
      const k = j * G + i, h = heightAt(px, py, pz, spacing);
      H[k] = h; U[k * 3] = px; U[k * 3 + 1] = py; U[k * 3 + 2] = pz;
      if (h < minH) minH = h;
    }
    const c = node.centerUnit, cx = c.x * P.R, cy = c.y * P.R, cz = c.z * P.R;
    const pos = new Float32Array(G * G * 3), nor = new Float32Array(G * G * 3), sea = minH < 1 ? new Float32Array(G * G * 3) : null, seaN = sea ? new Float32Array(G * G * 3) : null;
    const W = new Float64Array(G * G * 3);
    for (let k = 0; k < G * G; k++) { const r = P.R + H[k]; W[k * 3] = U[k * 3] * r - cx; W[k * 3 + 1] = U[k * 3 + 1] * r - cy; W[k * 3 + 2] = U[k * 3 + 2] * r - cz; }
    const skirt = spacing * 1.5 + 2;
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const ci = Math.min(G - 2, Math.max(1, i)), cj = Math.min(G - 2, Math.max(1, j));
      const k = j * G + i, s = cj * G + ci, isSkirt = ci !== i || cj !== j;
      const l = (s - 1) * 3, r = (s + 1) * 3, d = (s - G) * 3, u = (s + G) * 3;
      const ax = W[r] - W[l], ay = W[r + 1] - W[l + 1], az = W[r + 2] - W[l + 2], bx = W[u] - W[d], by = W[u + 1] - W[d + 1], bz = W[u + 2] - W[d + 2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const flip = nx * U[s * 3] + ny * U[s * 3 + 1] + nz * U[s * 3 + 2] < 0 ? -1 : 1, nl = Math.hypot(nx, ny, nz) * flip || 1;
      nor[k * 3] = nx / nl; nor[k * 3 + 1] = ny / nl; nor[k * 3 + 2] = nz / nl;
      const drop = isSkirt ? skirt : 0;
      pos[k * 3] = W[s * 3] - U[s * 3] * drop; pos[k * 3 + 1] = W[s * 3 + 1] - U[s * 3 + 1] * drop; pos[k * 3 + 2] = W[s * 3 + 2] - U[s * 3 + 2] * drop;
      if (sea) {
        const rr = P.R - drop;
        sea[k * 3] = U[s * 3] * rr - cx; sea[k * 3 + 1] = U[s * 3 + 1] * rr - cy; sea[k * 3 + 2] = U[s * 3 + 2] * rr - cz;
        seaN[k * 3] = U[s * 3]; seaN[k * 3 + 1] = U[s * 3 + 1]; seaN[k * 3 + 2] = U[s * 3 + 2];
      }
    }
    const Hs = new Float32Array(G * G), Ds = new Float32Array(G * G);
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { const s = Math.min(G - 2, Math.max(1, j)) * G + Math.min(G - 2, Math.max(1, i)); Hs[j * G + i] = H[s]; Ds[j * G + i] = -H[s]; }
    const offset = new THREE.Vector3(((cx % 1024) + 1024) % 1024, ((cy % 1024) + 1024) % 1024, ((cz % 1024) + 1024) % 1024);
    const make = (p, n, h, mat) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
      g.setAttribute('aH', new THREE.BufferAttribute(h, 1));
      g.setIndex(INDEX);
      const m = new THREE.Mesh(g, mat);
      m.frustumCulled = false;
      m.matrixAutoUpdate = true;
      m.onBeforeRender = (r, s, cam, geo, material) => { material.uniforms.uOffset.value.copy(offset); material.uniforms.uCenterUnit.value.copy(c); material.uniformsNeedUpdate = true; };
      m.visible = false;
      this.group.add(m);
      return m;
    };
    node.mesh = make(pos, nor, Hs, this.land);
    if (sea) node.sea = make(sea, seaN, Ds, this.seaMat);
    node.center = new THREE.Vector3(cx, cy, cz);
    node.radius = node.edge * 0.75 + 6000 / (1 + node.depth);
    if (node.depth === TREE_DEPTH && this.treeParts) this.plant(node);
    node.ready = true;
  }

  plant(node) {
    const f = FACES[node.face], c = node.center, mats = [];
    const dummy = new THREE.Object3D();
    let seed = (node.face * 73856093) ^ (Math.round((node.x + 1) * 1e6) * 19349663) ^ (Math.round((node.y + 1) * 1e6) * 83492791);
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < 520; i++) {
      const a = node.x + rnd() * node.size, b = node.y + rnd() * node.size;
      const u = new THREE.Vector3().copy(f.n).addScaledVector(f.u, a).addScaledVector(f.v, b).normalize();
      const scale = 0.7 + rnd() * 0.9, spin = rnd() * 6.28;
      if (Math.acos(Math.min(1, u.dot(SITE))) * P.R < 900) continue;
      const h = heightAt(u.x, u.y, u.z);
      if (h < 14 || h > 1900) continue;
      const e = 8 / P.R, t = new THREE.Vector3().crossVectors(u, f.u).normalize();
      const u2 = u.clone().addScaledVector(t, e).normalize();
      if (Math.abs(heightAt(u2.x, u2.y, u2.z) - h) > 3.2) continue;
      dummy.position.copy(u).multiplyScalar(P.R + h - 0.3).sub(c);
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), u).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spin));
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      mats.push(dummy.matrix.clone());
    }
    if (!mats.length) return;
    node.trees = this.treeParts.map(({ geo, mat }) => {
      const im = new THREE.InstancedMesh(geo, mat, mats.length);
      mats.forEach((m, i) => im.setMatrixAt(i, m));
      im.frustumCulled = false; im.castShadow = false; im.visible = false;
      this.group.add(im);
      return im;
    });
  }

  dispose(node) {
    if (node.children) { node.children.forEach((c) => this.dispose(c)); node.children = null; }
    for (const m of [node.mesh, node.sea, ...(node.trees || [])]) if (m) { this.group.remove(m); if (!m.isInstancedMesh) m.geometry.dispose(); else m.dispose(); }
    node.mesh = node.sea = node.trees = null; node.ready = false;
  }

  // camFixed: camera position in the planet-fixed frame (metres, double precision).
  update(camFixed, originInertial, rot, budgetMs = 5) {
    this.rot.copy(rot);
    const alt = Math.max(camFixed.length() - P.R, 2);
    const camDir = camFixed.clone().normalize();
    const horizon = Math.acos(Math.min(1, P.R / (P.R + alt))) + 0.06;
    this.visibleList = [];
    const want = [];
    const visit = (n) => {
      const d = Math.max(0, n.center.distanceTo(camFixed) - n.edge * 0.72);
      const ang = Math.acos(Math.min(1, Math.max(-1, n.centerUnit.dot(camDir)))) - n.edge / P.R * 0.75;
      const beyond = ang > horizon;
      const split = !beyond && n.depth < MAX_DEPTH && d < n.edge * SPLIT;
      if (split) {
        if (!n.children) { const h = n.size / 2; n.children = [0, 1, 2, 3].map((k) => new Node(n.face, n.x + (k & 1) * h, n.y + (k >> 1) * h, h, n.depth + 1, n)); }
        const pending = n.children.filter((c) => !c.ready);
        if (pending.length) { pending.forEach((c) => want.push({ c, d })); this.visibleList.push(n); } else n.children.forEach(visit);
      } else {
        if (n.children && d > n.edge * SPLIT * 1.25) { n.children.forEach((c) => this.dispose(c)); n.children = null; }
        if (n.children && n.children.every((c) => c.ready) && !beyond && d < n.edge * SPLIT * 1.25) n.children.forEach(visit); else if (!beyond || n.depth < 3) this.visibleList.push(n);
      }
    };
    this.roots.forEach(visit);
    want.sort((a, b) => a.d - b.d);
    const t0 = performance.now();
    for (const w of want) { this.build(w.c); if (performance.now() - t0 > budgetMs) break; }
    this.pending = want.length;

    const shown = new Set(this.visibleList);
    const place = (m, n, on) => { if (!m) return; m.visible = on; if (on) { m.position.copy(n.center).applyQuaternion(rot).sub(originInertial); m.quaternion.copy(rot); } };
    const walk = (n, treeOn) => {
      const on = shown.has(n);
      place(n.mesh, n, on); place(n.sea, n, on);
      if (n.trees) n.trees.forEach((t) => place(t, n, treeOn));
      if (n.children) n.children.forEach((c) => walk(c, treeOn));
    };
    const near = (n) => n.center.distanceTo(camFixed) < 2600;
    const top = (n) => { if (n.depth === TREE_DEPTH) { walk(n, n.trees ? near(n) : false); return; } place(n.mesh, n, shown.has(n)); place(n.sea, n, shown.has(n)); if (n.children) n.children.forEach(top); };
    this.roots.forEach(top);
  }

  setLighting(sun, ambient, sunK, sky, time) {
    this.uniforms.uSun.value.copy(sun); this.uniforms.uAmbient.value.copy(ambient); this.uniforms.uSunK.value = sunK; this.uniforms.uSky.value.copy(sky); this.uniforms.uTime.value = time;
    for (const m of [this.land, this.seaMat]) { m.uniforms.uSun.value.copy(sun); m.uniforms.uAmbient.value.copy(ambient); m.uniforms.uSunK.value = sunK; m.uniforms.uSky.value.copy(sky); m.uniforms.uTime.value = time; }
  }

  destroy() { this.roots.forEach((r) => this.dispose(r)); this.scene.remove(this.group); }
}
