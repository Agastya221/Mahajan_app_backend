import prisma from '../config/database';
import { redisClient } from '../config/redis';
import { NotFoundError, ForbiddenError } from '../utils/errors';
import { CreateOrgDto, UpdateOrgDto } from './org.dto';
import { Prisma } from '@prisma/client';

export class OrgService {
  async createOrg(data: CreateOrgDto, createdBy: string) {
    // Create org and add creator as member in a transaction
    const result = await prisma.$transaction(async (tx) => {
      const org = await tx.org.create({
        data: {
          name: data.name,
          city: data.city,
          phone: data.phone,
          address: data.address ? (data.address as any) : Prisma.JsonNull,
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

      // ============================================
      // ✅ AUTO-CONNECT INVITES (Add Mahajan Flow)
      // ============================================
      if (data.phone) {
        // Find any pending invites for this phone
        let normalizedPhone = data.phone.trim();
        if (normalizedPhone.length === 10 && !normalizedPhone.startsWith('+91')) {
          normalizedPhone = `+91${normalizedPhone}`;
        }

        const pendingInvites = await tx.mahajanInvite.findMany({
          where: {
            invitedPhone: normalizedPhone,
            status: 'PENDING',
          },
        });

        for (const invite of pendingInvites) {
          // 1. Mark invite as Accepted & link real org
          await tx.mahajanInvite.update({
            where: { id: invite.id },
            data: {
              status: 'ACCEPTED',
              inviteeOrgId: org.id, // Replace placeholder org ID with real org ID
            },
          });

          // 2. Transfer chat thread from placeholder org to real org
          if (invite.inviteeOrgId) {
            // Find the thread involving the inviter and the placeholder
            const placeholderThread = await tx.chatThread.findFirst({
              where: {
                OR: [
                  { orgId: invite.invitedByOrgId, counterpartyOrgId: invite.inviteeOrgId },
                  { orgId: invite.inviteeOrgId, counterpartyOrgId: invite.invitedByOrgId }
                ]
              },
            });

            if (placeholderThread) {
              // Ensure we order the new IDs correctly to prevent duplicates
              const [newOrgA, newOrgB] = invite.invitedByOrgId < org.id
                ? [invite.invitedByOrgId, org.id]
                : [org.id, invite.invitedByOrgId];

              // Check if a real thread already exists somehow (edge case)
              const existingRealThread = await tx.chatThread.findUnique({
                where: {
                  orgId_counterpartyOrgId: {
                    orgId: newOrgA,
                    counterpartyOrgId: newOrgB,
                  }
                }
              });

              if (!existingRealThread) {
                // Safe to transfer the placeholder thread to the real org
                await tx.chatThread.update({
                  where: { id: placeholderThread.id },
                  data: {
                    orgId: newOrgA,
                    counterpartyOrgId: newOrgB
                  }
                });
                // 3. Delete the placeholder org as it's no longer needed
                await tx.org.delete({ where: { id: invite.inviteeOrgId } }).catch(() => { });
              } else {
                // A real thread already exists. Move messages from placeholder thread to real thread
                await tx.chatMessage.updateMany({
                  where: { threadId: placeholderThread.id },
                  data: { threadId: existingRealThread.id }
                });
                // Delete the old placeholder thread and org
                await tx.chatThread.delete({ where: { id: placeholderThread.id } });
                await tx.org.delete({ where: { id: invite.inviteeOrgId } }).catch(() => { });
              }
            } else {
              // Should not happen, but if no placeholder thread exists, ensure one exists for real pair
              const [newOrgA, newOrgB] = invite.invitedByOrgId < org.id
                ? [invite.invitedByOrgId, org.id]
                : [org.id, invite.invitedByOrgId];

              await tx.chatThread.upsert({
                where: {
                  orgId_counterpartyOrgId: {
                    orgId: newOrgA,
                    counterpartyOrgId: newOrgB,
                  }
                },
                update: {},
                create: {
                  orgId: newOrgA,
                  counterpartyOrgId: newOrgB,
                  type: 'ORG_CHAT'
                }
              });
            }
          }
        }
      }

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
      data: {
        ...data,
        address: data.address ? (data.address as any) : undefined,
      },
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
        address: true,
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
      address: org.address,
      phone: org.phone || org.members[0]?.user.phone,
      ownerName: org.members[0]?.user.name,
      displayLabel: `${org.name} (${org.city || 'No City'}) - ${org.members[0]?.user.name}`,
    }));

    // Cache for 5 minutes (300 seconds)
    await redisClient.set(cacheKey, JSON.stringify(result), 'EX', 300);

    return result;
  }

  async searchOrgsByPhone(phone: string) {
    // Normalize phone format if needed (e.g. ensure +91 prefix)
    let normalizedPhone = phone.trim();
    if (normalizedPhone.length === 10 && !normalizedPhone.startsWith('+91')) {
      normalizedPhone = `+91${normalizedPhone}`;
    }

    // Try finding exact match by org.phone first
    let org = await prisma.org.findFirst({
      where: { phone: normalizedPhone },
      include: { members: { select: { user: { select: { name: true, phone: true } } } } }
    });

    if (!org) {
      // Try finding org through owner's user.phone
      org = await prisma.org.findFirst({
        where: {
          members: {
            some: {
              user: { phone: normalizedPhone }
            }
          }
        },
        include: { members: { select: { user: { select: { name: true, phone: true } } } } }
      });
    }

    if (!org) return null;

    return {
      id: org.id,
      name: org.name,
      city: org.city,
      address: org.address,
      phone: org.phone || org.members[0]?.user?.phone || null,
      memberCount: org.members.length, // Let the frontend deduce if it's a guest org with 0 members
      isGuest: org.members.length === 0, // Optionally explicitly add the flag so frontend doesn't need to guess
    };
  }
}

