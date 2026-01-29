import { z } from 'zod';
import { gstinSchema, phoneSchema } from '../utils/validators';
import { MahajanRoleType, OrgMemberRole } from '@prisma/client';

export const createOrgSchema = z.object({
  name: z.string().min(2, 'Organization name must be at least 2 characters'),
  city: z.string().optional(),
  phone: phoneSchema.optional(),
  address: z.string().optional(),
  gstin: gstinSchema,
  roleType: z.nativeEnum(MahajanRoleType).default(MahajanRoleType.BOTH),
});

export const updateOrgSchema = z.object({
  name: z.string().min(2).optional(),
  city: z.string().optional(),
  phone: phoneSchema.optional(),
  address: z.string().optional(),
  gstin: gstinSchema,
  roleType: z.nativeEnum(MahajanRoleType).optional(),
});

export const addMemberSchema = z.object({
  userId: z.string().cuid('Invalid user ID'),
  role: z.nativeEnum(OrgMemberRole).default(OrgMemberRole.STAFF),
});

export type CreateOrgDto = z.infer<typeof createOrgSchema>;
export type UpdateOrgDto = z.infer<typeof updateOrgSchema>;
export type AddMemberDto = z.infer<typeof addMemberSchema>;
