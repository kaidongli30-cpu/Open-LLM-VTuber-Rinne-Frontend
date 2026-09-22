import { useCallback } from 'react';
import { ModelInfo } from '@/context/live2d-config-context';

/**
 * Custom hook for handling Live2D model expressions
 */
export const useLive2DExpression = () => {
  /**
   * Set expression for Live2D model
   * @param expressionValue - Expression name (string) or index (number)
   * @param lappAdapter - LAppAdapter instance
   * @param logMessage - Optional message to log on success
   */
  const setExpression = useCallback((
    expressionValue: string | number,
    lappAdapter: any,
    logMessage?: string,
  ) => {
    try {
      if (typeof expressionValue === 'string') {
        if (expressionValue.toLowerCase() === 'neutral') {
          // Neutral is the model's base face, not an expression file.
          lappAdapter.clearExpression?.();
        } else {
          // Set expression by name
          lappAdapter.setExpression(expressionValue);
        }
      } else if (typeof expressionValue === 'number') {
        if (expressionValue < 0) {
          // The backend uses -1 for neutral on models without a neutral file.
          lappAdapter.clearExpression?.();
        } else {
          // Set expression by index
          const expressionName = lappAdapter.getExpressionName(expressionValue);
          if (expressionName) {
            lappAdapter.setExpression(expressionName);
          }
        }
      }
      if (logMessage) {
        console.log(logMessage);
      }
    } catch (error) {
      console.error('Failed to set expression:', error);
    }
  }, []);

  /**
   * Reset expression to default
   * @param lappAdapter - LAppAdapter instance
   * @param modelInfo - Current model information
   */
  const resetExpression = useCallback((
    lappAdapter: any,
    modelInfo?: ModelInfo,
  ) => {
    if (!lappAdapter) return;

    try {
      // Check if model is loaded and has expressions
      const model = lappAdapter.getModel();
      if (!model || !model._modelSetting) {
        console.log('Model or model settings not loaded yet, skipping expression reset');
        return;
      }

      // If model has a default emotion defined, use it
      if (modelInfo?.defaultEmotion !== undefined) {
        setExpression(
          modelInfo.defaultEmotion,
          lappAdapter,
          `Reset expression to default: ${modelInfo.defaultEmotion}`,
        );
      } else {
        // No default expression means the model's original neutral face.
        lappAdapter.clearExpression?.();
      }
    } catch (error) {
      console.log('Failed to reset expression:', error);
    }
  }, [setExpression]);

  return {
    setExpression,
    resetExpression,
  };
};
