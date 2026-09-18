// Two-body orbital mechanics: elements, universal-variable Kepler propagation, orbit polylines, impact prediction.
import * as THREE from 'three';
import { P } from './planet.js';

const TAU = Math.PI * 2;

export function elements(r, v) {
  const mu = P.mu;
  const rm = r.length(), v2 = v.lengthSq();
  const h = new THREE.Vector3().crossVectors(r, v);
  const evec = new THREE.Vector3().crossVectors(v, h).divideScalar(mu).addScaledVector(r, -1 / rm);
  const e = evec.length();
  const energy = v2 / 2 - mu / rm;
  const a = Math.abs(energy) < 1e-9 ? Infinity : -mu / (2 * energy);
  const p = h.lengthSq() / mu;
  const hn = h.clone().normalize();
  const pHat = e > 1e-6 ? evec.clone().divideScalar(e) : r.clone().normalize();
  const qHat = new THREE.Vector3().crossVectors(hn, pHat);
  let nu = Math.atan2(r.dot(qHat), r.dot(pHat));
  if (nu < 0) nu += TAU;
  const o = { a, e, p, h: hn, pHat, qHat, nu, inc: Math.acos(Math.min(1, Math.max(-1, hn.y))) * 180 / Math.PI, pe: p / (1 + e) - P.R, ap: e < 1 ? a * (1 + e) - P.R : Infinity, period: e < 1 ? TAU * Math.sqrt(a * a * a / mu) : Infinity };
  if (e < 1) {
    const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
    let M = E - e * Math.sin(E);
    if (M < 0) M += TAU;
    const n = TAU / o.period;
    o.M = M; o.n = n;
    o.tPe = (TAU - M) / n;
    o.tAp = (((Math.PI - M) % TAU) + TAU) % TAU / n;
  } else {
    const F = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2));
    const n = Math.sqrt(mu / Math.abs(a * a * a));
    o.tPe = -(e * Math.sinh(F) - F) / n;
    o.tAp = Infinity;
  }
  return o;
}

const stumpff = (z) => {
  if (z > 1e-6) { const s = Math.sqrt(z); return [(1 - Math.cos(s)) / z, (s - Math.sin(s)) / (s * s * s)]; }
  if (z < -1e-6) { const s = Math.sqrt(-z); return [(1 - Math.cosh(s)) / z, (Math.sinh(s) - s) / (s * s * s)]; }
  return [0.5 - z / 24, 1 / 6 - z / 120];
};

// Advances (r, v) by dt along the Kepler orbit, in place.
export function propagate(r, v, dt) {
  const mu = P.mu, sq = Math.sqrt(mu);
  const r0 = r.length(), vr0 = r.dot(v) / r0;
  const alpha = 2 / r0 - v.lengthSq() / mu;
  let x = sq * Math.abs(alpha) * dt;
  if (alpha < 1e-12) x = Math.sign(dt) * Math.sqrt(-1 / Math.min(alpha, -1e-12)) * Math.log(Math.max(1e-9, (-2 * mu * alpha * dt) / (r.dot(v) + Math.sign(dt) * Math.sqrt(-mu / Math.min(alpha, -1e-12)) * (1 - r0 * alpha))));
  if (!Number.isFinite(x)) x = sq * dt / r0;
  let C = 0, S = 0;
  for (let i = 0; i < 60; i++) {
    const z = alpha * x * x;
    [C, S] = stumpff(z);
    const F = (r0 * vr0 / sq) * x * x * C + (1 - alpha * r0) * x * x * x * S + r0 * x - sq * dt;
    const dF = (r0 * vr0 / sq) * x * (1 - z * S) + (1 - alpha * r0) * x * x * C + r0;
    const dx = F / dF;
    x -= dx;
    if (Math.abs(dx) < 1e-7) break;
  }
  const z = alpha * x * x;
  [C, S] = stumpff(z);
  const f = 1 - (x * x / r0) * C, g = dt - (x * x * x / sq) * S;
  const nr = r.clone().multiplyScalar(f).addScaledVector(v, g);
  const rn = nr.length();
  const fd = (sq / (rn * r0)) * (z * S - 1) * x, gd = 1 - (x * x / rn) * C;
  const nv = r.clone().multiplyScalar(fd).addScaledVector(v, gd);
  r.copy(nr); v.copy(nv);
}

export function orbitPoints(o, n = 256) {
  const pts = [];
  let lo = 0, hi = TAU;
  if (o.e >= 1) { const lim = Math.acos(-1 / o.e) * 0.98; lo = -lim; hi = lim; }
  for (let i = 0; i <= n; i++) {
    const nu = lo + (hi - lo) * (i / n);
    const rr = o.p / (1 + o.e * Math.cos(nu));
    if (rr < 0 || rr > 4e7) continue;
    pts.push(new THREE.Vector3().addScaledVector(o.pHat, rr * Math.cos(nu)).addScaledVector(o.qHat, rr * Math.sin(nu)));
  }
  return pts;
}

export const pointAt = (o, nu) => { const rr = o.p / (1 + o.e * Math.cos(nu)); return new THREE.Vector3().addScaledVector(o.pHat, rr * Math.cos(nu)).addScaledVector(o.qHat, rr * Math.sin(nu)); };

// Vacuum impact prediction: where and when the orbit next crosses radius `rad` on the way down.
export function impact(o, rad) {
  if (o.pe + P.R >= rad || o.e < 1e-6) return null;
  const c = (o.p / rad - 1) / o.e;
  if (c < -1 || c > 1) return null;
  const nu = TAU - Math.acos(c);
  let t = Infinity;
  if (o.e < 1) {
    const E = 2 * Math.atan2(Math.sqrt(1 - o.e) * Math.sin(nu / 2), Math.sqrt(1 + o.e) * Math.cos(nu / 2));
    let M = E - o.e * Math.sin(E);
    if (M < 0) M += TAU;
    t = (((M - o.M) % TAU) + TAU) % TAU / o.n;
  }
  return { point: pointAt(o, nu), t };
}
