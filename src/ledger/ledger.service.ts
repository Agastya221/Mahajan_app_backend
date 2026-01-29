import prisma from '../config/database';
import { NotFoundError, ForbiddenError, ConflictError, ValidationError } from '../utils/errors';
import { CreateAccountDto, CreateInvoiceDto, UpdateInvoiceDto, CreatePaymentDto } from './ledger.dto';
import { LedgerDirection } from '@prisma/client';

export class LedgerService {
  // Account Management
  async createOrGetAccount(data: CreateAccountDto, createdBy: string) {
    // Verify user is member of owner org
    const membership = await prisma.orgMember.findUnique({
      where: {
        orgId_userId: {
          orgId: data.ownerOrgId,
          userId: createdBy,
        },
      },
    });

    if (!membership) {
      throw new ForbiddenError('Not a member of the owner organization');
    }

    // Validate orgs are different
    if (data.ownerOrgId === data.counterpartyOrgId) {
      throw new ValidationError('Owner and counterparty organizations must be different');
    }

    // Check if account already exists
    let account = await prisma.account.findUnique({
      where: {
        ownerOrgId_counterpartyOrgId: {
          ownerOrgId: data.ownerOrgId,
          counterpartyOrgId: data.counterpartyOrgId,
        },
      },
      include: {
        ownerOrg: {
          select: { id: true, name: true, gstin: true },
        },
        counterpartyOrg: {
          select: { id: true, name: true, gstin: true },
        },
      },
    });

    if (account) {
      return { account, isNew: false };
    }

    // Create dual accounts (owner->counterparty and counterparty->owner)
    const result = await prisma.$transaction(async (tx) => {
      // Account from owner's perspective
      const ownerAccount = await tx.account.create({
        data: {
          ownerOrgId: data.ownerOrgId,
          counterpartyOrgId: data.counterpartyOrgId,
          balance: 0,
        },
        include: {
          ownerOrg: {
            select: { id: true, name: true, gstin: true },
          },
          counterpartyOrg: {
            select: { id: true, name: true, gstin: true },
          },
        },
      });

      // Mirror account from counterparty's perspective
      await tx.account.create({
        data: {
          ownerOrgId: data.counterpartyOrgId,
          counterpartyOrgId: data.ownerOrgId,
          balance: 0,
        },
      });

      return ownerAccount;
    });

    return { account: result, isNew: true };
  }

