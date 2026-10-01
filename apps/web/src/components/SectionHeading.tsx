import type { ReactNode } from 'react';

export function SectionHeading({
  title,
  description,
  eyebrow,
  action,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2>{title}</h2>
        {description ? (
          <p className="section-description">{description}</p>
        ) : null}
      </div>
      {action ? <div className="heading-action">{action}</div> : null}
    </div>
  );
}
