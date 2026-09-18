// Flight vessel: rigid-body state, part tree, mass properties, fuel groups, staging, splitting, serialization.
import * as THREE from 'three';
import { PARTS, fuelMass } from '../catalog.js';
import { Vessel, rotY } from '../vessel.js';
import { makePart } from '../assets.js';

let craftSeq = 1;

const AERO = {
  nose: { top: 0.1 }, capsule: { top: 0.22, bot: 1.0 }, heatshield: { bot: 1.0 }, engine: { bot: 0.45 }, adapter: { top: 0.3 },
  chute_m: { top: 0.3 }, srb: { bot: 0.4 }, fairing: { top: 0.3 },
};
const FINS = { fin_small: { S: 0.4, span: 0.3, steer: false }, fin_large: { S: 2.6, span: 0.8, steer: true }, gridfin: { S: 1.1, span: 0.1, steer: true, grid: true } };
const RADIAL_DRAG = { leg: 0.5, rcs: 0.03, solar: 3.2, antenna: 0.8, radial_decoupler: 0.2, chute_radial: 0.08 };
const TOL = { leg: 14, capsule: 12, heatshield: 12, engine: 7, tank: 6, srb: 7, nose: 8, probe: 8, fin: 8, gridfin: 8 };
const MAXT = { heatshield: 3600, nose: 2500, engine: 2300, capsule: 2100, fairing: 2600, srb: 1900 };
const WHEEL = { probe_s: 0.6, probe_m: 2, capsule: 9, wheel_m: 18 };
const CHUTE = { chute_m: { semi: 9, full: 620 }, chute_radial: { semi: 4, full: 260 } };

const family = (id) => Object.keys({ ...AERO, ...TOL, ...MAXT }).find((k) => id.startsWith(k)) || '';
const lookup = (table, id, dflt) => { for (const k of Object.keys(table)) if (id.startsWith(k)) return table[k]; return dflt; };

export class Craft {
  constructor() {
    this.id = `c${craftSeq++}`;
    this.name = 'Craft';
    this.parts = new Map();
    this.rootId = null;
    this.r = new THREE.Vector3();
    this.v = new THREE.Vector3();
    this.q = new THREE.Quaternion();
    this.w = new THREE.Vector3();
    this.throttle = 1;
    this.stages = [];
    this.clamped = false;
    this.landed = false;
    this.rails = false;
    this.debris = false;
    this.launchUT = 0;
    this.group = new THREE.Group();
    this.com = new THREE.Vector3();
    this.mass = 1;
    this.I = new THREE.Vector3(1, 1, 1);
    this.gForce = 1;
    this.maxQ = 0;
  }

  // Builds a craft from an editor design. Only the assembly holding a command part (or the main root) flies.
  static fromDesign(data) {
    const v = Vessel.fromJSON(data);
    const c = new Craft();
    c.name = v.name;
    const roots = v.looseRoots();
    const hasCmd = (root) => v.subtreeIds(root.id).some((id) => PARTS[v.parts.get(id).type].command);
    const root = roots.find(hasCmd) || v.parts.get(v.rootId);
    if (!root) return null;
    const ids = new Set(v.subtreeIds(root.id));
    const tf = v.transforms();
    const o = tf.get(root.id).pos;
    for (const id of ids) {
      const p = v.parts.get(id), t = tf.get(id), def = PARTS[p.type];
      c.parts.set(id, {
        id, type: p.type, def, parent: id === root.id ? null : p.parent, att: p.att, colors: p.colors,
        pos: new THREE.Vector3(t.pos[0] - o[0], t.pos[1] - o[1], t.pos[2] - o[2]), yaw: t.yaw,
        fuel: { ...(def.fuel || {}) }, temp: 300, on: false, chute: 0, shell: !!def.shell, dead: false,
      });
    }
    c.rootId = root.id;
    c.stages = v.stages().map((s) => s.filter((id) => ids.has(id))).filter((s) => s.length);
    c.rebuildStructure();
    c.buildVisual();
    return c;
  }

  children(id) { const out = []; for (const p of this.parts.values()) if (p.parent === id) out.push(p); return out; }

  subtree(id) {
    const out = [id];
    for (let i = 0; i < out.length; i++) for (const c of this.children(out[i])) out.push(c.id);
    return out;
  }

  radius(p) { return p.def.dia ? p.def.dia / 2 : 0.3; }

