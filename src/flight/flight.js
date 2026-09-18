// Flight controller: scene, cameras, input, rollout cinematic, render pipeline, quicksave, revert and world persistence.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { P, SUN, SITE, SITE_FRAME, toFixed, toInertial, planetAngle, groundAt, surfaceVelocity, pressure, density } from './planet.js';
import { elements } from './orbit.js';
import { Craft } from './craft.js';
import { Sim, padState } from './sim.js';
import { Terrain } from './terrain.js';
import { AtmoPass, makeStars, makeSun } from './sky.js';
import { FX } from './fx.js';
import { Navball } from './navball.js';
import { MapView } from './map.js';
import { HUD } from './hud.js';
import { FlightAudio } from './audio.js';
import { getExtra } from '../assets.js';
import { saveWorld } from '../world.js';

const Y = new THREE.Vector3(0, 1, 0);
const CAMS = ['Chase', 'Onboard', 'Tracking'];
const ROLL_FROM = -428, ROLL_TIME = 12;
const QUICK = 'gsp_quicksave_v1';

export class Flight {
  constructor({ renderer, canvas, design, world, resumeIndex = -1, onExit }) {
    Object.assign(this, { renderer, canvas, design, world, onExit });
    this.snapshot = JSON.stringify(world);
    this.keys = new Set();
    this.camMode = 0;
    this.cam = { theta: 0.95, phi: 1.42, dist: 40 };
    this.mapOn = false;
    this.speedManual = null;
    this.paused = false;
    this.shown = new Map();
    this.origin = new THREE.Vector3();
    this.time = 0;
    this.initScene();
    this.hud = new HUD(this.actions());
    this.map = new MapView(this.hud.labels);
    this.navball = new Navball();
    this.audio = new FlightAudio();
    this.start(resumeIndex);
    this.bind();
    this.clock = performance.now();
    renderer.setAnimationLoop(() => this.frame());
  }

  // ---------- setup ----------

