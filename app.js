/* ============================================================
   Inkwell, rewritten. — app.js
   Vanilla three.js r160 scene: ink-bloom hero cloud → drift of
   instanced books + GPU page particles → proof ambience → the
   gold ex-libris card. Scroll-choreographed, tier-adapted.
   Loaded only when WebGL is available and reduced-motion is off.
   ============================================================ */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const CLAMP = (v, a, b) => Math.min(b, Math.max(a, v));
const SMOOTH = (a, b, x) => { const t = CLAMP((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t) => t * t * t;
const easeInOutCubic = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export function init(boot) {
  try {
    return new InkwellScene(boot);
  } catch (err) {
    if (window.__inkwellFallback) window.__inkwellFallback();
    return null;
  }
}

class InkwellScene {
  constructor(boot) {
    this.tier = boot.tier || 'A';
    this.canvas = boot.canvas;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: this.tier === 'A',
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.tier === 'A' ? 2 : 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      if (window.__inkwellFallback) window.__inkwellFallback();
    });

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x14213D);
    scene.fog = new THREE.Fog(0x0B0F1A, 12, 42);
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 200);
    camera.position.set(0, 0, 7);
    this.camera = camera;

    this.buildLights();
    this.buildCloud();
    this.buildBooks();
    this.buildParticles();
    this.buildCandles();
    this.buildCard();

    this.maxBooks = this.tier === 'A' ? 900 : this.tier === 'B' ? 600 : 350;
    this.maxParticles = this.tier === 'A' ? 6000 : this.tier === 'B' ? 4000 : 2000;
    this.books.mesh.count = this.maxBooks;
    this.particles.geometry.setDrawRange(0, this.maxParticles);

    this.post = this.buildPost(this.tier !== 'C');

    this.posCurve = this.makePosCurve();
    this.lookCurve = this.makeLookCurve();
    this.camPos = new THREE.Vector3(0, 0, 7);
    this.camLook = new THREE.Vector3(0, 0, 0);

    this.clock = { time: 0, last: performance.now(), running: true };
    this.fpsEma = 60;
    this.fpsAccum = 0;
    this.fpsCount = 0;
    this.fpsElapsed = 0;
    this.degraded = 0;
    this.degradeOrder = ['particles', 'books', 'bloom', 'pixelratio'];

    this.flip = { active: false, t: 0, name: null };
    window.__inkwellCardSuccess = (name) => this.flipTo(name);

    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => this.pauseToggle());

    this.raf();
  }

  /* ---------- lights ---------- */
  buildLights() {
    const hemi = new THREE.HemisphereLight(0x2A3A5C, 0xE9B25E, 0.65);
    const dir = new THREE.DirectionalLight(0xE9B25E, 0.45);
    dir.position.set(4, 6, 2);
    const spot = new THREE.SpotLight(0xE9B25E, 1.1, 45, Math.PI / 5, 0.4, 1);
    spot.position.set(0, 4, -60);
    spot.target.position.set(0, 0, -66);
    this.scene.add(hemi, dir, spot, spot.target);
  }

  /* ---------- Scene 1: ink-bloom cloud (GPU points) ---------- */
  buildCloud() {
    const N = 2200;
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const r = 1.5 + Math.pow(Math.random(), 1.8) * 7.5;
      const th = Math.acos(2 * Math.random() - 1);
      const ph = Math.random() * Math.PI * 2;
      pos[i * 3] = r * Math.sin(th) * Math.cos(ph);
      pos[i * 3 + 1] = r * Math.sin(th) * Math.sin(ph);
      pos[i * 3 + 2] = r * Math.cos(th);
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPhase: { value: 0 },
        uSize: { value: 26 },
        uFade: { value: 1 }
      },
      vertexShader: `
        uniform float uTime; uniform float uPhase; uniform float uSize;
        attribute float aSeed; varying float vA;
        void main() {
          float t = uTime + aSeed * 6.2831;
          vec3 base = position;
          float r = max(length(base), 0.001);
          vec3 dir = base / r;
          float grow = smoothstep(0.0, 1.0, uPhase);
          vec3 p = dir * mix(0.7, r, grow);
          p.x += sin(t * 0.35 + aSeed * 20.0) * 0.4;
          p.y += cos(t * 0.28 + aSeed * 17.0) * 0.34;
          p.z += sin(t * 0.20 + aSeed * 11.0) * 0.3;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(uSize * (2.0 + aSeed * 2.5) / max(0.1, -mv.z), 1.0, 16.0);
          vA = (0.12 + 0.30 * (0.5 + 0.5 * sin(aSeed * 13.0 + t * 0.5))) * grow;
        }
      `,
      fragmentShader: `
        varying float vA; uniform float uFade;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          float a = smoothstep(0.5, 0.02, d) * vA * uFade;
          gl_FragColor = vec4(0.18, 0.30, 0.45, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const cloud = new THREE.Points(geo, mat);
    cloud.position.set(0, 0, 2);
    this.scene.add(cloud);
    this.cloud = cloud;
    this.cloudMat = mat;
  }

  /* ---------- Scene 2/3: instanced books ---------- */
  buildBooks() {
    const geo = new THREE.BoxGeometry(0.42, 0.6, 0.1);
    const mat = new THREE.MeshLambertMaterial({ transparent: true, opacity: 0 });
    const max = 900;
    const mesh = new THREE.InstancedMesh(geo, mat, max);

    const palette = [0x2A3A5C, 0x4A5A7C, 0x6E5B4E, 0x8A5A3A, 0x3E7A74, 0x1E2E4E, 0x5C4A3A, 0x3B5678];
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    const depth = 59;
    for (let i = 0; i < max; i++) {
      const t = Math.pow(i / max, 0.92);
      const z = 1.5 - t * depth;
      const ang = Math.random() * Math.PI * 2;
      const r = 2.6 + (1 - Math.pow(Math.random(), 2.5)) * 13;
      const x = Math.cos(ang) * r;
      const y = Math.sin(ang) * r * 0.65 + (Math.random() - 0.5) * 2;
      dummy.position.set(x, y, z);
      dummy.rotation.set(Math.random() * 0.6, Math.random() * Math.PI * 2, Math.random() * 0.6);
      const s = 0.6 + Math.random() * 1.2;
      dummy.scale.set(s, s * (0.8 + Math.random() * 0.5), s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      col.setHex(palette[(Math.random() * palette.length) | 0]);
      mesh.setColorAt(i, col);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.scene.add(mesh);
    this.books = { mesh, mat, baseRotation: 0 };
  }

  /* ---------- Scene 2: GPU page particles ---------- */
  buildParticles() {
    const max = 6000;
    const pos = new Float32Array(max * 3);
    const seed = new Float32Array(max);
    for (let i = 0; i < max; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 30;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 16;
      pos[i * 3 + 2] = -Math.random() * 58;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: 42 }
      },
      vertexShader: `
        uniform float uTime; uniform float uSize;
        attribute float aSeed; varying float vA;
        void main() {
          float life = fract(aSeed + uTime * 0.045);
          float span = 22.0;
          vec3 p = position;
          p.y -= life * span;
          p.x += sin((life + aSeed) * 10.6 + aSeed * 13.0) * 1.7;
          p.z += cos((life + aSeed) * 4.2 + aSeed * 7.0) * 0.9;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(uSize * 9.0 / max(0.1, -mv.z), 1.0, 28.0);
          vA = (0.5 + 0.5 * sin(life * 6.2831 + aSeed * 5.0)) * 0.5;
        }
      `,
      fragmentShader: `
        varying float vA;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          float a = smoothstep(0.5, 0.03, d) * vA;
          gl_FragColor = vec4(0.957, 0.925, 0.847, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);
    this.particles = { points, geometry: geo };
  }

  /* ---------- candle halos: ONE additive sprite Points batch ---------- */
  buildCandles() {
    const tex = makeGlowTexture();
    const N = 18;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const depth = 2 + Math.pow(i / N, 0.8) * 55;
      const ang = Math.random() * Math.PI * 2;
      const r = 1.2 + Math.random() * 3.5;
      pos[i * 3] = Math.cos(ang) * r;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 4 + 0.3;
      pos[i * 3 + 2] = -depth;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      map: tex, size: 2.6, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, color: 0xE9B25E
    });
    const candles = new THREE.Points(geo, mat);
    this.scene.add(candles);
    this.candles = candles;
  }

  /* ---------- Scene 4: the gold ex-libris card ---------- */
  buildCard() {
    const group = new THREE.Group();
    const w = 3.0, h = 1.875;

    const frontTex = drawCardFront();
    const backTex = drawCardBack('Member, Library of Inkwell');

    const mk = (tex) => new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.55, metalness: 0.05, emissive: 0x101010, transparent: true, opacity: 0
    });
    const matFront = mk(frontTex);
    const matBack = mk(backTex);

    const front = new THREE.Mesh(new THREE.PlaneGeometry(w, h), matFront);
    front.position.z = 0.002;
    const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), matBack);
    back.position.z = -0.002;
    back.rotation.y = Math.PI;

    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xC9A227, metalness: 0.85, roughness: 0.25, emissive: 0xC9A227, emissiveIntensity: 0.4
    });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, h + 0.04, 0.04), goldMat);

    group.add(front, back, frame);
    group.position.set(0, 0, -66);
    this.scene.add(group);

    this.card = { group, backTex, matBack, goldMat };
  }

  /* ---------- postprocessing (bloom half-res; tier C skips) ---------- */
  buildPost(withBloom) {
    if (!withBloom) {
      this.composer = null;
      return null;
    }
    const size = new THREE.Vector2(window.innerWidth, window.innerHeight);
    const composer = new EffectComposer(this.renderer);
    composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(size, 0.55, 0.4, 0.65);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    this.bloom = bloom;
    return composer;
  }

  /* ---------- scroll choreography curves ---------- */
  makePosCurve() {
    return new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 7),
      new THREE.Vector3(0, 0, 5.5),
      new THREE.Vector3(0.3, 0.1, 3),
      new THREE.Vector3(-1.5, 0.4, -12),
      new THREE.Vector3(-4, 0.8, -30),
      new THREE.Vector3(-5, 0.8, -34),
      new THREE.Vector3(-3, 0.3, -46),
      new THREE.Vector3(0, 0.2, -56),
      new THREE.Vector3(0, 0.15, -62),
      new THREE.Vector3(0, 0.1, -64)
    ], false, 'centripetal');
  }
  makeLookCurve() {
    return new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, 0.4),
      new THREE.Vector3(0.1, 0.1, 1),
      new THREE.Vector3(0, 0.2, -8),
      new THREE.Vector3(0, 0.3, -26),
      new THREE.Vector3(0, 0.3, -32),
      new THREE.Vector3(0, 0.2, -44),
      new THREE.Vector3(0, 0.2, -58),
      new THREE.Vector3(0, 0.15, -63),
      new THREE.Vector3(0, 0.12, -64.5)
    ], false, 'centripetal');
  }

  ease(p) {
    if (p < 0.14) return easeOutCubic(p / 0.14) * 0.14;
    if (p < 0.22) return 0.14 + ((p - 0.14) / 0.08) * 0.08;
    if (p < 0.55) return 0.22 + ((p - 0.22) / 0.33) * 0.33;
    if (p < 0.60) return 0.55 + easeInOutCubic((p - 0.55) / 0.05) * 0.05;
    if (p < 0.78) return 0.60 + ((p - 0.60) / 0.18) * 0.18;
    if (p < 0.88) return 0.78 + easeInCubic((p - 0.78) / 0.10) * 0.10;
    return 0.88 + easeInOutCubic((p - 0.88) / 0.12) * 0.12;
  }

  weave(p) {
    const a = SMOOTH(0.20, 0.38, p) * (1 - SMOOTH(0.58, 0.70, p));
    return Math.sin(p * Math.PI * 6) * 1.3 * a;
  }

  /* ---------- render loop ---------- */
  raf() {
    if (!this.clock.running) return;
    requestAnimationFrame(() => this.frame());
  }

  frame() {
    if (!this.clock.running) return;
    const now = performance.now();
    let dt = (now - this.clock.last) / 1000;
    this.clock.last = now;
    dt = Math.min(dt, 0.05);
    if (dt > 0) this.clock.time += dt;

    this.updateCamera(dt);
    this.updateScenes();
    this.updateCard(dt);
    this.adaptFps(dt);

    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);

    this.raf();
  }

  updateCamera(dt) {
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const P = CLAMP(window.scrollY / max, 0, 1);
    const ep = this.ease(P);
    const k = 6;
    const f = 1 - Math.exp(-k * dt);

    const tpos = this.posCurve.getPoint(ep);
    tpos.x += this.weave(P);
    const tlook = this.lookCurve.getPoint(ep);

    this.camPos.lerp(tpos, f);
    this.camLook.lerp(tlook, f * 0.85);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);

    const fovT = 1 - SMOOTH(0, 0.12, P);
    this.camera.fov = 62 - 4 * fovT;
    this.camera.updateProjectionMatrix();
  }

  updateScenes() {
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const P = CLAMP(window.scrollY / max, 0, 1);

    this.cloudMat.uniforms.uPhase.value = CLAMP(this.clock.time / 2.5, 0, 1);
    this.cloudMat.uniforms.uTime.value = this.clock.time;
    this.cloudMat.uniforms.uFade.value = 1 - SMOOTH(0.10, 0.28, P);

    const bookA = SMOOTH(0.12, 0.28, P);
    this.books.mat.opacity = bookA;
    this.books.mesh.rotation.z = Math.sin(this.clock.time * 0.06) * 0.02;
    this.books.mesh.rotation.y = Math.sin(this.clock.time * 0.04) * 0.015;

    this.particles.points.visible = P > 0.12;
    this.particles.points.material.uniforms.uTime.value = this.clock.time;
  }

  updateCard(dt) {
    const P = CLAMP(window.scrollY / Math.max(1, document.documentElement.scrollHeight - window.innerHeight), 0, 1);
    const a = SMOOTH(0.78, 0.88, P);
    this.card.matFront.opacity = a;
    this.card.matBack.opacity = a;
    this.card.goldMat.opacity = a;
    this.card.frameVisible = a;

    const group = this.card.group;
    if (this.flip.active) {
      this.flip.t += dt;
      const t = CLAMP(this.flip.t / 0.9, 0, 1);
      group.rotation.x = easeInOutCubic(t) * Math.PI;
      if (t >= 1) {
        this.flip.active = false;
        this.flip.pulse = 1;
      }
    } else if (P > 0.86 && !this.flip.done) {
      group.rotation.x = 0;
      group.rotation.y += 0.07 * dt;
      group.position.y = 0 + Math.sin(this.clock.time * 2) * 0.06;
    }

    if (this.flip.pulse != null) {
      this.flip.pulse = Math.max(0, this.flip.pulse - dt * 0.7);
      const g = 0.4 + Math.sin(Math.min(1, this.flip.pulse) * Math.PI) * 0.55;
      this.card.goldMat.emissiveIntensity = g;
      if (this.flip.pulse === 0) this.flip.pulse = null;
    }
  }

  flipTo(name) {
    this.flip = { active: true, t: 0, name, done: true, pulse: null };
    this.updateCardBack(name);
  }

  updateCardBack(name) {
    const tex = drawCardBack(name);
    this.card.matBack.map = tex;
    this.card.matBack.needsUpdate = true;
  }

  /* ---------- live FPS adaptation ---------- */
  adaptFps(dt) {
    const fps = dt > 0 ? 1 / dt : 60;
    this.fpsEma = this.fpsEma * 0.95 + Math.min(fps, 120) * 0.05;
    this.fpsAccum += fps;
    this.fpsCount++;
    this.fpsElapsed += dt;

    if (this.fpsElapsed >= 2 && this.degraded < this.degradeOrder.length) {
      this.fpsElapsed = 0;
      const avg = this.fpsAccum / Math.max(1, this.fpsCount);
      this.fpsAccum = 0; this.fpsCount = 0;
      if (avg < 35) this.degrade(this.degradeOrder[this.degraded++]);
      if (avg < 25 && this.degraded >= this.degradeOrder.length) {
        if (window.__inkwellFallback) window.__inkwellFallback();
      }
    }
  }

  degrade(step) {
    if (step === 'particles') {
      const n = Math.floor(this.maxParticles * 0.6);
      this.maxParticles = Math.max(1200, n);
      this.particles.geometry.setDrawRange(0, this.maxParticles);
    } else if (step === 'books') {
      const n = Math.floor(this.maxBooks * 0.6);
      this.maxBooks = Math.max(200, n);
      this.books.mesh.count = this.maxBooks;
    } else if (step === 'bloom') {
      if (this.bloom) this.bloom.enabled = false;
    } else if (step === 'pixelratio') {
      this.renderer.setPixelRatio(1);
      if (this.composer) this.composer.setPixelRatio(1);
    }
  }

  /* ---------- lifecycle ---------- */
  pauseToggle() {
    if (document.hidden) {
      this.clock.running = false;
      this.clock.last = performance.now();
    } else {
      this.clock.running = true;
      this.clock.last = performance.now();
      this.raf();
    }
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    if (this.composer) this.composer.setSize(w, h);
  }
}

