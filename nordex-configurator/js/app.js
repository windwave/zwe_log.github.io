// Nordex Delta4000 interactive turbine configurator — MVP
// - procedural Delta4000 turbine model (variant selectable)
// - clickable component tree / 3D picking
// - sub-component replacement via uploaded 3D files (.glb/.gltf/.stl/.obj)
// - fit check against each slot's installation envelope:
//     fits     -> green popup
//     misfit   -> red popup + camera zoom to the violating dimensions

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

/* ================================================================== *
 *  Data: Delta4000 variants and nacelle sub-component slots
 * ================================================================== */

const VARIANTS = {
  'N175/6.X': { rotor: 175, hubHeight: 112, rating: '6.8 MW' },
  'N163/6.X': { rotor: 163, hubHeight: 118, rating: '6.8 MW' },
  'N155/5.X': { rotor: 155, hubHeight: 120, rating: '5.9 MW' },
  'N149/5.X': { rotor: 149, hubHeight: 125, rating: '5.7 MW' },
  'N133/4.8': { rotor: 133, hubHeight: 110, rating: '4.8 MW' },
};
const DEFAULT_VARIANT = 'N163/6.X';

// Nacelle-internal sub-component slots.
// size = installation envelope [length(x), height(y), width(z)] in meters,
// pos  = slot center in nacelle-local coordinates (x towards hub).
const SLOTS = {
  mainBearing: {
    name: 'Main bearing', color: 0xc9a227,
    size: [1.6, 2.6, 2.6], pos: [3.6, 0.15, 0],
    desc: 'Rotor main bearing unit. Carries rotor loads into the bedplate.',
    explode: [0.0, 2.5, 0],
  },
  mainShaft: {
    name: 'Main shaft', color: 0x9aa5b1,
    size: [2.3, 1.3, 1.3], pos: [1.9, 0.15, 0],
    desc: 'Low-speed shaft connecting rotor hub and gearbox.',
    explode: [0, 3.5, 0],
  },
  gearbox: {
    name: 'Gearbox', color: 0x3b82f6,
    size: [2.9, 2.9, 2.9], pos: [-0.2, 0.25, 0],
    desc: 'Multi-stage planetary/spur gearbox stepping rotor speed up for the generator.',
    explode: [0, 4.5, 0],
  },
  coupling: {
    name: 'Coupling & brake', color: 0xa855f7,
    size: [1.1, 1.1, 1.1], pos: [-1.9, 0.35, 0],
    desc: 'High-speed shaft coupling with integrated rotor brake disc.',
    explode: [0, 3.0, 0],
  },
  generator: {
    name: 'Generator', color: 0x10b981,
    size: [2.6, 2.5, 2.5], pos: [-3.6, 0.25, 0],
    desc: 'Doubly-fed induction generator (Delta4000 drivetrain).',
    explode: [0, 4.0, 0],
  },
  transformer: {
    name: 'Transformer', color: 0xf97316,
    size: [1.7, 2.4, 2.1], pos: [-5.3, 0.1, 0],
    desc: 'Nacelle-integrated medium-voltage transformer at the rear.',
    explode: [-3.0, 1.5, 0],
  },
  cooling: {
    name: 'Cooling unit', color: 0x38bdf8,
    size: [2.1, 1.0, 2.2], pos: [-4.6, 2.35, 0],
    desc: 'Roof-top passive/active cooler package.',
    explode: [0, 2.5, 0],
  },
  yaw: {
    name: 'Yaw system', color: 0xe45f5f,
    size: [2.2, 0.9, 2.2], pos: [2.6, -1.75, 0],
    desc: 'Yaw bearing and drives orienting the nacelle into the wind.',
    explode: [0, -2.5, 0],
  },
};

// Structural (non-replaceable) components shown in the tree.
const STRUCTURE = {
  tower:   { name: 'Tower',   color: 0xd7dbe0, desc: 'Tubular steel / hybrid tower.' },
  nacelle: { name: 'Nacelle housing', color: 0xbfc7cf, desc: 'Glass-fibre nacelle cover on the bedplate.' },
  hub:     { name: 'Hub & spinner',   color: 0xd7dbe0, desc: 'Cast rotor hub with pitch system, aerodynamic spinner.' },
  blades:  { name: 'Rotor blades (3×)', color: 0xe8ecef, desc: 'NR-series glass/carbon hybrid blades with serrations.' },
};

