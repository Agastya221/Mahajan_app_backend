import { Response } from 'express';
import { itemService } from './item.service';
import { createItemSchema, updateItemSchema, listItemsSchema } from './item.dto';
import { asyncHandler } from '../middleware/error.middleware';
import { AuthRequest } from '../middleware/auth.middleware';

export class ItemController {
  createItem = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { orgId } = req.params;
    const data = createItemSchema.parse(req.body);
    const item = await itemService.createItem(orgId, data);

    res.status(201).json({
      success: true,
      data: item,
    });
  });

  listItems = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { orgId } = req.params;
    const filters = listItemsSchema.parse(req.query);
    const result = await itemService.listItems(orgId, filters);

    res.json({
      success: true,
      data: result.items,
      pagination: result.pagination,
    });
  });

  getItemById = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { orgId, itemId } = req.params;
    const item = await itemService.getItemById(itemId, orgId);

    res.json({
      success: true,
      data: item,
    });
  });

  updateItem = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { orgId, itemId } = req.params;
    const data = updateItemSchema.parse(req.body);
    const item = await itemService.updateItem(itemId, orgId, data);

    res.json({
      success: true,
      data: item,
    });
  });

  deleteItem = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { orgId, itemId } = req.params;
    await itemService.deleteItem(itemId, orgId);

    res.json({
      success: true,
      message: 'Item deactivated',
    });
  });

  getCategories = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { orgId } = req.params;
    const categories = await itemService.getCategories(orgId);

    res.json({
      success: true,
      data: categories,
    });
  });
}
