// Flight physics: thrust, per-part aerodynamics, heating, structural failure, ground contact, staging, SAS and time warp.
import * as THREE from 'three';
import { P, density, pressure, groundAt, surfaceVelocity, toInertial, SITE, SITE_FRAME } from './planet.js';
import { propagate, elements } from './orbit.js';
import { FINS, RADIAL_DRAG, WHEEL, CHUTE, AERO } from './craft.js';

const Y = new THREE.Vector3(0, 1, 0);
const tmp = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3(), e: new THREE.Vector3(), qi: new THREE.Quaternion() };
const aeroOf = (type) => { for (const k of Object.keys(AERO)) if (type.startsWith(k)) return AERO[k]; return {}; };
const STEP = 1 / 120;
export const WARPS = [1, 2, 3, 4, 10, 50, 100, 1000, 10000];

export function padState(ut, craft) {
  const b = craft.bounds();
  const off = craft.padOffset || 0;
  const up = toInertial(SITE.clone().multiplyScalar(P.R).addScaledVector(SITE_FRAME.east, off).normalize(), ut);
  const east = toInertial(SITE_FRAME.east, ut), south = toInertial(SITE_FRAME.south, ut);
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, up, south));
  const origin = up.clone().multiplyScalar(P.R + P.siteAlt + P.deck - b.lo + 0.02);
  const r = origin.add(craft.com.clone().applyQuaternion(q));
  return { r, v: surfaceVelocity(r), q };
}

export class Sim {
  constructor(ut) {
    this.ut = ut;
    this.crafts = [];
    this.active = null;
    this.events = [];
    this.warpIndex = 0;
    this.acc = 0;
    this.sas = { on: true, mode: 'hold', target: null };
    this.rcs = false;
    this.blackout = 0;
  }

  get warp() { return WARPS[this.warpIndex]; }
  emit(type, data) { this.events.push({ type, ...data }); }

  add(craft) { this.crafts.push(craft); return craft; }

  remove(craft) {
    this.crafts = this.crafts.filter((c) => c !== craft);
    this.emit('removed', { craft });
    if (this.active === craft) {
      const rest = [...this.crafts].sort((a, b) => (b.hasControl - a.hasControl) || (b.mass - a.mass));
      this.active = rest.find((c) => c.r.distanceTo(craft.r) < 5000) || null;
      this.emit('active', { craft: this.active });
    }
  }

  altitude(c) { return c.r.length() - P.R; }
  canRailsWarp(c) { return this.altitude(c) > P.atmo && !this.thrusting(c); }
  thrusting(c) { for (const p of c.parts.values()) if (p.on && !p.out && (p.fuel.solid > 0 || c.throttle > 0)) return true; return false; }

  setWarp(i) {
    const c = this.active;
    i = Math.max(0, Math.min(WARPS.length - 1, i));
    if (i > 3 && c && !this.canRailsWarp(c) && !c.landed) { this.emit('msg', { text: this.altitude(c) <= P.atmo ? 'Cannot warp faster inside the atmosphere' : 'Cannot warp while under thrust' }); i = Math.min(i, 3); }
    this.warpIndex = i;
  }

  // Advances the world by `real` seconds of wall-clock time.
  update(real, input) {
    const c = this.active;
    if (this.warpIndex > 3) {
      if (c && !c.landed && !this.canRailsWarp(c)) this.warpIndex = 0;
      else {
        let dt = Math.min(real, 0.05) * this.warp;
        if (c && !c.landed) {
          const o = elements(c.r, c.v);
          if (o.pe < P.atmo) {
            const probe = c.r.clone(), pv = c.v.clone();
            propagate(probe, pv, dt);
            if (probe.length() - P.R < P.atmo + 500) { this.warpIndex = 0; this.emit('msg', { text: 'Warp dropped — atmosphere ahead' }); dt = 0; }
          }
        }
        if (dt > 0) { this.ut += dt; for (const k of this.crafts) this.railStep(k, dt); return; }
      }
    }
    this.acc += Math.min(real, 0.05) * this.warp;
    let n = 0;
    while (this.acc >= STEP && n < 40) {
      this.acc -= STEP; n++;
      this.ut += STEP;
      for (const k of [...this.crafts]) {
        if (!this.crafts.includes(k)) continue;
        if (k !== this.active && this.active && k.r.distanceTo(this.active.r) > 25000) { this.farStep(k, STEP); continue; }
        this.stepCraft(k, STEP, k === this.active ? input : null);
      }
    }
    if (n === 40) this.acc = 0;
  }

