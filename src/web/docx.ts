// The Word download, built in the browser from the same PolicyDoc the page
// shows. Loaded on demand, so the interview does not pay for it.

import {
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { runs } from '../shared/policy/runs.js';
import {
  type Action,
  type Block,
  DISCLAIMER,
  type PolicyDoc,
  type Resource,
} from '../shared/policy/types.js';

const PRIORITY_TITLE: Record<Action['priority'], string> = {
  now: 'Do now',
  soon: 'Do soon',
  later: 'Do later',
};

function textRuns(text: string, extra: { bold?: boolean; size?: number } = {}): TextRun[] {
  return runs(text).map(
    (r) =>
      new TextRun({
        text: r.text,
        bold: r.bold || extra.bold,
        size: extra.size,
        highlight: r.gap ? 'yellow' : undefined,
      }),
  );
}

function cell(text: string, header = false): TableCell {
  return new TableCell({
    children: [new Paragraph({ children: textRuns(text, { bold: header }) })],
    shading: header ? { type: ShadingType.CLEAR, color: 'auto', fill: 'EAF1FC' } : undefined,
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
  });
}

function blocks(list: Block[]): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  for (const b of list) {
    if (b.kind === 'p') out.push(new Paragraph({ children: textRuns(b.text), spacing: { after: 140 } }));
    if (b.kind === 'heading') {
      out.push(
        new Paragraph({
          children: textRuns(b.text),
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 160 },
        }),
      );
    }
    if (b.kind === 'bullets') {
      for (const item of b.items) {
        out.push(new Paragraph({ children: textRuns(item), bullet: { level: 0 }, spacing: { after: 80 } }));
      }
    }
    if (b.kind === 'table') {
      out.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({ children: b.head.map((h) => cell(h, true)), tableHeader: true }),
            ...b.rows.map((r) => new TableRow({ children: r.map((c) => cell(c)) })),
          ],
        }),
      );
      out.push(new Paragraph({ text: '', spacing: { after: 140 } }));
    }
  }
  return out;
}

function actions(list: Action[]): Paragraph[] {
  const out: Paragraph[] = [];
  for (const priority of ['now', 'soon', 'later'] as const) {
    const own = list.filter((a) => a.priority === priority);
    if (!own.length) continue;
    out.push(new Paragraph({ text: PRIORITY_TITLE[priority], heading: HeadingLevel.HEADING_2 }));
    for (const a of own) {
      out.push(
        new Paragraph({ children: textRuns(`☐ ${a.title}`, { bold: true }), spacing: { before: 120 } }),
      );
      out.push(new Paragraph({ children: textRuns(a.why), spacing: { after: a.link ? 40 : 120 } }));
      if (a.link) {
        out.push(
          new Paragraph({
            spacing: { after: 120 },
            children: [
              new TextRun({ text: 'Read more: ' }),
              new ExternalHyperlink({
                link: a.link.url,
                children: [new TextRun({ text: a.link.label, style: 'Hyperlink' })],
              }),
            ],
          }),
        );
      }
    }
  }
  return out;
}

function resources(list: Resource[]): Paragraph[] {
  if (!list.length) return [];
  return [
    new Paragraph({
      text: 'Free help from DailyFriend',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 240 },
    }),
    ...list.map(
      (r) =>
        new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 80 },
          children: [
            new ExternalHyperlink({
              link: r.url,
              children: [new TextRun({ text: r.label, style: 'Hyperlink' })],
            }),
            new TextRun({ text: `: ${r.text}` }),
          ],
        }),
    ),
  ];
}

export function buildDocx(doc: PolicyDoc): Document {
  const children: (Paragraph | Table)[] = [
    new Paragraph({ text: 'AI use policy', heading: HeadingLevel.TITLE }),
    new Paragraph({ children: textRuns(doc.orgName, { bold: true, size: 32 }), spacing: { after: 200 } }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: doc.meta.map(([k, v]) => new TableRow({ children: [cell(k, true), cell(v)] })),
    }),
    new Paragraph({ text: '', spacing: { after: 200 } }),
  ];
  doc.sections.forEach((s, i) => {
    children.push(
      new Paragraph({
        text: `${i + 1}. ${s.title}`,
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 240 },
      }),
    );
    children.push(...blocks(s.blocks));
  });

  children.push(
    new Paragraph({
      children: textRuns(doc.summary.title),
      heading: HeadingLevel.HEADING_1,
      pageBreakBefore: true,
    }),
    new Paragraph({
      children: textRuns('Print this page and put it where people work.', {}),
      spacing: { after: 200 },
    }),
    ...blocks(doc.summary.blocks),
    new Paragraph({
      text: 'Action plan: before this policy is true',
      heading: HeadingLevel.HEADING_1,
      pageBreakBefore: true,
    }),
    new Paragraph({
      children: textRuns(
        'What your answers showed still needs doing. This list is for you, not part of the policy itself.',
      ),
      spacing: { after: 200 },
    }),
    ...actions(doc.actions),
    ...resources(doc.resources),
    new Paragraph({
      children: [new TextRun({ text: DISCLAIMER, italics: true, size: 18 })],
      spacing: { before: 400 },
    }),
  );

  return new Document({
    creator: 'DailyFriend AI policy builder',
    title: `AI use policy – ${doc.orgName}`,
    styles: { default: { document: { run: { font: 'Arial', size: 22 } } } },
    sections: [{ children }],
  });
}

export async function downloadDocx(doc: PolicyDoc): Promise<void> {
  const blob = await Packer.toBlob(buildDocx(doc));
  const safe =
    doc.orgName
      .replace(/\[.*?\]/g, '')
      .replace(/[^\p{L}\p{N} &'-]/gu, '')
      .trim() || 'organisation';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `AI use policy - ${safe}.docx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
