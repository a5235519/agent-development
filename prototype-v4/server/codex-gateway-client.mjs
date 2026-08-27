const terminalStatuses = new Set(['completed', 'failed', 'interrupted', 'offline']);

export class RemoteCodexGatewayClient {
  constructor({ baseUrl, fetchImpl = fetch, pollIntervalMs = 500 } = {}) {
    if (!baseUrl) throw new Error('Codex Gateway URL 必填');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetch = fetchImpl;
    this.pollIntervalMs = pollIntervalMs;
  }

  async request(path, options = {}) {
    const response = await this.fetch(`${this.baseUrl}${path}`, { ...options, headers: { 'content-type': 'application/json', ...options.headers } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || `Codex Gateway HTTP ${response.status}`);
    return body;
  }

  health() { return this.request('/healthz'); }

  async startTask({ prompt, cwd, model, runnerId }) {
    const body = { prompt, cwd, model, runnerId, sandbox: 'workspace-write', approvalPolicy: 'never', ephemeral: false };
    const result = await this.request('/api/tasks', { method: 'POST', body: JSON.stringify(body) });
    return result.task;
  }

  getTask(taskId) { return this.request(`/api/tasks/${taskId}`).then((result) => result.task); }

  getEvents(taskId, afterSeq = 0) { return this.request(`/api/tasks/${taskId}/events?afterSeq=${afterSeq}`).then((result) => result.events || []); }

  interrupt(taskId) { return this.request(`/api/tasks/${taskId}/interrupt`, { method: 'POST', body: '{}' }); }

  async waitForTask(taskId, { onEvent, shouldCancel, timeoutMs = 30 * 60 * 1000 } = {}) {
    const started = Date.now(); let afterSeq = 0; let interrupted = false;
    for (;;) {
      if (Date.now() - started > timeoutMs) throw Object.assign(new Error('Codex Gateway 任务超时'), { code: 'CODEX_TASK_TIMEOUT' });
      if (!interrupted && await shouldCancel?.()) { interrupted = true; await this.interrupt(taskId); }
      const events = await this.getEvents(taskId, afterSeq);
      for (const event of events) { afterSeq = Math.max(afterSeq, event.seq || 0); await onEvent?.(event); }
      const task = await this.getTask(taskId);
      if (terminalStatuses.has(task.status)) return task;
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
  }
}
