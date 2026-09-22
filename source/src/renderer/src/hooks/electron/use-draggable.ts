import { useCallback, useEffect, useRef, useState } from 'react';
import { useMode } from '@/context/mode-context';

interface Position {
  x: number;
  y: number;
}

interface UseDraggableProps {
  componentId: string;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

const INTERACTIVE_ELEMENT_SELECTOR = [
  'button',
  'input',
  'textarea',
  'select',
  'a[href]',
  '[role=button]',
  '[contenteditable=true]',
  '[data-no-drag=true]',
].join(', ');

function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(INTERACTIVE_ELEMENT_SELECTOR) !== null
  );
}

/**
 * A custom hook that provides dragging functionality for components.
 * Global pointer listeners make sure a drag always ends, even when the
 * pointer is released outside the component or the window loses focus.
 */
export function useDraggable({
  componentId,
  onDragStart,
  onDragEnd,
}: UseDraggableProps) {
  const { mode } = useMode();
  const isPet = mode === 'pet';
  const [isDragging, setIsDragging] = useState(false);

  const positionRef = useRef<Position>({ x: 0, y: 0 });
  const dragStartRef = useRef<Position>({ x: 0, y: 0 });
  const elementRef = useRef<HTMLDivElement>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const isDraggingRef = useRef(false);

  const updateComponentHover = useCallback(
    (isHovering: boolean) => {
      if (isPet) {
        (window.api as any)?.updateComponentHover(componentId, isHovering);
      }
    },
    [componentId, isPet],
  );

  const isPointInsideElement = useCallback((x: number, y: number) => {
    const element = elementRef.current;
    if (!element) return false;

    const rect = element.getBoundingClientRect();
    return (
      x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
    );
  }, []);

  const endDrag = useCallback(
    (pointerId?: number, clearHover = false) => {
      const activePointerId = activePointerIdRef.current;

      if (
        pointerId !== undefined &&
        activePointerId !== null &&
        pointerId !== activePointerId
      ) {
        return;
      }

      activePointerIdRef.current = null;

      const element = elementRef.current;
      if (element && activePointerId !== null) {
        try {
          if (element.hasPointerCapture(activePointerId)) {
            element.releasePointerCapture(activePointerId);
          }
        } catch {
          // The browser can release capture before pointercancel/lostpointercapture.
        }
      }

      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        onDragEnd?.();
        setIsDragging(false);
      }

      if (clearHover) {
        updateComponentHover(false);
      }
    },
    [onDragEnd, updateComponentHover],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (
        isInteractiveTarget(event.target) ||
        !event.isPrimary ||
        event.button !== 0 ||
        activePointerIdRef.current !== null
      ) {
        return;
      }

      onDragStart?.();
      activePointerIdRef.current = event.pointerId;
      isDraggingRef.current = true;
      setIsDragging(true);

      dragStartRef.current = {
        x: event.clientX - positionRef.current.x,
        y: event.clientY - positionRef.current.y,
      };

      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Window-level listeners below still provide the drag fallback.
      }
    },
    [onDragStart],
  );

  const handlePointerEnter = useCallback(() => {
    updateComponentHover(true);
  }, [updateComponentHover]);

  const handlePointerLeave = useCallback(() => {
    if (!isDraggingRef.current) {
      updateComponentHover(false);
    }
  }, [updateComponentHover]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (
        !isDraggingRef.current ||
        event.pointerId !== activePointerIdRef.current
      ) {
        return;
      }

      // Self-heal if the OS/browser missed the corresponding pointerup event.
      if (event.buttons === 0) {
        endDrag(
          event.pointerId,
          !isPointInsideElement(event.clientX, event.clientY),
        );
        return;
      }

      const element = elementRef.current;
      if (!element) {
        endDrag(event.pointerId, true);
        return;
      }

      const newPosition = {
        x: event.clientX - dragStartRef.current.x,
        y: event.clientY - dragStartRef.current.y,
      };

      positionRef.current = newPosition;
      element.style.transform = `translateX(-50%) translate(${newPosition.x}px, ${newPosition.y}px)`;
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId !== activePointerIdRef.current) return;

      endDrag(
        event.pointerId,
        !isPointInsideElement(event.clientX, event.clientY),
      );
    };

    const handlePointerCancel = (event: PointerEvent) => {
      if (event.pointerId !== activePointerIdRef.current) return;

      endDrag(event.pointerId, true);
    };

    const handleWindowBlur = () => {
      if (isDraggingRef.current) {
        // Losing focus must end an active drag, but it does not mean that the
        // pointer left the floating panel. Keep its Electron hover state.
        endDrag();
      }
    };

    const handleDocumentMouseLeave = () => {
      endDrag(undefined, true);
    };

    const handleLostPointerCapture = (event: PointerEvent) => {
      if (event.pointerId === activePointerIdRef.current) {
        endDrag(event.pointerId, true);
      }
    };

    const element = elementRef.current;

    window.addEventListener('pointermove', handlePointerMove, true);
    window.addEventListener('pointerup', handlePointerUp, true);
    window.addEventListener('pointercancel', handlePointerCancel, true);
    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('mouseleave', handleDocumentMouseLeave);
    element?.addEventListener('lostpointercapture', handleLostPointerCapture);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('pointerup', handlePointerUp, true);
      window.removeEventListener('pointercancel', handlePointerCancel, true);
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('mouseleave', handleDocumentMouseLeave);
      element?.removeEventListener(
        'lostpointercapture',
        handleLostPointerCapture,
      );
      endDrag(undefined, true);
    };
  }, [endDrag, isPointInsideElement]);

  return {
    elementRef,
    isDragging,
    handlePointerDown,
    handlePointerEnter,
    handlePointerLeave,
  };
}
