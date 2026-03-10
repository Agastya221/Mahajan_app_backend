import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { UserController } from './user.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();
const c = new UserController();

// ── Rate limiter for contact discovery: 10 requests per minute ──
const contactCheckLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: 'Too many contact check requests, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
});

// ============================================
// USER ROUTES (/api/v1/users)
// ============================================

// POST /api/v1/users/check-contacts
router.post('/check-contacts', authenticate, contactCheckLimiter, c.checkContacts);

// POST /api/v1/users/me/gstin
router.post('/me/gstin', authenticate, c.submitGstin);

// GET /api/v1/users/me/gstin
router.get('/me/gstin', authenticate, c.getGstinStatus);

// POST /api/v1/users/:userId/report
router.post('/:userId/report', authenticate, c.reportUser);

// ============================================
// PROFILE ROUTES (/api/v1/profile)
// These are mounted separately in app.ts at /api/v1/profile
// ============================================

export const profileRouter = Router();

// GET /api/v1/profile
profileRouter.get('/', authenticate, c.getProfile);

// PATCH /api/v1/profile/name
profileRouter.patch('/name', authenticate, c.updateName);

// PATCH /api/v1/profile/bio
profileRouter.patch('/bio', authenticate, c.updateBio);

// POST /api/v1/profile/photo/upload-url
profileRouter.post('/photo/upload-url', authenticate, c.getPhotoUploadUrl);

// POST /api/v1/profile/photo/confirm
profileRouter.post('/photo/confirm', authenticate, c.confirmPhotoUpload);

// DELETE /api/v1/profile/photo
profileRouter.delete('/photo', authenticate, c.removePhoto);

// POST /api/v1/profile/phone/request-change
profileRouter.post('/phone/request-change', authenticate, c.requestPhoneChange);

// POST /api/v1/profile/phone/confirm-change
profileRouter.post('/phone/confirm-change', authenticate, c.confirmPhoneChange);

export default router;
