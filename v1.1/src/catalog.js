// Part catalog: gameplay stats, attach nodes and categories for every GLB in assets/parts.

const D = { S: 0.6, M: 1.25, L: 2.5 };

export const CATEGORIES = [
  { id: 'command', name: 'Command', short: 'Cmd' },
  { id: 'tanks', name: 'Tanks', short: 'Tanks' },
  { id: 'engines', name: 'Engines', short: 'Engine' },
  { id: 'structure', name: 'Structure', short: 'Struct' },
  { id: 'aero', name: 'Aero', short: 'Aero' },
  { id: 'utility', name: 'Utility', short: 'Util' },
];

const stack = (dia, h, top = true, bottom = true, topDia = dia) => {
  const nodes = {};
  if (top) nodes.top = { y: h / 2, size: topDia };
  if (bottom) nodes.bottom = { y: -h / 2, size: dia };
  return nodes;
};

const tank = (id, name, size, len) => {
  const dia = D[size];
  const fuel = +(Math.PI * (dia / 2) ** 2 * len * 0.9).toFixed(3);
  return {
    id, name, cat: 'tanks', dia, h: len, mass: +(fuel * 0.125).toFixed(3), fuel: { liquid: fuel },
    nodes: stack(dia, len), radial: true, surface: true,
  };
};

const engine = (id, name, size, h, mass, thrustAsl, thrustVac, ispAsl, ispVac) => ({
  id, name, cat: 'engines', dia: D[size], h, mass, thrust: { asl: thrustAsl, vac: thrustVac }, isp: { asl: ispAsl, vac: ispVac },
  nodes: stack(D[size], h), stage: 'engine', surface: false,
});

