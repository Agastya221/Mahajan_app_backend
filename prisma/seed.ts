import 'dotenv/config';
import { UserRole, OrgMemberRole, TripStatus, QuantityUnit } from '@prisma/client';
import bcrypt from 'bcryptjs';
import prisma from '../src/config/database';

async function main() {
  console.log('🌱 Seeding database...\n');

  // ── 1. Create Users ──────────────────────────────────────────────
  const BCRYPT_ROUNDS = 12;
  const defaultPassword = await bcrypt.hash('Test@1234', BCRYPT_ROUNDS);

  const mahajanOwner1 = await prisma.user.upsert({
    where: { phone: '+919876543210' },
    update: {},
    create: {
      phone: '+919876543210',
      name: 'Rajesh Mahajan',
      role: UserRole.MAHAJAN_OWNER,
      passwordHash: defaultPassword,
      status: 'ACTIVE',
    },
  });

  const mahajanOwner2 = await prisma.user.upsert({
    where: { phone: '+919876543211' },
    update: {},
    create: {
      phone: '+919876543211',
      name: 'Suresh Mahajan',
      role: UserRole.MAHAJAN_OWNER,
      passwordHash: defaultPassword,
      status: 'ACTIVE',
    },
  });

  const staffUser = await prisma.user.upsert({
    where: { phone: '+919876543212' },
    update: {},
    create: {
      phone: '+919876543212',
      name: 'Amit Staff',
      role: UserRole.MAHAJAN_STAFF,
      passwordHash: defaultPassword,
      status: 'ACTIVE',
    },
  });

  const driverUser = await prisma.user.upsert({
    where: { phone: '+919876543213' },
    update: {},
    create: {
      phone: '+919876543213',
      name: 'Ramu Driver',
      role: UserRole.DRIVER,
      passwordHash: defaultPassword,
      status: 'ACTIVE',
    },
  });

  console.log('✅ Users created');
  console.log(`   Mahajan Owner 1: ${mahajanOwner1.phone} (password: Test@1234)`);
  console.log(`   Mahajan Owner 2: ${mahajanOwner2.phone} (password: Test@1234)`);
  console.log(`   Staff:           ${staffUser.phone} (password: Test@1234)`);
  console.log(`   Driver:          ${driverUser.phone} (password: Test@1234)\n`);

  // ── 2. Create Organizations ───────────────────────────────────────
  const sourceOrg = await prisma.org.upsert({
    where: { gstin: '27AABCU9603R1ZM' },
    update: {},
    create: {
      name: 'Rajesh Vegetables (Nashik)',
      city: 'Nashik',
      phone: '+919876543210',
      address: 'Market Yard, Nashik, Maharashtra',
      gstin: '27AABCU9603R1ZM',
      roleType: 'SOURCE_COLLECTOR',
    },
  });

  const destOrg = await prisma.org.upsert({
    where: { gstin: '27AABCU9603R2ZN' },
    update: {},
    create: {
      name: 'Suresh Vegetables (Mumbai)',
      city: 'Mumbai',
      phone: '+919876543211',
      address: 'APMC Market, Navi Mumbai, Maharashtra',
      gstin: '27AABCU9603R2ZN',
      roleType: 'DESTINATION_DISTRIBUTOR',
    },
  });

  console.log('✅ Organizations created');
  console.log(`   Source: ${sourceOrg.name} (${sourceOrg.id})`);
  console.log(`   Destination: ${destOrg.name} (${destOrg.id})\n`);

  // ── 3. Create Org Memberships ─────────────────────────────────────
  await prisma.orgMember.upsert({
    where: { orgId_userId: { orgId: sourceOrg.id, userId: mahajanOwner1.id } },
    update: {},
    create: {
      orgId: sourceOrg.id,
      userId: mahajanOwner1.id,
      role: OrgMemberRole.OWNER,
    },
  });

  await prisma.orgMember.upsert({
    where: { orgId_userId: { orgId: sourceOrg.id, userId: staffUser.id } },
    update: {},
    create: {
      orgId: sourceOrg.id,
      userId: staffUser.id,
      role: OrgMemberRole.STAFF,
    },
  });

  await prisma.orgMember.upsert({
    where: { orgId_userId: { orgId: destOrg.id, userId: mahajanOwner2.id } },
    update: {},
    create: {
      orgId: destOrg.id,
      userId: mahajanOwner2.id,
      role: OrgMemberRole.OWNER,
    },
  });

  console.log('✅ Org memberships created\n');

  // ── 4. Create Driver Profile ──────────────────────────────────────
  let driverProfile = await prisma.driverProfile.findUnique({
    where: { userId: driverUser.id },
  });

  if (!driverProfile) {
    driverProfile = await prisma.driverProfile.create({
      data: {
        userId: driverUser.id,
        orgId: sourceOrg.id,
        licenseNo: 'MH1420210012345',
      },
    });
  }

  // Add driver as org member
  await prisma.orgMember.upsert({
    where: { orgId_userId: { orgId: sourceOrg.id, userId: driverUser.id } },
    update: {},
    create: {
      orgId: sourceOrg.id,
      userId: driverUser.id,
      role: OrgMemberRole.STAFF,
    },
  });

  console.log(`✅ Driver profile created (${driverProfile.id})\n`);

  // ── 5. Create Trucks ──────────────────────────────────────────────
  let truck = await prisma.truck.findFirst({
    where: { orgId: sourceOrg.id, number: 'MH14AB1234' },
  });

  if (!truck) {
    truck = await prisma.truck.create({
      data: {
        orgId: sourceOrg.id,
        number: 'MH14AB1234',
        type: 'MINI_TRUCK',
        capacity: 2000, // 2 ton
      },
    });
  }

  console.log(`✅ Truck created (${truck.number})\n`);

  // ── 6. Create a Trip (IN_TRANSIT) ─────────────────────────────────
  let trip = await prisma.trip.findFirst({
    where: {
      sourceOrgId: sourceOrg.id,
      destinationOrgId: destOrg.id,
      status: TripStatus.IN_TRANSIT,
    },
  });

  if (!trip) {
    trip = await prisma.trip.create({
      data: {
        sourceOrgId: sourceOrg.id,
        destinationOrgId: destOrg.id,
        truckId: truck.id,
        driverId: driverProfile.id,
        startPoint: 'Nashik Market Yard',
        endPoint: 'APMC Navi Mumbai',
        estimatedDistance: 167.5,
        estimatedArrival: new Date(Date.now() + 4 * 60 * 60 * 1000), // 4 hours from now
        status: TripStatus.IN_TRANSIT,
        notes: 'Tomatoes and onions shipment',
      },
    });

    // Create load card for the trip
    await prisma.tripLoadCard.create({
      data: {
        tripId: trip.id,
        quantity: 1500,
        unit: QuantityUnit.KG,
        remarks: '1500 KG tomatoes loaded',
        createdByUserId: mahajanOwner1.id,
      },
    });

    console.log(`✅ Trip created (IN_TRANSIT): ${trip.id}`);
    console.log(`   Route: Nashik → Mumbai`);
    console.log(`   Load: 1500 KG tomatoes\n`);
  } else {
    console.log(`✅ Trip already exists (IN_TRANSIT): ${trip.id}\n`);
  }

  // ── 7. Create a second trip (CREATED - for testing status flow) ──
  let trip2 = await prisma.trip.findFirst({
    where: {
      sourceOrgId: sourceOrg.id,
      destinationOrgId: destOrg.id,
      status: TripStatus.CREATED,
    },
  });

  if (!trip2) {
    trip2 = await prisma.trip.create({
      data: {
        sourceOrgId: sourceOrg.id,
        destinationOrgId: destOrg.id,
        truckId: truck.id,
        driverId: driverProfile.id,
        startPoint: 'Nashik Market Yard',
        endPoint: 'APMC Navi Mumbai',
        status: TripStatus.CREATED,
        notes: 'Onions shipment - pending loading',
      },
    });

    console.log(`✅ Trip 2 created (CREATED): ${trip2.id}\n`);
  }

  // ── 8. Create Ledger Accounts (Khata) ─────────────────────────────
  let ownerAccount = await prisma.account.findUnique({
    where: {
      ownerOrgId_counterpartyOrgId: {
        ownerOrgId: sourceOrg.id,
        counterpartyOrgId: destOrg.id,
      },
    },
  });

  if (!ownerAccount) {
    ownerAccount = await prisma.account.create({
      data: {
        ownerOrgId: sourceOrg.id,
        counterpartyOrgId: destOrg.id,
        balance: 50000_00, // ₹50,000 in paise
      },
    });

    // Create mirror account
    await prisma.account.create({
      data: {
        ownerOrgId: destOrg.id,
        counterpartyOrgId: sourceOrg.id,
        balance: -50000_00, // Mirror: negative
      },
    });

    console.log('✅ Ledger accounts created (₹50,000 balance)\n');
  } else {
    console.log(`✅ Ledger accounts already exist\n`);
  }

  // ── Summary ───────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════');
  console.log('🎉 Seed complete! Test credentials:');
  console.log('═══════════════════════════════════════════════════');
  console.log('');
  console.log('  All passwords: Test@1234');
  console.log('');
  console.log('  Users:');
  console.log(`    Mahajan Owner 1 (Source):  ${mahajanOwner1.phone}`);
  console.log(`    Mahajan Owner 2 (Dest):    ${mahajanOwner2.phone}`);
  console.log(`    Staff:                     ${staffUser.phone}`);
  console.log(`    Driver:                    ${driverUser.phone}`);
  console.log('');
  console.log('  Organizations:');
  console.log(`    Source: ${sourceOrg.name} (ID: ${sourceOrg.id})`);
  console.log(`    Dest:   ${destOrg.name} (ID: ${destOrg.id})`);
  console.log('');
  console.log('  Trip (IN_TRANSIT):');
  console.log(`    ID: ${trip.id}`);
  console.log(`    Driver: ${driverUser.name} (Profile: ${driverProfile.id})`);
  console.log(`    Truck: ${truck.number} (ID: ${truck.id})`);
  console.log('');
  console.log('  Ledger Account:');
  console.log(`    ID: ${ownerAccount.id}`);
  console.log(`    Balance: ₹${(Number(ownerAccount.balance) / 100).toFixed(2)}`);
  console.log('');
  console.log('═══════════════════════════════════════════════════');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
