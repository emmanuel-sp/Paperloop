import { useId, type ReactNode } from 'react';

interface ControlAttributes {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
}

/** The same association works for inputs, selects, and multiline controls. */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children(attributes: ControlAttributes): ReactNode;
}) {
  const id = useId();
  const descriptions = [hint ? `${id}-hint` : '', error ? `${id}-error` : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint ? (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {children({
        id,
        'aria-describedby': descriptions || undefined,
        'aria-invalid': error ? true : undefined,
      })}
      {error ? (
        <p className="field-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
