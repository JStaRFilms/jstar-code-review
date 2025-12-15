"use client";
// test/fixtures/toxic-args.tsx
// Test fixture: TOXIC_SERVER_ACTION_ARG detection
// This file should trigger toxic args violation

import { createEvent } from './actions';

export function EventForm() {
    const handleSubmit = () => {
        // ❌ BAD: Passing Date object to server action
        createEvent({
            title: 'Meeting',
            startDate: new Date(),
            metadata: new Map([['key', 'value']])
        });
    };

    // ✅ GOOD: Serializable data
    const handleCorrectSubmit = () => {
        createEvent({
            title: 'Meeting',
            startDate: new Date().toISOString(),
        });
    };

    return <button onClick={handleSubmit}>Create</button>;
}
