import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { parseCsv } from '../lib/csv';

// Header names are matched case-insensitively. sulfurContent is optional.
const REQUIRED_COLUMNS = ['imonumber', 'date', 'port', 'supplier', 'fuelgrade', 'quantitymt', 'pricepermt'];

// Empty CSV cells must fail required-number validation (not coerce to 0), so
// map '' -> undefined before coercion; NaN/Infinity are rejected by .finite().
const requiredNumber = z.preprocess(
  (v) => (v === '' || v == null ? undefined : v),
  z.coerce.number().finite()
);

const BunkerRowSchema = z.object({
  imoNumber: z.string().trim().min(1, 'imoNumber is required'),
  date: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.coerce.date()),
  port: z.string().trim().min(1, 'port is required'),
  supplier: z.string().trim().min(1, 'supplier is required'),
  fuelGrade: z.string().trim().min(1, 'fuelGrade is required'),
  quantityMt: requiredNumber.refine((v) => v > 0, 'quantityMt must be greater than 0'),
  pricePerMt: requiredNumber.refine((v) => v >= 0, 'pricePerMt must be 0 or greater'),
  sulfurContent: z
    .preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().finite().optional())
    .refine((v) => v === undefined || (v >= 0 && v <= 100), 'sulfurContent must be between 0 and 100'),
});

export type ParsedBunkerRow = z.infer<typeof BunkerRowSchema>;

export interface RowError {
  row: number; // 1-based CSV line number (header is row 1); 0 = file-level
  message: string;
}

export interface ParsedCsvResult {
  rows: { row: number; data: ParsedBunkerRow }[];
  errors: RowError[];
  totalDataRows: number;
}

/**
 * Pure parse + per-row validation: CSV text -> validated rows + per-row errors.
 * No DB access, so the whole parse/validate path is unit-testable. Returns a
 * `fatal` when the file can't be processed at all (empty, or missing a required
 * column) vs. per-row errors when individual rows are bad — a real importer has
 * to distinguish "this file is unusable" from "row 7 has a typo".
 */
export function parseBunkerCsv(csvText: string): ParsedCsvResult | { fatal: string } {
  const grid = parseCsv(csvText);
  if (grid.length === 0) return { fatal: 'File is empty' };

  const header = grid[0].map((h) => h.trim().toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) return { fatal: `Missing required column(s): ${missing.join(', ')}` };

  const col = {
    imoNumber: header.indexOf('imonumber'),
    date: header.indexOf('date'),
    port: header.indexOf('port'),
    supplier: header.indexOf('supplier'),
    fuelGrade: header.indexOf('fuelgrade'),
    quantityMt: header.indexOf('quantitymt'),
    pricePerMt: header.indexOf('pricepermt'),
    sulfurContent: header.indexOf('sulfurcontent'),
  };

  const rows: { row: number; data: ParsedBunkerRow }[] = [];
  const errors: RowError[] = [];
  let totalDataRows = 0;

  grid.slice(1).forEach((cells, i) => {
    if (cells.every((c) => c.trim() === '')) return; // skip blank line
    totalDataRows += 1;
    const rowNum = i + 2; // header is row 1

    const raw = {
      imoNumber: cells[col.imoNumber] ?? '',
      date: cells[col.date] ?? '',
      port: cells[col.port] ?? '',
      supplier: cells[col.supplier] ?? '',
      fuelGrade: cells[col.fuelGrade] ?? '',
      quantityMt: cells[col.quantityMt] ?? '',
      pricePerMt: cells[col.pricePerMt] ?? '',
      sulfurContent: col.sulfurContent >= 0 ? cells[col.sulfurContent] ?? '' : '',
    };

    const result = BunkerRowSchema.safeParse(raw);
    if (result.success) {
      rows.push({ row: rowNum, data: result.data });
    } else {
      errors.push({
        row: rowNum,
        message: result.error.issues.map((x) => `${x.path.join('.') || 'row'}: ${x.message}`).join('; '),
      });
    }
  });

  return { rows, errors, totalDataRows };
}

export interface ImportSummary {
  totalRows: number;
  imported: number;
  skipped: number;
  errors: RowError[];
}

/**
 * Full import: validate the CSV, resolve referenced vessels by IMO in a single
 * fleet-scoped query (no per-row N+1), reject rows for vessels outside the
 * caller's fleet, then bulk-insert the good rows. Returns a summary so the
 * caller sees exactly what imported and why anything was skipped.
 */
export async function importBunkerCsv(
  fleetId: string | null | undefined,
  csvText: string
): Promise<ImportSummary | { fatal: string }> {
  const parsed = parseBunkerCsv(csvText);
  if ('fatal' in parsed) return parsed;

  const errors: RowError[] = [...parsed.errors];

  // One query for all referenced vessels, scoped to the caller's fleet — this
  // enforces tenant isolation (a foreign fleet's IMO simply isn't found) and
  // avoids a lookup per row.
  const imoNumbers = [...new Set(parsed.rows.map((r) => r.data.imoNumber))];
  const vessels = fleetId
    ? await prisma.vessel.findMany({ where: { imoNumber: { in: imoNumbers }, fleetId } })
    : [];
  const vesselByImo = new Map(vessels.map((v) => [v.imoNumber, v]));

  const toCreate: {
    vesselId: string;
    date: Date;
    port: string;
    supplier: string;
    fuelGrade: string;
    quantity: number;
    pricePerMt: number;
    totalCost: number;
    sulfurContent: number | null;
  }[] = [];

  for (const { row, data } of parsed.rows) {
    const vessel = vesselByImo.get(data.imoNumber);
    if (!vessel) {
      errors.push({ row, message: `Vessel IMO ${data.imoNumber} not found in your fleet — row skipped` });
      continue;
    }
    toCreate.push({
      vesselId: vessel.id,
      date: data.date,
      port: data.port,
      supplier: data.supplier,
      fuelGrade: data.fuelGrade,
      quantity: data.quantityMt,
      pricePerMt: data.pricePerMt,
      totalCost: Math.round(data.quantityMt * data.pricePerMt * 100) / 100,
      sulfurContent: data.sulfurContent ?? null,
    });
  }

  if (toCreate.length) {
    await prisma.bunkerRecord.createMany({ data: toCreate });
  }

  return {
    totalRows: parsed.totalDataRows,
    imported: toCreate.length,
    skipped: parsed.totalDataRows - toCreate.length,
    errors,
  };
}