/* ---------- helpers ---------- */
function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(233,178,94,0.85)');
  gr.addColorStop(0.25, 'rgba(233,178,94,0.32)');
  gr.addColorStop(1, 'rgba(233,178,94,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function drawCardFront() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 640;
  const g = c.getContext('2d');
  g.fillStyle = '#F4ECD8';
  g.fillRect(0, 0, 1024, 640);

  g.strokeStyle = '#C9A227';
  g.lineWidth = 4;
  g.strokeRect(24, 24, 976, 592);
  g.lineWidth = 1.5;
  g.strokeRect(42, 42, 940, 556);

  g.fillStyle = '#14213D';
  g.font = '600 40px Fraunces, Georgia, serif';
  g.textAlign = 'center';
  g.letterSpacing = '18px';
  g.fillText('EX LIBRIS', 512, 130);

  drawOrnament(g, 512, 210);

  g.font = '700 110px Fraunces, Georgia, serif';
  g.fillText('INKWELL', 512, 348);

  g.font = 'italic 400 48px Fraunces, Georgia, serif';
  g.fillText('Library Card', 512, 424);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function drawCardBack(name) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 640;
  const g = c.getContext('2d');
  g.fillStyle = '#F4ECD8';
  g.fillRect(0, 0, 1024, 640);

  g.strokeStyle = '#C9A227';
  g.lineWidth = 4;
  g.strokeRect(24, 24, 976, 592);
  g.lineWidth = 1.5;
  g.strokeRect(42, 42, 940, 556);

  g.fillStyle = '#0B0F1A';
  g.font = 'italic 600 64px Fraunces, Georgia, serif';
  g.textAlign = 'center';
  g.fillText(String(name || 'Reader'), 512, 300);

  g.fillStyle = '#14213D';
  g.font = '500 44px Fraunces, Georgia, serif';
  g.fillText('Member since 2026', 512, 390);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function drawOrnament(g, x, y) {
  g.strokeStyle = '#14213D';
  g.fillStyle = '#14213D';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(x, y - 18, 20, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(x - 24, y + 2);
  g.lineTo(x + 24, y + 2);
  g.lineTo(x + 14, y + 34);
  g.lineTo(x - 14, y + 34);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(x + 2, y - 60);
  g.quadraticCurveTo(x + 40, y - 34, x + 20, y - 6);
  g.stroke();
  g.beginPath();
  g.moveTo(x + 18, y - 40);
  g.lineTo(x + 40, y - 46);
  g.moveTo(x + 22, y - 30);
  g.lineTo(x + 44, y - 34);
  g.moveTo(x + 24, y - 20);
  g.lineTo(x + 42, y - 20);
  g.stroke();
}
