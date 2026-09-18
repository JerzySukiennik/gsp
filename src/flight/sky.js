// Sky: stars, sun sprite, and a depth-aware post pass that renders atmospheric scattering and volumetric clouds.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { P } from './planet.js';

const RK = P.R / 1000, ATMO = RK + 62, C0 = RK + 4.2, C1 = RK + 8.2;

function noiseVolume(size = 64) {
  const data = new Uint8Array(size * size * size * 4);
  const lattice = (period, seed) => {
    const v = new Float32Array(period * period * period);
    let s = seed;
    for (let i = 0; i < v.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; v[i] = s / 4294967296; }
    return (x, y, z) => {
      const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
      let fx = x - xi, fy = y - yi, fz = z - zi;
      fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
      const at = (a, b, c) => v[(((a % period) + period) % period) + (((b % period) + period) % period) * period + (((c % period) + period) % period) * period * period];
      const l = (a, b, t) => a + (b - a) * t;
      return l(l(l(at(xi, yi, zi), at(xi + 1, yi, zi), fx), l(at(xi, yi + 1, zi), at(xi + 1, yi + 1, zi), fx), fy), l(l(at(xi, yi, zi + 1), at(xi + 1, yi, zi + 1), fx), l(at(xi, yi + 1, zi + 1), at(xi + 1, yi + 1, zi + 1), fx), fy), fz);
    };
  };
  const chans = [[4, 8, 16], [5, 10, 20], [12, 24, 48]].map((fs, c) => fs.map((f, o) => ({ f, n: lattice(f, 977 + c * 131 + o * 17) })));
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (x + y * size + z * size * size) * 4;
    for (let c = 0; c < 3; c++) {
      let sum = 0, a = 1, norm = 0;
      for (const { f, n } of chans[c]) { sum += a * n((x / size) * f, (y / size) * f, (z / size) * f); norm += a; a *= 0.5; }
      const v = (sum / norm - 0.5) * 2.1 + 0.5;
      data[i + c] = Math.max(0, Math.min(255, Math.round(v * 255)));
    }
    data[i + 3] = 255;
  }
  const tex = new THREE.Data3DTexture(data, size, size, size);
  tex.format = THREE.RGBAFormat; tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

