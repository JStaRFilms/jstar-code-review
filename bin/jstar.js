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
${COLORS.bold}🌟 J-Star Reviewer v2.4.4${COLORS.reset}

${COLORS.dim}AI-powered code review with local embeddings${COLORS.reset}

${COLORS.bold}USAGE:${COLORS.reset}
  jstar <command> [options]

${COLORS.bold}COMMANDS:${COLORS.reset}
  ${COLORS.green}init${COLORS.reset}      Index the current codebase (build the brain)
  ${COLORS.green}review${COLORS.reset}    Review staged git changes
  ${COLORS.green}chat${COLORS.reset}      Resume an interactive session from the last review
  ${COLORS.green}detect${COLORS.reset}    Run static analysis (Detective Engine)
  ${COLORS.green}setup${COLORS.reset}     Create .env.example and .jstar/ in current directory

${COLORS.bold}OPTIONS:${COLORS.reset}
  ${COLORS.yellow}--json${COLORS.reset}      Output machine-readable JSON (for CI/CD)
  ${COLORS.yellow}--headless${COLORS.reset}  Enable stdin/stdout protocol (for AI agents)
  ${COLORS.yellow}--all${COLORS.reset}       Scan all files (including build artifacts like .next) in 'detect' mode

${COLORS.bold}REVIEW OPTIONS:${COLORS.reset}
  ${COLORS.yellow}--pr${COLORS.reset}        Review a Pull Request (compare against main/base)
  ${COLORS.yellow}--base <br>${COLORS.reset} Specify base branch for PR review (default: main)
  ${COLORS.yellow}--last${COLORS.reset}      Review the very last commit (HEAD~1..HEAD)
  ${COLORS.yellow}--commit <h>${COLORS.reset} Review a specific commit hash
  ${COLORS.yellow}--range <a> <b>${COLORS.reset} Review diff between two refs

${COLORS.bold}EXAMPLES:${COLORS.reset}
  ${COLORS.dim}# First time setup${COLORS.reset}
  jstar init

  ${COLORS.dim}# Review staged changes (default)${COLORS.reset}
  jstar review

  ${COLORS.dim}# Review a Pull Request${COLORS.reset}
  jstar review --pr
  jstar review --pr --base develop

  ${COLORS.dim}# Review the last commit${COLORS.reset}
  jstar review --last

  ${COLORS.dim}# JSON output for CI${COLORS.reset}
  jstar review --json > report.json

${COLORS.bold}ENVIRONMENT:${COLORS.reset}
  GEMINI_API_KEY    Required for Gemini embeddings (or GOOGLE_API_KEY)
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

const REQUIRED_ENV_VARS = {
    'GEMINI_API_KEY': '# Required: Gemini API key (or GOOGLE_API_KEY)\nGEMINI_API_KEY=your_gemini_api_key_here',
    'GROQ_API_KEY': '# Required: Groq API key for LLM reviews\nGROQ_API_KEY=your_groq_api_key_here',
    'REVIEW_MODEL_NAME': '# Optional: Override the default model\n# REVIEW_MODEL_NAME=moonshotai/kimi-k2-instruct-0905'
};

function createSetupFiles() {
    const cwd = process.cwd();

    // 1. Create .jstar directory
    const jstarDir = path.join(cwd, '.jstar');
    if (!fs.existsSync(jstarDir)) {
        fs.mkdirSync(jstarDir, { recursive: true });
        log(`${COLORS.green}✓${COLORS.reset} Created .jstar/`);
    }

    // 2. Create/Update .env.example
    const envExamplePath = path.join(cwd, '.env.example');
    if (fs.existsSync(envExamplePath)) {
        let content = fs.readFileSync(envExamplePath, 'utf-8');
        let addedKeys = [];

        for (const [key, template] of Object.entries(REQUIRED_ENV_VARS)) {
            if (!content.includes(key)) {
                content += '\n' + template + '\n';
                addedKeys.push(key);
            }
        }

        if (addedKeys.length > 0) {
            fs.writeFileSync(envExamplePath, content);
            log(`${COLORS.green}✓${COLORS.reset} Updated .env.example with missing keys: ${addedKeys.join(', ')}`);
        } else {
            log(`${COLORS.dim}  .env.example already exists and is up to date${COLORS.reset}`);
        }
    } else {
        const initialEnv = "# J-Star Code Reviewer\n" + Object.values(REQUIRED_ENV_VARS).join("\n") + "\n";
        fs.writeFileSync(envExamplePath, initialEnv);
        log(`${COLORS.green}✓${COLORS.reset} Created .env.example`);
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
    case 'chat':
        runScript('chat.ts');
        break;
    case 'detect':
    case 'det':
        runScript('detective.ts');
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
