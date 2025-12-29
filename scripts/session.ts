import { FileFinding, ReviewIssue } from "./types";
import { showActionMenu, askForArgument } from "./ui/interaction";
import { debateIssue } from "./core/debate";
import { VectorStoreIndex } from "llamaindex";
import { Logger } from "./utils/logger";
import chalk from "chalk";
import prompts from "prompts";
import * as readline from "readline";

export async function startInteractiveSession(
    findings: FileFinding[],
    index: VectorStoreIndex
): Promise<{ updatedFindings: FileFinding[], hasUpdates: boolean }> {

    // Deep clone to track local state without mutating original immediately (though we return updated findings)
    const interactiveFindings: FileFinding[] = JSON.parse(JSON.stringify(findings));
    let hasUpdates = false;
    let active = true;

    if (interactiveFindings.length === 0 || interactiveFindings.every(f => f.issues.length === 0)) {
        return { updatedFindings: interactiveFindings, hasUpdates: false };
    }

    Logger.info(chalk.bold.magenta("\n🗣️  Interactive Review Session"));
    Logger.dim("   Use arrow keys to navigate. Select an issue to debate.");

    while (active) {
        // Re-calculate choices every loop to reflect status changes
        // Flatten
        const flatIssues: {
            issue: ReviewIssue,
            fileIndex: number,
            issueIndex: number,
            file: string
        }[] = [];

        interactiveFindings.forEach((f, fIdx) => {
            f.issues.forEach((i, iIdx) => {
                flatIssues.push({
                    issue: i,
                    fileIndex: fIdx,
                    issueIndex: iIdx,
                    file: f.file
                });
            });
        });

        const choices = flatIssues.map((item, idx) => {
            const i = item.issue;
            const statusIcon = i.status === 'resolved' ? '✅ ' : i.status === 'ignored' ? '🗑️ ' : '';
            return {
                title: `${statusIcon}${i.confidenceScore ? `[${i.confidenceScore}/5] ` : ''}${i.title} ${chalk.dim(`(${item.file})`)}`,
                value: idx,
                description: i.status ? `Marked as ${i.status}` : i.description.slice(0, 80)
            };
        });

        choices.push({ title: '🚪 Finish Review', value: -1, description: 'Exit and save report' });

        const { selectedIdx } = await prompts({
            type: 'select',
            name: 'selectedIdx',
            message: 'Select an issue:',
            choices: choices,
            initial: 0
        });

        if (selectedIdx === undefined || selectedIdx === -1) {
            active = false;
            break;
        }

        const selected = flatIssues[selectedIdx];
        const { issue, file } = selected;

        // Show Details
        Logger.info(chalk.cyan(`\nTitle: ${issue.title}`));
        Logger.info(chalk.white(issue.description));
        Logger.dim(`File: ${file}`);
        if (issue.confidenceScore) Logger.info(chalk.yellow(`Confidence: ${issue.confidenceScore}/5`));
        if (issue.status) Logger.success(`Status: ${issue.status}`);

        // Action Menu
        const action = await showActionMenu(issue.title);

        if (action === 'discuss') {
            const argument = await askForArgument();
            const result = await debateIssue(
                issue.title,
                issue.description,
                file,
                argument,
                index
            );

            Logger.info(chalk.yellow(`\n🤖 Bot: ${result.text}`));

            if (result.severity === 'LGTM') {
                Logger.success("✅ Issue withdrawn by AI!");
                // Direct update to our state
                interactiveFindings[selected.fileIndex].issues[selected.issueIndex].status = 'resolved';
                hasUpdates = true;
            }

        } else if (action === 'ignore') {
            Logger.dim('Issue ignored locally.');
            interactiveFindings[selected.fileIndex].issues[selected.issueIndex].status = 'ignored';
            hasUpdates = true;
        } else if (action === 'accept') {
            Logger.success('Issue accepted.');
        } else if (action === 'exit') {
            active = false;
        }
    }

    // Filter out resolved/ignored issues for the final report
    const finalFindings: FileFinding[] = interactiveFindings.map(f => ({
        ...f,
        issues: f.issues.filter(i => i.status !== 'resolved' && i.status !== 'ignored')
    })).filter(f => f.issues.length > 0);

    return { updatedFindings: finalFindings, hasUpdates };
}

/**
 * Headless interface for flatIssues structure
 */
interface FlatIssue {
    id: number;
    title: string;
    description: string;
    file: string;
    confidenceScore?: number;
    status?: 'resolved' | 'ignored';
    fileIndex: number;
    issueIndex: number;
}

/**
 * Headless command protocol
 */
interface HeadlessCommand {
    action: 'list' | 'debate' | 'ignore' | 'accept' | 'exit';
    issueId?: number;
    argument?: string;
}

/**
 * Flatten findings into a simple array for headless mode
 */
function flattenIssues(findings: FileFinding[]): FlatIssue[] {
    const flat: FlatIssue[] = [];
    findings.forEach((f, fIdx) => {
        f.issues.forEach((i, iIdx) => {
            flat.push({
                id: flat.length,
                title: i.title,
                description: i.description,
                file: f.file,
                confidenceScore: i.confidenceScore,
                status: i.status,
                fileIndex: fIdx,
                issueIndex: iIdx
            });
        });
    });
    return flat;
}

