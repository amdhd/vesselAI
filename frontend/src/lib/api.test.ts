import axios from 'axios'
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// These tests exercise the real client — real axios instance, real interceptors —
// and replace only the transport, so the 401 handling under test is the code that
// actually ships. The adapter goes on the shared defaults *before* ./api is
// imported below, because the client builds its instance with axios.create() at
// import time and inherits whatever is there.

interface Captured {
  method?: string
  url?: string
  body: Record<string, unknown> | undefined
  skipAuthRedirect?: boolean
}

const captured: Captured[] = []
let nextReply: { status: number; data?: unknown; networkFailure?: boolean } = { status: 200, data: {} }

function reply(status: number, data?: unknown) {
  nextReply = { status, data }
}

/** What axios does when the request never reaches a server at all. */
function networkFailure() {
  nextReply = { status: 0, networkFailure: true }
}

const originalAdapter = axios.defaults.adapter
let api: typeof import('./api')

beforeAll(async () => {
  const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
    captured.push({
      method: config.method,
      url: config.url,
      body: typeof config.data === 'string' ? JSON.parse(config.data) : config.data,
      skipAuthRedirect: config.skipAuthRedirect,
    })

    const error = new Error('Request failed') as Error & {
      isAxiosError: boolean
      response?: AxiosResponse
      config: InternalAxiosRequestConfig
    }
    error.isAxiosError = true
    error.config = config

    if (nextReply.networkFailure) throw error

    const response = {
      data: nextReply.data,
      status: nextReply.status,
      statusText: '',
      headers: {},
      config,
    } as AxiosResponse
    if (nextReply.status >= 200 && nextReply.status < 300) return response
    error.response = response
    throw error
  }

  axios.defaults.adapter = adapter
  api = await import('./api')
})

afterAll(() => {
  axios.defaults.adapter = originalAdapter
})

beforeEach(() => {
  captured.length = 0
  reply(200, {})
  localStorage.clear()
})

const DEFECT_REPORT = {
  reportText: 'DEFECT REPORT',
  probableCause: 'Wear of the affected component',
  recommendedAction: 'Inspect at next port call',
  partsRequired: 'Standard service kit',
  urgency: 'HIGH',
  reportId: 'DR-9123456-1',
  vesselId: 'vessel-001',
  equipment: 'Main Engine',
  severity: 'high',
  createdAt: '2026-10-08T00:00:00.000Z',
}

describe('knowledgeApi', () => {
  it('sends a defect report under the field names the backend schema requires', async () => {
    reply(200, DEFECT_REPORT)

    await api.knowledgeApi.generateDefectReport({
      vesselId: 'vessel-001',
      equipment: 'Main Engine',
      description: 'Knocking at 60 RPM',
      symptoms: 'Audible knock from cylinder 3',
      severity: 'serious',
    })

    expect(captured).toHaveLength(1)
    expect(captured[0].url).toBe('/knowledge/generate-defect-report')
    // GenerateDefectReportSchema requires `description` and strips unknown keys,
    // so the old `defectDescription` failed validation with a 400.
    expect(captured[0].body?.description).toBe('Knocking at 60 RPM')
    expect(captured[0].body?.defectDescription).toBeUndefined()
    // The form collects this, but no schema field or prompt reads it.
    expect(captured[0].body?.conditions).toBeUndefined()
  })

  it('translates every severity the picker offers into the backend enum', async () => {
    const expected = { minor: 'low', moderate: 'medium', serious: 'high', critical: 'critical' } as const

    for (const severity of ['minor', 'moderate', 'serious', 'critical'] as const) {
      reply(200, DEFECT_REPORT)
      await api.knowledgeApi.generateDefectReport({
        vesselId: 'vessel-001',
        equipment: 'Main Engine',
        description: 'Knocking',
        symptoms: 'Noise',
        severity,
      })
      // Only 'critical' exists in both vocabularies; the other three used to be
      // posted verbatim, so the form 400'd on everything except Critical.
      expect(captured[captured.length - 1].body?.severity).toBe(expected[severity])
    }
  })

  it('posts a handover under `engineer`, which the schema requires', async () => {
    reply(200, {
      reportText: 'ENGINEERING WATCH HANDOVER REPORT',
      summary: 'Watch handover, all systems normal.',
      reportId: 'HO-9123456-1',
      vesselId: 'vessel-001',
      watch: '00-04 / 12-16',
      engineer: '2nd Engineer Rahman',
      createdAt: '2026-10-08T00:00:00.000Z',
    })

    await api.knowledgeApi.createHandover({
      vesselId: 'vessel-001',
      watch: '00-04 / 12-16',
      engineer: '2nd Engineer Rahman',
      ongoingJobs: 'Fuel purifier overhaul',
      abnormalReadings: 'None',
      partsOnOrder: 'None',
    })

    expect(captured[0].url).toBe('/knowledge/handover')
    // HandoverSchema requires `engineer` (min 1). Posting `engineerName` meant
    // every handover failed validation.
    expect(captured[0].body?.engineer).toBe('2nd Engineer Rahman')
    expect(captured[0].body?.engineerName).toBeUndefined()
    expect(captured[0].body?.pendingWorkOrders).toBeUndefined()
  })

  it('unwraps the envelope the backend wraps the document list in', async () => {
    reply(200, {
      vesselId: 'vessel-001',
      vessel: { id: 'vessel-001', name: 'MT Petronas Satu', type: 'tanker' },
      documents: [{ id: 'kdoc-001-01', name: 'Main Engine Operating Manual' }],
      summary: { total: 1, indexed: 1, processing: 0 },
    })

    const documents = await api.knowledgeApi.getDocuments('vessel-001')

    expect(captured[0].url).toBe('/knowledge/documents/vessel-001')
    expect(documents).toEqual([{ id: 'kdoc-001-01', name: 'Main Engine Operating Manual' }])
  })
})

