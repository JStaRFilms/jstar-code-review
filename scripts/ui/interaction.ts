import prompts from 'prompts';
import chalk from 'chalk';

export type UserAction = 'accept' | 'discuss' | 'ignore' | 'exit';

export async function showActionMenu(issueTitle: string): Promise<UserAction> {
    try {
        const response = await prompts({
            type: 'select',
            name: 'action',
            message: `Action for: ${chalk.yellow(issueTitle)}`,
            choices: [
                { title: '✅ Accept', value: 'accept', description: 'Mark as valid issue' },
                { title: '💬 Discuss', value: 'discuss', description: 'Debate this finding with AI' },
                { title: '❌ Ignore', value: 'ignore', description: 'Discard this issue' },
                { title: '🚪 Exit', value: 'exit', description: 'Stop review session' }
            ],
            initial: 0
        });
        return response.action || 'exit';
    } catch (e) {
        return 'exit';
    }
}

export async function askForArgument(): Promise<string> {
    try {
        const response = await prompts({
            type: 'text',
            name: 'argument',
            message: 'Your argument (e.g., "Check utils.ts, logic is handled there"):',
            validate: value => value.length < 5 ? 'Please provide more context' : true
        });
        return response.argument || '';
    } catch (e) {
        return '';
    }
}
