// Flight effects: engine plumes, smoke and explosion particles, re-entry glow, jettisoned fairing shells.
import * as THREE from 'three';
import { pressure, surfaceVelocity, P } from './planet.js';

const LOGV = '#include <common>\n#include <logdepthbuf_pars_vertex>';
const LOGF = '#include <common>\n#include <logdepthbuf_pars_fragment>';

const plumeGeo = new THREE.CylinderGeometry(1, 1, 1, 28, 10, true).translate(0, -0.5, 0);
const plumeMat = () => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  uniforms: { uSpread: { value: 1 }, uPower: { value: 0 }, uTime: { value: 0 }, uSolid: { value: 0 } },
  vertexShader: `${LOGV}
    uniform float uSpread; varying float vT; varying vec3 vN; varying vec3 vV;
    void main(){ vT = uv.y; vec3 p = position; float k = mix(uSpread, 1.0, pow(uv.y, 1.6)); p.xz *= k;
      vec4 mv = modelViewMatrix * vec4(p, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv;
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: `${LOGF}
    uniform float uPower; uniform float uTime; uniform float uSolid; varying float vT; varying vec3 vN; varying vec3 vV;
    void main(){
      #include <logdepthbuf_fragment>
      float rim = pow(abs(dot(normalize(vN), normalize(vV))), 1.4);
      float flick = 0.85 + 0.15 * sin(uTime * 61.0 + vT * 40.0) * sin(uTime * 37.0 + vT * 13.0);
      float a = pow(vT, mix(1.5, 0.9, uSolid)) * rim * flick * uPower;
      vec3 hot = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.9, 0.7), uSolid), cool = mix(vec3(1.0, 0.45, 0.1), vec3(1.0, 0.55, 0.15), uSolid);
      vec3 c = mix(cool, hot, pow(vT, 2.2)) * mix(3.0, 6.0, uSolid);
      gl_FragColor = vec4(c * a, a);
    }`,
});

const glowMat = () => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { uK: { value: 0 }, uTime: { value: 0 } },
  vertexShader: `${LOGV}
    varying vec3 vN; varying vec3 vV; varying float vY;
    void main(){ vY = position.y; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv;
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: `${LOGF}
    uniform float uK; uniform float uTime; varying vec3 vN; varying vec3 vV; varying float vY;
    void main(){
      #include <logdepthbuf_fragment>
      float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.2);
      float along = smoothstep(-1.0, 0.9, vY);
      float a = uK * (0.15 + rim) * along * (0.85 + 0.15 * sin(uTime * 50.0 + vY * 9.0));
      gl_FragColor = vec4(mix(vec3(1.0, 0.3, 0.06), vec3(1.0, 0.85, 0.6), along * uK) * a * 4.0, a);
    }`,
});

