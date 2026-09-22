import { useCallback } from 'react';
import { useAttachments } from '@/context/attachment-context';

export function useClipboardImagePaste() {
  const { addClipboardImages } = useAttachments();

  return useCallback((event: React.ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const images = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file' && item.type.toLowerCase().startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);

    // Leave ordinary text paste entirely to the native input control.
    if (images.length === 0) return;
    event.preventDefault();
    void addClipboardImages(images);
  }, [addClipboardImages]);
}
