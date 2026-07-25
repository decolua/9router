/**
 * Agent Pool — пул агентов для выполнения задач.
 * 
 * Каждый агент — это обёртка над AI-моделью, которая умеет:
 * - Принимать задачу (task definition)
 * - Выполнять её через соответствующий API (через open-sse или напрямую)
 * - Возвращать результат
 * 
 * Пул управляет жизненным циклом агентов и отслеживает их состояние.
 */

import { v4 as uuidv4 } from 'uuid';
import { TASK_TYPES, TASK_STATUS } from './supervisor.js';

// Состояния агента
export const AGENT_STATUS = {
  IDLE: 'idle',
  BUSY: 'busy',
  ERROR: 'error',
  DISABLED: 'disabled'
};

class AgentPool {
  constructor() {
    this.agents = new Map();
    this.agentRegistry = new Map();  // type -> agent constructor
    this._initDefaultAgents();
  }

  /**
   * Инициализация агентов по умолчанию
   */
  _initDefaultAgents() {
    this._registerAgent('default', {
      name: 'Default Chat Agent',
      execute: async (taskDef) => {
        return this._executeViaSSE(taskDef);
      }
    });
  }

  /**
   * Зарегистрировать новый тип агента
   */
  _registerAgent(type, agent) {
    this.agentRegistry.set(type, agent);
  }

  /**
   * Получить агента для типа задачи
   */
  getAgent(taskType) {
    // Пытаемся найти специализированного агента
    const agentKey = `${taskType}Agent`;
    let agent = this.agentRegistry.get(agentKey);

    if (!agent) {
      // Если специализированного нет — берём дефолтного
      agent = this.agentRegistry.get('default');
    }

    const agentId = uuidv4();
    const agentInstance = {
      id: agentId,
      type: taskType,
      name: agent.name || `${taskType} Agent`,
      status: AGENT_STATUS.IDLE,
      createdAt: Date.now(),
      taskCount: 0,
      execute: async (taskDef) => {
        this._setStatus(agentId, AGENT_STATUS.BUSY);
        try {
          const result = await agent.execute(taskDef);
          this._incrementTaskCount(agentId);
          this._setStatus(agentId, AGENT_STATUS.IDLE);
          return result;
        } catch (error) {
          this._setStatus(agentId, AGENT_STATUS.ERROR);
          throw error;
        }
      }
    };

    this.agents.set(agentId, agentInstance);
    return agentInstance;
  }

  /**
   * Выполнить задачу через SSE-обработчики проекта
   */
  async _executeViaSSE(taskDef) {
    const { type, description, preferredProvider } = taskDef;

    // Определяем есть ли изображения — если да, принудительно vision-модель
    const hasImages = /https?:\/\/\S+\.(png|jpg|jpeg|gif|webp)/i.test(description || '') ||
                     /data:image\/[a-z]+;base64/.test(description || '');
    const effectiveProvider = hasImages ? 'opencode:minimax-m3' : (preferredProvider || 'auto');
    if (hasImages) console.log(`[AgentPool] Images detected, using vision model ${effectiveProvider}`);

    // Определяем SSE endpoint по типу задачи
    let endpoint;
    switch (type) {
      case TASK_TYPES.CHAT:
      case TASK_TYPES.CODE:
      case TASK_TYPES.CODE_REVIEW:
        endpoint = '/api/sse/chat';
        break;
      case TASK_TYPES.VISION:
        endpoint = '/api/sse/chat';
        break;
      case TASK_TYPES.IMAGE_GEN:
        endpoint = '/api/sse/image';
        break;
      case TASK_TYPES.EMBEDDINGS:
        endpoint = '/api/sse/embeddings';
        break;
      default:
        endpoint = '/api/sse/chat';
    }

    // Строим запрос к внутреннему API
    const payload = {
      model: effectiveProvider,
      messages: [
        {
          role: 'user',
          content: hasImages && !description.match(/data:image/) 
            ? [{ type: 'text', text: description }]
            : description
        }
      ],
      stream: false,
      max_tokens: 4096
    };

    // Вызываем через внутренний fetch (in-process)
    const url = new URL(endpoint, `http://localhost:${process.env.PORT || 20128}`);
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Agent execute error: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    return data;
  }

  /**
   * Установить статус агента
   */
  _setStatus(agentId, status) {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = status;
      agent.lastActivity = Date.now();
    }
  }

  /**
   * Увеличить счётчик задач
   */
  _incrementTaskCount(agentId) {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.taskCount++;
    }
  }

  /**
   * Получить список всех агентов
   */
  getAllAgents() {
    return Array.from(this.agents.values());
  }

  /**
   * Получить агентов по статусу
   */
  getAgentsByStatus(status) {
    return Array.from(this.agents.values())
      .filter(a => a.status === status);
  }

  /**
   * Очистить неактивных агентов
   */
  cleanup(maxAge = 3600000) {
    const now = Date.now();
    for (const [id, agent] of this.agents) {
      if (agent.status === AGENT_STATUS.IDLE && 
          (now - agent.lastActivity) > maxAge) {
        this.agents.delete(id);
      }
    }
  }
}

export const agentPool = new AgentPool();