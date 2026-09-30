// Renders policy text: **bold** and [TO DECIDE: ...] gaps. Text only, never
// HTML, so nothing typed into the interview can inject markup.

import type { ReactNode } from 'react';
import { runs } from '../shared/policy/runs';

export function Rich({ text }: { text: string }): ReactNode {
  return runs(text).map((r, i) =>
    r.gap ? (
      <mark key={i} className="gap-marker">
        {r.text}
      </mark>
    ) : r.bold ? (
      <strong key={i}>{r.text}</strong>
    ) : (
      <span key={i}>{r.text}</span>
    ),
  );
}
