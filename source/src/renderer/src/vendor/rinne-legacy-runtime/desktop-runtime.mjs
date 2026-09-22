import { validateRinneGpuBundle } from "./bundle-loader.mjs";
import { stabilizeRinneDesktopStep } from "./desktop-stability.mjs";
import { validateRinneGpuLinearDynamicBundle } from "./dynamic-bundle-loader.mjs";
import { validateRinneGpuEyeDynamicBundle } from "./eye-dynamic-loader.mjs";
import {
  selectRinneGpuOutfitPortrait,
  validateRinneGpuOutfitManifest,
} from "./outfit-loader.mjs";
import { validateRinneGpuRuntimeControlBundle } from "./runtime-control-loader.mjs";
import {
  RinneGpuResidentTimeline,
  validateRinneGpuTimelineBundle,
} from "./timeline-loader.mjs";
import { RinneWebGl2ReferenceRenderer } from "./webgl2-renderer.mjs";

export const RINNE_DESKTOP_DEFAULT_PORTRAIT_ID = 60102;
export const RINNE_DESKTOP_MOUTH_GAIN_SCALE = 0.68;
export const RINNE_DESKTOP_REDUCED_MOUTH_PORTRAIT_IDS = Object.freeze([
  60102, // neutral: user-approved reduced speech opening
  60105, // awkward: closed-eye horizontal smile
  60106, // happy: closed-eye bright horizontal smile
  60112, // embarrassed: closed-eye strained horizontal smile
]);
const RINNE_DESKTOP_REDUCED_MOUTH_PORTRAIT_SUFFIXES = Object.freeze([
  2, 5, 6, 12,
]);

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizedEmotion(value) {
  if (typeof value !== "string") return "neutral";
  const normalized = value
    .trim()
    .toLowerCase()
    .replaceAll("-", "_")
    .replaceAll(" ", "_");
  return normalized || "neutral";
}

function smoothStep(value) {
  const bounded = clamp(value, 0, 1);
  return bounded * bounded * (3 - 2 * bounded);
}

export function resolveRinnePortraitIdByEmotion(outfit, emotion) {
  if (
    outfit === null ||
    typeof outfit !== "object" ||
    !(outfit.byId instanceof Map)
  ) {
    throw new TypeError("validated Rinne outfit manifest is required");
  }
  const tag = normalizedEmotion(emotion);
  for (const entry of outfit.byId.values()) {
    if (Array.isArray(entry.tags) && entry.tags.includes(tag)) {
      return entry.portrait_id;
    }
  }
  return (
    outfit.manifest?.default_portrait_id ?? RINNE_DESKTOP_DEFAULT_PORTRAIT_ID
  );
}

export function resolveRinneDesktopMouthGainScale(portraitId) {
  const numeric = Number(portraitId);
  return Number.isSafeInteger(numeric) &&
    RINNE_DESKTOP_REDUCED_MOUTH_PORTRAIT_SUFFIXES.includes(numeric % 100)
    ? RINNE_DESKTOP_MOUTH_GAIN_SCALE
    : 1;
}

export function resolveRinneMouthGains(level, gainScale = 1) {
  const numeric = Number(level);
  if (!Number.isFinite(numeric)) {
    throw new TypeError("Rinne mouth level must be finite");
  }
  const scale = Number(gainScale);
  if (!Number.isFinite(scale) || scale < 0 || scale > 1) {
    throw new RangeError("Rinne mouth gain scale must be between zero and one");
  }
  const gated = clamp((numeric - 0.035) / 0.965, 0, 1);
  if (gated === 0) return new Float32Array(3);
  const position = Math.pow(gated, 0.7) * 3;
  if (position <= 1) {
    return Float32Array.from([smoothStep(position) * scale, 0, 0]);
  }
  if (position <= 2) {
    const blend = smoothStep(position - 1);
    return Float32Array.from([(1 - blend) * scale, blend * scale, 0]);
  }
  const blend = smoothStep(position - 2);
  return Float32Array.from([0, (1 - blend) * scale, blend * scale]);
}

