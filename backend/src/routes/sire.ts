import { Router, Request, Response } from 'express';
import { getSireDocumentsByVesselId } from '../mock/sireDocuments';
import { getFindingsByVesselId, getInspectionsByVesselId, getOpenFindings } from '../mock/findings';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { aiLimiter } from '../middleware/rateLimiter';
import { requireVessel, resolveFleetVessel } from '../lib/tenant';
import { SYSTEM_GUARDRAILS } from '../lib/aiGuard';
import { GeneratePreInspectionSchema, InspectorSimulationSchema } from '../schemas';
import { generateJson, streamChatResponse } from '../services/aiService';

const router = Router();

// SIRE readiness scores per vessel
const SIRE_READINESS: {
  [vesselId: string]: {
    overall: number;
    chapters: {
      id: string;
      name: string;
      score: number;
      status: 'good' | 'attention' | 'critical';
      openFindings: number;
    }[];
    lastInspectionScore: number;
    lastInspectionDate: string;
    nextInspectionDue: string;
  };
} = {
  'vessel-001': {
    overall: 82,
    lastInspectionScore: 92,
    lastInspectionDate: new Date(Date.now() - 120 * 24 * 3600 * 1000).toISOString(),
    nextInspectionDue: new Date(Date.now() + 245 * 24 * 3600 * 1000).toISOString(),
    chapters: [
      { id: 'ch1', name: 'Chapter 1 - Compliance with VIQ', score: 88, status: 'good', openFindings: 0 },
      { id: 'ch2', name: 'Chapter 2 - Crew Management', score: 85, status: 'good', openFindings: 0 },
      { id: 'ch3', name: 'Chapter 3 - Navigation', score: 90, status: 'good', openFindings: 0 },
      { id: 'ch4', name: 'Chapter 4 - Pollution Prevention', score: 87, status: 'good', openFindings: 0 },
      { id: 'ch5', name: 'Chapter 5 - Fire Safety', score: 88, status: 'good', openFindings: 0 },
      { id: 'ch6', name: 'Chapter 6 - Cargo Operations', score: 84, status: 'good', openFindings: 0 },
      { id: 'ch7', name: 'Chapter 7 - Safety Management', score: 82, status: 'good', openFindings: 0 },
      { id: 'ch8', name: 'Chapter 8 - Machinery', score: 78, status: 'attention', openFindings: 1 },
      { id: 'ch9', name: 'Chapter 9 - Electrical Systems', score: 86, status: 'good', openFindings: 0 },
      { id: 'ch10', name: 'Chapter 10 - Mooring Operations', score: 83, status: 'good', openFindings: 0 },
    ],
  },
  'vessel-002': {
    overall: 61,
    lastInspectionScore: 61,
    lastInspectionDate: new Date(Date.now() - 65 * 24 * 3600 * 1000).toISOString(),
    nextInspectionDue: new Date(Date.now() + 300 * 24 * 3600 * 1000).toISOString(),
    chapters: [
      { id: 'ch1', name: 'Chapter 1 - Compliance with VIQ', score: 65, status: 'attention', openFindings: 1 },
      { id: 'ch2', name: 'Chapter 2 - Crew Management', score: 70, status: 'attention', openFindings: 0 },
      { id: 'ch3', name: 'Chapter 3 - Navigation', score: 68, status: 'attention', openFindings: 1 },
      { id: 'ch4', name: 'Chapter 4 - Pollution Prevention', score: 45, status: 'critical', openFindings: 2 },
      { id: 'ch5', name: 'Chapter 5 - Fire Safety', score: 60, status: 'attention', openFindings: 1 },
      { id: 'ch6', name: 'Chapter 6 - Cargo Operations', score: 62, status: 'attention', openFindings: 1 },
      { id: 'ch7', name: 'Chapter 7 - Safety Management', score: 68, status: 'attention', openFindings: 0 },
      { id: 'ch8', name: 'Chapter 8 - Machinery', score: 52, status: 'critical', openFindings: 2 },
      { id: 'ch9', name: 'Chapter 9 - Electrical Systems', score: 66, status: 'attention', openFindings: 0 },
      { id: 'ch10', name: 'Chapter 10 - Mooring Operations', score: 72, status: 'attention', openFindings: 0 },
    ],
  },
  'vessel-003': {
    overall: 74,
    lastInspectionScore: 74.5,
    lastInspectionDate: new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString(),
    nextInspectionDue: new Date(Date.now() + 275 * 24 * 3600 * 1000).toISOString(),
    chapters: [
      { id: 'ch1', name: 'Chapter 1 - Compliance with VIQ', score: 78, status: 'attention', openFindings: 0 },
      { id: 'ch2', name: 'Chapter 2 - Safety Equipment', score: 75, status: 'attention', openFindings: 0 },
      { id: 'ch3', name: 'Chapter 3 - Navigation', score: 80, status: 'good', openFindings: 0 },
      { id: 'ch4', name: 'Chapter 4 - Pollution Prevention', score: 72, status: 'attention', openFindings: 1 },
      { id: 'ch5', name: 'Chapter 5 - Fire Safety', score: 76, status: 'attention', openFindings: 0 },
      { id: 'ch6', name: 'Chapter 6 - Cargo/Deck Operations', score: 70, status: 'attention', openFindings: 0 },
      { id: 'ch7', name: 'Chapter 7 - Deck Operations', score: 68, status: 'attention', openFindings: 0 },
      { id: 'ch8', name: 'Chapter 8 - Machinery', score: 77, status: 'attention', openFindings: 0 },
      { id: 'ch9', name: 'Chapter 9 - Crew Certification', score: 75, status: 'attention', openFindings: 0 },
      { id: 'ch10', name: 'Chapter 10 - Mooring Operations', score: 79, status: 'attention', openFindings: 0 },
    ],
  },
};

