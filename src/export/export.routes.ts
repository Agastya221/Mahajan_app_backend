import { Router } from 'express';
import { ExportController } from './export.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireOrgMember } from '../middleware/rbac.middleware';

const router = Router();
const exportController = new ExportController();

router.use(authenticate);

/**
 * @route   POST /api/v1/exports/:orgId
 * @desc    Generate a trips/ledger export (XLSX)
 * @access  Private (Org members)
 */
router.post('/:orgId', requireOrgMember(), exportController.generateExport);

/**
 * @route   GET /api/v1/exports/:orgId/history
 * @desc    Get export history for an org
 * @access  Private (Org members)
 */
router.get('/:orgId/history', requireOrgMember(), exportController.getExportHistory);

export default router;
