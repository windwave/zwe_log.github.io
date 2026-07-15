# Wind Turbine Configurator (MVP)

A browser-based 3D configurator for a modern multi-megawatt wind turbine.
Pure static web app (Three.js, vendored locally) — no build step, no backend —
so it runs directly on GitHub Pages.

**Live:** `https://<your-pages-domain>/turbine-configurator/`

## Features

- **Interactive 3D turbine** — orbit / zoom / pan, selectable turbine variants
  (WT-133 … WT-175) with matching rotor diameter and hub height.
- **Component navigation** — click parts in the 3D view or in the component tree:
  tower, nacelle, hub, blades, 10 nacelle sub-components (main bearing, main
  shaft, gearbox, coupling & brake, generator, transformer, cooling unit, yaw
  system, control cabinets, lubrication unit) and 4 hub sub-components (pitch
  bearing, pitch drive/motor, pitch battery box, hub control cabinet).
  X-ray toggles for the nacelle housing and the hub spinner, plus an exploded
  view slider, reveal the drivetrain and pitch system.
- **Sub-component replacement** — select a slot and upload your own 3D model
  (`.glb`, `.gltf`, `.stl`, `.obj`; unit selector m/cm/mm; drag & drop supported).
  Per-blade components (3×) install one model at all three blade positions.
- **Fit check** — the uploaded model's bounding dimensions are validated against
  the slot's installation envelope (+2 % tolerance):
  - ✅ **Fits** → green popup, model is installed in the slot.
  - ❌ **Doesn't fit** → red popup listing exactly which dimensions exceed the
    envelope and by how much; the camera zooms to the slot and red faces/arrows
    mark where the part protrudes past the green envelope.
- **Built-in demo samples** — "correct size" and "oversized" generated test
  components, so the full flow can be demonstrated without any model files.

## Run locally

Any static file server works:

```bash
cd turbine-configurator
python3 -m http.server 8000
# open http://localhost:8000
```

(Opening `index.html` via `file://` won't work because ES modules require HTTP.)

## Notes / MVP limitations

- The turbine geometry is a stylized, procedurally generated representation of
  a generic geared-drivetrain turbine, not vendor CAD data. Envelope dimensions
  are illustrative placeholders — replace the values in `js/app.js` (`SLOTS`)
  with real installation envelopes.
- Fit checking is bounding-box based (axis-aligned, with tolerance). Mesh-level
  collision/clearance checking would be the next iteration.
- Three.js r160 is vendored locally in `vendor/` (see `vendor/THREE_LICENSE`),
  so the app is fully self-contained and needs no CDN at page load.
