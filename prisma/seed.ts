import 'dotenv/config';
import { UserRole, TripStatus, QuantityUnit, MahajanRoleType, ChatMessageType, TripEventType } from '@prisma/client';
import prisma from '../src/config/database';

// ── Helpers ──
function hrs(h: number) { return new Date(Date.now() - h * 3600_000); }
function days(d: number) { return new Date(Date.now() - d * 86400_000); }
function normOrgPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

async function main() {
  console.log('🌱 Seeding production-quality data...\n');

  // ════════════════════════════════════════════
  // 1. USERS (login info preserved for Agastya & Javed)
  // ════════════════════════════════════════════
  const agastya = await prisma.user.upsert({
    where: { phone: '+916202923165' },
    update: { name: 'Agastya Mahajan' },
    create: { phone: '+916202923165', name: 'Agastya Mahajan', role: UserRole.MAHAJAN, status: 'ACTIVE' },
  });

  const javed = await prisma.user.upsert({
    where: { phone: '+919006412619' },
    update: { name: 'Javed Shaikh' },
    create: { phone: '+919006412619', name: 'Javed Shaikh', role: UserRole.MAHAJAN, status: 'ACTIVE' },
  });

  const ramesh = await prisma.user.upsert({
    where: { phone: '+919823456789' },
    update: {},
    create: { phone: '+919823456789', name: 'Ramesh Patil', role: UserRole.MAHAJAN, status: 'ACTIVE' },
  });

  const driverRamu = await prisma.user.upsert({
    where: { phone: '+919876543213' },
    update: { name: 'Ramu Yadav' },
    create: { phone: '+919876543213', name: 'Ramu Yadav', role: UserRole.DRIVER, status: 'ACTIVE' },
  });

  const driverSuresh = await prisma.user.upsert({
    where: { phone: '+919876543214' },
    update: { name: 'Suresh Gaikwad' },
    create: { phone: '+919876543214', name: 'Suresh Gaikwad', role: UserRole.DRIVER, status: 'ACTIVE' },
  });

  const driverPrakash = await prisma.user.upsert({
    where: { phone: '+919834567890' },
    update: {},
    create: { phone: '+919834567890', name: 'Prakash Bhosle', role: UserRole.DRIVER, status: 'ACTIVE' },
  });

  console.log('✅ Users created');

  // ── Flipkart / Swiggy style structured addresses ──
  const nashikAddress: any = {
    label: 'Nashik Mandi',
    line1: 'Shop No. 45, Pimpalgaon Baswant APMC',
    line2: 'Fruit Market Yard',
    city: 'Nashik',
    state: 'Maharashtra',
    pincode: '422209',
    landmark: 'Near Main Gate',
    contactName: 'Agastya Mahajan',
    contactPhone: '+916202923165',
  };

  const mumbaiAddress: any = {
    label: 'Vashi Market',
    line1: 'Gala No. 112, Sector 19',
    line2: 'APMC Market Phase 2',
    city: 'Navi Mumbai',
    state: 'Maharashtra',
    pincode: '400703',
    landmark: 'Opposite Onion Shed',
    contactName: 'Javed Shaikh',
    contactPhone: '+919006412619',
  };

  const puneAddress: any = {
    label: 'Pune Market Yard',
    line1: 'Market Yard, Gultekdi',
    line2: 'Gate No. 4',
    city: 'Pune',
    state: 'Maharashtra',
    pincode: '411037',
    landmark: 'Next to Weighing Bridge',
    contactName: 'Ramesh Patil',
    contactPhone: '+919823456789',
  };

  // ════════════════════════════════════════════
  // 2. ORGANIZATIONS (Real Indian mandi businesses)
  // ════════════════════════════════════════════
  const nashikOrg = await prisma.org.upsert({
    where: { gstin: '27AABCU9603R1ZM' },
    update: { name: 'Mahajan Fruits & Vegetables, Nashik', address: nashikAddress },
    create: {
      name: 'Mahajan Fruits & Vegetables, Nashik',
      city: 'Nashik', phone: '+916202923165',
      address: nashikAddress,
      gstin: '27AABCU9603R1ZM', roleType: MahajanRoleType.SOURCE_COLLECTOR,
    },
  });

  const mumbaiOrg = await prisma.org.upsert({
    where: { gstin: '27AABCU9603R2ZN' },
    update: { name: 'Shaikh Trading Co., Vashi', address: mumbaiAddress },
    create: {
      name: 'Shaikh Trading Co., Vashi',
      city: 'Navi Mumbai', phone: '+919006412619',
      address: mumbaiAddress,
      gstin: '27AABCU9603R2ZN', roleType: MahajanRoleType.DESTINATION_DISTRIBUTOR,
    },
  });

  const puneOrg = await prisma.org.upsert({
    where: { gstin: '27AABCU9603R3ZO' },
    update: { name: 'Patil Agro Traders, Pune', address: puneAddress },
    create: {
      name: 'Patil Agro Traders, Pune',
      city: 'Pune', phone: '+919823456789',
      address: puneAddress,
      gstin: '27AABCU9603R3ZO', roleType: MahajanRoleType.BOTH,
    },
  });

  console.log('✅ Organizations created');

  // ── Org Memberships ──
  for (const [orgId, userId] of [[nashikOrg.id, agastya.id], [mumbaiOrg.id, javed.id], [puneOrg.id, ramesh.id]] as const) {
    await prisma.orgMember.upsert({
      where: { orgId_userId: { orgId, userId } },
      update: {}, create: { orgId, userId },
    });
  }

  // ════════════════════════════════════════════
  // 3. DRIVERS & TRUCKS
  // ════════════════════════════════════════════
  let dp1 = await prisma.driverProfile.findUnique({ where: { userId: driverRamu.id } });
  if (!dp1) dp1 = await prisma.driverProfile.create({ data: { userId: driverRamu.id, licenseNo: 'MH15/2019/0045623', emergencyPhone: '+919800112233', notes: '8 years experience, Nashik-Mumbai route specialist' } });

  let dp2 = await prisma.driverProfile.findUnique({ where: { userId: driverSuresh.id } });
  if (!dp2) dp2 = await prisma.driverProfile.create({ data: { userId: driverSuresh.id, licenseNo: 'MH14/2021/0078901', emergencyPhone: '+919800445566', notes: '3 years experience' } });

  let dp3 = await prisma.driverProfile.findUnique({ where: { userId: driverPrakash.id } });
  if (!dp3) dp3 = await prisma.driverProfile.create({ data: { userId: driverPrakash.id, licenseNo: 'MH12/2020/0034567', emergencyPhone: '+919800778899', notes: 'Pune-Mumbai specialist' } });

  let truck1 = await prisma.truck.findFirst({ where: { number: 'MH15 BT 4523' } });
  if (!truck1) truck1 = await prisma.truck.create({ data: { orgId: nashikOrg.id, number: 'MH15 BT 4523', type: 'EICHER_14FT', capacity: 4000 } });

  let truck2 = await prisma.truck.findFirst({ where: { number: 'MH14 GK 7890' } });
  if (!truck2) truck2 = await prisma.truck.create({ data: { orgId: nashikOrg.id, number: 'MH14 GK 7890', type: 'TATA_407', capacity: 2500 } });

  let truck3 = await prisma.truck.findFirst({ where: { number: 'MH12 PQ 3456' } });
  if (!truck3) truck3 = await prisma.truck.create({ data: { orgId: puneOrg.id, number: 'MH12 PQ 3456', type: 'BOLERO_PICKUP', capacity: 1500 } });

  console.log('✅ Drivers & Trucks created');

  // ════════════════════════════════════════════
  // 4. ITEM MASTER
  // ════════════════════════════════════════════
  const itemDefs = [
    { name: 'Tomato (Hybrid)', nameHindi: 'टमाटर (हाइब्रिड)', category: 'Vegetable', defaultUnit: QuantityUnit.CRATE },
    { name: 'Onion (Nashik Red)', nameHindi: 'प्याज (लाल)', category: 'Vegetable', defaultUnit: QuantityUnit.QUINTAL },
    { name: 'Potato (Agra)', nameHindi: 'आलू (आगरा)', category: 'Vegetable', defaultUnit: QuantityUnit.BAG },
    { name: 'Pomegranate', nameHindi: 'अनार', category: 'Fruit', defaultUnit: QuantityUnit.CRATE },
    { name: 'Grapes (Thompson)', nameHindi: 'अंगूर (थॉम्पसन)', category: 'Fruit', defaultUnit: QuantityUnit.BOX },
    { name: 'Cabbage', nameHindi: 'पत्तागोभी', category: 'Vegetable', defaultUnit: QuantityUnit.KG },
    { name: 'Capsicum (Green)', nameHindi: 'शिमला मिर्च', category: 'Vegetable', defaultUnit: QuantityUnit.CRATE },
    { name: 'Cauliflower', nameHindi: 'फूलगोभी', category: 'Vegetable', defaultUnit: QuantityUnit.PIECE },
    { name: 'Banana (Elaichi)', nameHindi: 'केला (इलायची)', category: 'Fruit', defaultUnit: QuantityUnit.DOZEN },
    { name: 'Coriander', nameHindi: 'धनिया', category: 'Vegetable', defaultUnit: QuantityUnit.BUNDLE },
  ];

  const items: Record<string, any> = {};
  for (const d of itemDefs) {
    items[d.name] = await prisma.item.upsert({
      where: { orgId_name: { orgId: nashikOrg.id, name: d.name } },
      update: {}, create: { orgId: nashikOrg.id, ...d },
    });
  }
  // Also create for Pune org
  for (const d of itemDefs.slice(0, 5)) {
    await prisma.item.upsert({
      where: { orgId_name: { orgId: puneOrg.id, name: d.name } },
      update: {}, create: { orgId: puneOrg.id, ...d },
    });
  }

  console.log(`✅ Item Master (${itemDefs.length} items)`);

  // ════════════════════════════════════════════
  // 5. TRIPS (realistic variety)
  // ════════════════════════════════════════════

  // ── Trip A: IN_TRANSIT — Nashik → Mumbai (Tomato + Onion, left 3hrs ago)
  let tripA = await prisma.trip.findFirst({ where: { sourceOrgId: nashikOrg.id, destinationOrgId: mumbaiOrg.id, status: TripStatus.IN_TRANSIT } });
  if (!tripA) {
    tripA = await prisma.trip.create({
      data: {
        sourceOrgId: nashikOrg.id, destinationOrgId: mumbaiOrg.id,
        truckId: truck1.id, driverId: dp1.id, createdByUserId: agastya.id,
        startPoint: 'Pimpalgaon Baswant APMC, Nashik', endPoint: 'APMC Market, Vashi',
        startTime: hrs(3), estimatedDistance: 185, estimatedArrival: hrs(-1),
        status: TripStatus.IN_TRANSIT,
        notes: 'Urgent — Javed bhai needs tomatoes for Dadar market by evening',
        sourceAddress: nashikAddress,
        destinationAddress: mumbaiAddress,
      },
    });
    const lc = await prisma.tripLoadCard.create({ data: { tripId: tripA.id, loadedAt: hrs(3.5), remarks: 'All items checked, quality A grade', totalItems: 2, totalQuantity: 130, totalAmount: 184000, createdByUserId: agastya.id } });
    await prisma.loadItem.createMany({
      data: [
        { loadCardId: lc.id, itemId: items['Tomato (Hybrid)'].id, itemName: 'Tomato (Hybrid)', itemNameHindi: 'टमाटर (हाइब्रिड)', quantity: 80, unit: QuantityUnit.CRATE, rate: 1200, amount: 96000, grade: 'A', remarks: 'Firm red, no damage', sortOrder: 1 },
        { loadCardId: lc.id, itemId: items['Onion (Nashik Red)'].id, itemName: 'Onion (Nashik Red)', itemNameHindi: 'प्याज (लाल)', quantity: 50, unit: QuantityUnit.QUINTAL, rate: 1760, amount: 88000, grade: 'A', remarks: 'Medium size, dry', sortOrder: 2 },
      ]
    });
    await prisma.tripEvent.createMany({
      data: [
        { tripId: tripA.id, eventType: TripEventType.TRIP_CREATED, description: 'Trip created by Agastya', atTime: hrs(5), createdByUserId: agastya.id },
        { tripId: tripA.id, eventType: TripEventType.ASSIGNED, description: 'Driver Ramu Yadav assigned', atTime: hrs(4), createdByUserId: agastya.id },
        { tripId: tripA.id, eventType: TripEventType.LOAD_COMPLETED, description: '80 crates tomato + 50 quintal onion loaded', atTime: hrs(3.5), createdByUserId: agastya.id },
        { tripId: tripA.id, eventType: TripEventType.IN_TRANSIT, description: 'Departed from Nashik', atTime: hrs(3), createdByUserId: driverRamu.id },
      ]
    });
  }
  console.log(`✅ Trip A (IN_TRANSIT): Nashik → Mumbai`);

  // ── Trip B: DELIVERED — Nashik → Mumbai (Grapes, delivered yesterday)
  let tripB = await prisma.trip.findFirst({ where: { sourceOrgId: nashikOrg.id, destinationOrgId: mumbaiOrg.id, status: TripStatus.DELIVERED } });
  if (!tripB) {
    tripB = await prisma.trip.create({
      data: {
        sourceOrgId: nashikOrg.id, destinationOrgId: mumbaiOrg.id,
        truckId: truck2.id, driverId: dp2.id, createdByUserId: agastya.id,
        startPoint: 'Pimpalgaon Baswant APMC, Nashik', endPoint: 'APMC Market, Vashi',
        startTime: days(1.5), estimatedDistance: 185,
        status: TripStatus.DELIVERED,
        notes: 'Export quality Thompson grapes for Mumbai retailers',
        sourceAddress: nashikAddress,
        destinationAddress: mumbaiAddress,
      },
    });
    const lcB = await prisma.tripLoadCard.create({ data: { tripId: tripB.id, loadedAt: days(1.5), remarks: 'Grapes packed in cold storage boxes', totalItems: 2, totalQuantity: 95, totalAmount: 365000, createdByUserId: agastya.id } });
    const liB = await prisma.loadItem.createMany({
      data: [
        { loadCardId: lcB.id, itemId: items['Grapes (Thompson)'].id, itemName: 'Grapes (Thompson)', itemNameHindi: 'अंगूर (थॉम्पसन)', quantity: 60, unit: QuantityUnit.BOX, rate: 4500, amount: 270000, grade: 'Export', remarks: 'Seedless, green Thompson', sortOrder: 1 },
        { loadCardId: lcB.id, itemId: items['Pomegranate'].id, itemName: 'Pomegranate', itemNameHindi: 'अनार', quantity: 35, unit: QuantityUnit.CRATE, rate: 2714, amount: 95000, grade: 'Premium', remarks: 'Bhagwa variety', sortOrder: 2 },
      ]
    });
    const loadItemsB = await prisma.loadItem.findMany({ where: { loadCardId: lcB.id }, orderBy: { sortOrder: 'asc' } });
    const rcB = await prisma.tripReceiveCard.create({ data: { tripId: tripB.id, receivedAt: days(1), remarks: '2 boxes grapes slightly soft, rest OK', totalItems: 2, totalQuantity: 93, totalAmount: 358500, totalShortage: 2, shortagePercent: 2.1, status: 'PENDING', createdByUserId: driverSuresh.id } });
    await prisma.receiveItem.createMany({
      data: [
        { receiveCardId: rcB.id, loadItemId: loadItemsB[0].id, itemId: items['Grapes (Thompson)'].id, itemName: 'Grapes (Thompson)', itemNameHindi: 'अंगूर (थॉम्पसन)', quantity: 58, unit: QuantityUnit.BOX, shortage: 2, shortagePercent: 3.33, rate: 4500, amount: 261000, grade: 'Export', remarks: '2 boxes spoiled in transit', sortOrder: 1 },
        { receiveCardId: rcB.id, loadItemId: loadItemsB[1].id, itemId: items['Pomegranate'].id, itemName: 'Pomegranate', itemNameHindi: 'अनार', quantity: 35, unit: QuantityUnit.CRATE, shortage: 0, shortagePercent: 0, rate: 2714, amount: 95000, grade: 'Premium', sortOrder: 2 },
      ]
    });
    await prisma.tripEvent.createMany({
      data: [
        { tripId: tripB.id, eventType: TripEventType.TRIP_CREATED, description: 'Trip created', atTime: days(2), createdByUserId: agastya.id },
        { tripId: tripB.id, eventType: TripEventType.LOAD_COMPLETED, description: 'Loading done', atTime: days(1.5), createdByUserId: agastya.id },
        { tripId: tripB.id, eventType: TripEventType.IN_TRANSIT, description: 'Left Nashik', atTime: days(1.5), createdByUserId: driverSuresh.id },
        { tripId: tripB.id, eventType: TripEventType.DELIVERED, description: 'Delivered at Vashi APMC', atTime: days(1), createdByUserId: driverSuresh.id },
      ]
    });
  }
  console.log(`✅ Trip B (DELIVERED): Nashik → Mumbai (Grapes)`);

  // ── Trip C: CREATED — Nashik → Mumbai (planned for tomorrow)
  let tripC = await prisma.trip.findFirst({ where: { sourceOrgId: nashikOrg.id, destinationOrgId: mumbaiOrg.id, status: TripStatus.CREATED } });
  if (!tripC) {
    tripC = await prisma.trip.create({
      data: {
        sourceOrgId: nashikOrg.id, destinationOrgId: mumbaiOrg.id,
        truckId: truck2.id, createdByUserId: agastya.id,
        startPoint: 'Pimpalgaon APMC', endPoint: 'APMC Vashi',
        status: TripStatus.CREATED,
        notes: 'Capsicum and cauliflower — need to assign driver',
        sourceAddress: nashikAddress,
        destinationAddress: mumbaiAddress,
      },
    });
    await prisma.tripEvent.create({ data: { tripId: tripC.id, eventType: TripEventType.TRIP_CREATED, description: 'Trip created, driver TBD', createdByUserId: agastya.id } });
  }
  console.log(`✅ Trip C (CREATED): Nashik → Mumbai (pending)`);

  // ── Trip D: COMPLETED — Pune → Mumbai (closed deal)
  let tripD = await prisma.trip.findFirst({ where: { sourceOrgId: puneOrg.id, destinationOrgId: mumbaiOrg.id, status: TripStatus.COMPLETED } });
  if (!tripD) {
    tripD = await prisma.trip.create({
      data: {
        sourceOrgId: puneOrg.id, destinationOrgId: mumbaiOrg.id,
        truckId: truck3.id, driverId: dp3.id, createdByUserId: ramesh.id,
        startPoint: 'Market Yard, Pune', endPoint: 'APMC Vashi',
        startTime: days(5), estimatedDistance: 150,
        status: TripStatus.COMPLETED,
        notes: 'Potato shipment — all settled',
        sourceAddress: puneAddress,
        destinationAddress: mumbaiAddress,
      },
    });
  }
  console.log(`✅ Trip D (COMPLETED): Pune → Mumbai`);

  // ════════════════════════════════════════════
  // 6. LEDGER ACCOUNTS
  // ════════════════════════════════════════════
  let acctNM = await prisma.account.findUnique({ where: { ownerOrgId_counterpartyOrgId: { ownerOrgId: nashikOrg.id, counterpartyOrgId: mumbaiOrg.id } } });
  if (!acctNM) {
    acctNM = await prisma.account.create({ data: { ownerOrgId: nashikOrg.id, counterpartyOrgId: mumbaiOrg.id, balance: 365000_00 } });
    await prisma.account.create({ data: { ownerOrgId: mumbaiOrg.id, counterpartyOrgId: nashikOrg.id, balance: -365000_00 } });
    await prisma.ledgerEntry.createMany({
      data: [
        { accountId: acctNM.id, tripId: tripB!.id, direction: 'RECEIVABLE', amount: 365000_00, balance: 365000_00, description: 'Grapes + Pomegranate shipment — Invoice #NM-2026-003', tag: 'DUE' },
      ]
    });
  }

  let acctPM = await prisma.account.findUnique({ where: { ownerOrgId_counterpartyOrgId: { ownerOrgId: puneOrg.id, counterpartyOrgId: mumbaiOrg.id } } });
  if (!acctPM) {
    acctPM = await prisma.account.create({ data: { ownerOrgId: puneOrg.id, counterpartyOrgId: mumbaiOrg.id, balance: 0 } });
    await prisma.account.create({ data: { ownerOrgId: mumbaiOrg.id, counterpartyOrgId: puneOrg.id, balance: 0 } });
  }
  console.log('✅ Ledger accounts created');

  // ════════════════════════════════════════════
  // 7. CHAT THREADS & MESSAGES (ORG-PAIR architecture)
  // ════════════════════════════════════════════

  // ── Thread: Nashik ↔ Mumbai (main business thread)
  const [orgA, orgB] = normOrgPair(nashikOrg.id, mumbaiOrg.id);
  let threadNM = await prisma.chatThread.findFirst({ where: { orgId: orgA, counterpartyOrgId: orgB } });
  if (!threadNM) {
    threadNM = await prisma.chatThread.create({
      data: {
        orgId: orgA, counterpartyOrgId: orgB, accountId: acctNM!.id,
        title: 'Mahajan Fruits ↔ Shaikh Trading',
        type: 'ORG_CHAT',
        lastMessageAt: hrs(0.5),
        lastMessageText: 'Haan bhai, Ramu abhi Igatpuri cross kar raha hai',
      },
    });

    // Authentic mandi trader conversation (Hindi-English mix)
    await prisma.chatMessage.createMany({
      data: [
        // 3 days ago — discussing grapes deal
        { threadId: threadNM.id, senderUserId: agastya.id, messageType: ChatMessageType.TEXT, content: 'Javed bhai, Thompson grapes ka bhav fix ho gaya — ₹4,500 per box. 60 box ready hai. Anar bhi hai 35 crate Bhagwa variety.', tripId: tripB?.id, createdAt: days(2.5) },
        { threadId: threadNM.id, senderUserId: javed.id, messageType: ChatMessageType.TEXT, content: 'Bhav thoda zyada hai Agastya bhai, last time 4200 mein liye the. 4300 chalega?', createdAt: days(2.4) },
        { threadId: threadNM.id, senderUserId: agastya.id, messageType: ChatMessageType.TEXT, content: 'Bhai season khatam ho raha hai, farmer se hi 3800 mein utha raha hoon. 4500 se neeche nahi hoga. Quality dekh lena, export grade hai.', createdAt: days(2.3) },
        { threadId: threadNM.id, senderUserId: javed.id, messageType: ChatMessageType.TEXT, content: 'Theek hai bhai, 4500 done. Kal subah bhej do, Suresh ko bhejo.', createdAt: days(2.2) },
        { threadId: threadNM.id, senderUserId: agastya.id, messageType: ChatMessageType.TEXT, content: '👍 Done. Kal early morning nikal jayega. Suresh ko bol deta hoon.', createdAt: days(2.1) },

        // Trip B sent — system-style messages with trip context
        { threadId: threadNM.id, senderUserId: null, messageType: ChatMessageType.SYSTEM_MESSAGE, content: '🚚 Trip created: Nashik → Vashi (Grapes + Pomegranate)', tripId: tripB?.id, metadata: { type: 'TRIP_CREATED' }, createdAt: days(2) },
        { threadId: threadNM.id, senderUserId: null, messageType: ChatMessageType.SYSTEM_MESSAGE, content: '📦 Loading complete: 60 boxes Grapes, 35 crates Pomegranate', tripId: tripB?.id, metadata: { type: 'LOAD_COMPLETED' }, createdAt: days(1.5) },
        { threadId: threadNM.id, senderUserId: agastya.id, messageType: ChatMessageType.TEXT, content: 'Suresh nikal gaya Javed bhai. Sab maal check karke bheja hai. Grapes cold pack mein hai.', tripId: tripB?.id, createdAt: days(1.45) },
        { threadId: threadNM.id, senderUserId: javed.id, messageType: ChatMessageType.TEXT, content: 'Ok bhai 👍 Vashi gate pe mere aadmi khade honge', tripId: tripB?.id, createdAt: days(1.4) },
        { threadId: threadNM.id, senderUserId: agastya.id, messageType: ChatMessageType.AUDIO, content: '', metadata: { duration: 22, key: 'voice/agastya-grapes-update.m4a' }, tripId: tripB?.id, createdAt: days(1.3) },

        // Delivery and shortage discussion
        { threadId: threadNM.id, senderUserId: null, messageType: ChatMessageType.SYSTEM_MESSAGE, content: '✅ Delivered at APMC Market, Vashi', tripId: tripB?.id, metadata: { type: 'DELIVERED' }, createdAt: days(1) },
        { threadId: threadNM.id, senderUserId: javed.id, messageType: ChatMessageType.TEXT, content: 'Agastya bhai, maal aa gaya. Par 2 box grapes soft ho gaye transit mein. Baaki sab first class hai. Anar mast hai 👌', tripId: tripB?.id, createdAt: days(0.95) },
        { threadId: threadNM.id, senderUserId: agastya.id, messageType: ChatMessageType.TEXT, content: 'Arey yaar 😕 Packaging mein kuch issue hua hoga. 2 box ka adjust kar lete hain next bill mein. Chalta hai bhai.', tripId: tripB?.id, createdAt: days(0.9) },
        { threadId: threadNM.id, senderUserId: javed.id, messageType: ChatMessageType.TEXT, content: 'Haan theek hai, adjust kar lenge. Anar ka rate bhi 2714 sahi hai na?', tripId: tripB?.id, createdAt: days(0.85) },
        { threadId: threadNM.id, senderUserId: agastya.id, messageType: ChatMessageType.TEXT, content: 'Haan bhai, 35 crate × ₹2714 = ₹95,000. Total bill ₹3,58,500 bana hai shortage adjust karke.', tripId: tripB?.id, createdAt: days(0.8) },

        // Payment discussion
        { threadId: threadNM.id, senderUserId: javed.id, messageType: ChatMessageType.TEXT, content: 'Bhai payment ka kya plan hai? ₹3,65,000 ho gaya total pending mein. Thoda time do, Dadar market ka settlement aane do.', createdAt: days(0.5) },
        { threadId: threadNM.id, senderUserId: agastya.id, messageType: ChatMessageType.TEXT, content: 'Haan bhai koi tension nahi. Week end tak bhej dena jitna ho sake.', createdAt: days(0.45) },
        { threadId: threadNM.id, senderUserId: javed.id, messageType: ChatMessageType.AUDIO, content: '', metadata: { duration: 35, key: 'voice/javed-payment-plan.m4a' }, createdAt: days(0.4) },

        // Today — Trip A discussion (IN_TRANSIT)
        { threadId: threadNM.id, senderUserId: null, messageType: ChatMessageType.SYSTEM_MESSAGE, content: '🚚 New trip: Nashik → Vashi (Tomato + Onion)', tripId: tripA?.id, metadata: { type: 'TRIP_CREATED' }, createdAt: hrs(5) },
        { threadId: threadNM.id, senderUserId: agastya.id, messageType: ChatMessageType.TEXT, content: 'Javed bhai, aaj ka maal bhi nikal raha hai. 80 crate tamatar + 50 quintal pyaaz. Ramu le ja raha hai Eicher mein.', tripId: tripA?.id, createdAt: hrs(4.5) },
        { threadId: threadNM.id, senderUserId: javed.id, messageType: ChatMessageType.TEXT, content: 'Sahi hai 👍 Tamatar ka bhav kya rakha hai?', tripId: tripA?.id, createdAt: hrs(4.3) },
        { threadId: threadNM.id, senderUserId: agastya.id, messageType: ChatMessageType.TEXT, content: '₹1200 per crate. Mandi mein rate upar gaya hai, demand hai Mumbai mein.', tripId: tripA?.id, createdAt: hrs(4.1) },
        { threadId: threadNM.id, senderUserId: javed.id, messageType: ChatMessageType.TEXT, content: 'Arey 1200 toh bahut hai yaar! 1100 kar do. Agle hafte bhi mangwana hai.', tripId: tripA?.id, createdAt: hrs(3.9) },
        { threadId: threadNM.id, senderUserId: agastya.id, messageType: ChatMessageType.TEXT, content: 'Bhai 1150 last. Pimpalgaon mein hi 900 lag raha hai farmer se. Margin nahi bach raha.', tripId: tripA?.id, createdAt: hrs(3.7) },
        { threadId: threadNM.id, senderUserId: javed.id, messageType: ChatMessageType.TEXT, content: 'Chalo 1150 done 🤝 Pyaaz 1760 mein sahi hai.', tripId: tripA?.id, createdAt: hrs(3.5) },
        { threadId: threadNM.id, senderUserId: null, messageType: ChatMessageType.SYSTEM_MESSAGE, content: '📦 Loading complete — 80 crates Tomato, 50 quintal Onion', tripId: tripA?.id, metadata: { type: 'LOAD_COMPLETED' }, createdAt: hrs(3.3) },
        { threadId: threadNM.id, senderUserId: null, messageType: ChatMessageType.SYSTEM_MESSAGE, content: '🛣️ Trip started — Driver Ramu Yadav departed', tripId: tripA?.id, metadata: { type: 'IN_TRANSIT' }, createdAt: hrs(3) },
        { threadId: threadNM.id, senderUserId: agastya.id, messageType: ChatMessageType.TEXT, content: 'Ramu nikal gaya. ETA 4 ghante. Igatpuri se pehle network issue ho sakta hai, mat ghabrana.', tripId: tripA?.id, createdAt: hrs(2.8) },
        { threadId: threadNM.id, senderUserId: javed.id, messageType: ChatMessageType.TEXT, content: 'Theek hai bhai. Tracking on hai na?', tripId: tripA?.id, createdAt: hrs(2.5) },
        { threadId: threadNM.id, senderUserId: agastya.id, messageType: ChatMessageType.TEXT, content: 'Haan bhai GPS on hai. App mein live dekh sakte ho.', tripId: tripA?.id, createdAt: hrs(2.3) },
        { threadId: threadNM.id, senderUserId: javed.id, messageType: ChatMessageType.TEXT, content: 'Haan dekh raha hoon, Igatpuri ke paas hai abhi. 🚛', tripId: tripA?.id, createdAt: hrs(1) },
        { threadId: threadNM.id, senderUserId: agastya.id, messageType: ChatMessageType.TEXT, content: 'Haan bhai, Ramu abhi Igatpuri cross kar raha hai. 2 ghante mein pahunch jayega.', tripId: tripA?.id, createdAt: hrs(0.5) },
      ]
    });
  }
  console.log('✅ Chat: Nashik ↔ Mumbai (30+ authentic messages)');

  // ── Thread: Pune ↔ Mumbai
  const [orgC, orgD] = normOrgPair(puneOrg.id, mumbaiOrg.id);
  let threadPM = await prisma.chatThread.findFirst({ where: { orgId: orgC, counterpartyOrgId: orgD } });
  if (!threadPM) {
    threadPM = await prisma.chatThread.create({
      data: {
        orgId: orgC, counterpartyOrgId: orgD, accountId: acctPM?.id,
        title: 'Patil Agro ↔ Shaikh Trading', type: 'ORG_CHAT',
        lastMessageAt: days(3), lastMessageText: 'Sab settle ho gaya bhai 👍',
      },
    });
    await prisma.chatMessage.createMany({
      data: [
        { threadId: threadPM.id, senderUserId: ramesh.id, messageType: ChatMessageType.TEXT, content: 'Javed bhai, 200 bag Agra potato ka order ready hai. Rate ₹850 per bag.', tripId: tripD?.id, createdAt: days(6) },
        { threadId: threadPM.id, senderUserId: javed.id, messageType: ChatMessageType.TEXT, content: 'Ramesh bhai, 800 chalega? 200 bag hai toh thoda discount do.', createdAt: days(5.8) },
        { threadId: threadPM.id, senderUserId: ramesh.id, messageType: ChatMessageType.TEXT, content: '825 last. Volume discount de raha hoon already.', createdAt: days(5.6) },
        { threadId: threadPM.id, senderUserId: javed.id, messageType: ChatMessageType.TEXT, content: 'Done 🤝', createdAt: days(5.5) },
        { threadId: threadPM.id, senderUserId: null, messageType: ChatMessageType.SYSTEM_MESSAGE, content: '🚚 Trip: Pune → Vashi (200 bags Potato)', tripId: tripD?.id, metadata: { type: 'TRIP_CREATED' }, createdAt: days(5) },
        { threadId: threadPM.id, senderUserId: null, messageType: ChatMessageType.SYSTEM_MESSAGE, content: '✅ Delivered & settled', tripId: tripD?.id, metadata: { type: 'TRIP_COMPLETED' }, createdAt: days(4) },
        { threadId: threadPM.id, senderUserId: javed.id, messageType: ChatMessageType.TEXT, content: 'Sab settle ho gaya bhai 👍', createdAt: days(3) },
      ]
    });
  }
  console.log('✅ Chat: Pune ↔ Mumbai');

  // ════════════════════════════════════════════
  // 8. GPS LOCATION HISTORY (Trip A — IN_TRANSIT)
  // ════════════════════════════════════════════
  if (tripA) {
    const route = genRoute(
      { lat: 20.0063, lng: 73.7910 }, // Nashik
      { lat: 19.0760, lng: 72.8777 }, // Mumbai
      40, hrs(3), new Date()
    );
    await prisma.tripLocation.deleteMany({ where: { tripId: tripA.id } });
    await prisma.tripLocation.createMany({
      data: route.map((p, i) => ({
        tripId: tripA!.id, driverId: dp1.id,
        lat: p.lat, lng: p.lng,
        speed: 35 + Math.random() * 35, heading: calcHeading(route[Math.max(0, i - 1)], p),
        accuracy: 8 + Math.random() * 15, capturedAt: p.ts, batchId: `b_${i}_${Date.now()}`,
      })),
    });
    const last = route[route.length - 1];
    await prisma.tripLatestLocation.upsert({
      where: { tripId: tripA.id },
      update: { lat: last.lat, lng: last.lng, speed: 52, heading: 220, accuracy: 12, capturedAt: last.ts },
      create: { tripId: tripA.id, lat: last.lat, lng: last.lng, speed: 52, heading: 220, accuracy: 12, capturedAt: last.ts },
    });
    console.log(`✅ GPS history (${route.length} points for Trip A)`);
  }

  // ════════════════════════════════════════════
  // 9. BULK GENERATION (20+ Users, Orgs, Drivers, Trips for all statuses)
  // ════════════════════════════════════════════
  const fakeNames = ['Amit', 'Rohit', 'Vikram', 'Sanjay', 'Rajesh', 'Karan', 'Vijay', 'Anil', 'Sunil', 'Prakash', 'Manish', 'Rahul', 'Nitin', 'Deepak', 'Rakesh'];
  const mahajans = [];
  const driverProfs = [];
  const bulkOrgs = [];
  const bulkTrucks = [];

  for (let i = 0; i < 15; i++) {
    const p = i.toString().padStart(2, '0');
    // Mahajan User
    const mUser = await prisma.user.upsert({
      where: { phone: `+9198000000${p}` },
      update: {},
      create: { phone: `+9198000000${p}`, name: `${fakeNames[i]} Trader`, role: UserRole.MAHAJAN, status: 'ACTIVE' },
    });
    mahajans.push(mUser);

    // Driver User
    const dUser = await prisma.user.upsert({
      where: { phone: `+9188000000${p}` },
      update: {},
      create: { phone: `+9188000000${p}`, name: `${fakeNames[i]} Driver`, role: UserRole.DRIVER, status: 'ACTIVE' },
    });

    // Driver Profile
    let dProf = await prisma.driverProfile.findUnique({ where: { userId: dUser.id } });
    if (!dProf) {
      dProf = await prisma.driverProfile.create({ data: { userId: dUser.id, licenseNo: `MH${10 + i}/2023/${1000 + i}` } });
    }
    driverProfs.push(dProf);

    // Create Org
    const city = ['Pune', 'Mumbai', 'Nashik', 'Nagpur', 'Surat'][i % 5];
    const cityGstin = `27BB${city.substring(0, 2).toUpperCase()}${1000 + i}R1Z${p}`;
    let org = await prisma.org.findUnique({ where: { gstin: cityGstin } });
    if (!org) {
      org = await prisma.org.create({
        data: {
          name: `${fakeNames[i]} Agro Traders`,
          city: city,
          phone: `+9177000000${p}`,
          roleType: MahajanRoleType.BOTH,
          gstin: cityGstin,
          address: { label: 'Main Market', city, state: 'Maharashtra', pincode: '400000' }
        }
      });
    }
    bulkOrgs.push(org);

    // Org Member
    await prisma.orgMember.upsert({
      where: { orgId_userId: { orgId: org.id, userId: mUser.id } },
      update: {}, create: { orgId: org.id, userId: mUser.id }
    });

    // Truck
    const tNum = `MH${10 + i} AB ${1000 + i}`;
    let truck = await prisma.truck.findUnique({ where: { number: tNum } });
    if (!truck) {
      truck = await prisma.truck.create({
        data: { orgId: org.id, number: tNum, type: 'TATA_407', capacity: 3000 }
      });
    }
    bulkTrucks.push(truck);
  }

  console.log('✅ Bulk Users, Orgs, Drivers, Trucks created');

  // Generate Trips for ALL STATUSES
  const allStatuses = Object.values(TripStatus);
  let bulkTripCount = 0;

  for (const status of allStatuses) {
    // 3 trips per status
    for (let j = 0; j < 3; j++) {
      const srcIdx = bulkTripCount % bulkOrgs.length;
      let destIdx = (bulkTripCount + 1) % bulkOrgs.length;
      if (srcIdx === destIdx) destIdx = (destIdx + 1) % bulkOrgs.length;
      const driverIdx = bulkTripCount % driverProfs.length;

      const srcOrg = bulkOrgs[srcIdx];
      const destOrg = bulkOrgs[destIdx];
      const tDriverProf = driverProfs[driverIdx];
      const tTruck = bulkTrucks[srcIdx];
      const creator = mahajans[srcIdx];

      const trip = await prisma.trip.create({
        data: {
          sourceOrgId: srcOrg.id,
          destinationOrgId: destOrg.id,
          truckId: tTruck.id,
          driverId: tDriverProf.id,
          createdByUserId: creator.id,
          startPoint: `Market in ${srcOrg.city}`,
          endPoint: `Market in ${destOrg.city}`,
          status: status,
          notes: `Bulk generated trip with status ${status}`,
          sourceAddress: srcOrg.address ? (srcOrg.address as any) : undefined,
          destinationAddress: destOrg.address ? (destOrg.address as any) : undefined,
          ...(status === 'CANCELLED' ? { cancelledAt: new Date(), cancelReason: 'Vehicle Breakdown' } : {}),
        }
      });

      // Insert minimal event
      await prisma.tripEvent.create({
        data: {
          tripId: trip.id,
          eventType: TripEventType.TRIP_CREATED,
          description: `Bulk Trip created with initial status ${status}`,
          createdByUserId: creator.id,
        }
      });

      // Special handling based on status for realism
      if (['LOADED', 'IN_TRANSIT', 'ARRIVED', 'REACHED', 'DELIVERED', 'COMPLETED', 'CLOSED'].includes(status)) {
        await prisma.tripEvent.create({
          data: { tripId: trip.id, eventType: TripEventType.LOAD_COMPLETED, description: 'Loading done', createdByUserId: creator.id }
        });
      }
      if (['IN_TRANSIT', 'ARRIVED', 'REACHED', 'DELIVERED', 'COMPLETED', 'CLOSED'].includes(status)) {
        await prisma.tripEvent.create({
          data: { tripId: trip.id, eventType: TripEventType.IN_TRANSIT, description: 'Started', createdByUserId: tDriverProf.userId }
        });
      }
      if (['ARRIVED', 'REACHED', 'DELIVERED', 'COMPLETED', 'CLOSED'].includes(status)) {
        await prisma.tripEvent.create({
          data: { tripId: trip.id, eventType: TripEventType.ARRIVED, description: 'Arrived at destination', createdByUserId: tDriverProf.userId }
        });
      }
      if (['DELIVERED', 'COMPLETED', 'CLOSED'].includes(status)) {
        await prisma.tripEvent.create({
          data: { tripId: trip.id, eventType: TripEventType.DELIVERED, description: 'Delivered', createdByUserId: tDriverProf.userId }
        });
      }
      if (status === 'DISPUTED') {
        await prisma.tripEvent.create({
          data: { tripId: trip.id, eventType: TripEventType.DISPUTE_RAISED, description: 'Dispute raised due to shortage', createdByUserId: creator.id }
        });
      }

      // Create LoadCards dynamically
      const lc = await prisma.tripLoadCard.create({
        data: {
          tripId: trip.id,
          loadedAt: new Date(),
          remarks: 'Auto-generated load card',
          totalItems: 1,
          totalQuantity: 100,
          totalAmount: 50000,
          createdByUserId: creator.id
        }
      });

      await prisma.loadItem.create({
        data: {
          loadCardId: lc.id,
          itemName: 'Mixed Vegetables',
          quantity: 100,
          unit: QuantityUnit.KG,
          rate: 500,
          amount: 50000,
          sortOrder: 1
        }
      });

      if (['DELIVERED', 'COMPLETED', 'CLOSED', 'DISPUTED'].includes(status)) {
        const rc = await prisma.tripReceiveCard.create({
          data: {
            tripId: trip.id,
            receivedAt: new Date(),
            remarks: 'Auto-generated receive card',
            totalItems: 1,
            totalQuantity: 95,
            totalAmount: 47500,
            totalShortage: 5,
            shortagePercent: 5,
            status: status === 'DISPUTED' ? 'DISPUTED' : 'APPROVED',
            createdByUserId: tDriverProf.userId
          }
        });

        const loadIt = await prisma.loadItem.findFirst({ where: { loadCardId: lc.id } });
        if (loadIt) {
          await prisma.receiveItem.create({
            data: {
              receiveCardId: rc.id,
              loadItemId: loadIt.id,
              itemName: 'Mixed Vegetables',
              quantity: 95,
              unit: QuantityUnit.KG,
              rate: 500,
              amount: 47500,
              shortage: 5,
              shortagePercent: 5,
              sortOrder: 1
            }
          });
        }
      }

      bulkTripCount++;
    }
  }

  console.log(`✅ Bulk Trips created (${bulkTripCount} trips for all statuses)`);

  // ════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════════════════');
  console.log('🎉 Production seed complete!');
  console.log('══════════════════════════════════════════════════════');
  console.log('');
  console.log('  📱 Login (OTP bypass in dev):');
  console.log(`     Agastya Mahajan:  ${agastya.phone}  (dev_916202923165_3434)`);
  console.log(`     Javed Shaikh:     ${javed.phone}  (dev_919006412619_3434)`);
  console.log(`     Ramesh Patil:     ${ramesh.phone}  (dev_919823456789_3434)`);
  console.log('');
  console.log('  🏢 Organizations:');
  console.log(`     ${nashikOrg.name}`);
  console.log(`     ${mumbaiOrg.name}`);
  console.log(`     ${puneOrg.name}`);
  console.log('');
  console.log('  🚚 Trips:');
  console.log(`     IN_TRANSIT:  ${tripA?.id}  (Tomato + Onion, Nashik → Mumbai)`);
  console.log(`     DELIVERED:   ${tripB?.id}  (Grapes + Pomegranate)`);
  console.log(`     CREATED:     ${tripC?.id}  (Capsicum, driver TBD)`);
  console.log(`     COMPLETED:   ${tripD?.id}  (Potato, Pune → Mumbai)`);
  console.log('');
  console.log('  💬 Chat Threads (org-pair architecture):');
  console.log(`     Nashik ↔ Mumbai:  ${threadNM?.id}  (30+ messages with trip context)`);
  console.log(`     Pune ↔ Mumbai:    ${threadPM?.id}  (7 messages)`);
  console.log('');
  console.log('  💰 Ledger: ₹3,65,000 pending (Nashik → Mumbai)');
  console.log('══════════════════════════════════════════════════════');
}

// ── Route generation helpers ──
function genRoute(start: { lat: number, lng: number }, end: { lat: number, lng: number }, n: number, t0: Date, t1: Date) {
  const pts: { lat: number, lng: number, ts: Date }[] = [];
  const dt = t1.getTime() - t0.getTime();
  for (let i = 0; i < n; i++) {
    const p = i / (n - 1);
    const j = 0.002;
    pts.push({ lat: start.lat + (end.lat - start.lat) * p + (Math.random() - .5) * j, lng: start.lng + (end.lng - start.lng) * p + (Math.random() - .5) * j, ts: new Date(t0.getTime() + dt * p) });
  }
  return pts;
}

function calcHeading(a: { lat: number, lng: number }, b: { lat: number, lng: number }) {
  const dL = b.lng - a.lng;
  const y = Math.sin(dL) * Math.cos(b.lat);
  const x = Math.cos(a.lat) * Math.sin(b.lat) - Math.sin(a.lat) * Math.cos(b.lat) * Math.cos(dL);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

main()
  .catch((e) => { console.error('❌ Seed failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
