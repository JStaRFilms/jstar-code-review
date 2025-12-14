// test/fixtures/route-with-default-export.ts
// Test File: Route Handler using export default (INVALID for App Router)
// Expected: Detective should flag WRONG_EXPORT_PATTERN violation

import { NextResponse } from 'next/server';

// ❌ Route handlers should use named exports (GET, POST, etc.)
export default async function handler(request: Request) {
    return NextResponse.json({ message: 'Hello' });
}

// ✅ This is the correct pattern:
// export async function GET(request: Request) {
//   return NextResponse.json({ message: 'Hello' });
// }
