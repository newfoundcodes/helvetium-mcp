/*
 * Helvetium MCP - Helvetium Framework, A Newfoundcodes project.
 *
 * Copyright (C) 2026 Jonathan Eldy Baldivicio
 *
 * Author: Jonathan Eldy Baldivicio
 * Contact: jonathaneldy.baldivicio@newfoundcodes.com
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import { randomUUID } from './util.js';
import { invalidParams } from './errors.js';

export class MCPTaskStore {
  private tasks = new Map<string, Task>();

  create(options: TaskOptions = {}): CreateTaskResult {
    const now = new Date().toISOString();
    const task: CreateTaskResult = {
      resultType: 'task',
      taskId: options.taskId ?? randomUUID(),
      status: 'working',
      createdAt: now,
      lastUpdatedAt: now,
      ttlMs: options.ttlMs ?? 3_600_000,
      pollIntervalMs: options.pollIntervalMs ?? 1_000,
    };

    this.tasks.set(task.taskId, task);
    return structuredClone(task);
  }

  get(id: string): Task {
    this.prune();

    const task = this.tasks.get(id);
    if (!task) {
      throw invalidParams('Unknown or expired task', { taskId: id });
    }

    return structuredClone(task);
  }

  update(id: string, patch: Partial<Omit<Task, 'taskId' | 'createdAt'>>): Task {
    const current = this.get(id);
    const next = {
      ...current,
      ...patch,
      taskId: id,
      createdAt: current.createdAt,
      lastUpdatedAt: new Date().toISOString(),
    } as Task;

    this.tasks.set(id, next);
    return structuredClone(next);
  }

  requireInput(id: string, inputRequests: Record<string, InputRequest>): Task {
    return this.update(id, { status: 'input_required', inputRequests });
  }

  working(id: string): Task {
    return this.update(id, { status: 'working', inputRequests: undefined });
  }

  complete(id: string, result: Result): Task {
    return this.update(id, { status: 'completed', result, inputRequests: undefined });
  }

  fail(id: string, error: JSONRPCError): Task {
    return this.update(id, { status: 'failed', error, inputRequests: undefined });
  }

  cancel(id: string): Task {
    const t = this.get(id);
    if (t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled') {
      return t;
    }

    return this.update(id, { status: 'cancelled' });
  }

  remove(id: string): boolean {
    return this.tasks.delete(id);
  }

  prune(now = Date.now()): void {
    for (const [id, task] of this.tasks) {
      const expires = new Date(task.createdAt).getTime() + task.ttlMs;
      if (expires <= now) {
        this.tasks.delete(id);
      }
    }
  }
}

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}
