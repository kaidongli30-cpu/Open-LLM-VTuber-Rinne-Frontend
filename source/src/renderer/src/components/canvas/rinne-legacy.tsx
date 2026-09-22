import { useCallback, useEffect, useRef, useState } from "react";
import { useLive2DConfig } from "@/context/live2d-config-context";
import { useMode } from "@/context/mode-context";
import { useDraggable } from "@/hooks/electron/use-draggable";
import { useForceIgnoreMouse } from "@/hooks/utils/use-force-ignore-mouse";
import { registerRinneLegacyRendererDriver } from "@/services/rinne-legacy-renderer-bridge";
import { RinneLegacyDesktopRuntime } from "@/vendor/rinne-legacy-runtime/desktop-runtime.mjs";
import { RinneLegacyAcceptancePanel } from "@/components/canvas/rinne-legacy-acceptance";

interface RinneLegacyProps {
  canvasSize: number;
  defaultPortraitId: number;
  outfitDisplayName: string;
  offlineAcceptance: boolean;
  onFatal: (error: Error) => void;
}

const MIN_DISPLAY_SCALE = 0.25;
const MAX_DISPLAY_SCALE = 3;
const WHEEL_SCALE_STEP = 0.08;
// The union of all 15 first-outfit 2048px alpha bounds is
// x=527..1513 and y=256..2048. Keep a small safety margin while making the
// transparent canvas outside the portrait pass mouse input through.
const INTERACTION_CLIP_PATH = "inset(10% 24% 0 24%)";
const OFFLINE_SPEECH_VOLUMES = Float32Array.from([
  0, 0.18, 0.52, 0.9, 0.35, 0.7, 1, 0.42, 0.12, 0,
]);
const OFFLINE_SPEECH_SLICE_MS = 90;
const FORMAL_SHY_EMOTION = "shy";
// Keep the native mouth overlay inside the central mouth patch. The previous
// 7.2% x 4.8%
// ellipse reached MP60113's inner cheek blush and replaced it with the donor's
// paler skin. This tighter feathered mask preserves the original shy blush.
const NATIVE_MOUTH_OVERLAY_MASK =
  "radial-gradient(ellipse 5.7% 3% at 50% 34.4%, black 68%, transparent 100%)";
const CUSTOM_OUTFIT_FORMAT = "rinne-custom-outfit-layered-preview";
const CUSTOM_OUTFIT_NATIVE_HIDDEN_DRAW_TYPES = [
  3, 4, 8, 11, 15, 16, 22, 24, 25,
] as const;
const CUSTOM_OUTFIT_REAR_HAIR_DRAW_TYPES = [5, 12, 17] as const;

interface CustomOutfitManifest {
  preview_body_extension?: { width: number; height: number };
  format: string;
  version: number;
  display_name: string;
  composition: {
    native_hidden_draw_types?: number[];
    native_head_translation_pixels?: number[];
    body_translation_pixels?: number[];
    body_breath: {
      horizontal_motion_pixels: number;
      vertical_motion_pixels: number;
      scale_y_peak: number;
      transform_origin: number[];
    };
    mouth_gain_percent: {
      neutral: number;
      happy: number;
      default: number;
    };
  };
}

interface CustomOutfitPayload {
  bodyExtensionPng?: Uint8Array;
  manifest: CustomOutfitManifest;
  bodyPng: Uint8Array;
  nativeHeadMaskPng?: Uint8Array;
}