  initScene() {
    const r = this.renderer;
    r.localClippingEnabled = true;
    r.toneMappingExposure = 1.0;
    r.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    const pmrem = new THREE.PMREMGenerator(r);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.3;
    pmrem.dispose();
    this.camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.3, 1e8);
    this.sun = new THREE.DirectionalLight(0xfff4e2, 3.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    Object.assign(this.sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 10, far: 900 });
    this.sun.shadow.bias = -0.0005; this.sun.shadow.normalBias = 0.06;
    this.hemi = new THREE.HemisphereLight(0xbfd6ff, 0x3a3328, 0.6);
    scene.add(this.sun, this.sun.target, this.hemi);
    this.stars = makeStars(); this.sunSprite = makeSun();
    scene.add(this.stars, this.sunSprite);
    this.terrain = new Terrain(scene, getExtra('tree'));
    this.site = getExtra('site').clone(true);
    this.crawler = getExtra('crawler').clone(true);
    for (const o of [this.site, this.crawler]) o.traverse((m) => { if (m.isMesh) { m.receiveShadow = true; m.castShadow = true; } });
    scene.add(this.site, this.crawler);
    this.fx = new FX(scene);

    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { samples: 4, type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(size.x, size.y) });
    this.composer = new EffectComposer(r, target);
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.atmo = new AtmoPass(this.camera);
    this.composer.addPass(this.atmo);
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.3, 0.7, 1.15));
    this.composer.addPass(new OutputPass());
    this.resize();
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.composer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  start(resumeIndex) {
    const world = JSON.parse(this.snapshot);
    const sim = this.sim = new Sim(world.ut || 0);
    for (const v of world.vessels) sim.add(Craft.deserialize(v));
    if (resumeIndex >= 0 && sim.crafts[resumeIndex]) {
      sim.active = sim.crafts[resumeIndex];
      this.cine = null;
    } else {
      const c = Craft.fromDesign(this.design);
      c.clamped = true; c.padOffset = ROLL_FROM; c.launchUT = sim.ut;
      Object.assign(c, padState(sim.ut, c));
      sim.add(c); sim.active = c;
      this.cine = { t: 0 };
    }
    sim.sas.on = true;
    const b = sim.active.bounds();
    this.cam.dist = b.size * 2.2 + 14;
    this.hud.setCinematic(!!this.cine);
    this.hud.fade(1);
    this.fadeT = 1;
    this.updateHint();
  }

  clearCrafts() { for (const g of this.shown.values()) this.scene.remove(g); this.shown.clear(); this.fx.clear(); }

  actions() {
    return {
      map: () => this.toggleMap(), cam: () => this.nextCam(), menu: () => this.openMenu(), resume: () => this.closeMenu(),
      revertLaunch: () => { this.closeMenu(); this.clearCrafts(); this.start(-1); },
      revertHangar: () => { saveWorld(JSON.parse(this.snapshot)); this.exit(); },
      leave: () => this.leave(), quickload: () => { this.closeMenu(); this.quickload(); },
      sas: () => this.toggleSAS(), rcs: () => { this.sim.rcs = !this.sim.rcs; }, sasMode: (m) => { this.sim.sas.on = true; this.sim.sas.mode = m; this.sim.sas.target = null; },
      speedMode: () => { this.speedManual = !this.isOrbital(); }, warp: (i) => this.sim.setWarp(i),
    };
  }

  toggleSAS() { this.sim.sas.on = !this.sim.sas.on; this.sim.sas.target = null; }
  toggleMap() { this.mapOn = !this.mapOn; this.hud.setMap(this.mapOn); if (!this.mapOn) this.map.hide(); }
  nextCam() { this.camMode = (this.camMode + 1) % CAMS.length; }
  openMenu(title = 'Paused', text = '') { this.paused = true; this.hud.menu(true, title, text); }
  closeMenu() { if (!this.sim.active) return; this.paused = false; this.hud.menu(false); this.clock = performance.now(); }

  updateHint() {
    const c = this.sim.active;
    if (this.cine) this.hud.hint('<kbd>Any key</kbd> skip rollout');
    else if (c && c.clamped) this.hud.hint('<kbd>Space</kbd> launch <kbd>Z</kbd> full throttle <kbd>X</kbd> cut <kbd>WASD QE</kbd> steer <kbd>T</kbd> SAS <kbd>M</kbd> map <kbd>V</kbd> camera <kbd>, .</kbd> warp <kbd>F5 F9</kbd> quicksave');
    else this.hud.hint('');
  }

  // ---------- input ----------

  bind() {
    const c = this.canvas;
    this.handlers = {
      keydown: (e) => {
        if (e.repeat) { if ([' ', 'F5', 'F9', 'Tab'].includes(e.key)) e.preventDefault(); return; }
        const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        this.keys.add(k);
        if (this.cine) { this.cine.t = ROLL_TIME; return; }
        if ([' ', 'F5', 'F9'].includes(k)) e.preventDefault();
        if (k === 'Escape') { if (this.hud.menuOpen) this.closeMenu(); else this.openMenu(); return; }
        if (this.paused) return;
        const s = this.sim, a = s.active;
        if (k === ' ') { s.setWarp(Math.min(s.warpIndex, 3)); s.stage(a); this.updateHint(); }
        else if (k === 't') this.toggleSAS();
        else if (k === 'r') s.rcs = !s.rcs;
        else if (k === 'm') this.toggleMap();
        else if (k === 'v') this.nextCam();
        else if (k === 'z' && a) a.throttle = 1;
        else if (k === 'x' && a) a.throttle = 0;
        else if (k === '.') s.setWarp(s.warpIndex + 1);
        else if (k === ',') s.setWarp(s.warpIndex - 1);
        else if (k === '/') s.setWarp(0);
        else if (k === 'F5') this.quicksave();
        else if (k === 'F9') this.quickload();
        else if (k === ']' || k === '[') this.switchVessel(k === ']' ? 1 : -1);
      },
      keyup: (e) => { this.keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key); },
      blur: () => this.keys.clear(),
      resize: () => this.resize(),
      pointerdown: (e) => { if (this.cine) { this.cine.t = ROLL_TIME; return; } c.setPointerCapture(e.pointerId); this.drag = { x: e.clientX, y: e.clientY }; },
      pointermove: (e) => {
        if (!this.drag) return;
        const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
        this.drag = { x: e.clientX, y: e.clientY };
        if (this.mapOn) this.map.orbit(dx, dy);
        else { this.cam.theta -= dx * 0.005; this.cam.phi = THREE.MathUtils.clamp(this.cam.phi - dy * 0.005, 0.05, 3.09); }
      },
      pointerup: () => { this.drag = null; },
      wheel: (e) => { e.preventDefault(); if (this.mapOn) this.map.zoom(e.deltaY); else this.cam.dist = THREE.MathUtils.clamp(this.cam.dist * Math.exp(e.deltaY * 0.0012), 4, 50000); },
    };
    const h = this.handlers;
    addEventListener('keydown', h.keydown); addEventListener('keyup', h.keyup); addEventListener('blur', h.blur); addEventListener('resize', h.resize);
    c.addEventListener('pointerdown', h.pointerdown); c.addEventListener('pointermove', h.pointermove); c.addEventListener('pointerup', h.pointerup);
    c.addEventListener('wheel', h.wheel, { passive: false });
  }

  unbind() {
    const h = this.handlers, c = this.canvas;
    removeEventListener('keydown', h.keydown); removeEventListener('keyup', h.keyup); removeEventListener('blur', h.blur); removeEventListener('resize', h.resize);
    c.removeEventListener('pointerdown', h.pointerdown); c.removeEventListener('pointermove', h.pointermove); c.removeEventListener('pointerup', h.pointerup); c.removeEventListener('wheel', h.wheel);
  }

  input(dt) {
    const k = this.keys, a = this.sim.active;
    if (a && !this.paused) {
      if (k.has('Shift')) a.throttle = Math.min(1, a.throttle + dt * 0.7);
      if (k.has('Control')) a.throttle = Math.max(0, a.throttle - dt * 0.7);
    }
    return { pitch: (k.has('s') ? 1 : 0) - (k.has('w') ? 1 : 0), yaw: (k.has('a') ? 1 : 0) - (k.has('d') ? 1 : 0), roll: (k.has('e') ? 1 : 0) - (k.has('q') ? 1 : 0) };
  }

  switchVessel(dir) {
    const s = this.sim, near = s.crafts.filter((c) => c === s.active || (s.active && c.r.distanceTo(s.active.r) < 25000));
    if (near.length < 2) { this.hud.message('No other vessel within 25 km'); return; }
    s.active = near[(near.indexOf(s.active) + dir + near.length) % near.length];
    s.sas.target = null;
    this.hud.message(`Now flying ${s.active.name}`);
  }

  // ---------- save / exit ----------

  state() { return { ut: this.sim.ut, active: this.sim.crafts.indexOf(this.sim.active), crafts: this.sim.crafts.map((c) => ({ ...c.serialize(), padOffset: c.padOffset || 0 })), sas: { ...this.sim.sas, target: null }, rcs: this.sim.rcs }; }

  quicksave() {
    if (!this.sim.active) return;
    try { localStorage.setItem(QUICK, JSON.stringify(this.state())); this.hud.message('Quicksaved'); } catch { this.hud.message('Quicksave failed — storage is full'); }
  }

  quickload() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(QUICK)); } catch { d = null; }
    if (!d) { this.hud.message('No quicksave yet — press F5 to make one'); return; }
    this.clearCrafts();
    const sim = this.sim = new Sim(d.ut);
    for (const v of d.crafts) { const c = Craft.deserialize(v); c.padOffset = v.padOffset; sim.add(c); }
    sim.active = sim.crafts[d.active] || sim.crafts[0];
    Object.assign(sim.sas, d.sas); sim.rcs = d.rcs;
    this.cine = null; this.paused = false; this.hud.menu(false); this.hud.setCinematic(false);
    this.hud.message('Quicksave loaded'); this.updateHint();
  }

  leave() {
    const keep = this.sim.crafts.filter((c) => !c.clamped && (c.landed || elements(c.r, c.v).pe > P.atmo) && (c.landed ? !c.debris : true));
    saveWorld({ ut: this.sim.ut, vessels: keep.map((c) => c.serialize()) });
    this.exit();
  }

  exit() {
    this.renderer.setAnimationLoop(null);
    this.unbind();
    this.clearCrafts();
    this.terrain.destroy();
    this.map.destroy();
    this.hud.destroy();
    this.audio.dispose();
    this.atmo.dispose();
    this.composer.dispose();
    this.renderer.localClippingEnabled = false;
    this.onExit();
  }

  // ---------- frame ----------

  isOrbital() { const a = this.sim.active; if (this.speedManual !== null) return this.speedManual; return !!a && a.r.length() - P.R > 36000; }

  events() {
    const s = this.sim, hud = this.hud;
    for (const e of s.events.splice(0)) {
      if (e.type === 'msg') hud.message(e.text);
      else if (e.type === 'liftoff') { hud.message('Liftoff'); hud.hint(''); }
      else if (e.type === 'ignite' && e.craft === s.active) { if (!this.ignited || s.ut - this.ignited > 1) this.audio.play('ignition', 0.8); this.ignited = s.ut; }
      else if (e.type === 'decouple') this.audio.play('decouple', 0.9, 0.7);
      else if (e.type === 'thud') this.audio.play('thud', Math.min(1, e.speed / 8), 0.6);
      else if (e.type === 'chuteCut') this.audio.play('decouple', 0.7, 1.2);
      else if (e.type === 'explode') { this.fx.explode(e.at, e.vel, e.size, e.quiet); this.audio.explosion(e.size, e.at.distanceTo(this.camera.position.clone().add(this.origin)), e.at.length() - P.R < P.atmo * 0.7); if (!e.quiet) hud.message(`${e.name} destroyed — ${e.cause}`); this.shake = Math.min(1.5, (this.shake || 0) + e.size * 0.4); }
      else if (e.type === 'fairing') { this.fx.jettisonShell(e.craft, e.part); this.audio.play('decouple', 0.8, 1.1); }
      else if (e.type === 'flameout' && e.craft === s.active) hud.message(`${e.part.def.name} flamed out`);
      else if (e.type === 'chuteFull') { hud.message('Parachute fully deployed'); this.audio.play('chute', 1, 0.6); }
      else if (e.type === 'chute') { hud.message('Parachute armed'); this.audio.play('chute', 0.6, 1); }
      else if (e.type === 'landed' && e.craft === s.active) hud.message(e.water ? 'Splashed down' : 'Landed');
      else if (e.type === 'active') { s.sas.target = null; if (!e.craft) this.openMenu('Vessel lost', 'Nothing controllable is left. Revert, or leave the flight.'); }
      else if (e.type === 'removed') { const g = this.shown.get(e.craft); if (g) { this.scene.remove(g); this.shown.delete(e.craft); } }
    }
  }

  localFrame(r) {
    const up = r.clone().normalize();
    let east = new THREE.Vector3().crossVectors(Y, up);
    if (east.lengthSq() < 1e-8) east.set(0, 0, -1);
    east.normalize();
    const south = new THREE.Vector3().crossVectors(east, up);
    return { up, east, south, q: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, up, south)) };
  }

  sitePoint(east, upM, south) {
    const f = SITE.clone().multiplyScalar(P.R + P.siteAlt + upM).addScaledVector(SITE_FRAME.east, east).addScaledVector(SITE_FRAME.south, south);
    return toInertial(f, this.sim.ut);
  }

  placeCamera(dt) {
    const c = this.sim.active, cam = this.camera;
    if (!c) return;
    const lf = this.localFrame(c.r), b = c.bounds();
    let pos, look = new THREE.Vector3(), up = lf.up, fov = 55;
    const mode = this.cine ? 'cine' : CAMS[this.camMode];
    if (mode === 'cine') {
      const t = this.cine.t;
      const shot = t < 4.5 ? this.sitePoint(ROLL_FROM + 70, 5, 46) : t < 9 ? c.r.clone().addScaledVector(lf.south, 95).addScaledVector(lf.up, 8 - b.size * 0.2).addScaledVector(lf.east, -25) : this.sitePoint(62, 4, 48);
      pos = shot.sub(this.origin);
      look.copy(lf.up).multiplyScalar((b.hi - c.com.y) * 0.35);
      fov = t < 4.5 ? 38 : t < 9 ? 50 : 42;
    } else if (mode === 'Onboard') {
      let top = null;
      for (const p of c.parts.values()) if (p.def.dia && Math.hypot(p.pos.x, p.pos.z) < 0.1 && (!top || p.pos.y > top.pos.y) && (p.def.h || 0) > 0.6) top = p;
      top = top || c.parts.get(c.rootId);
      const rr = c.radius(top) + 0.5, out = new THREE.Vector3(Math.SQRT1_2, 0, Math.SQRT1_2);
      pos = c.worldPoint(new THREE.Vector3(out.x * rr, top.pos.y, out.z * rr)).sub(this.origin);
      look = c.worldPoint(new THREE.Vector3(out.x * rr * 0.4, b.lo, out.z * rr * 0.4)).sub(this.origin);
      up = out.clone().applyQuaternion(c.q);
      fov = 82;
    } else if (mode === 'Tracking') {
      const at = this.sitePoint(-70, 2.5, 190);
      pos = at.sub(this.origin);
      const d = pos.length();
      fov = THREE.MathUtils.clamp(2 * Math.atan((b.size * 2.4) / d) * 180 / Math.PI, 0.5, 48);
      up = toInertial(SITE, this.sim.ut);
      if (d > 400000) this.camMode = 0;
    } else {
      const sp = Math.sin(this.cam.phi), k = this.cam;
      pos = new THREE.Vector3().addScaledVector(lf.east, Math.cos(k.theta) * sp * k.dist).addScaledVector(lf.south, Math.sin(k.theta) * sp * k.dist).addScaledVector(lf.up, Math.cos(k.phi) * k.dist);
      const g = groundAt(pos.clone().add(this.origin), this.sim.ut);
      const world = pos.clone().add(this.origin), low = g.radius + 1.5 - world.length();
      if (low > 0) pos.addScaledVector(world.normalize(), low);
    }
    if (this.shake > 0.001) { pos.add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(this.shake * 0.4)); this.shake *= Math.exp(-dt * 3); }
    cam.position.copy(pos); cam.up.copy(up); cam.lookAt(look);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
  }

  frame() {
    const now = performance.now();
    const dt = Math.min((now - this.clock) / 1000, 0.1);
    this.clock = now;
    this.step(dt);
  }

  step(dt) {
    const sim = this.sim;
    this.time += dt;
    if (this.fadeT > 0) { this.fadeT = Math.max(0, this.fadeT - dt * 0.8); this.hud.fade(this.fadeT); }
    const input = this.input(dt);
    if (this.cine) {
      this.cine.t += dt;
      const k = THREE.MathUtils.smootherstep(Math.min(this.cine.t / (ROLL_TIME - 1.5), 1), 0, 1);
      sim.active.padOffset = ROLL_FROM * (1 - k);
      if (this.cine.t >= ROLL_TIME) { sim.active.padOffset = 0; this.cine = null; this.hud.setCinematic(false); this.updateHint(); }
    }
    if (!this.paused) sim.update(dt, input);
    this.events();
    const a = sim.active;
    if (a) this.origin.copy(a.r);

    for (const c of sim.crafts) {
      if (!this.shown.has(c)) { this.scene.add(c.group); this.shown.set(c, c.group); c.group.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); }
      const far = c.r.distanceTo(this.origin) > 200000;
      c.group.visible = !far;
      if (far) continue;
      c.group.quaternion.copy(c.q);
      c.group.position.copy(c.r).sub(this.origin).sub(c.com.clone().applyQuaternion(c.q));
    }
    this.placeCamera(dt);

    const rot = new THREE.Quaternion().setFromAxisAngle(Y, planetAngle(sim.ut));
    const camWorld = this.camera.position.clone().add(this.origin);
    const camAlt = camWorld.length() - P.R;
    if (!this.mapOn) this.terrain.update(toFixed(camWorld, sim.ut), this.origin, rot, 6);

    const siteOrigin = this.sitePoint(0, 0, 0);
    const siteQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(toInertial(SITE_FRAME.east, sim.ut), toInertial(SITE, sim.ut), toInertial(SITE_FRAME.south, sim.ut)));
    const siteNear = siteOrigin.distanceTo(this.origin) < 150000;
    this.site.visible = this.crawler.visible = siteNear;
    if (siteNear) {
      this.site.position.copy(siteOrigin).sub(this.origin); this.site.quaternion.copy(siteQ);
      const pad = sim.crafts.find((c) => c.padOffset !== undefined && c.clamped);
      this.crawlerOffset = pad ? pad.padOffset : (this.crawlerOffset || 0);
      this.crawler.position.copy(this.sitePoint(this.crawlerOffset, 0, 0)).sub(this.origin); this.crawler.quaternion.copy(siteQ);
    }

    const upCam = camWorld.clone().normalize();
    const elev = upCam.dot(SUN);
    const dayK = THREE.MathUtils.smoothstep(elev, -0.12, 0.12);
    const air = Math.exp(-Math.max(camAlt, 0) / 9000);
    const eclipsed = a ? (a.r.dot(SUN) < 0 && a.r.lengthSq() - a.r.dot(SUN) ** 2 < P.R * P.R) : false;
    const low = THREE.MathUtils.smoothstep(elev, -0.05, 0.35);
    const sunTint = new THREE.Color().setRGB(1, 0.55 + 0.45 * low, 0.3 + 0.7 * low);
    const sunK = eclipsed ? 0 : 1;
    this.sun.intensity = 3.6 * sunK * (0.35 + 0.65 * (1 - air + air * low));
    this.sun.color.copy(sunTint).lerp(new THREE.Color(1, 0.96, 0.9), 1 - air);
    this.sun.position.copy(SUN).multiplyScalar(400); this.sun.target.position.set(0, 0, 0);
    this.hemi.intensity = 0.08 + 0.75 * dayK * air;
    this.hemi.position.copy(upCam);
    const ambient = new THREE.Color().setRGB(0.012 + 0.2 * dayK * air, 0.014 + 0.25 * dayK * air, 0.022 + 0.34 * dayK * air);
    const sky = new THREE.Color().setRGB(0.25, 0.45, 0.8).multiplyScalar(dayK * (0.25 + 0.75 * air)).add(new THREE.Color(0.01, 0.012, 0.02));
    this.terrain.setLighting(SUN, ambient, 1.15, sky, this.time);
    this.stars.position.copy(this.camera.position);
    this.stars.material.opacity = 1 - 0.98 * dayK * Math.exp(-Math.max(camAlt, 0) / 30000);
    this.sunSprite.position.copy(this.camera.position).addScaledVector(SUN, 2.9e7);
    this.atmo.set(camWorld.clone().negate(), SUN, rot, this.time, sunTint);
    this.fx.update(this.paused ? 0 : dt * Math.min(sim.warp, 4), sim, this.origin, this.camera, dayK * sunK);

    if (a) {
      let tn = 0, tmax = 0;
      for (const p of a.parts.values()) if (p.def.thrust && p.on) { tn += p.thrustNow || 0; tmax += p.def.thrust.vac * 1000; }
      const alt = a.r.length() - P.R, vr = a.v.clone().sub(surfaceVelocity(a.r)).length();
      this.audio.update(tmax ? tn / tmax : 0, Math.min(pressure(alt), 1), 0.5 * density(alt) * vr * vr, this.camera.position.length(), alt, this.paused || sim.warpIndex > 3);
    }
    if (this.mapOn) { this.map.update(sim, (m) => this.fmt(m), (s) => this.fmtT(s)); this.renderer.setRenderTarget(null); this.renderer.render(this.map.scene, this.map.camera); }
    else this.composer.render();
    if (a && !this.cine) { this.updateHUD(a); this.navball.render(this.renderer); }
  }

  fmt(m) { return m < 1e5 ? `${(m / 1000).toFixed(1)} km` : `${(m / 1000).toFixed(0)} km`; }
  fmtT(s) { if (!Number.isFinite(s)) return '—'; const m = Math.floor(s / 60); return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m` : `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`; }

  updateHUD(a) {
    const sim = this.sim, lf = this.localFrame(a.r);
    const vrel = a.v.clone().sub(surfaceVelocity(a.r));
    const orbital = this.isOrbital();
    if (this.speedManual !== null && (a.r.length() - P.R > 36000) === this.speedManual) this.speedManual = null;
    const vel = orbital ? a.v : vrel;
    const o = a.clamped || a.landed ? null : elements(a.r, a.v);
    const dirs = {};
    if (vel.length() > 0.5) {
      const pro = vel.clone().normalize(), nrm = new THREE.Vector3().crossVectors(a.r, a.v).normalize(), rad = new THREE.Vector3().crossVectors(pro, nrm).normalize();
      Object.assign(dirs, { prograde: pro, retrograde: pro.clone().negate() });
      if (orbital) Object.assign(dirs, { normal: nrm, antinormal: nrm.clone().negate(), radialOut: rad, radialIn: rad.clone().negate() });
    }
    const att = this.navball.update(a.q, lf.q, dirs);
    const name = (id) => { const p = a.parts.get(id); return p ? `${p.def.name}#${p.def.stage}` : null; };
    const stages = a.stages.map((st) => { const seen = new Map(); for (const id of st) { const n = name(id); if (n) seen.set(n, (seen.get(n) || 0) + 1); } return [...seen].map(([n, k]) => (k > 1 ? `${n.split('#')[0]} ×${k}#${n.split('#')[1]}` : n)); }).filter((s) => s.length);
    let heat = 0;
    for (const p of a.parts.values()) heat = Math.max(heat, (p.temp - 300) / (p.maxT - 300));
    this.hud.update({
      met: sim.ut - a.launchUT, name: a.name, alt: a.r.length() - P.R, agl: Math.max(0, a.agl || 0), radar: a.agl !== undefined && a.agl < 2500 && !a.clamped,
      vs: vrel.dot(lf.up), speed: vel.length(), orbital, throttle: a.throttle, hdg: att.hdg, pitch: att.pitch, g: a.gForce || 0, heat, sas: sim.sas.on, sasMode: sim.sas.mode, rcs: sim.rcs,
      warpIndex: sim.warpIndex, camName: CAMS[this.camMode], blackout: sim.blackout, orbit: o, stages, clamped: a.clamped, res: a.resources(),
    });
  }
}
