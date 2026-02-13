import prisma from '../config/database';
import { redisClient } from '../config/redis';
import { NotFoundError, ForbiddenError } from '../utils/errors';
import { CreateOrgDto, UpdateOrgDto } from './org.dto';

export class OrgService {
  async createOrg(data: CreateOrgDto, createdBy: string) {
    // Create org and add creator as member in a transaction
    const result = await prisma.$transaction(async (tx) => {
      const org = await tx.org.create({
        data: {
          name: data.name,
          city: data.city,
          phone: data.phone,
          address: data.address,
          gstin: data.gstin,
          roleType: data.roleType,
        },
      });

      // Add creator as member (each mahajan is sole owner)
      await tx.orgMember.create({
        data: {
          orgId: org.id,
          userId: createdBy,
        },
      });

      return org;
    });

    return result;
  }

  async getOrgById(orgId: string, userId?: string) {
    const org = await prisma.org.findUnique({
      where: { id: orgId },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                phone: true,
                role: true,
              },
            },
          },
        },
        trucks: {
          select: {
            id: true,
            number: true,
            type: true,
            capacity: true,
          },
        },
      },
    });

    if (!org) {
      throw new NotFoundError('Organization not found');
    }

    // Check if user has access (optional)
    if (userId) {
      const isMember = org.members.some((m) => m.userId === userId);
      if (!isMember) {
        throw new ForbiddenError('Not a member of this organization');
      }
    }

    return org;
  }

  async getUserOrgs(userId: string) {
    const memberships = await prisma.orgMember.findMany({
      where: { userId },
      include: {
        org: {
          include: {
            members: {
              select: { id: true },
            },
            trucks: {
              select: { id: true },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return memberships.map((m) => ({
      ...m.org,
      memberCount: m.org.members.length,
      truckCount: m.org.trucks.length,
    }));
  }

  async updateOrg(orgId: string, data: UpdateOrgDto, userId: string) {
    // Check if user is member (every mahajan is sole owner)
    const membership = await prisma.orgMember.findUnique({
      where: {
        orgId_userId: {
          orgId,
          userId,
        },
      },
    });

    if (!membership) {
      throw new ForbiddenError('Only the organization owner can update');
    }

    const org = await prisma.org.update({
      where: { id: orgId },
      data,
    });

    return org;
  }

  async deleteOrg(orgId: string, userId: string) {
    // Only owner (member) can delete
    const membership = await prisma.orgMember.findUnique({
      where: {
        orgId_userId: {
          orgId,
          userId,
        },
      },
    });

    if (!membership) {
      throw new ForbiddenError('Only the organization owner can delete');
    }

    await prisma.org.delete({
      where: { id: orgId },
    });

    return { success: true };
  }

  async searchOrgs(query: string) {
    const cacheKey = `search:org:${query.toLowerCase().trim()}`;
    const cachedResult = await redisClient.get(cacheKey);

    if (cachedResult) {
      return JSON.parse(cachedResult);
    }

    // Search by Org Name OR Org Phone OR Member Name OR Member Phone
    const orgs = await prisma.org.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { phone: { contains: query, mode: 'insensitive' } },
          {
            members: {
              some: {
                user: {
                  OR: [
                    { name: { contains: query, mode: 'insensitive' } },
                    { phone: { contains: query, mode: 'insensitive' } },
                  ],
                },
              },
            },
          },
        ],
      },
      take: 10, // Limit results for autocomplete
      select: {
        id: true,
        name: true,
        city: true,
        phone: true,
        members: {
          select: {
            user: {
              select: {
                name: true,
                phone: true,
              },
            },
          },
          take: 1, // Get primary owner details
        },
      },
    });

    const result = orgs.map((org) => ({
      id: org.id,
      name: org.name,
      city: org.city,
      phone: org.phone || org.members[0]?.user.phone,
      ownerName: org.members[0]?.user.name,
      displayLabel: `${org.name} (${org.city || 'No City'}) - ${org.members[0]?.user.name}`,
    }));

    // Cache for 5 minutes (300 seconds)
    await redisClient.set(cacheKey, JSON.stringify(result), 'EX', 300);

    return result;
  }
}

