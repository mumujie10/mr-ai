/**
 * Splits an inline `<think>…</think>` block out of a text delta stream.
 *
 * Some models (measured: MiniMax-M3 over an OpenAI-compatible channel) emit
 * their reasoning inline in `content`, wrapped in `<think>` tags, instead of
 * on a separate reasoning field or delta kind. Downstream, everything the
 * bridge sees on the text lane renders as the answer, so the reasoning shows
 * up inside the reply bubble. This splitter turns that leading block back
 * into a thinking lane, token by token.
 *
 * Contract (mirrors the streaming rules the app lives by — no dropped,
 * duplicated, reordered or rewritten characters):
 * - Only a block at the very start of the assistant output is recognized
 *   (leading whitespace allowed). A `<think>` that appears mid-reply is the
 *   model talking about tags, not reasoning, and passes through untouched.
 * - Tags may straddle chunk boundaries arbitrarily, including a lone "<"
 *   per chunk and the closing tag split across many.
 * - `feed` output concatenated equals its input concatenated; only the lane
 *   labels differ.
 */

export type InlineThinkPiece =
  | { kind: 'thinking'; delta: string }
  | { kind: 'text'; delta: string };

const OPEN_TAG = '<think>';
const CLOSE_TAG = '</think>';

type State =
  /** Nothing seen yet, or only whitespace: the lane is still undecided. */
  | 'opening'
  /** Between the tags: everything goes to the thinking lane. */
  | 'inside'
  /** The block (or its absence) is settled; straight pass-through. */
  | 'done';

export class InlineThinkSplitter {
  private state: State = 'opening';
  /**
   * Opening: whitespace plus whatever may still grow into OPEN_TAG.
   * Inside: a tail that may still grow into CLOSE_TAG.
   * Always flushed into the output when the state resolves.
   */
  private buffer = '';

  feed(delta: string): InlineThinkPiece[] {
    if (delta === '') return [];
    if (this.state === 'done') return [{ kind: 'text', delta }];
    if (this.state === 'inside') return this.emitInside(delta);
    return this.emitOpening(delta);
  }

  /** True once the splitter has decided the output carries no inline block. */
  get settled(): boolean {
    return this.state === 'done';
  }

  /**
   * The lane is undecided: `buffer` holds everything seen so far (whitespace
   * prologue plus a possible partial OPEN_TAG). Either it completes into the
   * tag — the prologue is dropped and the rest streams as thinking — or the
   * whole buffer was ordinary text and the state settles.
   */
  private emitOpening(delta: string): InlineThinkPiece[] {
    this.buffer += delta;
    // Leading whitespace never decides the lane on its own and dies with the
    // tag when one is recognized; it lands in the answer otherwise.
    const withoutSpaces = this.buffer.replace(/^[ \t\r\n]+/, '');
    if (OPEN_TAG.startsWith(withoutSpaces)) {
      // Possibly still becoming the tag (or exactly it): keep holding.
      if (withoutSpaces === OPEN_TAG) {
        this.state = 'inside';
        this.buffer = '';
      }
      return [];
    }
    if (withoutSpaces.startsWith(OPEN_TAG)) {
      this.state = 'inside';
      const rest = withoutSpaces.slice(OPEN_TAG.length);
      this.buffer = '';
      return this.emitInside(rest);
    }
    return this.flushAsText();
  }

  /**
   * Inside the block: everything streams to thinking except a held tail that
   * may still grow into CLOSE_TAG.
   */
  private emitInside(delta: string): InlineThinkPiece[] {
    this.buffer += delta;
    const close = this.buffer.indexOf(CLOSE_TAG);
    if (close >= 0) {
      const thinking = this.buffer.slice(0, close);
      const rest = this.buffer.slice(close + CLOSE_TAG.length);
      this.state = 'done';
      this.buffer = '';
      const pieces: InlineThinkPiece[] = [];
      if (thinking !== '') pieces.push({ kind: 'thinking', delta: thinking });
      if (rest !== '') pieces.push({ kind: 'text', delta: rest });
      return pieces;
    }
    const hold = longestClosePrefix(this.buffer);
    const emit = this.buffer.slice(0, this.buffer.length - hold);
    this.buffer = this.buffer.slice(this.buffer.length - hold);
    return emit === '' ? [] : [{ kind: 'thinking', delta: emit }];
  }

  private flushAsText(): InlineThinkPiece[] {
    this.state = 'done';
    const out = this.buffer;
    this.buffer = '';
    return out === '' ? [] : [{ kind: 'text', delta: out }];
  }
}

/** Length of the longest suffix of `text` that is a proper prefix of CLOSE_TAG. */
function longestClosePrefix(text: string): number {
  const max = Math.min(text.length, CLOSE_TAG.length - 1);
  for (let length = max; length > 0; length--) {
    if (CLOSE_TAG.startsWith(text.slice(text.length - length))) return length;
  }
  return 0;
}