  railStep(c, dt) {
    if (c.landed || c.clamped) { this.pinToSurface(c, dt); return; }
    propagate(c.r, c.v, dt);
    if (c !== this.active && c.r.length() - P.R < P.atmo * 0.6) this.remove(c);
  }

  farStep(c, dt) {
    if (c.landed || c.clamped) { this.pinToSurface(c, dt); return; }
    if (this.altitude(c) < P.atmo * 0.8) { this.remove(c); return; }
    propagate(c.r, c.v, dt);
  }

  pinToSurface(c, dt) {
    const a = P.omega * dt;
    const rot = tmp.qi.setFromAxisAngle(Y, a);
    c.r.applyQuaternion(rot);
    c.q.premultiply(rot);
    surfaceVelocity(c.r, c.v);
    c.w.set(0, 0, 0);
  }

  // ---------- control ----------

  torqueAuthority(c, qdyn) {
    let wheel = 0, pitch = 0, roll = 0;
    for (const p of c.parts.values()) {
      wheel += (WHEEL[p.type] || 0) * 1000;
      const arm = Math.abs(p.pos.y - c.com.y), lat = Math.hypot(p.pos.x - c.com.x, p.pos.z - c.com.z);
      if (p.on && !p.out && p.def.thrust && !p.def.fuel) { pitch += p.def.thrust.vac * 1000 * c.throttle * 0.09 * arm; roll += p.def.thrust.vac * 1000 * c.throttle * 0.09 * lat; }
      const fin = FINS[p.type];
      if (fin && fin.steer) { pitch += qdyn * fin.S * 3.0 * 0.26 * arm * 0.6; roll += qdyn * fin.S * 3.0 * 0.26 * lat; }
      if (this.rcs && p.type === 'rcs') { pitch += 1000 * Math.max(arm, 0.5); roll += 1000 * Math.max(lat, 0.3); }
    }
    return new THREE.Vector3(Math.max(wheel + pitch, 300), Math.max(wheel + roll, 300), Math.max(wheel + pitch, 300));
  }

  sasTargetDir(c) {
    const m = this.sas.mode;
    if (m === 'hold') return null;
    const orbital = this.altitude(c) > 36000;
    const vel = orbital ? c.v.clone() : c.v.clone().sub(surfaceVelocity(c.r, tmp.e));
    if (vel.length() < 1) return null;
    const pro = vel.normalize();
    const nrm = new THREE.Vector3().crossVectors(c.r, c.v).normalize();
    const rad = new THREE.Vector3().crossVectors(pro, nrm).normalize();
    return { prograde: pro, retrograde: pro.clone().negate(), normal: nrm, antinormal: nrm.clone().negate(), radialOut: rad, radialIn: rad.clone().negate() }[m] || null;
  }

  control(c, input, qdyn) {
    const ctrl = new THREE.Vector3();
    if (!c.hasControl || this.blackout > 1) return ctrl;
    const manual = new THREE.Vector3(input.pitch, input.roll, input.yaw);
    if (!this.sas.on) return manual;
    const auth = this.torqueAuthority(c, qdyn);
    const qi = tmp.qi.copy(c.q).invert();
    let err = new THREE.Vector3();
    const dir = this.sasTargetDir(c);
    if (dir) {
      const d = dir.clone().applyQuaternion(qi);
      err.crossVectors(Y, d);
      const s = err.length(), ang = Math.atan2(s, d.y);
      if (s > 1e-6) err.multiplyScalar(ang / s); else if (d.y < 0) err.set(Math.PI, 0, 0);
      err.y = 0;
    } else {
      if (!this.sas.target || manual.lengthSq() > 0) this.sas.target = c.q.clone();
      const dq = qi.clone().multiply(this.sas.target);
      if (dq.w < 0) { dq.x = -dq.x; dq.y = -dq.y; dq.z = -dq.z; dq.w = -dq.w; }
      const s = Math.hypot(dq.x, dq.y, dq.z);
      if (s > 1e-6) err.set(dq.x, dq.y, dq.z).multiplyScalar(2 * Math.atan2(s, dq.w) / s);
    }
    const wn = 2.6, zeta = 1.0;
    for (const ax of ['x', 'y', 'z']) {
      const alpha = wn * wn * err[ax] - 2 * zeta * wn * c.w[ax];
      ctrl[ax] = THREE.MathUtils.clamp((c.I[ax] * 1000 * alpha) / auth[ax], -1, 1);
      if (manual[ax] !== 0) ctrl[ax] = manual[ax];
    }
    return ctrl;
  }

