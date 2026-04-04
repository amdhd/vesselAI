// ─── Fleet & Vessel ────────────────────────────────────────────────────────────

export type VesselStatus = 'underway' | 'at_anchor' | 'in_port' | 'off_hire'
export type VesselType = 'tanker' | 'osv' | 'bulk' | 'container'

export interface VesselPosition {
  lat: number
  lng: number
  heading: number
  speed: number
  timestamp: string
}

export interface Vessel {
  id: string
  name: string
  imo: string
  type: VesselType
  flag: string
  yearBuilt: number
  grossTonnage: number
  deadweightTonnage: number
  status: VesselStatus
  position: VesselPosition
  currentVoyageId?: string
  fleetId: string
  ciiRating: 'A' | 'B' | 'C' | 'D' | 'E'
  fuelEfficiencyScore: number
}

export interface Fleet {
  id: string
  name: string
  company: string
  vessels: Vessel[]
  totalVessels: number
}

// ─── User & Auth ────────────────────────────────────────────────────────────────

export type UserRole = 'fleet_manager' | 'captain' | 'chief_engineer' | 'compliance_officer'

export interface User {
  id: string
  name: string
  email: string
  role: UserRole
  company: string
  avatarUrl?: string
  fleetId: string
}

export interface AuthResponse {
  token: string
  user: User
}

// ─── Voyage ─────────────────────────────────────────────────────────────────────

export type VoyageStatus = 'planned' | 'active' | 'completed' | 'cancelled'
export type SpeedPreference = 'eco' | 'normal' | 'fast'

export interface VoyageWaypoint {
  id: string
  lat: number
  lng: number
  name?: string
  eta: string
  weather: {
    windSpeed: number
    waveHeight: number
    current: number
    description: string
  }
}

export interface Voyage {
  id: string
  vesselId: string
  departurePort: string
  destinationPort: string
  departureDate: string
  eta: string
  status: VoyageStatus
  plannedFuel: number
  actualFuel?: number
  cargoLoad: number
  speedPreference: SpeedPreference
  waypoints: VoyageWaypoint[]
  ciiImpact?: number
  savings?: number
}

export interface RouteOptimization {
  directRoute: {
    distance: number
    fuel: number
    cost: number
    co2: number
    eta: string
    waypoints: VoyageWaypoint[]
  }
  aiRoute: {
    distance: number
    fuel: number
    cost: number
    co2: number
    eta: string
    waypoints: VoyageWaypoint[]
    savings: number
    costSavings: number
    reasoning: string
  }
}

// ─── Maintenance ────────────────────────────────────────────────────────────────

export type EquipmentStatus = 'healthy' | 'warning' | 'critical' | 'offline' | 'maintenance'
export type MaintenanceType = 'preventive' | 'corrective' | 'condition_based'
export type WorkOrderStatus = 'open' | 'in_progress' | 'completed' | 'verified'
export type WorkOrderPriority = 'low' | 'medium' | 'high' | 'critical'

export interface SensorReading {
  timestamp: string
  value: number
  unit: string
  isAnomaly?: boolean
}

export interface Equipment {
  id: string
  name: string
  type: string
  vesselId: string
  healthScore: number
  status: EquipmentStatus
  lastMaintenance: string
  nextMaintenance: string
  runningHours: number
  manufacturer: string
  model: string
  serialNumber: string
  sensors: {
    id: string
    name: string
    unit: string
    currentValue: number
    normalRange: [number, number]
    warningRange: [number, number]
  }[]
}

export interface MaintenanceAlert {
  id: string
  equipmentId: string
  equipmentName: string
  vesselId: string
  severity: 'warning' | 'critical'
  message: string
  detectedAt: string
  daysToFailure?: number
  aiAnalysis?: string
}

export interface WorkOrder {
  id: string
  equipmentId: string
  equipmentName: string
  vesselId: string
  title: string
  description: string
  status: WorkOrderStatus
  priority: WorkOrderPriority
  type: MaintenanceType
  assignedTo?: string
  plannedDate: string
  completedDate?: string
  estimatedHours: number
  partsRequired?: string[]
}

// ─── Emissions & Compliance ─────────────────────────────────────────────────────

export type CIIRating = 'A' | 'B' | 'C' | 'D' | 'E'

export interface CIIData {
  vesselId: string
  year: number
  currentRating: CIIRating
  currentValue: number
  requiredValue: number
  trajectory: {
    month: string
    actual: number
    required: number
  }[]
  daysToRatingChange?: number
  projectedYearEnd: CIIRating
}

export interface ETSData {
  vesselId: string
  year: number
  totalCO2: number
  annualEstimate: number
  eurCost: number
  allowancesPurchased: number
  allowancesRequired: number
  projectedYearEndCost: number
  monthlyData: {
    month: string
    co2: number
    cost: number
  }[]
}

