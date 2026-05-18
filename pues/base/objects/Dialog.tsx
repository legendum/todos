/**
 * `<Dialog title onClose>{children}</Dialog>` — shared modal-dialog
 * chrome. Click-outside-to-close, Escape-to-close (via `useEscape`),
 * portal-rendered so it sits above any positioning ancestor.
 *
 * Both todos and fifos ship near-identical dialog scaffolds
 * (InstallDialog, EditTextDialog, …) using the same CSS class names:
 *
 *   .dialog-overlay     — full-viewport overlay; click closes
 *   .dialog             — the dialog panel; stopPropagation
 *   .dialog-header      — header bar with title + ×
 *   .dialog-close       — the × button
 *   .dialog-body        — content slot wrapper (provided by Dialog)
 *
 * Consumers ship their own `.dialog-*` CSS — the class names are the
 * contract. The `className` prop adds an extra class to the dialog
 * panel for size / variant overrides (e.g. `dialog--wide`).
 *
 * The body slot is `children` — render whatever inside. If you want a
 * scrollable body with consistent padding, the `.dialog-body` wrapper
 * provides it.
 */

import type { ReactElement, ReactNode } from "react";
import { createPortal } from "react-dom";
import { useEscape } from "./useEscape";

export type DialogProps = {
  /** Heading text rendered in the header bar. */
  title: string;
  /** Called on overlay click, × button, or Escape key. */
  onClose: () => void;
  /** Body content (anything React renderable). Goes inside the
   * `.dialog-body` wrapper. */
  children: ReactNode;
  /** Extra class added to the dialog panel for size / variant
   * overrides (e.g. `dialog--wide`). */
  className?: string;
};

export function Dialog({
  title,
  onClose,
  children,
  className,
}: DialogProps): ReactElement | null {
  useEscape(true, onClose);

  if (typeof document === "undefined") return null;

  const panelClass = className ? `dialog ${className}` : "dialog";

  return createPortal(
    <div className="dialog-overlay" onClick={onClose}>
      <div className={panelClass} onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
          <button type="button" className="dialog-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="dialog-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
