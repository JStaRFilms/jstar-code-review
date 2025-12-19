import dotenv from "dotenv";
import { Severity } from "./types";

// Load .env.local first, then .env
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Default fallback values.
 * These are intentional fallbacks when environment variables are not configured.
 * Override via REVIEW_MODEL_NAME env var for production use.
 */
const DEFAULT_MODEL = "moonshotai/kimi-k2-instruct-0905";

export const Config = {
    MODEL_NAME: process.env.REVIEW_MODEL_NAME || DEFAULT_MODEL,
    DEFAULT_SEVERITY: 'P2_MEDIUM' as Severity,
    THRESHOLDS: {
        MEDIUM: 5
    }
};
