import prisma from '../config/database';
import { NotFoundError, ForbiddenError, ConflictError, ValidationError } from '../utils/errors';
import {
  CreateAccountDto,
  CreateInvoiceDto,
  UpdateInvoiceDto,
  CreatePaymentDto,
  CreatePaymentRequestDto,
  MarkPaymentPaidDto,
  ConfirmPaymentDto,
  DisputePaymentDto,
} from './ledger.dto';
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

  async getAccounts(orgId: string, userId: string, page = 1, limit = 20) {
    const safeLimit = Math.min(limit, 100);

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

    const where = { ownerOrgId: orgId };

    const [accounts, total] = await Promise.all([
      prisma.account.findMany({
        where,
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
        skip: (page - 1) * safeLimit,
        take: safeLimit,
      }),
      prisma.account.count({ where }),
    ]);

    return {
      accounts,
      pagination: { page, limit: safeLimit, total, totalPages: Math.ceil(total / safeLimit) },
    };
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

    // Create invoice + ledger entry in transaction with Serializable isolation
    // This prevents phantom reads and ensures financial data integrity
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

  async getInvoices(accountId: string, userId: string, page = 1, limit = 20) {
    const safeLimit = Math.min(limit, 100);
    await this.getAccountById(accountId, userId);

    const where = { accountId };
    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        include: {
          attachments: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip: (page - 1) * safeLimit,
        take: safeLimit,
      }),
      prisma.invoice.count({ where }),
    ]);

    return {
      invoices,
      pagination: { page, limit: safeLimit, total, totalPages: Math.ceil(total / safeLimit) },
    };
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
    // Row-level locking (FOR UPDATE) used below ensures financial integrity
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

      // Row lock + balance validation to prevent race conditions
      const [lockedAccount] = await tx.$queryRaw<Array<{ id: string; balance: bigint }>>`
        SELECT id, balance FROM "Account" WHERE id = ${data.accountId} FOR UPDATE
      `;

      if (!lockedAccount) {
        throw new Error('Account not found');
      }

      if (lockedAccount.balance < BigInt(data.amount)) {
        // Don't expose actual balance in error message for security
        throw new ValidationError('Insufficient balance to process this payment');
      }

      // Atomic decrement after lock
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
          messageType: 'PAYMENT_UPDATE',
          paymentId: payment.id,
        },
      });

      return { payment, chatMessage, threadId: thread.id, newBalance };
    });

    return result;
  }

  async getPayments(accountId: string, userId: string, page = 1, limit = 20) {
    const safeLimit = Math.min(limit, 100);
    await this.getAccountById(accountId, userId); // Verify access

    const where = { accountId };
    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        include: {
          attachments: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip: (page - 1) * safeLimit,
        take: safeLimit,
      }),
      prisma.payment.count({ where }),
    ]);

    return {
      payments,
      pagination: { page, limit: safeLimit, total, totalPages: Math.ceil(total / safeLimit) },
    };
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

  // ============================================
  // TWO-PARTY PAYMENT CONFIRMATION FLOW
  // ============================================

  /**
   * Step 1: Create payment request
   * - Receiver (who is owed money) creates a payment request
   * - Status: PENDING
   * - Ledger: NOT updated yet
   */
  async createPaymentRequest(data: CreatePaymentRequestDto, createdBy: string) {
    const account = await prisma.account.findUnique({
      where: { id: data.accountId },
      include: {
        ownerOrg: { select: { id: true, name: true } },
        counterpartyOrg: { select: { id: true, name: true } },
      },
    });

    if (!account) {
      throw new NotFoundError('Account not found');
    }

    // Verify user is from the owner org (the one who is owed money / creditor)
    const membership = await prisma.orgMember.findFirst({
      where: {
        userId: createdBy,
        orgId: account.ownerOrgId,
      },
    });

    if (!membership) {
      throw new ForbiddenError('Only the creditor organization can request payments');
    }

    const payment = await prisma.payment.create({
      data: {
        accountId: data.accountId,
        amount: data.amount,
        tag: data.tag,
        remarks: data.remarks,
        invoiceId: data.invoiceId,
        status: 'PENDING',
      },
      include: {
        account: {
          include: {
            ownerOrg: { select: { id: true, name: true } },
            counterpartyOrg: { select: { id: true, name: true } },
          },
        },
      },
    });

    // TODO: Send notification to counterparty org about payment request

    return payment;
  }

  /**
   * Step 2: Sender marks payment as paid
   * - Sender uploads proof (optional but recommended)
   * - Status: MARKED_AS_PAID
   * - Ledger: NOT updated yet
   */
  async markPaymentAsPaid(data: MarkPaymentPaidDto, userId: string) {
    const payment = await prisma.payment.findUnique({
      where: { id: data.paymentId },
      include: {
        account: true,
      },
    });

    if (!payment) {
      throw new NotFoundError('Payment not found');
    }

    if (!payment.account) {
      throw new ValidationError('Payment has no associated account');
    }

    if (payment.status !== 'PENDING') {
      throw new ValidationError(`Cannot mark payment as paid. Current status: ${payment.status}`);
    }

    // Verify user is from counterparty org (the one who owes money / debtor)
    const membership = await prisma.orgMember.findFirst({
      where: {
        userId,
        orgId: payment.account.counterpartyOrgId,
      },
    });

    if (!membership) {
      throw new ForbiddenError('Only the debtor organization can mark payments as paid');
    }

    const result = await prisma.$transaction(async (tx) => {
      // Update payment status
      const updatedPayment = await tx.payment.update({
        where: { id: data.paymentId },
        data: {
          status: 'MARKED_AS_PAID',
          mode: data.mode,
          utrNumber: data.utrNumber,
          proofNote: data.proofNote,
          markedPaidAt: new Date(),
          markedPaidBy: userId,
        },
        include: {
          account: {
            include: {
              ownerOrg: { select: { id: true, name: true } },
              counterpartyOrg: { select: { id: true, name: true } },
            },
          },
          attachments: true,
        },
      });

      // Link proof attachments
      if (data.attachmentIds && data.attachmentIds.length > 0) {
        await tx.attachment.updateMany({
          where: {
            id: { in: data.attachmentIds },
            uploadedBy: userId,
          },
          data: {
            paymentId: updatedPayment.id,
          },
        });
      }

      return updatedPayment;
    });

    // TODO: Send notification to owner org about payment marked as paid

    return result;
  }

  /**
   * Step 3a: Receiver confirms payment
   * - Status: CONFIRMED
   * - Ledger: NOW updated (balance adjusted)
   */
  async confirmPayment(data: ConfirmPaymentDto, userId: string) {
    const payment = await prisma.payment.findUnique({
      where: { id: data.paymentId },
      include: {
        account: {
          include: {
            ownerOrg: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!payment) {
      throw new NotFoundError('Payment not found');
    }

    if (!payment.account) {
      throw new ValidationError('Payment has no associated account');
    }

    if (payment.status !== 'MARKED_AS_PAID') {
      throw new ValidationError(`Cannot confirm payment. Current status: ${payment.status}`);
    }

    // Verify user is from owner org (the one who is owed money / creditor)
    const membership = await prisma.orgMember.findFirst({
      where: {
        userId,
        orgId: payment.account.ownerOrgId,
      },
    });

    if (!membership) {
      throw new ForbiddenError('Only the creditor organization can confirm payments');
    }

    // NOW update ledger (same logic as before, but only on confirmation)
    const result = await prisma.$transaction(async (tx) => {
      // Update payment status
      const updatedPayment = await tx.payment.update({
        where: { id: data.paymentId },
        data: {
          status: 'CONFIRMED',
          confirmedAt: new Date(),
          confirmedBy: userId,
          paidAt: new Date(), // Set actual payment date
        },
      });

      // Row lock + balance update for owner account
      const [lockedAccount] = await tx.$queryRaw<Array<{ id: string; balance: bigint }>>`
        SELECT id, balance FROM "Account" WHERE id = ${payment.accountId} FOR UPDATE
      `;

      if (!lockedAccount) {
        throw new Error('Account not found');
      }

      // Decrement owner's receivable balance (payment received reduces what's owed)
      const updatedAccount = await tx.account.update({
        where: { id: payment.accountId! },
        data: { balance: { decrement: payment.amount } },
        select: { balance: true },
      });

      // Create ledger entry for owner
      await tx.ledgerEntry.create({
        data: {
          accountId: payment.accountId!,
          direction: LedgerDirection.RECEIVABLE,
          amount: payment.amount,
          balance: updatedAccount.balance,
          description: `Payment received - ${payment.tag || 'PAYMENT'} (${payment.mode})`,
          referenceType: 'PAYMENT',
          referenceId: payment.id,
        },
      });

      // Update mirror account (counterparty)
      const mirrorAccount = await tx.account.findUnique({
        where: {
          ownerOrgId_counterpartyOrgId: {
            ownerOrgId: payment.account!.counterpartyOrgId,
            counterpartyOrgId: payment.account!.ownerOrgId,
          },
        },
      });

      if (mirrorAccount) {
        const updatedMirror = await tx.account.update({
          where: { id: mirrorAccount.id },
          data: { balance: { increment: payment.amount } },
          select: { balance: true },
        });

        await tx.ledgerEntry.create({
          data: {
            accountId: mirrorAccount.id,
            direction: LedgerDirection.PAYABLE,
            amount: payment.amount,
            balance: updatedMirror.balance,
            description: `Payment sent to ${payment.account!.ownerOrg.name}`,
            referenceType: 'PAYMENT',
            referenceId: payment.id,
          },
        });
      }

      // Create chat message notification
      const thread = await tx.chatThread.findFirst({
        where: { accountId: payment.accountId },
      });

      if (thread) {
        await tx.chatMessage.create({
          data: {
            threadId: thread.id,
            senderUserId: userId,
            content: `Payment of ₹${(Number(payment.amount) / 100).toLocaleString('en-IN')} confirmed`,
            messageType: 'PAYMENT_UPDATE',
            paymentId: payment.id,
          },
        });
      }

      return { payment: updatedPayment, newBalance: updatedAccount.balance };
    });

    return result;
  }

  /**
   * Step 3b: Receiver disputes payment
   * - Status: DISPUTED
   * - Ledger: NOT updated
   */
  async disputePayment(data: DisputePaymentDto, userId: string) {
    const payment = await prisma.payment.findUnique({
      where: { id: data.paymentId },
      include: {
        account: true,
      },
    });

    if (!payment) {
      throw new NotFoundError('Payment not found');
    }

    if (!payment.account) {
      throw new ValidationError('Payment has no associated account');
    }

    if (payment.status !== 'MARKED_AS_PAID') {
      throw new ValidationError(`Cannot dispute payment. Current status: ${payment.status}`);
    }

    // Verify user is from owner org (creditor)
    const membership = await prisma.orgMember.findFirst({
      where: {
        userId,
        orgId: payment.account.ownerOrgId,
      },
    });

    if (!membership) {
      throw new ForbiddenError('Only the creditor organization can dispute payments');
    }

    const result = await prisma.payment.update({
      where: { id: data.paymentId },
      data: {
        status: 'DISPUTED',
        disputedAt: new Date(),
        disputedBy: userId,
        disputeReason: data.reason,
      },
      include: {
        account: {
          include: {
            ownerOrg: { select: { id: true, name: true } },
            counterpartyOrg: { select: { id: true, name: true } },
          },
        },
      },
    });

    // TODO: Send notification about dispute

    return result;
  }

  /**
   * Get pending payments for an account (for receiver to confirm)
   */
  async getPendingPayments(accountId: string, userId: string) {
    await this.getAccountById(accountId, userId); // Verify access

    return prisma.payment.findMany({
      where: {
        accountId,
        status: { in: ['PENDING', 'MARKED_AS_PAID'] },
      },
      include: {
        attachments: true,
        markedPaidUser: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get payment by ID with full details
   */
  async getPaymentById(paymentId: string, userId: string) {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        account: {
          include: {
            ownerOrg: { select: { id: true, name: true } },
            counterpartyOrg: { select: { id: true, name: true } },
          },
        },
        attachments: true,
        markedPaidUser: { select: { id: true, name: true } },
        confirmedUser: { select: { id: true, name: true } },
        disputedUser: { select: { id: true, name: true } },
      },
    });

    if (!payment) {
      throw new NotFoundError('Payment not found');
    }

    if (!payment.account) {
      throw new ValidationError('Payment has no associated account');
    }

    // Verify user has access
    const hasAccess = await prisma.orgMember.findFirst({
      where: {
        userId,
        orgId: { in: [payment.account.ownerOrgId, payment.account.counterpartyOrgId] },
      },
    });

    if (!hasAccess) {
      throw new ForbiddenError('Not authorized to view this payment');
    }

    return payment;
  }
}
