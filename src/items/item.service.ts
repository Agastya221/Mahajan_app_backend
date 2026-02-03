import prisma from '../config/database';
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

    return prisma.item.update({
      where: { id: itemId },
      data,
    });
  }

  async listItems(orgId: string, filters: ListItemsDto) {
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

    return {
      items,
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        totalPages: Math.ceil(total / filters.limit),
      },
    };
  }

  async getItemById(itemId: string, orgId: string) {
    const item = await prisma.item.findFirst({
      where: {
        id: itemId,
        OR: [{ orgId }, { orgId: null }],
      },
    });

    if (!item) {
      throw new NotFoundError('Item not found');
    }

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
    return prisma.item.update({
      where: { id: itemId },
      data: { isActive: false },
    });
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
