import { Router } from 'express';
import { HealthController } from './health.controller';

const router = Router();
const healthController = new HealthController();

// Public health check endpoint (no auth required)
router.get('/', healthController.checkHealth);

export default router;
