import { Response } from 'express';
import { LedgerService } from './ledger.service';
import {
  createAccountSchema,
  createInvoiceSchema,
  updateInvoiceSchema,
  createPaymentSchema,
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
    const { orgId } = req.query;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        message: 'orgId query parameter is required',
      });
    }

    const accounts = await ledgerService.getAccounts(orgId as string, req.user!.id);

    res.json({
      success: true,
      data: accounts,
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
    const invoices = await ledgerService.getInvoices(accountId, req.user!.id);

    res.json({
      success: true,
      data: invoices,
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
    const payments = await ledgerService.getPayments(accountId, req.user!.id);

    res.json({
      success: true,
      data: payments,
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
}
