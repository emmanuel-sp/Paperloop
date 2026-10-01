import { useEffect, useId, useRef, type ReactNode } from 'react';

interface DialogProps {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  onClose(): void;
  busy?: boolean;
  wide?: boolean;
}

/** Native modal semantics provide focus containment and an inert background. */
export function Dialog({
  open,
  title,
  description,
  children,
  onClose,
  busy = false,
  wide = false,
}: DialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const backdropPress = useRef(false);
  const id = useId();

  useEffect(() => {
    const element = dialog.current;
    if (!open || !element) return;
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = 'hidden';
    heading.current?.focus();
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [open]);

  function outside(
    event:
      | React.PointerEvent<HTMLDialogElement>
      | React.MouseEvent<HTMLDialogElement>,
  ) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return (
      event.target === event.currentTarget &&
      (event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom)
    );
  }

  return (
    <dialog
      ref={dialog}
      className={`dialog${wide ? ' dialog-wide' : ''}`}
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-description` : undefined}
      aria-busy={busy}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        event.stopPropagation();
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button, a[href], input, select, textarea, summary, [tabindex]',
          ),
        ).filter(
          (control) =>
            control.tabIndex >= 0 &&
            !control.matches(':disabled') &&
            control.getClientRects().length > 0 &&
            getComputedStyle(control).visibility !== 'hidden',
        );
        const first = controls[0];
        const last = controls.at(-1);
        const active = document.activeElement;
        const outsideControls = !controls.some((control) => control === active);
        if (!first || !last) {
          event.preventDefault();
          heading.current?.focus();
        } else if (event.shiftKey && (active === first || outsideControls)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (active === last || outsideControls)) {
          event.preventDefault();
          first.focus();
        }
      }}
      onCancel={(event) => {
        event.stopPropagation();
        event.preventDefault();
        if (!busy) onClose();
      }}
      onPointerDown={(event) => {
        backdropPress.current = outside(event);
        if (backdropPress.current) event.preventDefault();
      }}
      onClick={(event) => {
        if (backdropPress.current && outside(event)) {
          event.preventDefault();
          if (!busy) onClose();
        }
        backdropPress.current = false;
      }}
    >
      <header className="dialog-heading">
        <div>
          <h2 ref={heading} tabIndex={-1} id={`${id}-title`}>
            {title}
          </h2>
          {description ? <p id={`${id}-description`}>{description}</p> : null}
        </div>
        <button
          className="button tertiary"
          type="button"
          aria-label={`Close ${title}`}
          disabled={busy}
          onClick={onClose}
        >
          Close
        </button>
      </header>
      <div className="dialog-body">{open ? children : null}</div>
    </dialog>
  );
}
