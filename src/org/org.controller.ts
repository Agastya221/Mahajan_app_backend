import { Request, Response } from 'express';
import { OrgService } from './org.service';
import { createOrgSchema, updateOrgSchema } from './org.dto';
import { asyncHandler } from '../middleware/error.middleware';
import { AuthRequest } from '../middleware/auth.middleware';

const orgService = new OrgService();

export class OrgController {
  createOrg = asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = createOrgSchema.parse(req.body);
    const org = await orgService.createOrg(data, req.user!.id);

    res.status(201).json({
      success: true,
      data: org,
    });
  });

  getUserOrgs = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { search } = req.query;

    // Handle global search if ?search= is provided
    if (search) {
      if ((search as string).length < 2) {
        return res.json({ success: true, data: [] });
      }
      const orgs = await orgService.searchOrgs(search as string);
      return res.json({ success: true, data: orgs });
    }

    const orgs = await orgService.getUserOrgs(req.user!.id);

    res.json({
      success: true,
      data: orgs,
    });
  });

  getOrgById = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { orgId } = req.params;
    const org = await orgService.getOrgById(orgId, req.user?.id);

    res.json({
      success: true,
      data: org,
    });
  });

  updateOrg = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { orgId } = req.params;
    const data = updateOrgSchema.parse(req.body);
    const org = await orgService.updateOrg(orgId, data, req.user!.id);

    res.json({
      success: true,
      data: org,
    });
  });

  deleteOrg = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { orgId } = req.params;
    const result = await orgService.deleteOrg(orgId, req.user!.id);

    res.json({
      success: true,
      data: result,
    });
  });
}
