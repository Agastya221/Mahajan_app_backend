
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();
const CONFIG = {
  baseUrl: 'http://localhost:3000/api/v1',
  userPhone: '919999999999',
  jwtSecret: process.env.JWT_SECRET || 'default-secret-if-missing'
};

async function runTests() {
  console.log('🚀 Starting Backend API Tests...');

  // 1. Setup Test User
  console.log('\n📝 Ensuring Test User Exists...');
  let user = await prisma.user.findUnique({ where: { phone: CONFIG.userPhone } });

  if (!user) {
    user = await prisma.user.create({
      data: {
        phone: CONFIG.userPhone,
        name: 'Test Automation User',
        role: 'MAHAJAN_STAFF',
      }
    });
    console.log(`✅ Created user: ${user.name}`);
  } else {
    console.log(`✅ User exists: ${user.name}`);
  }

  // 2. Generate Token
  console.log('\n🔑 Generating Access Token...');
  const token = jwt.sign(
    {
      userId: user.id,
      phone: user.phone,
      role: user.role,
      type: 'access'
    },
    CONFIG.jwtSecret,
    { expiresIn: '1h' }
  );
  console.log('✅ Token generated');

  const headers = { Authorization: `Bearer ${token}` };

  // 3. Test Endpoints
  const endpoints = [
    { name: 'Get Orgs', url: '/orgs', method: 'GET' },
    { name: 'Get Trips', url: '/trips', method: 'GET' },
    { name: 'Get Drivers', url: '/drivers', method: 'GET' },
    { name: 'Get Trucks', url: '/trucks', method: 'GET' },
    { name: 'Get Items', url: '/items', method: 'GET' },
    { name: 'Get Chat Threads', url: '/chat/threads', method: 'GET' },
    { name: 'Health Check', url: '', base: 'http://localhost:3000/health', method: 'GET' }
  ];

  for (const ep of endpoints) {
    const fullUrl = ep.base || `${CONFIG.baseUrl}${ep.url}`;
    try {
      console.log(`\nTesting ${ep.name} (${fullUrl})...`);
      const res = await axios({
        method: ep.method,
        url: fullUrl,
        headers: ep.base ? {} : headers
      });

      console.log(`✅ Success (${res.status}):`);
      if (Array.isArray(res.data.data)) {
        console.log(`   Count: ${res.data.data.length}`);
      } else {
        const keys = res.data.data ? Object.keys(res.data.data) : Object.keys(res.data);
        console.log(`   Response keys: ${keys.join(', ')}`);
      }
    } catch (error) {
      console.error(`❌ Failed (${error.response?.status || 'Network Error'}):`);
      if (error.response?.data) {
        console.error('   ', JSON.stringify(error.response.data));
      } else {
        console.error('   ', error.message);
      }
    }
  }

  // 4. Create Trip (Write Test)
  console.log('\n📝 Testing Trip Creation...');
  // We need an Org first
  try {
    const orgsRes = await axios.get(`${CONFIG.baseUrl}/orgs`, { headers });
    let orgId = orgsRes.data.data[0]?.id;

    if (!orgId) {
      // Create an Org
      console.log('   Creating generic org for testing...');
      const newOrgRes = await axios.post(`${CONFIG.baseUrl}/orgs`, {
        name: 'Test Transporters Inc',
        type: 'TRANSPORTER',
        address: '123 Test St'
      }, { headers });
      orgId = newOrgRes.data.data.id;
    }

    console.log('   (Skipping actual Trip Creation to avoid side effects, but Org flow worked)');

  } catch (err) {
    console.error('   Failed org setup for trip test:', err.message);
  }
}

runTests().catch(e => console.error(e)).finally(async () => {
  await prisma.$disconnect();
});
