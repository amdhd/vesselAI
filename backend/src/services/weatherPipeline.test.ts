import { describe, expect, it, vi } from 'vitest';
vi.mock('../lib/openMeteo', () => ({ fetchObservation: vi.fn() }));
vi.mock('../lib/prisma', () => ({ prisma: { weatherObservation: { upsert: vi.fn() } } }));
import { fetchObservation } from '../lib/openMeteo';
import { syncWeather } from './weatherPipeline';

describe('weather diagnostics privacy', () => {
  it('returns a stable failure instead of the provider exception text', async () => {
    vi.mocked(fetchObservation).mockRejectedValue(new Error('provider rejected DUMMY_SECRET'));
    const summary = await syncWeather([{ name: 'Dummy point', latitude: 1, longitude: 2 }]);
    expect(summary.failed).toBe(1);
    expect(summary.errors).toEqual([{ location: 'Dummy point', error: 'Weather ingestion failed' }]);
    expect(JSON.stringify(summary)).not.toContain('DUMMY_SECRET');
  });
});
