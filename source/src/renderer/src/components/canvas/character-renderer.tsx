import { useCallback, useEffect, useState } from "react";
import { Live2D } from "@/components/canvas/live2d";
import { RinneLegacy } from "@/components/canvas/rinne-legacy";
import { RinneSpiritDress } from "@/components/canvas/rinne-spirit-dress";
import { useIpcHandlers } from "@/hooks/utils/use-ipc-handlers";
import { useInterrupt } from "@/hooks/utils/use-interrupt";
import { useAudioTask } from "@/hooks/utils/use-audio-task";
import { useRinneOutfits } from "@/context/rinne-outfit-context";

interface CharacterRendererProps {
  showSidebar?: boolean;
}

type RendererState =
  | { mode: "checking" }
  | { mode: "live2d"; reason: string }
  | {
      mode: "rinne";
      canvasSize: number;
      defaultPortraitId: number;
      outfitDisplayName: string;
      offlineAcceptance: boolean;
    }
  | {
      mode: "rinne-spirit";
      canvasSize: number;
      outfitDisplayName: string;
    };

export function CharacterRenderer({ showSidebar }: CharacterRendererProps) {
  const [renderer, setRenderer] = useState<RendererState>({ mode: "checking" });
  const { rendererRevision } = useRinneOutfits();

  useIpcHandlers();
  useInterrupt();
  useAudioTask();

  useEffect(() => {
    let cancelled = false;
    const api = window.api?.rinneLegacy;
    if (!api) {
      setRenderer({ mode: "live2d", reason: "Electron bridge unavailable" });
      return undefined;
    }
    void api
      .getStatus()
      .then((status) => {
        if (cancelled) return;
        if (status.available) {
          if (status.runtimeKind === "spirit") {
            setRenderer({
              mode: "rinne-spirit",
              canvasSize: status.canvasSize ?? 2048,
              outfitDisplayName:
                status.outfitDisplayName ?? "游戏原画：灵装凛祢",
            });
            return;
          }
          setRenderer({
            mode: "rinne",
            canvasSize: status.canvasSize ?? 2048,
            defaultPortraitId: status.defaultPortraitId ?? 60102,
            outfitDisplayName: status.outfitDisplayName ?? "游戏原画：夏季校服",
            offlineAcceptance: status.offlineAcceptance === true,
          });
        } else {
          setRenderer({ mode: "live2d", reason: status.reason });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setRenderer({ mode: "live2d", reason: String(error) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [rendererRevision]);

  const fallbackToLive2D = useCallback((error: Error) => {
    console.error("Rinne legacy renderer failed; restoring Live2D:", error);
    setRenderer({ mode: "live2d", reason: error.message });
  }, []);

  if (renderer.mode === "checking") return null;
  if (renderer.mode === "live2d") {
    return <Live2D showSidebar={showSidebar} />;
  }
  if (renderer.mode === "rinne-spirit") {
    return (
      <RinneSpiritDress
        key={`rinne-spirit-${rendererRevision}`}
        canvasSize={renderer.canvasSize}
        outfitDisplayName={renderer.outfitDisplayName}
        onFatal={fallbackToLive2D}
      />
    );
  }
  return (
    <RinneLegacy
      key={`rinne-${rendererRevision}`}
      canvasSize={renderer.canvasSize}
      defaultPortraitId={renderer.defaultPortraitId}
      outfitDisplayName={renderer.outfitDisplayName}
      offlineAcceptance={renderer.offlineAcceptance}
      onFatal={fallbackToLive2D}
    />
  );
}