const FIT_TOLERANCE = 0.02;        // +2 % envelope tolerance
const NACELLE_DIMS = [13.2, 4.4, 4.6]; // housing L,H,W

/* ================================================================== *
 *  Scene setup
 * ================================================================== */

const canvas = document.getElementById('canvas3d');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101725);
scene.fog = new THREE.Fog(0x101725, 400, 1200);

const camera = new THREE.PerspectiveCamera(50, 2, 0.1, 3000);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.52;

// lights
scene.add(new THREE.HemisphereLight(0xbdd3ff, 0x2a2f38, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 2.0);
sun.position.set(120, 220, 140);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -200; sun.shadow.camera.right = 200;
sun.shadow.camera.top = 200; sun.shadow.camera.bottom = -200;
sun.shadow.camera.far = 800;
scene.add(sun);
scene.add(new THREE.DirectionalLight(0x88aaff, 0.4).translateX(-100).translateY(50));

// ground
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(700, 64),
  new THREE.MeshStandardMaterial({ color: 0x24402c, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(400, 40, 0x33507a, 0x1c2c48);
grid.position.y = 0.02;
scene.add(grid);

/* ================================================================== *
 *  Procedural turbine builder
 * ================================================================== */

const matSteel = new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.45, metalness: 0.15 });
const matHousing = new THREE.MeshStandardMaterial({
  color: 0xcfd6dd, roughness: 0.5, metalness: 0.05,
  transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide,
});

let turbine = null;        // root group
let nacelleGroup = null;   // nacelle-local group (slots live here)
let rotorGroup = null;     // spins
let housingMesh = null;
const slotRuntime = {};    // id -> { group, mesh, envelopeHelper, custom, status }
const structureMeshes = {}; // id -> mesh/group for structural parts

function makeBladeGeometry(length) {
  // Loft a blade-ish shape out of a cylinder: chord/thickness/twist vary along span.
  const geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 14, 30, false);
  geo.translate(0, 0.5, 0); // root at y=0, tip at y=1
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const t = THREE.MathUtils.clamp(v.y, 0, 1); // 0 root -> 1 tip
    // chord: cylindrical root, max at ~22% span, tapering to slim tip
    const grow = Math.min(t / 0.22, 1);
    const chord = THREE.MathUtils.lerp(2.2, 4.6, Math.sin(grow * Math.PI / 2)) * (1 - 0.82 * Math.max(0, (t - 0.22) / 0.78));
    const thick = chord * THREE.MathUtils.lerp(0.9, 0.16, Math.min(t / 0.3, 1));
    const twist = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(16, -1, Math.sqrt(t)));
    let x = v.x * chord, z = v.z * thick;
    const c = Math.cos(twist), s = Math.sin(twist);
    p.setXYZ(i, x * c - z * s, v.y * length, x * s + z * c);
  }
  geo.computeVertexNormals();
  return geo;
}

function makePlaceholder(id, def) {
  // Stylized default sub-component sized to ~92 % of its envelope.
  const [L, H, W] = def.size.map(d => d * 0.92);
  const mat = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.5, metalness: 0.3 });
  const g = new THREE.Group();
  let main;
  if (id === 'mainShaft') {
    main = new THREE.Mesh(new THREE.CylinderGeometry(H * 0.35, H * 0.42, L, 24), mat);
    main.rotation.z = Math.PI / 2;
  } else if (id === 'generator') {
    main = new THREE.Mesh(new THREE.CylinderGeometry(H * 0.46, H * 0.46, L * 0.95, 28), mat);
    main.rotation.z = Math.PI / 2;
    const fin = new THREE.Mesh(new THREE.BoxGeometry(L * 0.7, H * 0.98, W * 0.1), mat);
    g.add(fin);
  } else if (id === 'mainBearing') {
    main = new THREE.Mesh(new THREE.TorusGeometry(H * 0.36, H * 0.13, 16, 32), mat);
    main.rotation.y = Math.PI / 2;
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(H * 0.5, H * 0.5, L * 0.8, 24), mat);
    housing.rotation.z = Math.PI / 2;
    g.add(housing);
  } else if (id === 'coupling') {
    main = new THREE.Mesh(new THREE.CylinderGeometry(H * 0.45, H * 0.45, L * 0.9, 20), mat);
    main.rotation.z = Math.PI / 2;
  } else if (id === 'cooling') {
    main = new THREE.Mesh(new THREE.BoxGeometry(L, H, W), mat);
    for (let i = -2; i <= 2; i++) {
      const lam = new THREE.Mesh(new THREE.BoxGeometry(L * 1.01, H * 0.08, W * 0.9),
        new THREE.MeshStandardMaterial({ color: 0x9fb6c8, roughness: 0.4, metalness: 0.5 }));
      lam.position.y = i * H * 0.18;
      g.add(lam);
    }
  } else if (id === 'yaw') {
    main = new THREE.Mesh(new THREE.CylinderGeometry(W * 0.5, W * 0.5, H * 0.8, 32), mat);
    for (let i = 0; i < 4; i++) {
      const drv = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, H * 0.95, 12), mat);
      const a = i * Math.PI / 2 + Math.PI / 4;
      drv.position.set(Math.cos(a) * W * 0.42, 0.1, Math.sin(a) * W * 0.42);
      g.add(drv);
    }
  } else {
    // gearbox, transformer: ribbed box
    main = new THREE.Mesh(new THREE.BoxGeometry(L, H, W), mat);
    for (let i = -1; i <= 1; i++) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(L * 0.08, H * 1.04, W * 1.04), mat);
      rib.position.x = i * L * 0.3;
      g.add(rib);
    }
  }
  main.castShadow = true;
  g.add(main);
  g.traverse(o => { o.castShadow = true; });
  return g;
}