  // ---------- staging and damage ----------

  stage(c) {
    if (!c || !c.hasControl) return;
    if (c.clamped) { c.clamped = false; this.emit('liftoff', { craft: c }); }
    c.landed = false; c.rest = 0;
    const s = c.stages.shift();
    if (!s) return;
    let shellChanged = false;
    for (const id of s) {
      const p = c.parts.get(id);
      if (!p) continue;
      const kind = p.def.stage;
      if (kind === 'engine') { p.on = true; this.emit('ignite', { craft: c, part: p }); }
      else if (kind === 'chute') { p.chute = 1; this.emit('chute', { craft: c, part: p }); }
      else if (kind === 'fairing' && p.shell) { p.shell = false; shellChanged = true; this.emit('fairing', { craft: c, part: p }); }
      else if (kind === 'decoupler' && p.parent) this.decouple(c, p);
    }
    if (shellChanged) c.rebuildStructure();
    this.emit('staged', { craft: c });
  }

  decouple(c, p) {
    const dirBody = p.def.radialOnly ? new THREE.Vector3(Math.cos(p.yaw), 0, Math.sin(p.yaw)) : new THREE.Vector3(0, 1, 0);
    const n = c.split(p.id);
    if (!p.def.radialOnly && n.com.y < c.com.y) dirBody.negate();
    const dir = dirBody.applyQuaternion(c.q);
    const total = c.mass + n.mass, sep = p.def.radialOnly ? 4 : 2.5;
    n.v.addScaledVector(dir, sep * c.mass / total);
    c.v.addScaledVector(dir, -sep * n.mass / total);
    if (p.def.radialOnly) n.w.add(new THREE.Vector3(-Math.sin(p.yaw), 0, Math.cos(p.yaw)).multiplyScalar(0.25));
    this.add(n);
    this.emit('decouple', { craft: c, other: n, part: p });
    this.adopt(c, n);
  }

  adopt(c, n) {
    if (this.active === c && !c.hasControl && n.hasControl) { this.active = n; n.name = c.name; n.debris = false; c.debris = true; c.name = `${n.name} debris`; this.emit('active', { craft: n }); }
  }

  destroyPart(c, p, cause) {
    if (p.dead) return;
    p.dead = true;
    this.emit('explode', { at: c.worldPoint(p.pos), size: Math.max(c.radius(p), 0.5) * (1 + (p.fuel.liquid || 0) + (p.fuel.solid || 0)) ** 0.33, cause, name: p.def.name, vel: c.v.clone() });
    for (const ch of c.children(p.id)) { const n = c.split(ch.id); this.add(n); this.adopt(c, n); }
    if (p.id === c.rootId) { c.group.remove(p.obj); this.remove(c); return; }
    const oldCom = c.com.clone();
    c.parts.delete(p.id);
    c.group.remove(p.obj);
    c.stages = c.stages.map((s) => s.filter((id) => id !== p.id));
    c.rebuildAfterLoss(oldCom);
  }

  // ---------- one physics step ----------

