import { describe, it, expect } from 'vitest'
import {
  formatCurrency,
  formatDistance,
  formatSpeed,
  getCIIColor,
  getStatusColor,
  getCongestionColor,
  calculateCO2,
  toBackendVesselId,
  truncate,
  fileSizeFormat,
} from './utils'

describe('formatCurrency', () => {
  it('abbreviates amounts of a million or more', () => {
    expect(formatCurrency(2_400_000)).toBe('$2.40M')
  })

  it('formats sub-million amounts with thousands separators', () => {
    expect(formatCurrency(45230)).toBe('$45,230')
  })
})

describe('formatDistance / formatSpeed', () => {
  it('appends the maritime unit', () => {
    expect(formatDistance(1234)).toBe('1,234 nm')
    expect(formatSpeed(14.567)).toBe('14.6 kn')
  })
})

describe('getCIIColor', () => {
  it('maps A/B ratings to green', () => {
    expect(getCIIColor('A')).toBe('text-status-green')
    expect(getCIIColor('B')).toBe('text-status-green')
  })

  it('maps C to amber and D/E to red', () => {
    expect(getCIIColor('C')).toBe('text-status-amber')
    expect(getCIIColor('D')).toBe('text-status-red')
    expect(getCIIColor('E')).toBe('text-status-red')
  })
})

describe('getStatusColor', () => {
  it('treats critical/delayed/expired as red', () => {
    expect(getStatusColor('critical')).toBe('text-status-red')
    expect(getStatusColor('delayed')).toBe('text-status-red')
  })

  it('falls back to grey for an unrecognized status', () => {
    expect(getStatusColor('made-up-status')).toBe('text-gray-400')
  })
})

describe('getCongestionColor', () => {
  it('maps congested to the critical badge', () => {
    expect(getCongestionColor('congested')).toBe('badge-critical')
  })
})

describe('calculateCO2', () => {
  it('applies the VLSFO emission factor', () => {
    expect(calculateCO2(100, 'VLSFO')).toBeCloseTo(315.1)
  })

  it('falls back to the HFO factor for an unknown fuel type', () => {
    expect(calculateCO2(10, 'UNKNOWN')).toBeCloseTo(31.14)
  })
})

describe('toBackendVesselId', () => {
  it('maps a frontend mock id to its backend id', () => {
    expect(toBackendVesselId('v1')).toBe('vessel-001')
  })

  it('passes through an id that is not in the map', () => {
    expect(toBackendVesselId('vessel-custom')).toBe('vessel-custom')
  })

  it('uses the fallback when no id is given', () => {
    expect(toBackendVesselId(undefined)).toBe('vessel-001')
    expect(toBackendVesselId(undefined, 'vessel-002')).toBe('vessel-002')
  })
})

describe('truncate', () => {
  it('leaves short strings untouched', () => {
    expect(truncate('MV Merdeka Spirit', 40)).toBe('MV Merdeka Spirit')
  })

  it('truncates and appends an ellipsis past the limit', () => {
    expect(truncate('MV Merdeka Spirit', 5)).toBe('MV Me...')
  })
})

describe('fileSizeFormat', () => {
  it('picks the right unit for the magnitude', () => {
    expect(fileSizeFormat(512)).toBe('512 B')
    expect(fileSizeFormat(2048)).toBe('2.0 KB')
    expect(fileSizeFormat(5 * 1024 * 1024)).toBe('5.0 MB')
  })
})