function buildTurbine(variantKey) {
  if (turbine) { scene.remove(turbine); disposeTree(turbine); }
  const v = VARIANTS[variantKey];
  turbine = new THREE.Group();

  // --- tower ---
  const towerH = v.hubHeight - 1.5;
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 4.4, towerH, 40), matSteel);
  tower.position.y = towerH / 2;
  tower.castShadow = tower.receiveShadow = true;
  turbine.add(tower);
  const foundation = new THREE.Mesh(
    new THREE.CylinderGeometry(6.5, 7.5, 1.2, 40),
    new THREE.MeshStandardMaterial({ color: 0x8f8f8f, roughness: 0.9 }));
  foundation.position.y = 0.6;
  turbine.add(foundation);
  structureMeshes.tower = tower;

  // --- nacelle group ---
  nacelleGroup = new THREE.Group();
  nacelleGroup.position.y = v.hubHeight;
  turbine.add(nacelleGroup);

  const [NL, NH, NW] = NACELLE_DIMS;
  housingMesh = new THREE.Mesh(new THREE.BoxGeometry(NL, NH, NW, 2, 2, 2), matHousing);
  housingMesh.position.set(-0.8, 0.3, 0);
  nacelleGroup.add(housingMesh);
  structureMeshes.nacelle = housingMesh;

  const bedplate = new THREE.Mesh(
    new THREE.BoxGeometry(NL * 0.9, 0.4, NW * 0.8),
    new THREE.MeshStandardMaterial({ color: 0x5b6676, roughness: 0.6, metalness: 0.4 }));
  bedplate.position.set(-0.8, -1.5, 0);
  bedplate.castShadow = true;
  nacelleGroup.add(bedplate);

  // --- sub-component slots ---
  for (const [id, def] of Object.entries(SLOTS)) {
    const group = new THREE.Group();
    group.position.fromArray(def.pos);
    group.userData.basePos = new THREE.Vector3().fromArray(def.pos);
    nacelleGroup.add(group);

    const prev = slotRuntime[id];
    const mesh = prev?.custom ? prev.mesh : makePlaceholder(id, def);
    mesh.traverse(o => { o.userData.slotId = id; });
    group.add(mesh);

    const envelopeHelper = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(...envelopeToBox(def.size))),
      new THREE.LineBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.9 }));
    envelopeHelper.visible = false;
    group.add(envelopeHelper);

    slotRuntime[id] = {
      group, mesh, envelopeHelper,
      custom: prev?.custom ?? null,
      status: prev?.status ?? 'default',
    };
  }

  // --- rotor: hub + blades ---
  rotorGroup = new THREE.Group();
  rotorGroup.position.set(NL / 2 - 0.8 + 1.2, 0.15, 0);
  nacelleGroup.add(rotorGroup);

  const hub = new THREE.Mesh(new THREE.SphereGeometry(2.1, 28, 20), matSteel);
  hub.scale.set(1.25, 1, 1);
  hub.castShadow = true;
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(1.7, 2.4, 28), matSteel);
  spinner.rotation.z = -Math.PI / 2;
  spinner.position.x = 2.4;
  spinner.castShadow = true;
  rotorGroup.add(hub, spinner);
  structureMeshes.hub = hub;

  const bladeLen = v.rotor / 2 - 2.1;
  const bladeGeo = makeBladeGeometry(bladeLen);
  const matBlade = new THREE.MeshStandardMaterial({ color: 0xeef1f4, roughness: 0.35 });
  const bladesGroup = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Mesh(bladeGeo, matBlade);
    blade.castShadow = true;
    const holder = new THREE.Group();
    holder.rotation.x = i * (2 * Math.PI / 3);
    holder.add(blade);
    blade.position.y = 1.6;
    bladesGroup.add(holder);
  }
  rotorGroup.add(bladesGroup);
  structureMeshes.blades = bladesGroup;

  for (const [id, mesh] of Object.entries(structureMeshes)) {
    mesh.traverse ? mesh.traverse(o => { o.userData.structId = id; }) : (mesh.userData.structId = id);
  }

  scene.add(turbine);
  applyExplode(parseFloat(explodeSlider.value));
  applyHousingMode();
  setStatus(`Built ${variantKey} — rotor ⌀${v.rotor} m, hub height ${v.hubHeight} m, ${v.rating}.`);
}

