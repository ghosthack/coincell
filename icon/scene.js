// A 3D lithium coin cell standing on its edge, rendered square on a transparent background.
// Units: the cell is 3.2 across; the scene's floor is y = 0.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

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
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.8;

// --- proportions: chubbier than a real CR2032 so it reads at 16 px -----------------
const R = 1.6, H = 0.34, BEVEL = 0.13;      // radius, half thickness, rounded shoulder
const arc = (cx, cy, r, a0, a1, n = 24) => Array.from({ length: n + 1 }, (_, i) => {
  const a = a0 + ((a1 - a0) * i) / n;
  return new THREE.Vector2(cx + r * Math.cos(a), cy + r * Math.sin(a));
});

// Turned-metal look: fine concentric rings in the roughness, which on a lathe is just
// stripes along v.
function ringTexture(strength) {
  const c = document.createElement('canvas'); c.width = 4; c.height = 1024;
  const g = c.getContext('2d');
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < c.height; y++) { const v = Math.round(255 * (0.62 + (rnd() - 0.5) * strength)); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(0, y, 4, 1); }
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}
const steel = (color, roughness, strength) => new THREE.MeshPhysicalMaterial({
  color, metalness: 1, roughness, roughnessMap: ringTexture(strength), clearcoat: 0.25, clearcoatRoughness: 0.35,
});

const cell = new THREE.Group();

// Positive can: the flat face you read, the rounded shoulder and the side wall.
const can = new THREE.Mesh(new THREE.LatheGeometry([
  new THREE.Vector2(0, H),
  new THREE.Vector2(R - BEVEL, H),
  ...arc(R - BEVEL, H - BEVEL, BEVEL, Math.PI / 2, 0).slice(1),
  new THREE.Vector2(R, -H + 0.16),
  new THREE.Vector2(R - 0.035, -H + 0.11),
  new THREE.Vector2(R - 0.07, -H + 0.11),
].reverse(), 192), steel('#E3E5EA', 0.3, 0.16)); // a lathe wants its profile bottom to top

// The crimp: a dark plastic gasket between the can and the negative cap.
const gasket = new THREE.Mesh(new THREE.LatheGeometry([
  new THREE.Vector2(R - 0.07, -H + 0.12),
  new THREE.Vector2(R - 0.12, -H + 0.055),
  new THREE.Vector2(R - 0.21, -H + 0.055),
  new THREE.Vector2(R - 0.26, -H + 0.12),
], 192), new THREE.MeshStandardMaterial({ color: '#23262D', roughness: 0.7, metalness: 0, side: THREE.DoubleSide }));

// Negative cap: a slightly smaller, duller disc on the back.
const cap = new THREE.Mesh(new THREE.LatheGeometry([
  new THREE.Vector2(R - 0.26, -H + 0.12),
  ...arc(R - 0.36, -H + 0.1, 0.1, 0, -Math.PI / 2).slice(1),
  new THREE.Vector2(0, -H),
].reverse(), 192), steel('#C9CCD3', 0.4, 0.22));

// Laser etching on the positive face: a big plus, the name and the voltage.
function etching() {
  const c = document.createElement('canvas'); c.width = c.height = 2048;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 2048, 2048);
  g.fillStyle = g.strokeStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineCap = 'round';
  g.lineWidth = 92; g.beginPath(); g.moveTo(1024 - 250, 640); g.lineTo(1024 + 250, 640); g.moveTo(1024, 390); g.lineTo(1024, 890); g.stroke();
  g.font = '700 236px "Helvetica Neue", Helvetica, Arial, sans-serif';
  g.fillText('coincell', 1024, 1210);
  g.font = '600 150px "Helvetica Neue", Helvetica, Arial, sans-serif';
  g.fillText('3V', 1024, 1480);
  g.lineWidth = 16; g.beginPath(); g.arc(1024, 1024, 905, 0, Math.PI * 2); g.stroke();
  const t = new THREE.CanvasTexture(c); t.anisotropy = 16; return t;
}
const mark = new THREE.Mesh(new THREE.CircleGeometry(R - BEVEL, 128), new THREE.MeshStandardMaterial({
  color: '#4A4E58', roughness: 0.85, metalness: 0.2, alphaMap: etching(), transparent: true, polygonOffset: true, polygonOffsetFactor: -4,
}));
mark.rotation.x = -Math.PI / 2;   // lie on the face, text "up" pointing away from the viewer
mark.position.y = H + 0.002;

for (const m of [can, gasket, cap]) { m.castShadow = true; cell.add(m); }
cell.add(mark);

// Stand it on its edge, leaning back, turned a little so the rim and the crimp show.
const TILT = THREE.MathUtils.degToRad(window.TILT ?? 66);
cell.rotation.x = TILT;
const holder = new THREE.Group();
holder.add(cell);
holder.position.y = R * Math.sin(TILT) + H * Math.cos(TILT);
holder.rotation.y = THREE.MathUtils.degToRad(window.YAW ?? -30);
scene.add(holder);

// --- floor that only shows the shadow ------------------------------------------------
const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.ShadowMaterial({ opacity: 0.26 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// --- lights ----------------------------------------------------------------------------
const key = new THREE.DirectionalLight('#fff4e6', 2.6);
key.position.set(-3, 7, 4.5);
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

renderer.render(scene, camera);
window.RENDERED = true;
