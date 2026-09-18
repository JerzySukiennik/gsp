// Planet model: constants, atmosphere, simplex noise, terrain height function and launch-site frame.
import * as THREE from 'three';

export const P = { R: 600000, g0: 9.81, atmo: 70000, H: 5600, rho0: 1.225, day: 21600, siteAlt: 45, deck: 3.0 };
P.mu = P.g0 * P.R * P.R;
P.omega = (2 * Math.PI) / P.day;

export const SUN = new THREE.Vector3(0.643, 0, -0.766).normalize();
export const SITE = new THREE.Vector3(1, 0, 0);
const SEA_EAST = new THREE.Vector3(Math.cos(0.55), 0, -Math.sin(0.55));

export const density = (h) => (h < P.atmo ? P.rho0 * Math.exp(-Math.max(h, -500) / P.H) : 0);
export const pressure = (h) => (h < P.atmo ? Math.exp(-Math.max(h, -500) / P.H) : 0);

const perm = new Uint8Array(512);
(() => {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = 20120422;
  for (let i = 255; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
})();
const G3 = [1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1];

export function simplex(x, y, z) {
  const s = (x + y + z) / 3;
  const i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s);
  const t = (i + j + k) / 6;
  const x0 = x - i + t, y0 = y - j + t, z0 = z - k + t;
  let i1, j1, k1, i2, j2, k2;
  if (x0 >= y0) {
    if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; } else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; } else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
  } else if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; } else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; } else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
  const x1 = x0 - i1 + 1 / 6, y1 = y0 - j1 + 1 / 6, z1 = z0 - k1 + 1 / 6;
  const x2 = x0 - i2 + 1 / 3, y2 = y0 - j2 + 1 / 3, z2 = z0 - k2 + 1 / 3;
  const x3 = x0 - 0.5, y3 = y0 - 0.5, z3 = z0 - 0.5;
  const ii = i & 255, jj = j & 255, kk = k & 255;
  let n = 0;
  let tt = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
  if (tt > 0) { const g = (perm[ii + perm[jj + perm[kk]]] % 12) * 3; tt *= tt; n += tt * tt * (G3[g] * x0 + G3[g + 1] * y0 + G3[g + 2] * z0); }
  tt = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
  if (tt > 0) { const g = (perm[ii + i1 + perm[jj + j1 + perm[kk + k1]]] % 12) * 3; tt *= tt; n += tt * tt * (G3[g] * x1 + G3[g + 1] * y1 + G3[g + 2] * z1); }
  tt = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
  if (tt > 0) { const g = (perm[ii + i2 + perm[jj + j2 + perm[kk + k2]]] % 12) * 3; tt *= tt; n += tt * tt * (G3[g] * x2 + G3[g + 1] * y2 + G3[g + 2] * z2); }
  tt = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
  if (tt > 0) { const g = (perm[ii + 1 + perm[jj + 1 + perm[kk + 1]]] % 12) * 3; tt *= tt; n += tt * tt * (G3[g] * x3 + G3[g + 1] * y3 + G3[g + 2] * z3); }
  return 32 * n;
}

function fbm(x, y, z, f, oct) {
  let a = 1, sum = 0, norm = 0;
  for (let o = 0; o < oct; o++) { sum += a * simplex(x * f + o * 17.3, y * f - o * 9.1, z * f + o * 4.7); norm += a; a *= 0.5; f *= 2.03; }
  return sum / norm;
}

function ridged(x, y, z, f, oct) {
  let a = 1, sum = 0, norm = 0, prev = 1;
  for (let o = 0; o < oct; o++) {
    let n = 1 - Math.abs(simplex(x * f + o * 31.1, y * f + o * 12.7, z * f - o * 8.3));
    n *= n;
    sum += a * n * prev; prev = n; norm += a; a *= 0.5; f *= 2.1;
  }
  return sum / norm;
}

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Terrain height in metres above sea level for a unit vector in the planet-fixed frame.
// `spacing` is the vertex spacing of the caller, used to skip octaves that cannot be resolved.
export function heightAt(x, y, z, spacing = 0) {
  const dSite = Math.acos(Math.min(1, x * SITE.x + y * SITE.y + z * SITE.z)) * P.R;
  const dSea = Math.acos(Math.min(1, x * SEA_EAST.x + y * SEA_EAST.y + z * SEA_EAST.z)) * P.R;
  let c = fbm(x, y, z, 1.25, 6) * 1.15;
  c += 0.5 * Math.exp(-((dSite / 170000) ** 2)) - 0.75 * Math.exp(-((dSea / 150000) ** 2));
  const land = c - 0.03;
  let h;
  if (land > 0) {
    h = 1500 * land + 120 * sstep(0, 0.04, land);
    const m = sstep(0.12, 0.5, land) * (0.55 + 0.45 * fbm(x, y, z, 2.6, 3));
    const r = ridged(x, y, z, 9, spacing > 3000 ? 4 : 7);
    h += m * r * r * 5200;
    const inland = sstep(0, 0.08, land);
    if (spacing < 8000) h += fbm(x, y, z, 42, 5) * 190 * inland;
    if (spacing < 500) h += fbm(x, y, z, 640, 4) * 24 * inland;
    if (spacing < 30) h += fbm(x, y, z, 9000, 3) * 2.6 * inland;
    if (spacing < 3) h += fbm(x, y, z, 90000, 2) * 0.4 * inland;
  } else {
    h = -Math.pow(-land, 0.8) * 3800 - 2;
    if (spacing < 8000) h += fbm(x, y, z, 42, 3) * 60 * sstep(0, 0.1, -land);
  }
  const w = 1 - sstep(2200, 7000, dSite);
  return h * (1 - w) + P.siteAlt * w;
}

export const planetAngle = (ut) => (P.omega * ut) % (2 * Math.PI);

// Inertial <-> planet-fixed. The planet spins about +Y.
export function toFixed(v, ut, out = new THREE.Vector3()) {
  const a = -planetAngle(ut), c = Math.cos(a), s = Math.sin(a);
  return out.set(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
}
export function toInertial(v, ut, out = new THREE.Vector3()) {
  const a = planetAngle(ut), c = Math.cos(a), s = Math.sin(a);
  return out.set(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
}

// Launch-site frame in planet-fixed coordinates: X east, Y up, Z south.
export const SITE_FRAME = { up: SITE.clone(), east: new THREE.Vector3(0, 0, -1), south: new THREE.Vector3(0, -1, 0) };

// Ground radius and surface kind under an inertial position. Includes the launch platform deck.
export function groundAt(rInertial, ut) {
  const f = toFixed(rInertial, ut).normalize();
  let h = heightAt(f.x, f.y, f.z);
  const water = h < 0;
  if (water) h = 0;
  const ex = f.dot(SITE_FRAME.east) * P.R, sz = f.dot(SITE_FRAME.south) * P.R;
  if (f.x > 0.99 && Math.abs(ex) < 11 && Math.abs(sz) < 11) h = P.siteAlt + P.deck;
  return { radius: P.R + h, water, height: h };
}

export function surfaceVelocity(r, out = new THREE.Vector3()) { return out.set(P.omega * r.z, 0, -P.omega * r.x); }

export function latLon(rInertial, ut) {
  const f = toFixed(rInertial, ut).normalize();
  return { lat: Math.asin(f.y) * 180 / Math.PI, lon: Math.atan2(-f.z, f.x) * 180 / Math.PI };
}
