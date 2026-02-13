import prisma from '../config/database';
import { redisClient } from '../config/redis';
import { CreateItemDto, UpdateItemDto, ListItemsDto } from './item.dto';
import { NotFoundError, ConflictError } from '../utils/errors';
import { logger } from '../utils/logger';
import { Prisma } from '@prisma/client';

export class ItemService {
  async createItem(orgId: string, data: CreateItemDto) {
    const existing = await prisma.item.findUnique({
      where: {
        orgId_name: { orgId, name: data.name },
      },
    });

    if (existing) {
      throw new ConflictError(`Item "${data.name}" already exists in this organization`);
    }

    const item = await prisma.item.create({
      data: {
        orgId,
        name: data.name,
        nameHindi: data.nameHindi,
        category: data.category,
        hsn: data.hsn,
        defaultUnit: data.defaultUnit,
        defaultCustomUnit: data.defaultCustomUnit,
      },
    });

    logger.info('Item created', { itemId: item.id, orgId, name: data.name });

    // Invalidate list cache
    await redisClient.del(`items:list:${orgId}`);

    return item;
  }

  async updateItem(itemId: string, orgId: string, data: UpdateItemDto) {
    const item = await prisma.item.findFirst({
      where: { id: itemId, orgId },
    });

    if (!item) {
      throw new NotFoundError('Item not found');
    }

    if (data.name && data.name !== item.name) {
      const existing = await prisma.item.findUnique({
        where: {
          orgId_name: { orgId, name: data.name },
        },
      });
      if (existing) {
        throw new ConflictError(`Item "${data.name}" already exists in this organization`);
      }
    }

    const updatedItem = await prisma.item.update({
      where: { id: itemId },
      data,
    });

    // Invalidate caches
    await Promise.all([
      redisClient.del(`items:list:${orgId}`),
      redisClient.del(`item:${itemId}`)
    ]);

    return updatedItem;
  }

  async listItems(orgId: string, filters: ListItemsDto) {
    // Generate cache key based on filters
    const cacheKey = `items:list:${orgId}:${JSON.stringify(filters)}`;
    const cached = await redisClient.get(cacheKey);

    if (cached) {
      return JSON.parse(cached);
    }

    const where: Prisma.ItemWhereInput = {
      OR: [
        { orgId },
        { orgId: null },
      ],
    };

    if (!filters.includeInactive) {
      where.isActive = true;
    }

    if (filters.category) {
      where.category = filters.category;
    }

    if (filters.search) {
      where.AND = [
        {
          OR: [
            { name: { contains: filters.search, mode: 'insensitive' } },
            { nameHindi: { contains: filters.search, mode: 'insensitive' } },
          ],
        },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.item.findMany({
        where,
        orderBy: [{ name: 'asc' }],
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      prisma.item.count({ where }),
    ]);

    const result = {
      items,
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        totalPages: Math.ceil(total / filters.limit),
      },
    };

    // Cache for 1 hour
    await redisClient.set(cacheKey, JSON.stringify(result), 'EX', 3600);

    return result;
  }

  async getItemById(itemId: string, orgId: string) {
    const cacheKey = `item:${itemId}`;
    const cached = await redisClient.get(cacheKey);

    if (cached) {
      const item = JSON.parse(cached);
      // Ensure user has access (org check)
      if (item.orgId && item.orgId !== orgId) {
        // Fall through to DB check for security/freshness
      } else {
        return item;
      }
    }

    const item = await prisma.item.findFirst({
      where: {
        id: itemId,
        OR: [{ orgId }, { orgId: null }],
      },
    });

    if (!item) {
      throw new NotFoundError('Item not found');
    }

    // Cache specific item - 1 hour
    await redisClient.set(cacheKey, JSON.stringify(item), 'EX', 3600);

    return item;
  }

  async deleteItem(itemId: string, orgId: string) {
    const item = await prisma.item.findFirst({
      where: { id: itemId, orgId },
    });

    if (!item) {
      throw new NotFoundError('Item not found');
    }

    // Soft delete
    // Soft delete
    const result = await prisma.item.update({
      where: { id: itemId },
      data: { isActive: false },
    });

    // Invalidate caches
    await Promise.all([
      redisClient.del(`items:list:${orgId}`),
      redisClient.del(`item:${itemId}`)
    ]);

    return result;
  }

  async getCategories(orgId: string) {
    const categories = await prisma.item.findMany({
      where: {
        OR: [{ orgId }, { orgId: null }],
        isActive: true,
        category: { not: null },
      },
      select: { category: true },
      distinct: ['category'],
      orderBy: { category: 'asc' },
    });

    return categories.map((c) => c.category).filter(Boolean);
  }
}

export const itemService = new ItemService();
