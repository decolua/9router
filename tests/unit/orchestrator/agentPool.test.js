import { describe, it, expect, vi, beforeEach } from 'vitest';

// Мокаем uuid чтобы генерировать уникальные ID
let callCount = 0;
vi.mock('uuid', () => ({
  v4: vi.fn(() => {
    callCount++;
    return `test-agent-id-${callCount}`;
  }),
}));

// Мокаем supervisor чтобы подтянуть TASK_TYPES/TASK_STATUS
vi.mock('../../../src/orchestrator/supervisor.js', () => ({
  TASK_TYPES: {
    CHAT: 'chat',
    CODE: 'code',
    CODE_REVIEW: 'code_review',
    VISION: 'vision',
    WEB_SEARCH: 'web_search',
    EMBEDDINGS: 'embeddings',
    IMAGE_GEN: 'image_gen',
    ORCHESTRATE: 'orchestrate',
  },
  TASK_STATUS: {
    PENDING: 'pending',
    PLANNING: 'planning',
    IN_PROGRESS: 'in_progress',
    REVIEWING: 'reviewing',
    COMPLETED: 'completed',
    FAILED: 'failed',
    NEEDS_REWORK: 'needs_rework',
  },
}));

// Глобальный fetch для _executeViaSSE
let mockFetch;

beforeEach(() => {
  vi.clearAllMocks();
  callCount = 0;
});

const { agentPool, AGENT_STATUS } = await import('../../../src/orchestrator/agentPool.js');

