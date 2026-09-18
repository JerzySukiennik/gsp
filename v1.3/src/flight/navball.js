// Navball: attitude sphere with heading/pitch texture and velocity markers, drawn into a corner viewport of the main canvas.
import * as THREE from 'three';

function ballTexture() {
  const W = 2048, H = 1024, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#1d6fd8'; x.fillRect(0, 0, W, H / 2);
  x.fillStyle = '#7a4b22'; x.fillRect(0, H / 2, W, H / 2);
  x.strokeStyle = 'rgba(255,255,255,.85)'; x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
  for (let p = -80; p <= 80; p += 10) {
    const y = (0.5 - p / 180) * H;
    x.lineWidth = p === 0 ? 7 : p % 30 === 0 ? 3 : 1.5;
    x.beginPath(); x.moveTo(0, y); x.lineTo(W, y); x.stroke();
  }
  for (let h = 0; h < 360; h += 15) {
    const px = ((((0.75 - h / 360) % 1) + 1) % 1) * W;
    x.lineWidth = h % 90 === 0 ? 4 : 1.5;
    x.beginPath(); x.moveTo(px, H * 0.06); x.lineTo(px, H * 0.94); x.stroke();
    if (h % 30) continue;
    const label = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[h] || String(h);
    for (const p of [0, 30, -30, 60, -60]) {
      x.save();
      x.translate(px, (0.5 - p / 180) * H - (p === 0 ? 26 : 0));
      x.scale(-1 / Math.max(0.35, Math.cos(p * Math.PI / 180)), 1);
      x.font = `700 ${h % 90 === 0 ? 40 : 30}px "Space Mono", monospace`;
      x.fillText(p === 0 ? label : `${Math.abs(p)}`, 0, 0);
      x.restore();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function markerTexture(kind, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  x.strokeStyle = color; x.fillStyle = color; x.lineWidth = 10; x.lineCap = 'round';
  x.beginPath(); x.arc(64, 64, 30, 0, Math.PI * 2); x.stroke();
  const line = (a, b, c2, d) => { x.beginPath(); x.moveTo(a, b); x.lineTo(c2, d); x.stroke(); };
  if (kind === 'pro') { x.beginPath(); x.arc(64, 64, 5, 0, 7); x.fill(); line(64, 34, 64, 8); line(34, 64, 8, 64); line(94, 64, 120, 64); }
  if (kind === 'retro') { line(43, 43, 85, 85); line(85, 43, 43, 85); line(64, 34, 64, 8); line(38, 79, 16, 92); line(90, 79, 112, 92); }
  if (kind === 'in') { line(64, 34, 64, 50); line(64, 94, 64, 78); line(34, 64, 50, 64); line(94, 64, 78, 64); }
  if (kind === 'out') { line(64, 34, 64, 12); line(64, 94, 64, 116); line(34, 64, 12, 64); line(94, 64, 116, 64); }
  if (kind === 'nrm') { x.beginPath(); x.moveTo(64, 14); x.lineTo(108, 92); x.lineTo(20, 92); x.closePath(); x.stroke(); }
  if (kind === 'anti') { x.beginPath(); x.moveTo(64, 114); x.lineTo(108, 36); x.lineTo(20, 36); x.closePath(); x.stroke(); }
  return new THREE.CanvasTexture(c);
}

const C = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);

export class Navball {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1.12, 1.12, 1.12, -1.12, 0.1, 10);
    this.camera.position.z = 4;
    this.flip = new THREE.Group();
    this.flip.scale.x = -1;
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), new THREE.MeshBasicMaterial({ map: ballTexture() }));
    this.flip.add(this.ball);
    this.scene.add(this.flip);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.1, 64), new THREE.MeshBasicMaterial({ color: 0x0e0f12 }));
    ring.position.z = 1.2;
    this.scene.add(ring);
    this.markers = {};
    const defs = { prograde: ['pro', '#d8ff3c'], retrograde: ['retro', '#d8ff3c'], radialIn: ['in', '#4dd2ff'], radialOut: ['out', '#4dd2ff'], normal: ['nrm', '#d07bff'], antinormal: ['anti', '#d07bff'] };
    for (const [k, [kind, color]] of Object.entries(defs)) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), new THREE.MeshBasicMaterial({ map: markerTexture(kind, color), transparent: true, depthTest: false, side: THREE.DoubleSide }));
      m.renderOrder = 3;
      this.flip.add(m);
      this.markers[k] = m;
    }
    this.size = 176;
  }

  // q: craft attitude, frame: local horizon quaternion (X east, Y up, Z south), dirs: inertial unit vectors for the markers.
  update(q, frame, dirs) {
    const fi = frame.clone().invert();
    const rel = fi.clone().multiply(q);
    const ballQ = C.clone().multiply(rel.clone().invert());
    this.ball.quaternion.copy(ballQ);
    for (const [k, m] of Object.entries(this.markers)) {
      const d = dirs[k];
      if (!d) { m.visible = false; continue; }
      const v = d.clone().applyQuaternion(fi).applyQuaternion(ballQ);
      m.visible = v.z > 0.12;
      m.position.copy(v).multiplyScalar(1.02);
      m.scale.x = -1;
    }
    const nose = new THREE.Vector3(0, 1, 0).applyQuaternion(rel);
    const pitch = Math.asin(THREE.MathUtils.clamp(nose.y, -1, 1)) * 180 / Math.PI;
    let hdg = Math.atan2(nose.x, -nose.z) * 180 / Math.PI;
    if (hdg < 0) hdg += 360;
    return { pitch, hdg };
  }

  render(renderer) {
    const s = this.size, x = Math.round(innerWidth / 2 - s / 2), y = 14;
    renderer.setRenderTarget(null);
    renderer.setViewport(x, y, s, s);
    renderer.setScissor(x, y, s, s);
    renderer.setScissorTest(true);
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, innerWidth, innerHeight);
    renderer.autoClear = true;
  }
}
