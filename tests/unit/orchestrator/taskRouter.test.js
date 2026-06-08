import { describe, it, expect, vi, beforeEach } from 'vitest';

// Мокаем visionDispatcher, codePipeline и modelRouter
vi.mock('../../../src/orchestrator/visionDispatcher.js', () => ({
  visionDispatcher: {
    process: vi.fn(),
  },
}));

vi.mock('../../../src/orchestrator/codePipeline.js', () => ({
  codePipeline: {
    process: vi.fn(),
  },
}));

vi.mock('../../../src/orchestrator/modelRouter.js', () => ({
  modelRouter: {
    selectModel: vi.fn(),
    recordUsage: vi.fn(),
    markModelUnavailable: vi.fn(),
    getConfig: vi.fn(() => ({
      modelGroups: {
        chat: { models: [{ id: 'minimax-m3:cloud', provider: 'ollama-local', costPer1K: 0 }], enabled: true },
        code: { models: [{ id: 'qwen2.5-coder:14b', provider: 'ollama-local', costPer1K: 0 }], enabled: true },
        code_review: { models: [{ id: 'gemma4:31b-cloud', provider: 'ollama-local', costPer1K: 0 }], enabled: true },
        vision: { models: [{ id: 'minimax-m3:cloud', provider: 'ollama-local', costPer1K: 0 }], enabled: true },
        web_search: { models: [{ id: 'nemotron-3-super:cloud', provider: 'ollama-local', costPer1K: 0 }], enabled: true },
        embeddings: { models: [], enabled: false },
        image_gen: { models: [], enabled: false },
      }
    })),
    getDailyStats: vi.fn(() => ({})),
    updateConfig: vi.fn(),
  },
}));

const { taskRouter } = await import('../../../src/orchestrator/taskRouter.js');
const { visionDispatcher } = await import('../../../src/orchestrator/visionDispatcher.js');
const { codePipeline } = await import('../../../src/orchestrator/codePipeline.js');
const { modelRouter } = await import('../../../src/orchestrator/modelRouter.js');

