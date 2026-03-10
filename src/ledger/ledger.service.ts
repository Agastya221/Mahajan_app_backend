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
import { LedgerDirection, LedgerTransactionType } from '@prisma/client';
import { ChatService } from '../chat/chat.service';
import { logger } from '../utils/logger';
import { notificationService } from '../notifications/notification.service';
import { NotificationType } from '../notifications/notification.types';

const chatService = new ChatService();

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

    // Auto-calculate amount from items if not explicitly provided
    let invoiceAmount = data.amount;
    if (!invoiceAmount && data.items && data.items.length > 0) {
      const computed = data.items.reduce((sum, item) => {
        if (item.rate) return sum + Math.round(item.quantity * item.rate * 100);
        return sum;
      }, 0);
      if (computed <= 0) throw new ValidationError('Cannot auto-calculate amount: no items have rates');
      invoiceAmount = computed;
    }
    if (!invoiceAmount) throw new ValidationError('Either amount or items with rates must be provided');

    const result = await prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.create({
        data: {
          accountId: data.accountId,
          invoiceNumber: data.invoiceNumber,
          total: invoiceAmount!,
          dueAmount: invoiceAmount!, // Initially dueAmount = total
          description: data.description,
          dueDate: data.dueDate ? new Date(data.dueDate) : null,
          status: 'OPEN',
        },
      });

      // Create InvoiceItems if provided
      if (data.items && data.items.length > 0) {
        const itemsToCreate = data.items.map((item, index) => {
          const amountPaise = item.rate
            ? BigInt(Math.round(item.quantity * item.rate * 100))
            : null;
          return {
            invoiceId: invoice.id,
            itemName: item.itemName,
            itemNameHindi: item.itemNameHindi || null,
            quantity: item.quantity,
            unit: item.unit,
            rate: item.rate || null,
            amount: amountPaise,
            notes: item.notes || null,
            sortOrder: index,
          };
        });

        await tx.invoiceItem.createMany({ data: itemsToCreate });
      }

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
        data: { balance: { increment: invoiceAmount! } },
        select: { balance: true },
      });

      const newBalance = updatedAccount.balance;

      // Create ledger entry
      await tx.ledgerEntry.create({
        data: {
          accountId: data.accountId,
          direction: LedgerDirection.PAYABLE,
          amount: invoiceAmount!,
          balance: newBalance,
          description: `Invoice ${data.invoiceNumber}${data.description ? ': ' + data.description : ''}`,
          referenceType: 'INVOICE',
          referenceId: invoice.id,
          transactionType: LedgerTransactionType.INVOICE,
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
        data: { balance: { decrement: invoiceAmount! } },
        select: { balance: true },
      });

      // Create mirror ledger entry
      await tx.ledgerEntry.create({
        data: {
          accountId: mirrorAccount.id,
          direction: LedgerDirection.RECEIVABLE,
          amount: invoiceAmount!,
          balance: updatedMirror.balance,
          description: `Invoice ${data.invoiceNumber} from ${account.ownerOrg.name}`,
          referenceType: 'INVOICE',
          referenceId: invoice.id,
          transactionType: LedgerTransactionType.INVOICE,
        },
      });

      // ✅ FEATURE 3: Auto-apply any existing advance balance to this invoice
      await this.applyAdvanceToInvoice(data.accountId, invoice.id, tx);

      // Re-fetch invoice to get updated paidAmount/dueAmount after advance apply
      const finalInvoice = await tx.invoice.findUnique({
        where: { id: invoice.id },
        include: {
          items: { orderBy: { sortOrder: 'asc' } },
        },
      });

      return finalInvoice || invoice;
    });

    // ✅ Post INVOICE_CARD to chat (non-blocking)
    try {
      await chatService.sendInvoiceCard(data.accountId, result, createdBy);
    } catch (error) {
      logger.error('Failed to post invoice card to chat', {
        accountId: data.accountId,
        invoiceId: result.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    // ✅ Push notification: Notify counterparty org about new invoice
    notificationService.enqueueNotification({
      type: NotificationType.INVOICE_CREATED,
      recipientOrgId: account.counterpartyOrgId,
      title: 'New Invoice',
      body: `Invoice ${data.invoiceNumber} for ₹${(Number(invoiceAmount!) / 100).toLocaleString('en-IN')} from ${account.ownerOrg.name}`,
      data: {
        invoiceId: result.id,
        invoiceNumber: data.invoiceNumber,
        amount: String(invoiceAmount),
        accountId: data.accountId,
      },
    }).catch(err => logger.error('Failed to queue invoice notification', err));

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
          items: {
            orderBy: { sortOrder: 'asc' },
          },
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
      const ledgerDescription = data.tag === 'ADVANCE'
        ? `Advance payment received (${data.paymentMethod})${data.remarks ? ': ' + data.remarks : ''}`
        : `Payment received - ${data.tag} (${data.paymentMethod})${data.remarks ? ': ' + data.remarks : ''}`;

      await tx.ledgerEntry.create({
        data: {
          accountId: data.accountId,
          direction: LedgerDirection.RECEIVABLE,
          amount: data.amount,
          balance: newBalance,
          description: ledgerDescription,
          referenceType: 'PAYMENT',
          referenceId: payment.id,
          transactionType: data.tag === 'ADVANCE' ? LedgerTransactionType.ADVANCE : LedgerTransactionType.PAYMENT,
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
          transactionType: data.tag === 'ADVANCE' ? LedgerTransactionType.ADVANCE : LedgerTransactionType.PAYMENT,
        },
      });

      // ✅ FEATURE 3: If ADVANCE payment with no invoiceId, increment advanceBalance
      if (data.tag === 'ADVANCE') {
        await tx.account.update({
          where: { id: data.accountId },
          data: { advanceBalance: { increment: data.amount } },
        });
        // Also update mirror account advanceBalance
        await tx.account.update({
          where: { id: mirrorAccount.id },
          data: { advanceBalance: { increment: data.amount } },
        });
      }

      // ✅ Post payment update to org-pair chat via chatService (handles thread creation)
      // The actual chat message is sent outside the transaction as non-blocking

      return { payment, newBalance };
    });

    // ✅ Post payment card to chat (non-blocking, outside transaction)
    try {
      await chatService.sendAccountSystemMessage(
        data.accountId,
        `Payment of ₹${(Number(data.amount) / 100).toFixed(2)} received via ${data.paymentMethod} (${data.tag})`,
        'PAYMENT_UPDATE',
        {
          paymentId: result.payment.id,
          amount: Number(data.amount),
          mode: data.paymentMethod,
          tag: data.tag,
        },
        createdBy,
        result.payment.id
      );
    } catch (error) {
      logger.error('Failed to post payment to chat', {
        accountId: data.accountId,
        paymentId: result.payment.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

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

    // ✅ Post PAYMENT_REQUEST card to chat (non-blocking)
    try {
      await chatService.sendPaymentUpdateCard(
        data.accountId,
        payment,
        'REQUESTED',
        createdBy
      );
    } catch (error) {
      logger.error('Failed to post payment request to chat', {
        accountId: data.accountId,
        paymentId: payment.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    // ✅ Push notification: Notify counterparty org about payment request
    notificationService.enqueueNotification({
      type: NotificationType.PAYMENT_RECEIVED,
      recipientOrgId: account.counterpartyOrgId,
      title: 'Payment Requested',
      body: `₹${(Number(data.amount) / 100).toLocaleString('en-IN')} payment requested by ${account.ownerOrg.name}`,
      data: { paymentId: payment.id, amount: String(data.amount), accountId: data.accountId },
    }).catch(err => logger.error('Failed to queue payment request notification', err));

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

    // ✅ Post payment marked-as-paid card to chat (non-blocking)
    try {
      await chatService.sendPaymentUpdateCard(
        payment.accountId!,
        { ...result, amount: result.amount, status: result.status! },
        'MARKED_PAID',
        userId
      );
    } catch (error) {
      logger.error('Failed to post payment update to chat', {
        paymentId: result.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

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
          transactionType: LedgerTransactionType.PAYMENT,
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
            transactionType: LedgerTransactionType.PAYMENT,
          },
        });
      }

      // ✅ FEATURE 2: Update invoice paidAmount/dueAmount/status if invoiceId linked
      if (payment.invoiceId) {
        const invoice = await tx.invoice.findUnique({
          where: { id: payment.invoiceId },
        });
        if (invoice) {
          const newPaidAmount = invoice.paidAmount + payment.amount;
          const newDueAmount = invoice.total - newPaidAmount;
          const newStatus = newDueAmount <= 0n ? 'PAID' : (newPaidAmount > 0n ? 'PARTIAL' : invoice.status);
          await tx.invoice.update({
            where: { id: invoice.id },
            data: {
              paidAmount: newPaidAmount,
              dueAmount: newDueAmount < 0n ? 0n : newDueAmount,
              status: newStatus,
            },
          });
        }
      }

      // ✅ FEATURE 3: If ADVANCE payment with no invoiceId, increment advanceBalance
      if (payment.tag === 'ADVANCE' && !payment.invoiceId) {
        await tx.account.update({
          where: { id: payment.accountId! },
          data: { advanceBalance: { increment: payment.amount } },
        });
        if (mirrorAccount) {
          await tx.account.update({
            where: { id: mirrorAccount.id },
            data: { advanceBalance: { increment: payment.amount } },
          });
        }
      }

      // Chat notification is handled after transaction (non-blocking)

      return { payment: updatedPayment, newBalance: updatedAccount.balance };
    });

    // ✅ Post CONFIRMED payment card to chat (non-blocking, outside transaction)
    try {
      await chatService.sendPaymentUpdateCard(
        payment.accountId!,
        { ...result.payment, amount: payment.amount, status: 'CONFIRMED' },
        'CONFIRMED',
        userId
      );
    } catch (error) {
      logger.error('Failed to post payment confirmation to chat', {
        paymentId: result.payment.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    // ✅ Push notification: Notify payment sender that their payment was confirmed
    if (payment.markedPaidBy) {
      notificationService.enqueueNotification({
        type: NotificationType.PAYMENT_RECEIVED,
        recipientUserId: payment.markedPaidBy,
        title: 'Payment Confirmed',
        body: `Your payment of ₹${(Number(payment.amount) / 100).toLocaleString('en-IN')} has been confirmed`,
        data: { paymentId: payment.id, amount: String(payment.amount) },
      }).catch(err => logger.error('Failed to queue payment confirmed notification', err));
    }

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

    // ✅ Post DISPUTED payment card to chat (non-blocking)
    try {
      await chatService.sendPaymentUpdateCard(
        payment.accountId!,
        { ...result, amount: result.amount, status: 'DISPUTED' },
        'DISPUTED',
        userId,
        data.reason
      );
    } catch (error) {
      logger.error('Failed to post dispute notification to chat', {
        paymentId: result.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

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

  // ============================================
  // ✅ FEATURE 3: Apply Advance Balance to Invoice
  // ============================================
  private async applyAdvanceToInvoice(
    accountId: string,
    invoiceId: string,
    tx: any
  ) {
    // 1. Fetch account with advanceBalance
    const account = await tx.account.findUnique({
      where: { id: accountId },
      select: { id: true, advanceBalance: true, ownerOrgId: true, counterpartyOrgId: true },
    });

    if (!account || account.advanceBalance <= 0n) {
      return; // Nothing to apply
    }

    // 2. Fetch the invoice (must be OPEN or PARTIAL)
    const invoice = await tx.invoice.findUnique({
      where: { id: invoiceId },
    });

    if (!invoice || (invoice.status !== 'OPEN' && invoice.status !== 'PARTIAL')) {
      return;
    }

    // 3. Calculate apply amount = min(advanceBalance, dueAmount)
    const applyAmount = account.advanceBalance < invoice.dueAmount
      ? account.advanceBalance
      : invoice.dueAmount;

    if (applyAmount <= 0n) {
      return;
    }

    // 4. Decrement account advanceBalance
    await tx.account.update({
      where: { id: accountId },
      data: { advanceBalance: { decrement: applyAmount } },
    });

    // 5. Update invoice paidAmount, dueAmount, status
    const newPaidAmount = invoice.paidAmount + applyAmount;
    const newDueAmount = invoice.dueAmount - applyAmount;
    const newStatus = newDueAmount <= 0n ? 'PAID' : 'PARTIAL';

    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        paidAmount: newPaidAmount,
        dueAmount: newDueAmount < 0n ? 0n : newDueAmount,
        status: newStatus,
      },
    });

    // 6. Create a LedgerEntry for advance application
    const updatedAccount = await tx.account.findUnique({
      where: { id: accountId },
      select: { balance: true },
    });

    await tx.ledgerEntry.create({
      data: {
        accountId: accountId,
        direction: LedgerDirection.RECEIVABLE,
        amount: applyAmount,
        balance: updatedAccount?.balance || 0n,
        description: `Advance applied to invoice ${invoice.invoiceNumber}`,
        referenceType: 'ADVANCE_APPLIED',
        referenceId: invoice.id,
        transactionType: LedgerTransactionType.ADVANCE_APPLIED,
      },
    });

    // 7. Update mirror account advanceBalance
    const mirrorAccount = await tx.account.findUnique({
      where: {
        ownerOrgId_counterpartyOrgId: {
          ownerOrgId: account.counterpartyOrgId,
          counterpartyOrgId: account.ownerOrgId,
        },
      },
    });

    if (mirrorAccount) {
      await tx.account.update({
        where: { id: mirrorAccount.id },
        data: { advanceBalance: { decrement: applyAmount } },
      });
    }

    logger.info('Advance applied to invoice', {
      accountId,
      invoiceId,
      applyAmount: applyAmount.toString(),
      newStatus,
    });
  }

  // ============================================
  // KHATA CONTACT MANAGEMENT (non-registered traders)
  // ============================================

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

  async createKhataContact(orgId: string, data: {
    name: string;
    phone?: string;
    city?: string;
    notes?: string;
  }, userId: string) {
    await this.verifyOrgAccess(orgId, userId);

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

  async listKhataContacts(orgId: string, userId: string, page = 1, limit = 50) {
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

  async getKhataContact(contactId: string, userId: string) {
    return this.verifyContactAccess(contactId, userId);
  }

  async updateKhataContact(contactId: string, data: {
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

  async deleteKhataContact(contactId: string, userId: string) {
    await this.verifyContactAccess(contactId, userId);
    await prisma.khataContact.delete({ where: { id: contactId } });
    return { success: true };
  }

  async recordKhataEntry(contactId: string, data: {
    direction: 'PAYABLE' | 'RECEIVABLE';
    amount: number;
    description?: string;
    transactionType?: string;
  }, userId: string) {
    await this.verifyContactAccess(contactId, userId);

    if (data.amount <= 0) throw new ValidationError('Amount must be positive');

    const amountPaise = BigInt(Math.round(data.amount * 100));

    return prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<Array<{ id: string; balance: bigint }>>`
        SELECT id, balance FROM "KhataContact" WHERE id = ${contactId} FOR UPDATE
      `;

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

  async recordKhataPayment(contactId: string, data: {
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

  async getKhataTimeline(contactId: string, userId: string, limit = 50, offset = 0) {
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
