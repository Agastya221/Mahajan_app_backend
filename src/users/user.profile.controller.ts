import { Response } from 'express';
import { UserProfileService } from './user.profile.service';
import {
    updateNameSchema,
    updateBioSchema,
    photoUploadUrlSchema,
    confirmPhotoSchema,
} from './user.profile.dto';
import { asyncHandler } from '../middleware/error.middleware';
import { AuthRequest } from '../middleware/auth.middleware';

const profileService = new UserProfileService();

export class UserProfileController {

    getProfile = asyncHandler(async (req: AuthRequest, res: Response) => {
        const result = await profileService.getProfile(req.user!.id);
        res.json({ success: true, data: result });
    });

    updateName = asyncHandler(async (req: AuthRequest, res: Response) => {
        const { name } = updateNameSchema.parse(req.body);
        const result = await profileService.updateName(req.user!.id, name);
        res.json({ success: true, data: result, message: 'Name updated' });
    });

    updateBio = asyncHandler(async (req: AuthRequest, res: Response) => {
        const { bio } = updateBioSchema.parse(req.body);
        const result = await profileService.updateBio(req.user!.id, bio);
        res.json({ success: true, data: result, message: 'Bio updated' });
    });

    getPhotoUploadUrl = asyncHandler(async (req: AuthRequest, res: Response) => {
        const data = photoUploadUrlSchema.parse(req.body);
        const result = await profileService.getPhotoUploadUrl(
            req.user!.id,
            data.filename,
            data.mimeType,
            data.fileSize
        );
        res.json({ success: true, data: result });
    });

    confirmPhotoUpload = asyncHandler(async (req: AuthRequest, res: Response) => {
        const data = confirmPhotoSchema.parse(req.body);
        const result = await profileService.confirmPhotoUpload(
            req.user!.id,
            data.fileId,
            data.s3Key
        );
        res.json({ success: true, data: result, message: 'Profile photo updated' });
    });

    removePhoto = asyncHandler(async (req: AuthRequest, res: Response) => {
        const result = await profileService.removePhoto(req.user!.id);
        res.json({ success: true, data: result, message: 'Profile photo removed' });
    });
}
