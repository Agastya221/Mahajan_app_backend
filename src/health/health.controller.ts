import { Request, Response } from 'express';
import { HealthService } from './health.service';

const healthService = new HealthService();

export class HealthController {
  async checkHealth(req: Request, res: Response) {
    const health = await healthService.checkHealth();

    const statusCode = health.status === 'healthy' ? 200 : 503;

    res.status(statusCode).json(health);
  }
}
