import { Router } from 'express';
import { UserProfileController } from './user.profile.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();
const controller = new UserProfileController();

// GET /api/v1/profile
router.get('/', authenticate, controller.getProfile);

// PATCH /api/v1/profile/name
router.patch('/name', authenticate, controller.updateName);

// PATCH /api/v1/profile/bio
router.patch('/bio', authenticate, controller.updateBio);

// POST /api/v1/profile/photo/upload-url
// Step 1: Get presigned S3 upload URL for profile photo
router.post('/photo/upload-url', authenticate, controller.getPhotoUploadUrl);

// POST /api/v1/profile/photo/confirm
// Step 2: Confirm upload completed, save URL to user
router.post('/photo/confirm', authenticate, controller.confirmPhotoUpload);

// DELETE /api/v1/profile/photo
router.delete('/photo', authenticate, controller.removePhoto);

export default router;
