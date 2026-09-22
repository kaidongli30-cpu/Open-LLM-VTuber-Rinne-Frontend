export interface RinneLegacyRendererDriver {
  selectEmotion: (emotion: string) => Promise<unknown>;
  startSpeech: (
    audio: HTMLAudioElement,
    volumes: number[],
    sliceLength: number,
  ) => void;
  stopSpeech: () => void;
  fail: (error: unknown) => void;
}

let activeDriver: RinneLegacyRendererDriver | null = null;
let lastSelectedEmotion: string | null = null;

export function registerRinneLegacyRendererDriver(
  driver: RinneLegacyRendererDriver,
): () => void {
  const trackedDriver: RinneLegacyRendererDriver = {
    ...driver,
    selectEmotion: async (emotion) => {
      const result = await driver.selectEmotion(emotion);
      lastSelectedEmotion = emotion.trim().toLowerCase();
      return result;
    },
  };
  activeDriver = trackedDriver;
  if (lastSelectedEmotion) {
    void trackedDriver.selectEmotion(lastSelectedEmotion).catch(driver.fail);
  }
  return () => {
    if (activeDriver === trackedDriver) activeDriver = null;
  };
}

export function getRinneLegacyRendererDriver(): RinneLegacyRendererDriver | null {
  return activeDriver;
}

export function getLastSelectedRinneEmotion(): string | null {
  return lastSelectedEmotion;
}

export function resolveRinneEmotionFromExpression(
  expression: string | number,
  emotionMap: Record<string, string | number>,
): string {
  const serialized = String(expression).trim().toLowerCase();
  if (!serialized) return "neutral";
  const direct = Object.keys(emotionMap).find(
    (emotion) => emotion.toLowerCase() === serialized,
  );
  if (direct !== undefined) return direct.toLowerCase();
  const inverse = Object.entries(emotionMap).find(
    ([, value]) => String(value).trim().toLowerCase() === serialized,
  );
  return inverse?.[0].toLowerCase() ?? serialized;
}
