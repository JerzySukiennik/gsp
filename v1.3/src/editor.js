// VAB editor: hangar scene, orbit camera, part pickup and placement with node snapping, surface attach and symmetry.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PARTS, canRadial, canStack, radialStandoff } from './catalog.js';
import { Vessel, rotY } from './vessel.js';
import { getHangar, makePart, paint, setTint, DEFAULT_COLORS } from './assets.js';

const PAD_TOP = 0.36;
const SNAP_PX = 70;
const SYM_STEPS = [1, 2, 3, 4, 6, 8];
const OK = 0x19ff7a, BAD = 0xff3b30;

export class Editor {
  constructor(canvas) {
    this.canvas = canvas;
    this.vessel = new Vessel();
    this.held = null;
    this.symmetry = 1;
    this.tool = 'build';
    this.colors = { ...DEFAULT_COLORS };
    this.angleSnap = true;
    this.undoStack = [];
    this.redoStack = [];
    this.listeners = new Set();
    this.objects = new Map();
    this.hoverId = null;
    this.candidate = null;
    this.cam = { theta: 0.6, phi: 1.3, dist: 24, targetY: 9 };
    this.pointer = { x: 0, y: 0, down: false, button: 0, sx: 0, sy: 0, moved: false, inside: false };
    this.enabled = true;
    this.initScene();
    this.bind();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  pause() { this.enabled = false; this.renderer.setAnimationLoop(null); if (this.held) this.discardHeld(); }
  resume() { this.enabled = true; this.renderer.toneMappingExposure = 0.78; this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); this.resize(); this.renderer.setAnimationLoop(() => this.frame()); }

  on(fn) { this.listeners.add(fn); }
  emit(toast) { for (const fn of this.listeners) fn(toast); }

