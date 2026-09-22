import { ChangeEvent, KeyboardEvent } from 'react';
import { useChatHistory } from '@/context/chat-history-context';
import { useVAD } from '@/context/vad-context';
import { useMicToggle } from '@/hooks/utils/use-mic-toggle';
import { useTextInput } from '@/hooks/footer/use-text-input';
import { useAiState, AiStateEnum } from '@/context/ai-state-context';
import { useInterrupt } from '@/hooks/utils/use-interrupt';
import { useTriggerSpeak } from '@/hooks/utils/use-trigger-speak';
import { useProactiveSpeak } from '@/context/proactive-speak-context';

export function useInputSubtitle() {
  const {
    inputText: inputValue,
    setInputText: handleChange,
    handleKeyPress: handleKey,
    handleCompositionStart,
    handleCompositionEnd,
    handleSend,

  } = useTextInput();

  const { messages } = useChatHistory();
  const { startMic, autoStartMicOn } = useVAD();
  const { handleMicToggle, micOn } = useMicToggle();
  const { aiState, setAiState } = useAiState();
  const { interrupt } = useInterrupt();
  const { sendTriggerSignal } = useTriggerSpeak();
  const { settings } = useProactiveSpeak();

  const lastAIMessage = messages
    .filter((msg) => msg.role === 'ai')
    .slice(-1)
    .map((msg) => msg.content)[0];

  const hasAIMessages = messages.some((msg) => msg.role === 'ai');

  const handleInterrupt = () => {
    if (aiState === AiStateEnum.THINKING_SPEAKING) {
      interrupt();
      if (autoStartMicOn) {
        startMic();
      }
    } else if (settings.allowButtonTrigger) {
      sendTriggerSignal(-1);
    }
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    handleChange({ target: { value: e.target.value } } as ChangeEvent<HTMLInputElement>);
    setAiState(AiStateEnum.WAITING);
  };

  const handleKeyPress = (e: KeyboardEvent<HTMLInputElement>) => {
    handleKey(e as any);
  };

  return {
    inputValue,
    handleInputChange,
    handleKeyPress,
    handleCompositionStart,
    handleCompositionEnd,
    handleInterrupt,
    handleMicToggle,
    lastAIMessage,
    hasAIMessages,
    aiState,
    micOn,
    handleSend,
  };
}
