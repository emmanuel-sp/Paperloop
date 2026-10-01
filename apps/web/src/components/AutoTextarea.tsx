import { useLayoutEffect, useRef, type ComponentPropsWithoutRef } from 'react';

type AutoTextareaProps = ComponentPropsWithoutRef<'textarea'>;

/** Content grows naturally; long drafts scroll within a bounded editor. */
export function AutoTextarea({
  onChange,
  value,
  defaultValue,
  rows = 2,
  ...props
}: AutoTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (ref.current) resizeEditor(ref.current);
  }, [value, defaultValue]);
  useLayoutEffect(() => {
    const input = ref.current;
    if (!input) return;
    // Wrap changes with container width, including dialogs and narrow layouts.
    let width = input.clientWidth;
    const observer = new ResizeObserver(() => {
      if (input.clientWidth !== width) {
        width = input.clientWidth;
        resizeEditor(input);
      }
    });
    observer.observe(input);
    return () => observer.disconnect();
  }, []);
  return (
    <textarea
      {...props}
      ref={ref}
      rows={rows}
      value={value}
      defaultValue={defaultValue}
      autoComplete={props.autoComplete ?? 'off'}
      onChange={(event) => {
        if (value === undefined) resizeEditor(event.currentTarget);
        onChange?.(event);
      }}
    />
  );
}

function resizeEditor(input: HTMLTextAreaElement) {
  input.style.height = 'auto';
  input.style.height = `${input.scrollHeight}px`;
}