  stepCraft(c, dt, input) {
    if (c.clamped) { const s = padState(this.ut, c); c.r.copy(s.r); c.v.copy(s.v); c.q.copy(s.q); c.w.set(0, 0, 0); c.gForce = 1; return; }
    if (c.landed && !this.thrusting(c)) { this.pinToSurface(c, dt); c.gForce = 1; this.thermal(c, 0, 0, 0, dt); return; }
    c.landed = false;

    const rm = c.r.length(), alt = rm - P.R;
    const up = tmp.a.copy(c.r).divideScalar(rm);
    const rho = density(alt), pr = Math.min(pressure(alt), 1);
    const vrel = new THREE.Vector3().copy(c.v).sub(surfaceVelocity(c.r, tmp.b));
    const speed = vrel.length();
    const qi = new THREE.Quaternion().copy(c.q).invert();
    const vb = vrel.clone().applyQuaternion(qi);
    const qdyn = 0.5 * rho * speed * speed;
    const mach = speed / 320;
    const machK = 1 + 1.2 * Math.exp(-(((mach - 1.05) / 0.22) ** 2)) + (mach > 1 ? 0.15 : 0);
    const ctrl = input ? this.control(c, input, qdyn) : new THREE.Vector3();
    const cmag = Math.min(1, ctrl.length());

    const F = new THREE.Vector3(), T = new THREE.Vector3();
    const apply = (fb, at) => { F.add(fb); T.add(tmp.c.copy(at).sub(c.com).cross(fb)); };
    const k = 0.5 * rho * speed;
    const flux = rho > 0 ? 3e-7 * Math.sqrt(rho) * speed * speed * speed : 0;
    let burning = false;

    const pool = new Map();
    for (const p of c.parts.values()) if (p.fuel.liquid > 0) { if (!pool.has(p.group)) pool.set(p.group, []); pool.get(p.group).push(p); }

    for (const p of c.parts.values()) {
      const def = p.def;
      if (p.on && def.thrust) {
        const solid = def.fuel && def.fuel.solid !== undefined;
        const thr = solid ? 1 : c.throttle;
        const Tn = (def.thrust.asl * pr + def.thrust.vac * (1 - pr)) * 1000 * thr;
        const isp = def.isp.asl * pr + def.isp.vac * (1 - pr);
        let need = (Tn / (isp * P.g0)) / 1000 * dt, ok = Tn > 0;
        if (ok) {
          if (solid) { if (p.fuel.solid >= need) p.fuel.solid -= need; else { p.fuel.solid = 0; ok = false; } }
          else {
            const tanks = (pool.get(p.group) || []).filter((t) => t.fuel.liquid > 0);
            const have = tanks.reduce((a, t) => a + t.fuel.liquid, 0);
            if (have >= need) for (const t of tanks) t.fuel.liquid -= need * (t.fuel.liquid / have); else { for (const t of tanks) t.fuel.liquid = 0; ok = false; }
          }
        }
        if (!ok && Tn > 0 && !p.out) { p.out = true; this.emit('flameout', { craft: c, part: p }); }
        if (ok) { p.out = false; burning = true; }
        p.thrustNow = ok ? Tn : 0;
        if (ok) {
          const at = tmp.d.set(p.pos.x, p.pos.y - (def.h || 1) / 2, p.pos.z);
          const dir = new THREE.Vector3(0, 1, 0);
          if (!solid && cmag > 0) { const g = ctrl.clone().cross(tmp.e.copy(at).sub(c.com)); g.y = 0; if (g.lengthSq() > 1e-9) dir.add(g.normalize().multiplyScalar(cmag * 0.09)).normalize(); }
          apply(dir.multiplyScalar(Tn), at);
        }
      } else p.thrustNow = 0;

      let exposure = 0;
      if (rho > 0 && !p.shielded) {
        if (def.dia) {
          const r = def.dia / 2, h = def.h, a = aeroOf(p.type);
          const up2 = vb.y > 0;
          const front = up2 ? p.expTop : p.expBot, back = up2 ? p.expBot : p.expTop;
          const cdF = (up2 ? a.top : a.bot) ?? 0.85;
          let cdA = (cdF * front + 0.15 * back) * machK + 0.004 * Math.PI * def.dia * h;
          let latA = def.dia * h, cy = p.pos.y;
          if (p.shell) { const sh = def.dia === 2.5 ? 8 : 4; latA += def.dia * 1.25 * sh; cy += sh * 0.4; cdA += 0.12 * Math.PI * (r * 1.25) ** 2 * machK; }
          const kc = 0.5 * rho * Math.hypot(vb.x, vb.z) * 1.1 * latA;
          apply(new THREE.Vector3(-kc * vb.x, -k * vb.y * cdA, -kc * vb.z), tmp.d.set(p.pos.x, cy, p.pos.z));
          if (front > 0.05) {
            const blunt = cdF >= 0.8, kn = k * (blunt ? 0.7 : 0.5) * front;
            apply(new THREE.Vector3(-kn * vb.x, 0, -kn * vb.z), tmp.d.set(p.pos.x, p.pos.y + (blunt ? -Math.sign(vb.y) * 1.6 * def.dia : 0), p.pos.z));
          }
          exposure = front > 0.05 ? 1 : 0.12;
        } else {
          exposure = 0.3;
          const fin = FINS[p.type];
          const out = tmp.e.set(Math.cos(p.yaw), 0, Math.sin(p.yaw));
          if (fin) {
            const n = new THREE.Vector3(-Math.sin(p.yaw), 0, Math.cos(p.yaw));
            const at = new THREE.Vector3().copy(p.pos).addScaledVector(out, fin.span);
            let defl = 0;
            if (fin.steer && cmag > 0) { const arm = at.clone().sub(c.com); defl = THREE.MathUtils.clamp(ctrl.clone().cross(arm).dot(n) / Math.max(arm.length(), 0.1), -1, 1) * 0.26; }
            apply(n.clone().multiplyScalar(-k * (vb.dot(n) - speed * defl) * fin.S * 3.0), at);
            if (fin.grid) apply(vb.clone().multiplyScalar(-k * 0.35 * machK), at);
          } else {
            const A = RADIAL_DRAG[p.type] ?? 0.1;
            apply(vb.clone().multiplyScalar(-k * A * machK), p.pos);
            if (p.type === 'solar' && qdyn > 1800) { this.destroyPart(c, p, 'aerodynamic stress'); continue; }
          }
        }
        const ch = CHUTE[p.type];
        if (ch && p.chute > 0) {
          if (p.chute === 1 && c.agl !== undefined && c.agl < 900 && pr > 0.02) { p.chute = 2; this.emit('chuteFull', { craft: c, part: p }); }
          const goal = pr > 0.004 ? (p.chute === 2 ? ch.full : ch.semi) : 0;
          p.chuteArea = (p.chuteArea || 0) + (goal - (p.chuteArea || 0)) * Math.min(1, dt * 1.2);
          apply(vb.clone().multiplyScalar(-k * p.chuteArea), tmp.d.set(p.pos.x, p.pos.y + (def.h || 0.6) / 2, p.pos.z));
          if (qdyn > 22000 && p.chuteArea > 20) { p.chute = 0; p.chuteArea = 0; this.emit('msg', { text: 'Parachute torn off by aerodynamic forces' }); this.emit('chuteCut', { craft: c, part: p }); }
        }
      }
      p.temp += (flux * exposure - 0.06 * (p.temp - (alt > P.atmo ? 250 : 300))) * dt;
      if (p.temp > p.maxT) this.destroyPart(c, p, 'overheating');
    }
    if (!c.parts.size || !this.crafts.includes(c)) return;

    let wheel = 0;
    for (const p of c.parts.values()) {
      wheel += (WHEEL[p.type] || 0) * 1000;
      if (this.rcs && p.type === 'rcs' && cmag > 0) {
        const tank = [...c.parts.values()].find((t) => t.fuel.mono > 0);
        if (tank) { tank.fuel.mono = Math.max(0, tank.fuel.mono - 0.0006 * cmag * dt); wheel += 1000 * Math.max(1, Math.abs(p.pos.y - c.com.y)); }
      }
    }
    T.addScaledVector(ctrl, wheel);

    const aoa = speed > 5 ? Math.acos(THREE.MathUtils.clamp(Math.abs(vb.y) / speed, 0, 1)) : 0;
    c.stress = qdyn * Math.sin(aoa);
    c.maxQ = Math.max(c.maxQ, qdyn);
    c.overload = c.stress > 30000 ? (c.overload || 0) + dt : 0;
    if (c.overload > 0.45 && c.parts.size > 3 && c.bounds().size > 6) { c.overload = 0; this.structuralFailure(c); if (!this.crafts.includes(c)) return; }

    const Fw = F.clone().applyQuaternion(c.q);
    this.contact(c, Fw, T, up, dt);
    if (!this.crafts.includes(c)) return;

    const mkg = c.mass * 1000;
    c.gForce = Fw.length() / mkg / P.g0;
    c.accel = Fw.clone().divideScalar(mkg);
    const g = -P.mu / (rm * rm);
    c.v.addScaledVector(Fw, dt / mkg).addScaledVector(up, g * dt);
    c.r.addScaledVector(c.v, dt);

    const Ix = c.I.x * 1000, Iy = c.I.y * 1000, Iz = c.I.z * 1000, w = c.w;
    const wx = w.x + ((T.x - (Iz - Iy) * w.y * w.z) / Ix) * dt, wy = w.y + ((T.y - (Ix - Iz) * w.z * w.x) / Iy) * dt, wz = w.z + ((T.z - (Iy - Ix) * w.x * w.y) / Iz) * dt;
    w.set(wx, wy, wz);
    if (w.length() > 12) w.setLength(12);
    const ang = w.length() * dt;
    if (ang > 1e-9) c.q.multiply(tmp.qi.setFromAxisAngle(tmp.b.copy(w).normalize(), ang)).normalize();

    if (burning || this.rcs) { const shift = c.updateMass(); c.r.add(shift.applyQuaternion(c.q)); }

    if (c === this.active && c.crew) {
      if (c.gForce > 9) this.blackout += dt * (c.gForce - 8) * 0.6; else this.blackout = Math.max(0, this.blackout - dt * 0.7);
      this.blackout = Math.min(this.blackout, 4);
    }
    if (c !== this.active && alt < -50) this.remove(c);
  }

