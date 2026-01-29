import prisma from '../config/database';
import { NotFoundError, ForbiddenError, ConflictError } from '../utils/errors';
import { CreateOrgDto, UpdateOrgDto, AddMemberDto } from './org.dto';
import { OrgMemberRole } from '@prisma/client';

export class OrgService {
  async createOrg(data: CreateOrgDto, createdBy: string) {
    // Create org and add creator as owner in a transaction
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

      // Add creator as owner
      await tx.orgMember.create({
        data: {
          orgId: org.id,
          userId: createdBy,
          role: OrgMemberRole.OWNER,
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
        drivers: {
          select: {
            id: true,
            user: {
              select: {
                id: true,
                name: true,
                phone: true,
              },
            },
            licenseNo: true,
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
      userRole: m.role,
    }));
  }

  async updateOrg(orgId: string, data: UpdateOrgDto, userId: string) {
    // Check if user is owner or admin
    const membership = await prisma.orgMember.findUnique({
      where: {
        orgId_userId: {
          orgId,
          userId,
        },
      },
    });

    if (!membership || membership.role === OrgMemberRole.STAFF) {
      throw new ForbiddenError('Only owners can update organization');
    }

    const org = await prisma.org.update({
      where: { id: orgId },
      data,
    });

    return org;
  }

  async deleteOrg(orgId: string, userId: string) {
    // Only owner can delete
    const membership = await prisma.orgMember.findUnique({
      where: {
        orgId_userId: {
          orgId,
          userId,
        },
      },
    });

    if (!membership || membership.role !== OrgMemberRole.OWNER) {
      throw new ForbiddenError('Only organization owner can delete');
    }

    // Delete org (cascade will handle members, trips, etc.)
    await prisma.org.delete({
      where: { id: orgId },
    });

    return { success: true };
  }

  async addMember(orgId: string, data: AddMemberDto, addedBy: string) {
    // Check if requester is owner or admin
    const requesterMembership = await prisma.orgMember.findUnique({
      where: {
        orgId_userId: {
          orgId,
          userId: addedBy,
        },
      },
    });

    if (!requesterMembership || requesterMembership.role === OrgMemberRole.STAFF) {
      throw new ForbiddenError('Only owners can add members');
    }

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: data.userId },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Check if already a member
    const existingMember = await prisma.orgMember.findUnique({
      where: {
        orgId_userId: {
          orgId,
          userId: data.userId,
        },
      },
    });

    if (existingMember) {
      throw new ConflictError('User is already a member');
    }

    const member = await prisma.orgMember.create({
      data: {
        orgId,
        userId: data.userId,
        role: data.role,
      },
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
    });

    return member;
  }

  async updateMemberRole(
    orgId: string,
    memberId: string,
    newRole: OrgMemberRole,
    updatedBy: string
  ) {
    // Only owner can update roles
    const requesterMembership = await prisma.orgMember.findUnique({
      where: {
        orgId_userId: {
          orgId,
          userId: updatedBy,
        },
      },
    });

    if (!requesterMembership || requesterMembership.role !== OrgMemberRole.OWNER) {
      throw new ForbiddenError('Only organization owner can update member roles');
    }

    const member = await prisma.orgMember.update({
      where: { id: memberId },
      data: { role: newRole },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
      },
    });

    return member;
  }

  async removeMember(orgId: string, memberId: string, removedBy: string) {
    // Check if requester is owner
    const requesterMembership = await prisma.orgMember.findUnique({
      where: {
        orgId_userId: {
          orgId,
          userId: removedBy,
        },
      },
    });

    if (!requesterMembership || requesterMembership.role !== OrgMemberRole.OWNER) {
      throw new ForbiddenError('Only organization owner can remove members');
    }

    // Get member to check if they're the owner
    const memberToRemove = await prisma.orgMember.findUnique({
      where: { id: memberId },
    });

    if (!memberToRemove) {
      throw new NotFoundError('Member not found');
    }

    if (memberToRemove.role === OrgMemberRole.OWNER) {
      throw new ForbiddenError('Cannot remove organization owner');
    }

    await prisma.orgMember.delete({
      where: { id: memberId },
    });

    return { success: true };
  }
}
