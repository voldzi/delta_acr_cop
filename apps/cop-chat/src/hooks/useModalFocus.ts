import * as React from "react";

const modalFocusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

export function useEventCallback<A extends unknown[], R>(handler: (...args: A) => R): (...args: A) => R {
  const handlerRef = React.useRef(handler);
  React.useLayoutEffect(() => {
    handlerRef.current = handler;
  }, [handler]);
  return React.useCallback((...args: A) => handlerRef.current(...args), []);
}

export function useModalFocus<T extends HTMLElement>(onClose: () => void): {
  dialogRef: React.RefObject<T | null>;
  onDialogKeyDown: (event: React.KeyboardEvent<T>) => void;
} {
  const dialogRef = React.useRef<T | null>(null);
  const closeDialog = useEventCallback(onClose);

  React.useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog) {
        return;
      }
      const preferredFocus = preferredModalFocusElement(dialog);
      if (preferredFocus && preferredFocus !== document.activeElement) {
        preferredFocus.focus({ preventScroll: true });
        return;
      }
      if (!dialog.contains(document.activeElement)) {
        const target = focusableModalElements(dialog)[0] ?? dialog;
        target.focus({ preventScroll: true });
      }
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
      event.stopPropagation();
      closeDialog();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    const focusable = focusableModalElements(dialog);
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus({ preventScroll: true });
      return;
    }
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const activeIndex = activeElement ? focusable.indexOf(activeElement) : -1;
    const nextIndex = event.shiftKey
      ? activeIndex <= 0 ? focusable.length - 1 : activeIndex - 1
      : activeIndex === focusable.length - 1 ? 0 : activeIndex + 1;
    event.preventDefault();
    focusable[nextIndex]?.focus({ preventScroll: true });
  }, [closeDialog]);

  return { dialogRef, onDialogKeyDown };
}

function focusableModalElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(modalFocusableSelector))
    .filter((element) => !element.hasAttribute("disabled") && isVisibleElement(element));
}

function preferredModalFocusElement(root: HTMLElement): HTMLElement | null {
  const target = root.querySelector<HTMLElement>("[data-modal-autofocus='true'], [autofocus]");
  return target && isVisibleElement(target) && !target.hasAttribute("disabled") ? target : null;
}

function isVisibleElement(element: HTMLElement): boolean {
  return Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
}
