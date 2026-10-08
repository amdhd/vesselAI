import { z } from 'zod';

// ── Shared primitives ────────────────────────────────────────────────────────
const conversationHistory = z
  .array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string().max(5000),
    })
  )
  .max(20) // bound client-supplied history: injection surface + token/cost DoS
  .optional();

// ── Auth ─────────────────────────────────────────────────────────────────────
export const LoginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(100),
});

// NOTE: fleetId is intentionally NOT accepted here. Fleet membership grants
// access to every vessel in that fleet (see lib/tenant.ts), so letting a
// self-service registrant pick their own fleetId is a horizontal privilege
// escalation — anyone could join an existing tenant's fleet. Fleet assignment
// must happen through a trusted admin/invite flow, never from the signup body.
export const RegisterSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(6).max(100),
  name: z.string().min(1).max(100),
  role: z.string().max(50).optional(),
});

// ── Vessels ──────────────────────────────────────────────────────────────────
// Create/update payloads for the vessel CRUD surface consumed by the Angular
// ops dashboard's reactive form. fleetId is intentionally NOT accepted: the new
// vessel is always scoped to the caller's own fleet (see routes/fleet.ts), so a
// client cannot inject a vessel into another tenant's fleet.
export const VesselCreateSchema = z.object({
  name: z.string().min(1).max(120),
  imoNumber: z.string().regex(/^\d{7}$/, 'IMO number must be exactly 7 digits'),
  type: z.string().min(1).max(80),
  flag: z.string().min(1).max(80),
  builtYear: z.number().int().min(1950).max(new Date().getFullYear() + 1),
  dwt: z.number().min(0).max(1_000_000),
  engineType: z.string().max(120).optional().default(''),
  enginePower: z.number().min(0).max(200_000).optional().default(0),
  maxSpeed: z.number().min(0).max(40),
  designSpeed: z.number().min(0).max(40),
  fuelCapacity: z.number().min(0).max(50_000).optional().default(0),
  status: z.string().max(40).optional().default('active'),
})
  // Cross-field rule mirrored on the client as a custom Angular group validator:
  // a vessel's economical design speed can never exceed its maximum speed.
  .refine((v) => v.designSpeed <= v.maxSpeed, {
    message: 'designSpeed cannot exceed maxSpeed',
    path: ['designSpeed'],
  });

// All fields optional for a partial edit (PATCH). We re-check the speed rule
// only when both values are present in the patch.
export const VesselUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  imoNumber: z.string().regex(/^\d{7}$/, 'IMO number must be exactly 7 digits').optional(),
  type: z.string().min(1).max(80).optional(),
  flag: z.string().min(1).max(80).optional(),
  builtYear: z.number().int().min(1950).max(new Date().getFullYear() + 1).optional(),
  dwt: z.number().min(0).max(1_000_000).optional(),
  engineType: z.string().max(120).optional(),
  enginePower: z.number().min(0).max(200_000).optional(),
  maxSpeed: z.number().min(0).max(40).optional(),
  designSpeed: z.number().min(0).max(40).optional(),
  fuelCapacity: z.number().min(0).max(50_000).optional(),
  status: z.string().max(40).optional(),
})
  .refine((v) => v.maxSpeed === undefined || v.designSpeed === undefined || v.designSpeed <= v.maxSpeed, {
    message: 'designSpeed cannot exceed maxSpeed',
    path: ['designSpeed'],
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
  // The catalogue name travels with the order so the board can render it
  // without resolving equipmentId against a catalogue the DB does not hold.
  equipmentName: z.string().min(1).max(100),
  vesselId: z.string().min(1).max(50),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  priority: z.enum(['critical', 'high', 'medium', 'low']),
  type: z.enum(['preventive', 'corrective', 'condition_based']).optional(),
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

// ── AI response shapes ────────────────────────────────────────────────────────
// What generateJson() expects each model reply to look like. These are not
// request schemas — nothing arrives here from a client — but model output is
// untrusted input in the same sense, and every route reads fields off it before
// anything checks them. Each one below matches the JSON example in the prompt
// of the handler that passes it, so the two have to move together.
//
// The dates are validated as dates on purpose: the frontend parses them with
// `new Date(...)`, and a model that writes "next Tuesday" or drops the timezone
// produces an Invalid Date that renders as a plausible-looking blank rather
// than as an error.

const isoDateTime = z.string().datetime({ offset: true });

const routeOption = z.object({
  distance: z.number(),
  fuel: z.number(),
  cost: z.number(),
  co2: z.number(),
  eta: isoDateTime,
});

// routes/voyage.ts — POST /optimize-route
export const OptimizeRouteResponseSchema = z.object({
  directRoute: routeOption,
  aiRoute: routeOption.extend({
    savings: z.number(),
    costSavings: z.number(),
    reasoning: z.string(),
  }),
});

// routes/voyage.ts — POST /predict-eta
export const PredictEtaResponseSchema = z.object({
  basicEta: isoDateTime,
  aiEta: isoDateTime,
  confidence: z.number(),
  factors: z.array(z.string()),
  recommendation: z.string(),
});

// routes/voyage.ts — POST /generate-agent-message
export const AgentMessageResponseSchema = z.object({
  subject: z.string(),
  body: z.string(),
});

// routes/knowledge.ts — POST /generate-defect-report
export const DefectReportResponseSchema = z.object({
  reportText: z.string(),
  probableCause: z.string(),
  recommendedAction: z.string(),
  partsRequired: z.string(),
  urgency: z.string(),
});

// routes/knowledge.ts — POST /handover
export const HandoverResponseSchema = z.object({
  reportText: z.string(),
  summary: z.string(),
});

// routes/sire.ts — POST /generate-pre-inspection
export const PreInspectionReportResponseSchema = z.object({
  reportText: z.string(),
  priorityActions: z.array(z.string()),
  overallReadiness: z.number(),
});

// routes/maintenance.ts — POST /analyze-anomaly
export const AnomalyAnalysisResponseSchema = z.object({
  severity: z.string(),
  probableCause: z.string(),
  aiAnalysis: z.string(),
  // Present-but-null is how "no failure predicted" is expressed, so the key is
  // required and only the value is nullable.
  daysToFailure: z.number().nullable(),
  recommendedActions: z.array(z.string()),
  urgency: z.string(),
});