describe('fleetApi.getFleet', () => {
  it('normalizes the flat vessel rows the backend returns into Vessels', async () => {
    reply(200, {
      id: 'fleet-001',
      name: 'Petronas Fleet',
      operator: 'Petronas',
      vessels: [
        {
          id: 'vessel-001',
          name: 'MT Petronas Satu',
          imoNumber: '9123456',
          type: 'tanker',
          flag: 'MY',
          builtYear: 2015,
          dwt: 50000,
          currentLat: 3.14,
          currentLon: 101.2,
          currentSpeed: 12.5,
          status: 'active',
          fleetId: 'fleet-001',
        },
      ],
    })

    const fleet = await api.fleetApi.getFleet()

    expect(fleet.company).toBe('Petronas')
    expect(fleet.totalVessels).toBe(1)
    const vessel = fleet.vessels[0]
    // The backend sends position flat (currentLat/currentLon/currentSpeed) while
    // Vessel nests it; screens reading vessel.position.lat crashed on the
    // undefined that left behind.
    expect(vessel.position).toEqual({
      lat: 3.14,
      lng: 101.2,
      heading: 0,
      speed: 12.5,
      timestamp: expect.any(String),
    })
    expect(vessel.imo).toBe('9123456')
    expect(vessel.yearBuilt).toBe(2015)
    expect(vessel.deadweightTonnage).toBe(50000)
  })
})

describe('replayQueuedMutation', () => {
  const entry = {
    id: 'queued-1',
    method: 'POST' as const,
    url: '/maintenance/work-order',
    data: { title: 'Replace turbocharger bearing' },
    label: 'Create work order',
    timestamp: 0,
    userId: 'user-1',
  }

  it('drops a write the server accepted', async () => {
    reply(201, { id: 'wo-1' })

    await expect(api.replayQueuedMutation(entry)).resolves.toBe('drop')

    expect(captured[0].url).toBe('/maintenance/work-order')
    // Axios lowercases the method on the way out; the entry stores it uppercase.
    expect(captured[0].method).toBe('post')
    expect(captured[0].body).toEqual({ title: 'Replace turbocharger bearing' })
  })

  it('keeps a write the server failed on, so it can be retried', async () => {
    reply(503, { error: 'Work orders unavailable' })

    await expect(api.replayQueuedMutation(entry)).resolves.toBe('keep')
  })

  it('drops a write the server will always reject', async () => {
    reply(400, { error: 'Invalid input' })

    await expect(api.replayQueuedMutation(entry)).resolves.toBe('drop')
  })

  it('keeps a write rejected by an expired token instead of losing it', async () => {
    localStorage.setItem('vm_token', 'expired-token')
    reply(401, { error: 'Unauthorized' })

    await expect(api.replayQueuedMutation(entry)).resolves.toBe('stop')

    // The flush used to treat every status below 500 as final and delete the
    // entry, so a token that expired while the user was offline silently threw
    // their write away.
    expect(localStorage.getItem('vm_token')).toBe('expired-token')
    expect(captured[0].skipAuthRedirect).toBe(true)
  })

  it('stops when the request never reached the server', async () => {
    networkFailure()

    await expect(api.replayQueuedMutation(entry)).resolves.toBe('stop')
  })

  it('still signs the user out on a 401 that is not a replay', async () => {
    localStorage.setItem('vm_token', 'expired-token')
    reply(401, { error: 'Unauthorized' })

    await expect(api.fleetApi.getFleet()).rejects.toThrow()

    // The replay opt-out must not have weakened the ordinary path.
    expect(localStorage.getItem('vm_token')).toBeNull()
  })
})
