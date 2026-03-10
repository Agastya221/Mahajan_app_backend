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
 * @desc    Record payment (legacy/direct)
 * @access  Private
 */
router.post('/payments', authenticate, ledgerController.createPayment);

/**
 * @route   GET /api/v1/ledger/accounts/:accountId/payments
 * @desc    Get all payments for account
 * @access  Private
 */
router.get('/accounts/:accountId/payments', authenticate, ledgerController.getPayments);

// ============================================
// TWO-PARTY PAYMENT CONFIRMATION FLOW
// ============================================

/**
 * @route   POST /api/v1/ledger/payments/request
 * @desc    Create payment request (receiver creates)
 * @access  Private
 */
router.post('/payments/request', authenticate, ledgerController.createPaymentRequest);

/**
 * @route   PATCH /api/v1/ledger/payments/:paymentId
 * @desc    Update payment status (mark-paid, confirm, dispute)
 * @access  Private
 * @body    { status: 'PAID' | 'CONFIRMED' | 'DISPUTED' }
 */
router.patch('/payments/:paymentId', authenticate, ledgerController.updatePaymentStatus);

/**
 * @route   GET /api/v1/ledger/accounts/:accountId/pending-payments
 * @desc    Get pending payments for account
 * @access  Private
 */
router.get('/accounts/:accountId/pending-payments', authenticate, ledgerController.getPendingPayments);

/**
 * @route   GET /api/v1/ledger/payments/:paymentId
 * @desc    Get payment by ID
 * @access  Private
 */
router.get('/payments/:paymentId', authenticate, ledgerController.getPaymentById);

// ============================================
// KHATA CONTACTS (non-registered traders)
// ============================================

/**
 * @route   POST /api/v1/ledger/orgs/:orgId/contacts
 * @desc    Create khata contact for an org
 * @access  Private
 */
router.post('/orgs/:orgId/contacts', authenticate, ledgerController.createKhataContact);

/**
 * @route   GET /api/v1/ledger/orgs/:orgId/contacts
 * @desc    List khata contacts for an org
 * @access  Private
 */
router.get('/orgs/:orgId/contacts', authenticate, ledgerController.listKhataContacts);

/**
 * @route   GET /api/v1/ledger/contacts/:contactId
 * @desc    Get khata contact details
 * @access  Private
 */
router.get('/contacts/:contactId', authenticate, ledgerController.getKhataContact);

/**
 * @route   PATCH /api/v1/ledger/contacts/:contactId
 * @desc    Update khata contact
 * @access  Private
 */
router.patch('/contacts/:contactId', authenticate, ledgerController.updateKhataContact);

/**
 * @route   DELETE /api/v1/ledger/contacts/:contactId
 * @desc    Delete khata contact
 * @access  Private
 */
router.delete('/contacts/:contactId', authenticate, ledgerController.deleteKhataContact);

/**
 * @route   POST /api/v1/ledger/contacts/:contactId/entries
 * @desc    Record sale/adjustment entry for khata contact
 * @access  Private
 */
router.post('/contacts/:contactId/entries', authenticate, ledgerController.recordKhataEntry);

/**
 * @route   POST /api/v1/ledger/contacts/:contactId/payments
 * @desc    Record payment from khata contact
 * @access  Private
 */
router.post('/contacts/:contactId/payments', authenticate, ledgerController.recordKhataPayment);

/**
 * @route   GET /api/v1/ledger/contacts/:contactId/timeline
 * @desc    Get khata contact timeline
 * @access  Private
 */
router.get('/contacts/:contactId/timeline', authenticate, ledgerController.getKhataTimeline);

export default router;
