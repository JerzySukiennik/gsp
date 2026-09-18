// Headless mission test: launch, stage separation, coast, re-entry, parachute, touchdown. Run: node tools/test_mission.mjs
import * as THREE from 'three';
import { Craft } from '../src/flight/craft.js';
import { Sim } from '../src/flight/sim.js';
import { P, surfaceVelocity } from '../src/flight/planet.js';
Craft.prototype.buildVisual = function () {};
const part = (id, type, parent, att) => ({ id, type, parent, att, sym: null, colors: null });
const S = (pn, cn) => ({ k: 's', pn, cn });
const design = { name: 'Mission', root: 'cap', parts: [
  part('cap', 'capsule', null, { k: 'f', pos: [0, 20, 0], yaw: 0 }), part('ch', 'chute_m', 'cap', S('top', 'bottom')), part('hs', 'heatshield_l', 'cap', S('bottom', 'top')),
  part('d1', 'decoupler_l', 'hs', S('bottom', 'top')), part('t1', 'tank_l_2', 'd1', S('bottom', 'top')), part('e1', 'engine_l_launch', 't1', S('bottom', 'top')),
  ...[0, 1, 2, 3].map((i) => part(`f${i}`, 'fin_large', 't1', { k: 'r', off: [1.25 * Math.cos(i * Math.PI / 2), -1.3, 1.25 * Math.sin(i * Math.PI / 2)], ang: i * Math.PI / 2 })),
] };
const sim = new Sim(0); const c0 = Craft.fromDesign(design); c0.clamped = true; sim.add(c0); sim.active = c0;
console.log('stages', c0.stages.map((s) => s.map((id) => c0.parts.get(id).type)));
const inp = { pitch: 0, yaw: 0, roll: 0 };
sim.update(1 / 60, inp); sim.stage(sim.active);
let phase = 'ascent', maxG = 0, maxT = 0, last = 0;
for (let i = 0; i < 60 * 3000 && sim.active; i++) {
  const c = sim.active;
  sim.update(1 / 60, inp);
  if (!sim.active) break;
  const a = sim.active, alt = a.r.length() - P.R, vrel = a.v.clone().sub(surfaceVelocity(a.r));
  maxG = Math.max(maxG, a.gForce); for (const p of a.parts.values()) maxT = Math.max(maxT, p.temp);
  if (phase === 'ascent' && a.resources().liquid[0] <= 0) { phase = 'coast'; sim.stage(a); console.log('t', sim.ut.toFixed(0), 'burnout+sep alt', alt.toFixed(0), 'v', vrel.length().toFixed(0), 'crafts', sim.crafts.length, 'active parts', sim.active.parts.size); sim.sas.mode = 'retrograde'; }
  if (phase === 'coast' && vrel.dot(a.r) < 0 && alt < 60000) { phase = 'entry'; console.log('t', sim.ut.toFixed(0), 'entry v', vrel.length().toFixed(0)); }
  if (phase === 'entry' && alt < 4000) { phase = 'chute'; sim.stage(a); console.log('t', sim.ut.toFixed(0), 'chute at v', vrel.length().toFixed(0), 'maxG', maxG.toFixed(1), 'maxT', maxT.toFixed(0)); }
  if (a.landed) { console.log('t', sim.ut.toFixed(0), 'LANDED parts', a.parts.size, 'water', a.overWater, 'alt', alt.toFixed(1)); break; }
  if (sim.ut - last > 60) { last = sim.ut; console.log('  t', sim.ut.toFixed(0), phase, 'alt', alt.toFixed(0), 'v', vrel.length().toFixed(0), 'g', a.gForce.toFixed(1), 'crafts', sim.crafts.length); }
}
console.log('active', !!sim.active, 'events:', [...new Set(sim.events.map((e) => e.type + (e.text ? ':' + e.text : '') + (e.cause ? ':' + e.name + ':' + e.cause : '')))].join(' | '));
