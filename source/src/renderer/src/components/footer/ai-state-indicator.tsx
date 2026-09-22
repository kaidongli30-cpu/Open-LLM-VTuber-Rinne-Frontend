import { Box, Text } from '@chakra-ui/react';
import { useTranslation } from 'react-i18next';
import { useAiState } from '@/context/ai-state-context';
import { useVAD } from '@/context/vad-context';
import { footerStyles } from './footer-styles';

function AIStateIndicator(): JSX.Element {
  const { t } = useTranslation();
  const { aiState } = useAiState();
  const { manualCaptureQueued } = useVAD();
  const styles = footerStyles.aiIndicator;
  const stateKey = aiState === 'recognizing' && manualCaptureQueued
    ? 'aiState.recognizingQueued'
    : `aiState.${aiState}`;

  return (
    <Box {...styles.container}>
      <Text {...styles.text}>{t(stateKey)}</Text>
    </Box>
  );
}

export default AIStateIndicator;