function checkedCustomOutfitPayload(
  value: unknown,
): CustomOutfitPayload | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") {
    throw new Error("custom outfit payload must be an object");
  }
  const payload = value as Partial<CustomOutfitPayload>;
  const manifest = payload.manifest;
  const breath = manifest?.composition?.body_breath;
  const mouth = manifest?.composition?.mouth_gain_percent;
  if (
    (payload.bodyExtensionPng !== undefined &&
      (!(payload.bodyExtensionPng instanceof Uint8Array) ||
        manifest?.preview_body_extension?.width !== 2048 ||
        !Number.isSafeInteger(manifest?.preview_body_extension?.height) ||
        (manifest?.preview_body_extension?.height ?? 0) <= 2048 ||
        (manifest?.preview_body_extension?.height ?? 0) > 2400)) ||
    !(payload.bodyPng instanceof Uint8Array) ||
    (payload.nativeHeadMaskPng !== undefined &&
      !(payload.nativeHeadMaskPng instanceof Uint8Array)) ||
    (payload.nativeHeadMaskPng === undefined &&
      manifest?.composition?.native_hidden_draw_types === undefined) ||
    manifest?.format !== CUSTOM_OUTFIT_FORMAT ||
    manifest.version !== 1 ||
    typeof manifest.display_name !== "string" ||
    manifest.display_name.length === 0 ||
    breath?.horizontal_motion_pixels !== 0 ||
    breath?.vertical_motion_pixels !== 1.5 ||
    breath?.scale_y_peak !== 1.0015 ||
    JSON.stringify(breath?.transform_origin) !== JSON.stringify([0.5, 0.82]) ||
    mouth?.neutral !== 68 ||
    mouth?.happy !== 68 ||
    mouth?.default !== 100 ||
    (manifest.composition.native_hidden_draw_types !== undefined &&
      JSON.stringify(manifest.composition.native_hidden_draw_types) !==
        JSON.stringify(CUSTOM_OUTFIT_NATIVE_HIDDEN_DRAW_TYPES)) ||
    (manifest.composition.native_head_translation_pixels !== undefined &&
      (!Array.isArray(manifest.composition.native_head_translation_pixels) ||
        manifest.composition.native_head_translation_pixels.length !== 2 ||
        manifest.composition.native_head_translation_pixels.some(
          (coordinate) =>
            !Number.isInteger(coordinate) || Math.abs(coordinate) > 16,
        ))) ||
    (manifest.composition.body_translation_pixels !== undefined &&
      (!Array.isArray(manifest.composition.body_translation_pixels) ||
        manifest.composition.body_translation_pixels.length !== 2 ||
        manifest.composition.body_translation_pixels.some(
          (coordinate) =>
            !Number.isInteger(coordinate) || Math.abs(coordinate) > 16,
        )))
  ) {
    throw new Error("custom outfit renderer configuration is invalid");
  }
  return payload as CustomOutfitPayload;
}

function loadImageElement(
  target: HTMLImageElement,
  source: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onLoad = () => {
      target.removeEventListener("error", onError);
      resolve();
    };
    const onError = () => {
      target.removeEventListener("load", onLoad);
      reject(new Error("custom outfit body image could not be decoded"));
    };
    target.addEventListener("load", onLoad, { once: true });
    target.addEventListener("error", onError, { once: true });
    target.src = source;
  });
}

