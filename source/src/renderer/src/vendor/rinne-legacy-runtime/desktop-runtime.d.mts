export interface RinneLegacyDesktopRuntimeOptions {
  canvas: HTMLCanvasElement;
  underlayCanvas?: HTMLCanvasElement | null;
  loadCatalog: () => Promise<{
    outfitManifestJson?: Uint8Array;
    firstOutfitManifestJson?: Uint8Array;
  }>;
  loadPortrait: (
    portraitId: number,
  ) => Promise<Record<string, number | Uint8Array>>;
  width?: number;
  height?: number;
  preverifiedAssetSource?: boolean;
  randomInt?: () => number;
  mouthGainScaleForPortrait?: (portraitId: number) => number;
  hiddenDrawTypes?: number[];
  underlayVisibleDrawTypes?: number[];
  onFrame?: (frame: RinneLegacyDesktopFrame) => void;
  onFatal?: (error: Error) => void;
}

export interface RinneLegacyDesktopFrame {
  portraitId: number;
  breathGain: number;
}

export interface RinneLegacyDesktopSnapshot {
  initialized: boolean;
  running: boolean;
  failed: boolean;
  portraitId: number | null;
  width: number;
  height: number;
  renderer: string | null;
  underlayActive: boolean;
}

export class RinneLegacyDesktopRuntime {
  constructor(options: RinneLegacyDesktopRuntimeOptions);
  initialize(options?: {
    start?: boolean;
  }): Promise<RinneLegacyDesktopSnapshot>;
  selectPortrait(portraitId: number): Promise<RinneLegacyDesktopSnapshot>;
  selectEmotion(emotion: string): Promise<RinneLegacyDesktopSnapshot>;
  setPointer(x: number, y: number): void;
  setMouthLevel(level: number): void;
  startSpeech(
    volumes: number[] | Float32Array,
    sliceLength: number,
    currentTimeMs: () => number,
  ): void;
  stopSpeech(): void;
  start(): void;
  stop(): void;
  drawStillFrame(): RinneLegacyDesktopSnapshot;
  restartMotion(): void;
  fail(error: unknown): void;
  snapshot(): RinneLegacyDesktopSnapshot;
  dispose(): void;
}

export function resolveRinnePortraitIdByEmotion(
  outfit: unknown,
  emotion: string,
): number;
export function resolveRinneDesktopMouthGainScale(portraitId: number): number;
export const RINNE_DESKTOP_MOUTH_GAIN_SCALE: number;
export const RINNE_DESKTOP_REDUCED_MOUTH_PORTRAIT_IDS: readonly number[];
export function resolveRinneMouthGains(
  level: number,
  gainScale?: number,
): Float32Array;
export function sampleRinneSpeechVolume(
  volumes: number[] | Float32Array,
  sliceLength: number,
  currentTimeMs: number,
): number;
