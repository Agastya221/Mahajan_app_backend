import { Response } from 'express';
import { DriverService } from './driver.service';
import { createDriverSchema, updateDriverSchema } from './driver.dto';
import { asyncHandler } from '../middleware/error.middleware';
import { AuthRequest } from '../middleware/auth.middleware';

const driverService = new DriverService();

export class DriverController {
  createDriver = asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = createDriverSchema.parse(req.body);
    const driver = await driverService.createDriver(data, req.user!.id);

    res.status(201).json({
      success: true,
      data: driver,
    });
  });

  getDrivers = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { orgId } = req.query;
    const drivers = await driverService.getDrivers(orgId as string | undefined);

    res.json({
      success: true,
      data: drivers,
    });
  });

  getDriverById = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { driverId } = req.params;
    const driver = await driverService.getDriverById(driverId);

    res.json({
      success: true,
      data: driver,
    });
  });

  updateDriver = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { driverId } = req.params;
    const data = updateDriverSchema.parse(req.body);
    const driver = await driverService.updateDriver(driverId, data);

    res.json({
      success: true,
      data: driver,
    });
  });

  deleteDriver = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { driverId } = req.params;
    const result = await driverService.deleteDriver(driverId);

    res.json({
      success: true,
      data: result,
    });
  });
}
