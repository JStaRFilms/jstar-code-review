import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

interface Violation {
    file: string;
    line: number;
    message: string;
    severity: 'high' | 'medium' | 'low';
    code: string;
}

interface Rule {
    id: string;
    severity: 'high' | 'medium' | 'low';
    message: string;
    pattern: RegExp;
    filePattern?: RegExp; // Only check files matching this pattern
}

const RULES: Rule[] = [
    {
        id: 'SEC-001',
        severity: 'high',
        message: 'Possible Hardcoded Secret detected',
        pattern: /(api_key|secret|password|token)\s*[:=]\s*['"`][a-zA-Z0-9_\-\.]{10,}['"`]/i
    },
    {
        id: 'ARCH-001',
        severity: 'medium',
        message: 'Avoid using console.log in production code',
        pattern: /console\.log\(/
    },
];

// File-level rules that check the whole content
const FILE_RULES: Rule[] = [
    {
        id: 'ARCH-002',
        severity: 'high',
        message: 'Next.js "use client" must be at the very top of the file',
        pattern: /^(?!['"]use client['"]).*['"]use client['"]/s,
        filePattern: /\.tsx?$/
    }
];

export class Detective {
    violations: Violation[] = [];

    constructor(private directory: string) { }

    async scan(): Promise<Violation[]> {
        this.walk(this.directory);
        return this.violations;
    }

    private walk(dir: string) {
        if (!fs.existsSync(dir)) return;
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);

            if (stat.isDirectory()) {
                if (file !== 'node_modules' && file !== '.git' && file !== '.jstar') {
                    this.walk(filePath);
                }
            } else {
                this.checkFile(filePath);
            }
        }
    }

    private checkFile(filePath: string) {
        if (!filePath.match(/\.(ts|tsx|js|jsx)$/)) return;

        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');

        // Line-based rules
        for (const rule of RULES) {
            if (rule.filePattern && !filePath.match(rule.filePattern)) continue;

            lines.forEach((line, index) => {
                if (rule.pattern.test(line)) {
                    this.addViolation(filePath, index + 1, rule);
                }
            });
        }

        // File-based rules
        for (const rule of FILE_RULES) {
            if (rule.filePattern && !filePath.match(rule.filePattern)) continue;
            if (rule.pattern.test(content)) {
                this.addViolation(filePath, 1, rule);
            }
        }
    }

    private addViolation(filePath: string, line: number, rule: Rule) {
        this.violations.push({
            file: path.relative(process.cwd(), filePath),
            line,
            message: rule.message,
            severity: rule.severity,
            code: rule.id
        });
    }

    report() {
        if (this.violations.length === 0) {
            console.log(chalk.green("✅ Detective Engine: No violations found."));
            return;
        }

        console.log(chalk.red(`🚨 Detective Engine found ${this.violations.length} violations:`));
        // Only show first 10 to avoid wall of text
        const total = this.violations.length;
        const toShow = this.violations.slice(0, 10);

        toShow.forEach(v => {
            const color = v.severity === 'high' ? chalk.red : chalk.yellow;
            console.log(color(`[${v.code}] ${v.file}:${v.line} - ${v.message}`));
        });

        if (total > 10) {
            console.log(chalk.dim(`... and ${total - 10} more.`));
        }
    }
}

// CLI Integration
if (require.main === module) {
    const detective = new Detective(path.join(process.cwd(), 'src'));
    detective.scan();
    detective.report();
}