  // Derived data that only changes when the part tree changes.
  rebuildStructure() {
    const groupOf = new Map();
    const find = (id) => { while (groupOf.get(id) !== id) id = groupOf.get(id); return id; };
    for (const p of this.parts.values()) groupOf.set(p.id, p.id);
    for (const p of this.parts.values()) {
      if (!p.parent) continue;
      const par = this.parts.get(p.parent);
      if (p.def.stage === 'decoupler' || par.def.stage === 'decoupler') continue;
      groupOf.set(find(p.id), find(par.id));
    }
    for (const p of this.parts.values()) {
      p.group = find(p.id);
      p.fam = family(p.type);
      p.tol = lookup(TOL, p.type, 7);
      p.maxT = lookup(MAXT, p.type, 1600);
      p.shielded = false;
      const r = this.radius(p);
      p.expTop = p.expBot = p.def.dia ? Math.PI * r * r : 0;
    }
    for (const p of this.parts.values()) {
      if (!p.parent || !p.att || p.att.k !== 's') continue;
      const par = this.parts.get(p.parent);
      const cover = (a, node, other) => { const rc = Math.min(this.radius(a), this.radius(other)); const key = node === 'top' ? 'expTop' : 'expBot'; a[key] = Math.max(0, a[key] - Math.PI * rc * rc); };
      cover(par, p.att.pn, p);
      cover(p, p.att.cn, par);
    }
    for (const p of this.parts.values()) {
      if (!p.shell) continue;
      for (const c of this.children(p.id)) if (c.att.k === 's' && c.att.pn === 'top') for (const id of this.subtree(c.id)) this.parts.get(id).shielded = true;
    }
    this.contacts = [];
    for (const p of this.parts.values()) {
      const r = this.radius(p), h = p.def.h || 0.6;
      if (p.type === 'leg') { const [x, z] = rotY(1.27, 0, p.yaw); this.contacts.push({ p, at: new THREE.Vector3(p.pos.x + x, p.pos.y - 1.45, p.pos.z + z), soft: true }); continue; }
      if (!p.def.dia) { const [x, z] = rotY(0.4, 0, p.yaw); this.contacts.push({ p, at: new THREE.Vector3(p.pos.x + x, p.pos.y, p.pos.z + z) }); continue; }
      for (const s of [-1, 1]) {
        if ((s < 0 ? p.expBot : p.expTop) < 0.01 && h > 0.5) continue;
        for (let k = 0; k < 4; k++) this.contacts.push({ p, at: new THREE.Vector3(p.pos.x + Math.cos(k * Math.PI / 2) * r, p.pos.y + s * h / 2, p.pos.z + Math.sin(k * Math.PI / 2) * r) });
      }
      if (h > 1.5) for (let k = 0; k < 4; k++) this.contacts.push({ p, at: new THREE.Vector3(p.pos.x + Math.cos(k * Math.PI / 2 + 0.78) * r, p.pos.y, p.pos.z + Math.sin(k * Math.PI / 2 + 0.78) * r) });
    }
    this.updateMass();
    this.hasControl = [...this.parts.values()].some((p) => p.def.command);
    this.crew = [...this.parts.values()].some((p) => p.def.crew);
  }

  updateMass() {
    let m = 0;
    const com = new THREE.Vector3();
    for (const p of this.parts.values()) {
      p.m = p.def.mass + (p.fuel.liquid || 0) + (p.fuel.solid || 0) + (p.fuel.mono || 0);
      m += p.m; com.addScaledVector(p.pos, p.m);
    }
    com.divideScalar(m || 1);
    let ix = 0, iy = 0, iz = 0;
    for (const p of this.parts.values()) {
      const dx = p.pos.x - com.x, dy = p.pos.y - com.y, dz = p.pos.z - com.z, r = this.radius(p), h = p.def.h || 0.5;
      const own = p.m * (3 * r * r + h * h) / 12;
      ix += p.m * (dy * dy + dz * dz) + own; iz += p.m * (dy * dy + dx * dx) + own; iy += p.m * (dx * dx + dz * dz) + p.m * r * r / 2;
    }
    const shift = com.clone().sub(this.com);
    this.com.copy(com);
    this.mass = Math.max(m, 0.001);
    this.I.set(Math.max(ix, 0.01), Math.max(iy, 0.01), Math.max(iz, 0.01));
    return shift;
  }

