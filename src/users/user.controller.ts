import { Response } from 'express';
import { UserService } from './user.service';
import { submitGstinSchema, checkContactsSchema } from './user.dto';
import { asyncHandler } from '../middleware/error.middleware';
import { AuthRequest } from '../middleware/auth.middleware';

const userService = new UserService();

export class UserController {
  submitGstin = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { gstin } = submitGstinSchema.parse(req.body);
    const result = await userService.submitGstin(req.user!.id, gstin);

    res.json({
      success: true,
      data: result,
    });
  });

  getGstinStatus = asyncHandler(async (req: AuthRequest, res: Response) => {
    const result = await userService.getGstinStatus(req.user!.id);

    res.json({
      success: true,
      data: result,
    });
  });

  /**
   * POST /users/check-contacts
   * Contact discovery — check which phone contacts are registered Mahajans.
   * Returns id, name, phone, status (ACTIVE/SUSPENDED/BANNED), and org info.
   */
  checkContacts = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { phones } = checkContactsSchema.parse(req.body);
    const result = await userService.checkContacts(phones);

    res.json({
      success: true,
      data: result,
    });
  });
}