// GET /api/sire/readiness-score/:vesselId
router.get('/readiness-score/:vesselId', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const { vesselId } = req.params;

  const vessel = requireVessel(req, res, vesselId);
  if (!vessel) return;

  const readiness = SIRE_READINESS[vesselId];
  if (!readiness) {
    res.status(404).json({ error: 'SIRE readiness data not found' });
    return;
  }

  const openFindings = getOpenFindings(vesselId);
  const allFindings = getFindingsByVesselId(vesselId);
  const inspections = getInspectionsByVesselId(vesselId);
  const docs = getSireDocumentsByVesselId(vesselId);
  const expiredDocs = docs.filter(d => d.status === 'expired');
  const expiringSoonDocs = docs.filter(d => d.status === 'expiring-soon');

  const priorityActions: string[] = [];
  if (openFindings.length > 0) {
    openFindings.forEach(f => {
      if (f.severity === 'non-conformance') {
        priorityActions.push(`Close non-conformance: ${f.chapter} - ${f.question.split(' - ')[1] || f.question}`);
      }
    });
  }
  if (expiredDocs.length > 0) {
    expiredDocs.forEach(d => priorityActions.push(`Renew expired document: ${d.name}`));
  }
  if (expiringSoonDocs.length > 0) {
    expiringSoonDocs.forEach(d => priorityActions.push(`Renew expiring document: ${d.name} (expires soon)`));
  }

  res.json({
    vesselId,
    vessel: { id: vessel.id, name: vessel.name, type: vessel.type, flag: vessel.flag },
    readiness: {
      overall: readiness.overall,
      status: readiness.overall >= 80 ? 'good' : readiness.overall >= 65 ? 'attention' : 'critical',
      lastInspectionScore: readiness.lastInspectionScore,
      lastInspectionDate: readiness.lastInspectionDate,
      nextInspectionDue: readiness.nextInspectionDue,
      chapters: readiness.chapters,
    },
    findings: {
      total: allFindings.length,
      open: openFindings.length,
      nonConformances: openFindings.filter(f => f.severity === 'non-conformance').length,
      observations: openFindings.filter(f => f.severity === 'observation').length,
      openFindings,
    },
    documents: {
      total: docs.length,
      valid: docs.filter(d => d.status === 'valid').length,
      expiringSoon: expiringSoonDocs.length,
      expired: expiredDocs.length,
    },
    inspectionHistory: inspections.map(i => ({
      id: i.id,
      inspectorName: i.inspectorName,
      date: i.inspectionDate,
      location: i.location,
      score: i.overallScore,
      findingsCount: i.findings.length,
    })),
    priorityActions,
  });
});

