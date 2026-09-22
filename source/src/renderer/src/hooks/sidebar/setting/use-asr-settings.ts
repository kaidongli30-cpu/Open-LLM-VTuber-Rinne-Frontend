import React, { useRef, useState, useEffect } from 'react';
import { useVAD, VADSettings } from '@/context/vad-context';

export const useASRSettings = () => {
  const {
    settings,
    updateSettings,
    autoStopMic,
    setAutoStopMic,
    autoStartMicOn,
    setAutoStartMicOn,
    autoStartMicOnConvEnd,
    setAutoStartMicOnConvEnd,
    manualInputMode,
    setManualInputMode,
  } = useVAD();

  const localSettingsRef = useRef<VADSettings>(settings);
  const originalSettingsRef = useRef(settings);
  const originalAutoStopMicRef = useRef(autoStopMic);
  const originalAutoStartMicOnRef = useRef(autoStartMicOn);
  const originalAutoStartMicOnConvEndRef = useRef(autoStartMicOnConvEnd);
  const originalManualInputModeRef = useRef(manualInputMode);
  const [localVoiceInterruption, setLocalVoiceInterruption] = useState(autoStopMic);
  const [localAutoStartMic, setLocalAutoStartMic] = useState(autoStartMicOn);
  const [localAutoStartMicOnConvEnd, setLocalAutoStartMicOnConvEnd] = useState(autoStartMicOnConvEnd);
  const [localManualInputMode, setLocalManualInputMode] = useState(manualInputMode);
  const [, forceUpdate] = React.useReducer((x) => x + 1, 0);

  useEffect(() => {
    setLocalVoiceInterruption(autoStopMic);
    setLocalAutoStartMic(autoStartMicOn);
    setLocalAutoStartMicOnConvEnd(autoStartMicOnConvEnd);
    setLocalManualInputMode(manualInputMode);
  }, [autoStopMic, autoStartMicOn, autoStartMicOnConvEnd, manualInputMode]);

  const handleInputChange = (key: keyof VADSettings, value: number | string): void => {
    if (value === '' || value === '-') {
      localSettingsRef.current = { ...localSettingsRef.current, [key]: value };
    } else {
      const parsed = Number(value);
      // eslint-disable-next-line no-restricted-globals
      if (!isNaN(parsed)) {
        localSettingsRef.current = { ...localSettingsRef.current, [key]: parsed };
      }
    }
    forceUpdate();
  };

  const handleVoiceInterruptionChange = (value: boolean) => {
    setLocalVoiceInterruption(value);
    setAutoStopMic(value);
  };

  const handleAutoStartMicChange = (value: boolean) => {
    setLocalAutoStartMic(value);
    setAutoStartMicOn(value);
  };

  const handleAutoStartMicOnConvEndChange = (value: boolean) => {
    setLocalAutoStartMicOnConvEnd(value);
    setAutoStartMicOnConvEnd(value);
  };

  const handleManualInputModeChange = (value: boolean) => {
    setLocalManualInputMode(value);
    setManualInputMode(value);
  };

  const handleSave = (): void => {
    updateSettings(localSettingsRef.current);
    originalSettingsRef.current = localSettingsRef.current;
    originalAutoStopMicRef.current = localVoiceInterruption;
    originalAutoStartMicOnRef.current = localAutoStartMic;
    originalAutoStartMicOnConvEndRef.current = localAutoStartMicOnConvEnd;
    originalManualInputModeRef.current = localManualInputMode;
  };

  const handleCancel = (): void => {
    localSettingsRef.current = originalSettingsRef.current;
    setLocalVoiceInterruption(originalAutoStopMicRef.current);
    setLocalAutoStartMic(originalAutoStartMicOnRef.current);
    setAutoStopMic(originalAutoStopMicRef.current);
    setAutoStartMicOn(originalAutoStartMicOnRef.current);
    setLocalAutoStartMicOnConvEnd(originalAutoStartMicOnConvEndRef.current);
    setAutoStartMicOnConvEnd(originalAutoStartMicOnConvEndRef.current);
    setLocalManualInputMode(originalManualInputModeRef.current);
    setManualInputMode(originalManualInputModeRef.current);
    forceUpdate();
  };

  return {
    localSettings: localSettingsRef.current,
    autoStopMic: localVoiceInterruption,
    autoStartMicOn: localAutoStartMic,
    autoStartMicOnConvEnd: localAutoStartMicOnConvEnd,
    manualInputMode: localManualInputMode,
    setAutoStopMic: handleVoiceInterruptionChange,
    setAutoStartMicOn: handleAutoStartMicChange,
    setAutoStartMicOnConvEnd: handleAutoStartMicOnConvEndChange,
    setManualInputMode: handleManualInputModeChange,
    handleInputChange,
    handleSave,
    handleCancel,
  };
};
