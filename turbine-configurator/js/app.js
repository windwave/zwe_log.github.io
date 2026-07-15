// Interactive wind turbine configurator — MVP
// - procedural turbine model (variant selectable)
// - clickable component tree / 3D picking, X-ray for nacelle housing and hub spinner
// - nacelle drivetrain + hub pitch-system sub-components, replaceable via
//   uploaded 3D files (.glb/.gltf/.stl/.obj)
// - fit check against each slot's installation envelope:
//     fits     -> green popup
//     misfit   -> red popup + camera zoom to the violating dimensions

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

/* ================================================================== *
 *  Data: turbine variants and sub-component slots
 * ================================================================== */

const VARIANTS = {
  'WT-175': { rotor: 175, hubHeight: 112, rating: '6.8 MW' },
  'WT-163': { rotor: 163, hubHeight: 118, rating: '6.8 MW' },
  'WT-155': { rotor: 155, hubHeight: 120, rating: '5.9 MW' },
  'WT-149': { rotor: 149, hubHeight: 125, rating: '5.7 MW' },
  'WT-133': { rotor: 133, hubHeight: 110, rating: '4.8 MW' },
};
const DEFAULT_VARIANT = 'WT-163';

const FIT_TOLERANCE = 0.02;            // +2 % envelope tolerance
const NACELLE_DIMS = [13.2, 4.4, 4.6]; // housing L,H,W
const HUB_X = NACELLE_DIMS[0] / 2 - 0.8 + 1.6; // hub center in nacelle-local x