async function configureCustomOutfitLayers(
  body: HTMLImageElement,
  canvas: HTMLCanvasElement,
  nativeHeadCanvases: HTMLCanvasElement[],
  value: unknown,
): Promise<{
  manifest: CustomOutfitManifest | null;
  dispose: () => void;
}> {
  const payload = checkedCustomOutfitPayload(value);
  if (payload === null) {
    body.style.display = "none";
    for (const target of nativeHeadCanvases) target.style.transform = "none";
    return { manifest: null, dispose: () => {} };
  }
  const bodyUrl = URL.createObjectURL(
    new Blob([payload.bodyExtensionPng ?? payload.bodyPng], {
      type: "image/png",
    }),
  );
  const headMaskUrl = payload.nativeHeadMaskPng
    ? URL.createObjectURL(
        new Blob([payload.nativeHeadMaskPng], { type: "image/png" }),
      )
    : null;
  try {
    await loadImageElement(body, bodyUrl);
    const expectedHeight = payload.bodyExtensionPng
      ? payload.manifest.preview_body_extension!.height
      : 2048;
    if (body.naturalWidth !== 2048 || body.naturalHeight !== expectedHeight) {
      throw new Error("custom outfit body must decode to 2048 x 2048");
    }
  } catch (error) {
    URL.revokeObjectURL(bodyUrl);
    if (headMaskUrl) URL.revokeObjectURL(headMaskUrl);
    throw error;
  }
  const origin = payload.manifest.composition.body_breath.transform_origin;
  body.style.display = "block";
  body.style.height = `${(body.naturalHeight / 2048) * 100}%`;
  body.style.transformOrigin = `${origin[0] * 100}% ${((origin[1] * 2048) / body.naturalHeight) * 100}%`;
  const semanticHead = Array.isArray(
    payload.manifest.composition.native_hidden_draw_types,
  );
  const [offsetX, offsetY] = payload.manifest.composition
    .native_head_translation_pixels ?? [0, 0];
  const nativeHeadTransform =
    offsetX === 0 && offsetY === 0
      ? "none"
      : `translate(${(offsetX * 100) / 2048}%, ${(offsetY * 100) / 2048}%)`;
  for (const target of nativeHeadCanvases) {
    target.style.transform = nativeHeadTransform;
  }
  canvas.style.webkitMaskImage = semanticHead
    ? "none"
    : `url("${headMaskUrl}")`;
  canvas.style.maskImage = semanticHead ? "none" : `url("${headMaskUrl}")`;
  canvas.style.webkitMaskSize = "100% 100%";
  canvas.style.maskSize = "100% 100%";
  canvas.style.webkitMaskRepeat = "no-repeat";
  canvas.style.maskRepeat = "no-repeat";
  return {
    manifest: payload.manifest,
    dispose: () => {
      body.style.display = "none";
      body.removeAttribute("src");
      body.style.transform = "none";
      body.style.height = "100%";
      canvas.style.webkitMaskImage = "none";
      canvas.style.maskImage = "none";
      for (const target of nativeHeadCanvases) target.style.transform = "none";
      URL.revokeObjectURL(bodyUrl);
      if (headMaskUrl) URL.revokeObjectURL(headMaskUrl);
    },
  };
}

function resolveCustomOutfitMouthGainScale(portraitId: number): number {
  const suffix = Number(portraitId) % 100;
  return suffix === 2 || suffix === 6 ? 0.68 : 1;
}

function applyCustomBodyBreath(
  body: HTMLImageElement,
  manifest: CustomOutfitManifest,
  gain: number,
): void {
  const bounded = Math.max(0, Math.min(1, Number(gain) || 0));
  const breath = manifest.composition.body_breath;
  const [offsetX, offsetY] = manifest.composition.body_translation_pixels ?? [
    0, 0,
  ];
  const horizontalPercent = (offsetX * 100) / 2048;
  const verticalPercent =
    ((offsetY - breath.vertical_motion_pixels * bounded) * 100) /
    body.naturalHeight;
  const scaleY = 1 + (breath.scale_y_peak - 1) * bounded;
  body.style.transform = `translate(${horizontalPercent}%, ${verticalPercent}%) scaleY(${scaleY})`;
}

function createSynchronizedMotionRandom(): () => number {
  let state = 0x6d2b79f5;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state & 0x7fff;
  };
}

function clearDragSnapshot(target: HTMLCanvasElement | null): void {
  if (!target) return;
  target.getContext("2d")?.clearRect(0, 0, target.width, target.height);
  target.style.transform = "none";
  target.style.webkitMaskImage = "none";
  target.style.maskImage = "none";
}

function copyCanvasForDrag(
  source: HTMLCanvasElement,
  target: HTMLCanvasElement,
): void {
  target.width = source.width;
  target.height = source.height;
  const context = target.getContext("2d", { alpha: true });
  if (!context) throw new Error("drag snapshot 2D context is unavailable");
  context.clearRect(0, 0, target.width, target.height);
  if (source.style.display === "none") return;
  context.drawImage(source, 0, 0, target.width, target.height);
  target.style.transform = source.style.transform;
  target.style.webkitMaskImage = source.style.webkitMaskImage;
  target.style.maskImage = source.style.maskImage;
  target.style.webkitMaskSize = source.style.webkitMaskSize;
  target.style.maskSize = source.style.maskSize;
  target.style.webkitMaskRepeat = source.style.webkitMaskRepeat;
  target.style.maskRepeat = source.style.maskRepeat;
  source.style.visibility = "hidden";
}

