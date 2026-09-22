/* eslint-disable func-names */
/* eslint-disable no-underscore-dangle */
/* eslint-disable @typescript-eslint/ban-ts-comment */
import { useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAiState } from '@/context/ai-state-context';
import { useSubtitle } from '@/context/subtitle-context';
import { useChatHistory } from '@/context/chat-history-context';
import { audioTaskQueue } from '@/utils/task-queue';
import { audioManager } from '@/utils/audio-manager';
import { toaster } from '@/components/ui/toaster';
import { useWebSocket } from '@/context/websocket-context';
import { DisplayText } from '@/services/websocket-service';
import { useLive2DExpression } from '@/hooks/canvas/use-live2d-expression';
import { useLive2DConfig } from '@/context/live2d-config-context';
import {
  getRinneLegacyRendererDriver,
  resolveRinneEmotionFromExpression,
} from '@/services/rinne-legacy-renderer-bridge';
import * as LAppDefine from '../../../WebSDK/src/lappdefine';

// Simple type alias for Live2D model
type Live2DModel = any;

interface AudioTaskOptions {
  audioBase64: string
  volumes: number[]
  sliceLength: number
  displayText?: DisplayText | null
  expressions?: string[] | number[] | null
  speaker_uid?: string
  forwarded?: boolean
}

/**
 * Custom hook for handling audio playback tasks with Live2D lip sync
 */