function envelopeToBox(size) { return [size[0], size[1], size[2]]; }

function disposeTree(root) {
  root.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
  });
}

/* ================================================================== *
 *  Camera helpers (smooth fly-to)
 * ================================================================== */

const camAnim = { active: false, t: 0, fromPos: new THREE.Vector3(), toPos: new THREE.Vector3(), fromTgt: new THREE.Vector3(), toTgt: new THREE.Vector3() };

function flyTo(pos, target, duration = 1.1) {
  camAnim.fromPos.copy(camera.position);
  camAnim.fromTgt.copy(controls.target);
  camAnim.toPos.copy(pos);
  camAnim.toTgt.copy(target);
  camAnim.t = 0;
  camAnim.dur = duration;
  camAnim.active = true;
}

function overviewCamera() {
  const v = VARIANTS[variantSelect.value];
  const r = v.rotor;
  flyTo(new THREE.Vector3(r * 1.15, v.hubHeight * 0.85, r * 0.95),
        new THREE.Vector3(0, v.hubHeight * 0.62, 0), 1.2);
}

function zoomToSlot(id, dist = 9) {
  const rt = slotRuntime[id];
  const target = new THREE.Vector3();
  rt.group.getWorldPosition(target);
  const dir = new THREE.Vector3(0.55, 0.35, 1).normalize().multiplyScalar(dist);
  flyTo(target.clone().add(dir), target, 1.0);
}

/* ================================================================== *
 *  Selection / picking
 * ================================================================== */

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let selectedId = null; // slot id or struct id

canvas.addEventListener('pointerdown', e => { canvas._downXY = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', e => {
  const d = canvas._downXY;
  if (!d || Math.hypot(e.clientX - d[0], e.clientY - d[1]) > 5) return; // it was a drag
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(turbine.children, true)
    .filter(h => h.object.visible && h.object !== housingMesh);
  for (const h of hits) {
    const id = h.object.userData.slotId || h.object.userData.structId;
    if (id) { selectComponent(id); return; }
  }
  selectComponent(null);
});

