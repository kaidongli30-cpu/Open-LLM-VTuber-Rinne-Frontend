/* eslint-disable react/require-default-props */
import {
  Box,
  Button,
  Text,
  Textarea,
  IconButton,
  HStack,
  Input,
} from "@chakra-ui/react";
import { BsMicFill, BsMicMuteFill, BsPaperclip } from "react-icons/bs";
import { IoHandRightSharp } from "react-icons/io5";
import { FiChevronDown } from "react-icons/fi";
import { LuImageDown } from "react-icons/lu";
import { memo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { InputGroup } from "@/components/ui/input-group";
import { footerStyles } from "./footer-styles";
import AIStateIndicator from "./ai-state-indicator";
import { useFooter } from "@/hooks/footer/use-footer";
import {
  DEFAULT_LIBRARY_SUBDIR,
  useAttachments,
  uploadWithNotice,
} from "@/context/attachment-context";
import { useClipboardImagePaste } from "@/hooks/utils/use-clipboard-image-paste";
import { OutfitPickerButton } from "@/components/outfit/outfit-picker-button";

// Type definitions
interface FooterProps {
  isCollapsed?: boolean;
  onToggle?: () => void;
}

interface ToggleButtonProps {
  isCollapsed: boolean;
  onToggle?: () => void;
}

interface ActionButtonsProps {
  micOn: boolean;
  onMicToggle: () => void;
  onInterrupt: () => void;
}

interface MessageInputProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
}

// Reusable components
const ToggleButton = memo(({ isCollapsed, onToggle }: ToggleButtonProps) => (
  <Box
    {...footerStyles.footer.toggleButton}
    onClick={onToggle}
    color="whiteAlpha.500"
    style={{
      transform: isCollapsed ? "rotate(180deg)" : "rotate(0deg)",
    }}
  >
    <FiChevronDown />
  </Box>
));

ToggleButton.displayName = "ToggleButton";

const ActionButtons = memo(
  ({ micOn, onMicToggle, onInterrupt }: ActionButtonsProps) => (
    <HStack gap={1}>
      <OutfitPickerButton mode="window" />
      <IconButton
        bg={micOn ? "green.500" : "red.500"}
        {...footerStyles.footer.actionButton}
        onClick={onMicToggle}
      >
        {micOn ? <BsMicFill /> : <BsMicMuteFill />}
      </IconButton>
      <IconButton
        aria-label="Raise hand"
        bg="yellow.500"
        {...footerStyles.footer.actionButton}
        onClick={onInterrupt}
      >
        <IoHandRightSharp size="24" />
      </IconButton>
    </HStack>
  ),
);

ActionButtons.displayName = "ActionButtons";

const MessageInput = memo(
  ({
    value,
    onChange,
    onKeyDown,
    onCompositionStart,
    onCompositionEnd,
  }: MessageInputProps) => {
    const { t } = useTranslation();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const {
      attachments,
      libraryFolders,
      uploadFiles,
      removeAttachment,
      requestSaveNextScreenCapture,
      saveNextScreenCapture,
      videoUploadMode,
      setVideoUploadMode,
    } = useAttachments();
    const [uploadSubdir, setUploadSubdir] = useState(DEFAULT_LIBRARY_SUBDIR);
    const handleClipboardImagePaste = useClipboardImagePaste();

    return (
      <InputGroup flex={1}>
        <Box position="relative" width="100%">
          <IconButton
            aria-label="Attach file"
            variant="ghost"
            {...footerStyles.footer.attachButton}
            onClick={() => fileInputRef.current?.click()}
          >
            <BsPaperclip size="24" />
          </IconButton>
          <IconButton
            aria-label="Save next screen capture"
            title="Save next screen capture"
            variant="ghost"
            {...footerStyles.footer.attachButton}
            left="10"
            color={saveNextScreenCapture ? "blue.300" : undefined}
            onClick={requestSaveNextScreenCapture}
          >
            <LuImageDown size="22" />
          </IconButton>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".txt,.md,.pdf,.docx,.png,.jpg,.jpeg,.webp,.gif,.mp4,.mov,.avi,.webm,.mpeg,.mpg"
            hidden
            onChange={(event) => {
              if (event.target.files?.length) {
                void uploadWithNotice(
                  uploadFiles,
                  event.target.files,
                  uploadSubdir,
                );
                event.target.value = "";
              }
            }}
          />
          <HStack
            position="absolute"
            top="1"
            left="12"
            right="2"
            gap="1"
            zIndex={2}
          >
            <Text fontSize="xs" color="whiteAlpha.600" whiteSpace="nowrap">
              保存到
            </Text>
            <Input
              list="window-library-folders"
              value={uploadSubdir}
              onChange={(event) => setUploadSubdir(event.target.value)}
              placeholder={DEFAULT_LIBRARY_SUBDIR}
              aria-label="Library folder"
              h="6"
              minW="0"
              flex="1"
              px="2"
              bg="blackAlpha.400"
              color="whiteAlpha.800"
              border="1px solid"
              borderColor="whiteAlpha.300"
              borderRadius="sm"
              fontSize="xs"
            />
            <Button
              size="2xs"
              w="8"
              minW="8"
              h="8"
              p="0"
              flexShrink={0}
              variant="outline"
              color="whiteAlpha.800"
              borderColor="whiteAlpha.300"
              whiteSpace="normal"
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
            <datalist id="window-library-folders">
              {libraryFolders.map((folder) => (
                <option key={folder} value={folder} />
              ))}
            </datalist>
          </HStack>
          {attachments.length > 0 && (
            <HStack
              position="absolute"
              top="-8"
              left="2"
              right="2"
              gap="1"
              overflow="hidden"
            >
              {attachments.map((attachment) => (
                <Box
                  key={attachment.file_id}
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
                  <IconButton
                    aria-label={`Remove ${attachment.name}`}
                    size="2xs"
                    variant="ghost"
                    onClick={() => removeAttachment(attachment.file_id)}
                  >
                    ×
                  </IconButton>
                </Box>
              ))}
            </HStack>
          )}
          <Textarea
            value={value}
            onChange={onChange}
            onPaste={handleClipboardImagePaste}
            onKeyDown={onKeyDown}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={onCompositionEnd}
            placeholder={t("footer.typeYourMessage")}
            {...footerStyles.footer.input}
          />
        </Box>
      </InputGroup>
    );
  },
);

MessageInput.displayName = "MessageInput";

// Main component
function Footer({ isCollapsed = false, onToggle }: FooterProps): JSX.Element {
  const {
    inputValue,
    handleInputChange,
    handleKeyPress,
    handleCompositionStart,
    handleCompositionEnd,
    handleInterrupt,
    handleMicToggle,
    micOn,
  } = useFooter();

  return (
    <Box {...footerStyles.footer.container(isCollapsed)}>
      <ToggleButton isCollapsed={isCollapsed} onToggle={onToggle} />

      <Box pt="0" px="4">
        <HStack width="100%" gap={4}>
          <Box>
            <Box mb="1.5">
              <AIStateIndicator />
            </Box>
            <ActionButtons
              micOn={micOn}
              onMicToggle={handleMicToggle}
              onInterrupt={handleInterrupt}
            />
          </Box>

          <MessageInput
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyPress}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
          />
        </HStack>
      </Box>
    </Box>
  );
}

export default Footer;