describe('AgentPool', () => {
  beforeEach(() => {
    // Очищаем пул между тестами
    agentPool.agents.clear();
    agentPool.agentRegistry.clear();
    agentPool._initDefaultAgents();
  });

  describe('AGENT_STATUS', () => {
    it('должен иметь все статусы', () => {
      expect(AGENT_STATUS).toEqual({
        IDLE: 'idle',
        BUSY: 'busy',
        ERROR: 'error',
        DISABLED: 'disabled',
      });
    });
  });

  describe('_initDefaultAgents', () => {
    it('должен зарегистрировать default агента', () => {
      expect(agentPool.agentRegistry.has('default')).toBe(true);
      const defaultAgent = agentPool.agentRegistry.get('default');
      expect(defaultAgent.name).toBe('Default Chat Agent');
      expect(typeof defaultAgent.execute).toBe('function');
    });
  });

  describe('_registerAgent', () => {
    it('должен регистрировать новый тип агента', () => {
      const customAgent = { name: 'Custom', execute: vi.fn() };
      agentPool._registerAgent('customAgent', customAgent);

      expect(agentPool.agentRegistry.get('customAgent')).toBe(customAgent);
    });
  });

  describe('getAgent', () => {
    it('должен вернуть агента для chat типа с статусом IDLE', () => {
      const agent = agentPool.getAgent('chat');

      expect(agent).toBeDefined();
      expect(agent.id).toMatch(/^test-agent-id/);
      expect(agent.type).toBe('chat');
      expect(agent.name).toBe('Default Chat Agent');
      expect(agent.status).toBe(AGENT_STATUS.IDLE);
      expect(agent.taskCount).toBe(0);
      expect(typeof agent.execute).toBe('function');
    });

    it('должен вернуть специализированного агента если зарегистрирован', () => {
      const visionAgent = { name: 'Vision Agent', execute: vi.fn() };
      agentPool._registerAgent('visionAgent', visionAgent);

      const agent = agentPool.getAgent('vision');
      expect(agent.name).toBe('Vision Agent');
    });

    it('должен установить статус BUSY во время выполнения и IDLE после', async () => {
      const mockExecute = vi.fn().mockResolvedValue({ text: 'done' });
      agentPool._registerAgent('customAgent', {
        name: 'Custom',
        execute: mockExecute,
      });

      const agent = agentPool.getAgent('custom');
      const executePromise = agent.execute({ type: 'custom', description: 'test' });

      // Внутренний статус меняется синхронно при старте execute
      expect(agent.status).toBe(AGENT_STATUS.BUSY);

      await executePromise;
      expect(agent.status).toBe(AGENT_STATUS.IDLE);
    });

    it('должен установить статус ERROR при ошибке выполнения', async () => {
      const mockExecute = vi.fn().mockRejectedValue(new Error('fail'));
      agentPool._registerAgent('errAgent', {
        name: 'Error Prone',
        execute: mockExecute,
      });

      const agent = agentPool.getAgent('err');

      await expect(agent.execute({ type: 'err', description: 'test' }))
        .rejects.toThrow('fail');
      expect(agent.status).toBe(AGENT_STATUS.ERROR);
    });

    it('должен увеличивать taskCount после успешного выполнения', async () => {
      const mockExecute = vi.fn().mockResolvedValue({ text: 'done' });
      agentPool._registerAgent('counterAgent', {
        name: 'Counter',
        execute: mockExecute,
      });

      const agent = agentPool.getAgent('counter');
      expect(agent.taskCount).toBe(0);

      await agent.execute({ type: 'counter', description: 'test' });
      expect(agent.taskCount).toBe(1);

      await agent.execute({ type: 'counter', description: 'test 2' });
      expect(agent.taskCount).toBe(2);
    });
  });

  describe('getAllAgents', () => {
    it('должен вернуть пустой массив если агентов нет', () => {
      expect(agentPool.getAllAgents()).toEqual([]);
    });

    it('должен вернуть всех созданных агентов', () => {
      agentPool.getAgent('chat');
      agentPool.getAgent('vision');

      const allAgents = agentPool.getAllAgents();
      expect(allAgents).toHaveLength(2);
    });
  });

  describe('getAgentsByStatus', () => {
    it('должен фильтровать агентов по статусу', () => {
      const agent1 = agentPool.getAgent('chat');
      agentPool.getAgent('vision');

      const idleAgents = agentPool.getAgentsByStatus(AGENT_STATUS.IDLE);
      expect(idleAgents).toHaveLength(2);

      const busyAgents = agentPool.getAgentsByStatus(AGENT_STATUS.BUSY);
      expect(busyAgents).toHaveLength(0);
    });
  });

  describe('cleanup', () => {
    it('должен удалить неактивных агентов старше maxAge', () => {
      const agent = agentPool.getAgent('chat');
      agent.lastActivity = Date.now() - 100000; // 100 секунд назад

      agentPool.cleanup(50000); // maxAge 50 секунд

      expect(agentPool.agents.has(agent.id)).toBe(false);
    });

    it('не должен удалять активных агентов', () => {
      const agent = agentPool.getAgent('chat');
      agent.lastActivity = Date.now();

      agentPool.cleanup(50000);

      expect(agentPool.agents.has(agent.id)).toBe(true);
    });
  });
});

describe('AgentPool._executeViaSSE', () => {
  beforeEach(() => {
    agentPool.agents.clear();
    agentPool.agentRegistry.clear();
    agentPool._initDefaultAgents();

    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    delete global.fetch;
  });

  it('должен выполнять задачу через SSE endpoint', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: 'Hi' } }] }),
    });

    const result = await agentPool._executeViaSSE({
      type: 'chat',
      description: 'Hello',
      preferredProvider: 'openai',
    });

    expect(result).toEqual({ choices: [{ message: { content: 'Hi' } }] });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/sse/chat'),
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });

  it('должен бросать ошибку при неудачном ответе', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    });

    await expect(agentPool._executeViaSSE({
      type: 'chat',
      description: 'test',
    })).rejects.toThrow('Agent execute error: 500 Internal Server Error');
  });

  it('должен выбирать правильный endpoint для image_gen', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    await agentPool._executeViaSSE({
      type: 'image_gen',
      description: 'Generate an image',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/sse/image'),
      expect.anything()
    );
  });

  it('должен выбирать правильный endpoint для embeddings', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    await agentPool._executeViaSSE({
      type: 'embeddings',
      description: 'Embed text',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/sse/embeddings'),
      expect.anything()
    );
  });
});