const FRAG = `
precision highp float; precision highp sampler3D;
uniform sampler2D tDiffuse; uniform sampler2D tDepth; uniform sampler3D tNoise;
uniform mat4 uProjInv; uniform mat4 uCamWorld; uniform vec3 uCenter; uniform vec3 uSun; uniform vec3 uFwd;
uniform float uLogFar; uniform float uTime; uniform mat3 uRotInv; uniform float uClouds; uniform vec3 uSunTint;
varying vec2 vUv;
const float RK = ${RK.toFixed(1)}, ATMO = ${ATMO.toFixed(1)}, C0 = ${C0.toFixed(1)}, C1 = ${C1.toFixed(1)};
const vec3 BR = vec3(5.8e-3, 13.5e-3, 33.1e-3) * 1.5; const float BM = 4.0e-3 * 1.5; const float HR = 7.0, HM = 1.4, SUNI = 13.0;

vec2 rsi(vec3 ro, vec3 rd, float rad){ float b = dot(ro, rd), c = dot(ro, ro) - rad * rad, h = b * b - c; if (h < 0.0) return vec2(1e9, -1e9); h = sqrt(h); return vec2(-b - h, -b + h); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

float cloudAt(vec3 p){
  float h01 = (length(p) - C0) / (C1 - C0);
  if (h01 < 0.0 || h01 > 1.0) return 0.0;
  vec3 q = uRotInv * p;
  float cov = texture(tNoise, q * 0.0021 + vec3(uTime * 0.00003, 0.0, 0.0)).r + 0.22 * (texture(tNoise, q * 0.0093).g - 0.5);
  cov = smoothstep(0.50, 0.78, cov);
  if (cov <= 0.0) return 0.0;
  float shape = texture(tNoise, q * 0.034 + vec3(0.0, uTime * 0.0002, 0.0)).g * 0.72 + texture(tNoise, q * 0.19).b * 0.28;
  float hg = smoothstep(0.0, 0.12, h01) * smoothstep(1.0, 0.45, h01);
  float t = 1.0 - cov * 0.8;
  return smoothstep(t, t + 0.3, shape) * hg;
}

void main(){
  vec4 scene = texture2D(tDiffuse, vUv);
  float d = texture2D(tDepth, vUv).x;
  vec4 ndc = vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 dv = (uProjInv * ndc).xyz;
  vec3 rd = normalize((uCamWorld * vec4(normalize(dv), 0.0)).xyz);
  float sceneT = 1e9;
  if (d < 0.9999995) { float w = exp2(d * uLogFar) - 1.0; sceneT = w / max(dot(rd, uFwd), 1e-4) / 1000.0; }
  vec3 ro = -uCenter;
  vec3 col = scene.rgb;
  float jitter = hash(gl_FragCoord.xy + fract(uTime) * 61.0);

  float cloudA = 0.0, cloudT = sceneT; vec3 cloudC = vec3(0.0);
  if (uClouds > 0.5) {
    vec2 o = rsi(ro, rd, C1), i = rsi(ro, rd, C0), g = rsi(ro, rd, RK - 0.5);
    float cam = length(ro), ta = 0.0, tb = -1.0;
    if (cam > C1) { if (o.x > 0.0 && o.x < 1e8) { ta = o.x; tb = (i.x > 0.0 && i.x < 1e8) ? i.x : o.y; } }
    else if (cam > C0) { ta = 0.0; tb = (i.x > 0.0 && i.x < 1e8) ? i.x : o.y; }
    else { ta = i.y; tb = o.y; if (g.x > 0.0 && g.x < 1e8) tb = -1.0; }
    tb = min(tb, min(sceneT, ta + 260.0));
    if (tb > ta) {
      const int STEPS = 30;
      float dt = (tb - ta) / float(STEPS), t = ta + dt * jitter, trans = 1.0, wsum = 0.0, tacc = 0.0;
      for (int s = 0; s < STEPS; s++) {
        vec3 p = ro + rd * t;
        float dens = cloudAt(p);
        if (dens > 0.003) {
          float od = cloudAt(p + uSun * 0.35) * 0.35 + cloudAt(p + uSun * 0.9) * 0.6 + cloudAt(p + uSun * 2.0) * 1.2;
          float day = smoothstep(-0.12, 0.1, dot(normalize(p), uSun));
          float beer = exp(-od * 1.5), powder = 1.0 - exp(-dens * 4.0);
          vec3 light = uSunTint * SUNI * 0.55 * day * (beer * mix(0.55, 1.0, powder) + 0.06) + vec3(0.30, 0.38, 0.52) * day * 1.6 + vec3(0.004, 0.006, 0.012);
          float a = 1.0 - exp(-dens * 1.6 * dt);
          cloudC += trans * a * light * 0.16; tacc += trans * a * t; wsum += trans * a;
          trans *= 1.0 - a;
          if (trans < 0.03) break;
        }
        t += dt;
      }
      cloudA = 1.0 - trans;
      if (wsum > 0.0) cloudT = tacc / wsum;
      col = col * trans + cloudC;
    }
  }

  vec2 a = rsi(ro, rd, ATMO);
  if (a.y > 0.0 && a.x < 1e8) {
    float ta = max(a.x, 0.0), tb = min(a.y, mix(sceneT, min(cloudT, sceneT), cloudA));
    vec2 g = rsi(ro, rd, RK - 1.0);
    if (g.x > 0.0 && g.x < 1e8) tb = min(tb, g.x);
    if (tb > ta) {
      const int N = 12;
      float dt = (tb - ta) / float(N), odR = 0.0, odM = 0.0;
      vec3 sumR = vec3(0.0), sumM = vec3(0.0);
      for (int s = 0; s < N; s++) {
        vec3 p = ro + rd * (ta + dt * (float(s) + 0.5));
        float h = max(length(p) - RK, 0.0), dR = exp(-h / HR) * dt, dM = exp(-h / HM) * dt;
        odR += dR; odM += dM;
        vec2 sh = rsi(p, uSun, RK - 0.3);
        if (sh.x > 0.0 && sh.x < 1e8) continue;
        vec2 l = rsi(p, uSun, ATMO);
        float ldt = l.y / 4.0, lR = 0.0, lM = 0.0;
        for (int k = 0; k < 4; k++) { float lh = max(length(p + uSun * ldt * (float(k) + 0.5)) - RK, 0.0); lR += exp(-lh / HR) * ldt; lM += exp(-lh / HM) * ldt; }
        vec3 att = exp(-(BR * (odR + lR) + BM * 1.1 * (odM + lM)));
        sumR += att * dR; sumM += att * dM;
      }
      float mu = dot(rd, uSun), g2 = 0.76 * 0.76;
      float pR = 3.0 / (16.0 * 3.14159) * (1.0 + mu * mu);
      float pM = 3.0 / (8.0 * 3.14159) * ((1.0 - g2) * (1.0 + mu * mu)) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * 0.76 * mu, 1.5));
      col = col * exp(-(BR * odR + BM * 1.1 * odM)) + SUNI * (pR * BR * sumR + pM * BM * sumM);
    }
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export class AtmoPass extends Pass {
  constructor(camera) {
    super();
    this.camera = camera;
    this.uniforms = {
      tDiffuse: { value: null }, tDepth: { value: null }, tNoise: { value: noiseVolume() }, uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
      uCenter: { value: new THREE.Vector3() }, uSun: { value: new THREE.Vector3(1, 0, 0) }, uFwd: { value: new THREE.Vector3() }, uLogFar: { value: 1 }, uTime: { value: 0 },
      uRotInv: { value: new THREE.Matrix3() }, uClouds: { value: 1 }, uSunTint: { value: new THREE.Color(1, 1, 1) },
    };
    this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: FRAG, depthTest: false, depthWrite: false });
    this.quad = new FullScreenQuad(this.material);
  }

  // centerRel: planet centre relative to the camera, metres. rot: planet rotation quaternion.
  set(centerRel, sun, rot, time, sunTint) {
    const u = this.uniforms, cam = this.camera;
    u.uCenter.value.copy(centerRel).multiplyScalar(0.001);
    u.uSun.value.copy(sun);
    u.uProjInv.value.copy(cam.projectionMatrixInverse);
    u.uCamWorld.value.copy(cam.matrixWorld);
    cam.getWorldDirection(u.uFwd.value);
    u.uLogFar.value = Math.log2(cam.far + 1);
    u.uTime.value = time;
    u.uRotInv.value.setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(rot.clone().invert()));
    u.uSunTint.value.copy(sunTint);
  }

  render(renderer, writeBuffer, readBuffer) {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    this.uniforms.tDepth.value = readBuffer.depthTexture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose() { this.material.dispose(); this.quad.dispose(); this.uniforms.tNoise.value.dispose(); }
}

export function makeStars() {
  const n = 4200, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let s = 4242;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < n; i++) {
    const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z), b = Math.pow(rnd(), 2.6) * 0.95 + 0.05, t = rnd();
    pos.set([r * Math.cos(a) * 3e7, z * 3e7, r * Math.sin(a) * 3e7], i * 3);
    col.set([b * (0.8 + 0.2 * t), b * 0.9, b * (1 - 0.25 * t)], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.PointsMaterial({ size: 1.7, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false; pts.renderOrder = -10;
  return pts;
}

export function makeSun() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d'), g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.09, 'rgba(255,250,235,1)'); g.addColorStop(0.14, 'rgba(255,225,170,0.35)'); g.addColorStop(0.4, 'rgba(255,200,120,0.06)'); g.addColorStop(1, 'rgba(255,190,110,0)');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  const mat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: new THREE.Color(14, 13, 11) });
  const s = new THREE.Sprite(mat);
  s.scale.setScalar(2.9e7 * 0.16); s.renderOrder = -9;
  return s;
}