function selectComponent(id) {
  selectedId = id;
  // tree highlight
  document.querySelectorAll('#componentTree li').forEach(li =>
    li.classList.toggle('selected', li.dataset.id === id));
  // envelope helpers off
  Object.values(slotRuntime).forEach(rt => { rt.envelopeHelper.visible = false; });
  clearMisfitViz();

  const inspector = document.getElementById('inspector');
  if (!id) { inspector.classList.add('hidden'); return; }
  inspector.classList.remove('hidden');

  const isSlot = !!SLOTS[id];
  const def = SLOTS[id] || STRUCTURE[id];
  document.getElementById('inspName').textContent = def.name;
  document.getElementById('inspDesc').textContent = def.desc;

  const envEl = document.getElementById('inspEnvelope');
  const curEl = document.getElementById('inspCurrent');
  const swap = document.getElementById('swapPanel');

  if (isSlot) {
    const rt = slotRuntime[id];
    rt.envelopeHelper.visible = true;
    const [L, H, W] = def.size;
    envEl.innerHTML = `
      <div class="cap">Installation envelope (max. dimensions)</div>
      <table>
        <tr><td>Length (along nacelle)</td><td>${L.toFixed(2)} m</td></tr>
        <tr><td>Height</td><td>${H.toFixed(2)} m</td></tr>
        <tr><td>Width</td><td>${W.toFixed(2)} m</td></tr>
        <tr><td>Tolerance</td><td>+${(FIT_TOLERANCE * 100).toFixed(0)} %</td></tr>
      </table>`;
    envEl.classList.remove('hidden');
    curEl.classList.remove('hidden');
    curEl.innerHTML = rt.custom
      ? `<div class="cap">Installed model</div>${rt.custom.fileName} — ${fmtDims(rt.custom.dims)}`
      : `<div class="cap">Installed model</div>OEM default component`;
    swap.classList.remove('hidden');
    document.getElementById('restoreBtn').classList.toggle('hidden', !rt.custom);
    zoomToSlot(id, Math.max(...def.size) * 3.4);
  } else {
    envEl.classList.add('hidden');
    curEl.classList.add('hidden');
    swap.classList.add('hidden');
    if (id === 'tower') {
      const v = VARIANTS[variantSelect.value];
      flyTo(new THREE.Vector3(60, v.hubHeight * 0.5, 60), new THREE.Vector3(0, v.hubHeight * 0.5, 0));
    } else if (id === 'blades' || id === 'hub') {
      const v = VARIANTS[variantSelect.value];
      flyTo(new THREE.Vector3(v.rotor * 0.9, v.hubHeight, v.rotor * 0.55), new THREE.Vector3(0, v.hubHeight, 0));
    } else if (id === 'nacelle') {
      zoomToSlot('gearbox', 26);
    }
  }
}

function fmtDims(d) { return `${d[0].toFixed(2)} × ${d[1].toFixed(2)} × ${d[2].toFixed(2)} m (L×H×W)`; }

/* ================================================================== *
 *  Component tree UI
 * ================================================================== */

function buildTree() {
  const ul = document.getElementById('componentTree');
  ul.innerHTML = '';
  const add = (id, def, child) => {
    const li = document.createElement('li');
    li.dataset.id = id;
    if (child) li.classList.add('child');
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = '#' + def.color.toString(16).padStart(6, '0');
    li.append(sw, document.createTextNode(def.name));
    const badge = document.createElement('span');
    badge.className = 'badge';
    li.appendChild(badge);
    li.addEventListener('click', () => selectComponent(id));
    ul.appendChild(li);
  };
  add('tower', STRUCTURE.tower);
  add('nacelle', STRUCTURE.nacelle);
  for (const [id, def] of Object.entries(SLOTS)) add(id, def, true);
  add('hub', STRUCTURE.hub);
  add('blades', STRUCTURE.blades);
  refreshBadges();
}

function refreshBadges() {
  document.querySelectorAll('#componentTree li').forEach(li => {
    const rt = slotRuntime[li.dataset.id];
    const badge = li.querySelector('.badge');
    if (!rt || !badge) return;
    if (rt.status === 'custom') { badge.textContent = 'custom ✓'; badge.className = 'badge custom'; }
    else if (rt.status === 'failed') { badge.textContent = 'misfit ✗'; badge.className = 'badge failed'; }
    else { badge.textContent = ''; badge.className = 'badge'; }
  });
}

/* ================================================================== *
 *  Upload + fit check
 * ================================================================== */

const gltfLoader = new GLTFLoader();
const stlLoader = new STLLoader();
const objLoader = new OBJLoader();

async function loadUserModel(file, unitScale) {
  const ext = file.name.split('.').pop().toLowerCase();
  let object;
  if (ext === 'glb' || ext === 'gltf') {
    const buf = await file.arrayBuffer();
    object = await new Promise((res, rej) =>
      gltfLoader.parse(buf, '', g => res(g.scene), rej));
  } else if (ext === 'stl') {
    const buf = await file.arrayBuffer();
    const geo = stlLoader.parse(buf);
    geo.computeVertexNormals();
    object = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x7dd3fc, roughness: 0.5, metalness: 0.3 }));
  } else if (ext === 'obj') {
    const text = await file.text();
    object = objLoader.parse(text);
    object.traverse(o => {
      if (o.isMesh) o.material = new THREE.MeshStandardMaterial({ color: 0x7dd3fc, roughness: 0.5, metalness: 0.3 });
    });
  } else {
    throw new Error(`Unsupported file type ".${ext}" — use .glb, .gltf, .stl or .obj`);
  }
  object.scale.setScalar(unitScale);
  object.updateMatrixWorld(true);
  return object;
}

