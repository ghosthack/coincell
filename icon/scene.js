// A 3D lithium coin cell standing on its edge, rendered square on a transparent background.
// Units: the cell is 3.2 across; the scene's floor is y = 0.
import * as THREE from 'three';

const SIZE = window.ICON_SIZE || 1024;
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(SIZE, SIZE);
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();

// --- what the metal reflects: a dark studio with a few bright light panels ---------------
// Polished metal looks shiny only when it mirrors strong contrast. So instead of an evenly
// lit room, this is a photographer's setup: softboxes and strip lights against near-black,
// which gives a bright clean face and crisp highlights and dark bands around the edge.
function studio(forStamping) {
  const room = new THREE.Scene();
  room.background = new THREE.Color(0.035, 0.037, 0.042);
  const panel = (w, h, at, brightness, tint = [1, 1, 1]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    m.material.color.setRGB(tint[0] * brightness, tint[1] * brightness, tint[2] * brightness);
    m.position.set(...at); m.lookAt(0, 0.8, 0); room.add(m);
  };
  if (!forStamping) {
    // The look of the metal: what the shell, the rim and the cap's sides mirror.
    panel(10, 7, [-9.5, 6.2, 4.6], 5.5, [1, 0.98, 0.95]);   // big softbox, up and to the left: the bright flat surfaces
    panel(5, 7, [-11, 2.2, -2.4], 1.6);                      // its dimmer neighbour
    panel(14, 14, [0, 13, 0], 1.1);                          // soft overhead fill
    panel(30, 30, [0, -6, 0], 0.5, [1, 0.99, 0.97]);         // the table, bouncing light onto the underside
  } else {
    // The stamped face gets its own version of the room. Flat metal mirrors the same softbox,
    // so it looks identical. But a wall that tips upward (the lower side of a dent) now mirrors
    // light, and a wall that tips downward (the upper side) mirrors dark: light below, shadow
    // above, which is what makes a dent read as a dent and not as a bump.
    panel(10, 10, [-9.5, 8.6, 4.6], 5.5, [1, 0.98, 0.95]);
    panel(5, 5, [-11, 1.2, -2.4], 0.35);
    panel(14, 14, [0, 13, 0], 3.6);
    panel(30, 30, [0, -6, 0], 0.16, [1, 0.99, 0.97]);
  }
  panel(1.4, 12, [8.5, 4.5, 3.5], 9);                      // tall strip on the right: the streak down the rounded edge
  panel(1.0, 10, [3.5, 7, -9], 7, [0.9, 0.95, 1]);         // cool strip behind: a rim highlight on the far side
  return room;
}
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(studio(false), 0.01).texture;
const stampingRoom = pmrem.fromScene(studio(true), 0.01).texture;
scene.environmentIntensity = window.ENV ?? 1.0;

// --- proportions: chubbier than a real CR2032 so it reads at 16 px -----------------
const R = 1.6, H = 0.36;                     // radius, half thickness
const RIM_Y = 0.3, RIM = 0.2;               // top of the outer shell's rim, and its corner radius
const LAND_IN = R - 0.31;                    // inner edge of the rim's flat land, where the gasket starts
const CAP_R = LAND_IN - 0.105, CAP_BEVEL = 0.07;   // 0.105 is the width of the dark gap     // the inner cap that stands proud of the rim
const FACE = CAP_R - CAP_BEVEL;              // the flat, stamped part of the cap
const arc = (cx, cy, r, a0, a1, n = 24) => Array.from({ length: n + 1 }, (_, i) => {
  const a = a0 + ((a1 - a0) * i) / n;
  return new THREE.Vector2(cx + r * Math.cos(a), cy + r * Math.sin(a));
});

// Turned-metal look: fine concentric rings in the roughness, which on a lathe is just
// stripes along v.
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
function ringTexture(strength) {
  const c = document.createElement('canvas'); c.width = 4; c.height = 1024;
  const g = c.getContext('2d');
  for (let y = 0; y < c.height; y++) { const v = Math.round(255 * (0.62 + (rnd() - 0.5) * strength)); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(0, y, 4, 1); }
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}
const steel = (color, roughness, strength) => new THREE.MeshPhysicalMaterial({
  color, metalness: 1, roughness, roughnessMap: ringTexture(strength),
});

const cell = new THREE.Group();

// Every profile below runs from the axis at the bottom, outward, up, and back in at the
// top: that is the direction a lathe needs for its surface to face outward.

// Outer shell: a plain metal back, the side wall, and a rim that turns in flat on the front.
const can = new THREE.Mesh(new THREE.LatheGeometry([
  new THREE.Vector2(0, -H),
  new THREE.Vector2(R - 0.12, -H),
  ...arc(R - 0.12, -H + 0.12, 0.12, -Math.PI / 2, 0).slice(1),
  ...arc(R - RIM, RIM_Y - RIM, RIM, 0, Math.PI / 2).slice(1),   // a tight rounded outer corner, nothing more
], 192), steel('#EAE8E4', 0.11, 0.2));    // bright nickel plating: a faintly warm mirror with fine turning marks

