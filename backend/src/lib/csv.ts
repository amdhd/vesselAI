/**
 * Minimal RFC-4180 CSV parser — a state machine that correctly handles quoted
 * fields, escaped quotes (""), and commas/newlines embedded inside quotes.
 * Returns a grid of raw string cells; interpretation is the caller's job.
 *
 * Written by hand (rather than pulling a dependency) because it's a small,
 * pure, fully-testable function — and real ERP exports contain exactly these
 * quoting edge cases.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;

  // Strip a leading UTF-8 BOM (Excel loves to add one).
  if (text.charCodeAt(0) === 0xfeff) i = 1;

  for (; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'; // escaped quote
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r') {
      // swallow CR; the following LF ends the row (CRLF)
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      field = '';
      row = [];
    } else {
      field += c;
    }
  }

  // Flush the final field/row if the file didn't end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop fully-blank lines (a single empty cell).
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}