  async getAccounts(orgId: string, userId: string) {
    // Verify user is member of org
    const membership = await prisma.orgMember.findUnique({
      where: {
        orgId_userId: {
          orgId,
          userId,
        },
      },
    });

    if (!membership) {
      throw new ForbiddenError('Not a member of this organization');
    }

    const accounts = await prisma.account.findMany({
      where: {
        ownerOrgId: orgId,
      },
      include: {
        ownerOrg: {
          select: { id: true, name: true, gstin: true },
        },
        counterpartyOrg: {
          select: { id: true, name: true, gstin: true },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return accounts;
  }

  async getAccountById(accountId: string, userId: string) {
    const account = await prisma.account.findUnique({
      where: { id: accountId },
      include: {
        ownerOrg: {
          select: { id: true, name: true, gstin: true, city: true },
        },
        counterpartyOrg: {
          select: { id: true, name: true, gstin: true, city: true },
        },
      },
    });

    if (!account) {
      throw new NotFoundError('Account not found');
    }

    // Verify user has access
    const hasAccess = await prisma.orgMember.findFirst({
      where: {
        userId,
        orgId: { in: [account.ownerOrgId, account.counterpartyOrgId] },
      },
    });

    if (!hasAccess) {
      throw new ForbiddenError('Not authorized to view this account');
    }

    return account;
  }

  // Invoice Management
  async createInvoice(data: CreateInvoiceDto, createdBy: string) {
    const account = await prisma.account.findUnique({
      where: { id: data.accountId },
      include: {
        ownerOrg: {
          select: { id: true, name: true },
        },
      },
    });

    if (!account) {
      throw new NotFoundError('Account not found');
    }

    // Verify user is member of owner org
    const membership = await prisma.orgMember.findFirst({
      where: {
        userId: createdBy,
        orgId: account.ownerOrgId,
      },
    });

    if (!membership) {
      throw new ForbiddenError('Only owner organization can create invoices');
    }

    // ✅ BUSINESS LOGIC FIX: Check for duplicate invoice number per account (not globally)
    const existing = await prisma.invoice.findFirst({
      where: {
        accountId: data.accountId,
        invoiceNumber: data.invoiceNumber,
      },
    });

    if (existing) {
      throw new ConflictError('Invoice number already exists for this account');
    }

    // Create invoice + ledger entry in transaction
    const result = await prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.create({
        data: {
          accountId: data.accountId,
          invoiceNumber: data.invoiceNumber,
          total: data.amount,
          description: data.description,
          dueDate: data.dueDate ? new Date(data.dueDate) : null,
          status: 'OPEN',
        },
      });

      // Link attachments if provided
      if (data.attachmentIds && data.attachmentIds.length > 0) {
        await tx.attachment.updateMany({
          where: {
            id: { in: data.attachmentIds },
            uploadedBy: createdBy,
          },
          data: {
            invoiceId: invoice.id,
          },
        });
      }

      // ✅ RACE CONDITION FIX: Use atomic increment instead of read-modify-write
      // Update account balance atomically
      const updatedAccount = await tx.account.update({
        where: { id: data.accountId },
        data: { balance: { increment: data.amount } },
        select: { balance: true },
      });

      const newBalance = updatedAccount.balance;

      // Create ledger entry
      await tx.ledgerEntry.create({
        data: {
          accountId: data.accountId,
          direction: LedgerDirection.PAYABLE,
          amount: data.amount,
          balance: newBalance,
          description: `Invoice ${data.invoiceNumber}${data.description ? ': ' + data.description : ''}`,
          referenceType: 'INVOICE',
          referenceId: invoice.id,
        },
      });

      // ✅ CRITICAL FIX: Validate mirror account exists before updating
      const mirrorAccount = await tx.account.findUnique({
        where: {
          ownerOrgId_counterpartyOrgId: {
            ownerOrgId: account.counterpartyOrgId,
            counterpartyOrgId: account.ownerOrgId,
          },
        },
        select: { id: true, balance: true },
      });

      if (!mirrorAccount) {
        throw new Error(
          `Mirror account not found for account ${account.id}. Database integrity compromised.`
        );
      }

      // ✅ CRITICAL FIX: Update mirror account balance atomically
      const updatedMirror = await tx.account.update({
        where: { id: mirrorAccount.id },
        data: { balance: { decrement: data.amount } },
        select: { balance: true },
      });

      // Create mirror ledger entry
      await tx.ledgerEntry.create({
        data: {
          accountId: mirrorAccount.id,
          direction: LedgerDirection.RECEIVABLE,
          amount: data.amount,
          balance: updatedMirror.balance,
          description: `Invoice ${data.invoiceNumber} from ${account.ownerOrg.name}`,
          referenceType: 'INVOICE',
          referenceId: invoice.id,
        },
      });

      return invoice;
    });

    return result;
  }

  async getInvoices(accountId: string, userId: string) {
    await this.getAccountById(accountId, userId);

    const invoices = await prisma.invoice.findMany({
      where: { accountId },
      include: {
        attachments: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return invoices;
  }

  async updateInvoice(invoiceId: string, data: UpdateInvoiceDto, userId: string) {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        account: true,
      },
    });

    if (!invoice) {
      throw new NotFoundError('Invoice not found');
    }

    // Verify user has access
    const hasAccess = await prisma.orgMember.findFirst({
      where: {
        userId,
        orgId: invoice.account.ownerOrgId,
      },
    });

    if (!hasAccess) {
      throw new ForbiddenError('Not authorized to update this invoice');
    }

    const updated = await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status: data.isPaid ? 'PAID' : undefined,
        description: data.notes,
      },
    });