// Sub-component slots.
//   parent    'nacelle' (fixed frame) or 'hub' (rotates with the rotor)
//   size      installation envelope [x, y, z] in meters, in slot-local axes
//   perBlade  true -> 3 instances, one per blade root (slot-local +y = radial,
//             +x = rotor axis, +z = tangential)
//   pos       slot center: nacelle-local for nacelle slots, blade-root-local
//             for perBlade hub slots, hub-local for other hub slots
//   explode   slot-local exploded-view offset
const SLOTS = {
  /* ---------------- nacelle drivetrain ---------------- */
  mainBearing: {
    parent: 'nacelle', name: 'Main bearing', color: 0xc9a227,
    size: [1.6, 2.6, 2.6], pos: [3.6, 0.15, 0], explode: [0, 2.5, 0],
    desc: 'Double-row tapered roller main bearing in a cast pillow-block housing. Carries the rotor loads into the machine bedplate.',
  },
  mainShaft: {
    parent: 'nacelle', name: 'Main shaft', color: 0x9aa5b1,
    size: [2.3, 1.3, 1.3], pos: [1.9, 0.15, 0], explode: [0, 3.5, 0],
    desc: 'Forged low-speed shaft with rotor flange, connecting the hub to the gearbox planetary stage.',
  },
  gearbox: {
    parent: 'nacelle', name: 'Gearbox', color: 0x3b82f6,
    size: [2.9, 2.9, 2.9], pos: [-0.2, 0.25, 0], explode: [0, 4.5, 0],
    desc: 'Three-stage gearbox (two planetary stages + one helical spur stage) with torque arms to the bedplate, stepping rotor speed up for the generator.',
  },
  coupling: {
    parent: 'nacelle', name: 'Coupling & brake', color: 0xa855f7,
    size: [1.3, 1.6, 1.3], pos: [-1.9, 0.3, 0], explode: [0, 3.0, 0],
    desc: 'Flexible high-speed shaft coupling with slip protection and the mechanical rotor brake disc with hydraulic caliper.',
  },
  generator: {
    parent: 'nacelle', name: 'Generator', color: 0x10b981,
    size: [2.6, 2.5, 2.5], pos: [-3.6, 0.25, 0], explode: [0, 4.0, 0],
    desc: 'Doubly-fed induction generator (DFIG) with air cooling, end shields, top terminal box and rear fan cowl.',
  },
  transformer: {
    parent: 'nacelle', name: 'Transformer', color: 0xf97316,
    size: [1.7, 2.4, 2.1], pos: [-5.3, 0.1, 0], explode: [-3.0, 1.5, 0],
    desc: 'Nacelle-integrated medium-voltage cast-resin transformer at the rear, with side radiator panels and HV bushings.',
  },
  cooling: {
    parent: 'nacelle', name: 'Cooling unit', color: 0x38bdf8,
    size: [2.4, 1.2, 2.6], pos: [-4.9, 2.5, 0], explode: [0, 2.5, 0],
    desc: 'Roof-mounted passive/active cooler package at the nacelle rear for gearbox oil and generator cooling circuits.',
  },
  yaw: {
    parent: 'nacelle', name: 'Yaw system', color: 0xe45f5f,
    size: [2.6, 1.0, 2.6], pos: [2.6, -1.75, 0], explode: [0, -2.5, 0],
    desc: 'Yaw bearing ring gear with multiple electric yaw drives and yaw brakes, orienting the nacelle into the wind.',
  },
  controlCabinet: {
    parent: 'nacelle', name: 'Control cabinets', color: 0x94a3b8,
    size: [1.7, 2.0, 0.8], pos: [-2.6, -0.15, 1.75], explode: [0, 0, 3.0],
    desc: 'Nacelle control cabinets (converter / turbine control) mounted along the nacelle wall.',
  },
  lubeUnit: {
    parent: 'nacelle', name: 'Lubrication & oil unit', color: 0x84cc16,
    size: [1.3, 1.2, 0.9], pos: [0.9, -0.85, -1.6], explode: [0, 0, -3.0],
    desc: 'Gearbox lubrication pump station with oil tank, filters and cooler piping.',
  },
  /* ---------------- hub / pitch system ---------------- */
  pitchBearing: {
    parent: 'hub', name: 'Pitch bearing (3×)', color: 0xd4a017, perBlade: true,
    size: [2.5, 0.55, 2.5], pos: [0.15, 1.2, 0], explode: [0, 2.4, 0],
    desc: 'Four-point-contact blade pitch bearing with internal ring gear at each blade root. Replacing one model updates all three positions.',
  },
  pitchDrive: {
    parent: 'hub', name: 'Pitch drive / motor (3×)', color: 0x2dd4bf, perBlade: true,
    size: [0.7, 1.2, 0.7], pos: [0.45, 0.72, 0.95], explode: [1.6, 1.0, 1.6],
    desc: 'Electric pitch actuator per blade: servo motor with planetary gearbox and pinion engaging the pitch bearing ring gear.',
  },
  pitchBattery: {
    parent: 'hub', name: 'Pitch battery box (3×)', color: 0x818cf8, perBlade: true,
    size: [0.8, 0.9, 0.6], pos: [-0.4, 0.72, -0.95], explode: [-1.6, 1.0, -1.6],
    desc: 'Backup energy storage per blade for fail-safe feathering of the rotor blade on grid loss.',
  },
  hubControl: {
    parent: 'hub', name: 'Hub control cabinet', color: 0xf472b6,
    size: [1.0, 1.1, 1.0], pos: [1.55, 0, 0], explode: [3.0, 0, 0],
    desc: 'Central pitch control cabinet and slip-ring interface inside the spinner nose.',
  },
};

// Structural (non-replaceable) components shown in the tree.
const STRUCTURE = {
  tower:   { name: 'Tower', color: 0xd7dbe0, desc: 'Tubular steel / hybrid tower.' },
  nacelle: { name: 'Nacelle housing', color: 0xbfc7cf, desc: 'Glass-fibre nacelle cover on the cast machine bedplate.' },
  hub:     { name: 'Hub & spinner', color: 0xd7dbe0, desc: 'Cast spherical rotor hub carrying the three pitch systems, enclosed by the aerodynamic spinner. Use "X-ray hub" to look inside.' },
  blades:  { name: 'Rotor blades (3×)', color: 0xe8ecef, desc: 'Glass/carbon hybrid rotor blades with serrated trailing edges.' },
};

const NACELLE_AXES = ['Length (X)', 'Height (Y)', 'Width (Z)'];
const HUB_AXES = ['Axial (X)', 'Radial (Y)', 'Tangential (Z)'];
function axesFor(def) { return def.parent === 'hub' ? HUB_AXES : NACELLE_AXES; }

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
 *  Materials / shared state
 * ================================================================== */