/**
 * Headless session for AI agents and CI/CD.
 * 
 * Protocol:
 * - Input (stdin): JSON commands, one per line
 *   { "action": "list" }
 *   { "action": "debate", "issueId": 0, "argument": "This is intentional" }
 *   { "action": "ignore", "issueId": 0 }
 *   { "action": "accept", "issueId": 0 }
 *   { "action": "exit" }
 * 
 * - Output (stdout): JSON events, one per line
 *   { "type": "ready", "issues": [...] }
 *   { "type": "list", "issues": [...] }
 *   { "type": "response", "issueId": 0, "text": "...", "verdict": "LGTM" | "STANDS" }
 *   { "type": "update", "issueId": 0, "status": "ignored" | "resolved" | "accepted" }
 *   { "type": "error", "message": "..." }
 *   { "type": "done", "hasUpdates": true, "updatedFindings": [...] }
 */
export async function startHeadlessSession(
    findings: FileFinding[],
    index: VectorStoreIndex
): Promise<{ updatedFindings: FileFinding[], hasUpdates: boolean }> {

    // Deep clone to track state
    const sessionFindings: FileFinding[] = JSON.parse(JSON.stringify(findings));
    let hasUpdates = false;

    // Emit ready event with all issues
    const issues = flattenIssues(sessionFindings);
    Logger.json({ type: 'ready', issues });

    // Create readline interface for stdin
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false
    });

    // Process commands
    for await (const line of rl) {
        if (!line.trim()) continue;

        let cmd: HeadlessCommand;
        try {
            cmd = JSON.parse(line);
        } catch (e) {
            Logger.json({ type: 'error', message: 'Invalid JSON command' });
            continue;
        }

        const currentIssues = flattenIssues(sessionFindings);

        switch (cmd.action) {
            case 'list':
                Logger.json({ type: 'list', issues: currentIssues });
                break;

            case 'debate':
                if (cmd.issueId === undefined || !cmd.argument) {
                    Logger.json({ type: 'error', message: 'debate requires issueId and argument' });
                    break;
                }
                const debateTarget = currentIssues.find(i => i.id === cmd.issueId);
                if (!debateTarget) {
                    Logger.json({ type: 'error', message: `Issue ${cmd.issueId} not found` });
                    break;
                }

                try {
                    const result = await debateIssue(
                        debateTarget.title,
                        debateTarget.description,
                        debateTarget.file,
                        cmd.argument,
                        index
                    );

                    const verdict = result.severity === 'LGTM' ? 'LGTM' : 'STANDS';
                    Logger.json({
                        type: 'response',
                        issueId: cmd.issueId,
                        text: result.text,
                        verdict
                    });

                    if (result.severity === 'LGTM') {
                        sessionFindings[debateTarget.fileIndex].issues[debateTarget.issueIndex].status = 'resolved';
                        hasUpdates = true;
                        Logger.json({ type: 'update', issueId: cmd.issueId, status: 'resolved' });
                    }
                } catch (e: any) {
                    Logger.json({ type: 'error', message: e.message });
                }
                break;

            case 'ignore':
                if (cmd.issueId === undefined) {
                    Logger.json({ type: 'error', message: 'ignore requires issueId' });
                    break;
                }
                const ignoreTarget = currentIssues.find(i => i.id === cmd.issueId);
                if (!ignoreTarget) {
                    Logger.json({ type: 'error', message: `Issue ${cmd.issueId} not found` });
                    break;
                }
                sessionFindings[ignoreTarget.fileIndex].issues[ignoreTarget.issueIndex].status = 'ignored';
                hasUpdates = true;
                Logger.json({ type: 'update', issueId: cmd.issueId, status: 'ignored' });
                break;

            case 'accept':
                if (cmd.issueId === undefined) {
                    Logger.json({ type: 'error', message: 'accept requires issueId' });
                    break;
                }
                Logger.json({ type: 'update', issueId: cmd.issueId, status: 'accepted' });
                break;

            case 'exit':
                // Filter out resolved/ignored for final report
                const finalFindings: FileFinding[] = sessionFindings.map(f => ({
                    ...f,
                    issues: f.issues.filter(i => i.status !== 'resolved' && i.status !== 'ignored')
                })).filter(f => f.issues.length > 0);

                Logger.json({ type: 'done', hasUpdates, updatedFindings: finalFindings });
                rl.close();
                return { updatedFindings: finalFindings, hasUpdates };

            default:
                Logger.json({ type: 'error', message: `Unknown action: ${(cmd as any).action}` });
        }
    }

    // If stdin closes without exit command, still return
    const finalFindings: FileFinding[] = sessionFindings.map(f => ({
        ...f,
        issues: f.issues.filter(i => i.status !== 'resolved' && i.status !== 'ignored')
    })).filter(f => f.issues.length > 0);

    return { updatedFindings: finalFindings, hasUpdates };
}
