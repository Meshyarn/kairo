export type ProgressState = { enabled: boolean; label: string };

export function resolveProgressState(label: string, constraints?: any): ProgressState {
    const flag = process.env.KAIRO_PROGRESS_LOGS;
    const enabled = constraints?.progress === true || flag === 'true' || flag === '1';
    return { enabled, label };
}

export function logProgress(progress: ProgressState | undefined, message: string): void {
    if (!progress?.enabled) return;
    console.info(`[${progress.label}] ${message}`);
}

export function logToolStart(progress: ProgressState | undefined, tool: string): number {
    const started = Date.now();
    if (progress?.enabled) {
        console.info(`[${progress.label}] ${tool} start.`);
    }
    return started;
}

export function logToolEnd(progress: ProgressState | undefined, tool: string, started: number): void {
    if (!progress?.enabled) return;
    const duration = Date.now() - started;
    console.info(`[${progress.label}] ${tool} done in ${duration}ms.`);
}
