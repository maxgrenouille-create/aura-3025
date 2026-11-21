// AURA · scena 3D in rilievo ricavata dal ritratto originale.
// Il ritratto viene "steso" su una superficie modellata (mappa di profondità),
// con testa mobile, respiro, luce dinamica, occhi luminosi e due inquadrature.
import * as THREE from './vendor/three.module.min.js';

const IMG_W = 1312, IMG_H = 1199;
const DEPTH_W = 328, DEPTH_H = 300;
const S = 2 / IMG_W;                 // pixel del ritratto → unità 3D
const PIVOT = {x: 657, y: 560, z: 100}; // perno della testa (base del collo)
const MOUTH = {x: 544, y: 390, w: 230, h: 155};
const EYES = [[583, 286], [738, 286]];

// Inquadrature: centro (in pixel del ritratto), area da mostrare, angolazione.
const SHOTS = {
  wide:  {label: 'Mezzo busto', cx: 657, cy: 500, vspan: 1150, hspan: 1040, yaw: 0, pitch: 2, fov: 28},
  close: {label: 'Primo piano', cx: 660, cy: 300, vspan: 660, hspan: 610, yaw: -11, pitch: -3, fov: 24},
};

const stage = document.querySelector('.stage');
const portrait = document.querySelector('.portrait');

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

const toWorld = (px, py, d) => new THREE.Vector3((px - IMG_W / 2) * S, (IMG_H / 2 - py) * S, d * S);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const headWeight = (px, py) => (1 - smooth(470, 610, py)) * (1 - smooth(230, 300, Math.abs(px - PIVOT.x)));

async function loadDepth() {
  const {default: b64} = await import('./assets/3d/depth.js');
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const raw = new Uint16Array(bytes.buffer);
  return (px, py) => {
    const x = Math.min(DEPTH_W - 1.001, Math.max(0, px / IMG_W * DEPTH_W - .5));
    const y = Math.min(DEPTH_H - 1.001, Math.max(0, py / IMG_H * DEPTH_H - .5));
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const at = (i, j) => raw[j * DEPTH_W + i] / 100 - 60;
    return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy)
         + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
  };
}

// Griglia in rilievo su un rettangolo del ritratto.
function reliefGeometry(depthAt, rect, nx, ny, lift = 0) {
  const pos = [], uv = [], head = [], index = [];
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const px = rect.x + rect.w * i / nx, py = rect.y + rect.h * j / ny;
      const p = toWorld(px, py, depthAt(px, py) + lift);
      pos.push(p.x, p.y, p.z);
      uv.push(i / nx, 1 - j / ny);
      head.push(headWeight(px, py));
    }
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aHead', new THREE.Float32BufferAttribute(head, 1));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

const vertexShader = /* glsl */`
  attribute float aHead;
  uniform mat4 uHead;
  uniform float uBreath;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorld;
  void main() {
    vec4 p = vec4(position, 1.0);
    vec3 n = normal;
    // respiro: il busto si solleva appena
    float body = 1.0 - aHead;
    p.y += uBreath * body * (0.6 + 0.4 * clamp((p.y + 0.9) / 1.2, 0.0, 1.0));
    p.z += uBreath * body * 0.6;
    // la testa ruota attorno al perno del collo
    vec4 ph = uHead * p;
    p = mix(p, ph, aHead);
    n = normalize(mix(n, mat3(uHead) * n, aHead));
    vec4 world = modelMatrix * p;
    vWorld = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * n);
    vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const fragmentShader = /* glsl */`
  uniform sampler2D uMap;
  uniform sampler2D uMask;
  uniform float uUseMask;
  uniform vec3 uLight;
  uniform float uLightAmt;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorld;
  void main() {
    vec4 tex = texture2D(uMap, vUv);
    float alpha = uUseMask > 0.5 ? texture2D(uMask, vUv).r : tex.a;
    if (uUseMask < 0.5) alpha *= smoothstep(0.0, 0.06, vUv.x) * smoothstep(1.0, 0.94, vUv.x) * smoothstep(0.0, 0.06, vUv.y) * smoothstep(1.0, 0.94, vUv.y);
    if (alpha < 0.02) discard;
    vec3 col = uUseMask > 0.5 ? tex.rgb : tex.rgb / max(tex.a, 0.0001); // bocca: colori premoltiplicati
    // stessa resa del ritratto originale: meno saturo, un filo più contrastato
    float luma = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(luma), col, 0.75);
    col = (col - 0.5) * 1.07 + 0.5;
    // luce dinamica leggera: dà volume quando la camera si muove
    vec3 N = normalize(vNormal);
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 L = normalize(uLight - vWorld);
    vec3 H = normalize(L + V);
    float diff = clamp(dot(N, L), 0.0, 1.0);
    float spec = pow(clamp(dot(N, H), 0.0, 1.0), 48.0);
    float shiny = smoothstep(0.35, 0.85, luma);
    col *= mix(1.0, 0.82 + 0.3 * diff, uLightAmt);
    col += spec * shiny * 0.22 * uLightAmt;
    // rim light freddo sul contorno
    float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
    col += vec3(0.55, 0.78, 0.82) * rim * 0.10 * uLightAmt;
    gl_FragColor = vec4(col, alpha);
  }`;

function eyeGlowMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {uLevel: {value: .3}},
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform float uLevel; varying vec2 vUv;
      void main(){ float d = length(vUv - 0.5) * 2.0;
        float core = smoothstep(0.32, 0.0, d), halo = smoothstep(1.0, 0.0, d);
        vec3 c = vec3(1.0, 0.16, 0.08) * (core * 0.9 + halo * halo * 0.5) * uLevel;
        gl_FragColor = vec4(c, 1.0); }`,
  });
}

