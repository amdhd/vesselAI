import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { CreateNotificationSchema } from '../schemas';

const router = Router();

// Pre-seeded demo notifications
const NOTIFICATIONS: {
  id: string;
  vesselId: string;
  type: string;
  severity: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  link?: string;
}[] = [
  {
    id: 'notif-001',
    vesselId: 'vessel-001',
    type: 'anomaly',
    severity: 'critical',
    title: 'Turbocharger Bearing Anomaly',
    message:
      'Vibration levels on Turbocharger #1 of MV Merdeka Spirit have reached 4.8 mm/s — 4 days to potential failure',
    read: false,
    createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
    link: '/maintenance?vessel=vessel-001&equipment=tc-001',
  },
  {
    id: 'notif-002',
    vesselId: 'vessel-002',
    type: 'compliance',
    severity: 'warning',
    title: 'CII Rating at Risk',
    message:
      'MT Kerteh Venture CII score of 4.82 exceeds required 4.20, currently rated D. Immediate speed reduction recommended.',
    read: false,
    createdAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
    link: '/compliance?vessel=vessel-002&tab=cii',
  },
  {
    id: 'notif-003',
    vesselId: 'vessel-003',
    type: 'commercial',
    severity: 'warning',
    title: 'Demurrage Risk',
    message:
      'OSV Tenaga Satu approaching laytime limit at Port Fujairah. Estimated demurrage: $12,500/day if delayed further.',
    read: false,
    createdAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
    link: '/ports?vessel=vessel-003',
  },
];

// GET /api/notifications
router.get('/', authenticate, (req: Request, res: Response) => {
  const { read, vesselId, type, severity } = req.query;

  let filtered = [...NOTIFICATIONS];

  if (read !== undefined) {
    filtered = filtered.filter(n => n.read === (read === 'true'));
  }

  if (vesselId) {
    filtered = filtered.filter(n => n.vesselId === vesselId);
  }

  if (type) {
    filtered = filtered.filter(n => n.type === type);
  }

  if (severity) {
    filtered = filtered.filter(n => n.severity === severity);
  }

  // Sort by createdAt descending
  filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  res.json({
    notifications: filtered,
    summary: {
      total: filtered.length,
      unread: filtered.filter(n => !n.read).length,
      critical: filtered.filter(n => n.severity === 'critical').length,
      warning: filtered.filter(n => n.severity === 'warning').length,
    },
  });
});

// POST /api/notifications/:id/read
router.post('/:id/read', authenticate, (req: Request, res: Response) => {
  const { id } = req.params;

  const notification = NOTIFICATIONS.find(n => n.id === id);
  if (!notification) {
    res.status(404).json({ error: 'Notification not found' });
    return;
  }

  notification.read = true;
  res.json({ success: true, notification });
});

// POST /api/notifications/read-all
router.post('/read-all', authenticate, (_req: Request, res: Response) => {
  NOTIFICATIONS.forEach(n => {
    n.read = true;
  });
  res.json({ success: true, markedRead: NOTIFICATIONS.length });
});

// POST /api/notifications - Create new notification
router.post('/', authenticate, validate(CreateNotificationSchema), (req: Request, res: Response) => {
  const { vesselId, type, severity, title, message, link } = req.body;

  const newNotification = {
    id: `notif-${Date.now()}`,
    vesselId: vesselId || null,
    type,
    severity: severity || 'info',
    title,
    message,
    read: false,
    createdAt: new Date().toISOString(),
    link: link || undefined,
  };

  NOTIFICATIONS.unshift(newNotification);
  res.status(201).json(newNotification);
});

// DELETE /api/notifications/:id
router.delete('/:id', authenticate, (req: Request, res: Response) => {
  const { id } = req.params;
  const index = NOTIFICATIONS.findIndex(n => n.id === id);

  if (index === -1) {
    res.status(404).json({ error: 'Notification not found' });
    return;
  }

  NOTIFICATIONS.splice(index, 1);
  res.json({ success: true });
});

export default router;
