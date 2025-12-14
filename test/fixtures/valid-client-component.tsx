// test/fixtures/valid-client-component.tsx
// Test File: Valid Client Component (NO VIOLATIONS)
// Expected: Detective should find zero violations

'use client';

import { useState, useEffect } from 'react';

export function ValidClientComponent() {
    const [count, setCount] = useState(0);

    useEffect(() => {
        document.title = `Count: ${count}`;
    }, [count]);

    return (
        <div>
            <p>Count: {count}</p>
            <button onClick={() => setCount(c => c + 1)}>+1</button>
        </div>
    );
}