  initScene() {
    const r = this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.78;
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0xdfe3e8);
    const pmrem = new THREE.PMREMGenerator(r);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
    scene.environmentIntensity = 0.55;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa0aa, 0.55));
    const sun = new THREE.DirectionalLight(0xfff6e8, 1.9);
    sun.position.set(14, 56, 18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 90 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    scene.add(sun);
    const hangar = getHangar();
    hangar.traverse((m) => { if (m.isMesh) { m.receiveShadow = true; m.userData.noPick = true; } });
    scene.add(hangar);

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 400);
    this.vesselGroup = new THREE.Group();
    this.heldGroup = new THREE.Group();
    this.markers = new THREE.Group();
    scene.add(this.vesselGroup, this.heldGroup, this.markers);
    this.markerGeo = new THREE.SphereGeometry(1, 16, 12);
    this.markerMat = new THREE.MeshBasicMaterial({ color: OK, depthTest: false, transparent: true, opacity: 0.85 });

    const size = new THREE.Vector2(innerWidth, innerHeight);
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { samples: 4, type: THREE.HalfFloatType });
    this.composer = new EffectComposer(r, target);
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(size, 0.16, 0.6, 1.0));
    this.composer.addPass(new OutputPass());
    this.raycaster = new THREE.Raycaster();
    this.resize();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  bind() {
    const c = this.canvas;
    addEventListener('resize', () => { if (this.enabled) this.resize(); });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      c.setPointerCapture(e.pointerId);
      Object.assign(this.pointer, { down: true, button: e.button, sx: e.clientX, sy: e.clientY, moved: false });
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.enabled) return;
      const p = this.pointer;
      p.inside = true;
      if (p.down) {
        const dx = e.clientX - p.x, dy = e.clientY - p.y;
        if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 5) p.moved = true;
        if (p.moved) {
          if (p.button === 1) this.cam.targetY += dy * this.cam.dist * 0.0016;
          else { this.cam.theta -= dx * 0.0055; this.cam.phi = THREE.MathUtils.clamp(this.cam.phi - dy * 0.0045, 0.2, 1.54); }
        }
      }
      p.x = e.clientX; p.y = e.clientY; p.shift = e.shiftKey; p.alt = e.altKey;
    });
    c.addEventListener('pointerleave', () => { this.pointer.inside = false; });
    c.addEventListener('pointerup', (e) => {
      if (!this.enabled) return;
      const p = this.pointer;
      p.down = false;
      if (p.moved) return;
      if (e.button === 2) { if (this.held) this.discardHeld(); return; }
      if (e.button === 0) this.click(e.shiftKey);
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!this.enabled) return;
      if (e.shiftKey) this.cam.targetY -= (e.deltaY || e.deltaX) * 0.012;
      else this.cam.dist = THREE.MathUtils.clamp(this.cam.dist * Math.exp(e.deltaY * 0.0012), 1.2, 30.5);
    }, { passive: false });
    addEventListener('keydown', (e) => {
      if (!this.enabled || e.target.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
      if ((e.metaKey || e.ctrlKey) && k === 'y') { e.preventDefault(); this.redo(); return; }
      if (e.metaKey || e.ctrlKey) return;
      if (k === 'x') this.setSymmetry(SYM_STEPS[(SYM_STEPS.indexOf(this.symmetry) + (e.shiftKey ? SYM_STEPS.length - 1 : 1)) % SYM_STEPS.length]);
      else if (k === 'c') { this.angleSnap = !this.angleSnap; this.emit(`Angle snap ${this.angleSnap ? 'on' : 'off'}`); }
      else if (k === 'f') this.fit();
      else if (k === '1') this.setTool('build');
      else if (k === '2') this.setTool('paint');
      else if (k === 'delete' || k === 'backspace' || k === 'escape') { if (this.held) this.discardHeld(); }
    });
  }

  // ---------- state changes ----------

  snapshot() { return JSON.stringify(this.vessel.toJSON()); }

  pushUndo(before) {
    this.undoStack.push(before);
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  restore(json) {
    this.vessel = Vessel.fromJSON(JSON.parse(json));
    this.clearHeld();
    this.rebuild();
    this.emit();
  }

  undo() { if (!this.undoStack.length) return; this.redoStack.push(this.snapshot()); this.restore(this.undoStack.pop()); }
  redo() { if (!this.redoStack.length) return; this.undoStack.push(this.snapshot()); this.restore(this.redoStack.pop()); }

  load(data) { const before = this.snapshot(); this.vessel = Vessel.fromJSON(data); this.pushUndo(before); this.clearHeld(); this.rebuild(); this.fit(); this.emit(); }
  clear() { this.load({ parts: [] }); }
  setSymmetry(n) { this.symmetry = n; this.ghostKey = null; this.emit(); }
  setTool(t) { this.tool = t; if (t === 'paint' && this.held) this.discardHeld(); this.emit(); }
  setColors(c) { Object.assign(this.colors, c); this.emit(); }

  moveStage(id, dir) { const before = this.snapshot(); this.vessel.moveStage(id, dir); this.pushUndo(before); this.emit(); }
  resetStaging() { const before = this.snapshot(); this.vessel.manualStages = null; this.pushUndo(before); this.emit(); }

  pickFromCatalog(type) {
    if (this.tool !== 'build') this.setTool('build');
    if (this.held) this.discardHeld();
    const same = this.colors.main === DEFAULT_COLORS.main && this.colors.accent === DEFAULT_COLORS.accent;
    this.setHeld([{ id: 'h0', type, parent: null, att: null, sym: null, colors: same ? null : { ...this.colors } }], null);
  }

  setHeld(sub, undoBefore) {
    this.held = { sub, undoBefore };
    const mini = new Vessel();
    sub.forEach((r) => mini.parts.set(r.id, r));
    mini.rootId = sub[0].id;
    const tf = mini.transforms();
    this.heldTemplate = new THREE.Group();
    for (const r of sub) {
      const o = makePart(r.type, r.colors);
      const t = tf.get(r.id);
      o.position.set(...t.pos);
      o.rotation.y = -t.yaw;
      this.heldTemplate.add(o);
    }
    const used = new Set(sub.filter((r) => r.parent === sub[0].id && r.att.k === 's').map((r) => r.att.pn));
    this.held.freeNodes = Object.keys(PARTS[sub[0].type].nodes || {}).filter((n) => !used.has(n));
    this.ghostKey = null;
    this.emit();
  }

  clearHeld() {
    this.held = null;
    this.candidate = null;
    this.heldGroup.clear();
    this.markers.clear();
  }

  discardHeld() {
    const h = this.held;
    this.clearHeld();
    if (h.undoBefore) this.pushUndo(h.undoBefore);
    this.emit();
  }

  commit(cand) {
    const h = this.held;
    const before = h.undoBefore || this.snapshot();
    this.vessel.insert(h.sub, cand.atts[0].parent, cand.atts);
    this.pushUndo(before);
    this.clearHeld();
    this.rebuild();
    this.emit();
  }

  click(shift) {
    if (this.held) { if (this.candidate) this.commit(this.candidate); return; }
    const id = this.pickPart();
    if (!id) return;
    const part = this.vessel.parts.get(id);
    if (this.tool === 'paint') {
      const before = this.snapshot();
      const targets = shift ? [...this.vessel.parts.values()] : this.vessel.symGroup(part);
      targets.forEach((p) => { p.colors = { ...this.colors }; paint(this.objects.get(p.id), p.colors); });
      this.pushUndo(before);
      this.emit();
      return;
    }
    const before = this.snapshot();
    const { sub, symmetry } = this.vessel.detach(id);
    if (symmetry > 1 || canRadial(PARTS[sub[0].type])) this.symmetry = SYM_STEPS.includes(symmetry) ? symmetry : this.symmetry;
    this.rebuild();
    this.setHeld(sub, before);
  }

  // ---------- scene sync ----------

  rebuild() {
    this.vesselGroup.clear();
    this.objects.clear();
    this.hoverId = null;
    const tf = this.vessel.transforms();
    for (const p of this.vessel.parts.values()) {
      const o = makePart(p.type, p.colors);
      const t = tf.get(p.id);
      o.position.set(...t.pos);
      o.rotation.y = -t.yaw;
      o.traverse((m) => { m.userData.partId = p.id; });
      this.vesselGroup.add(o);
      this.objects.set(p.id, o);
    }
    this.tf = tf;
    this.updateGround();
  }

  bounds() {
    const y = this.vesselGroup.position.y;
    this.vesselGroup.position.y = 0;
    this.vesselGroup.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const o of this.objects.values()) o.traverse((m) => { if (m.isMesh && !m.userData.shell) box.expandByObject(m); });
    this.vesselGroup.position.y = y;
    this.vesselGroup.updateMatrixWorld(true);
    return box;
  }

  updateGround() {
    if (!this.vessel.size) { this.box = null; return; }
    this.box = this.bounds();
    const lift = PAD_TOP - this.box.min.y;
    if (lift > 0.001) {
      for (const r of this.vessel.looseRoots()) { const pos = r.att && r.att.pos ? r.att.pos : [0, 0, 0]; r.att = { k: 'f', pos: [pos[0], pos[1] + lift, pos[2]], yaw: (r.att && r.att.yaw) || 0 }; }
      this.tf = this.vessel.transforms();
      for (const [id, o] of this.objects) o.position.set(...this.tf.get(id).pos);
      this.box = this.bounds();
    }
  }

  fit() {
    if (!this.box) return;
    this.cam.targetY = (this.box.min.y + this.box.max.y) / 2;
    const s = this.box.getSize(new THREE.Vector3());
    const need = Math.max(s.y * 0.62, Math.max(s.x, s.z) * 0.9) / Math.tan(THREE.MathUtils.degToRad(23)) + 2;
    this.cam.dist = THREE.MathUtils.clamp(need, 5, 30.5);
  }

  // ---------- picking and snapping ----------

  ray() {
    const ndc = new THREE.Vector2((this.pointer.x / innerWidth) * 2 - 1, -(this.pointer.y / innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster;
  }

  hitVessel() {
    const hits = this.ray().intersectObjects(this.vesselGroup.children, true);
    return hits.find((h) => !h.object.userData.noPick) || null;
  }

  pickPart() { const h = this.hitVessel(); return h ? h.object.userData.partId : null; }

  toScreen(v) {
    const p = v.clone().project(this.camera);
    return [(p.x + 1) * innerWidth / 2, (1 - p.y) * innerHeight / 2, p.z];
  }

  worldOf(id) {
    const t = this.tf.get(id);
    return new THREE.Vector3(t.pos[0], t.pos[1] + this.vesselGroup.position.y, t.pos[2]);
  }

  freeNodeTargets() {
    const out = [];
    for (const p of this.vessel.parts.values()) {
      const def = PARTS[p.type];
      if (!def.nodes) continue;
      const used = this.vessel.usedNodes(p.id);
      for (const [name, node] of Object.entries(def.nodes)) {
        if (used.has(name)) continue;
        const w = this.worldOf(p.id); w.y += node.y;
        out.push({ part: p, name, node, world: w });
      }
    }
    return out;
  }

  planePoint() {
    const n = new THREE.Vector3(Math.sin(this.cam.theta), 0, Math.cos(this.cam.theta));
    const pt = new THREE.Vector3();
    return this.ray().ray.intersectPlane(new THREE.Plane(n, 0), pt) ? pt : null;
  }

  replicate(parent, world, theta) {
    const v = this.vessel;
    const pd = PARTS[parent.type];
    const pt = this.tf.get(parent.id);
    const rt = this.tf.get(this.vessel.rootId);
    const axis = pd.dia ? [pt.pos[0], pt.pos[2]] : [rt.pos[0], rt.pos[2]];
    const n = canRadial(PARTS[this.held.sub[0].type]) ? this.symmetry : 1;
    const locals = [];
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      const [rx, rz] = rotY(world[0] - axis[0], world[2] - axis[1], a);
      const wx = axis[0] + rx, wz = axis[1] + rz;
      const [ox, oz] = rotY(wx - pt.pos[0], wz - pt.pos[2], -pt.yaw);
      locals.push({ k: 'r', off: [ox, world[1] - pt.pos[1], oz], ang: theta + a - pt.yaw });
    }
    const atts = [];
    for (const sib of v.symGroup(parent)) for (const att of locals) atts.push({ parent: sib.id, att: { ...att, off: [...att.off] } });
    return atts;
  }

  findCandidate() {
    const h = this.held;
    const def = PARTS[h.sub[0].type];
    const gy = this.vesselGroup.position.y;
    const mouse = [this.pointer.x, this.pointer.y];
    let best = null;

    if (canStack(def)) {
      const pp = this.planePoint();
      for (const t of this.freeNodeTargets()) {
        for (const hn of h.freeNodes) {
          if (hn === t.name) continue;
          const s = this.toScreen(t.world);
          if (s[2] > 1) continue;
          let d = Math.hypot(s[0] - mouse[0], s[1] - mouse[1]);
          if (pp) { const hs = this.toScreen(pp.clone().add(new THREE.Vector3(0, def.nodes[hn].y, 0))); d = Math.min(d, Math.hypot(s[0] - hs[0], s[1] - hs[1])); }
          if (d < SNAP_PX && (!best || d < best.d)) best = { d, t, hn };
        }
      }
    }
    if (best) {
      const parent = best.t.part;
      const att = { k: 's', pn: best.t.name, cn: best.hn };
      const atts = this.vessel.symGroup(parent).filter((s) => !this.vessel.usedNodes(s.id).has(att.pn)).map((s) => ({ parent: s.id, att: { ...att } }));
      const poses = atts.map((a) => {
        const w = this.worldOf(a.parent);
        w.y += PARTS[parent.type].nodes[att.pn].y - def.nodes[att.cn].y;
        return { pos: w, yaw: this.tf.get(a.parent).yaw };
      });
      return { atts, poses };
    }

    if (canRadial(def)) {
      const hit = this.hitVessel();
      if (hit) {
        const parent = this.vessel.parts.get(hit.object.userData.partId);
        const pd = PARTS[parent.type];
        if (pd.surface) {
          const pt = this.tf.get(parent.id);
          let theta, wx, wz, wy = hit.point.y - gy;
          if (pd.dia) {
            const dx = hit.point.x - pt.pos[0], dz = hit.point.z - pt.pos[2];
            const rad = Math.hypot(dx, dz);
            if (rad < 0.02) return null;
            theta = Math.atan2(dz, dx);
            if (this.angleSnap && !this.pointer.alt) theta = Math.round(theta / (Math.PI / 12)) * (Math.PI / 12);
            wx = pt.pos[0] + Math.cos(theta) * rad; wz = pt.pos[2] + Math.sin(theta) * rad;
          } else {
            theta = pt.yaw;
            wx = pt.pos[0] + Math.cos(theta) * (pd.standoff || 0); wz = pt.pos[2] + Math.sin(theta) * (pd.standoff || 0);
            wy = pt.pos[1];
          }
          if (this.angleSnap && !this.pointer.alt && pd.dia) wy = Math.round(wy / 0.05) * 0.05;
          const so = radialStandoff(def);
          const world = [wx + Math.cos(theta) * so, wy, wz + Math.sin(theta) * so];
          const atts = this.replicate(parent, world, theta);
          const poses = atts.map((a) => {
            const t = this.tf.get(a.parent);
            const [ox, oz] = rotY(a.att.off[0], a.att.off[2], t.yaw);
            return { pos: new THREE.Vector3(t.pos[0] + ox, t.pos[1] + a.att.off[1] + gy, t.pos[2] + oz), yaw: t.yaw + a.att.ang };
          });
          return { atts, poses };
        }
      }
    }
    return this.freeCandidate(def);
  }

  freeCandidate(def) {
    const pp = this.planePoint();
    if (!pp) return null;
    const half = def.h ? def.h / 2 : 0.6;
    let x = pp.x, z = pp.z;
    const y = THREE.MathUtils.clamp(pp.y, PAD_TOP + half, 56 - half);
    if (!this.vessel.size && this.angleSnap && !this.pointer.alt) {
      const s = this.toScreen(new THREE.Vector3(0, y, 0));
      if (Math.abs(s[0] - this.pointer.x) < SNAP_PX) { x = 0; z = 0; }
    }
    const lim = 24;
    x = THREE.MathUtils.clamp(x, -lim, lim); z = THREE.MathUtils.clamp(z, -lim, lim);
    return { free: true, atts: [{ parent: null, att: { k: 'f', pos: [x, y, z], yaw: 0 } }], poses: [{ pos: new THREE.Vector3(x, y, z), yaw: 0 }] };
  }

  updateHeld() {
    const h = this.held;
    if (!h) return;
    const cand = this.pointer.inside ? this.findCandidate() : null;
    this.candidate = cand;
    const poses = cand ? cand.poses : [];
    const count = Math.max(1, poses.length);
    if (this.ghostKey !== count) {
      this.heldGroup.clear();
      for (let i = 0; i < count; i++) this.heldGroup.add(i ? this.heldTemplate.clone(true) : this.heldTemplate);
      this.ghostKey = count;
    }
    if (cand) {
      poses.forEach((p, i) => { const g = this.heldGroup.children[i]; g.position.copy(p.pos); g.rotation.y = -p.yaw; g.visible = true; });
      setTint(this.heldTemplate, cand.free ? 0x000000 : OK, cand.free ? 0 : 0.22);
    } else {
      const pp = this.planePoint();
      const g = this.heldGroup.children[0];
      g.visible = !!pp && this.pointer.inside;
      if (pp) { g.position.copy(pp); g.rotation.y = canStack(PARTS[h.sub[0].type]) ? 0 : -(Math.PI / 2 - this.cam.theta) + Math.PI / 2; }
      setTint(this.heldTemplate, BAD, 0.12);
    }
    this.updateMarkers();
  }

  updateMarkers() {
    const def = PARTS[this.held.sub[0].type];
    this.markers.clear();
    if (!canStack(def)) return;
    for (const t of this.freeNodeTargets()) {
      if (!this.held.freeNodes.some((n) => n !== t.name)) continue;
      const m = new THREE.Mesh(this.markerGeo, this.markerMat);
      m.position.copy(t.world);
      m.scale.setScalar(this.camera.position.distanceTo(t.world) * 0.011);
      m.renderOrder = 10;
      this.markers.add(m);
    }
  }

  updateHover() {
    if (this.held || this.pointer.down || !this.pointer.inside) { this.setHover(null); return; }
    this.setHover(this.pickPart());
  }

  setHover(id) {
    if (id === this.hoverId) return;
    const clear = (pid) => { const p = this.vessel.parts.get(pid); if (p) this.vessel.symGroup(p).forEach((q) => setTint(this.objects.get(q.id), 0x000000, 0)); };
    if (this.hoverId) clear(this.hoverId);
    this.hoverId = id;
    if (id) this.vessel.symGroup(this.vessel.parts.get(id)).forEach((q) => setTint(this.objects.get(q.id), this.tool === 'paint' ? 0x4da3ff : 0xffffff, 0.12));
    this.canvas.style.cursor = id ? 'pointer' : 'default';
  }

  // ---------- frame ----------

  frame() {
    const c = this.cam;
    c.targetY = THREE.MathUtils.clamp(c.targetY, 0.5, 55);
    const ty = c.targetY;
    const sp = Math.sin(c.phi);
    this.camera.position.set(Math.sin(c.theta) * sp * c.dist, Math.max(0.6, ty + Math.cos(c.phi) * c.dist), Math.cos(c.theta) * sp * c.dist);
    this.camera.lookAt(0, ty, 0);
    this.camera.updateMatrixWorld();
    this.updateHeld();
    this.updateHover();
    this.composer.render();
  }
}
