// Splits policy text into runs of plain, bold and [TO DECIDE] text. Used by
// the on-screen renderer and the Word export, so both agree.

export interface Run {
  text: string;
  bold?: boolean;
  gap?: boolean;
}

export function runs(text: string): Run[] {
  const out: Run[] = [];
  let bold = false;
  // A gap can sit inside a bold phrase, so bold is tracked across the pieces.
  for (const part of text.split(/(\[TO DECIDE: [^\]]*\]|\*\*)/g)) {
    if (part === '**') bold = !bold;
    else if (part.startsWith('[TO DECIDE:')) out.push({ text: part, gap: true, bold });
    else if (part) out.push({ text: part, bold });
  }
  return out;
}
