// src/core/analysis/utils/package-parser.ts
// Utility to parse package.json and extract dependency information

import type { DependencyInfo } from '../types.js';

export interface PackageJson {
    name?: string;
    version?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
}

/**
 * Parse package.json content and extract dependency info.
 */
export function parsePackageJson(content: string): PackageJson {
    try {
        return JSON.parse(content) as PackageJson;
    } catch {
        console.warn('[Detective] Failed to parse package.json');
        return {};
    }
}

/**
 * Get all dependencies with version info.
 */
export function getAllDependencies(pkg: PackageJson): DependencyInfo[] {
    const deps: DependencyInfo[] = [];

    if (pkg.dependencies) {
        for (const [name, version] of Object.entries(pkg.dependencies)) {
            deps.push({ name, version, isDev: false });
        }
    }

    if (pkg.devDependencies) {
        for (const [name, version] of Object.entries(pkg.devDependencies)) {
            deps.push({ name, version, isDev: true });
        }
    }

    return deps;
}

/**
 * Check if a package exists in dependencies.
 */
export function hasDependency(pkg: PackageJson, packageName: string): boolean {
    return !!(pkg.dependencies?.[packageName] || pkg.devDependencies?.[packageName]);
}

/**
 * Get the version of a specific package.
 * Returns null if not found.
 */
export function getDependencyVersion(pkg: PackageJson, packageName: string): string | null {
    return pkg.dependencies?.[packageName] ?? pkg.devDependencies?.[packageName] ?? null;
}

/**
 * Parse a semver version string to extract major version.
 * Handles ^, ~, and exact versions.
 * Example: "^4.0.0" -> 4, "~2.3.1" -> 2, "1.0.0" -> 1
 */
export function parseMajorVersion(versionString: string): number | null {
    // Remove ^, ~, >=, etc.
    const cleaned = versionString.replace(/^[\^~>=<]+/, '');
    const match = cleaned.match(/^(\d+)/);
    return match ? parseInt(match[1], 10) : null;
}

/**
 * Detect framework from dependencies.
 */
export function detectFramework(pkg: PackageJson): 'nextjs-app' | 'nextjs-pages' | 'react' | 'node' | 'unknown' {
    // Check for Next.js
    if (hasDependency(pkg, 'next')) {
        const nextVersion = getDependencyVersion(pkg, 'next');
        if (nextVersion) {
            const major = parseMajorVersion(nextVersion);
            // Next.js 13+ with app router (we'll refine this based on file structure)
            if (major && major >= 13) {
                return 'nextjs-app'; // Default to app router for 13+
            }
            return 'nextjs-pages';
        }
        return 'nextjs-pages';
    }

    // Check for React (without Next.js)
    if (hasDependency(pkg, 'react')) {
        return 'react';
    }

    // Check for Node.js indicators
    if (hasDependency(pkg, 'express') || hasDependency(pkg, 'fastify') || hasDependency(pkg, 'koa')) {
        return 'node';
    }

    return 'unknown';
}

/**
 * Get version-specific API hints for common packages.
 * This prevents the LLM from hallucinating deprecated APIs.
 */
export function getApiHints(pkg: PackageJson): Map<string, string> {
    const hints = new Map<string, string>();

    // OpenAI SDK
    const openaiVersion = getDependencyVersion(pkg, 'openai');
    if (openaiVersion) {
        const major = parseMajorVersion(openaiVersion);
        if (major && major >= 4) {
            hints.set('openai', 'v4+ API: Use `openai.chat.completions.create()`, NOT `openai.createChatCompletion()`. For images, use `url` not `image_url`.');
        } else {
            hints.set('openai', 'v3 API: Use `openai.createChatCompletion()`.');
        }
    }

    // React Query / TanStack Query
    const reactQueryVersion = getDependencyVersion(pkg, '@tanstack/react-query') ?? getDependencyVersion(pkg, 'react-query');
    if (reactQueryVersion) {
        const major = parseMajorVersion(reactQueryVersion);
        if (major && major >= 5) {
            hints.set('react-query', 'v5+ API: `useQuery({ queryKey, queryFn })` object syntax. No more array-first signature.');
        } else if (major === 4) {
            hints.set('react-query', 'v4 API: `useQuery({ queryKey: [...], queryFn })` object syntax.');
        }
    }

    // Prisma
    const prismaVersion = getDependencyVersion(pkg, '@prisma/client');
    if (prismaVersion) {
        const major = parseMajorVersion(prismaVersion);
        if (major && major >= 5) {
            hints.set('prisma', 'v5+ API: JSON fields are native. `@db.JsonB` no longer needed for Postgres.');
        }
    }

    // Zod
    const zodVersion = getDependencyVersion(pkg, 'zod');
    if (zodVersion) {
        const major = parseMajorVersion(zodVersion);
        if (major && major >= 3) {
            hints.set('zod', 'v3 API: Use `z.infer<typeof Schema>` for type inference.');
        }
    }

    return hints;
}
