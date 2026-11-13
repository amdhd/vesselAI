import axios from 'axios'
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('idb-keyval', () => ({ del: vi.fn().mockResolvedValue(undefined) }))

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
  authorization?: string
  webClient?: string
  withCredentials?: boolean
}

const captured: Captured[] = []
let beforeReply: (() => void) | undefined
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
      authorization: config.headers?.Authorization as string | undefined,
      webClient: config.headers?.['X-VesselMind-Client'] as string | undefined,
      withCredentials: config.withCredentials,
    })

    beforeReply?.()
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
  beforeReply = undefined
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
  beforeEach(() => localStorage.setItem('vm_user', JSON.stringify({ id: 'user-1' })))
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
    reply(401, { error: 'Unauthorized' })

    await expect(api.replayQueuedMutation(entry)).resolves.toBe('stop')

    // The flush used to treat every status below 500 as final and delete the
    // entry, so a token that expired while the user was offline silently threw
    // their write away.
    expect(localStorage.getItem('vm_user')).not.toBeNull() // not signed out
    expect(captured[0].skipAuthRedirect).toBe(true)
  })

  it('stops when the request never reached the server', async () => {
    networkFailure()

    await expect(api.replayQueuedMutation(entry)).resolves.toBe('stop')
  })

  it('still signs the user out on a 401 that is not a replay', async () => {
    localStorage.setItem('vm_knowledge_chat_vessel-001', 'private A chat')
    localStorage.setItem('vm_session_id', 'session-a')
    reply(401, { error: 'Unauthorized' })

    await expect(api.fleetApi.getFleet()).rejects.toThrow()

    // The replay opt-out must not have weakened the ordinary path.
    expect(localStorage.getItem('vm_session_id')).toBeNull()
    expect(localStorage.getItem('vm_user')).toBeNull()
    expect(localStorage.getItem('vm_knowledge_chat_vessel-001')).toBeNull()
  })

  it('does not replay a captured prior-account write with the replacement credentials', async () => {
    localStorage.setItem('vm_user', JSON.stringify({ id: 'user-2' }))
    await expect(api.replayQueuedMutation(entry)).resolves.toBe('stop')
    expect(captured).toHaveLength(0)
  })

  it('ignores a late 401 from the previous login instead of clearing the replacement session', async () => {
    localStorage.setItem('vm_session_id', 'session-a')
    reply(401, { error: 'Unauthorized' })
    beforeReply = () => {
      localStorage.setItem('vm_session_id', 'session-b')
    }
    await expect(api.fleetApi.getFleet()).rejects.toThrow()
    expect(localStorage.getItem('vm_session_id')).toBe('session-b')
  })

  it('rechecks queued-write ownership when the async request interceptor runs', async () => {
    const pending = api.replayQueuedMutation(entry)
    localStorage.setItem('vm_user', JSON.stringify({ id: 'user-2' }))
    await expect(pending).resolves.toBe('stop')
    expect(captured).toHaveLength(0)
  })

})

