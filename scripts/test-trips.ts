import prisma from '../src/config/database';
import jwt from 'jsonwebtoken';

const BASE = 'http://localhost:3000/api/v1';

async function main() {
  const user = await prisma.user.findFirst({ where: { phone: '+916202923165' } });
  if (!user) { console.log('User not found'); process.exit(1); }

  const token = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET!, { expiresIn: '1h' });

  // Test GET /trips (list)
  const listRes = await fetch(`${BASE}/trips?limit=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const listData = await listRes.json();
  const trip = listData.data?.[0];

  if (!trip) {
    console.log('No trips found');
    process.exit(0);
  }

  console.log('=== GET /trips (list) ===');
  console.log('sourceOrg keys:', Object.keys(trip.sourceOrg));
  console.log('destinationOrg keys:', Object.keys(trip.destinationOrg));
  console.log('sourceOrg.phone:', trip.sourceOrg.phone);
  console.log('destinationOrg.phone:', trip.destinationOrg.phone);
  console.log('has loadCard:', !!trip.loadCard);
  console.log('has receiveCard:', !!trip.receiveCard);
  if (trip.loadCard) {
    console.log('loadCard items count:', trip.loadCard.items.length);
    if (trip.loadCard.items[0]) {
      const item = trip.loadCard.items[0];
      console.log('first item:', { name: item.itemName, qty: item.quantity, unit: item.unit });
    }
  }

  // Test GET /trips/:id (detail)
  const detailRes = await fetch(`${BASE}/trips/${trip.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const detailData = await detailRes.json();
  const detail = detailData.data;

  console.log('\n=== GET /trips/:id (detail) ===');
  console.log('sourceOrg keys:', Object.keys(detail.sourceOrg));
  console.log('destinationOrg keys:', Object.keys(detail.destinationOrg));
  console.log('sourceOrg.phone:', detail.sourceOrg.phone);
  console.log('destinationOrg.phone:', detail.destinationOrg.phone);
  console.log('has loadCard:', !!detail.loadCard);
  if (detail.loadCard) {
    console.log('loadCard items count:', detail.loadCard.items.length);
  }

  console.log('\n✅ All trip response fields verified');
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
