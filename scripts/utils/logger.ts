import chalk from 'chalk';

/**
 * Logger Utility
 * Centralizes all CLI output to support both human-readable (TTY) and machine-readable (JSON) modes.
 * 
 * Usage:
 *   Logger.init(); // Auto-detects --json flag
 *   Logger.info("Starting..."); // Suppressed in JSON mode
 *   Logger.json({ status: "ok" }); // Only outputs in JSON mode
 */

let jsonMode = false;

export const Logger = {
    /**
     * Initialize the logger.
     * Auto-detects --json or --headless flags from process.argv.
     */
    init() {
        jsonMode = process.argv.includes('--json') || process.argv.includes('--headless');
    },

    /**
     * Check if we are in headless/JSON mode.
     */
    isHeadless() {
        return jsonMode;
    },

    /**
     * Alias for isHeadless for backwards compatibility.
     */
    isJsonMode() {
        return jsonMode;
    },

    /**
     * Standard informational message (suppressed in JSON mode).
     */
    info(message: string) {
        if (!jsonMode) {
            console.log(message);
        }
    },

    /**
     * Success message with green styling (suppressed in JSON mode).
     */
    success(message: string) {
        if (!jsonMode) {
            console.log(chalk.green(message));
        }
    },

    /**
     * Warning message with yellow styling (suppressed in JSON mode).
     */
    warn(message: string) {
        if (!jsonMode) {
            console.log(chalk.yellow(message));
        }
    },

    /**
     * Error message - always outputs to stderr.
     */
    error(message: string) {
        console.error(chalk.red(message));
    },

    /**
     * Dim/faded message for secondary info (suppressed in JSON mode).
     */
    dim(message: string) {
        if (!jsonMode) {
            console.log(chalk.dim(message));
        }
    },

    /**
     * Write inline (no newline) for progress indicators (suppressed in JSON mode).
     * Alias: progress()
     */
    inline(message: string) {
        if (!jsonMode) {
            process.stdout.write(message);
        }
    },

    /**
     * Progress indicator - writes inline without newline.
     */
    progress(message: string) {
        if (!jsonMode) {
            process.stdout.write(message);
        }
    },

    /**
     * Output structured JSON to stdout.
     * Only outputs in JSON mode. For API/AI consumption.
     */
    json(data: object) {
        if (jsonMode) {
            console.log(JSON.stringify(data, null, 2));
        }
    },

    /**
     * Output a single-line JSON object (for streaming events).
     */
    jsonLine(data: object) {
        if (jsonMode) {
            console.log(JSON.stringify(data));
        }
    }
};
