import { Response } from 'express';
import { UserService } from './user.service';
import {
  submitGstinSchema,
  checkContactsSchema,
  updateNameSchema,
  updateBioSchema,
  photoUploadUrlSchema,
  confirmPhotoSchema,
  requestPhoneChangeSchema,
  confirmPhoneChangeSchema,
  reportUserSchema,
} from './user.dto';
import { asyncHandler } from '../middleware/error.middleware';
import { AuthRequest } from '../middleware/auth.middleware';

const userService = new UserService();

export class UserController {

  // ── GSTIN ──
  submitGstin = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { gstin } = submitGstinSchema.parse(req.body);
    const result = await userService.submitGstin(req.user!.id, gstin);
    res.json({ success: true, data: result });
  });

  getGstinStatus = asyncHandler(async (req: AuthRequest, res: Response) => {
    const result = await userService.getGstinStatus(req.user!.id);
    res.json({ success: true, data: result });
  });

  // ── Contact Discovery ──
  checkContacts = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { phones } = checkContactsSchema.parse(req.body);
    const result = await userService.checkContacts(phones);
    res.json({ success: true, data: result });
  });

  // ── Profile ──
  getProfile = asyncHandler(async (req: AuthRequest, res: Response) => {
    const result = await userService.getProfile(req.user!.id);
    res.json({ success: true, data: result });
  });

  updateName = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { name } = updateNameSchema.parse(req.body);
    const result = await userService.updateName(req.user!.id, name);
    res.json({ success: true, data: result, message: 'Name updated' });
  });

  updateBio = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { bio } = updateBioSchema.parse(req.body);
    const result = await userService.updateBio(req.user!.id, bio);
    res.json({ success: true, data: result, message: 'Bio updated' });
  });

  // ── Photo ──
  getPhotoUploadUrl = asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = photoUploadUrlSchema.parse(req.body);
    const result = await userService.getPhotoUploadUrl(req.user!.id, data.filename, data.mimeType, data.fileSize);
    res.json({ success: true, data: result });
  });

  confirmPhotoUpload = asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = confirmPhotoSchema.parse(req.body);
    const result = await userService.confirmPhotoUpload(req.user!.id, data.fileId, data.s3Key);
    res.json({ success: true, data: result, message: 'Profile photo updated' });
  });

  removePhoto = asyncHandler(async (req: AuthRequest, res: Response) => {
    const result = await userService.removePhoto(req.user!.id);
    res.json({ success: true, data: result, message: 'Profile photo removed' });
  });

  // ── Phone Change ──
  requestPhoneChange = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { newPhone } = requestPhoneChangeSchema.parse(req.body);
    const result = await userService.requestPhoneChange(req.user!.id, newPhone);
    res.json({ success: true, data: result, message: 'Phone change initiated. Verify OTP on new number.' });
  });

  confirmPhoneChange = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { phoneChangeToken, msg91AccessToken } = confirmPhoneChangeSchema.parse(req.body);
    const result = await userService.confirmPhoneChange(req.user!.id, phoneChangeToken, msg91AccessToken);
    res.json({ success: true, data: result, message: 'Phone number updated. Please log in again.' });
  });

  // ── Report ──
  reportUser = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { userId: reportedUserId } = req.params;
    const { reason, details } = reportUserSchema.parse(req.body);
    const result = await userService.reportUser(req.user!.id, reportedUserId, reason, details);
    res.status(201).json({ success: true, data: result, message: 'Report submitted' });
  });
}
