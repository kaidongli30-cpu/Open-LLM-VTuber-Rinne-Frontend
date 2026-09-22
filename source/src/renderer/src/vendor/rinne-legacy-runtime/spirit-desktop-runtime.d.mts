export interface RinneSpiritDressDesktopRuntimeOptions {
  canvas: HTMLCanvasElement;
  mouthCanvas: HTMLCanvasElement;
  overlayCanvas: HTMLCanvasElement;
  loadCatalog: () => Promise<{
    spiritExpressionManifestJson?: Uint8Array;
  }>;
  loadPortrait: (
    portraitId: number,
  ) => Promise<Record<string, number | Uint8Array>>;
  loadOverlay: (overlayId: string) => Promise<Uint8Array>;
  width?: number;
  height?: number;
  preverifiedAssetSource?: boolean;
  onFatal?: (error: Error) => void;
}

export interface RinneSpiritDressDesktopSnapshot {
  initialized: boolean;
  running: boolean;
  failed: boolean;
  expression: string | null;
  portraitId: number | null;
  width: number;
  height: number;
  renderer: string | null;
}

export class RinneSpiritDressDesktopRuntime {
  constructor(options: RinneSpiritDressDesktopRuntimeOptions);
  initialize(options?: {
    start?: boolean;
  }): Promise<RinneSpiritDressDesktopSnapshot>;
  selectEmotion(emotion: string): Promise<RinneSpiritDressDesktopSnapshot>;
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
  restartMotion(): RinneSpiritDressDesktopSnapshot;
  fail(error: unknown): void;
  snapshot(): RinneSpiritDressDesktopSnapshot;
  dispose(): void;
}
