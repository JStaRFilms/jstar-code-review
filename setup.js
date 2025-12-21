#!/usr/bin/env node
/**
 * J-Star Code Reviewer - One-Curl Setup Script
 * 
 * Usage:
 *   npx jstar-reviewer init
 *   
 * Or curl:
 *   curl -fsSL https://raw.githubusercontent.com/YOUR_REPO/main/setup.js | node
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const COLORS = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    red: '\x1b[31m',
    dim: '\x1b[2m'
};

const log = {
    info: (msg) => console.log(`${COLORS.blue}ℹ${COLORS.reset} ${msg}`),
    success: (msg) => console.log(`${COLORS.green}✓${COLORS.reset} ${msg}`),
    warn: (msg) => console.log(`${COLORS.yellow}⚠${COLORS.reset} ${msg}`),
    error: (msg) => console.log(`${COLORS.red}✗${COLORS.reset} ${msg}`),
    step: (msg) => console.log(`${COLORS.dim}  →${COLORS.reset} ${msg}`)
};

// Files to copy from the J-Star repo
const SCRIPT_FILES = [
    'scripts/reviewer.ts',
    'scripts/indexer.ts',
    'scripts/detective.ts',
    'scripts/dashboard.ts',
    'scripts/gemini-embedding.ts',
    'scripts/mock-llm.ts',
    'scripts/types.ts',
    'scripts/config.ts'
];

const DEPENDENCIES = {
    "ai": "^4.0.0",
    "@ai-sdk/groq": "^1.0.0",
    "@ai-sdk/google": "^1.0.0",
    "@google/generative-ai": "^0.24.0",
    "chalk": "^4.1.2",
    "dotenv": "^16.0.0",
    "llamaindex": "^0.1.21",
    "simple-git": "^3.20.0"
};

const DEV_DEPENDENCIES = {
    "ts-node": "^10.9.0",
    "typescript": "^5.0.0",
    "@types/node": "^20.0.0"
};

const SCRIPTS = {
    "review": "ts-node scripts/reviewer.ts",
    "index:init": "ts-node scripts/indexer.ts --init"
};

const ENV_EXAMPLE = `# J-Star Code Reviewer Configuration
# Copy this to .env.local and fill in your keys

# Required: Google API key for Gemini embeddings
GOOGLE_API_KEY=your_google_api_key_here

# Required: Groq API key for LLM reviews
GROQ_API_KEY=your_groq_api_key_here

# Optional: Override the default model
# REVIEW_MODEL_NAME=moonshotai/kimi-k2-instruct-0905
`;

const GITIGNORE_ADDITIONS = `
# J-Star Code Reviewer
.jstar/
.env.local
`;

async function main() {
    console.log('\n🌟 J-Star Code Reviewer Setup\n');

    // 0. Check Node.js version (fetch requires Node 18+)
    const nodeVersion = parseInt(process.versions.node.split('.')[0], 10);
    const hasFetch = typeof globalThis.fetch === 'function';

    if (nodeVersion < 18) {
        log.warn(`Node.js ${process.versions.node} detected. Recommend Node 18+ for native fetch.`);
    }

    const cwd = process.cwd();

    // 1. Check if package.json exists
    const pkgPath = path.join(cwd, 'package.json');
    if (!fs.existsSync(pkgPath)) {
        log.error('No package.json found. Run this in a Node.js project.');
        process.exit(1);
    }

    // 2. Create scripts/ directory
    const scriptsDir = path.join(cwd, 'scripts');
    if (!fs.existsSync(scriptsDir)) {
        fs.mkdirSync(scriptsDir, { recursive: true });
        log.success('Created scripts/ directory');
    }

    // 3. Download/copy script files with security validation
    log.info('Downloading reviewer scripts...');

    // HARDCODED: Tagged release URL - NOT configurable for security
    // To update, modify this constant and publish a new version of setup.js
    const BASE_URL = 'https://raw.githubusercontent.com/JStaRFilms/jstar-code-review/v2.1.0';

    // Validate URL matches our exact expected pattern (defense in depth)
    function isValidUrl(url) {
        // Only allow URLs that start with our exact base URL
        return url.startsWith(BASE_URL + '/scripts/');
    }

    // Allowed file extensions whitelist
    const ALLOWED_EXTENSIONS = ['.ts', '.js', '.json', '.md', '.txt'];

    // Enhanced path safety check
    function isSafePath(filePath) {
        // 1. Reject null bytes (common injection attack)
        if (filePath.includes('\0')) {
            log.error('Path contains null byte - rejected');
            return false;
        }

        // 2. Reject absolute paths
        if (path.isAbsolute(filePath)) {
            log.error('Absolute paths not allowed - rejected');
            return false;
        }

        // 3. Normalize the path
        const normalized = path.normalize(filePath);

        // 4. Reject path traversal attempts
        if (normalized.includes('..')) {
            log.error('Path traversal detected - rejected');
            return false;
        }

        // 5. Must start with scripts/ directory
        if (!normalized.startsWith('scripts' + path.sep) && !normalized.startsWith('scripts/')) {
            log.error('Path must be within scripts/ directory - rejected');
            return false;
        }

        // 6. Resolve and verify path stays within scripts directory
        const scriptsDir = path.resolve(cwd, 'scripts');
        const resolvedPath = path.resolve(cwd, normalized);
        if (!resolvedPath.startsWith(scriptsDir)) {
            log.error('Resolved path escapes scripts/ boundary - rejected');
            return false;
        }

        // 7. Check file extension against whitelist
        const ext = path.extname(normalized).toLowerCase();
        if (!ALLOWED_EXTENSIONS.includes(ext)) {
            log.error(`Extension ${ext} not in whitelist ${ALLOWED_EXTENSIONS.join(', ')} - rejected`);
            return false;
        }

        return true;
    }

    // Secure download using native fetch (Node 18+) or https fallback
    async function downloadFile(url, destPath) {
        if (!isValidUrl(url)) {
            throw new Error(`Invalid URL: ${url}`);
        }

        // Use native fetch if available (Node 18+)
        if (hasFetch) {
            const response = await fetch(url, {
                headers: { 'User-Agent': 'jstar-reviewer-setup' },
                redirect: 'follow'
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const content = await response.text();
            fs.writeFileSync(destPath, content, 'utf-8');
        } else {
            // Fallback: Use Node.js https module for older versions
            const https = require('https');
            return new Promise((resolve, reject) => {
                const file = fs.createWriteStream(destPath);
                https.get(url, {
                    headers: { 'User-Agent': 'jstar-reviewer-setup' }
                }, (response) => {
                    // Handle redirects
                    if (response.statusCode === 301 || response.statusCode === 302) {
                        const redirectUrl = response.headers.location;
                        if (!isValidUrl(redirectUrl)) {
                            reject(new Error(`Invalid redirect URL: ${redirectUrl}`));
                            return;
                        }
                        https.get(redirectUrl, (res) => {
                            res.pipe(file);
                            file.on('finish', () => { file.close(); resolve(); });
                        }).on('error', reject);
                        return;
                    }

                    if (response.statusCode !== 200) {
                        reject(new Error(`HTTP ${response.statusCode}`));
                        return;
                    }

                    response.pipe(file);
                    file.on('finish', () => { file.close(); resolve(); });
                }).on('error', (err) => {
                    fs.unlink(destPath, () => { }); // Clean up partial file
                    reject(err);
                });
            });
        }
    }

    for (const file of SCRIPT_FILES) {
        // Validate file path before processing
        if (!isSafePath(file)) {
            log.error(`Unsafe file path rejected: ${file}`);
            continue;
        }

        const destPath = path.join(cwd, file);
        const dir = path.dirname(destPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        try {
            const url = `${BASE_URL}/${file}`;
            await downloadFile(url, destPath);
            log.step(`Downloaded ${file}`);
        } catch (e) {
            log.warn(`Could not download ${file}: ${e.message}`);
        }
    }

    // 4. Update package.json
    log.info('Updating package.json...');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

    pkg.scripts = { ...pkg.scripts, ...SCRIPTS };
    pkg.dependencies = { ...pkg.dependencies, ...DEPENDENCIES };
    pkg.devDependencies = { ...pkg.devDependencies, ...DEV_DEPENDENCIES };

    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
    log.success('Updated package.json with scripts and dependencies');

    // 5. Create .jstar directory
    const jstarDir = path.join(cwd, '.jstar');
    if (!fs.existsSync(jstarDir)) {
        fs.mkdirSync(jstarDir, { recursive: true });
        log.success('Created .jstar/ directory');
    }

    // 6. Update .env.example (intelligently merge, don't override)
    const envExamplePath = path.join(cwd, '.env.example');
    const REQUIRED_ENV_VARS = {
        'GOOGLE_API_KEY': '# Required: Google API key for Gemini embeddings\nGOOGLE_API_KEY=your_google_api_key_here',
        'GROQ_API_KEY': '# Required: Groq API key for LLM reviews\nGROQ_API_KEY=your_groq_api_key_here',
        'REVIEW_MODEL_NAME': '# Optional: Override the default model\n# REVIEW_MODEL_NAME=moonshotai/kimi-k2-instruct-0905'
    };

    if (fs.existsSync(envExamplePath)) {
        // File exists - intelligently append missing keys
        let existingContent = fs.readFileSync(envExamplePath, 'utf-8');
        let addedKeys = [];

        for (const [key, template] of Object.entries(REQUIRED_ENV_VARS)) {
            if (!existingContent.includes(key)) {
                existingContent += '\n' + template + '\n';
                addedKeys.push(key);
            }
        }

        if (addedKeys.length > 0) {
            // Add J-Star header if not present
            if (!existingContent.includes('J-Star')) {
                existingContent = existingContent.trimEnd() + '\n\n# J-Star Code Reviewer\n' +
                    addedKeys.map(k => REQUIRED_ENV_VARS[k]).join('\n') + '\n';
            }
            fs.writeFileSync(envExamplePath, existingContent);
            log.success(`Added missing env vars to .env.example: ${addedKeys.join(', ')}`);
        } else {
            log.step('.env.example already has all required keys');
        }
    } else {
        // Create fresh .env.example
        fs.writeFileSync(envExamplePath, ENV_EXAMPLE);
        log.success('Created .env.example');
    }

    // 7. Update .gitignore
    const gitignorePath = path.join(cwd, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
        const gitignore = fs.readFileSync(gitignorePath, 'utf-8');
        if (!gitignore.includes('.jstar/')) {
            fs.appendFileSync(gitignorePath, GITIGNORE_ADDITIONS);
            log.success('Updated .gitignore');
        }
    } else {
        fs.writeFileSync(gitignorePath, GITIGNORE_ADDITIONS.trim());
        log.success('Created .gitignore');
    }

    // 8. Install dependencies
    log.info('Installing dependencies...');
    try {
        // Hardcoded whitelist: lockfile -> package manager command
        const ALLOWED_PM = {
            'pnpm-lock.yaml': 'pnpm',
            'yarn.lock': 'yarn',
            'package-lock.json': 'npm'
        };

        // Detect package manager from lockfile
        let pm = 'npm'; // Default fallback
        for (const [lock, cmd] of Object.entries(ALLOWED_PM)) {
            if (fs.existsSync(path.join(cwd, lock))) {
                pm = cmd;
                break;
            }
        }

        // Validate package manager is one of expected values (security check)
        const ALLOWED_PACKAGE_MANAGERS = ['pnpm', 'yarn', 'npm'];
        if (!ALLOWED_PACKAGE_MANAGERS.includes(pm)) {
            throw new Error(`Invalid package manager detected: ${pm}`);
        }

        execSync(`${pm} install`, { stdio: 'inherit' });
        log.success('Dependencies installed');
    } catch (e) {
        log.warn('Could not auto-install dependencies. Run: pnpm install');
    }

    // Done!
    console.log('\n' + '─'.repeat(50));
    console.log('\n🎉 J-Star Code Reviewer installed!\n');
    console.log('Next steps:');
    console.log('  1. Copy .env.example to .env.local');
    console.log('  2. Add your GOOGLE_API_KEY and GROQ_API_KEY');
    console.log('  3. Run: pnpm run index:init');
    console.log('  4. Stage changes and run: pnpm run review');
    console.log('\n' + '─'.repeat(50) + '\n');
}

main().catch(console.error);
