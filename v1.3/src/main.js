// Entry point: load assets, render catalog thumbnails, run the VAB editor and hand over to flight.
import { loadAssets, renderThumbnails } from './assets.js';
import { Editor } from './editor.js';
import { UI } from './ui.js';
import { Flight } from './flight/flight.js';
import { loadWorld } from './world.js';

const bar = document.querySelector('#loadbar');

async function boot() {
  await loadAssets((t) => { bar.style.width = `${Math.round(t * 100)}%`; });
  const thumbs = renderThumbnails();
  const canvas = document.querySelector('#view');
  const editor = new Editor(canvas);
  const ui = new UI(editor, thumbs);
  const app = { editor, ui, flight: null };
  const fly = (resumeIndex) => {
    if (app.flight) return;
    editor.pause();
    document.body.classList.add('flying');
    app.flight = new Flight({
      renderer: editor.renderer, canvas, design: editor.vessel.toJSON(), world: loadWorld(), resumeIndex,
      onExit: () => { app.flight = null; document.body.classList.remove('flying'); editor.resume(); ui.refresh(); },
    });
  };
  ui.onLaunch = () => fly(-1);
  ui.onFly = (i) => fly(i);
  window.gsp = app;
  document.querySelector('#loading').classList.add('done');
}

boot().catch((err) => {
  console.error(err);
  document.querySelector('#loading .sub').textContent = `FAILED TO LOAD — ${err.message}`;
});