  buildVisual() {
    this.group.clear();
    for (const p of this.parts.values()) {
      const o = makePart(p.type, p.colors);
      o.position.copy(p.pos);
      o.rotation.y = -p.yaw;
      o.traverse((m) => { if (m.userData.shell) { m.material.opacity = 1; m.material.transparent = false; m.material.depthWrite = true; m.visible = p.shell; } });
      p.obj = o;
      this.group.add(o);
    }
  }

  bounds() {
    let lo = Infinity, hi = -Infinity, rad = 0;
    for (const p of this.parts.values()) {
      const h = p.def.h || 1;
      lo = Math.min(lo, p.pos.y - h / 2); hi = Math.max(hi, p.pos.y + h / 2);
      rad = Math.max(rad, Math.hypot(p.pos.x, p.pos.z) + this.radius(p) + (p.def.dia ? 0 : 1));
    }
    return { lo, hi, rad, size: Math.max(hi - lo, rad * 2) };
  }

  worldPoint(local, out = new THREE.Vector3()) { return out.copy(local).sub(this.com).applyQuaternion(this.q).add(this.r); }

  // Moves the part subtree at `id` into a new craft that inherits this craft's motion.
  split(id) {
    const ids = this.subtree(id);
    const n = new Craft();
    n.name = `${this.name} debris`;
    n.debris = true;
    for (const pid of ids) { const p = this.parts.get(pid); this.parts.delete(pid); n.parts.set(pid, p); this.group.remove(p.obj); n.group.add(p.obj); }
    n.parts.get(id).parent = null;
    n.rootId = id;
    n.q.copy(this.q); n.w.copy(this.w); n.throttle = 0; n.launchUT = this.launchUT;
    const oldCom = this.com.clone();
    n.rebuildStructure();
    const shift = this.rebuildAfterLoss(oldCom);
    const arm = n.com.clone().sub(oldCom).applyQuaternion(this.q);
    n.r.copy(this.r).sub(shift).add(arm);
    n.v.copy(this.v).add(this.w.clone().applyQuaternion(this.q).cross(arm));
    n.stages = this.stages.map((s) => s.filter((x) => n.parts.has(x))).filter((s) => s.length);
    this.stages = this.stages.map((s) => s.filter((x) => this.parts.has(x)));
    while (this.stages.length && !this.stages[0].length) this.stages.shift();
    if (n.hasControl) n.debris = false;
    return n;
  }

  rebuildAfterLoss(oldCom) {
    this.com.copy(oldCom);
    this.rebuildStructure();
    const moved = this.com.clone().sub(oldCom).applyQuaternion(this.q);
    this.r.add(moved);
    this.v.add(this.w.clone().applyQuaternion(this.q).cross(moved));
    return moved;
  }

  serialize() {
    return {
      name: this.name, root: this.rootId, r: this.r.toArray(), v: this.v.toArray(), q: this.q.toArray(), w: this.w.toArray(),
      throttle: this.throttle, stages: this.stages, clamped: this.clamped, landed: this.landed, debris: this.debris, launchUT: this.launchUT,
      parts: [...this.parts.values()].map((p) => ({ id: p.id, type: p.type, parent: p.parent, att: p.att, colors: p.colors, pos: p.pos.toArray(), yaw: p.yaw, fuel: p.fuel, temp: p.temp, on: p.on, chute: p.chute, shell: p.shell })),
    };
  }

  static deserialize(d) {
    const c = new Craft();
    c.name = d.name; c.rootId = d.root;
    c.r.fromArray(d.r); c.v.fromArray(d.v); c.q.fromArray(d.q); c.w.fromArray(d.w);
    c.throttle = d.throttle; c.stages = d.stages.map((s) => [...s]); c.clamped = d.clamped; c.landed = d.landed; c.debris = d.debris; c.launchUT = d.launchUT || 0;
    for (const p of d.parts) {
      if (!PARTS[p.type]) continue;
      c.parts.set(p.id, { ...p, def: PARTS[p.type], pos: new THREE.Vector3().fromArray(p.pos), fuel: { ...p.fuel }, dead: false });
    }
    c.rebuildStructure();
    c.buildVisual();
    return c;
  }

  resources() {
    const out = { liquid: [0, 0], solid: [0, 0], mono: [0, 0] };
    for (const p of this.parts.values()) for (const k of Object.keys(p.def.fuel || {})) { out[k][0] += p.fuel[k] || 0; out[k][1] += p.def.fuel[k]; }
    return out;
  }
}

export { FINS, RADIAL_DRAG, WHEEL, CHUTE, AERO, fuelMass };