// POST /api/sire/generate-pre-inspection-report
router.post('/generate-pre-inspection-report', authenticate, aiLimiter, validate(GeneratePreInspectionSchema), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { vesselId, inspectionDate, inspectorCompany } = req.body;

  const vessel = requireVessel(req, res, vesselId);
  if (!vessel) return;

  const readiness = SIRE_READINESS[vesselId];
  const openFindings = getOpenFindings(vesselId);
  const docs = getSireDocumentsByVesselId(vesselId);
  const expiredDocs = docs.filter(d => d.status === 'expired');
  const expiringSoonDocs = docs.filter(d => d.status === 'expiring-soon');

  const criticalChapters = readiness?.chapters.filter(c => c.status === 'critical') || [];
  const attentionChapters = readiness?.chapters.filter(c => c.status === 'attention') || [];

  const mockPriorityActions = [
    ...openFindings.map(f => `Close ${f.severity}: ${f.chapter} - due ${f.dueDate ? new Date(f.dueDate).toLocaleDateString() : 'ASAP'}`),
    ...expiredDocs.map(d => `URGENT: Renew ${d.name} - expired`),
    ...expiringSoonDocs.map(d => `Renew ${d.name} before inspection`),
    ...criticalChapters.map(c => `Improve ${c.name}: current score ${c.score}/100`),
  ];

  const mockReport = {
    reportText: `SIRE PRE-INSPECTION PREPARATION REPORT

Vessel: ${vessel.name} (IMO: ${vessel.imoNumber})
Type: ${vessel.type} | Flag: ${vessel.flag}
Date Prepared: ${new Date().toISOString().split('T')[0]}
Inspection Date: ${inspectionDate || 'TBD'}
Inspector Company: ${inspectorCompany || 'TBD'}

OVERALL READINESS SCORE: ${readiness?.overall || 70}/100

CRITICAL ITEMS REQUIRING IMMEDIATE ATTENTION:
${criticalChapters.length > 0 ? criticalChapters.map(c => `• ${c.name}: Score ${c.score}/100 - ${c.openFindings} open finding(s)`).join('\n') : '• No critical items identified'}

OPEN FINDINGS TO CLOSE:
${openFindings.length > 0 ? openFindings.map(f => `• [${f.severity.toUpperCase()}] ${f.chapter}: ${f.finding.substring(0, 100)}...`).join('\n') : '• No open findings'}

DOCUMENT STATUS:
• Expired Documents: ${expiredDocs.length} - ${expiredDocs.map(d => d.name).join(', ') || 'None'}
• Expiring Soon: ${expiringSoonDocs.length} - ${expiringSoonDocs.map(d => d.name).join(', ') || 'None'}

CHAPTER PREPARATION GUIDANCE:
${readiness?.chapters.map(c => `${c.name}: ${c.score}/100 (${c.status.toUpperCase()})`).join('\n') || 'Review all chapters'}

RECOMMENDATIONS:
1. Close all open non-conformances before inspection
2. Conduct internal audit using OCIMF VIQ 2023
3. Verify all documentation is current and accessible
4. Brief crew on inspection procedures
5. Conduct emergency drill within 7 days before inspection

Report prepared by VesselMind AI`,
    priorityActions: mockPriorityActions.slice(0, 10),
    overallReadiness: readiness?.overall || 70,
    reportId: `SIRE-PREP-${vessel.imoNumber}-${Date.now()}`,
    generatedAt: new Date().toISOString(),
  };

  const result = await generateJson(res, {
    system: 'You are a SIRE inspection preparation specialist with 20 years of OCIMF inspection experience. Generate comprehensive pre-inspection reports. Return valid JSON only.',
    prompt: `Generate a SIRE pre-inspection preparation report for:
Vessel: ${vessel.name} (${vessel.type}, ${vessel.flag} flag, IMO: ${vessel.imoNumber})
Built: ${vessel.builtYear}
Overall Readiness: ${readiness?.overall || 70}/100
Critical Chapters: ${criticalChapters.map(c => c.name + ' (' + c.score + '/100)').join(', ') || 'None'}
Attention Chapters: ${attentionChapters.map(c => c.name + ' (' + c.score + '/100)').join(', ') || 'None'}
Open Findings: ${openFindings.length} (${openFindings.filter(f => f.severity === 'non-conformance').length} non-conformances)
Expired Documents: ${expiredDocs.map(d => d.name).join(', ') || 'None'}
Inspection Date: ${inspectionDate || 'TBD'}
Inspector Company: ${inspectorCompany || 'Major oil company'}

Return JSON: {
  "reportText": "full comprehensive pre-inspection report",
  "priorityActions": ["action1", "action2", ...],
  "overallReadiness": number
}`,
    maxTokens: 2000,
    fallback: mockReport,
    onError: (error) => console.error('SIRE report generation error:', error),
  });
  res.json({
    ...result,
    reportId: `SIRE-PREP-${vessel.imoNumber}-${Date.now()}`,
    vesselId,
    generatedAt: new Date().toISOString(),
  });
});

