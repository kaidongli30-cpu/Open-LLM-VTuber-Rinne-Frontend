import { IpcRenderer } from "electron";

declare global {
  interface Window {
    // Define the structure of the API exposed by your preload script
    electron?: {
      ipcRenderer: IpcRenderer;
      process: {
        platform: string;
      };
      // Add other methods or properties exposed by preload script if any
    };
    // Add other custom window properties if needed
    api?: {
      setIgnoreMouseEvents: (ignore: boolean) => void;
      showContextMenu?: () => void;
      onModeChanged: (callback: (mode: string) => void) => void;
      updateComponentHover?: (componentId: string, isHovering: boolean) => void;
      rinneLegacy: {
        getStatus: () => Promise<{
          available: boolean;
          reason: "ready" | "not_enabled" | "not_configured" | "invalid_bundle";
          defaultPortraitId?: number;
          outfitDisplayName?: string;
          runtimeKind?: "outfit" | "spirit";
          portraitCount?: number;
          canvasSize?: number;
          offlineAcceptance?: boolean;
          error?: string;
        }>;
        loadCatalog: () => Promise<{
          outfitManifestJson?: Uint8Array;
          firstOutfitManifestJson?: Uint8Array;
          spiritExpressionManifestJson?: Uint8Array;
        }>;
        loadPortrait: (
          portraitId: number,
        ) => Promise<Record<string, number | Uint8Array>>;
        loadOverlay: (overlayId: string) => Promise<Uint8Array>;
        loadCustomOutfit: () => Promise<unknown>;
        refresh: (emotion?: string) => Promise<{
          available: boolean;
          reason: "ready" | "not_enabled" | "not_configured" | "invalid_bundle";
          defaultPortraitId?: number;
          outfitDisplayName?: string;
          runtimeKind?: "outfit" | "spirit";
          portraitCount?: number;
          canvasSize?: number;
          offlineAcceptance?: boolean;
          error?: string;
        }>;
      };
    };
  }
}

// Export {} is needed to make this a module
export {};
