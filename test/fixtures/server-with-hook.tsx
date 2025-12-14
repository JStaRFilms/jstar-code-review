// test/fixtures/server-with-hook.tsx
// Test File: Server Component using client hooks (INVALID)
// Expected: Detective should flag CLIENT_HOOK_IN_SERVER violation

import { db } from '@/lib/db';
import { useState, useEffect } from 'react';  // ❌ Invalid in Server Component

export default async function ServerPage() {
    const [count, setCount] = useState(0);  // ❌ Detective should catch this

    useEffect(() => {  // ❌ Detective should catch this
        console.log('Effect ran');
    }, []);

    const data = await db.query('SELECT * FROM users');

    return (
        <div>
            <h1>Server Component</h1>
            <p>Count: {count}</p>
            <button onClick={() => setCount(c => c + 1)}>Increment</button>
        </div>
    );
}
