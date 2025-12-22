import { startInteractiveSession, startHeadlessSession } from "./session";
import {
    VectorStoreIndex,
    storageContextFromDefaults,
    serviceContextFromDefaults
} from "llamaindex";
import { GeminiEmbedding } from "./gemini-embedding";
import { MockLLM } from "./mock-llm";
import { Logger } from "./utils/logger";
import * as path from "path";
import * as fs from "fs";
import chalk from "chalk";
import { SessionState, DashboardReport } from "./types";
import { renderDashboard, determineStatus, generateRecommendation } from "./dashboard";

const STORAGE_DIR = path.join(process.cwd(), ".jstar", "storage");
const SESSION_FILE = path.join(process.cwd(), ".jstar", "session.json");
const OUTPUT_FILE = path.join(process.cwd(), ".jstar", "last-review.md");

const embedModel = new GeminiEmbedding();
const llm = new MockLLM();
const serviceContext = serviceContextFromDefaults({ embedModel, llm: llm as any });

async function loadSession(): Promise<SessionState | null> {
    try {
        const content = fs.readFileSync(SESSION_FILE, 'utf-8');
        return JSON.parse(content);
    } catch (e: any) {
        if (e.code === 'ENOENT') {
            return null; // File doesn't exist
        }
        Logger.error(`Failed to load session: ${e.message}`);
        return null;
    }
}

async function main() {
    // Initialize logger mode
    Logger.init();

    Logger.info(chalk.bold.magenta("\n💬 J-Star Chat: Resuming Session...\n"));

    // 1. Load Session
    const session = await loadSession();
    if (!session) {
        Logger.error(chalk.red("❌ No active session found."));
        Logger.info(chalk.yellow("Run 'jstar review' first to analyze the codebase."));
        return;
    }

    Logger.info(chalk.dim(`   📅 Loaded session from: ${session.date}`));
    Logger.info(chalk.dim(`   🔍 Loaded ${session.findings.reduce((acc, f) => acc + f.issues.length, 0)} issues.`));

    // 2. Load Brain (Fast)
    if (!fs.existsSync(STORAGE_DIR)) {
        Logger.error(chalk.red("❌ Local Brain not found. Run 'pnpm index:init' first."));
        return;
    }
    const storageContext = await storageContextFromDefaults({ persistDir: STORAGE_DIR });
    const index = await VectorStoreIndex.init({ storageContext, serviceContext });

    // 3. Start Chat (Headless or Interactive)
    let updatedFindings;
    let hasUpdates;

    if (Logger.isHeadless()) {
        // Headless mode: stdin/stdout JSON protocol
        const result = await startHeadlessSession(session.findings, index);
        updatedFindings = result.updatedFindings;
        hasUpdates = result.hasUpdates;
    } else {
        // Normal TUI mode
        const result = await startInteractiveSession(session.findings, index);
        updatedFindings = result.updatedFindings;
        hasUpdates = result.hasUpdates;
    }

    // 4. Update Session & Report if changed
    if (hasUpdates) {
        Logger.info(chalk.blue("\n🔄 Updating Session & Dashboard..."));

        // Recalculate metrics based on new findings
        const newMetrics = {
            ...session.metrics, // keep files/tokens same
            violations: updatedFindings.reduce((sum, f) => sum + f.issues.length, 0),
            critical: updatedFindings.filter(f => f.severity === 'P0_CRITICAL').length,
            high: updatedFindings.filter(f => f.severity === 'P1_HIGH').length,
            medium: updatedFindings.filter(f => f.severity === 'P2_MEDIUM').length,
            lgtm: updatedFindings.filter(f => f.severity === 'LGTM').length,
        };

        // Save Session
        const newSession: SessionState = {
            date: new Date().toISOString().split('T')[0],
            findings: updatedFindings,
            metrics: newMetrics
        };

        try {
            fs.writeFileSync(SESSION_FILE, JSON.stringify(newSession, null, 2));
        } catch (err: any) {
            Logger.error(`Failed to save session: ${err.message}`);
            return;
        }

        // Save Dashboard
        const report: DashboardReport = {
            date: newSession.date,
            reviewer: 'J-Star Chat',
            status: determineStatus(newMetrics),
            metrics: newMetrics,
            findings: updatedFindings,
            recommendedAction: generateRecommendation(newMetrics)
        };
        const dashboard = renderDashboard(report);

        try {
            fs.writeFileSync(OUTPUT_FILE, dashboard);
        } catch (err: any) {
            Logger.error(`Failed to save dashboard: ${err.message}`);
            return;
        }

        Logger.info(chalk.bold.green("✅ Saved."));
    } else {
        Logger.info(chalk.dim("   No changes made."));
    }
}

main().catch(console.error);
