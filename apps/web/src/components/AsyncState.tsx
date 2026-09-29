interface AsyncStateProps {
  action?: { label: string; onClick(): void };
  description: string;
  eyebrow?: string;
  title: string;
}

export function AsyncState({
  action,
  description,
  eyebrow = 'Project workspace',
  title,
}: AsyncStateProps) {
  return (
    <section className="state-card" aria-live="polite">
      <p className="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      <p>{description}</p>
      {action ? (
        <button className="button secondary" type="button" onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
    </section>
  );
}