const LIST = [
  { id: 'probe_s', name: 'Probe Core 0.6', cat: 'command', dia: D.S, h: 0.25, mass: 0.05, nodes: stack(D.S, 0.25), command: true, surface: true },
  { id: 'probe_m', name: 'Probe Core 1.25', cat: 'command', dia: D.M, h: 0.35, mass: 0.12, nodes: stack(D.M, 0.35), command: true, surface: true },
  { id: 'capsule', name: 'Crew Capsule', cat: 'command', dia: D.L, h: 2.2, mass: 2.4, nodes: stack(D.L, 2.2, true, true, D.M), command: true, crew: 3, surface: true },

  tank('tank_s_1', 'Tank 0.6 Short', 'S', 0.6), tank('tank_s_2', 'Tank 0.6 Medium', 'S', 1.2), tank('tank_s_3', 'Tank 0.6 Long', 'S', 2.4),
  tank('tank_m_1', 'Tank 1.25 Short', 'M', 1.25), tank('tank_m_2', 'Tank 1.25 Medium', 'M', 2.5), tank('tank_m_3', 'Tank 1.25 Long', 'M', 5.0),
  tank('tank_l_1', 'Tank 2.5 Short', 'L', 2.5), tank('tank_l_2', 'Tank 2.5 Medium', 'L', 5.0), tank('tank_l_3', 'Tank 2.5 Long', 'L', 10.0),
  { id: 'mono_m', name: 'Monoprop Tank 1.25', cat: 'tanks', dia: D.M, h: 0.5, mass: 0.08, fuel: { mono: 0.4 }, nodes: stack(D.M, 0.5), surface: true },

  engine('engine_s_launch', 'Wróbel — 0.6 Launch', 'S', 0.9, 0.13, 22, 25, 265, 300),
  engine('engine_s_vac', 'Sowa — 0.6 Vacuum', 'S', 1.2, 0.08, 2, 8, 80, 335),
  engine('engine_m_launch', 'Bocian — 1.25 Launch', 'M', 1.8, 1.5, 205, 240, 270, 310),
  engine('engine_m_vac', 'Czapla — 1.25 Vacuum', 'M', 2.4, 0.6, 15, 65, 85, 345),
  engine('engine_l_launch', 'Orzeł — 2.5 Launch', 'L', 3.2, 6.0, 1380, 1500, 285, 312),
  engine('engine_l_vac', 'Żuraw — 2.5 Vacuum', 'L', 4.2, 1.9, 65, 260, 90, 342),
  { id: 'srb_s', name: 'Solid Booster 0.6', cat: 'engines', dia: D.S, h: 4.0, mass: 0.3, fuel: { solid: 1.6 }, thrust: { asl: 110, vac: 125 }, isp: { asl: 175, vac: 200 }, nodes: stack(D.S, 4.0, true, false), stage: 'engine', radial: true, surface: true },
  { id: 'srb_m', name: 'Solid Booster 1.25', cat: 'engines', dia: D.M, h: 8.0, mass: 2.4, fuel: { solid: 13.5 }, thrust: { asl: 610, vac: 690 }, isp: { asl: 190, vac: 215 }, nodes: stack(D.M, 8.0, true, false), stage: 'engine', radial: true, surface: true },

  { id: 'decoupler_s', name: 'Decoupler 0.6', cat: 'structure', dia: D.S, h: 0.12, mass: 0.015, nodes: stack(D.S, 0.12), stage: 'decoupler' },
  { id: 'decoupler_m', name: 'Decoupler 1.25', cat: 'structure', dia: D.M, h: 0.2, mass: 0.05, nodes: stack(D.M, 0.2), stage: 'decoupler' },
  { id: 'decoupler_l', name: 'Decoupler 2.5', cat: 'structure', dia: D.L, h: 0.35, mass: 0.2, nodes: stack(D.L, 0.35), stage: 'decoupler' },
  { id: 'radial_decoupler', name: 'Radial Decoupler', cat: 'structure', mass: 0.04, radialOnly: true, surface: true, stage: 'decoupler', standoff: 0.32 },
  { id: 'adapter_sm', name: 'Adapter 0.6 – 1.25', cat: 'structure', dia: D.M, h: 0.8, mass: 0.06, nodes: stack(D.M, 0.8, true, true, D.S), surface: true },
  { id: 'adapter_ml', name: 'Adapter 1.25 – 2.5', cat: 'structure', dia: D.L, h: 1.6, mass: 0.3, nodes: stack(D.L, 1.6, true, true, D.M), surface: true },
  { id: 'fairing_m_base', name: 'Fairing 1.25', cat: 'structure', dia: D.M, h: 0.25, mass: 0.18, nodes: stack(D.M, 0.25), stage: 'fairing', shell: 'fairing_m_shell' },
  { id: 'fairing_l_base', name: 'Fairing 2.5', cat: 'structure', dia: D.L, h: 0.4, mass: 0.6, nodes: stack(D.L, 0.4), stage: 'fairing', shell: 'fairing_l_shell' },
  { id: 'leg', name: 'Landing Leg', cat: 'structure', mass: 0.1, radialOnly: true },

  { id: 'nose_s', name: 'Nose Cone 0.6', cat: 'aero', dia: D.S, h: 0.9, mass: 0.02, nodes: stack(D.S, 0.9, false, true) },
  { id: 'nose_m', name: 'Nose Cone 1.25', cat: 'aero', dia: D.M, h: 1.8, mass: 0.08, nodes: stack(D.M, 1.8, false, true) },
  { id: 'nose_l', name: 'Nose Cone 2.5', cat: 'aero', dia: D.L, h: 3.2, mass: 0.35, nodes: stack(D.L, 3.2, false, true) },
  { id: 'fin_small', name: 'Fin Small', cat: 'aero', mass: 0.02, radialOnly: true },
  { id: 'fin_large', name: 'Fin Large', cat: 'aero', mass: 0.16, radialOnly: true },
  { id: 'gridfin', name: 'Grid Fin', cat: 'aero', mass: 0.09, radialOnly: true },
  { id: 'heatshield_m', name: 'Heat Shield 1.25', cat: 'aero', dia: D.M, h: 0.2, mass: 0.12, nodes: stack(D.M, 0.2) },
  { id: 'heatshield_l', name: 'Heat Shield 2.5', cat: 'aero', dia: D.L, h: 0.35, mass: 0.5, nodes: stack(D.L, 0.35) },

  { id: 'chute_m', name: 'Parachute 1.25', cat: 'utility', dia: D.M, h: 0.5, mass: 0.1, nodes: stack(D.M, 0.5, false, true), stage: 'chute' },
  { id: 'chute_radial', name: 'Radial Parachute', cat: 'utility', mass: 0.05, radialOnly: true, stage: 'chute' },
  { id: 'rcs', name: 'RCS Thruster Block', cat: 'utility', mass: 0.02, radialOnly: true },
  { id: 'wheel_m', name: 'Reaction Wheel 1.25', cat: 'utility', dia: D.M, h: 0.3, mass: 0.1, nodes: stack(D.M, 0.3), surface: true },
  { id: 'battery_m', name: 'Battery 1.25', cat: 'utility', dia: D.M, h: 0.15, mass: 0.05, nodes: stack(D.M, 0.15) },
  { id: 'solar', name: 'Solar Panel', cat: 'utility', mass: 0.03, radialOnly: true },
  { id: 'antenna', name: 'Dish Antenna', cat: 'utility', mass: 0.02, radialOnly: true },
];

export const PARTS = Object.fromEntries(LIST.map((p) => [p.id, p]));
export const PART_LIST = LIST;
export const MODEL_IDS = [...LIST.map((p) => p.id), ...LIST.filter((p) => p.shell).map((p) => p.shell)];

export const fuelMass = (def) => Object.values(def.fuel || {}).reduce((a, b) => a + b, 0);
export const canRadial = (def) => !!(def.radialOnly || def.radial);
export const canStack = (def) => !!def.nodes;
export const radialStandoff = (def) => (def.radialOnly ? 0 : def.dia / 2);
