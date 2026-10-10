import { describe, expect, it } from 'vitest';

import { InlineThinkSplitter, type InlineThinkPiece } from '../../../src/event-bridge/inline-think.js';

/**
 * MiniMax-M3 writes its reasoning inline in content, wrapped in `<think>`
 * tags, instead of on a separate lane. The splitter must re-lane that leading
 * block without touching a single character: everything fed in comes back out,
 * only the lane labels differ, and tags may straddle chunk boundaries in any
 * way a tokenizer pleases.
 */

const join = (pieces: InlineThinkPiece[], kind: 'thinking' | 'text') =>
  pieces
    .filter((piece) => piece.kind === kind)
    .map((piece) => piece.delta)
    .join('');

const joinAll = (pieces: InlineThinkPiece[]) =>
  pieces.map((piece) => piece.delta).join('');

/** The recognized markers come out as lane labels, not payload: strip them
 *  the way the splitter does (leading whitespace dies with the opening tag). */
const withoutMarkers = (input: string) =>
  input.replace(/^\s*<think>/, '').replace('</think>', '');

/** Feed the whole stream as one chunk. */
const once = (text: string) => [...new InlineThinkSplitter().feed(text)];

/** Feed character by character: the worst-case tokenizer. */
const perChar = (text: string): InlineThinkPiece[] => {
  const splitter = new InlineThinkSplitter();
  return text
    .split('')
    .flatMap((ch) => splitter.feed(ch));
};

describe('inline think splitter', () => {
  const cases: { name: string; input: string; thinking: string; text: string }[] = [
    {
      name: 'block then answer',
      input: '<think>why</think>The answer is 4.',
      thinking: 'why',
      text: 'The answer is 4.',
    },
    {
      name: 'no block at all',
      input: 'Just the answer.',
      thinking: '',
      text: 'Just the answer.',
    },
    {
      name: 'leading whitespace before the block',
      input: '\n\n<think>plan</think>Done.',
      thinking: 'plan',
      text: 'Done.',
    },
    {
      name: 'empty thinking block',
      input: '<think></think>Answer.',
      thinking: '',
      text: 'Answer.',
    },
    {
      name: 'block spanning the whole output',
      input: '<think>only reasoning, never closed by prose',
      thinking: 'only reasoning, never closed by prose',
      text: '',
    },
    {
      name: 'multiline reasoning',
      input: '<think>line one\nline two</think>\n\nAnswer.',
      thinking: 'line one\nline two',
      text: '\n\nAnswer.',
    },
    {
      name: 'plain text that merely starts with a bracket',
      input: '<b>bold</b> not thinking',
      thinking: '',
      text: '<b>bold</b> not thinking',
    },
  ];

  for (const { name, input, thinking, text } of cases) {
    it(`whole-chunk: ${name}`, () => {
      const pieces = once(input);
      expect(join(pieces, 'thinking')).toBe(thinking);
      expect(join(pieces, 'text')).toBe(text);
      expect(joinAll(pieces)).toBe(withoutMarkers(input));
    });

    it(`char-by-char: ${name}`, () => {
      const pieces = perChar(input);
      expect(join(pieces, 'thinking')).toBe(thinking);
      expect(join(pieces, 'text')).toBe(text);
    });
  }

  it('a mid-reply think tag is the model talking about tags, not reasoning', () => {
    const pieces = once('Answer. <think>quoted</think> tail');
    expect(join(pieces, 'thinking')).toBe('');
    expect(joinAll(pieces)).toBe('Answer. <think>quoted</think> tail');
  });

  it('round-trips a tokenizer that emits the tags one character per chunk', () => {
    const input = '<think>a</think>b';
    const pieces = perChar(input);
    expect(join(pieces, 'thinking')).toBe('a');
    expect(join(pieces, 'text')).toBe('b');
  });

  it('never loses or duplicates characters across arbitrary chunk splits', () => {
    const input = '<think>reasoning here</think>then the visible answer';
    for (const size of [1, 2, 3, 5, 7, 11, 64]) {
      const splitter = new InlineThinkSplitter();
      const chunks: string[] = [];
      for (let i = 0; i < input.length; i += size) chunks.push(input.slice(i, i + size));
      const pieces = chunks.flatMap((chunk) => splitter.feed(chunk));
      expect(
        joinAll(pieces),
        `chunk size ${size} must round-trip`,
      ).toBe(withoutMarkers(input));
      expect(join(pieces, 'thinking')).toBe('reasoning here');
      expect(join(pieces, 'text')).toBe('then the visible answer');
    }
  });

  it('a whitespace-only prologue that never becomes a tag lands in text', () => {
    const splitter = new InlineThinkSplitter();
    const pieces = [...splitter.feed('   '), ...splitter.feed('answer')];
    expect(joinAll(pieces)).toBe('   answer');
    expect(join(pieces, 'text')).toBe('   answer');
    expect(splitter.settled).toBe(true);
  });

  it('a tag held across the close boundary waits for the rest', () => {
    const splitter = new InlineThinkSplitter();
    const first = splitter.feed('<think>abc</thi');
    // "</thi" may still grow into the closing tag — nothing may leave yet on
    // the thinking lane for that held tail, but the reasoning before it can.
    expect(join(first, 'thinking')).toBe('abc');
    const rest = [...splitter.feed('nk>answer')];
    expect(join(first.concat(rest), 'thinking')).toBe('abc');
    expect(join(first.concat(rest), 'text')).toBe('answer');
  });
});
