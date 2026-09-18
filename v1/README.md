# Gzowo Space Program

Build rockets in the hangar, then fly them. A mini-KSP in the browser: three.js, no build step.

**Current build: the VAB (assembly hangar).** Flight, orbit, weapons, planes and stations follow in later phases.

- 45 parts in three diameters (0.6 / 1.25 / 2.5 m), all modelled by script in Blender and exported to GLB
- Node snapping, surface attach, 2–8× symmetry (inherited by parts on symmetric parents)
- Auto staging with manual override, live mass / liftoff TWR / height
- Two-zone paint per part, livery presets
- Undo/redo, autosave, named saves in localStorage, JSON export/import

## Controls

Drag orbit · scroll zoom · Shift+scroll height · F frame · click a catalog part then click to attach · click a placed part to pick it up · X symmetry · C angle snap · Alt free angle · Esc discard · 1/2 build/paint · Cmd/Ctrl+Z undo

## Regenerating models

Run inside Blender 4.5: `tools/build_parts.py` (parts) and `tools/build_hangar.py` (hangar). Both write straight into `assets/`.

## Run locally

Any static server, e.g. `python3 -m http.server` in this folder.