// The rim's flat land: a level ring from that corner in to the gasket, parallel to the cap's
// face and finished like it, so it reads as flat.
const flatMetal = { color: '#EFEDEA', metalness: 1, roughness: 0.07 };
const land = new THREE.Mesh(new THREE.RingGeometry(LAND_IN, R - RIM, 192), new THREE.MeshPhysicalMaterial(flatMetal));
land.rotation.x = -Math.PI / 2;
land.position.y = RIM_Y;

// The only dark part: the plastic gasket in the gap where the outer shell wraps the cap.
const gasket = new THREE.Mesh(new THREE.LatheGeometry([
  new THREE.Vector2(LAND_IN + 0.002, RIM_Y - 0.1),
  new THREE.Vector2(LAND_IN, RIM_Y - 0.006),     // a flat band, level with the land beside it
  new THREE.Vector2(CAP_R, RIM_Y - 0.006),
  new THREE.Vector2(CAP_R - 0.004, RIM_Y - 0.1),
], 192), new THREE.MeshStandardMaterial({ color: '#2C2F36', roughness: 0.55, metalness: 0, side: THREE.DoubleSide }));

// Inner cap: rises out of the gasket and stands a little above the rim.
// (Its flat face is a separate disc below, so the stamping can be mapped onto it.)
const cap = new THREE.Mesh(new THREE.LatheGeometry([
  new THREE.Vector2(CAP_R, RIM_Y - 0.14),
  ...arc(FACE, H - CAP_BEVEL, CAP_BEVEL, 0, Math.PI / 2),
], 192), steel('#EFEDEA', 0.11, 0.16));

// The cap's face, with the plus, the name and the voltage pressed into it. The dent is shape
// only: the same metal carries on inside it, so it shows by the light catching its walls.
function plus(g, px) {        // spans three eighths of the face
  const c = px / 2, arm = px * 0.1875, cy = px * 0.35;
  g.lineCap = 'round'; g.lineWidth = px * 0.07; g.beginPath();
  g.moveTo(c - arm, cy); g.lineTo(c + arm, cy);
  g.moveTo(c, cy - arm); g.lineTo(c, cy + arm); g.stroke();
}
function lettering(g, px) {
  const c = px / 2;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `700 ${px * 0.115}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
  g.fillText('coincell', c, px * 0.7);
  g.font = `600 ${px * 0.072}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
  g.fillText('3V', c, px * 0.815);
}

