import { useCallback } from "react";
import { useAttachments } from "@/context/attachment-context";
import { useChatHistory } from "@/context/chat-history-context";
import { useWebSocket } from "@/context/websocket-context";
import { useMediaCapture } from "@/hooks/utils/use-media-capture";

export function useSubmitTextInput() {
  const { sendMessage } = useWebSocket();
  const { appendHumanMessage } = useChatHistory();
  const { captureAllMedia } = useMediaCapture();
  const { attachments, clipboardImages, removeAttachment } = useAttachments();

  return useCallback(
    async (text: string) => {
      const trimmedText = text.trim();
      if (!trimmedText && attachments.length === 0 && clipboardImages.length === 0) return;

      // Freeze this turn's attachments before awaiting camera/screen capture.
      const submittedAttachments = [...attachments];
      const submittedClipboardImages = [...clipboardImages];
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

      appendHumanMessage(trimmedText, submittedAttachments);
      sendMessage({
        type: "text-input",
        text: trimmedText,
        images,
        attachments: submittedAttachments,
      });

      submittedAttachments.forEach((attachment) => {
        removeAttachment(attachment.file_id);
      });
    },
    [
      appendHumanMessage,
      attachments,
      clipboardImages,
      captureAllMedia,
      removeAttachment,
      sendMessage,
    ],
  );
}
