// Headless physics smoke test for the flight sim. Run: node tools/test_flight.mjs
import * as THREE from 'three';
import { Craft } from '../src/flight/craft.js';
import { Sim, padState } from '../src/flight/sim.js';
import { P } from '../src/flight/planet.js';
import { elements, propagate } from '../src/flight/orbit.js';

Craft.prototype.buildVisual = function () {};
const part = (id, type, parent, att) => ({ id, type, parent, att, sym: null, colors: null });
const design = { name: 'Test', root: 'a', parts: [
  part('a', 'probe_m', null, { k: 'f', pos: [0, 10, 0], yaw: 0 }),
  part('b', 'tank_m_3', 'a', { k: 's', pn: 'bottom', cn: 'top' }),
  part('c', 'engine_m_launch', 'b', { k: 's', pn: 'bottom', cn: 'top' }),
  ...[0, 1, 2, 3].map((i) => part(`f${i}`, 'fin_large', 'b', { k: 'r', off: [0.625 * Math.cos(i * Math.PI / 2), -1.6, 0.625 * Math.sin(i * Math.PI / 2)], ang: i * Math.PI / 2 })),
] };
const input = { pitch: 0, yaw: 0, roll: 0 };

{
  const sim = new Sim(0); const c = Craft.fromDesign(design); sim.add(c); sim.active = c;
  Object.assign(c, padState(0, c)); c.throttle = 0;
  for (let i = 0; i < 600; i++) sim.stepCraft(c, 1 / 120, input), sim.ut += 1 / 120;
  const tilt = new THREE.Vector3(0, 1, 0).applyQuaternion(c.q).angleTo(c.r.clone().normalize()) * 180 / Math.PI;
  console.log('rest: parts', c.parts.size, 'landed', c.landed, 'tilt deg', tilt.toFixed(3), 'agl', c.agl.toFixed(3), 'events', sim.events.map((e) => e.type + (e.cause || '')).join(','));
}
{
  const sim = new Sim(0); const c = Craft.fromDesign(design); sim.add(c); sim.active = c; c.clamped = true;
  sim.stepCraft(c, 1 / 120, input); sim.stage(c);
  let maxAlt = 0, maxV = 0, burnout = 0;
  for (let i = 0; i < 120 * 400 && sim.crafts.includes(c); i++) {
    sim.stepCraft(c, 1 / 120, input); sim.ut += 1 / 120;
    const alt = c.r.length() - P.R; maxAlt = Math.max(maxAlt, alt); maxV = Math.max(maxV, c.v.length());
    if (!burnout && c.resources().liquid[0] <= 0) { burnout = sim.ut; console.log('burnout t', burnout.toFixed(1), 'alt', alt.toFixed(0), 'v', c.v.length().toFixed(0), 'maxT', Math.max(...[...c.parts.values()].map((p) => p.temp)).toFixed(0)); }
    if (i % (120 * 50) === 0) console.log('t', sim.ut.toFixed(0), 'alt', alt.toFixed(0), 'g', c.gForce.toFixed(2), 'parts', c.parts.size);
  }
  console.log('flight: maxAlt', maxAlt.toFixed(0), 'maxV', maxV.toFixed(0), 'alive', sim.crafts.includes(c), 'events', [...new Set(sim.events.map((e) => e.type + (e.cause ? ':' + e.cause : '')))].join(','));
}
{
  const r = new THREE.Vector3(P.R + 100000, 0, 0), v = new THREE.Vector3(0, 0, -Math.sqrt(P.mu / (P.R + 100000)) * 1.1);
  const o = elements(r, v); const e0 = v.lengthSq() / 2 - P.mu / r.length();
  propagate(r, v, o.period * 3.37);
  const o2 = elements(r, v);
  console.log('orbit: pe', o.pe.toFixed(0), 'ap', o.ap.toFixed(0), 'T', o.period.toFixed(0), '-> pe', o2.pe.toFixed(0), 'ap', o2.ap.toFixed(0), 'dE', (v.lengthSq() / 2 - P.mu / r.length() - e0).toExponential(2));
  const r2 = new THREE.Vector3(P.R + 100000, 0, 0), v2 = new THREE.Vector3(0, 0, -Math.sqrt(P.mu / (P.R + 100000)) * 1.1);
  propagate(r2, v2, o.period); console.log('one period return error m', r2.distanceTo(new THREE.Vector3(P.R + 100000, 0, 0)).toFixed(3));
}
