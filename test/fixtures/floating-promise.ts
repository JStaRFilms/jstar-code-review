// test/fixtures/floating-promise.ts
// Test fixture: FLOATING_PROMISE detection
// This file should trigger FLOATING_PROMISE violation

import { prisma } from './db';

export async function createUser(name: string) {
    // ❌ BAD: Floating promise - not awaited
    prisma.user.create({ data: { name } });

    // ✅ GOOD: These should NOT trigger
    const user = await prisma.user.create({ data: { name } });
    return prisma.user.findUnique({ where: { id: user.id } });
}

export async function fetchData() {
    // ❌ BAD: fetch without await
    fetch('/api/data');

    // ✅ GOOD
    const response = await fetch('/api/data');
    return response.json();
}
