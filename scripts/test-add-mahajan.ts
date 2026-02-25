import prisma from '../src/config/database';
import { ChatService } from '../src/chat/chat.service';

const chatService = new ChatService();

async function run() {
    try {
        console.log('--- Testing Start Chat by Phone --');

        // Find an existing Mahajan to be the sender
        const sender = await prisma.user.findFirst({
            where: { memberships: { some: {} } },
            include: { memberships: true }
        });

        if (!sender) {
            console.error('No sender user found in database to test with.');
            return;
        }

        console.log(`Using sender User ID: ${sender.id}, Org ID: ${sender.memberships[0].orgId}`);

        // Random fake phone number that doesn't exist to test invite flow
        // Format: +919999XXXXXX
        const randomSuffix = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
        const testPhone = `+919999${randomSuffix}`;

        console.log(`\nTesting Case C: No Org Exists -> Create placeholder & invite for phone ${testPhone}`);

        const resultNew = await chatService.startChatByPhone(testPhone, sender.id);
        console.log('Result for new phone:', resultNew);

        if (resultNew.inviteRequired && resultNew.thread) {
            console.log('✅ Placeholder Org created successfully.');
            console.log('✅ Invite created successfully.');
            console.log('✅ Chat thread with placeholder created successfully.');
        } else {
            console.error('❌ Failed to create invite/placeholder correctly.');
        }

        console.log(`\nTesting Case B: Placeholder Org Exists (using the same phone ${testPhone})`);
        const resultExisting = await chatService.startChatByPhone(testPhone, sender.id);
        console.log('Result for existing phone:', resultExisting);

        if (!resultExisting.inviteRequired && resultExisting.thread) {
            console.log('✅ Found existing placeholder successfully.');
            console.log('✅ No duplicate invite required flag passed.');
        } else {
            console.error('❌ Failed to find existing placeholder or incorrect flags.');
        }

        // Check if the placeholder org exists and has 0 members
        const placeholderOrg = await prisma.org.findFirst({
            where: { phone: testPhone },
            include: { members: true }
        });

        if (placeholderOrg && placeholderOrg.members.length === 0) {
            console.log('✅ Placeholder org successfully persists and has 0 members.');
        } else {
            console.error('❌ Placeholder org state is incorrect.');
        }

        // Now test if auto-connect logic triggers on fake registration
        // We can simulate an org creation just passing the phone
        console.log(`\nTesting Auto-Connect: Simulating user registration for ${testPhone}`);

        // We will bypass the Auth service and directly hit OrgService
        const { OrgService } = await import('../src/org/org.service');
        const orgService = new OrgService();

        // Fake user creation
        const fakeUser = await prisma.user.create({
            data: {
                name: 'New Registered User',
                phone: testPhone,
                role: 'MAHAJAN'
            }
        });

        // Create the real org
        const newOrgData = {
            name: 'Real Mahajan Org',
            city: 'Delhi',
            phone: testPhone,
            gstin: null,
            roleType: 'BOTH' as any
        };

        const newOrg = await orgService.createOrg(newOrgData as any, fakeUser.id);
        console.log(`✅ Created Real Org: ${newOrg.id}`);

        // Check if threads transferred from placeholder org to new real org
        // Thread should now be between sender.orgId and newOrg.id
        const transferredThread = await prisma.chatThread.findFirst({
            where: {
                OR: [
                    { orgId: sender.memberships[0].orgId, counterpartyOrgId: newOrg.id },
                    { counterpartyOrgId: sender.memberships[0].orgId, orgId: newOrg.id }
                ]
            }
        });

        if (transferredThread) {
            console.log('✅ Success: Chat thread successfully transferred to real org!');
        } else {
            console.error('❌ Failed: Chat thread was NOT transferred to real org.');
        }

        // Check invite status
        const invite = await prisma.mahajanInvite.findFirst({
            where: { invitedPhone: testPhone }
        });

        if (invite && invite.status === 'ACCEPTED' && invite.inviteeOrgId === newOrg.id) {
            console.log('✅ Success: Mahajan invite correctly marked as ACCEPTED and linked to real org.');
        } else {
            console.error('❌ Failed: Mahajan invite was NOT marked as ACCEPTED or correctly linked.');
        }

        // Check placeholder org is deleted
        const deletedPlaceholder = await prisma.org.findUnique({
            where: { id: placeholderOrg!.id }
        });

        if (!deletedPlaceholder) {
            console.log('✅ Success: Placeholder org was safely deleted.');
        } else {
            console.error('❌ Failed: Placeholder org was NOT deleted.');
        }

    } catch (error) {
        console.error('Test Failed Exception:', error);
    } finally {
        await prisma.$disconnect();
        process.exit(0);
    }
}

run();