describe('TaskRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset modelRouter mock defaults
    modelRouter.selectModel.mockResolvedValue({ id: 'minimax-m3:cloud', provider: 'ollama-local', costPer1K: 0 });
    modelRouter.getConfig.mockReturnValue({
      modelGroups: {
        chat: { models: [{ id: 'minimax-m3:cloud', provider: 'ollama-local', costPer1K: 0 }], enabled: true },
        code: { models: [{ id: 'qwen2.5-coder:14b', provider: 'ollama-local', costPer1K: 0 }], enabled: true },
        code_review: { models: [{ id: 'gemma4:31b-cloud', provider: 'ollama-local', costPer1K: 0 }], enabled: true },
        vision: { models: [{ id: 'minimax-m3:cloud', provider: 'ollama-local', costPer1K: 0 }], enabled: true },
        web_search: { models: [{ id: 'nemotron-3-super:cloud', provider: 'ollama-local', costPer1K: 0 }], enabled: true },
        embeddings: { models: [], enabled: false },
        image_gen: { models: [], enabled: false },
      }
    });
  });

  it('должен быть синглтоном с методами маршрутизации', () => {
    expect(taskRouter).toBeDefined();
    expect(typeof taskRouter.route).toBe('function');
    expect(typeof taskRouter.getModelsForType).toBe('function');
    expect(typeof taskRouter.getModelStats).toBe('function');
    expect(typeof taskRouter.updateConfig).toBe('function');
    expect(typeof taskRouter.isSupported).toBe('function');
  });

  it('isSupported возвращает true для известных типов', () => {
    expect(taskRouter.isSupported('chat')).toBe(true);
    expect(taskRouter.isSupported('vision')).toBe(true);
    expect(taskRouter.isSupported('code')).toBe(true);
    expect(taskRouter.isSupported('code_review')).toBe(true);
    expect(taskRouter.isSupported('web_search')).toBe(true);
  });

  it('isSupported возвращает false для неизвестного типа', () => {
    expect(taskRouter.isSupported('unknown')).toBe(false);
  });

  it('route vision задач через visionDispatcher.process с parallel стратегией', async () => {
    const taskDef = { type: 'vision', description: 'Analyze image' };
    const mockAgent = { execute: vi.fn() };
    visionDispatcher.process.mockResolvedValue({ result: 'image analysis' });

    const result = await taskRouter.route(taskDef, mockAgent);

    expect(visionDispatcher.process).toHaveBeenCalledWith(taskDef, mockAgent);
    expect(result.result).toBe('image analysis');
    expect(taskDef.preferredProvider).toBe('ollama-local');
  });

  it('route code задач через codePipeline.process с pipeline стратегией', async () => {
    const taskDef = { type: 'code', description: 'Write function' };
    const mockAgent = { execute: vi.fn() };
    codePipeline.process.mockResolvedValue({ result: 'generated code' });

    const result = await taskRouter.route(taskDef, mockAgent);

    expect(codePipeline.process).toHaveBeenCalledWith(taskDef, mockAgent);
    expect(result.result).toBe('generated code');
    expect(taskDef.preferredProvider).toBe('ollama-local');
  });

  it('route chat задач напрямую через agent.execute', async () => {
    const taskDef = { type: 'chat', description: 'Hello' };
    const mockAgent = { execute: vi.fn().mockResolvedValue({ text: 'Hi there' }) };

    const result = await taskRouter.route(taskDef, mockAgent);

    expect(mockAgent.execute).toHaveBeenCalledWith(taskDef);
    expect(result.text).toBe('Hi there');
    expect(taskDef.preferredProvider).toBe('ollama-local');
  });

  it('route web_search задач через agent.execute', async () => {
    const taskDef = { type: 'web_search', description: 'Search web' };
    const mockAgent = { execute: vi.fn().mockResolvedValue({ results: [] }) };

    const result = await taskRouter.route(taskDef, mockAgent);

    expect(mockAgent.execute).toHaveBeenCalledWith(taskDef);
    expect(result.results).toEqual([]);
    expect(taskDef.preferredProvider).toBe('ollama-local');
  });

  it('не бросает ошибку для неизвестного типа задачи, использует single стратегию', async () => {
    const taskDef = { type: 'unknown' };
    const mockAgent = { execute: vi.fn().mockResolvedValue({}) };

    const result = await taskRouter.route(taskDef, mockAgent);

    expect(mockAgent.execute).toHaveBeenCalledWith(taskDef);
    expect(result).toEqual({});
  });

  it('использует model_hint если он задан и не равен auto', async () => {
    const taskDef = { type: 'chat', description: 'Hello', model_hint: 'gpt-4o' };
    const mockAgent = { execute: vi.fn().mockResolvedValue({}) };
    modelRouter.selectModel.mockResolvedValue({ id: 'gpt-4o', provider: 'openai', costPer1K: 0.01 });

    await taskRouter.route(taskDef, mockAgent);

    expect(taskDef.preferredProvider).toBe('openai');
    expect(taskDef.selectedModel).toBe('gpt-4o');
  });

  it('устанавливает selectedModel и modelCostPer1K из modelRouter', async () => {
    const taskDef = { type: 'vision', description: 'Analyze' };
    const mockAgent = { execute: vi.fn().mockResolvedValue({}) };
    modelRouter.selectModel.mockResolvedValue({ id: 'minimax-m3:cloud', provider: 'ollama-local', costPer1K: 0 });

    await taskRouter.route(taskDef, mockAgent);

    expect(taskDef.selectedModel).toBe('minimax-m3:cloud');
    expect(taskDef.modelCostPer1K).toBe(0);
  });

  it('обрабатывает code_review задачи через codePipeline.process', async () => {
    const taskDef = { type: 'code_review', description: 'Review code' };
    const mockAgent = { execute: vi.fn().mockResolvedValue({ review: 'looks good' }) };
    codePipeline.process.mockResolvedValue({ review: 'looks good' });

    const result = await taskRouter.route(taskDef, mockAgent);

    expect(codePipeline.process).toHaveBeenCalledWith(taskDef, mockAgent);
    expect(result.review).toBe('looks good');
    expect(taskDef.preferredProvider).toBe('ollama-local');
  });

  it('вызывает modelRouter.recordUsage после успешного выполнения', async () => {
    const taskDef = { type: 'chat', description: 'Hello' };
    const mockAgent = { execute: vi.fn().mockResolvedValue({ text: 'Hi', usage: { total_tokens: 100 } }) };

    await taskRouter.route(taskDef, mockAgent);

    expect(modelRouter.recordUsage).toHaveBeenCalled();
  });

  it('вызывает modelRouter.markModelUnavailable при ошибке', async () => {
    const taskDef = { type: 'chat', description: 'Hello' };
    const mockAgent = { execute: vi.fn().mockRejectedValue(new Error('Model failed')) };
    modelRouter.selectModel
      .mockResolvedValueOnce({ id: 'minimax-m3:cloud', provider: 'ollama-local', costPer1K: 0 })
      .mockResolvedValueOnce(null); // failover returns null

    await expect(taskRouter.route(taskDef, mockAgent)).rejects.toThrow('Model failed');

    expect(modelRouter.markModelUnavailable).toHaveBeenCalledWith('minimax-m3:cloud', 'Model failed');
  });
});
