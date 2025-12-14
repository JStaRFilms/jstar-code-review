// test/fixtures/cross-file/client-page.tsx
// Test File: Client Component importing server action (INVALID direct call)
// Expected: ProjectAnalyzer should flag SERVER_ACTION_IN_CLIENT

'use client';

import { useState } from 'react';
import { getUser, updateProfile } from './utils';  // ❌ These are server actions

export function ClientPage() {
    const [user, setUser] = useState(null);

    async function handleLoad() {
        // ❌ This is invalid - calling server action directly in client
        const userData = await getUser('123');
        setUser(userData);
    }

    return (
        <div>
            <button onClick={handleLoad}>Load User</button>
            {/* This is the CORRECT way to use server actions: */}
            <form action={updateProfile.bind(null, '123')}>
                <input name="name" />
                <button type="submit">Update</button>
            </form>
        </div>
    );
}
