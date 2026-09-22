import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { defaultBaseUrl } from "./websocket-context";
import { toaster } from "@/components/ui/toaster";

export interface AttachmentRef {
  file_id: string;
  name: string;
  relative_path: string;
  kind: "document" | "image" | "video";
  mime_type: string;
  size: number;
  modified_at?: string;
}

export type VideoUploadMode = "normal" | "original";

export const DEFAULT_LIBRARY_SUBDIR = "待整理";
export const CLIPBOARD_SCREENSHOT_SUBDIR = "屏幕截图";

const CLIPBOARD_IMAGE_EXTENSIONS: Record<string, string> = {
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

export interface ClipboardImageRef {
  file_id: string;
  name: string;
  data: string;
  mime_type: string;
}

interface AttachmentContextValue {
  attachments: AttachmentRef[];
  clipboardImages: ClipboardImageRef[];
  libraryFolders: string[];
  videoUploadMode: VideoUploadMode;
  setVideoUploadMode: (mode: VideoUploadMode) => void;
  refreshLibraryFolders: () => Promise<string[]>;
  uploadFiles: (
    files: FileList | File[],
    subdir?: string,
  ) => Promise<AttachmentRef[]>;
  addClipboardImages: (files: File[]) => Promise<ClipboardImageRef[]>;
  removeAttachment: (fileId: string) => void;
  requestSaveNextScreenCapture: () => void;
  consumeSaveNextScreenCapture: () => boolean;
  saveNextScreenCapture: boolean;
}

const AttachmentContext = createContext<AttachmentContextValue | null>(null);

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener(
      "load",
      () => {
        if (typeof reader.result === "string") resolve(reader.result);
        else
          reject(new Error(`Failed to read ${file.name} from the clipboard`));
      },
      { once: true },
    );
    reader.addEventListener(
      "error",
      () => {
        reject(
          reader.error ??
            new Error(`Failed to read ${file.name} from the clipboard`),
        );
      },
      { once: true },
    );
    reader.readAsDataURL(file);
  });
}

function normalizeClipboardImageFile(file: File, index: number): File {
  const mimeType = file.type.toLowerCase();
  const extension = CLIPBOARD_IMAGE_EXTENSIONS[mimeType];
  if (!extension) {
    throw new Error(
      `Unsupported clipboard image format: ${file.type || "unknown"}`,
    );
  }

  const originalName = file.name.trim();
  const supportedName = /\.(gif|jpe?g|png|webp)$/i.test(originalName);
  if (originalName && supportedName) return file;

  const stem =
    originalName.replace(/\.[^.]+$/, "").trim() || `image-${index + 1}`;
  return new File([file], `${stem}${extension}`, {
    type: mimeType,
    lastModified: file.lastModified,
  });
}

function getBaseUrl() {
  try {
    const storedBaseUrl = window.localStorage.getItem("baseUrl");
    const parsedBaseUrl = storedBaseUrl
      ? JSON.parse(storedBaseUrl)
      : defaultBaseUrl;
    return typeof parsedBaseUrl === "string" ? parsedBaseUrl : defaultBaseUrl;
  } catch (error) {
    console.error("Error reading baseUrl from localStorage:", error);
    return defaultBaseUrl;
  }
}

