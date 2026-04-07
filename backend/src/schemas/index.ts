import { z } from 'zod';

// ── Shared primitives ────────────────────────────────────────────────────────
const conversationHistory = z
  .array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string().max(5000),
    })
  )
  .optional();

// ── Auth ─────────────────────────────────────────────────────────────────────
export const LoginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(100),
});

export const RegisterSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(6).max(100),
  name: z.string().min(1).max(100),
  role: z.string().max(50).optional(),
  fleetId: z.string().max(50).optional(),
});

// ── Voyage ───────────────────────────────────────────────────────────────────
export const OptimizeRouteSchema = z.object({
  vesselId: z.string().max(50).optional(),
  departurePort: z.string().max(100).optional(),
  destinationPort: z.string().max(100).optional(),
  cargoLoad: z.number().min(0).max(100).optional(),
  speedPreference: z.enum(['economic', 'fast', 'optimal']).optional(),
});

export const CalculateSpeedSchema = z.object({
  vesselId: z.string().max(50).optional(),
  targetSpeed: z.number().min(0).max(30).optional(),
  cargoLoad: z.number().min(0).max(100).optional(),
  trimMetres: z.number().min(0).max(10).optional(),
});

export const FuelAnalysisSchema = z.object({
  vesselId: z.string().max(50).optional(),
  speedKnots: z.number().min(1).max(30),
  cargoLoad: z.number().min(0).max(100).optional(),
  trimMetres: z.number().min(0).max(10).optional(),
});

export const PredictEtaSchema = z.object({
  vesselId: z.string().max(50).optional(),
  voyageId: z.string().max(50).optional(),
  currentSpeed: z.number().min(0).max(30).optional(),
  weatherConditions: z.record(z.unknown()).optional(),
});

export const GenerateAgentMessageSchema = z.object({
  vesselId: z.string().max(50).optional(),
  voyageId: z.string().max(50).optional(),
  portName: z.string().max(100).optional(),
  messageType: z.string().max(50).optional(),
  additionalInfo: z.string().max(1000).optional(),
});

// ── Maintenance ───────────────────────────────────────────────────────────────
export const AnalyzeAnomalySchema = z.object({
  equipmentId: z.string().min(1).max(50),
  sensorStats: z.record(z.unknown()).optional(),
  symptoms: z.string().max(1000).optional(),
});

export const WorkOrderSchema = z.object({
  equipmentId: z.string().min(1).max(50),
  vesselId: z.string().min(1).max(50),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  priority: z.enum(['critical', 'high', 'medium', 'low']),
  assignedTo: z.string().max(100).optional(),
  requiredParts: z.string().max(500).optional(),
  estimatedHours: z.number().min(0).max(9999).optional(),
  plannedDate: z.string().datetime({ offset: true }).optional(),
});

// ── Compliance ────────────────────────────────────────────────────────────────
export const GenerateMrvReportSchema = z.object({
  vesselId: z.string().min(1).max(50),
  year: z.number().int().min(2020).max(2035).optional(),
});

export const ComplianceChatSchema = z.object({
  message: z.string().min(1).max(2000),
  vesselId: z.string().max(50).optional(),
  conversationHistory,
});

// ── Knowledge ─────────────────────────────────────────────────────────────────
export const KnowledgeChatSchema = z.object({
  message: z.string().min(1).max(2000),
  vesselId: z.string().max(50).optional(),
  conversationHistory,
});

export const UploadDocumentSchema = z.object({
  vesselId: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  type: z.string().max(50).optional(),
});

export const GenerateDefectReportSchema = z.object({
  vesselId: z.string().min(1).max(50),
  equipment: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  symptoms: z.string().max(1000).optional(),
  severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
});

export const HandoverSchema = z.object({
  vesselId: z.string().min(1).max(50),
  watch: z.string().min(1).max(50),
  engineer: z.string().min(1).max(100),
  ongoingJobs: z.string().min(1).max(2000),
  abnormalReadings: z.string().max(1000).optional(),
  partsOnOrder: z.string().max(1000).optional(),
});

// ── SIRE ─────────────────────────────────────────────────────────────────────
export const GeneratePreInspectionSchema = z.object({
  vesselId: z.string().min(1).max(50),
  inspectionDate: z.string().max(30).optional(),
  inspectorCompany: z.string().max(100).optional(),
});

export const InspectorSimulationSchema = z.object({
  message: z.string().min(1).max(2000),
  vesselId: z.string().max(50).optional(),
  chapter: z.string().max(100).optional(),
  conversationHistory,
});

// ── Notifications ─────────────────────────────────────────────────────────────
export const CreateNotificationSchema = z.object({
  vesselId: z.string().max(50).optional(),
  type: z.string().min(1).max(50),
  severity: z.enum(['critical', 'warning', 'info']).optional(),
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(1000),
  link: z.string().max(200).optional(),
});
