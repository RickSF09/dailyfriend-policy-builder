// Writes a Word policy for each persona to eval/out/, using the fixed wording
// only (no model call). For reviewing the clause library, e.g. with a DPO:
//
//   npm run samples

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Packer } from 'docx';
import { assemblePolicy } from '../src/shared/policy/assemble.js';
import { buildDocx } from '../src/web/docx.js';
import { PERSONAS } from './personas.js';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
fs.mkdirSync(out, { recursive: true });
for (const p of PERSONAS) {
  const file = path.join(out, `${p.id}.docx`);
  fs.writeFileSync(file, await Packer.toBuffer(buildDocx(assemblePolicy(p.answers))));
  console.log(path.relative(process.cwd(), file));
}
