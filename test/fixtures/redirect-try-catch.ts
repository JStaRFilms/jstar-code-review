// test/fixtures/redirect-try-catch.ts
// Test fixture: REDIRECT_IN_TRY_CATCH detection
// This file should trigger redirect in try-catch violation

import { redirect } from 'next/navigation';

export async function handleAuth() {
    try {
        // Some auth logic
        const isValid = await checkAuth();

        if (!isValid) {
            // ❌ BAD: redirect in try-catch
            redirect('/login');
        }
    } catch (error) {
        console.error(error);
    }
}

// ✅ GOOD: Redirect outside try-catch
export async function handleAuthCorrect() {
    let needsRedirect = false;

    try {
        const isValid = await checkAuth();
        needsRedirect = !isValid;
    } catch (error) {
        console.error(error);
    }

    if (needsRedirect) {
        redirect('/login');
    }
}

async function checkAuth() {
    return true;
}
