import Razorpay from 'razorpay';
import crypto from 'crypto';
import prisma from '../config/database';
import { config } from '../config/env';
import { NotFoundError, ForbiddenError, ValidationError } from '../utils/errors';
import { LedgerDirection, DriverPaymentStatus, LedgerTransactionType } from '@prisma/client';
import { ChatService } from '../chat/chat.service';
import { logger } from '../utils/logger';
import {
    CreateOrderForPaymentDto,
    CreateOrderForTripDto,
    CreateOrderForDriverPaymentDto,
    VerifyPaymentDto,
} from './razorpay.dto';

const chatService = new ChatService();

// ============================================
// RAZORPAY INSTANCE (lazy init — only when keys configured)
// ============================================
let razorpayInstance: Razorpay | null = null;

function getRazorpay(): Razorpay {
    if (!config.razorpay.keyId || !config.razorpay.keySecret) {
        throw new ValidationError('Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to .env');
    }
    if (!razorpayInstance) {
        razorpayInstance = new Razorpay({
            key_id: config.razorpay.keyId,
            key_secret: config.razorpay.keySecret,
        });
    }
    return razorpayInstance;
}

// ============================================
// Helper: Convert paise (BigInt) to rupees (number) for Razorpay
// Razorpay amounts are in paise (integer) — same as our DB storage
// ============================================
function bigIntToPaise(amount: bigint): number {
    return Number(amount);
}

export class RazorpayService {

    // ════════════════════════════════════════════
    // 1. CREATE ORDER — For existing Payment (payment request flow)
    // ════════════════════════════════════════════
    async createOrderForPayment(data: CreateOrderForPaymentDto, userId: string) {
        const payment = await prisma.payment.findUnique({
            where: { id: data.paymentId },
            include: {
                account: {
                    include: {
                        ownerOrg: { select: { id: true, name: true } },
                        counterpartyOrg: { select: { id: true, name: true } },
                    },
                },
            },
        });

        if (!payment) throw new NotFoundError('Payment not found');
        if (!payment.account) throw new ValidationError('Payment has no associated account');

        // Only PENDING or MARKED_AS_PAID payments can get Razorpay orders
        if (!['PENDING', 'MARKED_AS_PAID'].includes(payment.status)) {
            throw new ValidationError(`Cannot create order for payment with status: ${payment.status}`);
        }

        // If order already exists, return it (idempotent)
        if (payment.razorpayOrderId) {
            return {
                orderId: payment.razorpayOrderId,
                amount: bigIntToPaise(payment.amount),
                currency: 'INR',
                keyId: config.razorpay.keyId,
                paymentId: payment.id,
            };
        }

        // Verify user is the debtor (counterparty org — the one who owes money)
        const isDebtor = await prisma.orgMember.findFirst({
            where: {
                userId,
                orgId: payment.account.counterpartyOrgId,
            },
        });

        if (!isDebtor) {
            throw new ForbiddenError('Only the debtor (payer) can initiate Razorpay payment');
        }

        // Create Razorpay order
        const razorpay = getRazorpay();
        const order = await razorpay.orders.create({
            amount: bigIntToPaise(payment.amount), // Already in paise
            currency: 'INR',
            receipt: `pay_${payment.id}`,
            notes: {
                paymentId: payment.id,
                accountId: payment.accountId || '',
                type: 'LEDGER_PAYMENT',
                payer: payment.account.counterpartyOrg.name,
                payee: payment.account.ownerOrg.name,
            },
        });

        // Store order ID
        await prisma.payment.update({
            where: { id: payment.id },
            data: { razorpayOrderId: order.id },
        });

        return {
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
            keyId: config.razorpay.keyId,
            paymentId: payment.id,
            description: `Payment to ${payment.account.ownerOrg.name}`,
            prefill: {}, // Frontend fills customer name/phone/email
        };
    }

