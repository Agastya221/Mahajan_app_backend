import 'dotenv/config';
import { UserRole, TripStatus, QuantityUnit, MahajanRoleType, ChatMessageType } from '@prisma/client';
import prisma from '../src/config/database';

async function main() {
  console.log('🌱 Seeding database...\n');

  // ── 1. Create Users ──────────────────────────────────────────────
  // All users use OTP-only login (no passwords)

  // Agastya Mahajan (Source - Collector) - OTP only
  const mahajan1 = await prisma.user.upsert({
    where: { phone: '+916202923165' },
    update: { name: 'Agastya Mahajan' },
    create: {
      phone: '+916202923165',
      name: 'Agastya Mahajan',
      role: UserRole.MAHAJAN,
      status: 'ACTIVE',
    },
  });

  // Javed Mahajan (Destination - Distributor) - OTP only
  const mahajan2 = await prisma.user.upsert({
    where: { phone: '+919006412619' },
    update: { name: 'Javed Mahajan' },
    create: {
      phone: '+919006412619',
      name: 'Javed Mahajan',
      role: UserRole.MAHAJAN,
      status: 'ACTIVE',
    },
  });

  // Driver User 1 - Ramu - OTP only
  const driverUser1 = await prisma.user.upsert({
    where: { phone: '+919876543213' },
    update: {},
    create: {
      phone: '+919876543213',
      name: 'Ramu Driver',
      role: UserRole.DRIVER,
      status: 'ACTIVE',
    },
  });

  // Driver User 2 - Shyam - OTP only
  const driverUser2 = await prisma.user.upsert({
    where: { phone: '+919876543214' },
    update: {},
    create: {
      phone: '+919876543214',
      name: 'Shyam Driver',
      role: UserRole.DRIVER,
      status: 'ACTIVE',
    },
  });

  console.log('✅ Users created (OTP-only login)');
  console.log(`   👤 Agastya Mahajan:         ${mahajan1.phone}`);
  console.log(`   👤 Javed Mahajan:           ${mahajan2.phone}`);
  console.log(`   Driver 1:                   ${driverUser1.phone}`);
  console.log(`   Driver 2:                   ${driverUser2.phone}\n`);

  // ── 2. Create Organizations ───────────────────────────────────────
  const sourceOrg = await prisma.org.upsert({
    where: { gstin: '27AABCU9603R1ZM' },
    update: { name: 'Agastya Enterprises (Nashik)' },
    create: {
      name: 'Agastya Enterprises (Nashik)',
      city: 'Nashik',
      phone: '+916202923165',
      address: 'Market Yard, Nashik, Maharashtra',
      gstin: '27AABCU9603R1ZM',
      roleType: MahajanRoleType.SOURCE_COLLECTOR,
    },
  });

  const destOrg = await prisma.org.upsert({
    where: { gstin: '27AABCU9603R2ZN' },
    update: { name: 'Javed Traders (Mumbai)' },
    create: {
      name: 'Javed Traders (Mumbai)',
      city: 'Mumbai',
      phone: '+919006412619',
      address: 'APMC Market, Navi Mumbai, Maharashtra',
      gstin: '27AABCU9603R2ZN',
      roleType: MahajanRoleType.DESTINATION_DISTRIBUTOR,
    },
  });

  // Third org (for variety)
  const thirdOrg = await prisma.org.upsert({
    where: { gstin: '27AABCU9603R3ZO' },
    update: {},
    create: {
      name: 'Pune Fruits Hub',
      city: 'Pune',
      phone: '+919876543220',
      address: 'Market Yard, Pune, Maharashtra',
      gstin: '27AABCU9603R3ZO',
      roleType: MahajanRoleType.BOTH,
    },
  });

  console.log('✅ Organizations created');
  console.log(`   Source: ${sourceOrg.name} (${sourceOrg.id})`);
  console.log(`   Destination: ${destOrg.name} (${destOrg.id})`);
  console.log(`   Third Org: ${thirdOrg.name} (${thirdOrg.id})\n`);

  // ── 3. Create Org Memberships (each mahajan is sole owner of their org) ──
  await prisma.orgMember.upsert({
    where: { orgId_userId: { orgId: sourceOrg.id, userId: mahajan1.id } },
    update: {},
    create: { orgId: sourceOrg.id, userId: mahajan1.id },
  });

  await prisma.orgMember.upsert({
    where: { orgId_userId: { orgId: destOrg.id, userId: mahajan2.id } },
    update: {},
    create: { orgId: destOrg.id, userId: mahajan2.id },
  });

  console.log('✅ Org memberships created\n');

  // ... (Driver Profiles, Trucks, Items remain similar but I'll update summary logs later) ...
  // Skipping unrelated parts for brevity in this replace block if possible, but replace_file requires contiguous blocks.
  // I'll assume the middle parts are fine and jump to the chat insertion point.



  // ── 4. Create Driver Profiles (independent — no org binding) ─────
  let driverProfile1 = await prisma.driverProfile.findUnique({ where: { userId: driverUser1.id } });
  if (!driverProfile1) {
    driverProfile1 = await prisma.driverProfile.create({
      data: {
        userId: driverUser1.id,
        licenseNo: 'MH1420210012345',
        emergencyPhone: '+919876500001',
        notes: 'Experienced driver, 5+ years',
      },
    });
  }

  let driverProfile2 = await prisma.driverProfile.findUnique({ where: { userId: driverUser2.id } });
  if (!driverProfile2) {
    driverProfile2 = await prisma.driverProfile.create({
      data: {
        userId: driverUser2.id,
        licenseNo: 'MH1420210067890',
        emergencyPhone: '+919876500002',
        notes: 'New driver, training completed',
      },
    });
  }

  console.log('✅ Driver profiles created (independent)');
  console.log(`   Driver 1: ${driverProfile1.id} (${driverUser1.name})`);
  console.log(`   Driver 2: ${driverProfile2.id} (${driverUser2.name})\n`);

  // ── 5. Create Trucks ──────────────────────────────────────────────
  let truck1 = await prisma.truck.findFirst({ where: { number: 'MH14AB1234' } });
  if (!truck1) {
    truck1 = await prisma.truck.create({
      data: { orgId: sourceOrg.id, number: 'MH14AB1234', type: 'MINI_TRUCK', capacity: 2000 },
    });
  }

  let truck2 = await prisma.truck.findFirst({ where: { number: 'MH14CD5678' } });
  if (!truck2) {
    truck2 = await prisma.truck.create({
      data: { orgId: sourceOrg.id, number: 'MH14CD5678', type: 'LARGE_TRUCK', capacity: 5000 },
    });
  }

  console.log('✅ Trucks created');
  console.log(`   Truck 1: ${truck1.number} (${truck1.type})`);
  console.log(`   Truck 2: ${truck2.number} (${truck2.type})\n`);

  // ── 6. Create Item Master (Vegetables & Fruits) ────────────────────
  const items = [
    { name: 'Tomato', nameHindi: 'टमाटर', category: 'Vegetable', defaultUnit: QuantityUnit.CRATE },
    { name: 'Onion', nameHindi: 'प्याज', category: 'Vegetable', defaultUnit: QuantityUnit.BAG },
    { name: 'Potato', nameHindi: 'आलू', category: 'Vegetable', defaultUnit: QuantityUnit.QUINTAL },
    { name: 'Green Apple', nameHindi: 'हरा सेब', category: 'Fruit', defaultUnit: QuantityUnit.BOX },
    { name: 'Kinnaur Apple', nameHindi: 'किन्नौर सेब', category: 'Fruit', defaultUnit: QuantityUnit.BOX },
    { name: 'Banana', nameHindi: 'केला', category: 'Fruit', defaultUnit: QuantityUnit.DOZEN },
    { name: 'Cabbage', nameHindi: 'पत्तागोभी', category: 'Vegetable', defaultUnit: QuantityUnit.KG },
    { name: 'Cauliflower', nameHindi: 'फूलगोभी', category: 'Vegetable', defaultUnit: QuantityUnit.PIECE },
    { name: 'Spinach', nameHindi: 'पालक', category: 'Vegetable', defaultUnit: QuantityUnit.BUNDLE },
    { name: 'Grapes', nameHindi: 'अंगूर', category: 'Fruit', defaultUnit: QuantityUnit.CRATE },
  ];

  const createdItems: Record<string, any> = {};
  for (const itemData of items) {
    const item = await prisma.item.upsert({
      where: { orgId_name: { orgId: sourceOrg.id, name: itemData.name } },
      update: {},
      create: { orgId: sourceOrg.id, ...itemData },
    });
    createdItems[itemData.name] = item;
  }

  console.log(`✅ Item Master created (${items.length} items)\n`);

  // ── 7. Create Trip 1: IN_TRANSIT (Multi-item: Tomato + Onion + Potato) ──
  let trip1 = await prisma.trip.findFirst({
    where: { sourceOrgId: sourceOrg.id, destinationOrgId: destOrg.id, status: TripStatus.IN_TRANSIT },
  });

  if (!trip1) {
    trip1 = await prisma.trip.create({
      data: {
        sourceOrgId: sourceOrg.id,
        destinationOrgId: destOrg.id,
        truckId: truck1.id,
        driverId: driverProfile1.id,
        startPoint: 'Nashik Market Yard',
        endPoint: 'APMC Navi Mumbai',
        startTime: new Date(Date.now() - 2 * 60 * 60 * 1000), // Started 2 hours ago
        estimatedDistance: 167.5,
        estimatedArrival: new Date(Date.now() + 2 * 60 * 60 * 1000), // ETA 2 hours
        status: TripStatus.IN_TRANSIT,
        notes: 'Mixed vegetables shipment to Mumbai',
      },
    });

    // Create load card with multiple items
    const loadCard1 = await prisma.tripLoadCard.create({
      data: {
        tripId: trip1.id,
        loadedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        remarks: 'All items loaded properly, quality checked',
        totalItems: 3,
        totalQuantity: 185, // 50 crates + 100 bags + 35 quintals
        totalAmount: 125000, // ₹1,25,000
        createdByUserId: mahajan1.id,
      },
    });

    // Add load items
    await prisma.loadItem.createMany({
      data: [
        {
          loadCardId: loadCard1.id,
          itemId: createdItems['Tomato'].id,
          itemName: 'Tomato',
          itemNameHindi: 'टमाटर',
          quantity: 50,
          unit: QuantityUnit.CRATE,
          rate: 800, // ₹800 per crate
          amount: 40000, // ₹40,000
          grade: 'A',
          remarks: 'Fresh, red tomatoes',
          sortOrder: 1,
        },
        {
          loadCardId: loadCard1.id,
          itemId: createdItems['Onion'].id,
          itemName: 'Onion',
          itemNameHindi: 'प्याज',
          quantity: 100,
          unit: QuantityUnit.BAG,
          rate: 500, // ₹500 per bag
          amount: 50000, // ₹50,000
          grade: 'A',
          remarks: 'Medium size onions',
          sortOrder: 2,
        },
        {
          loadCardId: loadCard1.id,
          itemId: createdItems['Potato'].id,
          itemName: 'Potato',
          itemNameHindi: 'आलू',
          quantity: 35,
          unit: QuantityUnit.QUINTAL,
          rate: 1000, // ₹1000 per quintal
          amount: 35000, // ₹35,000
          grade: 'Regular',
          remarks: 'Local variety',
          sortOrder: 3,
        },
      ],
    });

    // Create trip events
    await prisma.tripEvent.createMany({
      data: [
        {
          tripId: trip1.id,
          eventType: 'TRIP_CREATED',
          description: 'Trip created',
          atTime: new Date(Date.now() - 3 * 60 * 60 * 1000),
          createdByUserId: mahajan1.id,
        },
        {
          tripId: trip1.id,
          eventType: 'ASSIGNED',
          description: `Assigned to driver ${driverUser1.name}`,
          atTime: new Date(Date.now() - 2.5 * 60 * 60 * 1000),
          createdByUserId: mahajan1.id,
        },
        {
          tripId: trip1.id,
          eventType: 'LOAD_COMPLETED',
          description: 'Loading completed: 50 crates tomato, 100 bags onion, 35 quintals potato',
          atTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
          createdByUserId: mahajan1.id,
        },
        {
          tripId: trip1.id,
          eventType: 'IN_TRANSIT',
          description: 'Trip started from Nashik',
          atTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
          createdByUserId: driverUser1.id,
        },
      ],
    });

    console.log(`✅ Trip 1 created (IN_TRANSIT): ${trip1.id}`);
    console.log(`   Route: Nashik → Mumbai`);
    console.log(`   Items: Tomato (50 crates), Onion (100 bags), Potato (35 quintals)`);
    console.log(`   Total Value: ₹1,25,000\n`);

    // ── 7.5 Create Chat Thread & Messages ─────────────────────────────
    let thread = await prisma.chatThread.findFirst({
      where: { orgId: sourceOrg.id, tripId: trip1.id },
    });

    if (!thread) {
      thread = await prisma.chatThread.create({
        data: {
          orgId: sourceOrg.id,
          tripId: trip1.id,
          title: `Trip #${trip1.id.substring(0, 6)}`,
          // Removed participants as it's not a direct relation on ChatThread
        },
      });

      // Add messages
      await prisma.chatMessage.createMany({
        data: [
          {
            threadId: thread.id,
            senderUserId: mahajan1.id, // Agastya
            messageType: ChatMessageType.TEXT,
            content: 'Truck has left Nashik. Driver Ramu is carrying the goods.',
            createdAt: new Date(Date.now() - 1.5 * 60 * 60 * 1000),
          },
          {
            threadId: thread.id,
            senderUserId: mahajan2.id, // Javed
            messageType: ChatMessageType.TEXT,
            content: 'Okay Agastya bhai. I will inform my team to be ready for unloading.',
            createdAt: new Date(Date.now() - 1.4 * 60 * 60 * 1000),
          },
          {
            threadId: thread.id,
            senderUserId: mahajan1.id, // Agastya (Simulated Audio)
            messageType: ChatMessageType.AUDIO,
            content: '',
            metadata: { duration: 15, key: 'mock-audio-key.m4a' }, // Mock metadata
            createdAt: new Date(Date.now() - 1.2 * 60 * 60 * 1000),
          },
          {
            threadId: thread.id,
            senderUserId: mahajan2.id, // Javed
            messageType: ChatMessageType.TEXT,
            content: 'Received your voice note. Got it.',
            createdAt: new Date(Date.now() - 1.1 * 60 * 60 * 1000),
          }
        ],
      });

      console.log('✅ Chat thread & messages created for Trip 1');
    }
  }

  // ── 8. Create Trip 2: CREATED (Pending Assignment - Fruits) ──────
  let trip2 = await prisma.trip.findFirst({
    where: { sourceOrgId: sourceOrg.id, destinationOrgId: destOrg.id, status: TripStatus.CREATED },
  });

  if (!trip2) {
    trip2 = await prisma.trip.create({
      data: {
        sourceOrgId: sourceOrg.id,
        destinationOrgId: destOrg.id,
        truckId: truck2.id,
        startPoint: 'Nashik Market Yard',
        endPoint: 'APMC Navi Mumbai',
        status: TripStatus.CREATED,
        notes: 'Apple shipment - pending driver assignment',
      },
    });

    await prisma.tripEvent.create({
      data: {
        tripId: trip2.id,
        eventType: 'TRIP_CREATED',
        description: 'Trip created, awaiting driver assignment',
        createdByUserId: mahajan1.id,
      },
    });

    console.log(`✅ Trip 2 created (CREATED): ${trip2.id}`);
    console.log(`   Status: Awaiting driver assignment\n`);
  }

  // ── 9. Create Trip 3: LOADED (Ready to Depart) ─────────────────────
  let trip3 = await prisma.trip.findFirst({
    where: { sourceOrgId: sourceOrg.id, destinationOrgId: destOrg.id, status: TripStatus.LOADED },
  });

  if (!trip3) {
    trip3 = await prisma.trip.create({
      data: {
        sourceOrgId: sourceOrg.id,
        destinationOrgId: destOrg.id,
        truckId: truck2.id,
        driverId: driverProfile2.id,
        startPoint: 'Nashik Market Yard',
        endPoint: 'APMC Navi Mumbai',
        status: TripStatus.LOADED,
        notes: 'Grapes and Apples - Ready to depart',
      },
    });

    const loadCard3 = await prisma.tripLoadCard.create({
      data: {
        tripId: trip3.id,
        remarks: 'Premium fruits loaded with care',
        totalItems: 2,
        totalQuantity: 80,
        totalAmount: 240000, // ₹2,40,000
        createdByUserId: mahajan1.id,
      },
    });

    await prisma.loadItem.createMany({
      data: [
        {
          loadCardId: loadCard3.id,
          itemId: createdItems['Kinnaur Apple'].id,
          itemName: 'Kinnaur Apple',
          itemNameHindi: 'किन्नौर सेब',
          quantity: 50,
          unit: QuantityUnit.BOX,
          rate: 4000, // ₹4000 per box
          amount: 200000,
          grade: 'Premium',
          remarks: 'Export quality Kinnaur apples',
          sortOrder: 1,
        },
        {
          loadCardId: loadCard3.id,
          itemId: createdItems['Grapes'].id,
          itemName: 'Grapes',
          itemNameHindi: 'अंगूर',
          quantity: 30,
          unit: QuantityUnit.CRATE,
          rate: 1333.33,
          amount: 40000,
          grade: 'A',
          remarks: 'Nashik grapes, seedless variety',
          sortOrder: 2,
        },
      ],
    });

    console.log(`✅ Trip 3 created (LOADED): ${trip3.id}`);
    console.log(`   Items: Kinnaur Apple (50 boxes), Grapes (30 crates)`);
    console.log(`   Total Value: ₹2,40,000\n`);
  }

  // ── 10. Create Trip 4: DELIVERED (Pending Confirmation) ────────────
  let trip4 = await prisma.trip.findFirst({
    where: { sourceOrgId: sourceOrg.id, destinationOrgId: destOrg.id, status: TripStatus.DELIVERED },
  });

  if (!trip4) {
    trip4 = await prisma.trip.create({
      data: {
        sourceOrgId: sourceOrg.id,
        destinationOrgId: destOrg.id,
        truckId: truck1.id,
        driverId: driverProfile1.id,
        startPoint: 'Nashik Market Yard',
        endPoint: 'APMC Navi Mumbai',
        startTime: new Date(Date.now() - 24 * 60 * 60 * 1000), // Yesterday
        estimatedDistance: 167.5,
        status: TripStatus.DELIVERED,
        notes: 'Delivered - Pending receiver confirmation',
      },
    });

    const loadCard4 = await prisma.tripLoadCard.create({
      data: {
        tripId: trip4.id,
        loadedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        remarks: 'Cabbage and Spinach',
        totalItems: 2,
        totalQuantity: 550,
        totalAmount: 27500,
        createdByUserId: mahajan1.id,
      },
    });

    await prisma.loadItem.createMany({
      data: [
        {
          loadCardId: loadCard4.id,
          itemId: createdItems['Cabbage'].id,
          itemName: 'Cabbage',
          itemNameHindi: 'पत्तागोभी',
          quantity: 500,
          unit: QuantityUnit.KG,
          rate: 40, // ₹40 per kg
          amount: 20000,
          grade: 'A',
          sortOrder: 1,
        },
        {
          loadCardId: loadCard4.id,
          itemId: createdItems['Spinach'].id,
          itemName: 'Spinach',
          itemNameHindi: 'पालक',
          quantity: 50,
          unit: QuantityUnit.BUNDLE,
          rate: 150, // ₹150 per bundle
          amount: 7500,
          grade: 'Fresh',
          sortOrder: 2,
        },
      ],
    });

    // Fetch the load items for receive card
    const loadItemsCreated = await prisma.loadItem.findMany({
      where: { loadCardId: loadCard4.id },
      orderBy: { sortOrder: 'asc' },
    });

    // Create receive card (with slight shortage)
    const receiveCard4 = await prisma.tripReceiveCard.create({
      data: {
        tripId: trip4.id,
        receivedAt: new Date(Date.now() - 20 * 60 * 60 * 1000), // 20 hours ago
        remarks: 'Minor shortage in Cabbage',
        totalItems: 2,
        totalQuantity: 540, // 490 + 50
        totalAmount: 27100, // 19600 + 7500
        totalShortage: 10, // 10 kg cabbage shortage
        shortagePercent: 1.82,
        status: 'PENDING',
        createdByUserId: driverUser1.id,
      },
    });

    // Create receive items linked to load items
    await prisma.receiveItem.createMany({
      data: [
        {
          receiveCardId: receiveCard4.id,
          loadItemId: loadItemsCreated[0].id,
          itemId: createdItems['Cabbage'].id,
          itemName: 'Cabbage',
          itemNameHindi: 'पत्तागोभी',
          quantity: 490, // 10kg shortage
          unit: QuantityUnit.KG,
          shortage: 10,
          shortagePercent: 2,
          rate: 40,
          amount: 19600,
          grade: 'A',
          remarks: '10kg shortage due to handling',
          sortOrder: 1,
        },
        {
          receiveCardId: receiveCard4.id,
          loadItemId: loadItemsCreated[1].id,
          itemId: createdItems['Spinach'].id,
          itemName: 'Spinach',
          itemNameHindi: 'पालक',
          quantity: 50,
          unit: QuantityUnit.BUNDLE,
          shortage: 0,
          shortagePercent: 0,
          rate: 150,
          amount: 7500,
          grade: 'Fresh',
          sortOrder: 2,
        },
      ],
    });

    console.log(`✅ Trip 4 created (DELIVERED): ${trip4.id}`);
    console.log(`   Items: Cabbage (490/500 kg), Spinach (50/50 bundles)`);
    console.log(`   Shortage: 10 kg (1.82%)\n`);
  }

  // ── 11. Create Ledger Accounts (Khata) ─────────────────────────────
  let ownerAccount = await prisma.account.findUnique({
    where: { ownerOrgId_counterpartyOrgId: { ownerOrgId: sourceOrg.id, counterpartyOrgId: destOrg.id } },
  });

  if (!ownerAccount) {
    ownerAccount = await prisma.account.create({
      data: {
        ownerOrgId: sourceOrg.id,
        counterpartyOrgId: destOrg.id,
        balance: 150000_00, // ₹1,50,000 in paise (receivable by source)
      },
    });

    // Create mirror account
    await prisma.account.create({
      data: {
        ownerOrgId: destOrg.id,
        counterpartyOrgId: sourceOrg.id,
        balance: -150000_00, // Mirror: payable by destination
      },
    });

    // Add ledger entries
    await prisma.ledgerEntry.createMany({
      data: [
        {
          accountId: ownerAccount.id,
          tripId: trip4!.id,
          direction: 'RECEIVABLE',
          amount: 27500_00,
          balance: 27500_00,
          description: 'Trip delivery - Cabbage & Spinach',
          tag: 'DUE',
        },
        {
          accountId: ownerAccount.id,
          direction: 'RECEIVABLE',
          amount: 125000_00,
          balance: 152500_00,
          description: 'Previous pending amount',
          tag: 'DUE',
        },
        {
          accountId: ownerAccount.id,
          direction: 'PAYABLE',
          amount: 2500_00,
          balance: 150000_00,
          description: 'Partial payment received',
          tag: 'PARTIAL',
        },
      ],
    });

    console.log('✅ Ledger accounts created');
    console.log(`   Balance: ₹1,50,000 (receivable by source)\n`);
  }

  // ── 12. Create Sample Location History for Trip 1 ─────────────────
  // Nashik to Mumbai route simulation (approx 50 points for 2 hours)
  const nashikToMumbaiRoute = generateRoutePoints(
    { lat: 19.9975, lng: 73.7898 }, // Nashik
    { lat: 19.0760, lng: 72.8777 }, // Mumbai
    50, // Number of points
    new Date(Date.now() - 2 * 60 * 60 * 1000), // Start time (2 hours ago)
    new Date() // Current time
  );

  // Delete existing locations for trip1 and create new ones
  await prisma.tripLocation.deleteMany({ where: { tripId: trip1!.id } });

  await prisma.tripLocation.createMany({
    data: nashikToMumbaiRoute.map((point, index) => ({
      tripId: trip1!.id,
      driverId: driverProfile1.id,
      lat: point.lat,
      lng: point.lng,
      speed: 40 + Math.random() * 30, // 40-70 km/h
      heading: calculateHeading(
        nashikToMumbaiRoute[Math.max(0, index - 1)],
        point
      ),
      accuracy: 10 + Math.random() * 20,
      capturedAt: point.timestamp,
      batchId: `batch_${index}_${Date.now()}`,
    })),
  });

  // Update latest location
  const latestPoint = nashikToMumbaiRoute[nashikToMumbaiRoute.length - 1];
  await prisma.tripLatestLocation.upsert({
    where: { tripId: trip1!.id },
    update: {
      lat: latestPoint.lat,
      lng: latestPoint.lng,
      speed: 55,
      heading: 225, // Southwest direction
      accuracy: 15,
      capturedAt: latestPoint.timestamp,
    },
    create: {
      tripId: trip1!.id,
      lat: latestPoint.lat,
      lng: latestPoint.lng,
      speed: 55,
      heading: 225,
      accuracy: 15,
      capturedAt: latestPoint.timestamp,
    },
  });

  console.log(`✅ Location history created for Trip 1 (${nashikToMumbaiRoute.length} points)\n`);

  // ── Summary ───────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🎉 Seed complete! OTP-only login (no passwords)');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('  📱 Login via OTP only - no passwords needed');
  console.log('');
  console.log('  👤 Users:');
  console.log(`    🔑 Agastya (Loader):        ${mahajan1.phone} ← Your account`);
  console.log(`    Javed (Receiver):           ${mahajan2.phone}`);
  console.log(`    Driver 1:                   ${driverUser1.phone}`);
  console.log(`    Driver 2:                   ${driverUser2.phone}`);
  console.log('');
  console.log('  🏢 Organizations:');
  console.log(`    Source: ${sourceOrg.name}`);
  console.log(`    Dest:   ${destOrg.name}`);
  console.log('');
  console.log('  🚚 Trips:');
  console.log(`    IN_TRANSIT: ${trip1?.id} (Tomato, Onion, Potato → Mumbai)`);
  console.log(`    CREATED:    ${trip2?.id} (Awaiting assignment)`);
  console.log(`    LOADED:     ${trip3?.id} (Apples, Grapes - Ready to depart)`);
  console.log(`    DELIVERED:  ${trip4?.id} (Cabbage, Spinach - Pending confirmation)`);
  console.log('');
  console.log('  💬 Chat Threads:');
  console.log(`    Trip 1: Messages seeded (inc. Audio)`);
  console.log('');
  console.log('  📍 Mock Location Simulator:');
  console.log(`    Start mock simulation: POST /api/dev/mock-location/start/${trip1?.id}`);
  console.log(`    Stop mock simulation:  POST /api/dev/mock-location/stop/${trip1?.id}`);
  console.log('');
  console.log('  💰 Ledger:');
  console.log(`    Balance: ₹1,50,000 receivable`);
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
}

