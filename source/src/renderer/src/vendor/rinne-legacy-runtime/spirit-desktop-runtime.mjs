import { validateRinneGpuBundle } from "./bundle-loader.mjs";
import { stabilizeRinneDesktopStep } from "./desktop-stability.mjs";
import {
  resolveRinneMouthGains,
  sampleRinneSpeechVolume,
} from "./desktop-runtime.mjs";
import { validateRinneGpuLinearDynamicBundle } from "./dynamic-bundle-loader.mjs";
import { validateRinneGpuEyeDynamicBundle } from "./eye-dynamic-loader.mjs";
import { validateRinneGpuRuntimeControlBundle } from "./runtime-control-loader.mjs";
import {
  selectRinneSpiritExpression,
  validateRinneSpiritExpressionManifest,
} from "./spirit-expression-loader.mjs";
import {
  RinneGpuResidentTimeline,
  validateRinneGpuTimelineBundle,
} from "./timeline-loader.mjs";
import { RinneWebGl2ReferenceRenderer } from "./webgl2-renderer.mjs";

const SURPRISE_ALIAS = "surprise";
const SURPRISED_LABEL = "surprised";

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
  return normalized === SURPRISE_ALIAS ? SURPRISED_LABEL : normalized;
}

function createSynchronizedMotionRandom() {
  let state = 0x6d2b79f5;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state & 0x7fff;
  };
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
    throw new Error("loaded spirit portrait identity does not match its id");
  }
  return { base, dynamic, eye, runtime, timeline };
}

function webGlContext(target, label) {
  target.width = target.width;
  const gl = target.getContext("webgl2", {
    alpha: true,
    antialias: false,
    depth: false,
    desynchronized: true,
    failIfMajorPerformanceCaveat: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    stencil: false,
  });
  if (
    typeof WebGL2RenderingContext === "undefined" ||
    !(gl instanceof WebGL2RenderingContext)
  ) {
    throw new Error(`desktop host did not provide WebGL2 for ${label}`);
  }
  return gl;
}

function makeLayerRuntime(gl, loaded, width, height) {
  return {
    renderer: new RinneWebGl2ReferenceRenderer(
      gl,
      loaded.base,
      loaded.dynamic,
      loaded.eye,
      loaded.runtime,
      { width, height },
    ),
    timeline: new RinneGpuResidentTimeline(
      loaded.timeline,
      loaded.dynamic,
      loaded.runtime,
      {
        startTime: 0,
        loop: true,
        randomInt: createSynchronizedMotionRandom(),
      },
    ),
    expressionCount: loaded.timeline.expressionCount,
  };
}

function disposeLayer(runtime) {
  runtime?.renderer.dispose();
}

function maskGradient(mask) {
  const inner = Math.max(0, (1 - mask.feather) * 100);
  return `radial-gradient(ellipse ${mask.radii[0] * 100}% ${mask.radii[1] * 100}% at ${mask.center[0] * 100}% ${mask.center[1] * 100}%, black ${inner}%, transparent 100%)`;
}

function liveControls(expressionCount, pointer, mouthGains) {
  return {
    expressionWeights: new Float32Array(expressionCount),
    mouthScale: 1,
    mouthGains,
    rightEyeClose: 0,
    leftEyeClose: 0,
    neckRotation: new Float32Array(3),
    neckTranslation: new Float32Array(3),
    rightPupilPosition: new Float32Array(pointer),
    leftPupilPosition: new Float32Array(pointer),
    type2Intensity: 1,
  };
}

