// Persistent world: universal time and every vessel left in orbit or on the surface.
const KEY = 'gsp_world_v1';

export function loadWorld() {
  try {
    const w = JSON.parse(localStorage.getItem(KEY));
    if (w && Array.isArray(w.vessels)) return w;
  } catch { return { ut: 0, vessels: [] }; }
  return { ut: 0, vessels: [] };
}

export function saveWorld(world) {
  try { localStorage.setItem(KEY, JSON.stringify(world)); } catch { return false; }
  return true;
}