// Helper: Generate route points between two coordinates
function generateRoutePoints(
  start: { lat: number; lng: number },
  end: { lat: number; lng: number },
  numPoints: number,
  startTime: Date,
  endTime: Date
): Array<{ lat: number; lng: number; timestamp: Date }> {
  const points: Array<{ lat: number; lng: number; timestamp: Date }> = [];
  const timeDiff = endTime.getTime() - startTime.getTime();

  for (let i = 0; i < numPoints; i++) {
    const progress = i / (numPoints - 1);

    // Add some randomness to simulate real GPS drift
    const jitter = 0.002;
    const randomLat = (Math.random() - 0.5) * jitter;
    const randomLng = (Math.random() - 0.5) * jitter;

    points.push({
      lat: start.lat + (end.lat - start.lat) * progress + randomLat,
      lng: start.lng + (end.lng - start.lng) * progress + randomLng,
      timestamp: new Date(startTime.getTime() + timeDiff * progress),
    });
  }

  return points;
}

// Helper: Calculate heading between two points
function calculateHeading(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): number {
  const dLng = to.lng - from.lng;
  const y = Math.sin(dLng) * Math.cos(to.lat);
  const x = Math.cos(from.lat) * Math.sin(to.lat) - Math.sin(from.lat) * Math.cos(to.lat) * Math.cos(dLng);
  const heading = Math.atan2(y, x) * (180 / Math.PI);
  return (heading + 360) % 360;
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
