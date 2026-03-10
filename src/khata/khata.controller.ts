import { Response } from 'express';
import { KhataService } from './khata.service';
import {
    createKhataContactSchema,
    updateKhataContactSchema,
    recordKhataEntrySchema,
    recordKhataPaymentSchema,
} from './khata.dto';
import { asyncHandler } from '../middleware/error.middleware';
import { AuthRequest } from '../middleware/auth.middleware';

const khataService = new KhataService();

export class KhataController {

    createContact = asyncHandler(async (req: AuthRequest, res: Response) => {
        const { orgId } = req.params;
        const data = createKhataContactSchema.parse(req.body);
        const result = await khataService.createContact(orgId, data, req.user!.id);
        res.status(201).json({ success: true, data: result });
    });

    listContacts = asyncHandler(async (req: AuthRequest, res: Response) => {
        const { orgId } = req.params;
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 50;
        const result = await khataService.listContacts(orgId, req.user!.id, page, limit);
        res.json({ success: true, data: result.contacts, pagination: result.pagination });
    });

    getContact = asyncHandler(async (req: AuthRequest, res: Response) => {
        const { contactId } = req.params;
        const result = await khataService.getContact(contactId, req.user!.id);
        res.json({ success: true, data: result });
    });

    updateContact = asyncHandler(async (req: AuthRequest, res: Response) => {
        const { contactId } = req.params;
        const data = updateKhataContactSchema.parse(req.body);
        const result = await khataService.updateContact(contactId, data, req.user!.id);
        res.json({ success: true, data: result });
    });

    deleteContact = asyncHandler(async (req: AuthRequest, res: Response) => {
        const { contactId } = req.params;
        const result = await khataService.deleteContact(contactId, req.user!.id);
        res.json({ success: true, data: result });
    });

    recordEntry = asyncHandler(async (req: AuthRequest, res: Response) => {
        const { contactId } = req.params;
        const data = recordKhataEntrySchema.parse(req.body);
        const result = await khataService.recordEntry(contactId, data, req.user!.id);
        res.status(201).json({ success: true, data: result });
    });

    recordPayment = asyncHandler(async (req: AuthRequest, res: Response) => {
        const { contactId } = req.params;
        const data = recordKhataPaymentSchema.parse(req.body);
        const result = await khataService.recordPayment(contactId, data, req.user!.id);
        res.status(201).json({ success: true, data: result });
    });

    getTimeline = asyncHandler(async (req: AuthRequest, res: Response) => {
        const { contactId } = req.params;
        const limit = parseInt(req.query.limit as string) || 50;
        const offset = parseInt(req.query.offset as string) || 0;
        const result = await khataService.getTimeline(contactId, req.user!.id, limit, offset);
        res.json({ success: true, data: result });
    });
}
