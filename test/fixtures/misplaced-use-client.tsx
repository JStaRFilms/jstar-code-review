import { useState } from "react";

"use client";

export function MisplacedUseClient() {
    const [count, setCount] = useState(0);
    return <button onClick={() => setCount(count + 1)}>{count}</button>;
}
