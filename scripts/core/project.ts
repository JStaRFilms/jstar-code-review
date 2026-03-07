import * as fs from "fs";
import * as path from "path";

const SOURCE_DIR_CANDIDATES = ["src", "lib", "app", "scripts", "."];

const ALWAYS_IGNORED_DIRECTORIES = new Set([
    "node_modules",
    ".git",
    ".jstar",
    "coverage",
]);

const BUILD_DIRECTORIES = new Set([
    ".next",
    "dist",
    "build",
    "out",
]);

export const INDEX_EXCLUDED_PATTERNS = [
    /pnpm-lock\.yaml/i,
    /package-lock\.json/i,
    /yarn\.lock/i,
    /bun\.lockb?/i,
    /\.env/i,
    /\.DS_Store/i,
    /node_modules/i,
    /\.git/i,
    /\.jstar/i,
    /\.json$/i,
    /\.(png|jpg|jpeg|gif|svg|ico|webp|bmp|tiff)$/i,
];

export const REVIEW_EXCLUDED_PATTERNS = [
    /pnpm-lock\.yaml/i,
    /package-lock\.json/i,
    /yarn\.lock/i,
    /bun\.lockb?/i,
    /\.env/i,
    /\.json$/i,
    /\.txt$/i,
    /\.md$/i,
    /node_modules/i,
    /\.jstar\//i,
];

export function normalizeRelativePath(filePath: string, cwd = process.cwd()): string {
    const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
    return path.relative(cwd, resolved).replace(/\\/g, "/");
}

export function isCodeFile(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, "/");
    return /\.(?:[cm]?[jt]sx?)$/i.test(normalized) && !normalized.endsWith(".d.ts");
}

export function shouldIgnoreDirectory(dirName: string, includeBuildFiles = false): boolean {
    if (ALWAYS_IGNORED_DIRECTORIES.has(dirName)) {
        return true;
    }

    if (!includeBuildFiles && BUILD_DIRECTORIES.has(dirName)) {
        return true;
    }

    return false;
}

export function shouldExcludeFromIndexing(filePath: string): boolean {
    return INDEX_EXCLUDED_PATTERNS.some((pattern) => pattern.test(filePath));
}

export function shouldSkipReviewFile(filePath: string): boolean {
    return REVIEW_EXCLUDED_PATTERNS.some((pattern) => pattern.test(filePath));
}

export function getSourceDir(cwd = process.cwd(), args = process.argv.slice(2)): string {
    const pathArgIndex = args.indexOf("--path");
    if (pathArgIndex !== -1 && args[pathArgIndex + 1]) {
        const customPath = path.resolve(cwd, args[pathArgIndex + 1]);
        if (fs.existsSync(customPath)) {
            return customPath;
        }
        throw new Error(`Custom path not found: ${customPath}`);
    }

    for (const dir of SOURCE_DIR_CANDIDATES) {
        const fullPath = path.join(cwd, dir);
        if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
            continue;
        }

        if (
            dir === "." &&
            SOURCE_DIR_CANDIDATES
                .slice(0, -1)
                .some((candidate) => fs.existsSync(path.join(cwd, candidate)))
        ) {
            continue;
        }

        return fullPath;
    }

    return cwd;
}

export function walkProjectFiles(
    rootDir: string,
    options: { cwd?: string; includeBuildFiles?: boolean } = {},
): string[] {
    const cwd = options.cwd ?? process.cwd();
    const includeBuildFiles = options.includeBuildFiles ?? false;
    const files: string[] = [];

    function visit(currentDir: string) {
        if (!fs.existsSync(currentDir)) {
            return;
        }

        for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
            const fullPath = path.join(currentDir, entry.name);

            if (entry.isDirectory()) {
                if (shouldIgnoreDirectory(entry.name, includeBuildFiles)) {
                    continue;
                }
                visit(fullPath);
                continue;
            }

            const relativePath = normalizeRelativePath(fullPath, cwd);
            if (!isCodeFile(relativePath)) {
                continue;
            }
            files.push(relativePath);
        }
    }

    visit(rootDir);

    return files.sort((a, b) => a.localeCompare(b));
}
