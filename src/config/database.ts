import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from './env';

const adapter = new PrismaPg({ connectionString: config.database.url });

const prisma = new PrismaClient({
  adapter,
  log: config.nodeEnv === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

export default prisma;