function measure(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  box.getSize(size);
  return { box, dims: [size.x, size.y, size.z] };
}

function checkFit(dims, envelope) {
  const axes = ['Length (X)', 'Height (Y)', 'Width (Z)'];
  const rows = dims.map((d, i) => {
    const allowed = envelope[i] * (1 + FIT_TOLERANCE);
    return { axis: axes[i], idx: i, actual: d, allowed: envelope[i], over: Math.max(0, d - allowed) };
  });
  return { fits: rows.every(r => r.over <= 0), rows };
}

function installModel(slotId, object, meta) {
  const rt = slotRuntime[slotId];
  // center the model in the slot
  const { box } = measure(object);
  const center = new THREE.Vector3();
  box.getCenter(center);
  object.position.sub(center);
  const wrapper = new THREE.Group();
  wrapper.add(object);
  wrapper.traverse(o => { o.userData.slotId = slotId; o.castShadow = true; });

  rt.group.remove(rt.mesh);
  disposeTree(rt.mesh);
  rt.group.add(wrapper);
  rt.mesh = wrapper;
  rt.custom = meta;
  rt.status = 'custom';
  refreshBadges();
  selectComponent(slotId);
}

async function handleUpload(file, unitScale, generated = null) {
  if (!selectedId || !SLOTS[selectedId]) return;
  const slotId = selectedId;
  const def = SLOTS[slotId];
  showLoading(true, `Checking "${generated ? generated : file.name}" against ${def.name} envelope…`);
  try {
    const object = generated ? file : await loadUserModel(file, unitScale);
    const { dims } = measure(object);
    const result = checkFit(dims, def.size);
    const fileName = generated ? generated : file.name;

    if (result.fits) {
      installModel(slotId, object, { fileName, dims });
      slotRuntime[slotId].status = 'custom';
      showFitResult(true, slotId, fileName, result);
      setStatus(`${def.name}: "${fileName}" installed — fit OK.`);
    } else {
      slotRuntime[slotId].status = 'failed';
      refreshBadges();
      showMisfitViz(slotId, object, result);
      showFitResult(false, slotId, fileName, result);
      setStatus(`${def.name}: "${fileName}" DOES NOT FIT the installation envelope.`);
    }
  } catch (err) {
    console.error(err);
    alert('Could not load model: ' + err.message);
    setStatus('Model load failed: ' + err.message);
  } finally {
    showLoading(false);
  }
}

/* ---------- misfit visualization: ghost + red overflow indicators ---------- */

let misfitViz = null;

function showMisfitViz(slotId, object, result) {
  clearMisfitViz();
  const rt = slotRuntime[slotId];
  const def = SLOTS[slotId];
  const viz = new THREE.Group();

  // hide current component, show the rejected model as a red ghost centered in the slot
  rt.mesh.visible = false;
  const { box } = measure(object);
  const center = new THREE.Vector3();
  box.getCenter(center);
  object.position.sub(center);
  object.traverse(o => {
    if (o.isMesh) o.material = new THREE.MeshStandardMaterial({
      color: 0xef4444, transparent: true, opacity: 0.55, depthWrite: false,
    });
  });
  viz.add(object);

  // green envelope box (allowed space)
  const envBox = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(...def.size)),
    new THREE.LineBasicMaterial({ color: 0x22c55e }));
  viz.add(envBox);

  // red indicators on each violated axis
  const axisVec = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
  for (const row of result.rows) {
    if (row.over <= 0) continue;
    const dir = axisVec[row.idx];
    const half = def.size[row.idx] / 2;
    const overHalf = row.actual / 2;
    for (const sign of [1, -1]) {
      // translucent red plane at the envelope face that is being crossed
      const planeGeo = new THREE.PlaneGeometry(
        row.idx === 0 ? def.size[2] * 1.15 : def.size[0] * 1.15,
        row.idx === 1 ? def.size[2] * 1.15 : def.size[1] * 1.15);
      const plane = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({
        color: 0xef4444, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false,
      }));
      plane.position.copy(dir).multiplyScalar(sign * half);
      if (row.idx === 0) plane.rotation.y = Math.PI / 2;
      if (row.idx === 1) plane.rotation.x = Math.PI / 2;
      viz.add(plane);
      // arrow marking the overflow distance
      const arrow = new THREE.ArrowHelper(
        dir.clone().multiplyScalar(sign),
        dir.clone().multiplyScalar(sign * half),
        Math.max(overHalf - half, 0.4), 0xef4444, 0.35, 0.22);
      viz.add(arrow);
    }
  }

  rt.group.add(viz);
  misfitViz = { group: viz, slotId };
}

