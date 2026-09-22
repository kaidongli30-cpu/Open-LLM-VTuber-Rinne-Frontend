import { useCallback, useEffect, useRef, useState } from "react";
import { useLive2DConfig } from "@/context/live2d-config-context";
import { useMode } from "@/context/mode-context";
import { useDraggable } from "@/hooks/electron/use-draggable";
import { useForceIgnoreMouse } from "@/hooks/utils/use-force-ignore-mouse";
import { registerRinneLegacyRendererDriver } from "@/services/rinne-legacy-renderer-bridge";
import { RinneSpiritDressDesktopRuntime } from "@/vendor/rinne-legacy-runtime/spirit-desktop-runtime.mjs";

interface RinneSpiritDressProps {
  canvasSize: number;
  outfitDisplayName: string;
  onFatal: (error: Error) => void;
}

const MIN_DISPLAY_SCALE = 0.25;
const MAX_DISPLAY_SCALE = 3;
const WHEEL_SCALE_STEP = 0.08;
// The accepted 2048 render starts at y=709 (34.6% of the square canvas).
// Keep roughly 2.5% of vertical motion headroom while letting the otherwise
// empty upper third pass desktop clicks through to applications underneath.
const INTERACTION_CLIP_PATH = "inset(32% 8% 0 8%)";

export function RinneSpiritDress({
  canvasSize,
  outfitDisplayName,
  onFatal,
}: RinneSpiritDressProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const mouthCanvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<RinneSpiritDressDesktopRuntime | null>(null);
  const scaleRef = useRef(1);
  const [displayScale, setDisplayScale] = useState(1);
  const { mode } = useMode();
  const { modelInfo } = useLive2DConfig();
  const { forceIgnoreMouse } = useForceIgnoreMouse();
  const {
    elementRef,
    isDragging,
    handlePointerDown,
    handlePointerEnter,
    handlePointerLeave,
  } = useDraggable({ componentId: "rinne-spirit-dress-avatar" });
  const isPet = mode === "pet";

  useEffect(() => {
    const canvas = canvasRef.current;
    const mouthCanvas = mouthCanvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    const api = window.api?.rinneLegacy;
    if (!canvas || !mouthCanvas || !overlayCanvas || !api) {
      onFatal(new Error("Rinne spirit Electron bridge is unavailable"));
      return undefined;
    }
    let cancelled = false;
    let unregisterDriver = () => {};
    const runtime = new RinneSpiritDressDesktopRuntime({
      canvas,
      mouthCanvas,
      overlayCanvas,
      loadCatalog: api.loadCatalog,
      loadPortrait: api.loadPortrait,
      loadOverlay: api.loadOverlay,
      width: canvasSize,
      height: canvasSize,
      // The main process verifies all 7 portrait bundles and 3 accepted
      // overlays against the approved manifest before returning their bytes.
      preverifiedAssetSource: true,
      onFatal: (error) => {
        if (!cancelled) onFatal(error);
      },
    });
    runtimeRef.current = runtime;
    void runtime
      .initialize()
      .then(() => {
        if (cancelled) return;
        unregisterDriver = registerRinneLegacyRendererDriver({
          selectEmotion: (emotion) => runtime.selectEmotion(emotion),
          startSpeech: (audio, volumes, sliceLength) => {
            if (volumes.length === 0 || sliceLength <= 0) {
              runtime.setMouthLevel(0);
              return;
            }
            runtime.startSpeech(
              volumes,
              sliceLength,
              () => audio.currentTime * 1000,
            );
          },
          stopSpeech: () => runtime.stopSpeech(),
          fail: (error) => runtime.fail(error),
        });
      })
      .catch((error) => runtime.fail(error));

    return () => {
      cancelled = true;
      unregisterDriver();
      runtime.dispose();
      runtimeRef.current = null;
    };
  }, [canvasSize, onFatal]);

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    runtimeRef.current?.setPointer(
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

  return (
    <div
      ref={elementRef}
      data-testid="rinne-spirit-dress-avatar"
      aria-label={outfitDisplayName}
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
          transform: `scale(${displayScale})`,
          transformOrigin: "50% 100%",
          transition: "transform 120ms ease-out",
          clipPath: INTERACTION_CLIP_PATH,
          pointerEvents: isPet && forceIgnoreMouse ? "none" : "auto",
          cursor: isDragging ? "grabbing" : "grab",
        }}
      >
        <canvas
          ref={canvasRef}
          width={canvasSize}
          height={canvasSize}
          style={{ display: "block", width: "100%", height: "100%" }}
        />
        <canvas
          ref={overlayCanvasRef}
          width={canvasSize}
          height={canvasSize}
          aria-label="Rinne spirit approved expression overlay"
          style={{
            position: "absolute",
            inset: 0,
            display: "none",
            width: "100%",
            height: "100%",
            pointerEvents: "none",
          }}
        />
        <canvas
          ref={mouthCanvasRef}
          width={canvasSize}
          height={canvasSize}
          aria-label="Rinne spirit approved mouth override"
          style={{
            position: "absolute",
            inset: 0,
            display: "none",
            width: "100%",
            height: "100%",
            pointerEvents: "none",
          }}
        />
      </div>
    </div>
  );
}
