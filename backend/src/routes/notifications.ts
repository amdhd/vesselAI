import { Router, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { requireVessel, canAccessVessel } from '../lib/tenant';
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

// A notification is visible to the caller when it is system-wide (no vesselId)
// or its vessel belongs to the caller's fleet. Prevents cross-tenant leakage.
function visibleToUser(req: AuthenticatedRequest, n: { vesselId: string | null }): boolean {
  return !n.vesselId || canAccessVessel(req, n.vesselId);
}

// GET /api/notifications
router.get('/', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const { read, vesselId, type, severity } = req.query;

  let filtered = NOTIFICATIONS.filter(n => visibleToUser(req, n));

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
router.post('/:id/read', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const notification = NOTIFICATIONS.find(n => n.id === id);
  if (!notification || !visibleToUser(req, notification)) {
    res.status(404).json({ error: 'Notification not found' });
    return;
  }

  notification.read = true;
  res.json({ success: true, notification });
});

// POST /api/notifications/read-all
router.post('/read-all', authenticate, (req: AuthenticatedRequest, res: Response) => {
  let markedRead = 0;
  NOTIFICATIONS.forEach(n => {
    if (visibleToUser(req, n)) {
      n.read = true;
      markedRead++;
    }
  });
  res.json({ success: true, markedRead });
});

// POST /api/notifications - Create new notification
router.post('/', authenticate, validate(CreateNotificationSchema), (req: AuthenticatedRequest, res: Response) => {
  const { vesselId, type, severity, title, message, link } = req.body;

  // A vessel-scoped notification may only target a vessel in the caller's fleet.
  if (vesselId && !requireVessel(req, res, vesselId)) return;

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
router.delete('/:id', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const notification = NOTIFICATIONS.find(n => n.id === id);

  if (!notification || !visibleToUser(req, notification)) {
    res.status(404).json({ error: 'Notification not found' });
    return;
  }

  NOTIFICATIONS.splice(NOTIFICATIONS.indexOf(notification), 1);
  res.json({ success: true });
});

export default router;