export function sampleRinneSpeechVolume(volumes, sliceLength, currentTimeMs) {
  if (!(Array.isArray(volumes) || volumes instanceof Float32Array)) {
    throw new TypeError("Rinne speech volumes must be an array");
  }
  const interval = Number(sliceLength);
  const time = Number(currentTimeMs);
  if (!Number.isFinite(interval) || interval <= 0) {
    throw new RangeError("Rinne speech slice length must be positive");
  }
  if (!Number.isFinite(time) || time < 0) {
    throw new RangeError("Rinne speech time must be nonnegative");
  }
  if (volumes.length === 0) return 0;
  const position = time / interval;
  const lowerIndex = Math.floor(position);
  if (lowerIndex >= volumes.length) return 0;
  const upperIndex = Math.min(lowerIndex + 1, volumes.length - 1);
  const lower = clamp(Number(volumes[lowerIndex]) || 0, 0, 1);
  const upper = clamp(Number(volumes[upperIndex]) || 0, 0, 1);
  return lower + (upper - lower) * (position - lowerIndex);
}

async function validatedPortrait(raw, preverified) {
  const options = { preverified };
  const base = await validateRinneGpuBundle(raw, options);
  const dynamic = await validateRinneGpuLinearDynamicBundle(raw, base, options);
  const eye = await validateRinneGpuEyeDynamicBundle(raw, dynamic, options);
  const runtime = await validateRinneGpuRuntimeControlBundle(
    raw,
    dynamic,
    eye,
    options,
  );
  const timeline = await validateRinneGpuTimelineBundle(
    raw,
    runtime,
    dynamic,
    options,
  );
  if (base.manifest.source.portrait_id !== raw.portraitId) {
    throw new Error("loaded portrait identity does not match its requested id");
  }
  return { base, dynamic, eye, runtime, timeline };
}