const matSteel = new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.45, metalness: 0.15 });
const matCast = new THREE.MeshStandardMaterial({ color: 0x7b8494, roughness: 0.7, metalness: 0.35 });
const matHousing = new THREE.MeshStandardMaterial({
  color: 0xcfd6dd, roughness: 0.5, metalness: 0.05,
  transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide,
});
const matSpinner = new THREE.MeshStandardMaterial({
  color: 0xd8dee5, roughness: 0.4, metalness: 0.05,
  transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide,
});

let turbine = null;        // root group
let nacelleGroup = null;   // nacelle-local group
let rotorGroup = null;     // spins; hub slots live here
let housingMesh = null;
let spinnerMesh = null;
const shellMeshes = new Set(); // meshes skipped by picking while transparent
const slotRuntime = {};    // id -> { instGroups[], meshes[], envelopeHelpers[], custom, status }
const structureMeshes = {}; // id -> mesh/group for structural parts

/* ================================================================== *
 *  Geometry helpers
 * ================================================================== */

function box(l, h, w, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(l, h, w), mat);
  m.position.set(x, y, z);
  return m;
}
function cylX(r1, r2, len, mat, x = 0, y = 0, z = 0, seg = 24) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, seg), mat);
  m.rotation.z = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}
function cylY(r1, r2, len, mat, x = 0, y = 0, z = 0, seg = 24) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, seg), mat);
  m.position.set(x, y, z);
  return m;
}

function makeBladeGeometry(length) {
  // Loft a blade-ish shape out of a cylinder: chord/thickness/twist vary along span.
  const geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 14, 30, false);
  geo.translate(0, 0.5, 0); // root at y=0, tip at y=1
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const t = THREE.MathUtils.clamp(v.y, 0, 1); // 0 root -> 1 tip
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

// Spinner: smoothly rounded dome with a soft nose, lathed around the
// rotor axis (+x).
function makeSpinnerGeometry() {
  const profile = [
    [-0.7, 2.02], [-0.2, 2.18], [0.4, 2.28], [1.0, 2.24],
    [1.6, 2.05], [2.2, 1.72], [2.7, 1.28], [3.05, 0.78], [3.25, 0.32], [3.32, 0.0],
  ].map(([x, r]) => new THREE.Vector2(Math.max(r, 0.001), x));
  const geo = new THREE.LatheGeometry(profile, 40);
  geo.rotateZ(-Math.PI / 2); // lathe axis +y -> +x
  return geo;
}

/* ================================================================== *
 *  Placeholder (OEM default) sub-components — stylized but recognizable
 * ================================================================== */

