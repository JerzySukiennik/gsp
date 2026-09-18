// Flight audio: real recordings only, mixed live — engine roar filtered by air pressure, wind, space ambience, one-shots.
const FILES = {
  engine: 'engine_loop.wav', ignition: 'ignition.mp3', boomA: 'explosion_a.ogg', boomB: 'explosion_b.ogg', boomC: 'explosion_c.ogg',
  decouple: 'decouple.ogg', thud: 'thud.ogg', chute: 'chute.ogg', space: 'space.ogg', click: 'click.ogg',
};
const cache = new Map();

export class FlightAudio {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = this.ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(this.ctx.destination);
    this.loops = {};
    this.ready = this.load();
    this.ctx.resume().catch(() => {});
  }

  async load() {
    await Promise.all(Object.entries(FILES).map(async ([k, f]) => {
      if (cache.has(k)) return;
      try { const buf = await (await fetch(`assets/audio/${f}`)).arrayBuffer(); cache.set(k, await this.ctx.decodeAudioData(buf)); } catch { cache.set(k, null); }
    }));
    this.loops.engine = this.loop('engine', 'lowpass', 18000);
    this.loops.wind = this.loop('engine', 'highpass', 1500, 1.35);
    this.loops.space = this.loop('space', 'lowpass', 900, 0.6);
  }

  loop(key, type, freq, rate = 1) {
    const buf = cache.get(key);
    if (!buf) return null;
    const src = this.ctx.createBufferSource(), filter = this.ctx.createBiquadFilter(), gain = this.ctx.createGain();
    src.buffer = buf; src.loop = true; src.playbackRate.value = rate;
    filter.type = type; filter.frequency.value = freq;
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    return { src, filter, gain };
  }

  play(key, volume = 1, rate = 1, delay = 0) {
    const buf = cache.get(key);
    if (!buf || this.ctx.state !== 'running') return;
    const src = this.ctx.createBufferSource(), gain = this.ctx.createGain();
    src.buffer = buf; src.playbackRate.value = rate; gain.gain.value = volume;
    src.connect(gain).connect(this.master);
    src.start(this.ctx.currentTime + delay);
  }

  explosion(size, distance, inAir) {
    const vol = Math.min(1.4, 0.5 + size * 0.25) / (1 + distance / 900);
    this.play(size > 2 ? 'boomA' : size > 1 ? 'boomB' : 'boomC', inAir ? vol : vol * 0.25, 0.8 + Math.random() * 0.3, inAir ? Math.min(distance / 340, 6) : 0);
  }

  // thrust: 0..1 of the active craft, pr: air pressure 0..1, q: dynamic pressure Pa, distance: camera to craft, m.
  update(thrust, pr, q, distance, altitude, paused) {
    const t = this.ctx.currentTime, L = this.loops;
    const set = (param, v) => param.setTargetAtTime(v, t, 0.12);
    if (!L.engine) return;
    const near = 1 / (1 + distance / 400);
    set(L.engine.gain.gain, paused ? 0 : thrust * (0.28 + 0.72 * pr) * (0.25 + 0.75 * near) * 0.95);
    set(L.engine.filter.frequency, 160 + 17000 * pr * pr * near);
    set(L.engine.src.playbackRate, 0.82 + 0.2 * thrust);
    set(L.wind.gain.gain, paused ? 0 : Math.min(0.7, q / 45000) * near);
    if (L.space) set(L.space.gain.gain, paused ? 0 : Math.min(0.22, Math.max(0, (altitude - 45000) / 120000)));
  }

  dispose() { this.ctx.close().catch(() => {}); }
}
