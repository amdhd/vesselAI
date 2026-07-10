/// <reference types="vite/client" />
import axios from 'axios'
import { offlineQueue } from './offlineQueue'
import type {
  AuthResponse,
  User,
  Fleet,
  Vessel,
  RouteOptimization,
  Voyage,
  Equipment,
  SensorReading,
  WorkOrder,
  CIIData,
  ETSData,
  PortCongestion,
  KnowledgeDocument,
  DefectReport,
  HandoverReport,
  SireDocument,
  SireFinding,
  Notification,
  MaintenanceAlert,
  VoyageHistoryRecord,
} from './types'

const BASE_URL = (import.meta.env.VITE_API_URL as string) || '/api'

const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
})

// Request interceptor: attach token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('vm_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Response interceptor: handle 401
api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('vm_token')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  },
)

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const authApi = {
  login: async (email: string, password: string): Promise<AuthResponse> => {
    const { data } = await api.post<AuthResponse>('/auth/login', { email, password })
    return data
  },
  register: async (name: string, email: string, password: string, company: string): Promise<AuthResponse> => {
    const { data } = await api.post<AuthResponse>('/auth/register', { name, email, password, company })
    return data
  },
  getMe: async (): Promise<User> => {
    const { data } = await api.get<User>('/auth/me')
    return data
  },
}

// ─── Fleet ────────────────────────────────────────────────────────────────────

export const fleetApi = {
  getFleet: async (): Promise<Fleet> => {
    const { data } = await api.get<Fleet>('/fleet')
    return data
  },
  getVessel: async (id: string): Promise<Vessel> => {
    const { data } = await api.get<Vessel>(`/fleet/vessels/${id}`)
    return data
  },
}

// ─── Voyage ───────────────────────────────────────────────────────────────────

export interface RouteOptimizeParams {
  vesselId: string
  departurePort: string
  destinationPort: string
  departureDate: string
  cargoLoad: number
  speedPreference: 'eco' | 'normal' | 'fast'
}

// UI speed preference labels don't match the backend's OptimizeRouteSchema enum
// ('economic' | 'fast' | 'optimal') — translate at the API boundary rather than
// changing the user-facing copy.
const SPEED_PREFERENCE_TO_BACKEND = {
  eco: 'economic',
  normal: 'optimal',
  fast: 'fast',
} as const

export const voyageApi = {
  optimizeRoute: async (params: RouteOptimizeParams): Promise<RouteOptimization> => {
    const { data } = await api.post<RouteOptimization>('/voyage/optimize-route', {
      ...params,
      speedPreference: SPEED_PREFERENCE_TO_BACKEND[params.speedPreference],
    })
    return data
  },
  getHistory: async (vesselId: string): Promise<VoyageHistoryRecord[]> => {
    const { data } = await api.get<VoyageHistoryRecord[]>(`/voyage/history/${vesselId}`)
    return data
  },
  getActive: async (fleetId: string): Promise<Voyage[]> => {
    // Backend wraps the list in { fleetId, activeVoyages }, not a bare array.
    const { data } = await api.get<{ activeVoyages: Voyage[] }>(`/voyage/active/${fleetId}`)
    return data.activeVoyages
  },
  predictEta: async (params: { vesselId: string; voyageId: string }) => {
    const { data } = await api.post('/voyage/predict-eta', params)
    return data
  },
  generateAgentMessage: async (params: {
    portCallId: string
    type: string
    vesselId: string
    portName?: string
  }) => {
    // Backend schema expects messageType/portName, not type/portCallId.
    const { data } = await api.post<{ subject: string; body: string; recipient: string }>(
      '/voyage/generate-agent-message',
      { vesselId: params.vesselId, messageType: params.type, portName: params.portName },
    )
    return { subject: data.subject, body: data.body, to: data.recipient }
  },
}

// ─── Maintenance ──────────────────────────────────────────────────────────────

export const maintenanceApi = {
  getEquipment: async (vesselId: string): Promise<Equipment[]> => {
    // Backend wraps the list in { vesselId, equipment, summary }, not a bare array.
    const { data } = await api.get<{ equipment: Equipment[] }>(`/maintenance/equipment/${vesselId}`)
    return data.equipment
  },
  getSensorData: async (equipmentId: string, days: number): Promise<SensorReading[]> => {
    // Backend wraps the list in { equipmentId, equipment, sensorData, ... }, not a bare array.
    const { data } = await api.get<{ sensorData: SensorReading[] }>(`/maintenance/sensor-data/${equipmentId}?days=${days}`)
    return data.sensorData
  },
  analyzeAnomaly: async (params: { equipmentId: string; vesselId: string }): Promise<{ analysis: string }> => {
    const { data } = await api.post<{ analysis: string }>('/maintenance/analyze-anomaly', params)
    return data
  },
  createWorkOrder: async (params: Partial<WorkOrder>): Promise<WorkOrder> => {
    if (!navigator.onLine) {
      offlineQueue.add({
        method: 'POST',
        url: '/maintenance/work-order',
        data: params,
        label: `Create work order: ${params.title || 'untitled'}`,
      })
      // Return an optimistic placeholder so the UI doesn't break
      return { ...params, id: `offline-${Date.now()}`, status: 'open' } as WorkOrder
    }
    const { data } = await api.post<WorkOrder>('/maintenance/work-order', params)
    return data
  },
  getWorkOrders: async (vesselId: string): Promise<WorkOrder[]> => {
    // Backend wraps the list in { vesselId, workOrders, summary }, not a bare array.
    const { data } = await api.get<{ workOrders: WorkOrder[] }>(`/maintenance/work-orders/${vesselId}`)
    return data.workOrders
  },
  getAlerts: async (vesselId: string): Promise<MaintenanceAlert[]> => {
    const { data } = await api.get<MaintenanceAlert[]>(`/maintenance/alerts/${vesselId}`)
    return data
  },
}