  thermal(c, flux, exposure, alt, dt) { for (const p of c.parts.values()) p.temp += -0.06 * (p.temp - 300) * dt; }

  structuralFailure(c) {
    const cand = [...c.parts.values()].filter((p) => p.parent && p.att && p.att.k === 'r' && !FINS[p.type]);
    const stack = [...c.parts.values()].filter((p) => p.parent && p.att && p.att.k === 's');
    const pick = cand.length ? cand[Math.floor(Math.random() * cand.length)] : stack[Math.floor(stack.length / 2)];
    if (!pick) return;
    this.emit('msg', { text: `Structural failure — ${pick.def.name} tore off` });
    this.emit('explode', { at: c.worldPoint(pick.pos), size: 0.6, cause: 'aerodynamic stress', name: pick.def.name, vel: c.v.clone(), quiet: true });
    const n = c.split(pick.id);
    n.w.add(new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5));
    this.add(n);
    this.adopt(c, n);
  }

  contact(c, Fw, T, up, dt) {
    const b = c.bounds();
    const reach = Math.max(b.hi - c.com.y, c.com.y - b.lo, b.rad) + 2;
    const gnd = groundAt(c.r, this.ut);
    c.agl = c.r.length() - gnd.radius - (c.com.y - b.lo);
    c.overWater = gnd.water;
    if (c.r.length() - gnd.radius > reach) { c.rest = 0; return; }
    const mkg = c.mass * 1000;
    const ww = c.w.clone().applyQuaternion(c.q);
    const qi = tmp.qi.copy(c.q).invert();
    let touching = 0;
    for (const cp of c.contacts) {
      if (cp.p.dead) continue;
      const pw = c.worldPoint(cp.at, new THREE.Vector3());
      const depth = gnd.radius - pw.length();
      if (depth <= 0) { cp.touch = false; continue; }
      const arm = pw.clone().sub(c.r);
      const vp = c.v.clone().add(ww.clone().cross(arm)).sub(surfaceVelocity(pw, tmp.b));
      const vn = vp.dot(up);
      if (!cp.touch) {
        cp.touch = true;
        const tol = cp.p.tol * (gnd.water ? 2.2 : 1);
        if (-vn > tol) { this.destroyPart(c, cp.p, gnd.water ? 'water impact' : 'ground impact'); if (!this.crafts.includes(c)) return; continue; }
        if (-vn > 1.5) this.emit('thud', { craft: c, speed: -vn, water: gnd.water });
      }
      touching++;
      const soft = cp.soft ? 0.45 : 1;
      const ks = gnd.water ? mkg * 2.5 : mkg * 40 * soft, cs = gnd.water ? mkg * 1.6 : mkg * 6;
      const fn = Math.max(0, ks * Math.min(depth, 1.5) - cs * vn);
      const vt = vp.clone().addScaledVector(up, -vn);
      const f = up.clone().multiplyScalar(fn).addScaledVector(vt, -(gnd.water ? mkg * 0.4 : Math.min(0.9 * fn / (vt.length() + 0.05), mkg * 12)));
      Fw.add(f);
      T.add(arm.cross(f).applyQuaternion(qi));
    }
    const vrel = c.v.clone().sub(surfaceVelocity(c.r, tmp.b)).length();
    if (touching && vrel < 0.35 && c.w.length() < 0.04 && !this.thrusting(c)) { c.rest = (c.rest || 0) + dt; if (c.rest > 2) { c.landed = true; this.emit('landed', { craft: c, water: gnd.water }); } } else c.rest = 0;
  }
}