    // ════════════════════════════════════════════
    // 2. CREATE ORDER — For trip-level "Pay Now" (creates Payment + Order)
    // ════════════════════════════════════════════
    async createOrderForTrip(data: CreateOrderForTripDto, userId: string) {
        const trip = await prisma.trip.findUnique({
            where: { id: data.tripId },
            include: {
                sourceOrg: { select: { id: true, name: true } },
                destinationOrg: { select: { id: true, name: true } },
            },
        });

        if (!trip) throw new NotFoundError('Trip not found');

        // Verify account belongs to this trip's org pair
        const account = await prisma.account.findUnique({
            where: { id: data.accountId },
        });

        if (!account) throw new NotFoundError('Account not found');

        // Verify user is a member of one of the orgs
        const membership = await prisma.orgMember.findFirst({
            where: {
                userId,
                orgId: { in: [trip.sourceOrgId, trip.destinationOrgId] },
            },
        });

        if (!membership) throw new ForbiddenError('Not authorized for this trip');

        const amountPaise = BigInt(Math.round(data.amount * 100));

        // Create Payment record + Razorpay order together
        const razorpay = getRazorpay();

        const payment = await prisma.payment.create({
            data: {
                accountId: data.accountId,
                tripId: data.tripId,
                amount: amountPaise,
                tag: data.tag,
                mode: 'RAZORPAY',
                remarks: data.remarks,
                status: 'PENDING',
            },
        });

        const order = await razorpay.orders.create({
            amount: Number(amountPaise),
            currency: 'INR',
            receipt: `trip_${data.tripId}_${payment.id}`,
            notes: {
                paymentId: payment.id,
                tripId: data.tripId,
                accountId: data.accountId,
                type: 'TRIP_PAYMENT',
            },
        });

        await prisma.payment.update({
            where: { id: payment.id },
            data: { razorpayOrderId: order.id },
        });

        // Determine payee name
        const payeeOrg = account.ownerOrgId === trip.sourceOrgId
            ? trip.sourceOrg.name
            : trip.destinationOrg.name;

        return {
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
            keyId: config.razorpay.keyId,
            paymentId: payment.id,
            description: `Trip payment to ${payeeOrg}`,
        };
    }

    // ════════════════════════════════════════════
    // 3. CREATE ORDER — For Driver Payment
    // ════════════════════════════════════════════
    async createOrderForDriverPayment(data: CreateOrderForDriverPaymentDto, userId: string) {
        const driverPayment = await prisma.driverPayment.findUnique({
            where: { tripId: data.tripId },
            include: {
                trip: {
                    include: {
                        driver: {
                            include: { user: { select: { name: true, phone: true } } },
                        },
                    },
                },
            },
        });

        if (!driverPayment) throw new NotFoundError('No driver payment configured for this trip');

        if (driverPayment.status === 'PAID') {
            throw new ValidationError('Driver payment is already fully paid');
        }

        // Verify user has access
        const trip = driverPayment.trip;
        const membership = await prisma.orgMember.findFirst({
            where: {
                userId,
                orgId: { in: [trip.sourceOrgId, trip.destinationOrgId] },
            },
        });

        if (!membership) throw new ForbiddenError('Not authorized for this trip');

        // If order already exists and not fully paid, return existing
        if (driverPayment.razorpayOrderId) {
            return {
                orderId: driverPayment.razorpayOrderId,
                amount: bigIntToPaise(driverPayment.totalAmount - driverPayment.paidAmount),
                currency: 'INR',
                keyId: config.razorpay.keyId,
                tripId: data.tripId,
            };
        }

        const remainingAmount = driverPayment.totalAmount - driverPayment.paidAmount;
        const razorpay = getRazorpay();

        const order = await razorpay.orders.create({
            amount: bigIntToPaise(remainingAmount),
            currency: 'INR',
            receipt: `driver_${data.tripId}`,
            notes: {
                tripId: data.tripId,
                driverPaymentId: driverPayment.id,
                type: 'DRIVER_PAYMENT',
                driverName: trip.driver?.user.name || 'Unknown',
            },
        });

        await prisma.driverPayment.update({
            where: { tripId: data.tripId },
            data: { razorpayOrderId: order.id },
        });

        return {
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
            keyId: config.razorpay.keyId,
            tripId: data.tripId,
            description: `Driver payment - ${trip.driver?.user.name || 'Driver'}`,
        };
    }

    // ════════════════════════════════════════════
    // 4. VERIFY PAYMENT — Called by frontend after Razorpay checkout
    // ════════════════════════════════════════════
    async verifyPayment(data: VerifyPaymentDto, userId: string) {
        // Step 1: Verify Razorpay signature
        const expectedSignature = crypto
            .createHmac('sha256', config.razorpay.keySecret)
            .update(`${data.razorpay_order_id}|${data.razorpay_payment_id}`)
            .digest('hex');

        if (expectedSignature !== data.razorpay_signature) {
            logger.warn('Invalid Razorpay signature', { orderId: data.razorpay_order_id });
            throw new ValidationError('Payment verification failed — invalid signature');
        }

        // Step 2: Find which payment this order belongs to
        const payment = await prisma.payment.findUnique({
            where: { razorpayOrderId: data.razorpay_order_id },
            include: {
                account: {
                    include: {
                        ownerOrg: { select: { id: true, name: true } },
                    },
                },
            },
        });

        if (payment) {
            return this.confirmLedgerPayment(payment, data, userId);
        }

        // Check if it's a driver payment
        const driverPayment = await prisma.driverPayment.findUnique({
            where: { razorpayOrderId: data.razorpay_order_id },
        });

        if (driverPayment) {
            return this.confirmDriverPayment(driverPayment, data, userId);
        }

        throw new NotFoundError('No payment found for this Razorpay order');
    }

