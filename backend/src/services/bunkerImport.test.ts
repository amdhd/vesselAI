import { describe, it, expect } from 'vitest';
import { parseBunkerCsv } from './bunkerImport';

const HEADER = 'imoNumber,date,port,supplier,fuelGrade,quantityMt,pricePerMt,sulfurContent';

function assertParsed(result: ReturnType<typeof parseBunkerCsv>) {
  if ('fatal' in result) throw new Error(`expected parsed result, got fatal: ${result.fatal}`);
  return result;
}

describe('parseBunkerCsv', () => {
  it('validates good rows and coerces numeric/date fields', () => {
    const csv = [
      HEADER,
      '9876543,2026-06-01,Port of Singapore,Petronas Trading,VLSFO,1250.5,585.00,0.42',
    ].join('\n');

    const res = assertParsed(parseBunkerCsv(csv));
    expect(res.errors).toHaveLength(0);
    expect(res.rows).toHaveLength(1);
    const row = res.rows[0].data;
    expect(row.imoNumber).toBe('9876543');
    expect(row.quantityMt).toBe(1250.5);
    expect(row.pricePerMt).toBe(585);
    expect(row.sulfurContent).toBe(0.42);
    expect(row.date.toISOString()).toContain('2026-06-01');
  });

  it('returns a fatal error when a required column is missing', () => {
    const res = parseBunkerCsv('imoNumber,date,port\n9876543,2026-06-01,Singapore');
    expect('fatal' in res && res.fatal).toMatch(/Missing required column/);
  });

  it('returns a fatal error for an empty file', () => {
    expect('fatal' in parseBunkerCsv('')).toBe(true);
  });

  it('reports a per-row error for a bad number but keeps valid rows', () => {
    const csv = [
      HEADER,
      '9876543,2026-06-01,Singapore,Petronas,VLSFO,1000,585,0.4', // ok
      '9765432,2026-06-02,Klang,Shell,VLSFO,,590,0.4', // empty quantity -> error
    ].join('\n');

    const res = assertParsed(parseBunkerCsv(csv));
    expect(res.rows).toHaveLength(1);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].row).toBe(3); // header=1, first data=2, bad=3
    expect(res.errors[0].message).toMatch(/quantityMt/);
    expect(res.totalDataRows).toBe(2);
  });

  it('rejects an invalid date and an out-of-range sulfur value', () => {
    const csv = [
      HEADER,
      '9876543,not-a-date,Singapore,Petronas,VLSFO,1000,585,0.4',
      '9765432,2026-06-02,Klang,Shell,VLSFO,1000,585,150', // sulfur > 100
    ].join('\n');

    const res = assertParsed(parseBunkerCsv(csv));
    expect(res.rows).toHaveLength(0);
    expect(res.errors).toHaveLength(2);
    expect(res.errors[0].message).toMatch(/date/i);
    expect(res.errors[1].message).toMatch(/sulfurContent/);
  });

  it('treats an empty sulfurContent as absent (optional)', () => {
    const csv = [HEADER, '9876543,2026-06-01,Singapore,Petronas,VLSFO,1000,585,'].join('\n');
    const res = assertParsed(parseBunkerCsv(csv));
    expect(res.errors).toHaveLength(0);
    expect(res.rows[0].data.sulfurContent).toBeUndefined();
  });

  it('is tolerant of column reordering (matches by header name)', () => {
    const csv = [
      'date,imoNumber,supplier,port,fuelGrade,pricePerMt,quantityMt,sulfurContent',
      '2026-06-01,9876543,Petronas,Singapore,VLSFO,585,1000,0.4',
    ].join('\n');
    const res = assertParsed(parseBunkerCsv(csv));
    expect(res.errors).toHaveLength(0);
    expect(res.rows[0].data.imoNumber).toBe('9876543');
    expect(res.rows[0].data.quantityMt).toBe(1000);
  });
});
