import { Router, Request, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { aiLimiter } from '../middleware/rateLimiter';
import { requireVessel, resolveFleetVessel } from '../lib/tenant';
import { SYSTEM_GUARDRAILS } from '../lib/aiGuard';
import {
  KnowledgeChatSchema,
  UploadDocumentSchema,
  GenerateDefectReportSchema,
  HandoverSchema,
} from '../schemas';
import { generateJson, streamChatResponse } from '../services/aiService';
import { MOCK_DOCUMENTS } from '../mock/knowledgeDocuments';

const router = Router();

// POST /api/knowledge/chat - STREAMING SSE
router.post('/chat', authenticate, aiLimiter, validate(KnowledgeChatSchema), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { message, vesselId, conversationHistory = [] } = req.body;

  const vessel = resolveFleetVessel(req, vesselId);
  if (!vessel) {
    res.status(403).json({ error: 'No accessible vessel for your fleet' });
    return;
  }
  const vesselDocs = MOCK_DOCUMENTS[vessel.id] || [];
  const docNames = vesselDocs.map(d => d.name).join(', ');

  const systemPrompt = `You are VesselMind, an expert maritime engineer assistant for vessel ${vessel.name} (${vessel.type}, built ${vessel.builtYear}, ${vessel.engineType} main engine).

You have access to the vessel's documentation library including: ${docNames || 'Main Engine Manual, Class Survey Report, SMS, Cargo Operations Manual'}.

Your role is to answer technical questions about this specific vessel, its equipment, procedures, and operations.

Guidelines:
1. Provide clear, numbered step-by-step instructions for procedures
2. Include safety warnings where relevant (use ⚠️ WARNING: prefix)
3. Reference SOLAS, MARPOL, or ISM Code regulations when applicable
4. Be specific to the vessel's equipment (${vessel.engineType})
5. For emergency procedures, emphasize safety first
6. Cite relevant manual sections when possible

Vessel specifications:
- Type: ${vessel.type}
- DWT: ${vessel.dwt} MT
- Engine: ${vessel.engineType} (${vessel.enginePower} kW)
- Design Speed: ${vessel.designSpeed} knots
- Max Speed: ${vessel.maxSpeed} knots
- Built: ${vessel.builtYear}${SYSTEM_GUARDRAILS}`;

  const messages: { role: 'user' | 'assistant'; content: string }[] = [
    ...conversationHistory,
    { role: 'user', content: message },
  ];

  await streamChatResponse(res, {
    system: systemPrompt,
    messages,
    fallbackText: `I apologize, the AI service is temporarily unavailable. For technical questions about ${vessel.name}, please refer to the vessel's onboard documentation or contact the technical superintendent.`,
    onError: (error) => console.error('Knowledge chat streaming error:', error),
  });
});

// POST /api/knowledge/upload-document
router.post('/upload-document', authenticate, validate(UploadDocumentSchema), (req: AuthenticatedRequest, res: Response) => {
  const { vesselId, name, type } = req.body;

  if (!requireVessel(req, res, vesselId)) return;

  const mockDocument = {
    id: `kdoc-${Date.now()}`,
    vesselId,
    name,
    type: type || 'document',
    status: 'processing',
    uploadedAt: new Date().toISOString(),
    message: 'Document uploaded and queued for indexing. It will be available for AI queries within 5 minutes.',
  };

  res.status(201).json(mockDocument);
});

// GET /api/knowledge/documents/:vesselId
router.get('/documents/:vesselId', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const { vesselId } = req.params;

  const vessel = requireVessel(req, res, vesselId);
  if (!vessel) return;

  const docs = MOCK_DOCUMENTS[vesselId] || [];

  res.json({
    vesselId,
    vessel: { id: vessel.id, name: vessel.name, type: vessel.type },
    documents: docs,
    summary: {
      total: docs.length,
      indexed: docs.filter(d => d.status === 'indexed').length,
      processing: docs.filter(d => d.status === 'processing').length,
    },
  });
});

