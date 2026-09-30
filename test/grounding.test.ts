import { describe, expect, it } from 'vitest';
import { checkGrounded, vocabulary } from '../src/server/grounding.js';

const vocab = vocabulary(['Riverside Home Care', 'Home care (domiciliary)', 'Registered Manager', 'ChatGPT']);
const check = (s: string) => checkGrounded(s, vocab, ['ChatGPT'], 400);

describe('checkGrounded', () => {
  it('accepts a sentence built only from their answers', () => {
    expect(check('At Riverside Home Care, care workers may use ChatGPT to draft a job advert.').ok).toBe(
      true,
    );
  });

  it('rejects an invented name, place or product', () => {
    expect(check('At Riverside Home Care, Margaret checks each note.').ok).toBe(false);
    expect(check('Staff in Leeds may use ChatGPT for adverts.').ok).toBe(false);
  });

  it('rejects a tool from the directory they did not choose', () => {
    expect(check('Staff may use otter to transcribe meetings.').ok).toBe(false);
  });

  it('rejects numbers and markup', () => {
    expect(check('This saves 40 percent of time.').ok).toBe(false);
    expect(check('Use **bold** claims.').ok).toBe(false);
    expect(check('[TO DECIDE: x]').ok).toBe(false);
  });

  it('allows a capitalised word at the start of a sentence', () => {
    expect(check('Drafting adverts is fine. Checking is done by a person.').ok).toBe(true);
  });
});

describe('checkGrounded with no tools allowed', () => {
  it('rejects any product name, including short forms', () => {
    expect(checkGrounded('A care worker uses Copilot to draft a note.', vocab, [], 400).ok).toBe(false);
    expect(checkGrounded('A care worker drafts a note, then checks it.', vocab, [], 400).ok).toBe(true);
  });
});
