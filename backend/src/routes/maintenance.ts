import { Router, Request, Response } from 'express';
import type { WorkOrder } from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  MOCK_MAINTENANCE_ALERTS,
  getEquipmentByVesselId,
  getEquipmentById,
  getAlertsByVesselId,
} from '../mock/equipment';
import { getSensorDataForEquipment } from '../mock/sensorData';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { logger } from '../lib/logger';
import { validate } from '../middleware/validate';
import { aiLimiter } from '../middleware/rateLimiter';
import { requireVessel, canAccessVessel } from '../lib/tenant';
import { AnalyzeAnomalySchema, WorkOrderSchema, AnomalyAnalysisResponseSchema } from '../schemas';
import { generateJson } from '../services/aiService';

const router = Router();

// Frontend EquipmentDetail expects each equipment item to carry a `sensors`
// summary (id/name/unit/currentValue/normalRange/warningRange) so it can
// render a chart per parameter. Derive it from the actual generated 30-day
// time series rather than hand-maintaining a second set of ranges that could
// drift from what generateSensorTimeSeries() produces.
function buildSensorSummaries(equipmentId: string) {
  const readings = getSensorDataForEquipment(equipmentId, 30);
  const byParam = new Map<string, { value: number; unit: string; timestamp: string }[]>();
  for (const r of readings) {
    if (!byParam.has(r.parameter)) byParam.set(r.parameter, []);
    byParam.get(r.parameter)!.push(r);
  }
  return [...byParam.entries()].map(([parameter, series]) => {
    const values = series.map(s => s.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || Math.abs(max) * 0.1 || 1;
    const latest = series[series.length - 1];
    return {
      id: `${equipmentId}-${parameter}`,
      name: parameter,
      unit: latest.unit,
      currentValue: latest.value,
      normalRange: [Number(min.toFixed(2)), Number(max.toFixed(2))] as [number, number],
      warningRange: [
        Number((min - range * 0.15).toFixed(2)),
        Number((max + range * 0.15).toFixed(2)),
      ] as [number, number],
    };
  });
}

// Work orders live in Postgres (see the WorkOrder model). They used to sit in a
// module-level array, which under the two replicas this runs with meant a board
// that differed depending on which pod answered and reset on every restart.
// The two demo orders that array was seeded with are now rows created by
// prisma/seed.ts.

// The board renders a work order's parts as a list; the column holds them as
// one comma-separated string, which is how the seeded demo data and the create
// form both express them.
function splitParts(requiredParts: string | null): string[] {
  if (!requiredParts) return [];
  return requiredParts.split(',').map(p => p.trim()).filter(Boolean);
}

// The board reads a flat work order. Dates go out as ISO strings, and the
// parts column is exposed both as the stored string (`requiredParts`, which the
// create form submits) and as the list the detail panel renders
// (`partsRequired`), so neither consumer has to know how the column is stored.
function toWorkOrderResponse(wo: WorkOrder) {
  return {
    id: wo.id,
    vesselId: wo.vesselId,
    equipmentId: wo.equipmentId,
    equipmentName: wo.equipmentName,
    type: wo.type,
    title: wo.title,
    description: wo.description,
    priority: wo.priority,
    status: wo.status,
    assignedTo: wo.assignedTo ?? undefined,
    requiredParts: wo.requiredParts ?? undefined,
    partsRequired: splitParts(wo.requiredParts),
    estimatedHours: wo.estimatedHours ?? 0,
    plannedDate: wo.plannedDate?.toISOString(),
    completedDate: wo.completedDate?.toISOString(),
    createdAt: wo.createdAt.toISOString(),
  };
}

// GET /api/maintenance/equipment/:vesselId
router.get('/equipment/:vesselId', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const { vesselId } = req.params;
  if (!requireVessel(req, res, vesselId)) return;
  const equipment = getEquipmentByVesselId(vesselId);
  const alerts = getAlertsByVesselId(vesselId);

  const enrichedEquipment = equipment.map(e => ({
    ...e,
    // Frontend Equipment type uses `manufacturer`/`runningHours` (required);
    // the mock fixtures use `maker` and treat running hours as optional.
    manufacturer: e.maker,
    runningHours: e.runningHours ?? 0,
    sensors: buildSensorSummaries(e.id),
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
router.get('/sensor-data/:equipmentId', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const { equipmentId } = req.params;
  const { days = '7', parameter } = req.query;

  const equipment = getEquipmentById(equipmentId);
  if (!equipment) {
    res.status(404).json({ error: 'Equipment not found' });
    return;
  }
  if (!canAccessVessel(req, equipment.vesselId)) {
    res.status(403).json({ error: 'Access to this equipment is not permitted' });
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
router.post('/analyze-anomaly', authenticate, aiLimiter, validate(AnalyzeAnomalySchema), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { equipmentId, sensorStats, symptoms } = req.body;

  const equipment = getEquipmentById(equipmentId);
  if (!equipment) {
    res.status(404).json({ error: 'Equipment not found' });
    return;
  }
  if (!canAccessVessel(req, equipment.vesselId)) {
    res.status(403).json({ error: 'Access to this equipment is not permitted' });
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

    const analysis = await generateJson(res, {
      system: 'You are a predictive maintenance AI for maritime vessels. Analyze sensor anomalies and provide actionable recommendations. Respond with valid JSON only.',
      prompt: `Analyze equipment anomaly:
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
      maxTokens: 1000,
      schema: AnomalyAnalysisResponseSchema,
      fallback: mockAnalysis.analysis,
      onError: (error) => logger.error({ err: error }, 'Anomaly analysis Claude error'),
    });
    res.json({
      equipmentId,
      equipment: { id: equipment.id, name: equipment.name, type: equipment.type },
      analysis,
      anomalySummary: mockAnalysis.anomalySummary,
    });
  } catch (error) {
    logger.error({ err: error }, 'Anomaly analysis error');
    res.json(mockAnalysis);
  }
});

// POST /api/maintenance/work-order
router.post('/work-order', authenticate, validate(WorkOrderSchema), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { equipmentId, equipmentName, vesselId, title, description, priority, type, assignedTo, requiredParts, estimatedHours, plannedDate } = req.body;

  if (!requireVessel(req, res, vesselId)) return;

  // The equipment, if it exists, must belong to the target vessel.
  const equipment = getEquipmentById(equipmentId);
  if (equipment && equipment.vesselId !== vesselId) {
    res.status(400).json({ error: 'Equipment does not belong to the specified vessel' });
    return;
  }

  try {
    const workOrder = await prisma.workOrder.create({
      data: {
        vesselId,
        equipmentId,
        equipmentName,
        type: type ?? 'corrective',
        title,
        description,
        priority,
        assignedTo: assignedTo ?? null,
        requiredParts: requiredParts ?? null,
        estimatedHours: estimatedHours ?? null,
        plannedDate: plannedDate ? new Date(plannedDate) : null,
      },
    });
    res.status(201).json(toWorkOrderResponse(workOrder));
  } catch (error) {
    // A create that cannot reach the database has to say so. Reporting success
    // here would put the order on the board of whichever replica is rendering
    // it while the row does not exist, which is the failure this route was
    // moved out of memory to stop making.
    logger.error({ err: error }, 'work order create failed');
    res.status(503).json({ error: 'Work orders unavailable — the order was not saved' });
  }
});

// GET /api/maintenance/work-orders/:vesselId
router.get('/work-orders/:vesselId', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { vesselId } = req.params;
  const { status } = req.query;

  if (!requireVessel(req, res, vesselId)) return;

  let orders: WorkOrder[];
  try {
    orders = await prisma.workOrder.findMany({
      where: {
        vesselId,
        ...(typeof status === 'string' && status ? { status } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  } catch (error) {
    logger.error({ err: error }, 'work order list failed');
    res.status(503).json({ error: 'Work orders unavailable' });
    return;
  }

  const workOrders = orders.map(toWorkOrderResponse);

  res.json({
    vesselId,
    workOrders,
    summary: {
      total: workOrders.length,
      open: workOrders.filter(wo => wo.status === 'open').length,
      inProgress: workOrders.filter(wo => wo.status === 'in_progress').length,
      completed: workOrders.filter(wo => wo.status === 'completed').length,
      critical: workOrders.filter(wo => wo.priority === 'critical').length,
    },
  });
});

// GET /api/maintenance/alerts/:vesselId
router.get('/alerts/:vesselId', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const { vesselId } = req.params;
  if (!requireVessel(req, res, vesselId)) return;
  const alerts = getAlertsByVesselId(vesselId);
  // Frontend MaintenanceAlert type uses `message`/`detectedAt`/`equipmentName`;
  // the mock fixtures use `description`/`createdAt` and no equipment name.
  res.json(alerts.map(a => ({
    ...a,
    message: a.description,
    detectedAt: a.createdAt,
    equipmentName: getEquipmentById(a.equipmentId)?.name ?? 'Unknown equipment',
  })));
});

export default router;