export interface EmissionLog {
  id: string
  vesselId: string
  voyageId?: string
  date: string
  fuelType: 'HFO' | 'MGO' | 'VLSFO' | 'LNG'
  fuelConsumed: number
  co2Emitted: number
  sox: number
  nox: number
  port?: string
}

export interface BunkerRecord {
  id: string
  vesselId: string
  date: string
  port: string
  fuelType: string
  quantity: number
  pricePerMT: number
  totalCost: number
  supplier: string
}

// ─── Ports ──────────────────────────────────────────────────────────────────────

export type CongestionLevel = 'low' | 'medium' | 'high' | 'congested'

export interface PortCongestion {
  portId: string
  portName: string
  country: string
  congestionLevel: CongestionLevel
  avgWaitingTime: number
  vesselsAtAnchor: number
  forecast: {
    date: string
    level: CongestionLevel
  }[]
  alerts?: string[]
}

export interface PortCall {
  id: string
  vesselId: string
  portName: string
  country: string
  eta: string
  etd?: string
  status: 'upcoming' | 'arrived' | 'departed'
  berthNumber?: string
  agentName?: string
  agentEmail?: string
  layTimeAllowed: number
  layTimeUsed?: number
  demurrageRate: number
  cargoOps?: string
}

export interface AgentMessage {
  id: string
  portCallId: string
  type: 'pre_arrival' | 'eta_update' | 'berth_request' | 'departure_notice'
  subject: string
  to: string
  body: string
  generatedAt: string
  status: 'draft' | 'sent'
}

// ─── Knowledge & Documents ──────────────────────────────────────────────────────

export type DocumentStatus = 'processing' | 'indexed' | 'error'
export type DocumentType = 'manual' | 'procedure' | 'certificate' | 'report' | 'drawing'

export interface KnowledgeDocument {
  id: string
  vesselId: string
  name: string
  type: DocumentType
  status: DocumentStatus
  uploadedAt: string
  size: number
  pageCount?: number
  tags: string[]
}

export interface DefectReport {
  id: string
  vesselId: string
  equipment: string
  defectDescription: string
  symptoms: string
  conditions: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  generatedAt: string
  reportNumber: string
  probableCause?: string
  recommendedAction?: string
  partsRequired?: string[]
  urgency?: string
  aiGenerated?: string
}

export interface HandoverReport {
  id: string
  vesselId: string
  watch: string
  engineerName: string
  ongoingJobs: string
  abnormalReadings: string
  partsOnOrder: string
  pendingWorkOrders: string
  generatedAt: string
  reportContent?: string
}

// ─── SIRE ───────────────────────────────────────────────────────────────────────

export type FindingSeverity = 'observation' | 'deficiency' | 'major'
export type FindingStatus = 'open' | 'in_progress' | 'closed' | 'verified'

export interface SireChapterScore {
  chapter: number
  title: string
  score: number
  maxScore: number
  findings: number
  status: 'green' | 'amber' | 'red'
}

export interface SireDocument {
  id: string
  vesselId: string
  name: string
  type: string
  expiryDate?: string
  status: 'valid' | 'expiring_soon' | 'expired'
  daysToExpiry?: number
  uploadedAt: string
}

export interface SireFinding {
  id: string
  vesselId: string
  inspectionDate: string
  chapter: number
  chapterTitle: string
  finding: string
  severity: FindingSeverity
  status: FindingStatus
  dueDate?: string
  correctiveAction?: string
  closedAt?: string
  evidence?: string[]
}

export interface SireInspection {
  id: string
  vesselId: string
  date: string
  inspectorName: string
  company: string
  overallScore: number
  chapterScores: SireChapterScore[]
  findings: SireFinding[]
  reportUrl?: string
}

// ─── Notifications ──────────────────────────────────────────────────────────────

export type NotificationSeverity = 'info' | 'warning' | 'critical' | 'success'

export interface Notification {
  id: string
  severity: NotificationSeverity
  title: string
  message: string
  vesselId?: string
  vesselName?: string
  createdAt: string
  read: boolean
  link?: string
}

// ─── AI Chat ────────────────────────────────────────────────────────────────────

export interface AIMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  isStreaming?: boolean
}

// ─── Route & ETA ────────────────────────────────────────────────────────────────

export interface ETAPrediction {
  vesselId: string
  voyageId: string
  originalEta: string
  predictedEta: string
  confidence: number
  factors: string[]
}

// ─── Misc ────────────────────────────────────────────────────────────────────────

export interface SpeedFuelData {
  speed: number
  fuelPerDay: number
  voyageCost: number
}

export interface VoyageHistoryRecord {
  id: string
  vesselId: string
  route: string
  departureDate: string
  arrivalDate: string
  plannedFuel: number
  actualFuel: number
  savings: number
  ciiImpact: number
}
