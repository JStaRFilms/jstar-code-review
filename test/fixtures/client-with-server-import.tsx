// test/fixtures/client-with-server-import.tsx
// Test File: Client Component importing server-only module (INVALID)
// Expected: Detective should flag SERVER_ONLY_IN_CLIENT violation

'use client';

import { headers } from 'next/headers';  // ❌ Invalid in Client Component
import { useState } from 'react';

export function ClientComponent() {
    const [value, setValue] = useState('');

    // This will crash at runtime - headers() is server-only
    const requestHeaders = headers();

    return (
        <div>
            <input value={value} onChange={(e) => setValue(e.target.value)} />
            <p>User-Agent: {requestHeaders.get('user-agent')}</p>
        </div>
    );
}
