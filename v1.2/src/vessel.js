// Vessel data model: part tree, transforms, symmetry groups, staging, stats and serialization.
import { PARTS, fuelMass } from './catalog.js';

const G0 = 9.81;
let uid = 1;
const nextId = () => `p${uid++}`;

export const rotY = (x, z, a) => [x * Math.cos(a) - z * Math.sin(a), x * Math.sin(a) + z * Math.cos(a)];

export class Vessel {
  constructor() {
    this.name = 'Untitled Rocket';
    this.parts = new Map();
    this.rootId = null;
    this.manualStages = null;
  }

  get root() { return this.parts.get(this.rootId) || null; }
  get size() { return this.parts.size; }
  firstLoose() { const p = [...this.parts.values()].find((q) => !q.parent); return p ? p.id : null; }
  looseRoots() { return [...this.parts.values()].filter((q) => !q.parent); }
  def(p) { return PARTS[p.type]; }
  children(id) { return [...this.parts.values()].filter((p) => p.parent === id); }

  subtreeIds(id) {
    const out = [id];
    for (let i = 0; i < out.length; i++) for (const c of this.children(out[i])) out.push(c.id);
    return out;
  }

  symGroup(p) { return p.sym ? [...this.parts.values()].filter((q) => q.sym === p.sym) : [p]; }

  usedNodes(id) {
    const used = new Set();
    const p = this.parts.get(id);
    if (p && p.att && p.att.k === 's') used.add(p.att.cn);
    for (const c of this.children(id)) if (c.att.k === 's') used.add(c.att.pn);
    return used;
  }

  transforms() {
    const out = new Map();
    const walk = (p, pos, yaw) => {
      out.set(p.id, { pos, yaw });
      for (const c of this.children(p.id)) {
        const cd = this.def(c), pd = this.def(p);
        if (c.att.k === 's') {
          walk(c, [pos[0], pos[1] + pd.nodes[c.att.pn].y - cd.nodes[c.att.cn].y, pos[2]], yaw);
        } else {
          const [ox, oz] = rotY(c.att.off[0], c.att.off[2], yaw);
          walk(c, [pos[0] + ox, pos[1] + c.att.off[1], pos[2] + oz], yaw + c.att.ang);
        }
      }
    };
    for (const p of this.parts.values()) if (!p.parent) walk(p, p.att && p.att.pos ? [...p.att.pos] : [0, 0, 0], (p.att && p.att.yaw) || 0);
    return out;
  }

  // Inserts a detached subtree (records with ids local to `sub`) under `parentId`, replicated over `atts`.
  insert(sub, parentId, atts) {
    const symMap = new Map();
    const multi = atts.length > 1;
    const created = [];
    atts.forEach(({ parent, att }) => {
      const idMap = new Map();
      sub.forEach((rec, j) => {
        const id = nextId();
        idMap.set(rec.id, id);
        let sym = null;
        if (multi || rec.sym) {
          const key = rec.sym || `solo${j}`;
          if (!symMap.has(key)) symMap.set(key, nextId());
          sym = symMap.get(key);
        }
        const isRoot = j === 0;
        this.parts.set(id, {
          id, type: rec.type, parent: isRoot ? parent : idMap.get(rec.parent), att: isRoot ? att : rec.att,
          sym, colors: rec.colors ? { ...rec.colors } : null,
        });
        if (isRoot) created.push(id);
      });
    });
    if (parentId === null && !this.rootId) this.rootId = created[0];
    for (const [, g] of symMap) {
      const members = [...this.parts.values()].filter((p) => p.sym === g);
      if (members.length < 2) members.forEach((p) => { p.sym = null; });
    }
    return created;
  }

  // Detaches the subtree at `id` (and all its symmetry siblings); returns one subtree as plain records.
  detach(id) {
    const p = this.parts.get(id);
    const group = this.symGroup(p);
    const parent = this.parts.get(p.parent);
    const parentGroup = parent ? this.symGroup(parent).length : 1;
    const ids = this.subtreeIds(id);
    const sub = ids.map((i) => ({ ...this.parts.get(i) }));
    sub[0] = { ...sub[0], parent: null, att: null, sym: null };
    const roots = group.filter((g) => !group.some((o) => o !== g && this.subtreeIds(o.id).includes(g.id)));
    for (const g of roots) for (const i of this.subtreeIds(g.id)) this.parts.delete(i);
    if (!this.parts.has(this.rootId)) this.rootId = this.firstLoose();
    const inner = new Set(sub.map((r) => r.sym).filter(Boolean));
    for (const s of inner) if (sub.filter((r) => r.sym === s).length < 2) sub.forEach((r) => { if (r.sym === s) r.sym = null; });
    return { sub, symmetry: Math.max(1, Math.round(group.length / parentGroup)) };
  }

  stackDepth(p) {
    let d = 0;
    for (let q = p; q; q = this.parts.get(q.parent)) { const def = this.def(q); if (def.stage === 'decoupler' && !def.radialOnly) d++; }
    return d;
  }

