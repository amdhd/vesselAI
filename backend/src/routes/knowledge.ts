import { Router, Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { MOCK_VESSELS } from '../mock/vessels';
import { authenticate } from '../middleware/auth';

const router = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Mock documents per vessel
const MOCK_DOCUMENTS: {
  [vesselId: string]: {
    id: string;
    vesselId: string;
    name: string;
    type: string;
    status: string;
    uploadedAt: string;
    size?: string;
  }[];
} = {
  'vessel-001': [
    {
      id: 'kdoc-001-01',
      vesselId: 'vessel-001',
      name: 'Main Engine Operating Manual - MAN B&W 6G80ME-C',
      type: 'technical_manual',
      status: 'indexed',
      uploadedAt: new Date(Date.now() - 300 * 24 * 3600 * 1000).toISOString(),
      size: '24.5 MB',
    },
    {
      id: 'kdoc-001-02',
      vesselId: 'vessel-001',
      name: 'Class Survey Report 2024 - DNV GL',
      type: 'survey_report',
      status: 'indexed',
      uploadedAt: new Date(Date.now() - 45 * 24 * 3600 * 1000).toISOString(),
      size: '8.2 MB',
    },
    {
      id: 'kdoc-001-03',
      vesselId: 'vessel-001',
      name: 'Safety Management System (SMS) v4.2',
      type: 'sms',
      status: 'indexed',
      uploadedAt: new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString(),
      size: '15.1 MB',
    },
    {
      id: 'kdoc-001-04',
      vesselId: 'vessel-001',
      name: 'Turbocharger Maintenance Manual - ABB TCA88-21',
      type: 'technical_manual',
      status: 'indexed',
      uploadedAt: new Date(Date.now() - 200 * 24 * 3600 * 1000).toISOString(),
      size: '6.8 MB',
    },
    {
      id: 'kdoc-001-05',
      vesselId: 'vessel-001',
      name: 'MARPOL Compliance Procedures',
      type: 'procedure',
      status: 'indexed',
      uploadedAt: new Date(Date.now() - 120 * 24 * 3600 * 1000).toISOString(),
      size: '3.4 MB',
    },
    {
      id: 'kdoc-001-06',
      vesselId: 'vessel-001',
      name: 'Cargo Operations Manual - VLCC',
      type: 'cargo_manual',
      status: 'indexed',
      uploadedAt: new Date(Date.now() - 180 * 24 * 3600 * 1000).toISOString(),
      size: '11.2 MB',
    },
  ],
  'vessel-002': [
    {
      id: 'kdoc-002-01',
      vesselId: 'vessel-002',
      name: 'Main Engine Operating Manual - MAN B&W 6S60ME-C',
      type: 'technical_manual',
      status: 'indexed',
      uploadedAt: new Date(Date.now() - 400 * 24 * 3600 * 1000).toISOString(),
      size: '22.1 MB',
    },
    {
      id: 'kdoc-002-02',
      vesselId: 'vessel-002',
      name: 'Class Survey Report 2023 - ABS',
      type: 'survey_report',
      status: 'indexed',
      uploadedAt: new Date(Date.now() - 180 * 24 * 3600 * 1000).toISOString(),
      size: '9.5 MB',
    },
    {
      id: 'kdoc-002-03',
      vesselId: 'vessel-002',
      name: 'Safety Management System (SMS) v3.8',
      type: 'sms',
      status: 'indexed',
      uploadedAt: new Date(Date.now() - 120 * 24 * 3600 * 1000).toISOString(),
      size: '14.3 MB',
    },
    {
      id: 'kdoc-002-04',
      vesselId: 'vessel-002',
      name: 'Cargo Operations Manual - Aframax',
      type: 'cargo_manual',
      status: 'indexed',
      uploadedAt: new Date(Date.now() - 250 * 24 * 3600 * 1000).toISOString(),
      size: '9.8 MB',
    },
  ],
  'vessel-003': [
    {
      id: 'kdoc-003-01',
      vesselId: 'vessel-003',
      name: 'Main Engine Manual - Caterpillar 3516C',
      type: 'technical_manual',
      status: 'indexed',
      uploadedAt: new Date(Date.now() - 150 * 24 * 3600 * 1000).toISOString(),
      size: '18.7 MB',
    },
    {
      id: 'kdoc-003-02',
      vesselId: 'vessel-003',
      name: 'Class Survey Report 2024 - Bureau Veritas',
      type: 'survey_report',
      status: 'indexed',
      uploadedAt: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
      size: '7.1 MB',
    },
    {
      id: 'kdoc-003-03',
      vesselId: 'vessel-003',
      name: 'DP Operations Manual',
      type: 'operations_manual',
      status: 'indexed',
      uploadedAt: new Date(Date.now() - 200 * 24 * 3600 * 1000).toISOString(),
      size: '5.6 MB',
    },
    {
      id: 'kdoc-003-04',
      vesselId: 'vessel-003',
      name: 'Bow Thruster Maintenance Manual - Kongsberg TT-2000-FP',
      type: 'technical_manual',
      status: 'indexed',
      uploadedAt: new Date(Date.now() - 300 * 24 * 3600 * 1000).toISOString(),
      size: '4.2 MB',
    },
  ],
};

// POST /api/knowledge/chat - STREAMING SSE
router.post('/chat', authenticate, async (req: Request, res: Response): Promise<void> => {
  const { message, vesselId, conversationHistory = [] } = req.body;

  if (!message) {
    res.status(400).json({ error: 'Message is required' });
    return;
  }

  const vessel = MOCK_VESSELS.find(v => v.id === vesselId) || MOCK_VESSELS[0];
  const vesselDocs = MOCK_DOCUMENTS[vessel.id] || [];
  const docNames = vesselDocs.map(d => d.name).join(', ');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

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
- Built: ${vessel.builtYear}`;

  const messages: { role: 'user' | 'assistant'; content: string }[] = [
    ...conversationHistory,
    { role: 'user', content: message },
  ];

  try {
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: systemPrompt,
      messages,
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`);
      }
    }
  } catch (error) {
    console.error('Knowledge chat streaming error:', error);
    res.write(
      `data: ${JSON.stringify({
        text: `I apologize, the AI service is temporarily unavailable. For technical questions about ${vessel.name}, please refer to the vessel's onboard documentation or contact the technical superintendent.`,
      })}\n\n`
    );
  }

  res.write('data: [DONE]\n\n');
  res.end();
});

// POST /api/knowledge/upload-document
router.post('/upload-document', authenticate, (req: Request, res: Response) => {
  const { vesselId, name, type } = req.body;

  if (!vesselId || !name) {
    res.status(400).json({ error: 'vesselId and name are required' });
    return;
  }

  const vessel = MOCK_VESSELS.find(v => v.id === vesselId);
  if (!vessel) {
    res.status(404).json({ error: 'Vessel not found' });
    return;
  }

  const mockDocument = {
    id: `kdoc-${Date.now()}`,
    vesselId,
    name,
    type: type || 'document',
    status: 'processing',
    uploadedAt: new Date().toISOString(),
    message: 'Document uploaded and queued for indexing. It will be available for AI queries within 5 minutes.',
  };

  // Simulate processing completion after "upload"
  setTimeout(() => {
    mockDocument.status = 'indexed';
  }, 5000);

  res.status(201).json(mockDocument);
});

// GET /api/knowledge/documents/:vesselId
router.get('/documents/:vesselId', authenticate, (req: Request, res: Response) => {
  const { vesselId } = req.params;

  const vessel = MOCK_VESSELS.find(v => v.id === vesselId);
  if (!vessel) {
    res.status(404).json({ error: 'Vessel not found' });
    return;
  }

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
router.post('/generate-defect-report', authenticate, async (req: Request, res: Response): Promise<void> => {
  const { vesselId, equipment, description, symptoms, severity } = req.body;

  if (!vesselId || !equipment || !description) {
    res.status(400).json({ error: 'vesselId, equipment, and description are required' });
    return;
  }

  const vessel = MOCK_VESSELS.find(v => v.id === vesselId);
  if (!vessel) {
    res.status(404).json({ error: 'Vessel not found' });
    return;
  }

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

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      system: `You are a maritime technical superintendent. Generate a formal defect report for vessel ${vessel.name} (${vessel.type}, IMO: ${vessel.imoNumber}). Return valid JSON only.`,
      messages: [
        {
          role: 'user',
          content: `Generate a defect report for:
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
        },
      ],
    });

    const rawContent = message.content[0].type === 'text' ? message.content[0].text : '';
    const jsonText = rawContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(jsonText);
    res.json({
      ...parsed,
      reportId: `DR-${vessel.imoNumber}-${Date.now()}`,
      vesselId,
      equipment,
      severity: severity || 'medium',
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Defect report generation error:', error);
    res.json(mockReport);
  }
});

