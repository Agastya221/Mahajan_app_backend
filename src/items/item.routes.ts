import { Router } from 'express';
import { ItemController } from './item.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireOrgMember } from '../middleware/rbac.middleware';

const router = Router();
const itemController = new ItemController();

// All routes require authentication
router.use(authenticate);

/**
 * @route   POST /api/v1/items/:orgId
 * @desc    Create a new item in the org's item master
 * @access  Private (Org members)
 */
router.post('/:orgId', requireOrgMember(), itemController.createItem);

/**
 * @route   GET /api/v1/items/:orgId
 * @desc    List items (org-specific + global)
 * @access  Private (Org members)
 */
router.get('/:orgId', requireOrgMember(), itemController.listItems);

/**
 * @route   GET /api/v1/items/:orgId/categories
 * @desc    Get distinct item categories
 * @access  Private (Org members)
 */
router.get('/:orgId/categories', requireOrgMember(), itemController.getCategories);

/**
 * @route   GET /api/v1/items/:orgId/:itemId
 * @desc    Get item by ID
 * @access  Private (Org members)
 */
router.get('/:orgId/:itemId', requireOrgMember(), itemController.getItemById);

/**
 * @route   PATCH /api/v1/items/:orgId/:itemId
 * @desc    Update an item
 * @access  Private (Org members)
 */
router.patch('/:orgId/:itemId', requireOrgMember(), itemController.updateItem);

/**
 * @route   DELETE /api/v1/items/:orgId/:itemId
 * @desc    Soft-delete (deactivate) an item
 * @access  Private (Org members)
 */
router.delete('/:orgId/:itemId', requireOrgMember(), itemController.deleteItem);

export default router;
