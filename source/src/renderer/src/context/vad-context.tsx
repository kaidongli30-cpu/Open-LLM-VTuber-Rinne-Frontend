/* eslint-disable no-use-before-define */
import {
  createContext,
  useContext,
  useRef,
  useCallback,
  useEffect,
  useReducer,
  useMemo,
} from "react";
import { useTranslation } from "react-i18next";
import { MicVAD } from "@ricky0123/vad-web";
import { useInterrupt } from "@/components/canvas/live2d";
import { audioTaskQueue } from "@/utils/task-queue";
import { useSendAudio } from "@/hooks/utils/use-send-audio";
import { SubtitleContext } from "./subtitle-context";
import { AiStateContext, AiState } from "./ai-state-context";
import { useLocalStorage } from "@/hooks/utils/use-local-storage";
import { toaster } from "@/components/ui/toaster";

/**
 * VAD settings configuration interface
 * @interface VADSettings
 */
export interface VADSettings {
  /** Threshold for positive speech detection (0-100) */
  positiveSpeechThreshold: number;

  /** Threshold for negative speech detection (0-100) */
  negativeSpeechThreshold: number;

  /** Number of frames for speech redemption */
  redemptionFrames: number;
}

/**
 * VAD context state interface
 * @interface VADState
 */
interface VADState {
  /** Auto stop mic feature state */
  autoStopMic: boolean;

  /** Microphone active state */
  micOn: boolean;

  /** Set microphone state */
  setMicOn: (value: boolean) => void;

  /** Set Auto stop mic state */
  setAutoStopMic: (value: boolean) => void;

  /** Start microphone and VAD */
  startMic: () => Promise<void>;

  /** Stop microphone and VAD */
  stopMic: () => void;

  /** Previous speech probability value */
  previousTriggeredProbability: number;

  /** Set previous speech probability */
  setPreviousTriggeredProbability: (value: number) => void;

  /** VAD settings configuration */
  settings: VADSettings;

  /** Update VAD settings */
  updateSettings: (newSettings: VADSettings) => void;

  /** Auto start microphone when AI starts speaking */
  autoStartMicOn: boolean;

  /** Set auto start microphone state */
  setAutoStartMicOn: (value: boolean) => void;

  /** Auto start microphone when conversation ends */
  autoStartMicOnConvEnd: boolean;

  /** Set auto start microphone when conversation ends state */
  setAutoStartMicOnConvEnd: (value: boolean) => void;

  /** Manual F8 input mode. When enabled, microphone input is accepted only during an F8 segment. */
  manualInputMode: boolean;

  /** Set manual F8 input mode */
  setManualInputMode: (value: boolean) => void;

  /** Whether a manual F8 segment is currently recording */
  manualCaptureActive: boolean;

  /** Whether the next segment has been queued while recognition is in progress */
  manualCaptureQueued: boolean;

  /** Toggle the manual F8 segment state */
  toggleManualCapture: () => Promise<void>;

  /** Handle a completed manual transcription from the backend */
  handleManualTranscription: (segmentId: string, text: string) => void;
}

/**
 * Default values and constants
 */
const DEFAULT_VAD_SETTINGS: VADSettings = {
  positiveSpeechThreshold: 50,
  negativeSpeechThreshold: 35,
  redemptionFrames: 35,
};

const DEFAULT_VAD_STATE = {
  micOn: false,
  autoStopMic: false,
  autoStartMicOn: false,
  autoStartMicOnConvEnd: false,
  manualInputMode: true,
};

/**
 * Create the VAD context
 */
export const VADContext = createContext<VADState | null>(null);

/**
 * VAD Provider Component
 * Manages voice activity detection and microphone state
 *
 * @param {Object} props - Provider props
 * @param {React.ReactNode} props.children - Child components
 */