    // ════════════════════════════════════════════
    // PRIVATE: Confirm Ledger Payment (after verification)
    // ════════════════════════════════════════════
    private async confirmLedgerPayment(
        payment: any,
        data: VerifyPaymentDto,
        userId: string
    ) {
        // Idempotency: already confirmed
        if (payment.status === 'CONFIRMED') {
            return { success: true, message: 'Payment already confirmed', paymentId: payment.id };
        }

        const result = await prisma.$transaction(async (tx) => {
            // Update payment with Razorpay details + confirm
            const updatedPayment = await tx.payment.update({
                where: { id: payment.id },
                data: {
                    razorpayPaymentId: data.razorpay_payment_id,
                    razorpaySignature: data.razorpay_signature,
                    status: 'CONFIRMED',
                    mode: 'RAZORPAY',
                    confirmedAt: new Date(),
                    confirmedBy: userId,
                    paidAt: new Date(),
                    markedPaidAt: new Date(),
                    markedPaidBy: userId,
                },
            });

            // Update ledger balances (same logic as manual confirmPayment)
            if (payment.accountId) {
                // Row lock on account
                const [lockedAccount] = await tx.$queryRaw<Array<{ id: string; balance: bigint }>>`
          SELECT id, balance FROM "Account" WHERE id = ${payment.accountId} FOR UPDATE
        `;

                if (!lockedAccount) throw new Error('Account not found');

                // Decrement owner's balance (payment received)
                const updatedAccount = await tx.account.update({
                    where: { id: payment.accountId },
                    data: { balance: { decrement: payment.amount } },
                    select: { balance: true },
                });

                // Create ledger entry for owner (creditor)
                await tx.ledgerEntry.create({
                    data: {
                        accountId: payment.accountId,
                        direction: LedgerDirection.RECEIVABLE,
                        amount: payment.amount,
                        balance: updatedAccount.balance,
                        description: `Razorpay payment received (${data.razorpay_payment_id})`,
                        referenceType: 'PAYMENT',
                        referenceId: payment.id,
                        transactionType: LedgerTransactionType.PAYMENT,
                    },
                });

                // Update mirror account
                const mirrorAccount = await tx.account.findUnique({
                    where: {
                        ownerOrgId_counterpartyOrgId: {
                            ownerOrgId: payment.account.counterpartyOrgId,
                            counterpartyOrgId: payment.account.ownerOrgId,
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
                            description: `Razorpay payment sent to ${payment.account.ownerOrg.name}`,
                            referenceType: 'PAYMENT',
                            referenceId: payment.id,
                            transactionType: LedgerTransactionType.PAYMENT,
                        },
                    });
                }
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

            return updatedPayment;
        });

        // Post to chat (non-blocking)
        try {
            if (payment.accountId) {
                await chatService.sendPaymentUpdateCard(
                    payment.accountId,
                    { ...result, amount: payment.amount, status: 'CONFIRMED' },
                    'CONFIRMED',
                    userId
                );
            }
        } catch (error) {
            logger.error('Failed to post Razorpay payment confirmation to chat', {
                paymentId: payment.id,
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        }

        return {
            success: true,
            message: 'Payment verified and confirmed',
            paymentId: payment.id,
            razorpayPaymentId: data.razorpay_payment_id,
        };
    }

    // ════════════════════════════════════════════
    // PRIVATE: Confirm Driver Payment (after verification)
    // ════════════════════════════════════════════
    private async confirmDriverPayment(
        driverPayment: any,
        data: VerifyPaymentDto,
        _userId: string
    ) {
        if (driverPayment.status === 'PAID') {
            return { success: true, message: 'Driver payment already completed', tripId: driverPayment.tripId };
        }

        // Fetch order to get exact amount paid
        const razorpay = getRazorpay();
        const rzpPayment = await razorpay.payments.fetch(data.razorpay_payment_id);
        const paidAmountPaise = BigInt(rzpPayment.amount as number);

        const newPaidAmount = driverPayment.paidAmount + paidAmountPaise;
        const totalAmount = driverPayment.totalAmount;

        let status: DriverPaymentStatus;
        if (newPaidAmount >= totalAmount) {
            status = DriverPaymentStatus.PAID;
        } else if (newPaidAmount > 0n) {
            status = DriverPaymentStatus.PARTIALLY_PAID;
        } else {
            status = DriverPaymentStatus.PENDING;
        }

        await prisma.driverPayment.update({
            where: { tripId: driverPayment.tripId },
            data: {
                paidAmount: newPaidAmount,
                status,
                paidAt: status === 'PAID' ? new Date() : null,
                razorpayPaymentId: data.razorpay_payment_id,
                razorpayOrderId: data.razorpay_order_id,
            },
        });

        return {
            success: true,
            message: status === 'PAID' ? 'Driver payment completed' : 'Partial driver payment recorded',
            tripId: driverPayment.tripId,
            status,
        };
    }

    // ════════════════════════════════════════════
    // 5. WEBHOOK — Razorpay server-to-server callback (fallback)
    // ════════════════════════════════════════════
    async handleWebhook(body: any, signature: string) {
        // Verify webhook signature
        if (!config.razorpay.webhookSecret) {
            logger.warn('Razorpay webhook secret not configured - skipping webhook');
            return { status: 'ignored' };
        }

        const expectedSignature = crypto
            .createHmac('sha256', config.razorpay.webhookSecret)
            .update(JSON.stringify(body))
            .digest('hex');

        if (expectedSignature !== signature) {
            logger.warn('Invalid Razorpay webhook signature');
            throw new ValidationError('Invalid webhook signature');
        }

        const event = body.event;
        const payload = body.payload;

        logger.info('Razorpay webhook received', { event });

        if (event === 'payment.captured') {
            const rzpPayment = payload.payment.entity;
            const orderId = rzpPayment.order_id;

            // Find and confirm payment (check both Payment and DriverPayment)
            const payment = await prisma.payment.findUnique({
                where: { razorpayOrderId: orderId },
                include: {
                    account: {
                        include: { ownerOrg: { select: { id: true, name: true } } },
                    },
                },
            });

            if (payment && payment.status !== 'CONFIRMED') {
                logger.info('Webhook: auto-confirming ledger payment', { paymentId: payment.id });
                await this.confirmLedgerPayment(
                    payment,
                    {
                        razorpay_order_id: orderId,
                        razorpay_payment_id: rzpPayment.id,
                        razorpay_signature: signature, // Webhook uses different signature
                    },
                    'system' // webhook has no user context
                );
            }

            const driverPayment = await prisma.driverPayment.findUnique({
                where: { razorpayOrderId: orderId },
            });

            if (driverPayment && driverPayment.status !== 'PAID') {
                logger.info('Webhook: auto-confirming driver payment', { tripId: driverPayment.tripId });
                await this.confirmDriverPayment(
                    driverPayment,
                    {
                        razorpay_order_id: orderId,
                        razorpay_payment_id: rzpPayment.id,
                        razorpay_signature: signature,
                    },
                    'system'
                );
            }
        }

        if (event === 'payment.failed') {
            const rzpPayment = payload.payment.entity;
            const orderId = rzpPayment.order_id;

            logger.warn('Razorpay payment failed', {
                orderId,
                reason: rzpPayment.error_description,
            });
            // Don't update status — user can retry from frontend
        }

        return { status: 'ok' };
    }

    // ════════════════════════════════════════════
    // 6. GET PAYMENT STATUS — Check Razorpay order status
    // ════════════════════════════════════════════
    async getOrderStatus(orderId: string, userId: string) {
        // First find if user has access to this order
        const payment = await prisma.payment.findUnique({
            where: { razorpayOrderId: orderId },
            include: { account: true },
        });

        if (payment && payment.account) {
            const hasAccess = await prisma.orgMember.findFirst({
                where: {
                    userId,
                    orgId: { in: [payment.account.ownerOrgId, payment.account.counterpartyOrgId] },
                },
            });
            if (!hasAccess) throw new ForbiddenError('Not authorized');
        }

        const razorpay = getRazorpay();
        const order = await razorpay.orders.fetch(orderId);

        return {
            orderId: order.id,
            status: order.status, // created, attempted, paid
            amount: order.amount,
            amountPaid: order.amount_paid,
            amountDue: order.amount_due,
            currency: order.currency,
        };
    }
}
