// test/fixtures/cross-file/utils.ts
// Server-side utility with database access
// Used to test cross-file analysis

'use server';

import { db } from '@/lib/db';

export async function getUser(id: string) {
    // This is a server action that accesses the database
    const user = await db.query(`SELECT * FROM users WHERE id = $1`, [id]);
    return user;
}

export async function updateProfile(userId: string, data: { name: string }) {
    // Another server action
    await db.execute(`UPDATE users SET name = $1 WHERE id = $2`, [data.name, userId]);
    return { success: true };
}
