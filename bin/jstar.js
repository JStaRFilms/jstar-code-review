#!/usr/bin/env node
/**
 * J-Star Reviewer CLI
 * Global command-line tool for AI-powered code review
 * 
 * Usage:
 *   jstar init     - Index the current directory
 *   jstar review   - Review staged changes
 *   jstar setup    - Set up config in current project
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const COLORS = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    red: '\x1b[31m',
    dim: '\x1b[2m',
    bold: '\x1b[1m'
};

function log(msg) {
    console.log(msg);
}

function printHelp() {
    log(`
${COLORS.bold}🌟 J-Star Reviewer v2${COLORS.reset}

${COLORS.dim}AI-powered code review with local embeddings${COLORS.reset}

${COLORS.bold}USAGE:${COLORS.reset}
  jstar <command> [options]

${COLORS.bold}COMMANDS:${COLORS.reset}
  ${COLORS.green}init${COLORS.reset}      Index the current codebase (build the brain)
  ${COLORS.green}review${COLORS.reset}    Review staged git changes
  ${COLORS.green}setup${COLORS.reset}     Create .env.example and .jstar/ in current directory

${COLORS.bold}EXAMPLES:${COLORS.reset}
  ${COLORS.dim}# First time setup${COLORS.reset}
  jstar init

  ${COLORS.dim}# Review staged changes${COLORS.reset}
  git add .
  jstar review

${COLORS.bold}ENVIRONMENT:${COLORS.reset}
  GOOGLE_API_KEY    Required for Gemini embeddings
  GROQ_API_KEY      Required for Groq LLM reviews

${COLORS.dim}Report issues: https://github.com/JStaRFilms/jstar-code-review${COLORS.reset}
`);
}

/**
 * Check if a command exists
 */
function commandExists(cmd) {
    try {
        execSync(process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`, { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

function runScript(scriptName) {
    // Look for transpiled files in dist/
    // .ts becomes .js in dist
    const jsName = scriptName.replace('.ts', '.js');
    const distDir = path.join(__dirname, '..', 'dist', 'scripts');
    const jsPath = path.join(distDir, jsName);

    // Fallback for local development if dist doesn't exist
    const scriptsDir = path.join(__dirname, '..', 'scripts');
    const tsPath = path.join(scriptsDir, scriptName);

    const isWin = process.platform === 'win32';

    if (fs.existsSync(jsPath)) {
        log(`${COLORS.dim}Running ${jsName}...${COLORS.reset}`);
        const child = spawn('node', [jsPath, ...process.argv.slice(3)], {
            cwd: process.cwd(),
            stdio: 'inherit',
            shell: isWin,
            env: {
                ...process.env,
                JSTAR_CWD: process.cwd()
            }
        });

        child.on('close', (code) => process.exit(code || 0));
        child.on('error', (err) => {
            log(`${COLORS.red}Error running script: ${err.message}${COLORS.reset}`);
            process.exit(1);
        });
        return;
    }

    if (!fs.existsSync(tsPath)) {
        log(`${COLORS.red}Error: Script not found: ${scriptPath}${COLORS.reset}`);
        process.exit(1);
    }

    // Fallback to ts-node if dist is not built (mostly for local development)
    const hasPnpm = commandExists('pnpm');
    const runner = hasPnpm ? 'pnpm' : 'npx';
    const runnerArgs = hasPnpm ? ['dlx', 'ts-node'] : ['ts-node'];

    log(`${COLORS.dim}Using ${runner} (fallback) to run ${scriptName}...${COLORS.reset}`);

    const child = spawn(runner, [...runnerArgs, tsPath, ...process.argv.slice(3)], {
        cwd: process.cwd(),
        stdio: 'inherit',
        shell: isWin,
        env: {
            ...process.env,
            JSTAR_CWD: process.cwd()
        }
    });

    child.on('close', (code) => {
        process.exit(code || 0);
    });

    child.on('error', (err) => {
        log(`${COLORS.red}Error running script: ${err.message}${COLORS.reset}`);
        process.exit(1);
    });
}

function createSetupFiles() {
    const cwd = process.cwd();

    // Create .jstar directory
    const jstarDir = path.join(cwd, '.jstar');
    if (!fs.existsSync(jstarDir)) {
        fs.mkdirSync(jstarDir, { recursive: true });
        log(`${COLORS.green}✓${COLORS.reset} Created .jstar/`);
    }

    // Create .env.example
    const envExample = `# J-Star Reviewer Configuration
# Copy this to .env.local and fill in your keys

# Required: Google API key for Gemini embeddings
GOOGLE_API_KEY=your_google_api_key_here

# Required: Groq API key for LLM reviews
GROQ_API_KEY=your_groq_api_key_here
`;

    const envPath = path.join(cwd, '.env.example');
    if (!fs.existsSync(envPath)) {
        fs.writeFileSync(envPath, envExample);
        log(`${COLORS.green}✓${COLORS.reset} Created .env.example`);
    } else {
        log(`${COLORS.dim}  .env.example already exists${COLORS.reset}`);
    }

    // Update .gitignore
    const gitignorePath = path.join(cwd, '.gitignore');
    const gitignoreAdditions = `
# J-Star Reviewer
.jstar/
.env.local
`;

    if (fs.existsSync(gitignorePath)) {
        const content = fs.readFileSync(gitignorePath, 'utf-8');
        if (!content.includes('.jstar/')) {
            fs.appendFileSync(gitignorePath, gitignoreAdditions);
            log(`${COLORS.green}✓${COLORS.reset} Updated .gitignore`);
        }
    } else {
        fs.writeFileSync(gitignorePath, gitignoreAdditions.trim());
        log(`${COLORS.green}✓${COLORS.reset} Created .gitignore`);
    }

    log(`
${COLORS.bold}Next steps:${COLORS.reset}
  1. Copy .env.example to .env.local
  2. Add your API keys
  3. Run: jstar init
  4. Stage changes and run: jstar review
`);
}

// Main
const command = process.argv[2];

switch (command) {
    case 'init':
        runScript('indexer.ts');
        break;
    case 'review':
        runScript('reviewer.ts');
        break;
    case 'setup':
        createSetupFiles();
        break;
    case '--help':
    case '-h':
    case undefined:
        printHelp();
        break;
    default:
        log(`${COLORS.red}Unknown command: ${command}${COLORS.reset}`);
        printHelp();
        process.exit(1);
}