// POST /api/knowledge/handover
router.post('/handover', authenticate, async (req: Request, res: Response): Promise<void> => {
  const { vesselId, watch, engineer, ongoingJobs, abnormalReadings, partsOnOrder } = req.body;

  if (!vesselId || !watch || !engineer || !ongoingJobs) {
    res.status(400).json({ error: 'vesselId, watch, engineer, and ongoingJobs are required' });
    return;
  }

  const vessel = MOCK_VESSELS.find(v => v.id === vesselId);
  if (!vessel) {
    res.status(404).json({ error: 'Vessel not found' });
    return;
  }

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

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      system: `You are a maritime chief engineer assistant. Format a professional engineering watch handover report for vessel ${vessel.name}. Return valid JSON only.`,
      messages: [
        {
          role: 'user',
          content: `Format handover report:
Watch: ${watch}
Engineer: ${engineer}
Ongoing Jobs: ${ongoingJobs}
Abnormal Readings: ${abnormalReadings || 'None'}
Parts on Order: ${partsOnOrder || 'None'}

Return JSON: {"reportText": "full formatted handover report", "summary": "brief 1-2 sentence summary"}`,
        },
      ],
    });

    const rawContent = message.content[0].type === 'text' ? message.content[0].text : '';
    const jsonText = rawContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(jsonText);
    res.json({
      ...parsed,
      reportId: `HO-${vessel.imoNumber}-${Date.now()}`,
      vesselId,
      watch,
      engineer,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Handover report generation error:', error);
    res.json(mockHandover);
  }
});

export default router;