async function start() {
  if (!webglAvailable()) return;
  const depthAt = await loadDepth();
  const loader = new THREE.TextureLoader();
  const [colorTex, maskTex, bgTex] = await Promise.all(
    ['assets/3d/color.jpg', 'assets/3d/mask_soft.png', 'assets/3d/bg.jpg'].map(u => loader.loadAsync(u)));
  bgTex.colorSpace = THREE.SRGBColorSpace;
  colorTex.anisotropy = 4;

  const renderer = new THREE.WebGLRenderer({antialias: true, alpha: false, powerPreference: 'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setClearColor(0x1d2228);
  renderer.domElement.className = 'aura-3d';
  renderer.domElement.setAttribute('aria-hidden', 'true');
  stage.insertBefore(renderer.domElement, stage.querySelector('.stage-vignette'));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, .05, 50);

  const shared = {
    uHead: {value: new THREE.Matrix4()},
    uBreath: {value: 0},
    uLight: {value: new THREE.Vector3(-1.4, 1.6, 3)},
    uLightAmt: {value: 1},
  };
  const figureMat = new THREE.ShaderMaterial({
    uniforms: {...shared, uMap: {value: colorTex}, uMask: {value: maskTex}, uUseMask: {value: 1}},
    vertexShader, fragmentShader, transparent: true,
  });
  const figure = new THREE.Mesh(reliefGeometry(depthAt, {x: 0, y: 0, w: IMG_W, h: IMG_H}, 260, 238), figureMat);
  scene.add(figure);

  // Bocca: piccola superficie sopra le labbra che riceve il disegno animato di avatar.js
  const mouthTex = new THREE.CanvasTexture(auraAvatar.canvas);
  mouthTex.premultiplyAlpha = true;
  mouthTex.generateMipmaps = false;
  mouthTex.minFilter = THREE.LinearFilter;
  const mouthMat = new THREE.ShaderMaterial({
    uniforms: {...shared, uMap: {value: mouthTex}, uMask: {value: maskTex}, uUseMask: {value: 0}},
    vertexShader, fragmentShader, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const mouth = new THREE.Mesh(reliefGeometry(depthAt, MOUTH, 46, 31, .6), mouthMat);
  mouth.renderOrder = 2;
  scene.add(mouth);

  // Sfondo ricostruito, più indietro: dà parallasse reale
  const bgPlane = new THREE.Mesh(new THREE.PlaneGeometry(IMG_W * S * 2.2, IMG_H * S * 2.2),
    new THREE.MeshBasicMaterial({map: bgTex}));
  bgPlane.position.z = -260 * S;
  scene.add(bgPlane);

  // Occhi rossi luminosi, solidali con la testa
  const eyeGroup = new THREE.Group();
  eyeGroup.matrixAutoUpdate = false;
  const glowMat = eyeGlowMaterial();
  for (const [x, y] of EYES) {
    const e = new THREE.Mesh(new THREE.PlaneGeometry(52 * S, 52 * S), glowMat);
    e.position.copy(toWorld(x, y, depthAt(x, y) + 4));
    e.renderOrder = 3;
    eyeGroup.add(e);
  }
  scene.add(eyeGroup);

  stage.classList.add('has-3d');

  // ---------- regia ----------
  const shotButton = document.createElement('button');
  shotButton.type = 'button';
  shotButton.className = 'shot-btn';
  stage.append(shotButton);

  let shot = 'wide';
  let manualUntil = 0;
  let speaking = false, listening = false;
  let speakTimer = 0, lastCut = 0;
  const cam = {from: null, to: null, t: 1, dur: 1};

  function shotPose(name, time) {
    const s = SHOTS[name];
    const aspect = camera.aspect;
    const vfov = THREE.MathUtils.degToRad(s.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const fit = Math.max(s.vspan * S / 2 / Math.tan(vfov / 2), s.hspan * S / 2 / Math.tan(hfov / 2));
    // su schermi larghi non mostrare oltre i bordi del ritratto
    const dist = Math.min(fit, 1180 * S / 2 / Math.tan(hfov / 2));
    // lieve carrellata continua dentro ogni inquadratura
    const drift = Math.sin(time * .11) * 1.6;
    const yaw = THREE.MathUtils.degToRad(s.yaw + drift), pitch = THREE.MathUtils.degToRad(s.pitch + Math.sin(time * .07) * .8);
    // se lo schermo è largo e la camera si avvicina, alza il centro per non tagliare la testa
    const visibleV = 2 * dist * Math.tan(vfov / 2) / S;
    const cy = Math.min(s.cy, Math.max(s.cy - 400, visibleV / 2 - 90));
    const target = toWorld(s.cx, cy, name === 'close' ? 250 : 170);
    const pos = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
      .multiplyScalar(dist * (1 - Math.sin(time * .09) * .015)).add(target);
    return {pos, target, fov: s.fov};
  }

  function setShot(name, {cut = false, manual = false} = {}) {
    if (manual) manualUntil = performance.now() + 20000;
    if (name === shot && cam.t >= 1) return;
    shot = name;
    lastCut = performance.now();
    cam.t = cut ? 1 : 0;
    cam.dur = name === 'close' ? 1.4 : 1.8;
    cam.from = {pos: camera.position.clone(), target: currentTarget.clone(), fov: camera.fov};
    shotButton.textContent = name === 'wide' ? 'Primo piano' : 'Mezzo busto';
    shotButton.setAttribute('aria-label', 'Passa a ' + shotButton.textContent.toLowerCase());
  }
  shotButton.onclick = () => setShot(shot === 'wide' ? 'close' : 'wide', {manual: true});
  shotButton.textContent = 'Primo piano';

  // Agganci alla voce: quando AURA parla, la regia va in primo piano
  const originalSpeak = auraAvatar.speak, originalStop = auraAvatar.stop;
  auraAvatar.speak = (...args) => {
    originalSpeak(...args);
    speaking = true;
    clearTimeout(speakTimer);
    if (performance.now() > manualUntil) setShot('close', {cut: true});
  };
  const originalLive = auraAvatar.speakLive;
  auraAvatar.speakLive = (...args) => {
    originalLive(...args);
    speaking = true;
    clearTimeout(speakTimer);
    if (performance.now() > manualUntil) setShot('close', {cut: true});
  };
  auraAvatar.stop = (...args) => {
    originalStop(...args);
    if (!speaking) return;
    speaking = false;
    clearTimeout(speakTimer);
    speakTimer = setTimeout(() => { if (!speaking && performance.now() > manualUntil) setShot('wide'); }, 1400);
  };
  // stato "ti sto ascoltando": AURA inclina la testa
  new MutationObserver(() => {
    listening = document.getElementById('stageStatus').textContent.includes('ASCOLTANDO');
  }).observe(document.getElementById('stageStatus'), {childList: true, characterData: true, subtree: true});

  // parallasse col dito o col mouse
  const pointer = {x: 0, y: 0, tx: 0, ty: 0};
  stage.addEventListener('pointermove', e => {
    const r = stage.getBoundingClientRect();
    pointer.tx = ((e.clientX - r.left) / r.width - .5) * 2;
    pointer.ty = ((e.clientY - r.top) / r.height - .5) * 2;
  });
  stage.addEventListener('pointerleave', () => { pointer.tx = pointer.ty = 0; });

  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  const currentTarget = new THREE.Vector3();
  {
    const p = shotPose('wide', 0);
    camera.position.copy(p.pos); currentTarget.copy(p.target); camera.fov = p.fov;
  }
  setShot('wide', {cut: true});

  const pivot = toWorld(PIVOT.x, PIVOT.y, PIVOT.z);
  const toPivot = new THREE.Matrix4(), fromPivot = new THREE.Matrix4(), rot = new THREE.Matrix4();
  const euler = new THREE.Euler();
  let level = 0, nod = 0, tilt = 0, last = performance.now();
  const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  function frame(now) {
    requestAnimationFrame(frame);
    if (document.hidden) return;
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    const t = now / 1000;

    // durante risposte lunghe, la regia alterna le inquadrature
    if (speaking && now > manualUntil && now - lastCut > 6500) setShot(shot === 'close' ? 'wide' : 'close');

    const raw = auraAvatar.level ? auraAvatar.level() : 0;
    level += (raw - level) * Math.min(1, dt * 12);

    // testa: piccoli movimenti vivi, cenni mentre parla, inclinazione mentre ascolta
    nod += ((speaking ? level * 1.6 : 0) - nod) * Math.min(1, dt * 6);
    tilt += ((listening ? 4 : 0) - tilt) * Math.min(1, dt * 3);
    const yaw = Math.sin(t * .37) * 2.2 + Math.sin(t * .83) * .6 + pointer.x * 3;
    const pitch = Math.sin(t * .29 + 1) * 1.2 - nod + pointer.y * 1.5;
    const roll = Math.sin(t * .23) * .6 + tilt;
    euler.set(THREE.MathUtils.degToRad(pitch), THREE.MathUtils.degToRad(yaw), THREE.MathUtils.degToRad(roll));
    toPivot.makeTranslation(-pivot.x, -pivot.y, -pivot.z);
    fromPivot.makeTranslation(pivot.x, pivot.y, pivot.z);
    rot.makeRotationFromEuler(euler);
    shared.uHead.value.copy(fromPivot).multiply(rot).multiply(toPivot);
    eyeGroup.matrix.copy(shared.uHead.value);
    shared.uBreath.value = Math.sin(t * 1.25) * 2.2 * S;

    glowMat.uniforms.uLevel.value = .28 + Math.sin(t * 2.1) * .05 + level * .55 + (listening ? .15 : 0);

    // la luce gira lentamente attorno alla figura
    shared.uLight.value.set(Math.sin(t * .15) * 1.8 - .6, 1.5 + Math.sin(t * .11) * .3, 3);

    if (speaking || raw > 0) mouthTex.needsUpdate = true;

    // camera
    pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 2.5);
    pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 2.5);
    const goal = shotPose(shot, t);
    goal.pos.x += pointer.x * .05; goal.pos.y -= pointer.y * .03;
    if (cam.t < 1) {
      cam.t = Math.min(1, cam.t + dt / cam.dur);
      const k = ease(cam.t);
      camera.position.lerpVectors(cam.from.pos, goal.pos, k);
      currentTarget.lerpVectors(cam.from.target, goal.target, k);
      camera.fov = cam.from.fov + (goal.fov - cam.from.fov) * k;
    } else {
      camera.position.copy(goal.pos); currentTarget.copy(goal.target); camera.fov = goal.fov;
    }
    camera.updateProjectionMatrix();
    camera.lookAt(currentTarget);
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
  // Entrata dall'astronave: la camera parte lontana e scende fino al mezzo busto
  function intro() {
    const g = shotPose('wide', performance.now() / 1000);
    const far = g.pos.clone().sub(g.target).multiplyScalar(3.2).add(g.target);
    far.y += .35;
    cam.from = {pos: far, target: g.target.clone(), fov: g.fov + 6};
    camera.position.copy(far);
    shot = 'wide'; cam.t = 0; cam.dur = 2.8;
    manualUntil = performance.now() + 5200;   // il saluto resta in mezzo busto mentre la camera atterra
  }
  window.aura3d = {setShot: (n, cut) => setShot(n, {cut, manual: true}), intro};
}

if (portrait.complete) start().catch(e => console.warn('AURA 3D non disponibile', e));
else portrait.addEventListener('load', () => start().catch(e => console.warn('AURA 3D non disponibile', e)), {once: true});
