import { Router } from 'express';
import { LedgerController } from './ledger.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();
const ledgerController = new LedgerController();

/**
 * @route   POST /api/v1/ledger/accounts
 * @desc    Create or get account between two organizations
 * @access  Private
 */
router.post('/accounts', authenticate, ledgerController.createAccount);

/**
 * @route   GET /api/v1/ledger/accounts?orgId=xxx
 * @desc    Get all accounts for an organization
 * @access  Private
 */
router.get('/accounts', authenticate, ledgerController.getAccounts);

/**
 * @route   GET /api/v1/ledger/accounts/:accountId
 * @desc    Get account details by ID
 * @access  Private
 */
router.get('/accounts/:accountId', authenticate, ledgerController.getAccountById);

/**
 * @route   GET /api/v1/ledger/accounts/:accountId/timeline
 * @desc    Get ledger timeline for account
 * @access  Private
 */
router.get('/accounts/:accountId/timeline', authenticate, ledgerController.getLedgerTimeline);

/**
 * @route   POST /api/v1/ledger/invoices
 * @desc    Create invoice
 * @access  Private
 */
router.post('/invoices', authenticate, ledgerController.createInvoice);

/**
 * @route   GET /api/v1/ledger/accounts/:accountId/invoices
 * @desc    Get all invoices for account
 * @access  Private
 */
router.get('/accounts/:accountId/invoices', authenticate, ledgerController.getInvoices);

/**
 * @route   PATCH /api/v1/ledger/invoices/:invoiceId
 * @desc    Update invoice
 * @access  Private
 */
router.patch('/invoices/:invoiceId', authenticate, ledgerController.updateInvoice);

/**
 * @route   POST /api/v1/ledger/payments
 * @desc    Record payment
 * @access  Private
 */
router.post('/payments', authenticate, ledgerController.createPayment);

/**
 * @route   GET /api/v1/ledger/accounts/:accountId/payments
 * @desc    Get all payments for account
 * @access  Private
 */
router.get('/accounts/:accountId/payments', authenticate, ledgerController.getPayments);

export default router;