    return updated;
  }

  // Payment Management
  async createPayment(data: CreatePaymentDto, createdBy: string) {
    const account = await prisma.account.findUnique({
      where: { id: data.accountId },
      include: {
        ownerOrg: {
          select: { id: true, name: true },
        },
      },
    });

    if (!account) {
      throw new NotFoundError('Account not found');
    }

    // Verify user has access (either org can record payment)
    const hasAccess = await prisma.orgMember.findFirst({
      where: {
        userId: createdBy,
        orgId: { in: [account.ownerOrgId, account.counterpartyOrgId] },
      },
    });

    if (!hasAccess) {
      throw new ForbiddenError('Not authorized to record payment for this account');
    }

    // Create payment + ledger entry + chat message in transaction
    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          accountId: data.accountId,
          amount: data.amount,
          tag: data.tag,
          mode: data.paymentMethod,
          reference: data.transactionId,
          remarks: data.remarks,
        },
      });

      // Link attachments if provided
      if (data.attachmentIds && data.attachmentIds.length > 0) {
        await tx.attachment.updateMany({
          where: {
            id: { in: data.attachmentIds },
            uploadedBy: createdBy,
          },
          data: {
            paymentId: payment.id,
          },
        });
      }

      // ✅ BUSINESS LOGIC FIX: Validate sufficient balance before payment
      const currentAccount = await tx.account.findUnique({
        where: { id: data.accountId },
        select: { balance: true },
      });

      if (!currentAccount) {
        throw new Error('Account not found');
      }

      if (currentAccount.balance < BigInt(data.amount)) {
        throw new ValidationError(
          `Insufficient balance. Current balance: ₹${(Number(currentAccount.balance) / 100).toFixed(2)}, ` +
          `Payment amount: ₹${(Number(data.amount) / 100).toFixed(2)}`
        );
      }

      // ✅ RACE CONDITION FIX: Use atomic decrement instead of read-modify-write
      const updatedAccount = await tx.account.update({
        where: { id: data.accountId },
        data: { balance: { decrement: data.amount } },
        select: { balance: true },
      });

      const newBalance = updatedAccount.balance;

      // Create ledger entry
      await tx.ledgerEntry.create({
        data: {
          accountId: data.accountId,
          direction: LedgerDirection.RECEIVABLE,
          amount: data.amount,
          balance: newBalance,
          description: `Payment received - ${data.tag} (${data.paymentMethod})${data.remarks ? ': ' + data.remarks : ''}`,
          referenceType: 'PAYMENT',
          referenceId: payment.id,
        },
      });

      // ✅ CRITICAL FIX: Validate mirror account exists before updating
      const mirrorAccount = await tx.account.findUnique({
        where: {
          ownerOrgId_counterpartyOrgId: {
            ownerOrgId: account.counterpartyOrgId,
            counterpartyOrgId: account.ownerOrgId,
          },
        },
        select: { id: true, balance: true },
      });

      if (!mirrorAccount) {
        throw new Error(
          `Mirror account not found for account ${account.id}. Database integrity compromised.`
        );
      }

      // Update mirror account balance atomically
      const updatedMirror = await tx.account.update({
        where: { id: mirrorAccount.id },
        data: { balance: { increment: data.amount } },
        select: { balance: true },
      });

      // Create mirror ledger entry
      await tx.ledgerEntry.create({
        data: {
          accountId: mirrorAccount.id,
          direction: LedgerDirection.PAYABLE,
          amount: data.amount,
          balance: updatedMirror.balance,
          description: `Payment sent to ${account.ownerOrg.name} - ${data.tag}`,
          referenceType: 'PAYMENT',
          referenceId: payment.id,
        },
      });

      // Get or create chat thread
      let thread = await tx.chatThread.findFirst({
        where: { accountId: data.accountId },
      });

      if (!thread) {
        thread = await tx.chatThread.create({
          data: {
            orgId: account.ownerOrgId,
            accountId: data.accountId,
          },
        });
      }

      // Create auto chat message
      const chatMessage = await tx.chatMessage.create({
        data: {
          threadId: thread.id,
          senderUserId: createdBy,
          content: `Payment of ₹${(Number(data.amount) / 100).toFixed(2)} received via ${data.paymentMethod} (${data.tag})`,
          messageType: 'PAYMENT_NOTIFICATION',
          paymentId: payment.id,
        },
      });

      return { payment, chatMessage, threadId: thread.id, newBalance };
    });

    return result;
  }

  async getPayments(accountId: string, userId: string) {
    await this.getAccountById(accountId, userId); // Verify access

    const payments = await prisma.payment.findMany({
      where: { accountId },
      include: {
        attachments: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return payments;
  }

  // Ledger Timeline
  async getLedgerTimeline(accountId: string, userId: string, limit = 50, offset = 0) {
    await this.getAccountById(accountId, userId); // Verify access

    // ✅ SECURITY FIX: Enforce maximum pagination limit
    const MAX_LIMIT = 500;
    const safeLimit = Math.min(limit, MAX_LIMIT);

    const entries = await prisma.ledgerEntry.findMany({
      where: { accountId },
      orderBy: {
        createdAt: 'desc',
      },
      take: safeLimit,
      skip: offset,
    });

    const total = await prisma.ledgerEntry.count({
      where: { accountId },
    });

    return {
      entries,
      pagination: {
        total,
        limit: safeLimit,
        offset,
        hasMore: offset + safeLimit < total,
      },
    };
  }
}