export const useAudioTask = () => {
  const { t } = useTranslation();
  const { aiState, backendSynthComplete, setBackendSynthComplete } = useAiState();
  const { setSubtitleText } = useSubtitle();
  const { appendResponse, appendAIMessage } = useChatHistory();
  const { sendMessage } = useWebSocket();
  const { setExpression } = useLive2DExpression();
  const { modelInfo } = useLive2DConfig();

  // State refs to avoid stale closures
  const stateRef = useRef({
    aiState,
    setSubtitleText,
    appendResponse,
    appendAIMessage,
  });

  // Note: currentAudioRef and currentModelRef are now managed by the global audioManager

  stateRef.current = {
    aiState,
    setSubtitleText,
    appendResponse,
    appendAIMessage,
  };

  /**
   * Stop current audio playback and lip sync (delegates to global audioManager)
   */
  const stopCurrentAudioAndLipSync = useCallback(() => {
    audioManager.stopCurrentAudioAndLipSync();
  }, []);

  /**
   * Handle audio playback with Live2D lip sync
   */
  const handleAudioPlayback = (options: AudioTaskOptions): Promise<void> => new Promise((resolve) => {
    const {
      aiState: currentAiState,
      setSubtitleText: updateSubtitle,
      appendResponse: appendText,
      appendAIMessage: appendAI,
    } = stateRef.current;

    // Skip if already interrupted
    if (currentAiState === 'interrupted') {
      console.warn('Audio playback blocked by interruption state.');
      resolve();
      return;
    }

    const {
      audioBase64, volumes, sliceLength, displayText, expressions, forwarded,
    } = options;

    let displayPublished = false;
    const publishDisplay = () => {
      if (!displayText || displayPublished) return;
      displayPublished = true;
      appendText(displayText.text);
      appendAI(displayText.text, displayText.name, displayText.avatar);
      // Silent semantic units (for example a final parenthesized action) are
      // still real display events and must not disappear from the subtitle.
      updateSubtitle(displayText.text);
      if (!forwarded) {
        sendMessage({
          type: "audio-play-start",
          display_text: displayText,
          forwarded: true,
        });
      }
    };

    try {
      const legacyDriver = getRinneLegacyRendererDriver();
      const expression = expressions?.[0];
      const applyExpression = async () => {
        if (expression === undefined) return;
        if (legacyDriver) {
          const emotion = resolveRinneEmotionFromExpression(
            expression,
            modelInfo?.emotionMap ?? {},
          );
          try {
            await legacyDriver.selectEmotion(emotion);
          } catch (error) {
            legacyDriver.fail(error);
          }
        } else {
          const lappAdapter = (window as any).getLAppAdapter?.();
          if (lappAdapter) {
            setExpression(
              expression,
              lappAdapter,
              `Set expression to: ${expression}`,
            );
          }
        }
      };
      // Begin portrait loading while the audio element buffers, but do not
      // publish the subtitle or start playback until the expression is ready.
      const expressionReady = applyExpression();

      // Process audio if available
      if (audioBase64) {
        const audioDataUrl = `data:audio/wav;base64,${audioBase64}`;

        let model: Live2DModel | null = null;
        if (!legacyDriver) {
          // Get Live2D manager and model
          const live2dManager = (window as any).getLive2DManager?.();
          if (!live2dManager) {
            console.error('Live2D manager not found');
            resolve();
            return;
          }

          model = live2dManager.getModel(0);
          if (!model) {
            console.error('Live2D model not found at index 0');
            resolve();
            return;
          }
          console.log('Found model for audio playback');

          if (!model._wavFileHandler) {
            console.warn('Model does not have _wavFileHandler for lip sync');
          } else {
            console.log('Model has _wavFileHandler available');
          }

          // Start talk motion
          if (LAppDefine && LAppDefine.PriorityNormal) {
            console.log("Starting random 'Talk' motion");
            model.startRandomMotion(
              "Talk",
              LAppDefine.PriorityNormal,
            );
          } else {
            console.warn("LAppDefine.PriorityNormal not found - cannot start talk motion");
          }
        }

        // Setup audio element
        const audio = new Audio(audioDataUrl);
        
        // Register with global audio manager IMMEDIATELY after creating audio
        audioManager.setCurrentAudio(
          audio,
          model,
          legacyDriver ? () => legacyDriver.stopSpeech() : null,
        );
        let isFinished = false;

        const cleanup = () => {
          audioManager.clearCurrentAudio(audio);
          if (!isFinished) {
            isFinished = true;
            resolve();
          }
        };

        // Enhance lip sync sensitivity
        const lipSyncScale = 2.0;

        audio.addEventListener('canplaythrough', async () => {
          try {
            await expressionReady;

            // Check for interruption after asynchronous expression loading.
            if (stateRef.current.aiState === 'interrupted' || !audioManager.hasCurrentAudio()) {
              console.warn('Audio playback cancelled due to interruption or audio was stopped');
              cleanup();
              return;
            }

            publishDisplay();
            console.log('Starting audio playback with lip sync');
            if (legacyDriver) {
              legacyDriver.startSpeech(audio, volumes, sliceLength);
            }
            audio.play().catch((err) => {
              console.error("Audio play error:", err);
              cleanup();
            });

            // Setup lip sync
            if (model?._wavFileHandler) {
              if (!model._wavFileHandler._initialized) {
                console.log('Applying enhanced lip sync');
                model._wavFileHandler._initialized = true;

                const originalUpdate = model._wavFileHandler.update.bind(model._wavFileHandler);
                model._wavFileHandler.update = function (deltaTimeSeconds: number) {
                  const result = originalUpdate(deltaTimeSeconds);
                  // @ts-ignore
                  this._lastRms = Math.min(2.0, this._lastRms * lipSyncScale);
                  return result;
                };
              }

              if (audioManager.hasCurrentAudio()) {
                model._wavFileHandler.start(audioDataUrl);
              } else {
                console.warn('WavFileHandler start skipped - audio was stopped');
              }
            }
          } catch (error) {
            console.error('Audio or expression start error:', error);
            cleanup();
          }
        }, { once: true });

        audio.addEventListener('ended', () => {
          console.log("Audio playback completed");
          cleanup();
        });

        audio.addEventListener('error', (error) => {
          console.error("Audio playback error:", error);
          cleanup();
        });

        audio.load();
      } else {
        void expressionReady
          .then(() => {
            if (stateRef.current.aiState !== 'interrupted') {
              publishDisplay();
            }
            resolve();
          })
          .catch((error) => {
            console.error('Silent expression update error:', error);
            resolve();
          });
      }
    } catch (error) {
      console.error('Audio playback setup error:', error);
      toaster.create({
        title: `${t('error.audioPlayback')}: ${error}`,
        type: "error",
        duration: 2000,
      });
      resolve();
    }
  });

  // Handle backend synthesis completion
  useEffect(() => {
    let isMounted = true;

    const handleComplete = async () => {
      await audioTaskQueue.waitForCompletion();
      if (isMounted && backendSynthComplete) {
        stopCurrentAudioAndLipSync();
        sendMessage({ type: "frontend-playback-complete" });
        setBackendSynthComplete(false);
      }
    };

    handleComplete();

    return () => {
      isMounted = false;
    };
  }, [backendSynthComplete, sendMessage, setBackendSynthComplete, stopCurrentAudioAndLipSync]);

  /**
   * Add a new audio task to the queue
   */
  const addAudioTask = async (options: AudioTaskOptions) => {
    const { aiState: currentState } = stateRef.current;

    if (currentState === 'interrupted') {
      console.log('Skipping audio task due to interrupted state');
      return;
    }

    console.log(`Adding audio task ${options.displayText?.text} to queue`);
    audioTaskQueue.addTask(() => handleAudioPlayback(options));
  };

  return {
    addAudioTask,
    appendResponse,
    stopCurrentAudioAndLipSync,
  };
};
