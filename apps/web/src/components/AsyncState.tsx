interface AsyncStateProps {
  kind?: 'empty' | 'loading' | 'error' | 'waiting';
  action?: { label: string; onClick(): void };
  description: string;
  eyebrow?: string;
  title: string;
}

export function AsyncState({
  kind = 'empty',
  action,
  description,
  eyebrow = 'Project workspace',
  title,
}: AsyncStateProps) {
  return (
    <section
      className={`state-card state-${kind}`}
      role={kind === 'error' ? 'alert' : 'status'}
      aria-busy={kind === 'loading'}
    >
      <p className="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      <p>{description}</p>
      {action ? (
        <button
          className="button secondary"
          type="button"
          onClick={action.onClick}
        >
          {action.label}
        </button>
      ) : null}
    </section>
  );
}
