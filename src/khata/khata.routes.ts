import { Router } from 'express';
import { KhataController } from './khata.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();
const controller = new KhataController();

// Contacts under an org
router.post('/orgs/:orgId/khata/contacts', authenticate, controller.createContact);
router.get('/orgs/:orgId/khata/contacts', authenticate, controller.listContacts);

// Individual contact
router.get('/khata/contacts/:contactId', authenticate, controller.getContact);
router.patch('/khata/contacts/:contactId', authenticate, controller.updateContact);
router.delete('/khata/contacts/:contactId', authenticate, controller.deleteContact);

// Entries and payments
router.post('/khata/contacts/:contactId/entries', authenticate, controller.recordEntry);
router.post('/khata/contacts/:contactId/payments', authenticate, controller.recordPayment);
router.get('/khata/contacts/:contactId/timeline', authenticate, controller.getTimeline);

export default router;
