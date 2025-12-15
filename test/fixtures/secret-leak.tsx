"use client";
// test/fixtures/secret-leak.tsx
// Test fixture: SECRET_LEAK_CLIENT detection
// This file should trigger secret leak violation

export function Dashboard() {
    // ❌ BAD: Non-public env var in client
    const apiKey = process.env.DATABASE_URL;
    const secret = process.env.API_SECRET;

    // ✅ GOOD: Public env var
    const publicUrl = process.env.NEXT_PUBLIC_API_URL;

    return (
        <div>
            <p>API: {publicUrl}</p>
        </div>
    );
}