// POST /api/knowledge/generate-defect-report
router.post('/generate-defect-report', authenticate, aiLimiter, validate(GenerateDefectReportSchema), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { vesselId, equipment, description, symptoms, severity } = req.body;

  const vessel = requireVessel(req, res, vesselId);
  if (!vessel) return;

  const mockReport = {
    reportText: `DEFECT REPORT

Vessel: ${vessel.name} (IMO: ${vessel.imoNumber})
Date: ${new Date().toISOString().split('T')[0]}
Severity: ${severity || 'MEDIUM'}

EQUIPMENT: ${equipment}

DESCRIPTION OF DEFECT:
${description}

SYMPTOMS OBSERVED:
${symptoms || 'As described above'}

PROBABLE CAUSE:
Based on the described symptoms, the probable cause is wear or mechanical deterioration of the affected component. Detailed inspection required to confirm root cause.

RECOMMENDED ACTION:
1. Reduce load on affected equipment immediately
2. Arrange inspection at next port call
3. Order spare parts as precautionary measure
4. Monitor parameters closely and report any deterioration

PARTS REQUIRED:
Standard service kit for ${equipment} - contact maker for part numbers

URGENCY: ${severity === 'critical' ? 'IMMEDIATE - arrange port call within 48 hours' : severity === 'high' ? 'HIGH - arrange inspection at next port' : 'ROUTINE - schedule at next planned maintenance'}`,
    probableCause: 'Wear and mechanical deterioration of component requiring investigation',
    recommendedAction: `Inspect ${equipment} at next port call. Order spare parts as precaution. Monitor parameters closely.`,
    partsRequired: `Standard service kit for ${equipment}`,
    urgency: severity === 'critical' ? 'IMMEDIATE' : severity === 'high' ? 'HIGH' : 'ROUTINE',
    reportId: `DR-${vessel.imoNumber}-${Date.now()}`,
    createdAt: new Date().toISOString(),
  };

  const result = await generateJson(res, {
    system: `You are a maritime technical superintendent. Generate a formal defect report for vessel ${vessel.name} (${vessel.type}, IMO: ${vessel.imoNumber}). Return valid JSON only.`,
    prompt: `Generate a defect report for:
Equipment: ${equipment}
Description: ${description}
Symptoms: ${symptoms || 'Not specified'}
Severity: ${severity || 'medium'}
Vessel: ${vessel.name} (${vessel.type})

Return JSON: {
  "reportText": "full formal report text",
  "probableCause": "string",
  "recommendedAction": "string",
  "partsRequired": "string",
  "urgency": "IMMEDIATE|HIGH|ROUTINE"
}`,
    maxTokens: 1500,
    fallback: mockReport,
    onError: (error) => console.error('Defect report generation error:', error),
  });
  res.json({
    ...result,
    reportId: `DR-${vessel.imoNumber}-${Date.now()}`,
    vesselId,
    equipment,
    severity: severity || 'medium',
    createdAt: new Date().toISOString(),
  });
});

// POST /api/knowledge/handover
router.post('/handover', authenticate, aiLimiter, validate(HandoverSchema), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { vesselId, watch, engineer, ongoingJobs, abnormalReadings, partsOnOrder } = req.body;

  const vessel = requireVessel(req, res, vesselId);
  if (!vessel) return;

  const mockHandover = {
    reportText: `ENGINEERING WATCH HANDOVER REPORT

Vessel: ${vessel.name} (IMO: ${vessel.imoNumber})
Watch: ${watch}
Outgoing Engineer: ${engineer}
Date/Time: ${new Date().toISOString()}

ONGOING JOBS:
${ongoingJobs}

ABNORMAL READINGS:
${abnormalReadings || 'No abnormal readings. All parameters within normal operating range.'}

PARTS ON ORDER:
${partsOnOrder || 'No outstanding parts orders.'}

MACHINERY STATUS:
- Main Engine: Running normally at sea speed
- Auxiliary Engines: All running, loads balanced
- Boilers: Operating within normal parameters
- All safety systems: Functional and tested

SPECIAL INSTRUCTIONS:
Monitor turbocharger #1 vibration levels closely. Report immediately if vibration exceeds 5.0 mm/s.

Signature: ${engineer}
`,
    summary: `Watch handover from ${engineer} for ${watch} watch. ${ongoingJobs.split('\n').length} ongoing job(s) noted. ${abnormalReadings ? 'Abnormal readings reported — monitoring required.' : 'All systems normal.'}`,
    reportId: `HO-${vessel.imoNumber}-${Date.now()}`,
    createdAt: new Date().toISOString(),
  };

  const result = await generateJson(res, {
    system: `You are a maritime chief engineer assistant. Format a professional engineering watch handover report for vessel ${vessel.name}. Return valid JSON only.`,
    prompt: `Format handover report:
Watch: ${watch}
Engineer: ${engineer}
Ongoing Jobs: ${ongoingJobs}
Abnormal Readings: ${abnormalReadings || 'None'}
Parts on Order: ${partsOnOrder || 'None'}

Return JSON: {"reportText": "full formatted handover report", "summary": "brief 1-2 sentence summary"}`,
    maxTokens: 1500,
    fallback: mockHandover,
    onError: (error) => console.error('Handover report generation error:', error),
  });
  res.json({
    ...result,
    reportId: `HO-${vessel.imoNumber}-${Date.now()}`,
    vesselId,
    watch,
    engineer,
    createdAt: new Date().toISOString(),
  });
});

export default router;