const MAXP = 3000;

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.plumes = new Map();
    this.world = [];
    this.count = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAXP * 3); this.data = new Float32Array(MAXP * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aData', new THREE.BufferAttribute(this.data, 3));
    this.smokeMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: { uScale: { value: 600 }, uLight: { value: 1 } },
      vertexShader: `${LOGV}
        attribute vec3 aData; uniform float uScale; varying vec3 vD;
        void main(){ vD = aData; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = min(aData.y * uScale / max(-mv.z, 0.5), 900.0); gl_Position = projectionMatrix * mv;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `${LOGF}
        uniform float uLight; varying vec3 vD;
        void main(){
          #include <logdepthbuf_fragment>
          vec2 q = gl_PointCoord - 0.5; float r = length(q) * 2.0; if (r > 1.0) discard;
          float age = vD.x, heat = vD.z * pow(1.0 - age, 3.0);
          vec3 smoke = mix(vec3(0.82, 0.80, 0.78), vec3(0.45, 0.44, 0.43), age) * (0.25 + 0.75 * uLight);
          vec3 c = mix(smoke, vec3(3.5, 1.6, 0.4), clamp(heat, 0.0, 1.0));
          float a = pow(1.0 - r, 1.3) * pow(1.0 - age, 1.4) * mix(0.42, 0.9, clamp(heat, 0.0, 1.0));
          gl_FragColor = vec4(c, a);
        }`,
    });
    this.points = new THREE.Points(g, this.smokeMat);
    this.points.frustumCulled = false; this.points.renderOrder = 5;
    scene.add(this.points);
    this.glow = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), glowMat());
    this.glow.visible = false; this.glow.renderOrder = 6;
    scene.add(this.glow);
    this.flashes = [];
    this.loose = [];
    this.light = new THREE.PointLight(0xffb070, 0, 400, 1.6);
    scene.add(this.light);
    this.time = 0;
  }

  emit(at, vel, size, life, heat) {
    if (this.world.length >= MAXP) this.world.shift();
    this.world.push({ at: at.clone(), vel: vel.clone(), size, life, age: 0, heat, grow: size * (1.5 + Math.random()) });
  }

  explode(at, vel, size, quiet) {
    const n = quiet ? 14 : 46;
    for (let i = 0; i < n; i++) {
      const d = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar((4 + Math.random() * 16) * Math.sqrt(size));
      this.emit(at, vel.clone().add(d), size * (1.2 + Math.random() * 1.6), 2.5 + Math.random() * 3.5, quiet ? 0.2 : 1);
    }
    if (quiet) return;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ color: new THREE.Color(9, 5, 1.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, map: FX.flashTex() }));
    s.userData = { at: at.clone(), vel: vel.clone(), age: 0, size: size * 9 };
    this.scene.add(s); this.flashes.push(s);
  }

  static flashTex() {
    if (FX._tex) return FX._tex;
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,200,120,0.6)'); g.addColorStop(1, 'rgba(255,120,30,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    return (FX._tex = new THREE.CanvasTexture(c));
  }

  jettisonShell(craft, part) {
    part.obj.traverse((m) => {
      if (!m.userData.shell || m.userData.gone) return;
      m.userData.gone = true; m.visible = false;
      for (const side of [-1, 1]) {
        const half = m.clone();
        half.material = m.material.clone();
        half.material.clippingPlanes = [new THREE.Plane(new THREE.Vector3(side, 0, 0), 0)];
        half.visible = true;
        const holder = new THREE.Group();
        holder.add(half);
        half.position.set(0, 0, 0); half.rotation.set(0, 0, 0);
        const base = new THREE.Vector3(part.pos.x, part.pos.y + part.def.h / 2, part.pos.z);
        const out = new THREE.Vector3(side, 0.15, 0).applyQuaternion(craft.q);
        this.loose.push({ holder, half, side, rel: base.sub(craft.com).applyQuaternion(craft.q), vel: out.multiplyScalar(5), q: craft.q.clone(), spin: new THREE.Vector3(0, 0, -side * 0.9).applyQuaternion(craft.q), age: 0, craft });
        this.scene.add(holder);
      }
    });
  }

  ensurePlume(part) {
    let m = this.plumes.get(part.id);
    if (!m) {
      m = new THREE.Mesh(plumeGeo, plumeMat());
      m.renderOrder = 7; m.frustumCulled = false;
      m.position.y = -(part.def.h || 1) / 2 + (part.def.fuel ? 0 : 0.02);
      part.obj.add(m);
      m.rotation.y = part.yaw;
      this.plumes.set(part.id, m);
    }
    return m;
  }

  update(dt, sim, origin, camera, sunLight) {
    this.time += dt;
    let lightPow = 0; const lightAt = new THREE.Vector3();
    for (const c of sim.crafts) {
      const alt = c.r.length() - P.R, pr = Math.min(pressure(alt), 1);
      for (const p of c.parts.values()) {
        if (!p.def.thrust) continue;
        const frac = p.thrustNow ? p.thrustNow / (p.def.thrust.vac * 1000) : 0;
        if (frac <= 0) { const m = this.plumes.get(p.id); if (m) m.visible = false; continue; }
        const solid = !!p.def.fuel, r = (p.def.dia / 2) * (solid ? 0.78 : p.type.endsWith('vac') ? 0.97 : 0.72);
        const m = this.ensurePlume(p);
        m.visible = true;
        const len = r * (solid ? 16 : 9 + 14 * (1 - pr)) * (0.35 + 0.65 * frac);
        m.scale.set(r, len, r);
        m.material.uniforms.uSpread.value = 1.15 + 5.5 * (1 - pr) ** 2;
        m.material.uniforms.uPower.value = (0.5 + 0.5 * frac) * (0.55 + 0.45 * pr);
        m.material.uniforms.uTime.value = this.time; m.material.uniforms.uSolid.value = solid ? 1 : 0;
        const nozzle = c.worldPoint(new THREE.Vector3(p.pos.x, p.pos.y - (p.def.h || 1) / 2, p.pos.z));
        lightPow += frac * p.def.thrust.vac; lightAt.copy(nozzle);
        if (pr > 0.03 && (solid || alt < 9000) && Math.random() < (solid ? 1 : 0.5) * Math.min(1, dt * 60)) {
          const back = new THREE.Vector3(0, -1, 0).applyQuaternion(c.q);
          const atm = surfaceVelocity(nozzle);
          const low = c.agl !== undefined && c.agl < 45;
          const vel = atm.clone().addScaledVector(back, low ? 6 : 28).add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(low ? 40 : 7));
          this.emit(nozzle.clone().addScaledVector(back, len * 0.7), vel, r * (solid ? 3 : 2.2), (solid ? 7 : 3.5) * (0.6 + Math.random() * 0.8) * pr + 1, solid ? 0.8 : 0.35);
        }
      }
    }
    this.light.intensity = Math.min(lightPow * 3, 6000);
    this.light.position.copy(lightAt).sub(origin);

    const up = camera.position.clone().add(origin).normalize();
    let n = 0;
    for (let i = this.world.length - 1; i >= 0; i--) {
      const s = this.world[i];
      s.age += dt;
      if (s.age > s.life) { this.world.splice(i, 1); continue; }
      const drag = Math.exp(-dt * 1.4), atm = surfaceVelocity(s.at);
      s.vel.sub(atm).multiplyScalar(drag).add(atm).addScaledVector(up, dt * 2.2);
      s.at.addScaledVector(s.vel, dt);
    }
    for (const s of this.world) {
      if (n >= MAXP) break;
      this.pos[n * 3] = s.at.x - origin.x; this.pos[n * 3 + 1] = s.at.y - origin.y; this.pos[n * 3 + 2] = s.at.z - origin.z;
      const a = s.age / s.life;
      this.data[n * 3] = a; this.data[n * 3 + 1] = s.size + s.grow * Math.sqrt(a) * 2.5; this.data[n * 3 + 2] = s.heat;
      n++;
    }
    this.points.geometry.setDrawRange(0, n);
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.aData.needsUpdate = true;
    this.smokeMat.uniforms.uScale.value = innerHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    this.smokeMat.uniforms.uLight.value = sunLight;

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i], u = f.userData;
      u.age += dt; u.at.addScaledVector(u.vel, dt);
      f.position.copy(u.at).sub(origin);
      f.scale.setScalar(u.size * (0.4 + u.age * 5));
      f.material.opacity = Math.max(0, 1 - u.age / 0.55);
      if (u.age > 0.55) { this.scene.remove(f); f.material.dispose(); this.flashes.splice(i, 1); }
    }

    for (let i = this.loose.length - 1; i >= 0; i--) {
      const l = this.loose[i];
      l.age += dt;
      l.rel.addScaledVector(l.vel, dt);
      const back = l.craft.accel ? l.craft.accel.clone().multiplyScalar(-1) : new THREE.Vector3();
      l.vel.addScaledVector(back, dt);
      l.q.premultiply(new THREE.Quaternion().setFromAxisAngle(l.spin.clone().normalize(), l.spin.length() * dt));
      l.holder.position.copy(l.craft.r).add(l.rel).sub(origin);
      l.holder.quaternion.copy(l.q);
      l.half.material.clippingPlanes[0].setFromNormalAndCoplanarPoint(new THREE.Vector3(l.side, 0, 0).applyQuaternion(l.q), l.holder.position);
      if (l.age > 12 || l.rel.length() > 3000) { this.scene.remove(l.holder); this.loose.splice(i, 1); }
    }

    const c = sim.active;
    this.glow.visible = false;
    if (c) {
      const alt = c.r.length() - P.R;
      const vrel = c.v.clone().sub(surfaceVelocity(c.r));
      const rho = alt < P.atmo ? P.rho0 * Math.exp(-alt / P.H) : 0;
      const flux = 3e-7 * Math.sqrt(rho) * vrel.length() ** 3;
      const k = THREE.MathUtils.smoothstep(flux, 35, 260);
      if (k > 0.01) {
        const b = c.bounds(), dir = vrel.clone().normalize();
        this.glow.visible = true;
        this.glow.position.copy(c.r).sub(origin).addScaledVector(dir, -b.size * 0.9);
        this.glow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        this.glow.scale.set(b.rad * 1.5 + 0.6, b.size * 2.2, b.rad * 1.5 + 0.6);
        this.glow.material.uniforms.uK.value = k; this.glow.material.uniforms.uTime.value = this.time;
      }
      this.heatK = k;
    }
  }

  clear() {
    for (const f of this.flashes) this.scene.remove(f);
    for (const l of this.loose) this.scene.remove(l.holder);
    this.flashes = []; this.loose = []; this.world = []; this.plumes.clear();
  }
}
