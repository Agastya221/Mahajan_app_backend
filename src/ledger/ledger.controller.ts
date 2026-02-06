import { Response } from 'express';
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
}
