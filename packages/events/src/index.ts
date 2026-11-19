import type { AgentEvent } from "@mao-hybrid/contracts";

export interface EventBus {
  publish(event: Omit<AgentEvent, "id" | "occurredAt">): AgentEvent;
  list(taskId: string): readonly AgentEvent[];
  subscribe(taskId: string, listener: (event: AgentEvent) => void): () => void;
}

export function createEventBus(): EventBus {
  let nextId = 1;
  const history = new Map<string, AgentEvent[]>();
  const listeners = new Map<string, Set<(event: AgentEvent) => void>>();
  return {
    publish(input) {
      const event: AgentEvent = Object.freeze({ ...input, id: nextId++, occurredAt: new Date().toISOString() });
      const events = history.get(event.taskId) ?? [];
      events.push(event);
      history.set(event.taskId, events);
      for (const listener of listeners.get(event.taskId) ?? []) listener(event);
      return event;
    },
    list(taskId) { return Object.freeze([...(history.get(taskId) ?? [])]); },
    subscribe(taskId, listener) {
      const taskListeners = listeners.get(taskId) ?? new Set();
      taskListeners.add(listener);
      listeners.set(taskId, taskListeners);
      return () => { taskListeners.delete(listener); if (taskListeners.size === 0) listeners.delete(taskId); };
    },
  };
}