  autoStages() {
    const items = [...this.parts.values()].filter((p) => this.def(p).stage);
    if (!items.length) return [];
    const maxD = Math.max(...items.map((p) => this.stackDepth(p)));
    const order = (p) => {
      const def = this.def(p), d = this.stackDepth(p);
      if (def.stage === 'chute') return 1e6;
      if (def.stage === 'engine') return 2 * (maxD - d);
      if (def.radialOnly) return 2 * (maxD - d) + 0.5;
      return 2 * (maxD - d) + 1;
    };
    const byOrder = new Map();
    for (const p of items) {
      const o = order(p);
      if (!byOrder.has(o)) byOrder.set(o, []);
      byOrder.get(o).push(p.id);
    }
    return [...byOrder.keys()].sort((a, b) => a - b).map((k) => byOrder.get(k));
  }

  // Stage 0 fires first.
  stages() {
    if (!this.manualStages) return this.autoStages();
    const live = new Set([...this.parts.values()].filter((p) => this.def(p).stage).map((p) => p.id));
    const seen = new Set();
    const st = this.manualStages.map((s) => s.filter((id) => live.has(id) && !seen.has(id) && seen.add(id)));
    const missing = [...live].filter((id) => !seen.has(id));
    if (missing.length) {
      if (!st.length) st.push([]);
      for (const id of missing) (this.def(this.parts.get(id)).stage === 'chute' ? st[st.length - 1] : st[0]).push(id);
    }
    this.manualStages = st.filter((s) => s.length);
    return this.manualStages;
  }

  moveStage(id, dir) {
    const st = this.stages().map((s) => [...s]);
    const p = this.parts.get(id);
    const ids = new Set(this.symGroup(p).map((q) => q.id));
    const i = st.findIndex((s) => s.includes(id));
    const j = i + dir;
    st[i] = st[i].filter((x) => !ids.has(x));
    if (j < 0) st.unshift([...ids]);
    else if (j >= st.length) st.push([...ids]);
    else st[j].push(...ids);
    this.manualStages = st.filter((s) => s.length);
  }

  stats() {
    let wet = 0, dry = 0;
    const fuel = { liquid: 0, solid: 0, mono: 0 };
    for (const p of this.parts.values()) {
      const d = this.def(p);
      dry += d.mass;
      wet += d.mass + fuelMass(d);
      for (const [k, v] of Object.entries(d.fuel || {})) fuel[k] += v;
    }
    const st = this.stages();
    const first = st.find((s) => s.some((id) => this.def(this.parts.get(id)).stage === 'engine')) || [];
    let thrust = 0;
    for (const id of first) { const d = this.def(this.parts.get(id)); if (d.thrust) thrust += d.thrust.asl; }
    const tf = this.transforms();
    let minY = Infinity, maxY = -Infinity;
    for (const p of this.parts.values()) {
      const d = this.def(p), y = tf.get(p.id).pos[1], h = d.h || 1;
      minY = Math.min(minY, y - h / 2); maxY = Math.max(maxY, y + h / 2);
    }
    const warnings = [];
    const all = [...this.parts.values()].map((p) => this.def(p));
    if (this.size) {
      if (!all.some((d) => d.command)) warnings.push('No command module');
      if (!all.some((d) => d.thrust)) warnings.push('No engine');
      else if (thrust / (wet * G0) < 1) warnings.push('Liftoff TWR below 1 — it will not leave the pad');
      if (all.some((d) => d.crew) && !all.some((d) => d.stage === 'chute')) warnings.push('Crew aboard and no parachute');
    }
    return { wet, dry, fuel, thrust, twr: wet ? thrust / (wet * G0) : 0, parts: this.size, height: this.size ? maxY - minY : 0, stages: st.length, warnings };
  }

  toJSON() {
    return { v: 1, name: this.name, root: this.rootId, parts: [...this.parts.values()], stages: this.manualStages };
  }

  static fromJSON(data) {
    const v = new Vessel();
    if (!data || !Array.isArray(data.parts)) return v;
    v.name = data.name || v.name;
    const idMap = new Map();
    for (const p of data.parts) if (PARTS[p.type]) idMap.set(p.id, nextId());
    const symMap = new Map();
    for (const p of data.parts) {
      if (!idMap.has(p.id) || (p.parent && !idMap.has(p.parent))) continue;
      if (p.sym && !symMap.has(p.sym)) symMap.set(p.sym, nextId());
      const id = idMap.get(p.id);
      v.parts.set(id, { id, type: p.type, parent: p.parent ? idMap.get(p.parent) : null, att: p.att || null, sym: p.sym ? symMap.get(p.sym) : null, colors: p.colors || null });
    }
    v.rootId = idMap.get(data.root) || null;
    if (!v.parts.has(v.rootId)) v.rootId = v.firstLoose();
    if (Array.isArray(data.stages)) v.manualStages = data.stages.map((s) => s.map((id) => idMap.get(id)).filter(Boolean));
    return v;
  }
}