describe('analytics token exchange', () => {
  // The analytics service refuses the login token and accepts only a 5-minute
  // analytics token the backend issues after a live session check. Route the
  // fake transport by URL: the exchange answers with a numbered token, and
  // analytics answers 200 (or what a test sets in analyticsStatus).
  let issued = 0
  let analyticsStatus: number[] = []

  beforeEach(() => {
    issued = 0
    analyticsStatus = []
    api.clearAnalyticsToken()
    localStorage.setItem('vm_user', JSON.stringify({ id: 'user-1' }))
    localStorage.setItem('vm_session_id', 'session-a')
    beforeReply = () => {
      const last = captured[captured.length - 1]
      if (last.url?.includes('/auth/analytics-token')) {
        issued += 1
        nextReply = { status: 200, data: { token: `analytics-${issued}`, expiresIn: 300 } }
      } else {
        nextReply = { status: analyticsStatus.shift() ?? 200, data: { vessels: 1 } }
      }
    }
  })
  afterEach(() => vi.useRealTimers())

  const exchanges = () => captured.filter((c) => c.url?.includes('/auth/analytics-token'))
  const analyticsCalls = () => captured.filter((c) => c.url?.startsWith('/api/analytics/'))

  it('sends analytics the exchanged token, never the login token', async () => {
    await api.analyticsApi.getSummary()
    expect(exchanges()).toHaveLength(1)
    // The exchange is a normal API call: authenticated by the session cookie,
    // so it carries no token, only the web client header.
    expect(exchanges()[0].authorization).toBeUndefined()
    expect(exchanges()[0].webClient).toBe('web')
    expect(analyticsCalls()[0].authorization).toBe('Bearer analytics-1')
  })

  it('fetches one token for the four parallel requests the page makes', async () => {
    await Promise.all([
      api.analyticsApi.getSummary(),
      api.analyticsApi.getVesselTypes(),
      api.analyticsApi.getTopVessels(),
      api.analyticsApi.getIdling(),
    ])
    expect(exchanges()).toHaveLength(1)
    expect(analyticsCalls().map((c) => c.authorization)).toEqual(Array(4).fill('Bearer analytics-1'))
  })

  it('reuses the token until shortly before it expires, then fetches a new one', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-11T00:00:00Z'))
    await api.analyticsApi.getSummary()
    vi.setSystemTime(new Date('2026-11-11T00:04:00Z')) // 4 of 5 minutes: still fresh
    await api.analyticsApi.getSummary()
    expect(exchanges()).toHaveLength(1)

    vi.setSystemTime(new Date('2026-11-11T00:04:40Z')) // inside the 30s refresh margin
    await api.analyticsApi.getSummary()
    expect(exchanges()).toHaveLength(2)
    expect(analyticsCalls()[2].authorization).toBe('Bearer analytics-2')
  })

  it('does not carry a token over to a new login session', async () => {
    await api.analyticsApi.getSummary()
    localStorage.setItem('vm_session_id', 'session-b')
    await api.analyticsApi.getSummary()
    expect(exchanges()).toHaveLength(2)
  })

  it('on a 401 from analytics, refreshes the token and retries once, without signing out', async () => {
    analyticsStatus = [401]
    const summary = await api.analyticsApi.getSummary()
    expect(summary).toEqual({ vessels: 1 })
    expect(exchanges()).toHaveLength(2)
    expect(analyticsCalls().map((c) => c.authorization)).toEqual(['Bearer analytics-1', 'Bearer analytics-2'])
    expect(localStorage.getItem('vm_session_id')).toBe('session-a') // not signed out
  })

  it('gives up after one retry, and still does not sign out', async () => {
    // Two 401s in a row mean analytics rejects tokens the backend issues, which
    // is a configuration fault (secret or audience), not an ended session.
    analyticsStatus = [401, 401]
    await expect(api.analyticsApi.getSummary()).rejects.toThrow()
    expect(analyticsCalls()).toHaveLength(2)
    expect(localStorage.getItem('vm_session_id')).toBe('session-a') // not signed out
  })

  it('signs out when the exchange itself is refused: the login session was revoked', async () => {
    beforeReply = () => {
      nextReply = { status: 401, data: { error: 'Session revoked' } }
    }
    await expect(api.analyticsApi.getSummary()).rejects.toThrow()
    expect(analyticsCalls()).toHaveLength(0)
    expect(localStorage.getItem('vm_session_id')).toBeNull()
  })
})

describe('the session is a cookie, not a token the page holds', () => {
  it('sends every API request with credentials and the web client header, and no token', async () => {
    localStorage.setItem('vm_user', JSON.stringify({ id: 'user-1' }))
    localStorage.setItem('vm_session_id', 'session-a')
    reply(200, { id: 'f', name: 'F', operator: 'O', vessels: [] })
    await api.fleetApi.getFleet()
    expect(captured[0]).toMatchObject({ withCredentials: true, webClient: 'web' })
    expect(captured[0].authorization).toBeUndefined()
  })

  it('streams chat with the cookie (credentials: include) and the web client header', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response('data: [DONE]\n\n', { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    try {
      await api.knowledgeApi.chatStream({ vesselId: 'vessel-001', message: 'hi', conversationHistory: [] })
      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(init.credentials).toBe('include')
      const headers = init.headers as Record<string, string>
      expect(headers['X-VesselMind-Client']).toBe('web')
      expect(headers.Authorization).toBeUndefined()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('logout asks the backend to clear the cookie, since script cannot', async () => {
    reply(204)
    await api.authApi.logout()
    expect(captured[0]).toMatchObject({ method: 'post', url: '/auth/logout', webClient: 'web' })
  })
})
