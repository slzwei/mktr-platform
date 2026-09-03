import { csvCell, toCsv } from '../../src/utils/csv.js';

describe('server csv', () => {
  test('neutralises formula markers, including behind whitespace/control chars, and quotes per RFC-4180', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('  +1')).toBe("'  +1");
    expect(csvCell('\t-2')).toBe("'\t-2");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('multi\nline')).toBe('"multi\nline"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(0)).toBe('0');
    expect(csvCell(['a', 'b'])).toBe('"[""a"",""b""]"');
  });

  test('toCsv guards header names too and ends every line with CRLF', () => {
    const out = toCsv([{ name: '=label', get: (r) => r.a }, { name: 'b', get: (r) => r.b }], [{ a: '-x', b: 1 }, { a: 'y', b: null }]);
    expect(out).toBe(`'=label,b\r\n'-x,1\r\ny,\r\n`);
  });
});
