import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { toaster } from '@/components/ui/toaster';
import { wsService, type MessageEvent } from '@/services/websocket-service';
import { useAiState } from '@/context/ai-state-context';
import { audioTaskQueue } from '@/utils/task-queue';
import { getLastSelectedRinneEmotion } from '@/services/rinne-legacy-renderer-bridge';

export interface RinneOutfitProfile {
  profile_id: string;
  menu_label: string;
  group: 'game' | 'custom';
  asset_kind: 'outfit' | 'spirit' | 'custom_outfit';
}

interface SwitchRequest {
  targetProfileId: string;
  previousProfileId: string | null;
  rollback: boolean;
}

interface RinneOutfitContextValue {
  available: boolean;
  profiles: RinneOutfitProfile[];
  currentProfileId: string | null;
  pendingProfileId: string | null;
  isSwitching: boolean;
  rendererRevision: number;
  refreshCatalog: () => void;
  requestSwitch: (profileId: string) => void;
}

const RinneOutfitContext = createContext<RinneOutfitContextValue | null>(null);

export function RinneOutfitProvider({ children }: { children: React.ReactNode }) {
  const { aiState, backendSynthComplete } = useAiState();
  const [available, setAvailable] = useState(false);
  const [profiles, setProfiles] = useState<RinneOutfitProfile[]>([]);
  const [currentProfileId, setCurrentProfileId] = useState<string | null>(null);
  const [pendingProfileId, setPendingProfileId] = useState<string | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);
  const [rendererRevision, setRendererRevision] = useState(0);
  const currentProfileRef = useRef<string | null>(null);
  const activeRequestRef = useRef<SwitchRequest | null>(null);

  useEffect(() => {
    currentProfileRef.current = currentProfileId;
  }, [currentProfileId]);

  const refreshCatalog = useCallback(() => {
    wsService.sendMessage({ type: 'fetch-rinne-outfits' });
  }, []);

  const beginSwitch = useCallback((targetProfileId: string) => {
    if (!targetProfileId || activeRequestRef.current) return;
    activeRequestRef.current = {
      targetProfileId,
      previousProfileId: currentProfileRef.current,
      rollback: false,
    };
    setIsSwitching(true);
    wsService.sendMessage({
      type: 'switch-rinne-outfit',
      profile_id: targetProfileId,
    });
  }, []);

  const requestSwitch = useCallback((profileId: string) => {
    if (!available || isSwitching || profileId === currentProfileRef.current) return;
    const busy = aiState !== 'idle' || backendSynthComplete || audioTaskQueue.hasTask();
    if (busy) {
      setPendingProfileId(profileId);
      toaster.create({
        title: '已记下这套衣服，凛祢说完后自动更换',
        type: 'info',
        duration: 2200,
      });
      return;
    }
    beginSwitch(profileId);
  }, [aiState, available, backendSynthComplete, beginSwitch, isSwitching]);

  useEffect(() => {
    if (!pendingProfileId || isSwitching) return undefined;
    const tryQueuedSwitch = () => {
      if (aiState !== 'idle' || backendSynthComplete || audioTaskQueue.hasTask()) return;
      const target = pendingProfileId;
      setPendingProfileId(null);
      beginSwitch(target);
    };
    tryQueuedSwitch();
    const timer = window.setInterval(tryQueuedSwitch, 100);
    return () => window.clearInterval(timer);
  }, [aiState, backendSynthComplete, beginSwitch, isSwitching, pendingProfileId]);

  useEffect(() => {
    const handleMessage = async (message: MessageEvent) => {
      if (message.type === 'rinne-outfit-catalog') {
        setAvailable(message.available === true);
        setProfiles(Array.isArray(message.profiles) ? message.profiles : []);
        setCurrentProfileId(message.current_profile_id ?? null);
        return;
      }
      if (message.type !== 'rinne-outfit-switch-result') return;

      const request = activeRequestRef.current;
      if (!request || message.profile_id !== request.targetProfileId) return;
      if (!message.success) {
        activeRequestRef.current = null;
        setIsSwitching(false);
        toaster.create({
          title: message.error || '换装失败，仍保留原来的衣服',
          type: 'error',
          duration: 3500,
        });
        return;
      }

      try {
        const status = await window.api?.rinneLegacy.refresh(
          getLastSelectedRinneEmotion() ?? undefined,
        );
        if (!status?.available) {
          throw new Error(status?.error || '新服装资源未通过加载检查');
        }
        setCurrentProfileId(request.targetProfileId);
        setRendererRevision((revision) => revision + 1);
        activeRequestRef.current = null;
        setIsSwitching(false);
        if (!request.rollback) {
          toaster.create({
            title: '凛祢已经换好衣服了',
            type: 'success',
            duration: 2000,
          });
        }
      } catch (error) {
        if (!request.rollback && request.previousProfileId) {
          toaster.create({
            title: `新服装加载失败，正在恢复原服装：${String(error)}`,
            type: 'error',
            duration: 4000,
          });
          activeRequestRef.current = {
            targetProfileId: request.previousProfileId,
            previousProfileId: request.previousProfileId,
            rollback: true,
          };
          wsService.sendMessage({
            type: 'switch-rinne-outfit',
            profile_id: request.previousProfileId,
          });
        } else {
          activeRequestRef.current = null;
          setIsSwitching(false);
          toaster.create({
            title: `恢复原服装失败：${String(error)}`,
            type: 'error',
            duration: 4000,
          });
        }
      }
    };

    const messageSubscription = wsService.onMessage((message) => {
      void handleMessage(message);
    });
    const stateSubscription = wsService.onStateChange((state) => {
      if (state === 'OPEN') refreshCatalog();
    });
    if (wsService.getCurrentState() === 'OPEN') refreshCatalog();
    return () => {
      messageSubscription.unsubscribe();
      stateSubscription.unsubscribe();
    };
  }, [refreshCatalog]);

  const value = useMemo(() => ({
    available,
    profiles,
    currentProfileId,
    pendingProfileId,
    isSwitching,
    rendererRevision,
    refreshCatalog,
    requestSwitch,
  }), [
    available,
    profiles,
    currentProfileId,
    pendingProfileId,
    isSwitching,
    rendererRevision,
    refreshCatalog,
    requestSwitch,
  ]);

  return (
    <RinneOutfitContext.Provider value={value}>
      {children}
    </RinneOutfitContext.Provider>
  );
}

export function useRinneOutfits() {
  const context = useContext(RinneOutfitContext);
  if (!context) {
    throw new Error('useRinneOutfits must be used within RinneOutfitProvider');
  }
  return context;
}
