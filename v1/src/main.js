// Entry point: load assets, render catalog thumbnails, start the VAB editor.
import { loadAssets, renderThumbnails } from './assets.js';
import { Editor } from './editor.js';
import { UI } from './ui.js';

const bar = document.querySelector('#loadbar');

async function boot() {
  await loadAssets((t) => { bar.style.width = `${Math.round(t * 100)}%`; });
  const thumbs = renderThumbnails();
  const editor = new Editor(document.querySelector('#view'));
  const ui = new UI(editor, thumbs);
  window.gsp = { editor, ui };
  document.querySelector('#loading').classList.add('done');
}

boot().catch((err) => {
  console.error(err);
  document.querySelector('#loading .sub').textContent = `FAILED TO LOAD — ${err.message}`;
});
