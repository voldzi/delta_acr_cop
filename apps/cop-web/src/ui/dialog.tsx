import * as DialogPrimitive from "@radix-ui/react-dialog";
import clsx from "clsx";
import { X } from "lucide-react";
import type { ReactNode } from "react";

export function ModalDialog({
  actions,
  children,
  className,
  closeDisabled = false,
  description,
  eyebrow,
  onClose,
  title
}: {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  closeDisabled?: boolean;
  description?: string;
  eyebrow?: string;
  onClose: () => void;
  title: string;
}) {
  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open && !closeDisabled) {
          onClose();
        }
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="ui-dialog-overlay" />
        <DialogPrimitive.Content
          className={clsx("ui-dialog-content", className)}
          onEscapeKeyDown={(event) => {
            if (closeDisabled) {
              event.preventDefault();
            }
          }}
          onInteractOutside={(event) => {
            if (closeDisabled) {
              event.preventDefault();
            }
          }}
        >
          <div className="ui-dialog-header">
            <div>
              {eyebrow ? <span>{eyebrow}</span> : null}
              <DialogPrimitive.Title className="ui-dialog-title">{title}</DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="ui-dialog-description">
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            <DialogPrimitive.Close asChild>
              <button aria-label="Zavřít" className="icon-button" disabled={closeDisabled} type="button">
                <X size={18} />
              </button>
            </DialogPrimitive.Close>
          </div>
          {children}
          {actions ? <div className="ui-dialog-actions">{actions}</div> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
