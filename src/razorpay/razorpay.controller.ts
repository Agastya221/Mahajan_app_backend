import { Response, Request } from 'express';
import { RazorpayService } from './razorpay.service';
import { AuthRequest } from '../middleware/auth.middleware';
import { asyncHandler } from '../middleware/error.middleware';
import {
    createOrderForPaymentSchema,
    createOrderForTripSchema,
    createOrderForDriverPaymentSchema,
    verifyPaymentSchema,
} from './razorpay.dto';

const razorpayService = new RazorpayService();

export class RazorpayController {

    // POST /api/v1/razorpay/create-order/payment
    createOrderForPayment = asyncHandler(async (req: AuthRequest, res: Response) => {
        const data = createOrderForPaymentSchema.parse(req.body);
        const result = await razorpayService.createOrderForPayment(data, req.user!.id);
        res.json({ success: true, data: result });
    });

    // POST /api/v1/razorpay/create-order/trip
    createOrderForTrip = asyncHandler(async (req: AuthRequest, res: Response) => {
        const data = createOrderForTripSchema.parse(req.body);
        const result = await razorpayService.createOrderForTrip(data, req.user!.id);
        res.json({ success: true, data: result });
    });

    // POST /api/v1/razorpay/create-order/driver
    createOrderForDriverPayment = asyncHandler(async (req: AuthRequest, res: Response) => {
        const data = createOrderForDriverPaymentSchema.parse(req.body);
        const result = await razorpayService.createOrderForDriverPayment(data, req.user!.id);
        res.json({ success: true, data: result });
    });

    // POST /api/v1/razorpay/verify
    verifyPayment = asyncHandler(async (req: AuthRequest, res: Response) => {
        const data = verifyPaymentSchema.parse(req.body);
        const result = await razorpayService.verifyPayment(data, req.user!.id);
        res.json({ success: true, data: result });
    });

    // POST /api/v1/razorpay/webhook (no auth — Razorpay calls this directly)
    handleWebhook = asyncHandler(async (req: Request, res: Response) => {
        const signature = req.headers['x-razorpay-signature'] as string;
        if (!signature) {
            res.status(400).json({ success: false, message: 'Missing signature header' });
            return;
        }
        const result = await razorpayService.handleWebhook(req.body, signature);
        res.json({ success: true, data: result });
    });

    // GET /api/v1/razorpay/order/:orderId/status
    getOrderStatus = asyncHandler(async (req: AuthRequest, res: Response) => {
        const result = await razorpayService.getOrderStatus(req.params.orderId, req.user!.id);
        res.json({ success: true, data: result });
    });
}