function makePlaceholder(id, def) {
  const [L, H, W] = def.size.map(d => d * 0.9);
  const mat = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.5, metalness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3c4454, roughness: 0.6, metalness: 0.4 });
  const g = new THREE.Group();

  switch (id) {
    case 'mainBearing': {
      // pillow-block housing: base plate + split housing dome + shaft bore
      g.add(box(L, H * 0.22, W * 0.95, mat, 0, -H * 0.38, 0));            // base
      g.add(box(L * 0.92, H * 0.5, W * 0.62, mat, 0, -H * 0.05, 0));      // housing body
      const dome = cylX(H * 0.38, H * 0.38, L * 0.9, mat, 0, H * 0.1, 0, 32); // housing cap
      g.add(dome);
      g.add(cylX(H * 0.2, H * 0.2, L * 1.05, dark, 0, H * 0.1, 0));       // shaft bore
      break;
    }
    case 'mainShaft': {
      g.add(cylX(H * 0.3, H * 0.38, L * 0.85, mat, -L * 0.05, 0, 0, 28)); // tapered shaft
      g.add(cylX(H * 0.48, H * 0.48, L * 0.12, mat, L * 0.44, 0, 0, 32)); // rotor flange
      g.add(cylX(H * 0.36, H * 0.36, L * 0.1, mat, -L * 0.45, 0, 0, 28)); // gearbox flange
      break;
    }
    case 'gearbox': {
      g.add(cylX(H * 0.46, H * 0.42, L * 0.4, mat, L * 0.26, 0, 0, 32));  // planetary stage 1
      g.add(cylX(H * 0.38, H * 0.34, L * 0.3, mat, -L * 0.08, 0, 0, 32)); // planetary stage 2
      g.add(box(L * 0.28, H * 0.6, W * 0.5, mat, -L * 0.36, H * 0.04, W * 0.08)); // helical stage
      g.add(box(L * 0.22, H * 0.14, W * 1.0, mat, L * 0.26, -H * 0.12, 0));       // torque arms
      g.add(cylY(0.09, 0.09, H * 0.5, dark, 0, H * 0.42, W * 0.18));      // oil piping
      g.add(cylX(0.09, 0.09, L * 0.7, dark, 0, H * 0.44, -W * 0.12));
      break;
    }
    case 'coupling': {
      g.add(cylX(H * 0.11, H * 0.11, L * 0.95, mat, 0, 0, 0));            // HS shaft
      g.add(cylX(H * 0.2, H * 0.2, L * 0.12, mat, L * 0.3, 0, 0));        // link packs
      g.add(cylX(H * 0.2, H * 0.2, L * 0.12, mat, -L * 0.05, 0, 0));
      g.add(cylX(H * 0.48, H * 0.48, 0.07, dark, -L * 0.34, 0, 0, 36));   // brake disc
      g.add(box(0.28, H * 0.24, W * 0.2, mat, -L * 0.34, H * 0.42, 0));   // brake caliper
      break;
    }
    case 'generator': {
      g.add(cylX(H * 0.42, H * 0.42, L * 0.66, mat, 0, 0, 0, 32));        // stator body
      g.add(cylX(H * 0.33, H * 0.33, L * 0.12, mat, L * 0.4, 0, 0, 28));  // end shields
      g.add(cylX(H * 0.33, H * 0.33, L * 0.12, mat, -L * 0.4, 0, 0, 28));
      for (let i = 0; i < 10; i++) {                                       // cooling fins
        const a = (i / 10) * Math.PI * 2;
        const fin = box(L * 0.62, 0.05, 0.16, mat, 0, 0, 0);
        fin.position.set(0, Math.sin(a) * H * 0.43, Math.cos(a) * H * 0.43);
        fin.rotation.x = -a;
        g.add(fin);
      }
      g.add(box(L * 0.3, H * 0.18, W * 0.34, dark, L * 0.1, H * 0.5, 0)); // terminal box
      g.add(cylX(H * 0.2, H * 0.28, L * 0.14, dark, -L * 0.52, 0, 0));    // fan cowl
      break;
    }
    case 'transformer': {
      g.add(box(L * 0.8, H * 0.82, W * 0.55, mat, 0, -H * 0.04, 0));      // core & coils box
      for (const s of [1, -1]) for (let i = -3; i <= 3; i++)               // radiator fins
        g.add(box(L * 0.7, H * 0.72, 0.05, mat, 0, -H * 0.06, s * W * 0.34 + i * 0.028 * s));
      for (let i = -1; i <= 1; i++)                                        // HV bushings
        g.add(cylY(0.06, 0.09, H * 0.2, dark, i * L * 0.24, H * 0.48, 0));
      break;
    }
    case 'cooling': {
      // rear roof-top cooler: frame with vertical louvre slats
      const frame = new THREE.Group();
      frame.add(box(L, H * 0.1, W, mat, 0, H * 0.45, 0));
      frame.add(box(L, H * 0.1, W, mat, 0, -H * 0.45, 0));
      frame.add(box(L * 0.06, H, W, mat, L * 0.47, 0, 0));
      frame.add(box(L * 0.06, H, W, mat, -L * 0.47, 0, 0));
      for (let i = -4; i <= 4; i++)
        frame.add(box(L * 0.88, H * 0.8, 0.05, mat, 0, 0, i * W * 0.105));
      g.add(frame);
      break;
    }
    case 'yaw': {
      g.add(cylY(W * 0.46, W * 0.46, H * 0.34, mat, 0, -H * 0.2, 0, 40)); // ring gear
      g.add(cylY(W * 0.36, W * 0.36, H * 0.38, dark, 0, -H * 0.19, 0, 40));
      for (let i = 0; i < 6; i++) {                                        // yaw drives
        const a = i * Math.PI / 3 + Math.PI / 6;
        const x = Math.cos(a) * W * 0.38, z = Math.sin(a) * W * 0.38;
        g.add(cylY(0.1, 0.1, H * 0.7, mat, x, H * 0.12, z));
        g.add(cylY(0.14, 0.14, H * 0.25, dark, x, H * 0.42, z));
      }
      break;
    }
    case 'controlCabinet': {
      for (let i = -1; i <= 1; i++)                                        // cabinet row
        g.add(box(L * 0.3, H, W, mat, i * L * 0.32, 0, 0));
      g.add(box(L * 0.96, 0.06, W * 0.9, dark, 0, H * 0.52, 0));          // cable tray
      break;
    }
    case 'lubeUnit': {
      g.add(cylY(W * 0.4, W * 0.4, H * 0.85, mat, -L * 0.24, 0, 0, 24));  // oil tank
      g.add(box(L * 0.4, H * 0.5, W * 0.7, mat, L * 0.26, -H * 0.2, 0));  // pump/filter block
      g.add(cylX(0.05, 0.05, L * 0.6, dark, 0.05, H * 0.32, 0));          // piping
      g.add(cylY(0.05, 0.05, H * 0.5, dark, L * 0.26, H * 0.12, 0));
      break;
    }
    case 'pitchBearing': {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(L * 0.42, H * 0.42, 14, 40), mat);
      ring.rotation.x = Math.PI / 2;                                       // normal = radial (+y)
      g.add(ring);
      const inner = cylY(L * 0.34, L * 0.34, H * 0.8, dark, 0, 0, 0, 40); // inner ring gear
      g.add(inner);
      for (let i = 0; i < 12; i++) {                                       // bolt circle
        const a = (i / 12) * Math.PI * 2;
        g.add(cylY(0.035, 0.035, H * 1.0, dark, Math.cos(a) * L * 0.42, 0, Math.sin(a) * L * 0.42));
      }
      break;
    }
    case 'pitchDrive': {
      g.add(cylY(W * 0.3, W * 0.3, H * 0.5, mat, 0, H * 0.2, 0, 20));     // servo motor
      g.add(cylY(W * 0.36, W * 0.36, H * 0.3, dark, 0, -H * 0.2, 0, 20)); // planetary gearbox
      g.add(cylY(W * 0.16, W * 0.16, H * 0.16, mat, 0, -H * 0.44, 0, 16));// pinion
      g.add(box(W * 0.3, H * 0.16, W * 0.5, dark, 0, H * 0.05, W * 0.3)); // junction box
      break;
    }
    case 'pitchBattery': {
      g.add(box(L, H * 0.72, W, mat, 0, -H * 0.1, 0));                    // battery cabinet
      g.add(box(L * 0.8, H * 0.22, W * 0.8, dark, 0, H * 0.36, 0));       // charger unit
      break;
    }
    case 'hubControl': {
      g.add(box(L * 0.9, H * 0.9, W * 0.9, mat, 0, 0, 0));                // cabinet
      g.add(cylX(H * 0.16, H * 0.16, L * 0.5, dark, L * 0.6, 0, 0));      // slip-ring shaft
      break;
    }
    default:
      g.add(box(L, H, W, mat));
  }
  g.traverse(o => { o.castShadow = true; });
  return g;
}