export function RinneLegacy({
  canvasSize,
  defaultPortraitId,
  outfitDisplayName,
  offlineAcceptance,
  onFatal,
}: RinneLegacyProps) {
  const portraitFamily = defaultPortraitId - (defaultPortraitId % 100);
  const formalShyMouthPortraitId = portraitFamily + 4;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rearHairCanvasRef = useRef<HTMLCanvasElement>(null);
  const rearHairDragSnapshotRef = useRef<HTMLCanvasElement>(null);
  const primaryDragSnapshotRef = useRef<HTMLCanvasElement>(null);
  const mouthDragSnapshotRef = useRef<HTMLCanvasElement>(null);
  const customBodyRef = useRef<HTMLImageElement>(null);
  const shySmileCanvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<RinneLegacyDesktopRuntime | null>(null);
  const shySmileRuntimeRef = useRef<RinneLegacyDesktopRuntime | null>(null);
  const nativeMouthOverlayActiveRef = useRef(false);
  const customOutfitActiveRef = useRef(false);
  const dragSnapshotActiveRef = useRef(false);
  const dragRuntimeStateRef = useRef({ primary: false, mouth: false });
  const selectEmotionRef = useRef<
    ((emotion: string) => Promise<number>) | null
  >(null);
  const scaleRef = useRef(1);
  const [displayScale, setDisplayScale] = useState(1);
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [bodyExtensionPercent, setBodyExtensionPercent] = useState(0);
  const [rearHairLayerActive, setRearHairLayerActive] = useState(false);
  const [nativeMouthOverlayActive, setNativeMouthOverlayActive] =
    useState(false);
  const { mode } = useMode();
  const { modelInfo } = useLive2DConfig();
  const { forceIgnoreMouse } = useForceIgnoreMouse();
  const endCustomOutfitDragSnapshot = useCallback(() => {
    if (!dragSnapshotActiveRef.current) return;
    for (const canvas of [
      rearHairCanvasRef.current,
      canvasRef.current,
      shySmileCanvasRef.current,
    ]) {
      if (canvas) canvas.style.visibility = "visible";
    }
    clearDragSnapshot(rearHairDragSnapshotRef.current);
    clearDragSnapshot(primaryDragSnapshotRef.current);
    clearDragSnapshot(mouthDragSnapshotRef.current);
    const resume = dragRuntimeStateRef.current;
    dragSnapshotActiveRef.current = false;
    if (resume.primary) runtimeRef.current?.start();
    if (resume.mouth && nativeMouthOverlayActiveRef.current) {
      shySmileRuntimeRef.current?.start();
    }
  }, []);
  const beginCustomOutfitDragSnapshot = useCallback(() => {
    if (!customOutfitActiveRef.current || dragSnapshotActiveRef.current) return;
    const primaryRuntime = runtimeRef.current;
    const mouthRuntime = shySmileRuntimeRef.current;
    const rearHairCanvas = rearHairCanvasRef.current;
    const primaryCanvas = canvasRef.current;
    const mouthCanvas = shySmileCanvasRef.current;
    const rearHairSnapshot = rearHairDragSnapshotRef.current;
    const primarySnapshot = primaryDragSnapshotRef.current;
    const mouthSnapshot = mouthDragSnapshotRef.current;
    if (
      !primaryRuntime ||
      !mouthRuntime ||
      !rearHairCanvas ||
      !primaryCanvas ||
      !mouthCanvas ||
      !rearHairSnapshot ||
      !primarySnapshot ||
      !mouthSnapshot
    ) {
      return;
    }
    const primaryWasRunning = primaryRuntime.snapshot().running;
    const mouthWasRunning = mouthRuntime.snapshot().running;
    dragRuntimeStateRef.current = {
      primary: primaryWasRunning,
      mouth: mouthWasRunning,
    };
    primaryRuntime.stop();
    mouthRuntime.stop();
    try {
      primaryRuntime.drawStillFrame();
      if (nativeMouthOverlayActiveRef.current) mouthRuntime.drawStillFrame();
      copyCanvasForDrag(rearHairCanvas, rearHairSnapshot);
      copyCanvasForDrag(primaryCanvas, primarySnapshot);
      copyCanvasForDrag(mouthCanvas, mouthSnapshot);
      dragSnapshotActiveRef.current = true;
    } catch (error) {
      for (const canvas of [rearHairCanvas, primaryCanvas, mouthCanvas]) {
        canvas.style.visibility = "visible";
      }
      clearDragSnapshot(rearHairSnapshot);
      clearDragSnapshot(primarySnapshot);
      clearDragSnapshot(mouthSnapshot);
      if (primaryWasRunning) primaryRuntime.start();
      if (mouthWasRunning && nativeMouthOverlayActiveRef.current) {
        mouthRuntime.start();
      }
      console.warn("Rinne drag snapshot could not be created", error);
    }
  }, []);
  const {
    elementRef,
    isDragging,
    handlePointerDown,
    handlePointerEnter,
    handlePointerLeave,
  } = useDraggable({
    componentId: "rinne-legacy-avatar",
    onDragStart: beginCustomOutfitDragSnapshot,
    onDragEnd: endCustomOutfitDragSnapshot,
  });
  const isPet = mode === "pet";

  useEffect(() => {
    const canvas = canvasRef.current;
    const rearHairCanvas = rearHairCanvasRef.current;
    const customBody = customBodyRef.current;
    const shySmileCanvas = shySmileCanvasRef.current;
    const api = window.api?.rinneLegacy;
    if (!canvas || !rearHairCanvas || !customBody || !shySmileCanvas || !api) {
      onFatal(new Error("Rinne legacy Electron bridge is unavailable"));
      return undefined;
    }
    let cancelled = false;
    let unregisterDriver = () => {};
    let emotionSwitchQueue: Promise<unknown> = Promise.resolve();
    let activeSpeech: {
      audio: HTMLAudioElement;
      volumes: number[];
      sliceLength: number;
    } | null = null;
    let runtime: RinneLegacyDesktopRuntime | null = null;
    let shySmileRuntime: RinneLegacyDesktopRuntime | null = null;
    let disposeCustomOutfit = () => {};

    const initialize = async () => {
      const configuredCustomOutfit = await configureCustomOutfitLayers(
        customBody,
        canvas,
        [rearHairCanvas, canvas, shySmileCanvas],
        await api.loadCustomOutfit(),
      );
      if (cancelled) {
        configuredCustomOutfit.dispose();
        return;
      }
      disposeCustomOutfit = configuredCustomOutfit.dispose;
      const customManifest = configuredCustomOutfit.manifest;
      const semanticLayeredOutfit = Array.isArray(
        customManifest?.composition.native_hidden_draw_types,
      );
      customOutfitActiveRef.current = customManifest !== null;
      setRearHairLayerActive(semanticLayeredOutfit);
      const frontHiddenDrawTypes = semanticLayeredOutfit
        ? [
            ...(customManifest?.composition.native_hidden_draw_types ?? []),
            ...CUSTOM_OUTFIT_REAR_HAIR_DRAW_TYPES,
          ]
        : [];
      setBodyExtensionPercent(
        customManifest ? ((customBody.naturalHeight - 2048) / 2048) * 100 : 0,
      );
      const primaryRuntime = new RinneLegacyDesktopRuntime({
        canvas,
        underlayCanvas: semanticLayeredOutfit ? rearHairCanvas : null,
        loadCatalog: api.loadCatalog,
        loadPortrait: api.loadPortrait,
        width: canvasSize,
        height: canvasSize,
        // The Electron main-process loader verifies every file against the
        // family manifest immediately before returning these exact bytes.
        preverifiedAssetSource: true,
        randomInt: createSynchronizedMotionRandom(),
        mouthGainScaleForPortrait:
          customManifest === null
            ? undefined
            : resolveCustomOutfitMouthGainScale,
        hiddenDrawTypes: frontHiddenDrawTypes,
        underlayVisibleDrawTypes: semanticLayeredOutfit
          ? [...CUSTOM_OUTFIT_REAR_HAIR_DRAW_TYPES]
          : [],
        onFrame: ({ breathGain }) => {
          if (customManifest !== null) {
            applyCustomBodyBreath(customBody, customManifest, breathGain);
          }
        },
        onFatal: (error) => {
          if (!cancelled) onFatal(error);
        },
      });
      const shyRuntime = new RinneLegacyDesktopRuntime({
        canvas: shySmileCanvas,
        loadCatalog: api.loadCatalog,
        loadPortrait: api.loadPortrait,
        width: canvasSize,
        height: canvasSize,
        preverifiedAssetSource: true,
        randomInt: createSynchronizedMotionRandom(),
        mouthGainScaleForPortrait:
          customManifest === null
            ? undefined
            : resolveCustomOutfitMouthGainScale,
        onFatal: (error) => {
          if (!cancelled) onFatal(error);
        },
      });
      runtime = primaryRuntime;
      shySmileRuntime = shyRuntime;
      runtimeRef.current = primaryRuntime;
      shySmileRuntimeRef.current = shyRuntime;
      await Promise.all([
        primaryRuntime.initialize({ start: false }),
        shyRuntime.initialize({ start: false }),
      ]);
      try {
        if (cancelled) return;
        primaryRuntime.start();
        if (semanticLayeredOutfit) {
          shyRuntime.start();
          nativeMouthOverlayActiveRef.current = true;
          setNativeMouthOverlayActive(true);
        }

        const selectFormalEmotion = (emotion: string): Promise<unknown> => {
          const normalizedEmotion = emotion.trim().toLowerCase();
          emotionSwitchQueue = emotionSwitchQueue
            .catch(() => {})
            .then(async () => {
              const snapshot = await primaryRuntime.selectEmotion(emotion);
              if (cancelled) return snapshot;
              if (snapshot.portraitId === null) {
                throw new Error("selected Rinne portrait is unavailable");
              }
              const shouldUseFormalShy =
                normalizedEmotion === FORMAL_SHY_EMOTION;
              const shouldShowMouthOverlay =
                semanticLayeredOutfit || shouldUseFormalShy;
              if (shouldShowMouthOverlay) {
                // Type 3 contains both the donor torso and the warm native
                // inner-mouth fill. The primary custom-outfit renderer must
                // hide it; this unfiltered runtime restores only the tightly
                // masked mouth patch. Non-shy portraits track the selected
                // portrait, while shy retains the accepted MP60104 mouth.
                await shyRuntime.selectPortrait(
                  shouldUseFormalShy
                    ? formalShyMouthPortraitId
                    : snapshot.portraitId,
                );
                if (!nativeMouthOverlayActiveRef.current) {
                  shyRuntime.restartMotion();
                  shyRuntime.start();
                  nativeMouthOverlayActiveRef.current = true;
                  setNativeMouthOverlayActive(true);
                }
                if (activeSpeech !== null) {
                  const { audio, volumes, sliceLength } = activeSpeech;
                  shyRuntime.startSpeech(
                    volumes,
                    sliceLength,
                    () => audio.currentTime * 1000,
                  );
                }
              } else if (nativeMouthOverlayActiveRef.current) {
                nativeMouthOverlayActiveRef.current = false;
                setNativeMouthOverlayActive(false);
                shyRuntime.stopSpeech();
                shyRuntime.stop();
                shyRuntime.restartMotion();
              }
              return snapshot;
            });
          return emotionSwitchQueue;
        };

        selectEmotionRef.current = async (emotion) => {
          const snapshot = (await selectFormalEmotion(emotion)) as {
            portraitId: number;
          };
          return snapshot.portraitId;
        };
        setRuntimeReady(true);
        unregisterDriver = registerRinneLegacyRendererDriver({
          selectEmotion: selectFormalEmotion,
          startSpeech: (audio, volumes, sliceLength) => {
            if (volumes.length === 0 || sliceLength <= 0) {
              activeSpeech = null;
              primaryRuntime.setMouthLevel(0);
              shyRuntime.setMouthLevel(0);
              return;
            }
            activeSpeech = { audio, volumes, sliceLength };
            primaryRuntime.startSpeech(
              volumes,
              sliceLength,
              () => audio.currentTime * 1000,
            );
            if (nativeMouthOverlayActiveRef.current) {
              shyRuntime.startSpeech(
                volumes,
                sliceLength,
                () => audio.currentTime * 1000,
              );
            }
          },
          stopSpeech: () => {
            activeSpeech = null;
            primaryRuntime.stopSpeech();
            shyRuntime.stopSpeech();
          },
          fail: (error) => primaryRuntime.fail(error),
        });
      } catch (error) {
        primaryRuntime.fail(error);
      }
    };
    void initialize().catch((error) => {
      if (runtime !== null) {
        runtime.fail(error);
      } else if (!cancelled) {
        onFatal(error instanceof Error ? error : new Error(String(error)));
      }
    });

    return () => {
      cancelled = true;
      unregisterDriver();
      selectEmotionRef.current = null;
      nativeMouthOverlayActiveRef.current = false;
      customOutfitActiveRef.current = false;
      endCustomOutfitDragSnapshot();
      shySmileRuntime?.dispose();
      runtime?.dispose();
      disposeCustomOutfit();
      runtimeRef.current = null;
      shySmileRuntimeRef.current = null;
    };
  }, [
    canvasSize,
    defaultPortraitId,
    formalShyMouthPortraitId,
    offlineAcceptance,
    onFatal,
    endCustomOutfitDragSnapshot,
  ]);

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    runtimeRef.current?.setPointer(
      ((event.clientX - bounds.left) / bounds.width - 0.5) * 0.7,
      (0.5 - (event.clientY - bounds.top) / bounds.height) * 0.7,
    );
    shySmileRuntimeRef.current?.setPointer(
      ((event.clientX - bounds.left) / bounds.width - 0.5) * 0.7,
      (0.5 - (event.clientY - bounds.top) / bounds.height) * 0.7,
    );
  };

  const handleContextMenu = (event: React.MouseEvent) => {
    if (!isPet) return;
    event.preventDefault();
    window.api?.showContextMenu?.();
  };

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      event.preventDefault();
      if (modelInfo?.scrollToResize === false || event.deltaY === 0) return;
      const direction = event.deltaY > 0 ? -1 : 1;
      const nextScale = Math.max(
        MIN_DISPLAY_SCALE,
        Math.min(
          MAX_DISPLAY_SCALE,
          scaleRef.current + WHEEL_SCALE_STEP * direction,
        ),
      );
      scaleRef.current = nextScale;
      setDisplayScale(nextScale);
    },
    [modelInfo?.scrollToResize],
  );

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return undefined;
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [elementRef, handleWheel]);

  const selectAcceptanceEmotion = useCallback(async (emotion: string) => {
    const selectEmotion = selectEmotionRef.current;
    if (!selectEmotion) throw new Error("Rinne desktop runtime is not ready");
    return selectEmotion(emotion);
  }, []);

  const setAcceptanceMouthLevel = useCallback((level: number) => {
    const runtime = runtimeRef.current;
    if (!runtime) throw new Error("Rinne desktop runtime is not ready");
    runtime.setMouthLevel(level);
    if (nativeMouthOverlayActiveRef.current) {
      shySmileRuntimeRef.current?.setMouthLevel(level);
    }
  }, []);

  const setAcceptanceSpeechDemo = useCallback((enabled: boolean) => {
    const runtime = runtimeRef.current;
    if (!runtime) throw new Error("Rinne desktop runtime is not ready");
    if (!enabled) {
      runtime.stopSpeech();
      shySmileRuntimeRef.current?.stopSpeech();
      return;
    }
    const startedAt = performance.now();
    const duration = OFFLINE_SPEECH_VOLUMES.length * OFFLINE_SPEECH_SLICE_MS;
    runtime.startSpeech(
      OFFLINE_SPEECH_VOLUMES,
      OFFLINE_SPEECH_SLICE_MS,
      () => (performance.now() - startedAt) % duration,
    );
    if (nativeMouthOverlayActiveRef.current) {
      shySmileRuntimeRef.current?.startSpeech(
        OFFLINE_SPEECH_VOLUMES,
        OFFLINE_SPEECH_SLICE_MS,
        () => (performance.now() - startedAt) % duration,
      );
    }
  }, []);

  return (
    <>
      <div
        ref={elementRef}
        data-testid="rinne-legacy-avatar"
        aria-label="Rinne legacy avatar"
        style={{
          position: "absolute",
          bottom: 0,
          left: "50%",
          height: "100%",
          maxWidth: "100%",
          aspectRatio: "1 / 1",
          transform: "translateX(-50%)",
          pointerEvents: "none",
          cursor: isDragging ? "grabbing" : "grab",
        }}
        onPointerDown={handlePointerDown}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={() => {
          runtimeRef.current?.setPointer(0, 0);
          shySmileRuntimeRef.current?.setPointer(0, 0);
          handlePointerLeave();
        }}
        onPointerMove={handlePointerMove}
        onContextMenu={handleContextMenu}
      >
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            transform: `translateY(-${bodyExtensionPercent}%) scale(${displayScale})`,
            transformOrigin: `50% ${100 + bodyExtensionPercent}%`,
            transition: "transform 120ms ease-out",
            clipPath: bodyExtensionPercent
              ? `inset(10% 24% -${bodyExtensionPercent + 0.2}% 24%)`
              : INTERACTION_CLIP_PATH,
            pointerEvents: isPet && forceIgnoreMouse ? "none" : "auto",
            cursor: isDragging ? "grabbing" : "grab",
          }}
        >
          <canvas
            ref={rearHairCanvasRef}
            width={canvasSize}
            height={canvasSize}
            aria-label="Rinne native rear hair under custom outfit"
            style={{
              position: "absolute",
              zIndex: 0,
              inset: 0,
              display: rearHairLayerActive ? "block" : "none",
              width: "100%",
              height: "100%",
              pointerEvents: "none",
            }}
          />
          <canvas
            ref={rearHairDragSnapshotRef}
            width={canvasSize}
            height={canvasSize}
            aria-hidden="true"
            style={{
              position: "absolute",
              zIndex: 0,
              inset: 0,
              width: "100%",
              height: "100%",
              pointerEvents: "none",
            }}
          />
          <img
            ref={customBodyRef}
            alt=""
            aria-hidden="true"
            draggable={false}
            style={{
              position: "absolute",
              zIndex: 1,
              inset: 0,
              display: "none",
              width: "100%",
              height: "100%",
              pointerEvents: "none",
            }}
          />
          <canvas
            ref={canvasRef}
            width={canvasSize}
            height={canvasSize}
            style={{
              position: "relative",
              zIndex: 2,
              display: "block",
              width: "100%",
              height: "100%",
            }}
          />
          <canvas
            ref={primaryDragSnapshotRef}
            width={canvasSize}
            height={canvasSize}
            aria-hidden="true"
            style={{
              position: "absolute",
              zIndex: 2,
              inset: 0,
              width: "100%",
              height: "100%",
              pointerEvents: "none",
            }}
          />
          <canvas
            ref={shySmileCanvasRef}
            width={canvasSize}
            height={canvasSize}
            aria-label="Rinne native mouth overlay"
            style={{
              position: "absolute",
              zIndex: 3,
              inset: 0,
              display: nativeMouthOverlayActive ? "block" : "none",
              width: "100%",
              height: "100%",
              pointerEvents: "none",
              WebkitMaskImage: NATIVE_MOUTH_OVERLAY_MASK,
              maskImage: NATIVE_MOUTH_OVERLAY_MASK,
            }}
          />
          <canvas
            ref={mouthDragSnapshotRef}
            width={canvasSize}
            height={canvasSize}
            aria-hidden="true"
            style={{
              position: "absolute",
              zIndex: 3,
              inset: 0,
              width: "100%",
              height: "100%",
              pointerEvents: "none",
            }}
          />
        </div>
      </div>
      {offlineAcceptance && (
        <RinneLegacyAcceptancePanel
          ready={runtimeReady}
          defaultPortraitId={defaultPortraitId}
          outfitDisplayName={outfitDisplayName}
          onSelectEmotion={selectAcceptanceEmotion}
          onSetMouthLevel={setAcceptanceMouthLevel}
          onSetSpeechDemo={setAcceptanceSpeechDemo}
        />
      )}
    </>
  );
}
