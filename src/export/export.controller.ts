import { Response } from 'express';
import { exportService } from './export.service';
import { exportRequestSchema } from './export.dto';
import { asyncHandler } from '../middleware/error.middleware';
import { AuthRequest } from '../middleware/auth.middleware';

export class ExportController {
  generateExport = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { orgId } = req.params;
    const data = exportRequestSchema.parse(req.body);
    const result = await exportService.generateTripsExport(orgId, data, req.user!.id);

    res.json({
      success: true,
      data: result,
    });
  });

  getExportHistory = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { orgId } = req.params;
    const exports = await exportService.getExportHistory(orgId);

    res.json({
      success: true,
      data: exports,
    });
  });
}
