import * as React from "react";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

/** Focus management for the few media/XR surfaces that cannot use Radix Dialog. */
export function useModalFocus<T extends HTMLElement>(onClose: () => void) {
  const dialogRef = React.useRef<T | null>(null);
  const closeRef = React.useRef(onClose);

  React.useLayoutEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  React.useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog || dialog.contains(document.activeElement)) {
        return;
      }
      (focusableElements(dialog)[0] ?? dialog).focus({ preventScroll: true });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (previousFocus && document.contains(previousFocus)) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, []);

  const onDialogKeyDown = React.useCallback((event: React.KeyboardEvent<T>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeRef.current();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    const focusable = focusableElements(dialog);
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus({ preventScroll: true });
      return;
    }
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const activeIndex = active ? focusable.indexOf(active) : -1;
    const nextIndex = event.shiftKey
      ? activeIndex <= 0
        ? focusable.length - 1
        : activeIndex - 1
      : activeIndex === focusable.length - 1
        ? 0
        : activeIndex + 1;
    event.preventDefault();
    focusable[nextIndex]?.focus({ preventScroll: true });
  }, []);

  return { dialogRef, onDialogKeyDown };
}

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (element) => !element.hasAttribute("disabled") && isVisible(element)
  );
}

function isVisible(element: HTMLElement): boolean {
  return Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
}
