// Headless ascent diagnostic: SAS-held vertical climb through sim.update. Run: node tools/test_ascent.mjs
import * as THREE from 'three';
import { Craft } from '../src/flight/craft.js';
import { Sim, padState } from '../src/flight/sim.js';
import { P, surfaceVelocity } from '../src/flight/planet.js';
Craft.prototype.buildVisual = function () {};
const part = (id, type, parent, att) => ({ id, type, parent, att, sym: null, colors: null });
const design = { name: 'T', root: 'a', parts: [part('a', 'probe_m', null, { k: 'f', pos: [0, 10, 0], yaw: 0 }), part('n', 'nose_m', 'a', { k: 's', pn: 'top', cn: 'bottom' }), part('b', 'tank_m_3', 'a', { k: 's', pn: 'bottom', cn: 'top' }), part('c', 'engine_m_launch', 'b', { k: 's', pn: 'bottom', cn: 'top' }),
  ...[0, 1, 2, 3].map((i) => part(`f${i}`, 'fin_large', 'b', { k: 'r', off: [0.625 * Math.cos(i * Math.PI / 2), -1.6, 0.625 * Math.sin(i * Math.PI / 2)], ang: i * Math.PI / 2 }))] };
const sim = new Sim(0); const c = Craft.fromDesign(design); c.clamped = true; sim.add(c); sim.active = c;
const inp = { pitch: 0, yaw: 0, roll: 0 };
sim.update(1 / 60, inp); sim.stage(c);
for (let i = 0; i < 60 * 80; i++) {
  sim.update(1 / 60, inp);
  if (i % 300 === 0) {
    const nose = new THREE.Vector3(0, 1, 0).applyQuaternion(c.q), up = c.r.clone().normalize(), vrel = c.v.clone().sub(surfaceVelocity(c.r));
    console.log('t', sim.ut.toFixed(0), 'alt', (c.r.length() - P.R).toFixed(0), 'vrel', vrel.length().toFixed(0), 'tilt', (nose.angleTo(up) * 57.3).toFixed(2), 'aoa', (vrel.length() > 1 ? nose.angleTo(vrel) * 57.3 : 0).toFixed(2), 'g', c.gForce.toFixed(2), 'w', c.w.length().toFixed(3), 'fuel', c.resources().liquid[0].toFixed(2));
  }
}
console.log([...new Set(sim.events.map((e) => e.type + (e.text || e.cause || '')))].join(' | '));
