import { useCallback } from "react";
import { useAttachments } from "@/context/attachment-context";
import { useWebSocket } from "@/context/websocket-context";
import { useMediaCapture } from "@/hooks/utils/use-media-capture";
import { useSubmitTextInput } from "@/hooks/utils/use-submit-text-input";

export function useSendAudio() {
  const { sendMessage } = useWebSocket();
  const { captureAllMedia } = useMediaCapture();
  const { attachments, clipboardImages, removeAttachment } = useAttachments();
  const submitTextInput = useSubmitTextInput();

  const sendAudioPartition = useCallback(
    async (audio: Float32Array) => {
      const chunkSize = 4096;
      const submittedAttachments = [...attachments];
      const submittedClipboardImages = [...clipboardImages];

      // Send the audio data in chunks
      for (let index = 0; index < audio.length; index += chunkSize) {
        const endIndex = Math.min(index + chunkSize, audio.length);
        const chunk = audio.slice(index, endIndex);
        sendMessage({
          type: "mic-audio-data",
          audio: Array.from(chunk),
          // Only send images with first chunk
        });
      }

      // Send end signal after all chunks
      const images = [
        ...await captureAllMedia(),
        ...submittedClipboardImages.map((image) => ({
          source: 'clipboard' as const,
          data: image.data,
          mime_type: image.mime_type,
          persist: false,
          name: image.name,
        })),
      ];
      sendMessage({
        type: "mic-audio-end",
        images,
        attachments: submittedAttachments,
      });
      submittedAttachments.forEach((attachment) => {
        removeAttachment(attachment.file_id);
      });
    },
    [attachments, captureAllMedia, clipboardImages, removeAttachment, sendMessage],
  );

  const sendManualAudioPartition = useCallback(
    async (audio: Float32Array, segmentId: string) => {
      const chunkSize = 4096;

      for (let index = 0; index < audio.length; index += chunkSize) {
        const endIndex = Math.min(index + chunkSize, audio.length);
        const chunk = audio.slice(index, endIndex);
        sendMessage({
          type: "manual-audio-data",
          segment_id: segmentId,
          audio: Array.from(chunk),
        });
      }

      sendMessage({
        type: "manual-audio-end",
        segment_id: segmentId,
      });
    },
    [sendMessage],
  );

  const sendTextInput = useCallback(
    async (text: string) => {
      await submitTextInput(text);
    },
    [submitTextInput],
  );

  return {
    sendAudioPartition,
    sendManualAudioPartition,
    sendTextInput,
  };
}
