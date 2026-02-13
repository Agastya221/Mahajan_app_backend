import { Router } from 'express';
import { OrgController } from './org.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireOrgMember } from '../middleware/rbac.middleware';

const router = Router();
const orgController = new OrgController();

/**
 * @route   POST /api/v1/orgs
 * @desc    Create a new organization
 * @access  Private
 */
router.post('/', authenticate, orgController.createOrg);

/**
 * @route   GET /api/v1/orgs
 * @desc    Get all organizations for the current user
 * @access  Private
 */
router.get('/', authenticate, orgController.getUserOrgs);

/**
 * @route   GET /api/v1/orgs/search
 * @desc    Search orgs by name, phone, or owner name (for autocomplete)
 * @access  Private
 */
router.get('/search', authenticate, orgController.searchOrgs);

/**
 * @route   GET /api/v1/orgs/:orgId
 * @desc    Get organization by ID
 * @access  Private (must be member)
 */
router.get('/:orgId', authenticate, requireOrgMember(), orgController.getOrgById);

/**
 * @route   PATCH /api/v1/orgs/:orgId
 * @desc    Update organization
 * @access  Private (owner only)
 */
router.patch('/:orgId', authenticate, orgController.updateOrg);

/**
 * @route   DELETE /api/v1/orgs/:orgId
 * @desc    Delete organization
 * @access  Private (owner only)
 */
router.delete('/:orgId', authenticate, orgController.deleteOrg);

export default router;
