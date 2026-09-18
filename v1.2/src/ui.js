// DOM interface: catalog, stats, staging, paint, symmetry, save/load dialogs.
import { CATEGORIES, PART_LIST, PARTS, fuelMass } from './catalog.js';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const fmt = (n, d = 2) => (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(d));
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const STORE = 'gsp_designs_v1';
const CURRENT = 'gsp_current_v1';
const PRESETS = [['#ebebed', '#0b0b0d'], ['#0b0b0d', '#ebebed'], ['#c9ccd1', '#2a2d33'], ['#f2efe6', '#d4321f'], ['#ebebed', '#ff6a13'], ['#12305c', '#ebebed'], ['#f5c518', '#0b0b0d']];

export class UI {
  constructor(editor, thumbs) {
    this.ed = editor;
    this.thumbs = thumbs;
    this.cat = 'all';
    this.buildCatalog();
    this.buildBottom();
    this.bindTop();
    editor.on((toast) => { if (toast) this.toast(toast); this.refresh(); });
    for (const id of ['top', 'launch', 'catalog', 'side', 'bottom', 'hint']) $(`#${id}`).hidden = false;
    this.restoreCurrent();
    this.refresh();
  }

  designs() { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } }

  buildCatalog() {
    const panel = $('#catalog'), head = $('#cathead');
    const list = el('div');
    const toggle = (open) => { panel.classList.toggle('open', open); head.setAttribute('aria-expanded', open); };
    head.onclick = () => toggle(!panel.classList.contains('open'));
    for (const c of [{ id: 'all', name: 'All parts' }, ...CATEGORIES]) {
      const count = c.id === 'all' ? PART_LIST.length : PART_LIST.filter((p) => p.cat === c.id).length;
      const b = el('button', '', `${c.name}<small>${count}</small>`);
      b.dataset.cat = c.id;
      b.onclick = () => { this.cat = c.id; this.renderParts(); toggle(false); };
      list.append(b);
    }
    $('#cats').append(list);
    this.renderParts();
  }

  renderParts() {
    document.querySelectorAll('#cats button').forEach((b) => b.classList.toggle('on', b.dataset.cat === this.cat));
    const shown = PART_LIST.filter((p) => this.cat === 'all' || p.cat === this.cat);
    $('#catlabel').textContent = this.cat === 'all' ? 'All parts' : CATEGORIES.find((c) => c.id === this.cat).name;
    $('#catcount').textContent = shown.length;
    const wrap = $('#parts');
    wrap.replaceChildren();
    wrap.scrollTop = 0;
    let last = null;
    for (const def of shown) {
      if (this.cat === 'all' && def.cat !== last) { last = def.cat; wrap.append(el('h5', '', CATEGORIES.find((c) => c.id === def.cat).name)); }
      const b = el('button', 'part', `<img src="${this.thumbs[def.id]}" alt="${esc(def.name)}">`);
      b.dataset.id = def.id;
      b.onclick = () => this.ed.pickFromCatalog(def.id);
      b.onmouseenter = () => this.tip(def, b);
      b.onmouseleave = () => { $('#tip').hidden = true; };
      wrap.append(b);
    }
  }

  tip(def, anchor) {
    const rows = [['Mass', `${fmt(def.mass + fuelMass(def))} t`]];
    if (def.fuel) for (const [k, v] of Object.entries(def.fuel)) rows.push([`${k} fuel`, `${fmt(v)} t`]);
    if (def.thrust) rows.push(['Thrust', `${def.thrust.asl} / ${def.thrust.vac} kN`], ['Isp', `${def.isp.asl} / ${def.isp.vac} s`]);
    if (def.dia) rows.push(['Diameter', `${def.dia} m`]);
    if (def.crew) rows.push(['Crew', def.crew]);
    rows.push(['Mount', def.radialOnly ? 'surface' : def.radial ? 'stack + surface' : 'stack']);
    const t = $('#tip');
    t.innerHTML = `<h4>${esc(def.name)}</h4><dl>${rows.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('')}</dl>`;
    t.hidden = false;
    const r = anchor.getBoundingClientRect();
    t.style.left = '234px';
    t.style.top = `${Math.min(r.top, innerHeight - t.offsetHeight - 16)}px`;
  }

  buildBottom() {
    const ed = this.ed;
    document.querySelectorAll('#tools button').forEach((b) => { b.onclick = () => ed.setTool(b.dataset.tool); });
    for (const n of [1, 2, 3, 4, 6, 8]) {
      const b = el('button', '', n);
      b.dataset.n = n;
      b.title = `${n}× symmetry — X cycles`;
      b.onclick = () => ed.setSymmetry(n);
      $('#sym').append(b);
    }
    $('#cmain').oninput = (e) => ed.setColors({ main: e.target.value });
    $('#caccent').oninput = (e) => ed.setColors({ accent: e.target.value });
    for (const [main, accent] of PRESETS) {
      const b = el('button', '', `<i style="background:${main}"></i><i style="background:${accent}"></i>`);
      b.title = 'Livery preset';
      b.onclick = () => { ed.setColors({ main, accent }); if (ed.tool !== 'paint') ed.setTool('paint'); };
      $('#swatches').append(b);
    }
    $('#autostage').onclick = () => ed.resetStaging();
  }

  bindTop() {
    const ed = this.ed;
    const name = $('#name');
    name.oninput = () => { ed.vessel.name = name.value || 'Untitled Rocket'; this.autosave(); };
    name.onkeydown = (e) => { if (e.key === 'Enter') name.blur(); };
    const acts = {
      new: () => { ed.clear(); ed.vessel.name = 'Untitled Rocket'; this.refresh(); },
      save: () => this.save(),
      open: () => this.openDialog(),
      export: () => this.exportFile(),
      import: () => $('#file').click(),
      undo: () => ed.undo(),
      redo: () => ed.redo(),
    };
    document.querySelectorAll('#top nav button').forEach((b) => { b.onclick = acts[b.dataset.act]; });
    $('#file').onchange = async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try { ed.load(JSON.parse(await f.text())); this.toast(`Imported ${ed.vessel.name}`); } catch { this.toast('That file is not a GSP design'); }
    };
    $('#modal-close').onclick = () => { $('#modal').hidden = true; };
    $('#modal').onclick = (e) => { if (e.target.id === 'modal') $('#modal').hidden = true; };
  }

  save() {
    if (!this.ed.vessel.size) return this.toast('Nothing to save yet');
    const all = this.designs();
    all[this.ed.vessel.name] = { ...this.ed.vessel.toJSON(), saved: Date.now() };
    localStorage.setItem(STORE, JSON.stringify(all));
    return this.toast(`Saved “${this.ed.vessel.name}”`);
  }

  openDialog() {
    const all = this.designs();
    const names = Object.keys(all).sort((a, b) => all[b].saved - all[a].saved);
    $('#modal-title').textContent = 'Saved designs';
    const body = $('#modal-body');
    body.replaceChildren();
    if (!names.length) body.append(el('p', 'empty', 'No saved designs yet. Build something and press Save.'));
    for (const n of names) {
      const row = el('div', 'row');
      const open = el('button', '', `${esc(n)}<small>${all[n].parts.length} parts</small>`);
      open.onclick = () => { this.ed.load(all[n]); $('#modal').hidden = true; };
      const del = el('button', '', '✕');
      del.title = 'Delete design';
      del.onclick = () => { const d = this.designs(); delete d[n]; localStorage.setItem(STORE, JSON.stringify(d)); this.openDialog(); };
      row.append(open, del);
      body.append(row);
    }
    $('#modal').hidden = false;
  }

  exportFile() {
    if (!this.ed.vessel.size) return this.toast('Nothing to export yet');
    const blob = new Blob([JSON.stringify(this.ed.vessel.toJSON(), null, 1)], { type: 'application/json' });
    const a = el('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.ed.vessel.name.replace(/[^\w-]+/g, '_')}.gsp.json`;
    a.click();
    return URL.revokeObjectURL(a.href);
  }

  autosave() { try { localStorage.setItem(CURRENT, JSON.stringify(this.ed.vessel.toJSON())); } catch { return; } }

  restoreCurrent() {
    try {
      const d = JSON.parse(localStorage.getItem(CURRENT));
      if (d && d.parts && d.parts.length) { this.ed.load(d); this.ed.undoStack.length = 0; }
    } catch { return; }
  }

  toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = true;
    void t.offsetWidth;
    t.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  renderStages() {
    const ed = this.ed, v = ed.vessel;
    const stages = v.stages();
    const wrap = $('#stages');
    wrap.replaceChildren();
    if (!stages.length) wrap.append(el('div', 'empty', 'Engines, decouplers and parachutes show up here. Stage 0 fires first.'));
    for (let i = stages.length - 1; i >= 0; i--) {
      const box = el('div', i === 0 ? 'stage first' : 'stage', `<b title="${i === 0 ? 'Fires first' : `Stage ${i}`}">${i}</b>`);
      const list = el('div');
      const seen = new Set();
      for (const id of stages[i]) {
        const p = v.parts.get(id);
        const key = p.sym || p.id;
        if (seen.has(key)) continue;
        seen.add(key);
        const def = PARTS[p.type];
        const n = stages[i].filter((x) => (v.parts.get(x).sym || x) === key).length;
        const row = el('div', 'item', `<i class="${def.stage}"></i><em>${esc(def.name)}${n > 1 ? ` ×${n}` : ''}</em>`);
        const up = el('button', '', '▲'), down = el('button', '', '▼');
        up.title = 'Fire later';
        down.title = 'Fire earlier';
        up.onclick = () => ed.moveStage(id, 1);
        down.onclick = () => ed.moveStage(id, -1);
        row.append(up, down);
        list.append(row);
      }
      box.append(list);
      wrap.append(box);
    }
  }

  refresh() {
    const ed = this.ed, v = ed.vessel;
    const name = $('#name');
    if (document.activeElement !== name) name.value = v.name;
    const s = v.stats();
    const twrCls = !s.thrust ? '' : s.twr >= 1.2 ? 'good' : 'low';
    $('#stats').innerHTML = [
      ['', fmt(s.wet), 't', 'Mass'], [twrCls, s.thrust ? s.twr.toFixed(2) : '—', '', 'Liftoff TWR'],
      ['', fmt(s.height, 1), 'm', 'Height'], ['', s.parts, '', 'Parts'],
    ].map(([c, val, u, l]) => `<div class="stat ${c}"><b>${val}<small>${u}</small></b><span>${l}</span></div>`).join('');
    $('#warnings').innerHTML = s.warnings.map((w) => `<div>${w}</div>`).join('');
    this.renderStages();
    document.querySelectorAll('#tools button').forEach((b) => b.classList.toggle('on', b.dataset.tool === ed.tool));
    document.querySelectorAll('#sym button').forEach((b) => b.classList.toggle('on', +b.dataset.n === ed.symmetry));
    document.querySelectorAll('.part').forEach((b) => b.classList.toggle('on', !!ed.held && ed.held.sub[0].type === b.dataset.id));
    $('#cmain').value = ed.colors.main;
    $('#caccent').value = ed.colors.accent;
    $('#hint').innerHTML = ed.tool === 'paint'
      ? '<kbd>Click</kbd>paint part<kbd>Shift+Click</kbd>whole rocket'
      : ed.held
        ? '<kbd>Click</kbd>place — green snaps, anywhere else floats free<kbd>X</kbd>symmetry<kbd>Alt</kbd>no snap<kbd>Esc</kbd>discard'
        : '<kbd>Drag</kbd>orbit<kbd>Scroll</kbd>zoom<kbd>Shift+Scroll</kbd>height<kbd>F</kbd>frame';
    this.autosave();
  }
}
