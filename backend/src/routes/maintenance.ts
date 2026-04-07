import { Router, Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import {
  MOCK_MAINTENANCE_ALERTS,
  getEquipmentByVesselId,
  getEquipmentById,
  getAlertsByVesselId,
} from '../mock/equipment';
import { getSensorDataForEquipment } from '../mock/sensorData';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { aiLimiter } from '../middleware/rateLimiter';
import { AnalyzeAnomalySchema, WorkOrderSchema } from '../schemas';

const router = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// In-memory work orders store for demo
const workOrdersStore: {
  id: string;
  equipmentId: string;
  vesselId: string;
  title: string;
  description: string;
  priority: string;
  assignedTo?: string;
  requiredParts?: string;
  estimatedHours?: number;
  plannedDate?: string;
  completedDate?: string;
  status: string;
  createdAt: string;
}[] = [
  {
    id: 'wo-001',
    equipmentId: 'tc-001',
    vesselId: 'vessel-001',
    title: 'Turbocharger #1 Bearing Inspection & Replacement',
    description: 'Critical bearing replacement required. Vibration levels at 4.8 mm/s indicating imminent failure. Arrange port call within 4 days.',
    priority: 'critical',
    assignedTo: 'Chief Engineer',
    requiredParts: 'ABB-TCA88-BRG-001 (bearing kit), ABB-TCA88-SEAL-001 (seal kit)',
    estimatedHours: 16,
    plannedDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    status: 'open',
    createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'wo-002',
    equipmentId: 'me-002',
    vesselId: 'vessel-002',
    title: 'Main Engine Major Overhaul - Cylinder Units',
    description: 'Overdue cylinder unit overhaul. 2,100 running hours past manufacturer interval. Schedule drydock.',
    priority: 'high',
    assignedTo: 'Technical Superintendent',
    requiredParts: 'Piston rings set x6, cylinder liner inspection kit, fuel injectors x6',
    estimatedHours: 120,
    plannedDate: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString(),
    status: 'open',
    createdAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

// GET /api/maintenance/equipment/:vesselId
router.get('/equipment/:vesselId', authenticate, (req: Request, res: Response) => {
  const { vesselId } = req.params;
  const equipment = getEquipmentByVesselId(vesselId);
  const alerts = getAlertsByVesselId(vesselId);

  const enrichedEquipment = equipment.map(e => ({
    ...e,
    activeAlerts: alerts.filter(a => a.equipmentId === e.id && a.status === 'open'),
  }));

  res.json({
    vesselId,
    equipment: enrichedEquipment,
    summary: {
      total: equipment.length,
      healthy: equipment.filter(e => e.status === 'healthy').length,
      warning: equipment.filter(e => e.status === 'warning').length,
      critical: equipment.filter(e => e.status === 'critical').length,
      offline: equipment.filter(e => e.status === 'offline').length,
      avgHealthScore: parseFloat(
        (equipment.reduce((sum, e) => sum + e.healthScore, 0) / equipment.length).toFixed(1)
      ),
      openAlerts: alerts.filter(a => a.status === 'open').length,
    },
  });
});

// GET /api/maintenance/sensor-data/:equipmentId
router.get('/sensor-data/:equipmentId', authenticate, (req: Request, res: Response) => {
  const { equipmentId } = req.params;
  const { days = '7', parameter } = req.query;

  const equipment = getEquipmentById(equipmentId);
  if (!equipment) {
    res.status(404).json({ error: 'Equipment not found' });
    return;
  }

  const sensorData = getSensorDataForEquipment(
    equipmentId,
    parseInt(days as string, 10),
    parameter as string | undefined
  );

  // Group by parameter for chart-friendly format
  const parameterGroups: { [key: string]: { timestamps: string[]; values: number[]; unit: string; hasAnomalies: boolean } } = {};
  for (const reading of sensorData) {
    if (!parameterGroups[reading.parameter]) {
      parameterGroups[reading.parameter] = {
        timestamps: [],
        values: [],
        unit: reading.unit,
        hasAnomalies: false,
      };
    }
    parameterGroups[reading.parameter].timestamps.push(reading.timestamp);
    parameterGroups[reading.parameter].values.push(reading.value);
    if (reading.isAnomaly) {
      parameterGroups[reading.parameter].hasAnomalies = true;
    }
  }

  const anomalyCount = sensorData.filter(r => r.isAnomaly).length;

  res.json({
    equipmentId,
    equipment: {
      id: equipment.id,
      name: equipment.name,
      type: equipment.type,
      healthScore: equipment.healthScore,
      status: equipment.status,
    },
    sensorData,
    parameterGroups,
    stats: {
      totalReadings: sensorData.length,
      anomalyCount,
      anomalyRate: sensorData.length > 0 ? parseFloat(((anomalyCount / sensorData.length) * 100).toFixed(2)) : 0,
      parameters: Object.keys(parameterGroups),
    },
  });
});

// POST /api/maintenance/analyze-anomaly
router.post('/analyze-anomaly', authenticate, aiLimiter, validate(AnalyzeAnomalySchema), async (req: Request, res: Response): Promise<void> => {
  const { equipmentId, sensorStats, symptoms } = req.body;

  const equipment = getEquipmentById(equipmentId);
  if (!equipment) {
    res.status(404).json({ error: 'Equipment not found' });
    return;
  }

  const alerts = MOCK_MAINTENANCE_ALERTS.filter(a => a.equipmentId === equipmentId);

  // Get recent sensor data for analysis
  const recentData = getSensorDataForEquipment(equipmentId, 7);
  const anomalies = recentData.filter(r => r.isAnomaly);

  const mockAnalysis = {
    equipmentId,
    equipment: { id: equipment.id, name: equipment.name, type: equipment.type },
    analysis: {
      severity: equipment.status === 'critical' ? 'critical' : equipment.status === 'warning' ? 'warning' : 'normal',
      probableCause: alerts.length > 0
        ? alerts[0].description
        : `${equipment.type} showing ${anomalies.length > 0 ? 'sensor anomalies' : 'normal parameters'} based on recent data.`,
      aiAnalysis: alerts.length > 0
        ? alerts[0].aiAnalysis
        : `Analysis of ${equipment.name} on ${equipment.type === 'Turbocharger' ? 'vibration, temperature, and RPM' : 'key operational parameters'} shows ${anomalies.length > 0 ? 'concerning trends requiring attention' : 'normal operation'}. Health score: ${equipment.healthScore}/100. Next maintenance due: ${equipment.nextMaintenance}.`,
      daysToFailure: alerts.length > 0 ? alerts[0].daysToFailure : null,
      recommendedActions: [
        `Inspect ${equipment.name} at next port call`,
        `Review maintenance history and running hours`,
        `Order spare parts: ${equipment.maker} standard service kit`,
        `Reduce operational load if anomalies persist`,
      ],
      urgency: equipment.status === 'critical' ? 'IMMEDIATE' : equipment.status === 'warning' ? 'HIGH' : 'ROUTINE',
    },
    anomalySummary: {
      totalReadings: recentData.length,
      anomalyCount: anomalies.length,
      anomalyParameters: [...new Set(anomalies.map(a => a.parameter))],
    },
  };

  try {
    // Compute basic stats from sensor data for the prompt
    const statsForPrompt = sensorStats || (() => {
      const paramStats: { [key: string]: { min: number; max: number; avg: number; anomalies: number } } = {};
      for (const reading of recentData) {
        if (!paramStats[reading.parameter]) {
          paramStats[reading.parameter] = { min: reading.value, max: reading.value, avg: reading.value, anomalies: 0 };
        } else {
          paramStats[reading.parameter].min = Math.min(paramStats[reading.parameter].min, reading.value);
          paramStats[reading.parameter].max = Math.max(paramStats[reading.parameter].max, reading.value);
          paramStats[reading.parameter].avg = (paramStats[reading.parameter].avg + reading.value) / 2;
        }
        if (reading.isAnomaly) paramStats[reading.parameter].anomalies++;
      }
      return paramStats;
    })();

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system: 'You are a predictive maintenance AI for maritime vessels. Analyze sensor anomalies and provide actionable recommendations. Respond with valid JSON only.',
      messages: [
        {
          role: 'user',
          content: `Analyze equipment anomaly:
Equipment: ${equipment.name} (${equipment.type}) on vessel ${equipment.vesselId}
Maker: ${equipment.maker}, Model: ${equipment.model}
Health Score: ${equipment.healthScore}/100
Status: ${equipment.status}
Running hours: ${(equipment as any).runningHours || 'N/A'}
Last maintenance: ${equipment.lastMaintenance}
Sensor stats (7-day): ${JSON.stringify(statsForPrompt)}
Reported symptoms: ${symptoms || 'None reported'}
Anomaly count: ${anomalies.length}

Return JSON: {
  "severity": "critical|warning|normal",
  "probableCause": "string",
  "aiAnalysis": "detailed analysis paragraph",
  "daysToFailure": number|null,
  "recommendedActions": ["string"],
  "urgency": "IMMEDIATE|HIGH|ROUTINE"
}`,
        },
      ],
    });

    const rawContent = message.content[0].type === 'text' ? message.content[0].text : '';
    const jsonText = rawContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(jsonText);
    res.json({
      equipmentId,
      equipment: { id: equipment.id, name: equipment.name, type: equipment.type },
      analysis: parsed,
      anomalySummary: mockAnalysis.anomalySummary,
    });
  } catch (error) {
    console.error('Anomaly analysis Claude error:', error);
    res.json(mockAnalysis);
  }
});

// POST /api/maintenance/work-order
router.post('/work-order', authenticate, validate(WorkOrderSchema), (req: Request, res: Response) => {
  const { equipmentId, vesselId, title, description, priority, assignedTo, requiredParts, estimatedHours, plannedDate } = req.body;

  const newWorkOrder = {
    id: `wo-${Date.now()}`,
    equipmentId,
    vesselId,
    title,
    description,
    priority,
    assignedTo: assignedTo || undefined,
    requiredParts: requiredParts || undefined,
    estimatedHours: estimatedHours || undefined,
    plannedDate: plannedDate || undefined,
    completedDate: undefined,
    status: 'open',
    createdAt: new Date().toISOString(),
  };

  workOrdersStore.push(newWorkOrder);
  res.status(201).json(newWorkOrder);
});

// GET /api/maintenance/work-orders/:vesselId
router.get('/work-orders/:vesselId', authenticate, (req: Request, res: Response) => {
  const { vesselId } = req.params;
  const { status } = req.query;

  let orders = workOrdersStore.filter(wo => wo.vesselId === vesselId);

  if (status) {
    orders = orders.filter(wo => wo.status === status);
  }

  const equipment = getEquipmentByVesselId(vesselId);

  const enrichedOrders = orders.map(wo => {
    const eq = equipment.find(e => e.id === wo.equipmentId);
    return {
      ...wo,
      equipment: eq ? { id: eq.id, name: eq.name, type: eq.type } : null,
    };
  });

  res.json({
    vesselId,
    workOrders: enrichedOrders,
    summary: {
      total: enrichedOrders.length,
      open: enrichedOrders.filter(wo => wo.status === 'open').length,
      inProgress: enrichedOrders.filter(wo => wo.status === 'in_progress').length,
      completed: enrichedOrders.filter(wo => wo.status === 'completed').length,
      critical: enrichedOrders.filter(wo => wo.priority === 'critical').length,
    },
  });
});

// GET /api/maintenance/alerts/:vesselId
router.get('/alerts/:vesselId', authenticate, (req: Request, res: Response) => {
  const { vesselId } = req.params;
  const alerts = getAlertsByVesselId(vesselId);
  res.json(alerts);
});

export default router;
