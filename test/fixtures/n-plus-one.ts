// test/fixtures/n-plus-one.ts
// Test fixture: N_PLUS_ONE_WATERFALL detection
// This file should trigger N+1 violation

import { prisma } from './db';

export async function getOrderDetails(userIds: string[]) {
    // ❌ BAD: N+1 query in map
    const orders = userIds.map(async (id) => {
        return prisma.order.findMany({ where: { userId: id } });
    });

    return Promise.all(orders);
}

export async function processUsers(users: any[]) {
    // ❌ BAD: N+1 query in for...of
    for (const user of users) {
        await prisma.user.update({ where: { id: user.id }, data: user });
    }
}

// ✅ GOOD: Batch query
export async function getOrdersBatch(userIds: string[]) {
    return prisma.order.findMany({ where: { userId: { in: userIds } } });
}
