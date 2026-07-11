import { describe, it, expect } from 'vitest';
import { parseCsv } from './csv';

describe('parseCsv', () => {
  it('parses a simple grid', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('keeps commas inside quoted fields', () => {
    expect(parseCsv('"Petronas, Trading",VLSFO')).toEqual([['Petronas, Trading', 'VLSFO']]);
  });

  it('unescapes doubled quotes', () => {
    expect(parseCsv('"she said ""hi""",x')).toEqual([['she said "hi"', 'x']]);
  });

  it('keeps newlines inside quoted fields', () => {
    expect(parseCsv('"line1\nline2",b')).toEqual([['line1\nline2', 'b']]);
  });

  it('handles CRLF line endings and a trailing newline', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('strips a leading BOM and drops blank lines', () => {
    expect(parseCsv('﻿a,b\n\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('preserves empty trailing/interior cells', () => {
    expect(parseCsv('1,,3')).toEqual([['1', '', '3']]);
  });
});
