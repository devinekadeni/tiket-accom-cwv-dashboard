import type { ReactNode } from 'react';

type Props = {
  /** Shown collapsed and expanded, so it has to name the section. */
  title: string;
  /** The one thing a reader must know even if they never open it. */
  summary: string;
  children: ReactNode;
};

/**
 * Methodology text, collapsed by default.
 *
 * How the numbers were produced decides whether they can be trusted, so it is
 * written out at length - but it filled the viewport above the charts, which
 * meant scrolling past several paragraphs to reach the data on every visit.
 * Native <details> rather than state, so it costs nothing, is keyboard and
 * screen-reader accessible for free, and the browser's find-in-page can still
 * reach the collapsed text.
 *
 * The one-line summary stays visible while collapsed. The honesty this text
 * exists for cannot depend on the reader choosing to expand it.
 */
export function Callout({ title, summary, children }: Props) {
  return (
    <details className="callout">
      {/* A heading inside <summary> is valid, and keeps the section in the
          document outline now that it is no longer a plain h2. */}
      <summary className="callout-summary">
        <h2 className="callout-title">{title}</h2>
        <span className="callout-teaser">{summary}</span>
      </summary>
      <div className="callout-body">{children}</div>
    </details>
  );
}