// GET /api/sire/documents/:vesselId
router.get('/documents/:vesselId', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const { vesselId } = req.params;

  const vessel = requireVessel(req, res, vesselId);
  if (!vessel) return;

  const documents = getSireDocumentsByVesselId(vesselId);

  const summary = {
    total: documents.length,
    valid: documents.filter(d => d.status === 'valid').length,
    expiringSoon: documents.filter(d => d.status === 'expiring-soon').length,
    expired: documents.filter(d => d.status === 'expired').length,
  };

  // Group by category
  const byCategory: { [category: string]: typeof documents } = {};
  for (const doc of documents) {
    if (!byCategory[doc.category]) {
      byCategory[doc.category] = [];
    }
    byCategory[doc.category].push(doc);
  }

  res.json({
    vesselId,
    vessel: { id: vessel.id, name: vessel.name, type: vessel.type },
    documents,
    byCategory,
    summary,
  });
});

// POST /api/sire/inspector-simulation - STREAMING SSE
router.post('/inspector-simulation', authenticate, aiLimiter, validate(InspectorSimulationSchema), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { message, vesselId, chapter, conversationHistory = [] } = req.body;

  const vessel = resolveFleetVessel(req, vesselId);
  if (!vessel) {
    res.status(403).json({ error: 'No accessible vessel for your fleet' });
    return;
  }
  const readiness = SIRE_READINESS[vessel.id];

  const systemPrompt = `You are Captain James Mitchell, an experienced SIRE inspector with 15 years of experience conducting vessel inspections for major oil companies (Shell, BP, Total, ExxonMobil).

You are conducting a SIRE (Ship Inspection Report Programme) inspection of ${vessel.name} (${vessel.type}, IMO: ${vessel.imoNumber}, built ${vessel.builtYear}).

Your role is to:
1. Ask probing questions based on the OCIMF SIRE VIQ (Vessel Inspection Questionnaire) 2023 edition
2. Be thorough but professional and respectful
3. Focus on areas of concern: ${readiness ? readiness.chapters.filter(c => c.status !== 'good').map(c => c.name).join(', ') : 'all chapters'}
4. Ask follow-up questions when answers are vague or concerning
5. Reference specific VIQ question numbers (e.g., "VIQ Question 4.1.3")
6. Note any discrepancies or concerns professionally
${chapter ? `Currently inspecting: ${chapter}` : ''}

Current chapter focus areas based on vessel history:
${readiness ? readiness.chapters.filter(c => c.status === 'critical').map(c => `- CRITICAL: ${c.name}`).join('\n') : '- General inspection'}

Be realistic — ask about:
- ORB (Oil Record Book) entries
- SMS procedures
- Emergency drills
- Equipment maintenance records
- Crew certificates
- Safety equipment
- Navigation systems

Respond as the inspector would in an actual inspection — direct, professional, and systematic.${SYSTEM_GUARDRAILS}`;

  const messages: { role: 'user' | 'assistant'; content: string }[] = [
    ...conversationHistory,
    { role: 'user', content: message },
  ];

  await streamChatResponse(res, {
    system: systemPrompt,
    messages,
    fallbackText: 'I apologize for the interruption. As Inspector Mitchell, I would like to continue reviewing your Oil Record Book. Please have it ready for the next session.',
    onError: (error) => console.error('Inspector simulation streaming error:', error),
  });
});

// GET /api/sire/findings/:vesselId
router.get('/findings/:vesselId', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const { vesselId } = req.params;
  const { status } = req.query;

  const vessel = requireVessel(req, res, vesselId);
  if (!vessel) return;

  let findings = getFindingsByVesselId(vesselId);

  if (status) {
    findings = findings.filter(f => f.status === status);
  }

  const inspections = getInspectionsByVesselId(vesselId);

  res.json({
    vesselId,
    vessel: { id: vessel.id, name: vessel.name, type: vessel.type },
    findings,
    inspections: inspections.map(i => ({
      id: i.id,
      inspectorName: i.inspectorName,
      date: i.inspectionDate,
      location: i.location,
      score: i.overallScore,
      status: i.status,
    })),
    summary: {
      total: findings.length,
      open: findings.filter(f => f.status === 'open').length,
      closed: findings.filter(f => f.status === 'closed').length,
      nonConformances: findings.filter(f => f.severity === 'non-conformance').length,
      observations: findings.filter(f => f.severity === 'observation').length,
    },
  });
});

export default router;
