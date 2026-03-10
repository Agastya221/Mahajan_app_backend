import { Response, NextFunction } from 'express';
import { LedgerService } from './ledger.service';
import {
  createAccountSchema,
  createInvoiceSchema,
  updateInvoiceSchema,
  createPaymentSchema,
  createPaymentRequestSchema,
  markPaymentPaidSchema,
  confirmPaymentSchema,
  disputePaymentSchema,
  createKhataContactSchema,
  updateKhataContactSchema,
  recordKhataEntrySchema,
  recordKhataPaymentSchema,
} from './ledger.dto';
import { asyncHandler } from '../middleware/error.middleware';
import { AuthRequest } from '../middleware/auth.middleware';

const ledgerService = new LedgerService();

export class LedgerController {
  // Account endpoints
  createAccount = asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = createAccountSchema.parse(req.body);
    const result = await ledgerService.createOrGetAccount(data, req.user!.id);

    res.status(result.isNew ? 201 : 200).json({
      success: true,
      data: result.account,
      message: result.isNew ? 'Account created' : 'Account already exists',
    });
  });

  getAccounts = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { orgId, page, limit } = req.query;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        message: 'orgId query parameter is required',
      });
    }

    const result = await ledgerService.getAccounts(
      orgId as string,
      req.user!.id,
      page ? parseInt(page as string, 10) : undefined,
      limit ? parseInt(limit as string, 10) : undefined,
    );

    res.json({
      success: true,
      data: result.accounts,
      pagination: result.pagination,
    });
  });

  getAccountById = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { accountId } = req.params;
    const account = await ledgerService.getAccountById(accountId, req.user!.id);

    res.json({
      success: true,
      data: account,
    });
  });

  // Invoice endpoints
  createInvoice = asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = createInvoiceSchema.parse(req.body);
    const invoice = await ledgerService.createInvoice(data, req.user!.id);

    res.status(201).json({
      success: true,
      data: invoice,
    });
  });

  getInvoices = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { accountId } = req.params;
    const { page, limit } = req.query;
    const result = await ledgerService.getInvoices(
      accountId,
      req.user!.id,
      page ? parseInt(page as string, 10) : undefined,
      limit ? parseInt(limit as string, 10) : undefined,
    );

    res.json({
      success: true,
      data: result.invoices,
      pagination: result.pagination,
    });
  });

  updateInvoice = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { invoiceId } = req.params;
    const data = updateInvoiceSchema.parse(req.body);
    const invoice = await ledgerService.updateInvoice(invoiceId, data, req.user!.id);

    res.json({
      success: true,
      data: invoice,
    });
  });

  // Payment endpoints
  createPayment = asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = createPaymentSchema.parse(req.body);
    const result = await ledgerService.createPayment(data, req.user!.id);

    res.status(201).json({
      success: true,
      data: result,
    });
  });

  getPayments = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { accountId } = req.params;
    const { page, limit } = req.query;
    const result = await ledgerService.getPayments(
      accountId,
      req.user!.id,
      page ? parseInt(page as string, 10) : undefined,
      limit ? parseInt(limit as string, 10) : undefined,
    );

    res.json({
      success: true,
      data: result.payments,
      pagination: result.pagination,
    });
  });

  // Timeline endpoint
  getLedgerTimeline = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { accountId } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const result = await ledgerService.getLedgerTimeline(accountId, req.user!.id, limit, offset);

    res.json({
      success: true,
      data: result,
    });
  });

  // ============================================
  // TWO-PARTY PAYMENT CONFIRMATION FLOW
  // ============================================

  // Step 1: Receiver creates payment request
  createPaymentRequest = asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = createPaymentRequestSchema.parse(req.body);
    const result = await ledgerService.createPaymentRequest(data, req.user!.id);

    res.status(201).json({
      success: true,
      data: result,
      message: 'Payment request created',
    });
  });

  // Step 2: Sender marks payment as paid
  markPaymentAsPaid = asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = markPaymentPaidSchema.parse(req.body);
    const result = await ledgerService.markPaymentAsPaid(data, req.user!.id);

    res.json({
      success: true,
      data: result,
      message: 'Payment marked as paid',
    });
  });

  // Step 3a: Receiver confirms payment
  confirmPayment = asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = confirmPaymentSchema.parse(req.body);
    const result = await ledgerService.confirmPayment(data, req.user!.id);

    res.json({
      success: true,
      data: result,
      message: 'Payment confirmed',
    });
  });

  // Step 3b: Receiver disputes payment
  disputePayment = asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = disputePaymentSchema.parse(req.body);
    const result = await ledgerService.disputePayment(data, req.user!.id);

    res.json({
      success: true,
      data: result,
      message: 'Payment disputed',
    });
  });

  // Unified PATCH route handler for /payments/:paymentId
  updatePaymentStatus = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { paymentId } = req.params;
    const { status } = req.body;

    // Inject paymentId into body so validation schemas inside individual methods work
    req.body.paymentId = paymentId;

    if (status === 'PAID') {
      return this.markPaymentAsPaid(req, res, next);
    } else if (status === 'CONFIRMED') {
      return this.confirmPayment(req, res, next);
    } else if (status === 'DISPUTED') {
      return this.disputePayment(req, res, next);
    } else {
      res.status(400).json({ success: false, message: 'Invalid status update' });
    }
  });

  // Get pending payments for an account
  getPendingPayments = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { accountId } = req.params;
    const result = await ledgerService.getPendingPayments(accountId, req.user!.id);

    res.json({
      success: true,
      data: result,
    });
  });

  // Get payment by ID
  getPaymentById = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { paymentId } = req.params;
    const result = await ledgerService.getPaymentById(paymentId, req.user!.id);

    res.json({
      success: true,
      data: result,
    });
  });

  // ============================================
  // KHATA CONTACT ENDPOINTS
  // ============================================

  createKhataContact = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { orgId } = req.params;
    const data = createKhataContactSchema.parse(req.body);
    const result = await ledgerService.createKhataContact(orgId, data, req.user!.id);
    res.status(201).json({ success: true, data: result });
  });

  listKhataContacts = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { orgId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const result = await ledgerService.listKhataContacts(orgId, req.user!.id, page, limit);
    res.json({ success: true, data: result.contacts, pagination: result.pagination });
  });

  getKhataContact = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { contactId } = req.params;
    const result = await ledgerService.getKhataContact(contactId, req.user!.id);
    res.json({ success: true, data: result });
  });

  updateKhataContact = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { contactId } = req.params;
    const data = updateKhataContactSchema.parse(req.body);
    const result = await ledgerService.updateKhataContact(contactId, data, req.user!.id);
    res.json({ success: true, data: result });
  });

  deleteKhataContact = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { contactId } = req.params;
    const result = await ledgerService.deleteKhataContact(contactId, req.user!.id);
    res.json({ success: true, data: result });
  });

  recordKhataEntry = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { contactId } = req.params;
    const data = recordKhataEntrySchema.parse(req.body);
    const result = await ledgerService.recordKhataEntry(contactId, data, req.user!.id);
    res.status(201).json({ success: true, data: result });
  });

  recordKhataPayment = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { contactId } = req.params;
    const data = recordKhataPaymentSchema.parse(req.body);
    const result = await ledgerService.recordKhataPayment(contactId, data, req.user!.id);
    res.status(201).json({ success: true, data: result });
  });

  getKhataTimeline = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { contactId } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const result = await ledgerService.getKhataTimeline(contactId, req.user!.id, limit, offset);
    res.json({ success: true, data: result });
  });
}
