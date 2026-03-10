import prisma from '../config/database';
import { NotFoundError, ForbiddenError, ConflictError, ValidationError } from '../utils/errors';
import { LedgerDirection } from '@prisma/client';

export class KhataService {

    // ─── VERIFY ORG ACCESS ─────────────────────────────────
    private async verifyOrgAccess(orgId: string, userId: string) {
        const membership = await prisma.orgMember.findUnique({
            where: { orgId_userId: { orgId, userId } },
        });
        if (!membership) throw new ForbiddenError('Not a member of this organization');
        return membership;
    }

    private async verifyContactAccess(contactId: string, userId: string) {
        const contact = await prisma.khataContact.findUnique({
            where: { id: contactId },
        });
        if (!contact) throw new NotFoundError('Khata contact not found');
        await this.verifyOrgAccess(contact.orgId, userId);
        return contact;
    }

    // ─── CREATE CONTACT ────────────────────────────────────
    async createContact(orgId: string, data: {
        name: string;
        phone?: string;
        city?: string;
        notes?: string;
    }, userId: string) {
        await this.verifyOrgAccess(orgId, userId);

        // If phone provided, check no duplicate for this org
        if (data.phone) {
            const existing = await prisma.khataContact.findFirst({
                where: { orgId, phone: data.phone },
            });
            if (existing) throw new ConflictError('A khata contact with this phone already exists');
        }

        return prisma.khataContact.create({
            data: {
                orgId,
                name: data.name.trim(),
                phone: data.phone || null,
                city: data.city || null,
                notes: data.notes || null,
                balance: 0n,
            },
        });
    }

    // ─── LIST CONTACTS ─────────────────────────────────────
    async listContacts(orgId: string, userId: string, page = 1, limit = 50) {
        await this.verifyOrgAccess(orgId, userId);
        const safeLimit = Math.min(limit, 100);

        const [contacts, total] = await Promise.all([
            prisma.khataContact.findMany({
                where: { orgId },
                orderBy: { updatedAt: 'desc' },
                skip: (page - 1) * safeLimit,
                take: safeLimit,
            }),
            prisma.khataContact.count({ where: { orgId } }),
        ]);

        return {
            contacts,
            pagination: { page, limit: safeLimit, total, totalPages: Math.ceil(total / safeLimit) },
        };
    }

    // ─── GET CONTACT WITH BALANCE ──────────────────────────
    async getContact(contactId: string, userId: string) {
        const contact = await this.verifyContactAccess(contactId, userId);
        return contact;
    }

    // ─── UPDATE CONTACT ────────────────────────────────────
    async updateContact(contactId: string, data: {
        name?: string;
        phone?: string | null;
        city?: string | null;
        notes?: string | null;
    }, userId: string) {
        await this.verifyContactAccess(contactId, userId);

        return prisma.khataContact.update({
            where: { id: contactId },
            data: {
                ...(data.name ? { name: data.name.trim() } : {}),
                phone: data.phone !== undefined ? data.phone : undefined,
                city: data.city !== undefined ? data.city : undefined,
                notes: data.notes !== undefined ? data.notes : undefined,
            },
        });
    }

    // ─── DELETE CONTACT ────────────────────────────────────
    async deleteContact(contactId: string, userId: string) {
        await this.verifyContactAccess(contactId, userId);
        await prisma.khataContact.delete({ where: { id: contactId } });
        return { success: true };
    }

    // ─── RECORD SALE / ADJUSTMENT (creates KhataEntry) ────
    async recordEntry(contactId: string, data: {
        direction: 'PAYABLE' | 'RECEIVABLE';
        amount: number;
        description?: string;
        transactionType?: string;
    }, userId: string) {
        await this.verifyContactAccess(contactId, userId);

        if (data.amount <= 0) throw new ValidationError('Amount must be positive');

        const amountPaise = BigInt(Math.round(data.amount * 100));

        return prisma.$transaction(async (tx) => {
            // Row lock contact
            const [locked] = await tx.$queryRaw<Array<{ id: string; balance: bigint }>>`
        SELECT id, balance FROM "KhataContact" WHERE id = ${contactId} FOR UPDATE
      `;

            // PAYABLE = they owe us more → balance increases
            // RECEIVABLE = we owe them → balance decreases
            const newBalance = data.direction === 'PAYABLE'
                ? locked.balance + amountPaise
                : locked.balance - amountPaise;

            await tx.khataContact.update({
                where: { id: contactId },
                data: { balance: newBalance },
            });

            return tx.khataEntry.create({
                data: {
                    khataContactId: contactId,
                    direction: data.direction as LedgerDirection,
                    amount: amountPaise,
                    balance: newBalance,
                    description: data.description || null,
                    transactionType: data.transactionType || 'SALE',
                    referenceType: 'MANUAL',
                },
            });
        });
    }

    // ─── RECORD PAYMENT ────────────────────────────────────
    async recordPayment(contactId: string, data: {
        amount: number;
        mode?: string;
        tag?: string;
        remarks?: string;
    }, userId: string) {
        await this.verifyContactAccess(contactId, userId);

        if (data.amount <= 0) throw new ValidationError('Amount must be positive');

        const amountPaise = BigInt(Math.round(data.amount * 100));

        return prisma.$transaction(async (tx) => {
            const [locked] = await tx.$queryRaw<Array<{ id: string; balance: bigint }>>`
        SELECT id, balance FROM "KhataContact" WHERE id = ${contactId} FOR UPDATE
      `;

            // Payment reduces balance (they owe us less)
            const newBalance = locked.balance - amountPaise;

            await tx.khataContact.update({
                where: { id: contactId },
                data: { balance: newBalance },
            });

            await tx.khataEntry.create({
                data: {
                    khataContactId: contactId,
                    direction: LedgerDirection.RECEIVABLE,
                    amount: amountPaise,
                    balance: newBalance,
                    description: `Payment received${data.mode ? ` via ${data.mode}` : ''}`,
                    transactionType: 'PAYMENT',
                    referenceType: 'PAYMENT',
                },
            });

            return tx.khataPayment.create({
                data: {
                    khataContactId: contactId,
                    amount: amountPaise,
                    mode: data.mode || null,
                    tag: (data.tag as any) || null,
                    remarks: data.remarks || null,
                    recordedBy: userId,
                },
            });
        });
    }

    // ─── GET TIMELINE ───────────────────────────────────────
    async getTimeline(contactId: string, userId: string, limit = 50, offset = 0) {
        await this.verifyContactAccess(contactId, userId);

        const safeLimit = Math.min(limit, 100);

        const [entries, total] = await Promise.all([
            prisma.khataEntry.findMany({
                where: { khataContactId: contactId },
                orderBy: { createdAt: 'desc' },
                take: safeLimit,
                skip: offset,
            }),
            prisma.khataEntry.count({ where: { khataContactId: contactId } }),
        ]);

        const contact = await prisma.khataContact.findUnique({
            where: { id: contactId },
            select: { balance: true, name: true },
        });

        return {
            contact,
            entries,
            pagination: { total, limit: safeLimit, offset, hasMore: offset + safeLimit < total },
        };
    }
}