/* ================================================================== *
 *  Turbine builder
 * ================================================================== */

function slotInstanceTransforms(def) {
  // -> array of { parentGetter, rot, pos } describing each instance frame
  if (def.parent === 'hub') {
    if (def.perBlade) {
      return [0, 1, 2].map(k => ({ inHub: true, rotX: k * 2 * Math.PI / 3, pos: def.pos }));
    }
    return [{ inHub: true, rotX: 0, pos: def.pos }];
  }
  return [{ inHub: false, rotX: 0, pos: def.pos }];
}

function buildTurbine(variantKey) {
  if (turbine) { scene.remove(turbine); disposeTree(turbine); }
  shellMeshes.clear();
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

  // --- nacelle ---
  nacelleGroup = new THREE.Group();
  nacelleGroup.position.y = v.hubHeight;
  turbine.add(nacelleGroup);

  const [NL, NH, NW] = NACELLE_DIMS;
  housingMesh = new THREE.Mesh(new THREE.BoxGeometry(NL, NH, NW, 2, 2, 2), matHousing);
  housingMesh.position.set(-0.8, 0.3, 0);
  nacelleGroup.add(housingMesh);
  structureMeshes.nacelle = housingMesh;
  shellMeshes.add(housingMesh);

  const bedplate = new THREE.Mesh(
    new THREE.BoxGeometry(NL * 0.9, 0.4, NW * 0.8),
    new THREE.MeshStandardMaterial({ color: 0x5b6676, roughness: 0.6, metalness: 0.4 }));
  bedplate.position.set(-0.8, -1.5, 0);
  bedplate.castShadow = true;
  nacelleGroup.add(bedplate);

  // --- rotor: spinner + cast hub + blades (rotates as one) ---
  rotorGroup = new THREE.Group();
  rotorGroup.position.set(HUB_X, 0.15, 0);
  nacelleGroup.add(rotorGroup);

  spinnerMesh = new THREE.Mesh(makeSpinnerGeometry(), matSpinner);
  spinnerMesh.castShadow = true;
  rotorGroup.add(spinnerMesh);
  shellMeshes.add(spinnerMesh);

  const hubCasting = new THREE.Group();               // cast spherical hub
  const hubBall = new THREE.Mesh(new THREE.SphereGeometry(1.35, 28, 20), matCast);
  hubBall.scale.set(1.1, 1, 1);
  hubBall.castShadow = true;
  hubCasting.add(hubBall);
  for (let k = 0; k < 3; k++) {                       // blade root flanges
    const a = k * 2 * Math.PI / 3;
    const fl = cylY(1.05, 1.15, 0.7, matCast, 0, 0, 0, 28);
    fl.position.set(0.15, Math.cos(a) * 1.35, Math.sin(a) * 1.35);
    fl.rotation.x = -a;
    fl.castShadow = true;
    hubCasting.add(fl);
  }
  rotorGroup.add(hubCasting);
  structureMeshes.hub = hubCasting;
  spinnerMesh.userData.structId = 'hub';

  const bladeLen = v.rotor / 2 - 2.3;
  const bladeGeo = makeBladeGeometry(bladeLen);
  const matBlade = new THREE.MeshStandardMaterial({ color: 0xeef1f4, roughness: 0.35 });
  const bladesGroup = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const holder = new THREE.Group();
    holder.rotation.x = i * (2 * Math.PI / 3);
    const blade = new THREE.Mesh(bladeGeo, matBlade);
    blade.castShadow = true;
    blade.position.set(0.15, 2.0, 0);                 // root sits on the pitch bearing
    holder.add(blade);
    bladesGroup.add(holder);
  }
  rotorGroup.add(bladesGroup);
  structureMeshes.blades = bladesGroup;

  // --- sub-component slots (nacelle + hub) ---
  for (const [id, def] of Object.entries(SLOTS)) {
    const prev = slotRuntime[id];
    const rt = { def, instGroups: [], meshes: [], envelopeHelpers: [], custom: prev?.custom ?? null, status: prev?.status ?? 'default' };
    const transforms = slotInstanceTransforms(def);
    transforms.forEach((tr, i) => {
      const frame = new THREE.Group();
      frame.rotation.x = tr.rotX;
      (tr.inHub ? rotorGroup : nacelleGroup).add(frame);

      const inst = new THREE.Group();
      inst.position.fromArray(tr.pos);
      inst.userData.basePos = new THREE.Vector3().fromArray(tr.pos);
      frame.add(inst);

      const mesh = rt.custom ? wrapClone(rt.custom.template, id) : makePlaceholder(id, def);
      mesh.traverse(o => { o.userData.slotId = id; });
      inst.add(mesh);

      const helper = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(...def.size)),
        new THREE.LineBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.9 }));
      helper.visible = false;
      inst.add(helper);

      rt.instGroups.push(inst);
      rt.meshes.push(mesh);
      rt.envelopeHelpers.push(helper);
    });
    slotRuntime[id] = rt;
  }

  for (const [id, obj] of Object.entries(structureMeshes)) {
    obj.traverse(o => { if (!o.userData.slotId) o.userData.structId = id; });
  }

  scene.add(turbine);
  applyExplode(parseFloat(explodeSlider.value));
  applyShellModes();
  setStatus(`Built ${variantKey} — rotor ⌀${v.rotor} m, hub height ${v.hubHeight} m, ${v.rating}.`);
}

