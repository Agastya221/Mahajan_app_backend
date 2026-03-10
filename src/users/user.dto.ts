import { z } from 'zod';

// ── GSTIN ──
export const submitGstinSchema = z.object({
  gstin: z.string().regex(
    /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/,
    'Invalid GSTIN format (15 chars: 2-digit state + 10 PAN + 1 entity + 1 Z + 1 check)'
  ),
});

export type SubmitGstinDto = z.infer<typeof submitGstinSchema>;

// ── Contact Discovery ──
export const checkContactsSchema = z.object({
  phones: z
    .array(z.string().min(1))
    .min(1, 'At least 1 phone number required')
    .max(500, 'Maximum 500 phone numbers per request'),
});

export type CheckContactsDto = z.infer<typeof checkContactsSchema>;

// ── Profile ──
export const updateNameSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
});

export const updateBioSchema = z.object({
  bio: z.string().max(200, 'Bio cannot exceed 200 characters').default(''),
});

export const photoUploadUrlSchema = z.object({
  filename: z.string().min(1),
  mimeType: z.enum(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']),
  fileSize: z.number().positive().max(5 * 1024 * 1024, 'Max 5MB'),
});

export const confirmPhotoSchema = z.object({
  fileId: z.string().cuid(),
  s3Key: z.string().min(1),
});

// ── Phone Change ──
export const requestPhoneChangeSchema = z.object({
  newPhone: z.string().regex(/^\+91\d{10}$/, 'Invalid Indian phone number'),
});

export const confirmPhoneChangeSchema = z.object({
  phoneChangeToken: z.string().min(1),
  msg91AccessToken: z.string().min(1),
});

// ── Report User ──
export const reportUserSchema = z.object({
  reason: z.enum(['SPAM', 'FRAUD', 'HARASSMENT', 'FAKE_ACCOUNT', 'OTHER']),
  details: z.string().max(500).optional(),
});