export function AttachmentProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [attachments, setAttachments] = useState<AttachmentRef[]>([]);
  const [clipboardImages, setClipboardImages] = useState<ClipboardImageRef[]>(
    [],
  );
  const [libraryFolders, setLibraryFolders] = useState<string[]>([
    DEFAULT_LIBRARY_SUBDIR,
  ]);
  const [videoUploadMode, setVideoUploadMode] =
    useState<VideoUploadMode>("normal");
  const libraryFoldersRef = useRef<string[]>([DEFAULT_LIBRARY_SUBDIR]);
  const saveNextScreenCaptureRef = useRef(false);
  const [saveNextScreenCapture, setSaveNextScreenCapture] = useState(false);

  const refreshLibraryFolders = useCallback(async () => {
    try {
      const baseUrl = getBaseUrl();
      const response = await fetch(
        `${baseUrl.replace(/\/$/, "")}/library/folders?kind=all&recursive=true`,
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(payload.folders)) {
        return libraryFoldersRef.current;
      }

      const categoryPaths = payload.folders
        .map((folder: { relative_path?: string }) => folder.relative_path || "")
        .map((relativePath: string) =>
          relativePath.replace(/^(documents|images|videos)\//, ""),
        )
        .filter((relativePath: string) => relativePath.length > 0);
      const folders = Array.from(
        new Set([DEFAULT_LIBRARY_SUBDIR, ...categoryPaths]),
      ).sort((left, right) => left.localeCompare(right, "zh-CN"));
      libraryFoldersRef.current = folders;
      setLibraryFolders(folders);
      return folders;
    } catch (error) {
      console.warn("Unable to load library folders:", error);
      return libraryFoldersRef.current;
    }
  }, []);

  useEffect(() => {
    void refreshLibraryFolders();
  }, [refreshLibraryFolders]);

  const uploadFiles = useCallback(
    async (files: FileList | File[], subdir = DEFAULT_LIBRARY_SUBDIR) => {
      const uploaded: AttachmentRef[] = [];
      const normalizedSubdir = subdir.trim() || DEFAULT_LIBRARY_SUBDIR;
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("subdir", normalizedSubdir);
        if (
          file.type.toLowerCase().startsWith("video/") ||
          /\.(avi|mov|mp4|mpe?g|webm)$/i.test(file.name)
        ) {
          formData.append("video_mode", videoUploadMode);
        }
        const baseUrl = getBaseUrl();
        const response = await fetch(
          `${baseUrl.replace(/\/$/, "")}/library/upload`,
          {
            method: "POST",
            body: formData,
          },
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.file) {
          throw new Error(payload.error || `Failed to upload ${file.name}`);
        }
        uploaded.push(payload.file as AttachmentRef);
      }
      setAttachments((previous) => {
        const next = [...previous];
        for (const item of uploaded) {
          if (!next.some((existing) => existing.file_id === item.file_id))
            next.push(item);
        }
        return next;
      });
      void refreshLibraryFolders();
      return uploaded;
    },
    [refreshLibraryFolders, videoUploadMode],
  );

  const addClipboardImages = useCallback(
    async (files: File[]) => {
      const added: ClipboardImageRef[] = [];
      for (const [index, originalFile] of files.entries()) {
        if (!originalFile.type.toLowerCase().startsWith("image/")) continue;
        try {
          const file = normalizeClipboardImageFile(originalFile, index);
          const data = await readFileAsDataUrl(file);
          const uploaded = await uploadFiles(
            [file],
            CLIPBOARD_SCREENSHOT_SUBDIR,
          );
          const attachment = uploaded[0];
          if (!attachment) continue;
          added.push({
            file_id: attachment.file_id,
            name: attachment.name,
            data,
            mime_type: file.type || attachment.mime_type,
          });
        } catch (error) {
          toaster.create({
            title:
              error instanceof Error
                ? error.message
                : "Clipboard image upload failed",
            type: "error",
            duration: 3000,
          });
        }
      }
      setClipboardImages((previous) => {
        const next = [...previous];
        for (const item of added) {
          const existingIndex = next.findIndex(
            (existing) => existing.file_id === item.file_id,
          );
          if (existingIndex >= 0) next[existingIndex] = item;
          else next.push(item);
        }
        return next;
      });
      return added;
    },
    [uploadFiles],
  );

  const removeAttachment = useCallback((fileId: string) => {
    setAttachments((previous) =>
      previous.filter((item) => item.file_id !== fileId),
    );
    setClipboardImages((previous) =>
      previous.filter((item) => item.file_id !== fileId),
    );
  }, []);

  const requestSaveNextScreenCapture = useCallback(() => {
    saveNextScreenCaptureRef.current = true;
    setSaveNextScreenCapture(true);
  }, []);

  const consumeSaveNextScreenCapture = useCallback(() => {
    const shouldSave = saveNextScreenCaptureRef.current;
    if (shouldSave) {
      saveNextScreenCaptureRef.current = false;
      setSaveNextScreenCapture(false);
    }
    return shouldSave;
  }, []);

  const value = useMemo(
    () => ({
      attachments,
      clipboardImages,
      libraryFolders,
      videoUploadMode,
      setVideoUploadMode,
      refreshLibraryFolders,
      uploadFiles,
      addClipboardImages,
      removeAttachment,
      requestSaveNextScreenCapture,
      consumeSaveNextScreenCapture,
      saveNextScreenCapture,
    }),
    [
      attachments,
      clipboardImages,
      libraryFolders,
      videoUploadMode,
      refreshLibraryFolders,
      uploadFiles,
      addClipboardImages,
      removeAttachment,
      requestSaveNextScreenCapture,
      consumeSaveNextScreenCapture,
      saveNextScreenCapture,
    ],
  );

  return (
    <AttachmentContext.Provider value={value}>
      {children}
    </AttachmentContext.Provider>
  );
}

export function useAttachments() {
  const context = useContext(AttachmentContext);
  if (!context) {
    throw new Error("useAttachments must be used within AttachmentProvider");
  }
  return context;
}

export async function uploadWithNotice(
  uploadFiles: AttachmentContextValue["uploadFiles"],
  files: FileList | File[],
  subdir?: string,
) {
  try {
    return await uploadFiles(files, subdir);
  } catch (error) {
    toaster.create({
      title: error instanceof Error ? error.message : "File upload failed",
      type: "error",
      duration: 3000,
    });
    return [];
  }
}