// Height of the face: white = surface, darker = lower. The plus is a wide, deep, scooped
// groove (a big blur makes its walls curve down gradually). The lettering has thin strokes,
// so it gets a shallower, tighter dent that keeps the letters readable.
function heightMap() {
  const px = 2048, c = document.createElement('canvas'); c.width = c.height = px;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff'; g.fillRect(0, 0, px, px);
  g.filter = 'blur(20px)'; g.fillStyle = g.strokeStyle = '#000'; plus(g, px);
  g.filter = 'blur(5px)'; g.fillStyle = g.strokeStyle = '#9a9a9a'; lettering(g, px);
  // The canvas only holds 256 levels, and a mirror shows every one of those steps as grain.
  // Smooth them away in floating point and hand the renderer a high-precision texture.
  const bytes = g.getImageData(0, 0, px, px).data;
  let h = new Float32Array(px * px), tmp = new Float32Array(px * px);
  for (let i = 0; i < h.length; i++) h[i] = bytes[i * 4] / 255;
  const R = 3;
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) { let a = 0; for (let k = -R; k <= R; k++) a += h[y * px + Math.min(px - 1, Math.max(0, x + k))]; tmp[y * px + x] = a / (2 * R + 1); }
    for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) { let a = 0; for (let k = -R; k <= R; k++) a += tmp[Math.min(px - 1, Math.max(0, y + k)) * px + x]; h[y * px + x] = a / (2 * R + 1); }
  }
  const half = new Uint16Array(px * px);
  for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) half[(px - 1 - y) * px + x] = THREE.DataUtils.toHalfFloat(h[y * px + x]);   // data textures are bottom-up
  const t = new THREE.DataTexture(half, px, px, THREE.RedFormat, THREE.HalfFloatType);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 16; t.needsUpdate = true;
  return t;
}
// Roughness: the fine turned rings, running straight through the dents.
function ringMap() {
  const px = 2048, c = document.createElement('canvas'); c.width = c.height = px;
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(61,61,61)'; g.fillRect(0, 0, px, px);
  for (let r = 2; r < px * 0.72; r += 2) { const v = Math.round(255 * (0.24 + (rnd() - 0.5) * 0.1)); g.strokeStyle = `rgb(${v},${v},${v})`; g.lineWidth = 2.4; g.beginPath(); g.arc(px / 2, px / 2, r, 0, Math.PI * 2); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.anisotropy = 16; return t;
}
const face = new THREE.Mesh(new THREE.CircleGeometry(FACE, 192), new THREE.MeshPhysicalMaterial({
  color: '#EFEDEA', metalness: 1, roughness: 0.3,   // the map below takes this down to about 0.07 on the polished surface
  roughnessMap: ringMap(), bumpMap: heightMap(), bumpScale: window.BUMP ?? 42, envMap: stampingRoom,
}));
face.rotation.x = -Math.PI / 2;   // lie flat on top, the drawing's "up" pointing away from the viewer
face.position.y = H;
face.receiveShadow = true;

for (const m of [can, gasket, cap]) { m.castShadow = true; cell.add(m); }
cell.add(face, land);

// Stand it on its edge, leaning back, turned a little so the rim and the crimp show.
const TILT = THREE.MathUtils.degToRad(window.TILT ?? 62);
cell.rotation.x = TILT;
const holder = new THREE.Group();
holder.add(cell);
holder.position.y = R * Math.sin(TILT) + H * Math.cos(TILT);
holder.rotation.y = THREE.MathUtils.degToRad(window.YAW ?? -34);
scene.add(holder);

// --- floor that only shows the shadow (see the two-layer render at the end) -----------
const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.ShadowMaterial({ opacity: 0.26 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// --- lights ----------------------------------------------------------------------------
const key = new THREE.DirectionalLight('#fff4e6', 2.6);
key.position.set(-1.3, 8, 3.6);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.radius = 10;
key.shadow.blurSamples = 24;
Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 20 });
scene.add(key);
const rim = new THREE.DirectionalLight('#cfe0ff', 0.9);
rim.position.set(4, 2.5, -4);
scene.add(rim);

// --- camera: in front and a little above ------------------------------------------------
const camera = new THREE.PerspectiveCamera(window.FOV ?? 30, 1, 0.1, 100);
camera.position.set(0, window.CAM_Y ?? 4.6, window.CAM_Z ?? 9.6);
camera.lookAt(0, 1.35, 0);

// --- render in two layers -----------------------------------------------------------------
// 1. The cell on its own, at full size.
floor.visible = false;
renderer.render(scene, camera);
const out = document.createElement('canvas'); out.width = out.height = SIZE;
const g2 = out.getContext('2d');
const cellLayer = document.createElement('canvas'); cellLayer.width = cellLayer.height = SIZE;
cellLayer.getContext('2d').drawImage(renderer.domElement, 0, 0);

// 2. The shadow, as a real soft shadow: the key light is treated as a wide lamp and sampled
//    from many points across it. Where the cell touches the floor every sample agrees, so the
//    shadow is dark and crisp; further out fewer samples are blocked, so it fades away.
floor.visible = true;
floor.material.opacity = 1;                              // record pure coverage, tint it afterwards
for (const m of [can, gasket, cap, face, land]) { m.material.colorWrite = false; m.material.depthWrite = false; }
const S = Math.round(SIZE / 2), SAMPLES = window.SHADOW_SAMPLES ?? 96, LAMP = window.LAMP ?? 2.1, DARKNESS = 0.5;
renderer.setSize(S, S);
const gl = renderer.getContext(), px = new Uint8Array(S * S * 4), sum = new Float32Array(S * S);
const home = key.position.clone(), toLight = home.clone().normalize();
const side = new THREE.Vector3().crossVectors(toLight, new THREE.Vector3(0, 1, 0)).normalize();
const up = new THREE.Vector3().crossVectors(side, toLight).normalize();
key.shadow.bias = -0.0006;
for (let i = 0; i < SAMPLES; i++) {
  const r = LAMP * Math.sqrt((i + 0.5) / SAMPLES), a = i * 2.39996323;   // an even spiral over the lamp's disc
  key.position.copy(home).addScaledVector(side, r * Math.cos(a)).addScaledVector(up, r * Math.sin(a));
  renderer.render(scene, camera);
  gl.readPixels(0, 0, S, S, gl.RGBA, gl.UNSIGNED_BYTE, px);
  for (let j = 0; j < sum.length; j++) sum[j] += px[j * 4 + 3];
}
const shadow = new ImageData(S, S);
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  shadow.data[(y * S + x) * 4 + 3] = Math.round((sum[(S - 1 - y) * S + x] / SAMPLES) * DARKNESS);   // readPixels is bottom-up
}
const shadowLayer = document.createElement('canvas'); shadowLayer.width = shadowLayer.height = S;
shadowLayer.getContext('2d').putImageData(shadow, 0, 0);

g2.imageSmoothingQuality = 'high';
g2.drawImage(shadowLayer, 0, 0, SIZE, SIZE);
g2.drawImage(cellLayer, 0, 0);
renderer.domElement.remove();
document.body.appendChild(out);
window.RENDERED = true;
