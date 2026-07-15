# Nordex Delta4000 — Interactive Turbine Configurator (MVP)

A browser-based 3D configurator for the Nordex Delta4000 turbine platform.
Pure static web app (Three.js via CDN) — no build step, no backend — so it runs
directly on GitHub Pages.

**Live (after merge to `master`):** `https://<your-pages-domain>/nordex-configurator/`

## Features

- **Interactive 3D turbine** — orbit / zoom / pan, selectable Delta4000 variants
  (N175, N163, N155, N149, N133) with matching rotor diameter and hub height.
- **Component navigation** — click parts in the 3D view or in the component tree
  (tower, nacelle, hub, blades and 8 nacelle sub-components: main bearing, main
  shaft, gearbox, coupling, generator, transformer, cooling unit, yaw system).
  X-ray nacelle toggle and exploded view slider reveal the drivetrain.
- **Sub-component replacement** — select a slot and upload your own 3D model
  (`.glb`, `.gltf`, `.stl`, `.obj`; unit selector m/cm/mm; drag & drop supported).
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
cd nordex-configurator
python3 -m http.server 8000
# open http://localhost:8000
```

(Opening `index.html` via `file://` won't work because ES modules require HTTP.)

## Notes / MVP limitations

- The turbine geometry is a stylized, procedurally generated representation of
  the Delta4000 platform, not actual Nordex CAD data. Envelope dimensions are
  illustrative placeholders — replace the values in `js/app.js` (`SLOTS`) with
  real installation envelopes.
- Fit checking is bounding-box based (axis-aligned, with tolerance). Mesh-level
  collision/clearance checking would be the next iteration.
- Three.js r160 is loaded from the jsDelivr CDN; an internet connection is
  required at page load.