export class RinneSpiritDressDesktopRuntime {
  constructor({
    canvas,
    mouthCanvas,
    overlayCanvas,
    loadCatalog,
    loadPortrait,
    loadOverlay,
    width = 2048,
    height = 2048,
    preverifiedAssetSource = false,
    onFatal = () => {},
  }) {
    for (const [target, label] of [
      [canvas, "base"],
      [mouthCanvas, "mouth"],
      [overlayCanvas, "overlay"],
    ]) {
      if (target === null || typeof target?.getContext !== "function") {
        throw new TypeError(`spirit desktop runtime requires ${label} canvas`);
      }
    }
    if (
      typeof loadCatalog !== "function" ||
      typeof loadPortrait !== "function" ||
      typeof loadOverlay !== "function"
    ) {
      throw new TypeError("spirit desktop runtime requires asset callbacks");
    }
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width <= 0 ||
      height <= 0 ||
      width > 4096 ||
      height > 4096
    ) {
      throw new RangeError("spirit desktop dimensions must be within 1..4096");
    }
    if (
      typeof preverifiedAssetSource !== "boolean" ||
      typeof onFatal !== "function"
    ) {
      throw new TypeError("spirit desktop runtime options are invalid");
    }
    this.canvas = canvas;
    this.mouthCanvas = mouthCanvas;
    this.overlayCanvas = overlayCanvas;
    this.loadCatalog = loadCatalog;
    this.loadPortrait = loadPortrait;
    this.loadOverlay = loadOverlay;
    this.width = width;
    this.height = height;
    this.preverifiedAssetSource = preverifiedAssetSource;
    this.onFatal = onFatal;
    this.catalog = null;
    this.baseGl = null;
    this.mouthGl = null;
    this.baseRuntime = null;
    this.mouthRuntime = null;
    this.currentExpression = null;
    this.currentBasePortraitId = null;
    this.rawCache = new Map();
    this.overlayCache = new Map();
    this.switchQueue = Promise.resolve();
    this.running = false;
    this.failed = false;
    this.frameHandle = null;
    this.lastAnimationTime = null;
    this.motionClock = 0;
    this.pointer = new Float32Array(2);
    this.mouthLevel = 0;
    this.manualMouthTarget = 0;
    this.mouthGainScale = 1;
    this.mouthLayerActive = false;
    this.speech = null;
    this.boundAnimate = (timestamp) => this.animate(timestamp);
    this.boundContextLost = (event) => {
      event.preventDefault();
      this.fail(new Error("Rinne spirit WebGL2 context was lost"));
    };
  }

  async initialize({ start = true } = {}) {
    if (this.catalog !== null) {
      throw new Error("spirit desktop runtime is already initialized");
    }
    this.catalog = validateRinneSpiritExpressionManifest(
      await this.loadCatalog(),
    );
    this.ensureContexts();
    const initial = selectRinneSpiritExpression(
      this.catalog,
      this.catalog.manifest.default_expression,
    );
    const mouthPortraitId = this.catalog.manifest.expressions.find(
      (expression) => expression.mouth_layer !== null,
    )?.mouth_layer?.portrait_id;
    if (!Number.isSafeInteger(mouthPortraitId)) {
      throw new Error("approved spirit mouth donor is missing");
    }
    const requestedIds = [initial.base_portrait_id, mouthPortraitId];
    const loaded = new Map(
      await Promise.all(
        [...new Set(requestedIds)].map(async (portraitId) => [
          portraitId,
          await validatedPortrait(
            await this.portraitBytes(portraitId),
            this.preverifiedAssetSource,
          ),
        ]),
      ),
    );
    this.baseRuntime = makeLayerRuntime(
      this.baseGl,
      loaded.get(initial.base_portrait_id),
      this.width,
      this.height,
    );
    this.mouthRuntime = makeLayerRuntime(
      this.mouthGl,
      loaded.get(mouthPortraitId),
      this.width,
      this.height,
    );
    this.currentBasePortraitId = initial.base_portrait_id;
    this.applyExpressionLayers(initial, null);
    this.currentExpression = initial.label;
    this.canvas.addEventListener("webglcontextlost", this.boundContextLost);
    this.mouthCanvas.addEventListener(
      "webglcontextlost",
      this.boundContextLost,
    );
    this.drawCurrentFrame(0);
    if (start) this.start();
    return this.snapshot();
  }

  ensureContexts() {
    if (this.baseGl !== null && this.mouthGl !== null) return;
    for (const target of [this.canvas, this.mouthCanvas, this.overlayCanvas]) {
      target.width = this.width;
      target.height = this.height;
    }
    this.baseGl ??= webGlContext(this.canvas, "spirit base layer");
    this.mouthGl ??= webGlContext(this.mouthCanvas, "spirit mouth layer");
    const overlayContext = this.overlayCanvas.getContext("2d", {
      alpha: true,
    });
    if (!(overlayContext instanceof CanvasRenderingContext2D)) {
      throw new Error("desktop host did not provide 2D spirit overlay canvas");
    }
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

  async approvedOverlay(overlayId) {
    if (overlayId === null) return null;
    if (this.overlayCache.has(overlayId)) {
      return this.overlayCache.get(overlayId);
    }
    const bytes = await this.loadOverlay(overlayId);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
      throw new Error("approved spirit overlay bytes are missing");
    }
    const bitmap = await createImageBitmap(
      new Blob([bytes], { type: "image/png" }),
    );
    if (bitmap.width !== 4096 || bitmap.height !== 4096) {
      bitmap.close();
      throw new Error("approved spirit overlay canvas must be 4096 x 4096");
    }
    this.overlayCache.set(overlayId, bitmap);
    return bitmap;
  }

  selectEmotion(emotion) {
    if (this.catalog === null) {
      return Promise.reject(
        new Error("spirit desktop runtime is not initialized"),
      );
    }
    const requested = normalizedEmotion(emotion);
    const label = this.catalog.byLabel.has(requested)
      ? requested
      : this.catalog.manifest.default_expression;
    this.switchQueue = this.switchQueue
      .catch(() => {})
      .then(() => this.loadAndSwapExpression(label));
    return this.switchQueue;
  }

  async loadAndSwapExpression(label) {
    if (this.catalog === null) {
      throw new Error("spirit desktop runtime is not initialized");
    }
    const expression = selectRinneSpiritExpression(this.catalog, label);
    if (expression.label === this.currentExpression) return this.snapshot();
    const needsBaseSwap =
      expression.base_portrait_id !== this.currentBasePortraitId;
    const [loadedBase, overlay] = await Promise.all([
      needsBaseSwap
        ? validatedPortrait(
            await this.portraitBytes(expression.base_portrait_id),
            this.preverifiedAssetSource,
          )
        : null,
      this.approvedOverlay(expression.overlay_id),
    ]);
    let nextBaseRuntime = null;
    if (loadedBase !== null) {
      nextBaseRuntime = makeLayerRuntime(
        this.baseGl,
        loadedBase,
        this.width,
        this.height,
      );
    }
    const previousBaseRuntime = this.baseRuntime;
    try {
      if (nextBaseRuntime !== null) this.baseRuntime = nextBaseRuntime;
      this.applyExpressionLayers(expression, overlay);
      this.currentExpression = expression.label;
      this.currentBasePortraitId = expression.base_portrait_id;
      this.drawCurrentFrame(0);
      nextBaseRuntime = null;
      if (previousBaseRuntime !== this.baseRuntime) {
        disposeLayer(previousBaseRuntime);
      }
      return this.snapshot();
    } finally {
      disposeLayer(nextBaseRuntime);
    }
  }

  applyExpressionLayers(expression, overlay) {
    this.mouthGainScale = expression.mouth_gain_percent / 100;
    const mouthLayer = expression.mouth_layer;
    this.mouthLayerActive = mouthLayer !== null;
    if (mouthLayer === null) {
      this.mouthCanvas.style.display = "none";
      this.mouthCanvas.style.webkitMaskImage = "none";
      this.mouthCanvas.style.maskImage = "none";
    } else {
      const mask = mouthLayer.masks[0];
      const gradient = maskGradient(mask);
      const transform = mouthLayer.transform;
      this.mouthCanvas.style.display = "block";
      this.mouthCanvas.style.webkitMaskImage = gradient;
      this.mouthCanvas.style.maskImage = gradient;
      this.mouthCanvas.style.transformOrigin = `${transform.source_center[0] * 100}% ${transform.source_center[1] * 100}%`;
      this.mouthCanvas.style.transform =
        `translate(${(transform.target_center[0] - transform.source_center[0]) * 100}%, ${(transform.target_center[1] - transform.source_center[1]) * 100}%) ` +
        `rotate(${transform.rotation_degrees}deg) scale(${transform.scale})`;
    }
    this.drawOverlay(overlay);
  }

  drawOverlay(bitmap) {
    const context = this.overlayCanvas.getContext("2d", { alpha: true });
    if (!(context instanceof CanvasRenderingContext2D)) {
      throw new Error("spirit overlay canvas is unavailable");
    }
    context.clearRect(0, 0, this.width, this.height);
    if (bitmap === null) {
      this.overlayCanvas.style.display = "none";
      return;
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, this.width, this.height);
    this.overlayCanvas.style.display = "block";
  }

  setPointer(x, y) {
    const horizontal = Number(x);
    const vertical = Number(y);
    if (!Number.isFinite(horizontal) || !Number.isFinite(vertical)) {
      throw new TypeError("spirit pointer coordinates must be finite");
    }
    this.pointer[0] = clamp(horizontal, -0.35, 0.35);
    this.pointer[1] = clamp(vertical, -0.35, 0.35);
  }

  setMouthLevel(level) {
    const numeric = Number(level);
    if (!Number.isFinite(numeric)) {
      throw new TypeError("spirit mouth level must be finite");
    }
    this.speech = null;
    this.manualMouthTarget = clamp(numeric, 0, 1);
  }

  startSpeech(volumes, sliceLength, currentTimeMs) {
    if (typeof currentTimeMs !== "function") {
      throw new TypeError("spirit speech clock must be callable");
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

  liveMouthGains(deltaTime) {
    const target = this.resolveMouthTarget();
    const timeConstant = target > this.mouthLevel ? 42 : 76;
    const blend = 1 - Math.exp(-Math.max(0, deltaTime) / timeConstant);
    this.mouthLevel += (target - this.mouthLevel) * blend;
    return resolveRinneMouthGains(this.mouthLevel, this.mouthGainScale);
  }

  drawLayer(runtime, mouthGains) {
    const step = runtime.timeline.advance(
      Math.trunc(this.motionClock) >>> 0,
      liveControls(runtime.expressionCount, this.pointer, mouthGains),
    );
    if (step.finished) return false;
    const applied = stabilizeRinneDesktopStep(step, true);
    runtime.renderer.setDynamicCoefficients(applied.dynamicCoefficients);
    runtime.renderer.setEyeControls(applied.eyeControls);
    runtime.renderer.setRuntimeControls(applied.runtimeControls);
    runtime.renderer.draw();
    return true;
  }

  drawCurrentFrame(deltaTime) {
    if (this.baseRuntime === null || this.mouthRuntime === null) return;
    const mouthGains = this.liveMouthGains(deltaTime);
    const baseFinished = !this.drawLayer(this.baseRuntime, mouthGains);
    const mouthFinished = this.mouthLayerActive
      ? !this.drawLayer(this.mouthRuntime, mouthGains)
      : false;
    if (baseFinished || mouthFinished) {
      this.restartMotion(false);
    }
  }

  restartMotion(draw = true) {
    if (this.baseRuntime === null || this.mouthRuntime === null) {
      throw new Error("spirit desktop runtime is not initialized");
    }
    this.baseRuntime.timeline.reset({ startTime: 0, loop: true });
    this.mouthRuntime.timeline.reset({ startTime: 0, loop: true });
    this.motionClock = 0;
    this.lastAnimationTime = null;
    if (draw) this.drawCurrentFrame(0);
    return this.snapshot();
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
    if (this.failed) {
      throw new Error("failed spirit desktop runtime cannot restart");
    }
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

  fail(error) {
    if (this.failed) return;
    this.failed = true;
    this.stop();
    const failure = error instanceof Error ? error : new Error(String(error));
    this.onFatal(failure);
  }

  snapshot() {
    return Object.freeze({
      initialized: this.catalog !== null,
      running: this.running,
      failed: this.failed,
      expression: this.currentExpression,
      portraitId: this.currentBasePortraitId,
      width: this.width,
      height: this.height,
      renderer:
        this.baseGl === null
          ? null
          : this.baseGl.getParameter(this.baseGl.RENDERER) || "WebGL2",
    });
  }

  dispose() {
    this.stop();
    this.canvas.removeEventListener("webglcontextlost", this.boundContextLost);
    this.mouthCanvas.removeEventListener(
      "webglcontextlost",
      this.boundContextLost,
    );
    disposeLayer(this.baseRuntime);
    disposeLayer(this.mouthRuntime);
    this.baseRuntime = null;
    this.mouthRuntime = null;
    this.rawCache.clear();
    for (const bitmap of this.overlayCache.values()) bitmap.close();
    this.overlayCache.clear();
  }
}
