import {
  LuBell,
  LuSend,
  LuMic,
  LuMicOff,
  LuHand,
  LuX,
  LuPaperclip,
  LuImageDown,
} from "react-icons/lu";
import {
  Box,
  Button,
  Flex,
  Input,
  Stack,
  Text,
  VStack,
  IconButton,
} from "@chakra-ui/react";
import { useState, useEffect, useCallback, useRef } from "react";
import { useInputSubtitle } from "@/hooks/electron/use-input-subtitle";
import { useDraggable } from "@/hooks/electron/use-draggable";
import { inputSubtitleStyles } from "./electron-style";
import { useMode } from "@/context/mode-context";
import { useAttachments, uploadWithNotice } from "@/context/attachment-context";
import { useClipboardImagePaste } from "@/hooks/utils/use-clipboard-image-paste";
import { OutfitPickerButton } from "@/components/outfit/outfit-picker-button";

export function InputSubtitle() {
  const {
    inputValue,
    handleInputChange,
    handleKeyPress,
    handleCompositionStart,
    handleCompositionEnd,
    handleInterrupt,
    handleMicToggle,
    handleSend,
    lastAIMessage,
    hasAIMessages,
    aiState,
    micOn,
  } = useInputSubtitle();

  const { mode } = useMode();
  const isPet = mode === "pet";
  const fileInputRef = useRef<HTMLInputElement>(null);
  const {
    attachments,
    uploadFiles,
    removeAttachment,
    requestSaveNextScreenCapture,
    saveNextScreenCapture,
    videoUploadMode,
    setVideoUploadMode,
  } = useAttachments();
  const handleClipboardImagePaste = useClipboardImagePaste();

  const {
    elementRef,
    isDragging,
    handlePointerDown,
    handlePointerEnter,
    handlePointerLeave,
  } = useDraggable({
    componentId: "input-subtitle",
  });

  const [isVisible, setIsVisible] = useState(true);

  const handleClose = useCallback(() => {
    if (isPet) {
      (window.api as any)?.updateComponentHover("input-subtitle", false);
    }
    setIsVisible(false);
  }, [isPet]);

  const handleOpen = () => {
    setIsVisible(true);
  };

  useEffect(() => {
    if (isPet) {
      const cleanup = (window.api as any)?.onToggleInputSubtitle(() => {
        if (isVisible) {
          handleClose();
        } else {
          handleOpen();
        }
      });
      return () => cleanup?.();
    }
    return () => {};
  }, [handleClose, isPet, isVisible]);

  useEffect(() => {
    (window as any).inputSubtitle = {
      open: handleOpen,
      close: handleClose,
    };

    return () => {
      delete (window as any).inputSubtitle;
    };
  }, [isPet, handleClose]);

  if (!isVisible) return null;

  return (
    <Box
      ref={elementRef}
      {...inputSubtitleStyles.container}
      {...inputSubtitleStyles.draggableContainer(isDragging)}
      onPointerDown={handlePointerDown}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <Box {...inputSubtitleStyles.box}>
        <IconButton
          aria-label="Close subtitle"
          onClick={handleClose}
          {...inputSubtitleStyles.closeButton}
        >
          <LuX size={12} />
        </IconButton>

        {hasAIMessages && (
          <VStack
            minH={lastAIMessage ? "32px" : "0px"}
            {...inputSubtitleStyles.messageStack}
          >
            {lastAIMessage && (
              <Text {...inputSubtitleStyles.messageText}>{lastAIMessage}</Text>
            )}
          </VStack>
        )}

        <Box {...inputSubtitleStyles.statusBox}>
          <Flex align="center" justify="space-between" color="whiteAlpha.700">
            <Flex align="center" gap="2">
              <LuBell size={16} />
              <Text {...inputSubtitleStyles.statusText}>{aiState}</Text>
            </Flex>

            <Flex gap="2">
              <OutfitPickerButton mode="pet" />
              <IconButton
                aria-label="Toggle microphone"
                onClick={handleMicToggle}
                {...inputSubtitleStyles.iconButton}
              >
                {micOn ? <LuMic size={16} /> : <LuMicOff size={16} />}
              </IconButton>
              <IconButton
                aria-label="Interrupt"
                onClick={handleInterrupt}
                {...inputSubtitleStyles.iconButton}
              >
                <LuHand size={16} />
              </IconButton>
            </Flex>
          </Flex>
        </Box>

        <Box {...inputSubtitleStyles.inputBox}>
          {attachments.length > 0 && (
            <Flex gap="1" px="2" pt="2" overflow="hidden">
              {attachments.map((attachment) => (
                <Flex
                  key={attachment.file_id}
                  align="center"
                  gap="1"
                  bg="blackAlpha.700"
                  color="white"
                  px="2"
                  py="1"
                  rounded="md"
                  maxW="180px"
                >
                  <Text fontSize="xs" truncate>
                    {attachment.name}
                  </Text>
                  <Button
                    aria-label={`Remove ${attachment.name}`}
                    onClick={() => removeAttachment(attachment.file_id)}
                    variant="ghost"
                    minW="4"
                    h="4"
                    p="0"
                    color="whiteAlpha.800"
                  >
                    ×
                  </Button>
                </Flex>
              ))}
            </Flex>
          )}
          <Stack direction="row" gap="2" p="2">
            <IconButton
              aria-label="Attach file"
              onClick={() => fileInputRef.current?.click()}
              {...inputSubtitleStyles.iconButton}
            >
              <LuPaperclip size={16} />
            </IconButton>
            <IconButton
              aria-label="Save next screen capture"
              title="Save next screen capture"
              onClick={requestSaveNextScreenCapture}
              {...inputSubtitleStyles.iconButton}
              color={saveNextScreenCapture ? "blue.300" : "whiteAlpha.800"}
            >
              <LuImageDown size={16} />
            </IconButton>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".txt,.md,.pdf,.docx,.png,.jpg,.jpeg,.webp,.gif,.mp4,.mov,.avi,.webm,.mpeg,.mpg"
              hidden
              onChange={(event) => {
                if (event.target.files?.length) {
                  void uploadWithNotice(uploadFiles, event.target.files);
                  event.target.value = "";
                }
              }}
            />
            <Button
              aria-label={
                videoUploadMode === "normal" ? "压缩保存视频" : "原画保存视频"
              }
              title={
                videoUploadMode === "normal"
                  ? "视频将压缩后保存和观看"
                  : "保留原视频；超过70 MiB时无损分段观看"
              }
              onClick={() =>
                setVideoUploadMode(
                  videoUploadMode === "normal" ? "original" : "normal",
                )
              }
              variant="ghost"
              w="8"
              minW="8"
              h="8"
              p="0"
              flexShrink={0}
              whiteSpace="normal"
              color="whiteAlpha.800"
            >
              <Text as="span" fontSize="2xs" lineHeight="1.05" textAlign="center">
                {videoUploadMode === "normal" ? (
                  <>
                    压缩
                    <br />
                    保存
                  </>
                ) : (
                  <>
                    原画
                    <br />
                    保存
                  </>
                )}
              </Text>
            </Button>
            <Input
              value={inputValue}
              onChange={handleInputChange}
              onPaste={handleClipboardImagePaste}
              onKeyDown={handleKeyPress}
              onCompositionStart={handleCompositionStart}
              onCompositionEnd={handleCompositionEnd}
              placeholder="Type your message..."
              {...inputSubtitleStyles.input}
            />
            <Button onClick={handleSend} {...inputSubtitleStyles.sendButton}>
              <LuSend size={16} />
            </Button>
          </Stack>
        </Box>
      </Box>
    </Box>
  );
}
