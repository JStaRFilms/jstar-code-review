import { SimpleGit } from "simple-git";

export interface ReviewTarget {
    label: string;
    diff: string;
}

export function chunkDiffByFile(diff: string): string[] {
    return diff.split(/(?=^diff --git)/gm).filter(Boolean);
}

export function extractDiffFileNames(diff: string): string[] {
    const seen = new Set<string>();

    for (const chunk of chunkDiffByFile(diff)) {
        const match = chunk.match(/diff --git a\/(.+?) b\/(.+)/);
        const fileName = match?.[2] || match?.[1];
        if (fileName) {
            seen.add(fileName);
        }
    }

    return [...seen].sort((a, b) => a.localeCompare(b));
}

export async function getDefaultBranch(git: SimpleGit): Promise<string> {
    try {
        try {
            const remote = await git.remote(["show", "origin"]);
            if (typeof remote === "string") {
                const match = remote.match(/HEAD branch: (\S+)/);
                if (match) {
                    return match[1];
                }
            }
        } catch {
            // Fall through to local branch detection.
        }

        const branches = await git.branchLocal();
        if (branches.all.includes("main")) {
            return "main";
        }
        if (branches.all.includes("master")) {
            return "master";
        }
    } catch {
        // Fall back to main when git metadata is limited.
    }

    return "main";
}

export async function resolveReviewTarget(git: SimpleGit, args: string[]): Promise<ReviewTarget> {
    if (args.includes("--last")) {
        return {
            label: "Last Commit",
            diff: await git.diff(["HEAD~1", "HEAD"]),
        };
    }

    if (args.includes("--commit")) {
        const hashIndex = args.indexOf("--commit") + 1;
        if (hashIndex >= args.length) {
            throw new Error("Missing commit hash for --commit");
        }

        const hash = args[hashIndex];
        return {
            label: `Commit ${hash}`,
            diff: await git.diff([`${hash}~1`, `${hash}`]),
        };
    }

    if (args.includes("--range")) {
        const rangeIndex = args.indexOf("--range") + 1;
        if (rangeIndex + 1 >= args.length) {
            throw new Error("Missing arguments for --range (usage: --range <start> <end>)");
        }

        const start = args[rangeIndex];
        const end = args[rangeIndex + 1];
        return {
            label: `Range ${start}..${end}`,
            diff: await git.diff([start, end]),
        };
    }

    if (args.includes("--pr")) {
        const prIndex = args.indexOf("--pr");
        let baseBranch = "main";

        if (args.includes("--base")) {
            const baseIndex = args.indexOf("--base") + 1;
            if (baseIndex >= args.length) {
                throw new Error("Missing branch name for --base");
            }
            baseBranch = args[baseIndex];
        } else {
            const positionalBase = args[prIndex + 1];
            baseBranch = positionalBase && !positionalBase.startsWith("--")
                ? positionalBase
                : await getDefaultBranch(git);
        }

        try {
            return {
                label: `PR (HEAD vs ${baseBranch})`,
                diff: await git.diff([`${baseBranch}...HEAD`]),
            };
        } catch {
            throw new Error(`Failed to diff against ${baseBranch}. Does the branch exist?`);
        }
    }

    return {
        label: "Staged Changes",
        diff: await git.diff(["--staged"]),
    };
}