function clearMisfitViz() {
  if (!misfitViz) return;
  const rt = slotRuntime[misfitViz.slotId];
  rt.group.remove(misfitViz.group);
  disposeTree(misfitViz.group);
  rt.mesh.visible = true;
  misfitViz = null;
}

/* ---------- fit result popup ---------- */

function showFitResult(fits, slotId, fileName, result) {
  const modal = document.getElementById('fitModal');
  const card = document.getElementById('fitCard');
  const def = SLOTS[slotId];
  card.className = fits ? 'ok' : 'bad';
  document.getElementById('fitIcon').textContent = fits ? '✔' : '✖';
  document.getElementById('fitTitle').textContent = fits
    ? 'Component fits'
    : 'Component does NOT fit';

  const rowsHtml = result.rows.map(r => `
    <tr>
      <td>${r.axis}</td>
      <td>${r.actual.toFixed(2)} m</td>
      <td>${r.allowed.toFixed(2)} m</td>
      <td class="${r.over > 0 ? 'over' : 'okv'}">${r.over > 0 ? '+' + r.over.toFixed(2) + ' m over' : 'OK'}</td>
    </tr>`).join('');

  document.getElementById('fitBody').innerHTML = `
    <b>${fileName}</b> → <b>${def.name}</b> slot${fits
      ? ' — all dimensions are within the installation envelope. The component has been installed.'
      : ' — the highlighted dimensions exceed the installation envelope (+' + (FIT_TOLERANCE * 100).toFixed(0) + ' % tolerance). Red faces and arrows in the 3D view mark where it protrudes.'}
    <table>
      <tr><th>Dimension</th><th>Model</th><th>Envelope</th><th>Result</th></tr>
      ${rowsHtml}
    </table>`;

  document.getElementById('fitZoomBtn').classList.toggle('hidden', fits);
  modal.classList.remove('hidden');

  if (!fits) zoomToSlot(slotId, Math.max(...def.size) * 2.6);
  document.getElementById('fitZoomBtn').onclick = () => {
    modal.classList.add('hidden');
    zoomToSlot(slotId, Math.max(...def.size) * 1.9);
  };
}

document.getElementById('fitCloseBtn').addEventListener('click', () =>
  document.getElementById('fitModal').classList.add('hidden'));
document.getElementById('fitModal').addEventListener('click', e => {
  if (e.target.id === 'fitModal') e.target.classList.add('hidden');
});

/* ---------- sample generators (demo without files) ---------- */

function makeSample(slotId, oversizeFactor) {
  const def = SLOTS[slotId];
  const [L, H, W] = def.size.map(d => d * oversizeFactor);
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x7dd3fc, roughness: 0.4, metalness: 0.5 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(L * 0.94, H * 0.94, W * 0.94), mat);
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(H, W) * 0.28, Math.min(H, W) * 0.28, L, 20), mat);
  cyl.rotation.z = Math.PI / 2;
  g.add(body, cyl);
  return g;
}

/* ================================================================== *
 *  UI wiring
 * ================================================================== */

const variantSelect = document.getElementById('variantSelect');
const explodeSlider = document.getElementById('explodeSlider');

for (const [key, v] of Object.entries(VARIANTS)) {
  const opt = document.createElement('option');
  opt.value = key;
  opt.textContent = `${key} (${v.rating}, ⌀${v.rotor} m)`;
  if (key === DEFAULT_VARIANT) opt.selected = true;
  variantSelect.appendChild(opt);
}

variantSelect.addEventListener('change', () => {
  clearMisfitViz();
  buildTurbine(variantSelect.value);
  overviewCamera();
});

explodeSlider.addEventListener('input', () => applyExplode(parseFloat(explodeSlider.value)));

function applyExplode(t) {
  if (!nacelleGroup) return;
  for (const [id, def] of Object.entries(SLOTS)) {
    const rt = slotRuntime[id];
    rt.group.position.copy(rt.group.userData.basePos)
      .add(new THREE.Vector3().fromArray(def.explode).multiplyScalar(t));
  }
  if (rotorGroup) rotorGroup.position.x = (NACELLE_DIMS[0] / 2 - 0.8 + 1.2) + t * 9;
}