export function VADProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  // Refs for VAD instance and state
  const vadRef = useRef<MicVAD | null>(null);
  const previousTriggeredProbabilityRef = useRef(0);
  const previousAiStateRef = useRef<AiState>("idle");

  // Persistent state management
  const [micOn, setMicOn] = useLocalStorage("micOn", DEFAULT_VAD_STATE.micOn);
  const micDesiredOnRef = useRef(micOn);
  const vadInitializationRef = useRef<Promise<void> | null>(null);
  const [autoStopMic, setAutoStopMicState] = useLocalStorage(
    "autoStopMic",
    DEFAULT_VAD_STATE.autoStopMic,
  );
  const autoStopMicRef = useRef(autoStopMic);
  const [manualInputMode, setManualInputModeState] = useLocalStorage(
    "manualInputMode",
    DEFAULT_VAD_STATE.manualInputMode,
  );
  const manualInputModeRef = useRef(manualInputMode);
  const [settings, setSettings] = useLocalStorage<VADSettings>(
    "vadSettings",
    DEFAULT_VAD_SETTINGS,
  );
  const [autoStartMicOn, setAutoStartMicOnState] = useLocalStorage(
    "autoStartMicOn",
    DEFAULT_VAD_STATE.autoStartMicOn,
  );
  const autoStartMicRef = useRef(autoStartMicOn);
  const [autoStartMicOnConvEnd, setAutoStartMicOnConvEndState] =
    useLocalStorage(
      "autoStartMicOnConvEnd",
      DEFAULT_VAD_STATE.autoStartMicOnConvEnd,
    );
  const autoStartMicOnConvEndRef = useRef(autoStartMicOnConvEnd);

  // Force update mechanism for ref updates
  const [, forceUpdate] = useReducer((x) => x + 1, 0);

  // External hooks and contexts
  const { interrupt } = useInterrupt();
  const {
    sendAudioPartition,
    sendManualAudioPartition,
    sendTextInput,
  } = useSendAudio();
  const { setSubtitleText } = useContext(SubtitleContext)!;
  const { aiState, setAiState } = useContext(AiStateContext)!;

  // Refs for callback stability
  const interruptRef = useRef(interrupt);
  const sendAudioPartitionRef = useRef(sendAudioPartition);
  const sendManualAudioPartitionRef = useRef(sendManualAudioPartition);
  const sendTextInputRef = useRef(sendTextInput);
  const aiStateRef = useRef<AiState>(aiState);
  const setSubtitleTextRef = useRef(setSubtitleText);
  const setAiStateRef = useRef(setAiState);

  const isProcessingRef = useRef(false);
  const manualCaptureActiveRef = useRef(false);
  const manualCaptureQueuedRef = useRef(false);
  const manualTranscriptionInFlightRef = useRef(false);
  const manualAudioBufferRef = useRef<Float32Array[]>([]);
  const manualSegmentIdRef = useRef<string | null>(null);
  const manualPendingTextRef = useRef<string[]>([]);
  const manualSessionPreviousStateRef = useRef<AiState | null>(null);
  const [manualStateVersion, forceManualUpdate] = useReducer((x) => x + 1, 0);

  // Update refs when dependencies change
  useEffect(() => {
    aiStateRef.current = aiState;
  }, [aiState]);

  useEffect(() => {
    interruptRef.current = interrupt;
  }, [interrupt]);

  useEffect(() => {
    sendAudioPartitionRef.current = sendAudioPartition;
  }, [sendAudioPartition]);

  useEffect(() => {
    sendManualAudioPartitionRef.current = sendManualAudioPartition;
  }, [sendManualAudioPartition]);

  useEffect(() => {
    sendTextInputRef.current = sendTextInput;
  }, [sendTextInput]);

  useEffect(() => {
    setSubtitleTextRef.current = setSubtitleText;
  }, [setSubtitleText]);

  useEffect(() => {
    setAiStateRef.current = setAiState;
  }, [setAiState]);

  useEffect(() => {
    autoStopMicRef.current = autoStopMic;
  }, [autoStopMic]);

  useEffect(() => {
    manualInputModeRef.current = manualInputMode;
  }, [manualInputMode]);

  useEffect(() => {
    autoStartMicRef.current = autoStartMicOn;
  }, [autoStartMicOn]);

  useEffect(() => {
    autoStartMicOnConvEndRef.current = autoStartMicOnConvEnd;
  }, [autoStartMicOnConvEnd]);

  /**
   * Update previous triggered probability and force re-render
   */
  const setPreviousTriggeredProbability = useCallback((value: number) => {
    previousTriggeredProbabilityRef.current = value;
    forceUpdate();
  }, []);

  const makeManualSegmentId = () => (
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  );

  const concatManualAudio = (frames: Float32Array[]) => {
    const totalLength = frames.reduce((total, frame) => total + frame.length, 0);
    const audio = new Float32Array(totalLength);
    let offset = 0;
    frames.forEach((frame) => {
      audio.set(frame, offset);
      offset += frame.length;
    });
    return audio;
  };

  /**
   * Handle speech start event (initial detection)
   */
  const handleSpeechStart = useCallback(() => {
    if (!micDesiredOnRef.current) return;
    if (manualInputModeRef.current && !manualCaptureActiveRef.current) return;

    console.log("Speech started - saving current state");
    // In manual mode the F8 boundary already captured the state that existed
    // before recording. Preserve it so speaking after F8 can still interrupt AI.
    if (!manualInputModeRef.current) {
      previousAiStateRef.current = aiStateRef.current;
    }
    isProcessingRef.current = true;
    // Don't change state here - wait for onSpeechRealStart
  }, []);

  /**
   * Handle real speech start event (confirmed speech)
   */
  const handleSpeechRealStart = useCallback(() => {
    if (!micDesiredOnRef.current) return;
    if (manualInputModeRef.current && !manualCaptureActiveRef.current) return;

    console.log("Real speech confirmed - checking if need to interrupt");
    // Check if we need to interrupt based on the PREVIOUS state (before speech started)
    if (previousAiStateRef.current === "thinking-speaking") {
      console.log("Interrupting AI speech due to user speaking");
      // Manual F8 capture sets the visible state to listening before speech is
      // confirmed, so explicitly bypass useInterrupt's state guard here.
      interruptRef.current(true, true);
      // Keep a queued continuation from sending the same interruption again.
      previousAiStateRef.current = "interrupted";
      manualSessionPreviousStateRef.current = "interrupted";
    }
    // Now change to listening state
    setAiStateRef.current("listening");
  }, []);

  /**
   * Handle frame processing event
   */
  const handleFrameProcessed = useCallback((
    probs: { isSpeech: number },
    frame: Float32Array,
  ) => {
    if (!micDesiredOnRef.current) return;

    if (manualInputModeRef.current) {
      if (manualCaptureActiveRef.current) {
        manualAudioBufferRef.current.push(frame.slice());
        if (probs.isSpeech > previousTriggeredProbabilityRef.current) {
          setPreviousTriggeredProbability(probs.isSpeech);
        }
      }
      return;
    }

    if (probs.isSpeech > previousTriggeredProbabilityRef.current) {
      setPreviousTriggeredProbability(probs.isSpeech);
    }
  }, []);

  /**
   * Handle speech end event
   */
  const handleSpeechEnd = useCallback((audio: Float32Array) => {
    if (!micDesiredOnRef.current || !isProcessingRef.current) return;
    if (manualInputModeRef.current) return;
    console.log("Speech ended");
    audioTaskQueue.clearQueue();

    if (autoStopMicRef.current) {
      stopMic();
    } else {
      console.log("Auto stop mic is OFF, keeping mic active");
    }

    setPreviousTriggeredProbability(0);
    sendAudioPartitionRef.current(audio);
    isProcessingRef.current = false;
    setAiStateRef.current("thinking-speaking");
  }, []);

  /**
   * Handle VAD misfire event
   */
  const handleVADMisfire = useCallback(() => {
    if (!micDesiredOnRef.current || !isProcessingRef.current) return;
    if (manualInputModeRef.current) return;
    console.log("VAD misfire detected");
    setPreviousTriggeredProbability(0);
    isProcessingRef.current = false;

    // Restore previous AI state and show helpful misfire message
    setAiStateRef.current(previousAiStateRef.current);
    setSubtitleTextRef.current(t("error.vadMisfire"));
  }, [t]);

  /**
   * Update VAD settings and restart if active
   */
  const updateSettings = useCallback((newSettings: VADSettings) => {
    setSettings(newSettings);
    if (vadRef.current) {
      stopMic();
      setTimeout(() => {
        startMic();
      }, 100);
    }
  }, []);

  /**
   * Initialize new VAD instance
   */
  const createVAD = () =>
    MicVAD.new({
      model: "v5",
      preSpeechPadFrames: 20,
      positiveSpeechThreshold: settings.positiveSpeechThreshold / 100,
      negativeSpeechThreshold: settings.negativeSpeechThreshold / 100,
      redemptionFrames: settings.redemptionFrames,
      baseAssetPath: "./libs/",
      onnxWASMBasePath: "./libs/",
      onSpeechStart: handleSpeechStart,
      onSpeechRealStart: handleSpeechRealStart,
      onFrameProcessed: handleFrameProcessed,
      onSpeechEnd: handleSpeechEnd,
      onVADMisfire: handleVADMisfire,
    });

  /**
   * Start microphone and VAD processing
   */
  const startMic = useCallback(async () => {
    micDesiredOnRef.current = true;
    setMicOn(true);

    if (vadRef.current) {
      console.log("Starting VAD");
      vadRef.current.start();
      return;
    }

    if (!vadInitializationRef.current) {
      console.log("Initializing VAD");

      const initialization = (async () => {
        try {
          const newVAD = await createVAD();

          // stopMic may have been called while getUserMedia/model loading was pending.
          if (!micDesiredOnRef.current) {
            newVAD.destroy();
            return;
          }

          // A single active instance is enough even when startMic was called twice.
          if (vadRef.current) {
            newVAD.destroy();
            vadRef.current.start();
            return;
          }

          vadRef.current = newVAD;
          newVAD.start();
        } catch (error) {
          if (micDesiredOnRef.current) {
            micDesiredOnRef.current = false;
            setMicOn(false);
            console.error("Failed to start VAD:", error);
            toaster.create({
              title: `${t("error.failedStartVAD")}: ${error}`,
              type: "error",
              duration: 2000,
            });
          }
        }
      })();

      vadInitializationRef.current = initialization;
      void initialization.finally(() => {
        if (vadInitializationRef.current === initialization) {
          vadInitializationRef.current = null;
        }
      });
    }

    await vadInitializationRef.current;
  }, [t]);

  const closeMic = useCallback(() => {
    console.log("Stopping microphone input");
    micDesiredOnRef.current = false;

    const activeVAD = vadRef.current;
    vadRef.current = null;

    if (activeVAD) {
      activeVAD.pause();
      activeVAD.destroy();
      console.log("Microphone input stopped successfully");
    }

    setPreviousTriggeredProbability(0);
    setMicOn(false);
    isProcessingRef.current = false;
    manualCaptureActiveRef.current = false;
    manualCaptureQueuedRef.current = false;
    manualAudioBufferRef.current = [];
    forceManualUpdate();

    if (aiStateRef.current === "listening") {
      setAiStateRef.current("idle");
    }
  }, [setPreviousTriggeredProbability]);

  const finishManualCapture = useCallback(async (closeMicAfter = false) => {
    if (!manualCaptureActiveRef.current) {
      if (closeMicAfter) closeMic();
      return;
    }

    manualCaptureActiveRef.current = false;
    isProcessingRef.current = false;
    const audio = concatManualAudio(manualAudioBufferRef.current);
    manualAudioBufferRef.current = [];
    setPreviousTriggeredProbability(0);
    vadRef.current?.pause();

    if (audio.length === 0) {
      manualSegmentIdRef.current = null;
      manualSessionPreviousStateRef.current = null;
      setAiStateRef.current("idle");
      forceManualUpdate();
      if (closeMicAfter) closeMic();
      return;
    }

    const segmentId = makeManualSegmentId();
    manualSegmentIdRef.current = segmentId;
    manualTranscriptionInFlightRef.current = true;
    setAiStateRef.current("recognizing");
    forceManualUpdate();

    try {
      await sendManualAudioPartitionRef.current(audio, segmentId);
    } finally {
      if (closeMicAfter) closeMic();
    }
  }, [closeMic, setPreviousTriggeredProbability]);

  const startManualCapture = useCallback(async () => {
    if (!manualInputModeRef.current) return;

    if (manualTranscriptionInFlightRef.current) {
      manualCaptureQueuedRef.current = true;
      forceManualUpdate();
      return;
    }

    if (!micDesiredOnRef.current) {
      await startMic();
      if (!micDesiredOnRef.current) return;
    }

    manualAudioBufferRef.current = [];
    manualSegmentIdRef.current = null;
    manualCaptureActiveRef.current = true;
    if (manualSessionPreviousStateRef.current === null) {
      manualSessionPreviousStateRef.current = aiStateRef.current;
    }
    previousAiStateRef.current = manualSessionPreviousStateRef.current;
    isProcessingRef.current = false;
    vadRef.current?.start();
    setPreviousTriggeredProbability(0);
    setAiStateRef.current("listening");
    forceManualUpdate();
  }, [setPreviousTriggeredProbability, startMic]);

  const finalizeManualText = useCallback(async (text: string) => {
    const trimmedText = text.trim();
    manualPendingTextRef.current = [];
    manualSessionPreviousStateRef.current = null;

    if (!trimmedText) {
      setAiStateRef.current("idle");
      return;
    }

    setAiStateRef.current("thinking-speaking");
    await sendTextInputRef.current(trimmedText);
  }, []);

  const handleManualTranscription = useCallback((segmentId: string, text: string) => {
    if (
      !manualTranscriptionInFlightRef.current
      || manualSegmentIdRef.current !== segmentId
    ) {
      return;
    }

    manualTranscriptionInFlightRef.current = false;
    manualSegmentIdRef.current = null;
    if (text.trim()) {
      manualPendingTextRef.current.push(text.trim());
    }

    const shouldContinue = manualCaptureQueuedRef.current;
    manualCaptureQueuedRef.current = false;
    forceManualUpdate();

    if (shouldContinue) {
      void startManualCapture();
      return;
    }

    const finalText = manualPendingTextRef.current.join("\n");
    void finalizeManualText(finalText);
  }, [finalizeManualText, startManualCapture]);

  const toggleManualCapture = useCallback(async () => {
    if (!manualInputModeRef.current) return;

    if (manualTranscriptionInFlightRef.current) {
      manualCaptureQueuedRef.current = true;
      forceManualUpdate();
      return;
    }

    if (manualCaptureActiveRef.current) {
      await finishManualCapture();
    } else {
      await startManualCapture();
    }
  }, [finishManualCapture, startManualCapture]);

  /**
   * Stop microphone and VAD processing
   */
  const stopMic = useCallback(() => {
    if (manualCaptureActiveRef.current) {
      void finishManualCapture(true);
      return;
    }
    closeMic();
  }, [closeMic, finishManualCapture]);

  useEffect(
    () => () => {
      micDesiredOnRef.current = false;

      const activeVAD = vadRef.current;
      vadRef.current = null;
      activeVAD?.pause();
      activeVAD?.destroy();
    },
    [],
  );

  /**
   * Set Auto stop mic state
   */
  const setAutoStopMic = useCallback((value: boolean) => {
    autoStopMicRef.current = value;
    setAutoStopMicState(value);
    forceUpdate();
  }, []);

  const setAutoStartMicOn = useCallback((value: boolean) => {
    autoStartMicRef.current = value;
    setAutoStartMicOnState(value);
    forceUpdate();
  }, []);

  const setAutoStartMicOnConvEnd = useCallback((value: boolean) => {
    autoStartMicOnConvEndRef.current = value;
    setAutoStartMicOnConvEndState(value);
    forceUpdate();
  }, []);

  const setManualInputMode = useCallback((value: boolean) => {
    if (manualCaptureActiveRef.current || manualTranscriptionInFlightRef.current) {
      return;
    }
    manualInputModeRef.current = value;
    setManualInputModeState(value);
    forceManualUpdate();
  }, []);

  // Memoized context value
  const contextValue = useMemo(
    () => ({
      autoStopMic: autoStopMicRef.current,
      micOn,
      setMicOn,
      setAutoStopMic,
      startMic,
      stopMic,
      previousTriggeredProbability: previousTriggeredProbabilityRef.current,
      setPreviousTriggeredProbability,
      settings,
      updateSettings,
      autoStartMicOn: autoStartMicRef.current,
      setAutoStartMicOn,
      autoStartMicOnConvEnd: autoStartMicOnConvEndRef.current,
      setAutoStartMicOnConvEnd,
      manualInputMode: manualInputModeRef.current,
      setManualInputMode,
      manualCaptureActive: manualCaptureActiveRef.current,
      manualCaptureQueued: manualCaptureQueuedRef.current,
      toggleManualCapture,
      handleManualTranscription,
    }),
    [
      micOn,
      startMic,
      stopMic,
      settings,
      updateSettings,
      setManualInputMode,
      toggleManualCapture,
      handleManualTranscription,
      manualStateVersion,
    ],
  );

  return (
    <VADContext.Provider value={contextValue}>{children}</VADContext.Provider>
  );
}

/**
 * Custom hook to use the VAD context
 * @throws {Error} If used outside of VADProvider
 */
export function useVAD() {
  const context = useContext(VADContext);

  if (!context) {
    throw new Error("useVAD must be used within a VADProvider");
  }

  return context;
}