export class RinneLegacyDesktopRuntime {
  constructor({
    canvas,
    underlayCanvas = null,
    loadCatalog,
    loadPortrait,
    width = 2048,
    height = 2048,
    preverifiedAssetSource = false,
    randomInt = () => Math.floor(Math.random() * 32768),
    mouthGainScaleForPortrait = resolveRinneDesktopMouthGainScale,
    hiddenDrawTypes = [],
    underlayVisibleDrawTypes = [],
    onFrame = () => {},
    onFatal = () => {},
  }) {
    if (canvas === null || typeof canvas?.getContext !== "function") {
      throw new TypeError("Rinne desktop runtime requires a canvas");
    }
    if (
      underlayCanvas !== null &&
      typeof underlayCanvas?.getContext !== "function"
    ) {
      throw new TypeError("Rinne desktop runtime underlay must be a canvas");
    }
    if (
      typeof loadCatalog !== "function" ||
      typeof loadPortrait !== "function"
    ) {
      throw new TypeError(
        "Rinne desktop runtime requires asset loader callbacks",
      );
    }
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width <= 0 ||
      height <= 0 ||
      width > 4096 ||
      height > 4096
    ) {
      throw new RangeError("Rinne desktop dimensions must be within 1..4096");
    }
    if (
      typeof preverifiedAssetSource !== "boolean" ||
      typeof randomInt !== "function" ||
      typeof mouthGainScaleForPortrait !== "function" ||
      !Array.isArray(hiddenDrawTypes) ||
      hiddenDrawTypes.some(
        (value, index) =>
          !Number.isSafeInteger(value) ||
          value <= 2 ||
          hiddenDrawTypes.indexOf(value) !== index,
      ) ||
      !Array.isArray(underlayVisibleDrawTypes) ||
      underlayVisibleDrawTypes.some(
        (value, index) =>
          !Number.isSafeInteger(value) ||
          value < 0 ||
          underlayVisibleDrawTypes.indexOf(value) !== index,
      ) ||
      (underlayCanvas === null) !== (underlayVisibleDrawTypes.length === 0) ||
      typeof onFrame !== "function" ||
      typeof onFatal !== "function"
    ) {
      throw new TypeError("Rinne desktop runtime callbacks are invalid");
    }
    this.canvas = canvas;
    this.underlayCanvas = underlayCanvas;
    this.loadCatalog = loadCatalog;
    this.loadPortrait = loadPortrait;
    this.width = width;
    this.height = height;
    this.preverifiedAssetSource = preverifiedAssetSource;
    this.randomInt = randomInt;
    this.mouthGainScaleForPortrait = mouthGainScaleForPortrait;
    this.hiddenDrawTypes = [...hiddenDrawTypes];
    this.underlayVisibleDrawTypes = [...underlayVisibleDrawTypes];
    this.onFrame = onFrame;
    this.onFatal = onFatal;
    this.outfit = null;
    this.gl = null;
    this.underlayGl = null;
    this.renderer = null;
    this.underlayRenderer = null;
    this.timeline = null;
    this.controls = null;
    this.currentPortraitId = null;
    this.rawCache = new Map();
    this.switchQueue = Promise.resolve();
    this.running = false;
    this.failed = false;
    this.frameHandle = null;
    this.lastAnimationTime = null;
    this.motionClock = 0;
    this.pointer = new Float32Array(2);
    this.mouthLevel = 0;
    this.manualMouthTarget = 0;
    this.speech = null;
    this.boundAnimate = (timestamp) => this.animate(timestamp);
    this.boundContextLost = (event) => {
      event.preventDefault();
      this.fail(new Error("Rinne WebGL2 context was lost"));
    };
  }

  async initialize({ start = true } = {}) {
    if (this.outfit !== null) {
      throw new Error("Rinne desktop runtime is already initialized");
    }
    const catalogRaw = await this.loadCatalog();
    this.outfit = validateRinneGpuOutfitManifest(catalogRaw);
    this.ensureGl();
    await this.loadAndSwapPortrait(this.outfit.manifest.default_portrait_id);
    this.canvas.addEventListener("webglcontextlost", this.boundContextLost);
    this.underlayCanvas?.addEventListener(
      "webglcontextlost",
      this.boundContextLost,
    );
    if (start) this.start();
    return this.snapshot();
  }

  ensureGl() {
    if (this.gl !== null) return this.gl;
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    const gl = this.canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: false,
      desynchronized: false,
      failIfMajorPerformanceCaveat: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      stencil: false,
    });
    if (
      typeof WebGL2RenderingContext === "undefined" ||
      !(gl instanceof WebGL2RenderingContext)
    ) {
      throw new Error("desktop host did not provide a WebGL2 context");
    }
    this.gl = gl;
    return gl;
  }

  ensureUnderlayGl() {
    if (this.underlayCanvas === null) return null;
    if (this.underlayGl !== null) return this.underlayGl;
    this.underlayCanvas.width = this.width;
    this.underlayCanvas.height = this.height;
    const gl = this.underlayCanvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: false,
      desynchronized: false,
      failIfMajorPerformanceCaveat: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      stencil: false,
    });
    if (
      typeof WebGL2RenderingContext === "undefined" ||
      !(gl instanceof WebGL2RenderingContext)
    ) {
      throw new Error("desktop host did not provide underlay WebGL2 context");
    }
    this.underlayGl = gl;
    return gl;
  }

  async portraitBytes(portraitId) {
    if (this.rawCache.has(portraitId)) {
      const cached = this.rawCache.get(portraitId);
      this.rawCache.delete(portraitId);
      this.rawCache.set(portraitId, cached);
      return cached;
    }
    const raw = await this.loadPortrait(portraitId);
    this.rawCache.set(portraitId, raw);
    while (this.rawCache.size > 2) {
      const oldest = this.rawCache.keys().next().value;
      if (oldest === undefined) break;
      this.rawCache.delete(oldest);
    }
    return raw;
  }

  selectPortrait(portraitId) {
    this.switchQueue = this.switchQueue
      .catch(() => {})
      .then(() => this.loadAndSwapPortrait(portraitId));
    return this.switchQueue;
  }

  selectEmotion(emotion) {
    if (this.outfit === null) {
      return Promise.reject(
        new Error("Rinne desktop runtime is not initialized"),
      );
    }
    return this.selectPortrait(
      resolveRinnePortraitIdByEmotion(this.outfit, emotion),
    );
  }

  async loadAndSwapPortrait(portraitId) {
    if (this.outfit === null) {
      throw new Error("Rinne desktop runtime is not initialized");
    }
    if (portraitId === this.currentPortraitId && this.renderer !== null) {
      return this.snapshot();
    }
    selectRinneGpuOutfitPortrait(this.outfit, portraitId);
    const loaded = await validatedPortrait(
      await this.portraitBytes(portraitId),
      this.preverifiedAssetSource,
    );
    let nextRenderer = null;
    let nextUnderlayRenderer = null;
    try {
      nextRenderer = new RinneWebGl2ReferenceRenderer(
        this.ensureGl(),
        loaded.base,
        loaded.dynamic,
        loaded.eye,
        loaded.runtime,
        { width: this.width, height: this.height },
      );
      nextRenderer.setHiddenDrawTypes(this.hiddenDrawTypes);
      const underlayGl = this.ensureUnderlayGl();
      if (underlayGl !== null) {
        nextUnderlayRenderer = new RinneWebGl2ReferenceRenderer(
          underlayGl,
          loaded.base,
          loaded.dynamic,
          loaded.eye,
          loaded.runtime,
          { width: this.width, height: this.height },
        );
        nextUnderlayRenderer.setVisibleDrawTypes(this.underlayVisibleDrawTypes);
      }
      const nextTimeline = new RinneGpuResidentTimeline(
        loaded.timeline,
        loaded.dynamic,
        loaded.runtime,
        {
          startTime: 0,
          loop: true,
          randomInt: this.randomInt,
        },
      );
      const nextControls = {
        expressionWeights: new Float32Array(loaded.timeline.expressionCount),
        mouthScale: 1,
        mouthGains: new Float32Array(3),
        rightEyeClose: 0,
        leftEyeClose: 0,
        neckRotation: new Float32Array(3),
        neckTranslation: new Float32Array(3),
        rightPupilPosition: new Float32Array(this.pointer),
        leftPupilPosition: new Float32Array(this.pointer),
        type2Intensity: 1,
      };
      const previousRenderer = this.renderer;
      const previousUnderlayRenderer = this.underlayRenderer;
      this.renderer = nextRenderer;
      this.underlayRenderer = nextUnderlayRenderer;
      this.timeline = nextTimeline;
      this.controls = nextControls;
      this.currentPortraitId = portraitId;
      this.motionClock = 0;
      this.lastAnimationTime = null;
      nextRenderer = null;
      nextUnderlayRenderer = null;
      previousRenderer?.dispose();
      previousUnderlayRenderer?.dispose();
      this.drawCurrentFrame(0);
      return this.snapshot();
    } finally {
      nextRenderer?.dispose();
      nextUnderlayRenderer?.dispose();
    }
  }

  setPointer(x, y) {
    const horizontal = Number(x);
    const vertical = Number(y);
    if (!Number.isFinite(horizontal) || !Number.isFinite(vertical)) {
      throw new TypeError("Rinne pointer coordinates must be finite");
    }
    this.pointer[0] = clamp(horizontal, -0.35, 0.35);
    this.pointer[1] = clamp(vertical, -0.35, 0.35);
  }

  setMouthLevel(level) {
    const numeric = Number(level);
    if (!Number.isFinite(numeric)) {
      throw new TypeError("Rinne mouth level must be finite");
    }
    this.speech = null;
    this.manualMouthTarget = clamp(numeric, 0, 1);
  }

  startSpeech(volumes, sliceLength, currentTimeMs) {
    if (typeof currentTimeMs !== "function") {
      throw new TypeError("Rinne speech clock must be callable");
    }
    const samples = Float32Array.from(volumes, (value) =>
      clamp(Number(value) || 0, 0, 1),
    );
    sampleRinneSpeechVolume(samples, sliceLength, 0);
    this.speech = {
      volumes: samples,
      sliceLength: Number(sliceLength),
      currentTimeMs,
    };
  }

  stopSpeech() {
    this.speech = null;
    this.manualMouthTarget = 0;
  }

  restartMotion() {
    if (this.renderer === null || this.timeline === null) {
      throw new Error("Rinne desktop runtime is not initialized");
    }
    this.timeline.reset({ startTime: 0, loop: true });
    this.motionClock = 0;
    this.lastAnimationTime = null;
    this.drawCurrentFrame(0);
    return this.snapshot();
  }

  resolveMouthTarget() {
    if (this.speech === null) return this.manualMouthTarget;
    try {
      return sampleRinneSpeechVolume(
        this.speech.volumes,
        this.speech.sliceLength,
        this.speech.currentTimeMs(),
      );
    } catch (error) {
      this.speech = null;
      this.manualMouthTarget = 0;
      throw error;
    }
  }

  liveControls(deltaTime) {
    const target = this.resolveMouthTarget();
    const timeConstant = target > this.mouthLevel ? 42 : 76;
    const blend = 1 - Math.exp(-Math.max(0, deltaTime) / timeConstant);
    this.mouthLevel += (target - this.mouthLevel) * blend;
    const mouthGainScale = Number(
      this.mouthGainScaleForPortrait(this.currentPortraitId),
    );
    if (
      !Number.isFinite(mouthGainScale) ||
      mouthGainScale < 0 ||
      mouthGainScale > 1
    ) {
      throw new RangeError("Rinne mouth gain scale must be within 0..1");
    }
    return {
      ...this.controls,
      mouthGains: resolveRinneMouthGains(this.mouthLevel, mouthGainScale),
      rightPupilPosition: new Float32Array(this.pointer),
      leftPupilPosition: new Float32Array(this.pointer),
    };
  }

  drawCurrentFrame(deltaTime) {
    if (this.renderer === null || this.timeline === null) return;
    const step = this.timeline.advance(
      Math.trunc(this.motionClock) >>> 0,
      this.liveControls(deltaTime),
    );
    if (step.finished) {
      this.timeline.reset({ startTime: 0, loop: true });
      this.motionClock = 0;
      return;
    }
    const applied = stabilizeRinneDesktopStep(step, true);
    if (this.underlayRenderer !== null) {
      this.underlayRenderer.setDynamicCoefficients(applied.dynamicCoefficients);
      this.underlayRenderer.setEyeControls(applied.eyeControls);
      this.underlayRenderer.setRuntimeControls(applied.runtimeControls);
      this.underlayRenderer.draw();
    }
    this.renderer.setDynamicCoefficients(applied.dynamicCoefficients);
    this.renderer.setEyeControls(applied.eyeControls);
    this.renderer.setRuntimeControls(applied.runtimeControls);
    this.renderer.draw();
    this.onFrame(
      Object.freeze({
        portraitId: this.currentPortraitId,
        breathGain: applied.breath.gain,
      }),
    );
  }

  animate(timestamp) {
    if (!this.running || this.failed) return;
    try {
      const delta =
        this.lastAnimationTime === null
          ? 0
          : Math.min(100, Math.max(0, timestamp - this.lastAnimationTime));
      this.lastAnimationTime = timestamp;
      this.motionClock += delta;
      this.drawCurrentFrame(delta);
      this.frameHandle = requestAnimationFrame(this.boundAnimate);
    } catch (error) {
      this.fail(error);
    }
  }

  start() {
    if (this.failed)
      throw new Error("failed Rinne desktop runtime cannot restart");
    if (this.running) return;
    this.running = true;
    this.lastAnimationTime = null;
    this.frameHandle = requestAnimationFrame(this.boundAnimate);
  }

  stop() {
    this.running = false;
    if (this.frameHandle !== null) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = null;
    this.lastAnimationTime = null;
  }

  drawStillFrame() {
    if (this.renderer === null || this.timeline === null) {
      throw new Error("Rinne desktop runtime is not initialized");
    }
    this.drawCurrentFrame(0);
    return this.snapshot();
  }

  fail(error) {
    if (this.failed) return;
    this.failed = true;
    this.stop();
    const failure = error instanceof Error ? error : new Error(String(error));
    this.onFatal(failure);
  }

  snapshot() {
    return Object.freeze({
      initialized: this.outfit !== null,
      running: this.running,
      failed: this.failed,
      portraitId: this.currentPortraitId,
      width: this.width,
      height: this.height,
      renderer:
        this.gl === null
          ? null
          : this.gl.getParameter(this.gl.RENDERER) || "WebGL2",
      underlayActive: this.underlayRenderer !== null,
    });
  }

  dispose() {
    this.stop();
    this.canvas.removeEventListener("webglcontextlost", this.boundContextLost);
    this.underlayCanvas?.removeEventListener(
      "webglcontextlost",
      this.boundContextLost,
    );
    this.renderer?.dispose();
    this.underlayRenderer?.dispose();
    this.renderer = null;
    this.underlayRenderer = null;
    this.timeline = null;
    this.controls = null;
    this.rawCache.clear();
  }
}
