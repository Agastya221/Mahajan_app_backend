import prisma from '../src/config/database';

async function check() {
    const org = await prisma.org.findFirst();
    console.log('Org Details and Address object:');
    console.dir(org, { depth: null });
}

check().finally(() => prisma.$disconnect());
