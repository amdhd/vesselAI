import { describe, it, expect } from 'vitest';
import { parseAisPositionReport } from './aisParser';

const validPositionReport = {
  MessageType: 'PositionReport',
  MetaData: { MMSI: 563123456, ShipName: 'MT KERTEH VENTURE@@@', time_utc: '2026-07-12 00:00:00.000 +0000 UTC' },
  Message: {
    PositionReport: { Latitude: 1.264, Longitude: 103.84, Sog: 12.3, Cog: 210.5, TrueHeading: 208, NavigationalStatus: 0 },
  },
};

describe('parseAisPositionReport', () => {
  it('normalizes a valid PositionReport and cleans the @-padded ship name', () => {
    const pos = parseAisPositionReport(validPositionReport);
    expect(pos).not.toBeNull();
    expect(pos!.mmsi).toBe(563123456);
    expect(pos!.shipName).toBe('MT KERTEH VENTURE');
    expect(pos!.latitude).toBe(1.264);
    expect(pos!.sog).toBe(12.3);
    expect(pos!.heading).toBe(208);
    expect(pos!.timeUtc).toContain('2026-07-12');
  });

  it('returns null for a non-PositionReport message type', () => {
    expect(parseAisPositionReport({ ...validPositionReport, MessageType: 'ShipStaticData' })).toBeNull();
  });

  it('returns null when the PositionReport payload is missing', () => {
    expect(parseAisPositionReport({ MessageType: 'PositionReport', MetaData: { MMSI: 1 }, Message: {} })).toBeNull();
  });

  it('drops out-of-range "unavailable" coordinates (lat 91 / lon 181)', () => {
    const bad = {
      ...validPositionReport,
      Message: { PositionReport: { Latitude: 91, Longitude: 181 } },
    };
    expect(parseAisPositionReport(bad)).toBeNull();
  });

  it('maps the heading "not available" sentinel (511) to null', () => {
    const noHeading = {
      ...validPositionReport,
      Message: { PositionReport: { Latitude: 1.2, Longitude: 103.8, TrueHeading: 511 } },
    };
    expect(parseAisPositionReport(noHeading)!.heading).toBeNull();
  });

  it('returns null for a malformed message', () => {
    expect(parseAisPositionReport({ foo: 'bar' })).toBeNull();
    expect(parseAisPositionReport(null)).toBeNull();
  });
});