// ─── Compliance ───────────────────────────────────────────────────────────────

export const complianceApi = {
  getCII: async (vesselId: string): Promise<CIIData> => {
    const { data } = await api.get<CIIData>(`/compliance/cii/${vesselId}`)
    return data
  },
  getETS: async (vesselId: string): Promise<ETSData> => {
    const { data } = await api.get<ETSData>(`/compliance/ets/${vesselId}`)
    return data
  },
  generateMRVReport: async (vesselId: string, year: number): Promise<{ reportUrl: string }> => {
    const { data } = await api.post<{ reportUrl: string }>('/compliance/generate-mrv-report', { vesselId, year })
    return data
  },
}

// ─── Ports ────────────────────────────────────────────────────────────────────

export const portsApi = {
  getCongestion: async (): Promise<PortCongestion[]> => {
    const { data } = await api.get<PortCongestion[]>('/ports/congestion')
    return data
  },
}

// ─── Knowledge ────────────────────────────────────────────────────────────────

export const knowledgeApi = {
  generateDefectReport: async (params: {
    vesselId: string
    equipment: string
    defectDescription: string
    symptoms: string
    conditions: string
    severity: string
  }): Promise<DefectReport> => {
    const { data } = await api.post<DefectReport>('/knowledge/generate-defect-report', params)
    return data
  },
  getDocuments: async (vesselId: string): Promise<KnowledgeDocument[]> => {
    // Backend wraps the list in { vesselId, vessel, documents, summary }, not a bare array.
    const { data } = await api.get<{ documents: KnowledgeDocument[] }>(`/knowledge/documents/${vesselId}`)
    return data.documents
  },
  createHandover: async (params: {
    vesselId: string
    watch: string
    engineerName: string
    ongoingJobs: string
    abnormalReadings: string
    partsOnOrder: string
    pendingWorkOrders: string
  }): Promise<HandoverReport> => {
    const { data } = await api.post<HandoverReport>('/knowledge/handover', params)
    return data
  },
  uploadDocument: async (vesselId: string, file: File): Promise<KnowledgeDocument> => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('vesselId', vesselId)
    const { data } = await api.post<KnowledgeDocument>('/knowledge/upload-document', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data
  },
  // Chat uses streaming fetch — not axios
  chatStream: (params: { vesselId: string; message: string; conversationHistory: { role: string; content: string }[] }) => {
    const token = localStorage.getItem('vm_token')
    return fetch(`${BASE_URL}/knowledge/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(params),
    })
  },
}

// ─── SIRE ─────────────────────────────────────────────────────────────────────

export const sireApi = {
  getReadinessScore: async (vesselId: string) => {
    const { data } = await api.get(`/sire/readiness-score/${vesselId}`)
    return data
  },
  generatePreInspectionReport: async (vesselId: string): Promise<{ report: string }> => {
    const { data } = await api.post<{ report: string }>('/sire/generate-pre-inspection-report', { vesselId })
    return data
  },
  getDocuments: async (vesselId: string): Promise<SireDocument[]> => {
    // Backend wraps the list in { vesselId, vessel, documents, byCategory, summary }, not a bare array.
    const { data } = await api.get<{ documents: SireDocument[] }>(`/sire/documents/${vesselId}`)
    return data.documents
  },
  getFindings: async (vesselId: string): Promise<SireFinding[]> => {
    // Backend wraps the list in { vesselId, vessel, findings, inspections, summary }, not a bare array.
    const { data } = await api.get<{ findings: SireFinding[] }>(`/sire/findings/${vesselId}`)
    return data.findings
  },
  inspectorChatStream: (params: { vesselId: string; message: string; conversationHistory: { role: string; content: string }[] }) => {
    const token = localStorage.getItem('vm_token')
    return fetch(`${BASE_URL}/sire/inspector-simulation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(params),
    })
  },
  complianceChatStream: (params: { vesselId: string; message: string; conversationHistory: { role: string; content: string }[] }) => {
    const token = localStorage.getItem('vm_token')
    return fetch(`${BASE_URL}/compliance/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(params),
    })
  },
}

// ─── Notifications ────────────────────────────────────────────────────────────

export const notificationsApi = {
  getNotifications: async (): Promise<Notification[]> => {
    // Backend wraps the list in { notifications, summary }, not a bare array.
    const { data } = await api.get<{ notifications: Notification[] }>('/notifications')
    return data.notifications
  },
  markRead: async (id: string): Promise<void> => {
    if (!navigator.onLine) {
      offlineQueue.add({ method: 'POST', url: `/notifications/${id}/read`, label: 'Mark notification read' })
      return
    }
    await api.post(`/notifications/${id}/read`)
  },
}

export default api