function disposeTree(root) {
  root.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
  });
}

/* ================================================================== *
 *  Camera helpers (smooth fly-to)
 * ================================================================== */

const camAnim = { active: false, t: 0, dur: 1, fromPos: new THREE.Vector3(), toPos: new THREE.Vector3(), fromTgt: new THREE.Vector3(), toTgt: new THREE.Vector3() };

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
  rt.instGroups[0].getWorldPosition(target);
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
    .filter(h => h.object.visible &&
      !(shellMeshes.has(h.object) && h.object.material.opacity < 0.9));
  for (const h of hits) {
    const id = h.object.userData.slotId || h.object.userData.structId;
    if (id) { selectComponent(id); return; }
  }
  selectComponent(null);
});

function selectComponent(id) {
  selectedId = id;
  document.querySelectorAll('#componentTree li').forEach(li =>
    li.classList.toggle('selected', li.dataset.id === id));
  Object.values(slotRuntime).forEach(rt => rt.envelopeHelpers.forEach(h => { h.visible = false; }));
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
    rt.envelopeHelpers.forEach(h => { h.visible = true; });
    const labels = axesFor(def);
    envEl.innerHTML = `
      <div class="cap">Installation envelope (max. dimensions)</div>
      <table>
        ${def.size.map((s, i) => `<tr><td>${labels[i]}</td><td>${s.toFixed(2)} m</td></tr>`).join('')}
        <tr><td>Tolerance</td><td>+${(FIT_TOLERANCE * 100).toFixed(0)} %</td></tr>
        ${def.perBlade ? '<tr><td>Installed per blade</td><td>3×</td></tr>' : ''}
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
    const v = VARIANTS[variantSelect.value];
    if (id === 'tower') {
      flyTo(new THREE.Vector3(60, v.hubHeight * 0.5, 60), new THREE.Vector3(0, v.hubHeight * 0.5, 0));
    } else if (id === 'blades') {
      flyTo(new THREE.Vector3(v.rotor * 0.9, v.hubHeight, v.rotor * 0.55), new THREE.Vector3(0, v.hubHeight, 0));
    } else if (id === 'hub') {
      const t = new THREE.Vector3();
      rotorGroup.getWorldPosition(t);
      flyTo(t.clone().add(new THREE.Vector3(14, 4, 12)), t, 1.0);
    } else if (id === 'nacelle') {
      zoomToSlot('gearbox', 26);
    }
  }
}

function fmtDims(d) { return `${d[0].toFixed(2)} × ${d[1].toFixed(2)} × ${d[2].toFixed(2)} m`; }

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
  for (const [id, def] of Object.entries(SLOTS)) if (def.parent === 'nacelle') add(id, def, true);
  add('hub', STRUCTURE.hub);
  for (const [id, def] of Object.entries(SLOTS)) if (def.parent === 'hub') add(id, def, true);
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
  const box3 = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  box3.getSize(size);
  return { box: box3, dims: [size.x, size.y, size.z] };
}

function checkFit(dims, def) {
  const labels = axesFor(def);
  const rows = dims.map((d, i) => {
    const allowed = def.size[i] * (1 + FIT_TOLERANCE);
    return { axis: labels[i], idx: i, actual: d, allowed: def.size[i], over: Math.max(0, d - allowed) };
  });
  return { fits: rows.every(r => r.over <= 0), rows };
}

// clone a template model, centered, tagged for a slot
function wrapClone(template, slotId) {
  const clone = template.clone(true);
  const { box: b } = measure(clone);
  const center = new THREE.Vector3();
  b.getCenter(center);
  clone.position.sub(center);
  const wrapper = new THREE.Group();
  wrapper.add(clone);
  wrapper.traverse(o => { o.userData.slotId = slotId; o.castShadow = true; });
  return wrapper;
}

function installModel(slotId, template, meta) {
  const rt = slotRuntime[slotId];
  rt.instGroups.forEach((inst, i) => {
    inst.remove(rt.meshes[i]);
    disposeTree(rt.meshes[i]);
    const wrapper = wrapClone(template, slotId);
    inst.add(wrapper);
    rt.meshes[i] = wrapper;
  });
  rt.custom = { ...meta, template };
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
    const result = checkFit(dims, def);
    const fileName = generated ? generated : file.name;

    if (result.fits) {
      installModel(slotId, object, { fileName, dims });
      showFitResult(true, slotId, fileName, result);
      setStatus(`${def.name}: "${fileName}" installed${def.perBlade ? ' at all 3 blade positions' : ''} — fit OK.`);
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

  rt.meshes.forEach(m => { m.visible = false; });
  const { box: b } = measure(object);
  const center = new THREE.Vector3();
  b.getCenter(center);
  object.position.sub(center);
  object.traverse(o => {
    if (o.isMesh) o.material = new THREE.MeshStandardMaterial({
      color: 0xef4444, transparent: true, opacity: 0.55, depthWrite: false,
    });
  });
  viz.add(object);

  const envBox = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(...def.size)),
    new THREE.LineBasicMaterial({ color: 0x22c55e }));
  viz.add(envBox);

  const axisVec = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
  for (const row of result.rows) {
    if (row.over <= 0) continue;
    const dir = axisVec[row.idx];
    const half = def.size[row.idx] / 2;
    const overHalf = row.actual / 2;
    for (const sign of [1, -1]) {
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
      const arrow = new THREE.ArrowHelper(
        dir.clone().multiplyScalar(sign),
        dir.clone().multiplyScalar(sign * half),
        Math.max(overHalf - half, 0.4), 0xef4444, 0.35, 0.22);
      viz.add(arrow);
    }
  }

  rt.instGroups[0].add(viz);
  misfitViz = { group: viz, slotId };
}

function clearMisfitViz() {
  if (!misfitViz) return;
  const rt = slotRuntime[misfitViz.slotId];
  rt.instGroups[0].remove(misfitViz.group);
  disposeTree(misfitViz.group);
  rt.meshes.forEach(m => { m.visible = true; });
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
      ? ` — all dimensions are within the installation envelope. The component has been installed${def.perBlade ? ' at all three blade positions' : ''}.`
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
    rt.instGroups.forEach(inst => {
      inst.position.copy(inst.userData.basePos)
        .add(new THREE.Vector3().fromArray(def.explode).multiplyScalar(t));
    });
  }
  if (rotorGroup) rotorGroup.position.x = HUB_X + t * 10;
}

document.getElementById('housingToggle').addEventListener('change', applyShellModes);
document.getElementById('hubXrayToggle').addEventListener('change', applyShellModes);
function applyShellModes() {
  const nx = document.getElementById('housingToggle').checked;
  matHousing.opacity = nx ? 0.22 : 1.0;
  matHousing.transparent = nx;
  matHousing.depthWrite = !nx;
  matHousing.needsUpdate = true;
  const hx = document.getElementById('hubXrayToggle').checked;
  matSpinner.opacity = hx ? 0.25 : 1.0;
  matSpinner.transparent = hx;
  matSpinner.depthWrite = !hx;
  matSpinner.needsUpdate = true;
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
  rt.instGroups.forEach((inst, i) => {
    inst.remove(rt.meshes[i]);
    disposeTree(rt.meshes[i]);
    const mesh = makePlaceholder(id, SLOTS[id]);
    mesh.traverse(o => { o.userData.slotId = id; });
    inst.add(mesh);
    rt.meshes[i] = mesh;
  });
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