document.getElementById('housingToggle').addEventListener('change', applyHousingMode);
function applyHousingMode() {
  const xray = document.getElementById('housingToggle').checked;
  matHousing.opacity = xray ? 0.22 : 1.0;
  matHousing.transparent = xray;
  matHousing.depthWrite = !xray;
  matHousing.needsUpdate = true;
}

document.getElementById('resetViewBtn').addEventListener('click', () => {
  selectComponent(null);
  overviewCamera();
});
document.getElementById('inspectorClose').addEventListener('click', () => selectComponent(null));

const fileInput = document.getElementById('fileInput');
document.getElementById('uploadBtn').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files.length) {
    handleUpload(fileInput.files[0], parseFloat(document.getElementById('unitSelect').value));
    fileInput.value = '';
  }
});

document.getElementById('sampleFitBtn').addEventListener('click', () => {
  if (!selectedId || !SLOTS[selectedId]) return;
  handleUpload(makeSample(selectedId, 0.9), 1, `sample-${selectedId}-ok.glb`);
});
document.getElementById('sampleBigBtn').addEventListener('click', () => {
  if (!selectedId || !SLOTS[selectedId]) return;
  handleUpload(makeSample(selectedId, 1.28), 1, `sample-${selectedId}-oversized.glb`);
});

document.getElementById('restoreBtn').addEventListener('click', () => {
  const id = selectedId;
  if (!id || !SLOTS[id]) return;
  clearMisfitViz();
  const rt = slotRuntime[id];
  rt.group.remove(rt.mesh);
  disposeTree(rt.mesh);
  const mesh = makePlaceholder(id, SLOTS[id]);
  mesh.traverse(o => { o.userData.slotId = id; });
  rt.group.add(mesh);
  rt.mesh = mesh;
  rt.custom = null;
  rt.status = 'default';
  refreshBadges();
  selectComponent(id);
  setStatus(`${SLOTS[id].name}: restored OEM default component.`);
});

// drag & drop upload
const dropHint = document.getElementById('dropHint');
window.addEventListener('dragover', e => {
  e.preventDefault();
  if (selectedId && SLOTS[selectedId]) {
    document.getElementById('dropSlotName').textContent = SLOTS[selectedId].name;
    dropHint.classList.remove('hidden');
  }
});
window.addEventListener('dragleave', e => { if (!e.relatedTarget) dropHint.classList.add('hidden'); });
window.addEventListener('drop', e => {
  e.preventDefault();
  dropHint.classList.add('hidden');
  if (selectedId && SLOTS[selectedId] && e.dataTransfer.files.length) {
    handleUpload(e.dataTransfer.files[0], parseFloat(document.getElementById('unitSelect').value));
  }
});

function showLoading(on, text = '') {
  document.getElementById('loadingOverlay').classList.toggle('hidden', !on);
  if (text) document.getElementById('loadingText').textContent = text;
}
function setStatus(t) { document.getElementById('statusText').textContent = t; }

/* ================================================================== *
 *  Render loop
 * ================================================================== */

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) ||
      canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
}

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  resize();
  const dt = clock.getDelta();

  if (document.getElementById('spinToggle').checked && rotorGroup) {
    rotorGroup.rotation.x -= dt * 0.5;
  }
  if (camAnim.active) {
    camAnim.t += dt / camAnim.dur;
    const k = camAnim.t >= 1 ? 1 : 1 - Math.pow(1 - camAnim.t, 3);
    camera.position.lerpVectors(camAnim.fromPos, camAnim.toPos, k);
    controls.target.lerpVectors(camAnim.fromTgt, camAnim.toTgt, k);
    if (camAnim.t >= 1) camAnim.active = false;
  }
  // pulse misfit ghost
  if (misfitViz) {
    const pulse = 0.45 + 0.2 * Math.sin(clock.elapsedTime * 5);
    misfitViz.group.traverse(o => {
      if (o.isMesh && o.material.transparent && o.material.color?.getHex() === 0xef4444 && o.geometry.type !== 'PlaneGeometry') {
        o.material.opacity = pulse;
      }
    });
  }
  controls.update();
  renderer.render(scene, camera);
}

/* ================================================================== *
 *  Boot
 * ================================================================== */

buildTree();
buildTurbine(DEFAULT_VARIANT);
camera.position.set(180, 120, 160);
controls.target.set(0, 75, 0);
overviewCamera();
animate();
