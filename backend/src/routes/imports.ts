import { Router, Response, NextFunction } from 'express';
import multer from 'multer';
import { authenticate, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { logger } from '../lib/logger';
import { importBunkerCsv } from '../services/bunkerImport';

const router = Router();

// In-memory upload — files are small CSVs we parse immediately, never persist.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    const isCsv = file.mimetype === 'text/csv' || file.originalname.toLowerCase().endsWith('.csv');
    if (isCsv) cb(null, true);
    else cb(new Error('Only .csv files are accepted'));
  },
});

// POST /api/imports/bunker — upload an ERP-style bunker-procurement CSV.
// Multipart form field name: "file".
router.post(
  '/bunker',
  authenticate,
  requireRole(['fleet_manager']),
  upload.single('file'),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: 'CSV file is required (multipart field "file")' });
      return;
    }
    try {
      const csvText = req.file.buffer.toString('utf8');
      const result = await importBunkerCsv(req.user?.fleetId, csvText);
      if ('fatal' in result) {
        res.status(400).json({ error: result.fatal });
        return;
      }
      res.status(result.imported > 0 ? 201 : 200).json(result);
    } catch (err) {
      logger.error({ err: err }, '[import] bunker import failed');
      res.status(500).json({ error: 'Import failed' });
    }
  }
);

// GET /api/imports/bunker/template — download a blank CSV with the expected header.
const TEMPLATE_HEADER = 'imoNumber,date,port,supplier,fuelGrade,quantityMt,pricePerMt,sulfurContent\n';
router.get('/bunker/template', authenticate, (_req: AuthenticatedRequest, res: Response): void => {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="bunker-import-template.csv"');
  res.send(TEMPLATE_HEADER);
});

// Surface multer errors (file too large, wrong type) as clean 400s.
router.use((err: unknown, _req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  if (err instanceof multer.MulterError || (err instanceof Error && err.message === 'Only .csv files are accepted')) {
    res.status(400).json({ error: err.message });
    return;
  }
  next(err);
});

export default router;
