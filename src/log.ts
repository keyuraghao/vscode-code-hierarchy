import * as vscode from 'vscode';

/**
 * A single output channel for the extension, visible under
 * Output → "Code Hierarchy". Using `{ log: true }` gives the user a log-level
 * picker and timestamps for free, and keeps trace output off unless they ask
 * for it.
 */
let channel: vscode.LogOutputChannel | undefined;

export function initLogger(context: vscode.ExtensionContext): vscode.LogOutputChannel {
    if (!channel) {
        channel = vscode.window.createOutputChannel('Code Hierarchy', { log: true });
        context.subscriptions.push(channel);
    }
    return channel;
}

/**
 * Renders an unknown thrown value without relying on default stringification,
 * which turns a plain object into a useless "[object Object]".
 */
export function describeError(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }
    if (value instanceof Error) {
        return value.stack ?? value.message;
    }
    try {
        return JSON.stringify(value) ?? Object.prototype.toString.call(value);
    } catch {
        return Object.prototype.toString.call(value);
    }
}

/** No-ops before `initLogger`, so importing modules never have to null-check. */
export const log = {
    trace(message: string, ...args: unknown[]): void {
        channel?.trace(message, ...args);
    },
    debug(message: string, ...args: unknown[]): void {
        channel?.debug(message, ...args);
    },
    info(message: string, ...args: unknown[]): void {
        channel?.info(message, ...args);
    },
    warn(message: string, ...args: unknown[]): void {
        channel?.warn(message, ...args);
    },
    error(message: string, error?: unknown): void {
        if (error instanceof Error) {
            channel?.error(error, message);
        } else if (error !== undefined) {
            channel?.error(`${message}: ${describeError(error)}`);
        } else {
            channel?.error(message);
        }
    },
    show(): void {
        channel?.show();
    }
};

/** Only used by tests, which have no ExtensionContext to hand. */
export function resetLoggerForTests(): void {
    channel = undefined;
}
