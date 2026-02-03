import { Response } from 'express';
import { TruckService } from './truck.service';
import { createTruckSchema, updateTruckSchema } from './truck.dto';
import { asyncHandler } from '../middleware/error.middleware';
import { AuthRequest } from '../middleware/auth.middleware';

const truckService = new TruckService();

export class TruckController {
  createTruck = asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = createTruckSchema.parse(req.body);
    const truck = await truckService.createTruck(data, req.user!.id);

    res.status(201).json({
      success: true,
      data: truck,
    });
  });

  getTrucks = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { orgId, page, limit } = req.query;
    const result = await truckService.getTrucks(
      orgId as string | undefined,
      page ? parseInt(page as string, 10) : undefined,
      limit ? parseInt(limit as string, 10) : undefined,
    );

    res.json({
      success: true,
      data: result.trucks,
      pagination: result.pagination,
    });
  });

  getTruckById = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { truckId } = req.params;
    const truck = await truckService.getTruckById(truckId);

    res.json({
      success: true,
      data: truck,
    });
  });

  updateTruck = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { truckId } = req.params;
    const data = updateTruckSchema.parse(req.body);
    const truck = await truckService.updateTruck(truckId, data, req.user!.id);

    res.json({
      success: true,
      data: truck,
    });
  });

  deleteTruck = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { truckId } = req.params;
    const result = await truckService.deleteTruck(truckId, req.user!.id);

    res.json({
      success: true,
      data: result,
    });
  });
}
