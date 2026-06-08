import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

vi.mock('@/orchestrator/taskRouter.js', () => ({
  taskRouter: {
    route: vi.fn(),
    getAvailableProviders: vi.fn(),
    isSupported: vi.fn(),
    routingTable: {},
  },
}));

vi.mock('@/orchestrator/qualityGate.js', () => ({
  qualityGate: {
    review: vi.fn(),
  },
}));

vi.mock('@/orchestrator/agentPool.js', () => ({
  agentPool: {
    getAgent: vi.fn(),
    getAllAgents: vi.fn(),
    getAgentsByStatus: vi.fn(),
    cleanup: vi.fn(),
    agents: new Map(),
    agentRegistry: new Map(),
  },
  AGENT_STATUS: {
    IDLE: 'idle',
    BUSY: 'busy',
    ERROR: 'error',
    DISABLED: 'disabled',
  },
}));

vi.mock('@/lib/db/repos/settingsRepo.js', () => ({
  getSettings: vi.fn().mockResolvedValue({
    orchestrator: {
      supervisorProvider: 'routerai',
      supervisorModel: 'deepseek/deepseek-v4-flash',
      supervisorEndpoint: 'https://routerai.ru',
      supervisorApiKey: 'test-key',
      supervisorMaxTokens: 2000,
      supervisorTemperature: 0.3,
      reviewProvider: 'routerai',
      reviewModel: 'deepseek/deepseek-v4-flash',
      reviewApiKey: 'test-key',
      reviewEndpoint: 'https://routerai.ru',
      reviewMaxTokens: 500,
      reviewTemperature: 0.2,
      maxRetries: 3,
      minQualityScore: 0.6,
    },
  }),
  updateSettings: vi.fn(),
}));

let supervisor;
let TASK_TYPES;
let TASK_STATUS;
let DEFAULT_ORCHESTRATOR_SETTINGS;

describe('Supervisor', () => {
  beforeAll(async () => {
    const mod = await import('@/orchestrator/supervisor.js');
    supervisor = mod.supervisor;
    TASK_TYPES = mod.TASK_TYPES;
    TASK_STATUS = mod.TASK_STATUS;
    DEFAULT_ORCHESTRATOR_SETTINGS = mod.DEFAULT_ORCHESTRATOR_SETTINGS;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should be a singleton', () => {
    expect(supervisor).toBeDefined();
  });

  it('should have TASK_TYPES constants', () => {
    expect(TASK_TYPES.VISION).toBe('vision');
    expect(TASK_TYPES.CODE).toBe('code');
    expect(TASK_TYPES.CHAT).toBe('chat');
    expect(TASK_TYPES.WEB_SEARCH).toBe('web_search');
  });

  it('should have TASK_STATUS constants', () => {
    expect(TASK_STATUS.PENDING).toBe('pending');
    expect(TASK_STATUS.PLANNING).toBe('planning');
    expect(TASK_STATUS.IN_PROGRESS).toBe('in_progress');
    expect(TASK_STATUS.COMPLETED).toBe('completed');
    expect(TASK_STATUS.FAILED).toBe('failed');
  });

  it('should have default settings', () => {
    expect(DEFAULT_ORCHESTRATOR_SETTINGS).toBeDefined();
    expect(DEFAULT_ORCHESTRATOR_SETTINGS.supervisorModel).toBe('deepseek/deepseek-v4-flash');
    expect(DEFAULT_ORCHESTRATOR_SETTINGS.maxRetries).toBe(3);
    expect(DEFAULT_ORCHESTRATOR_SETTINGS.minQualityScore).toBe(0.6);
  });

  it('should subscribe and unsubscribe listeners', () => {
    const callback = vi.fn();
    const unsubscribe = supervisor.subscribe(callback);

    supervisor._notify('test', { data: 1 });
    expect(callback).toHaveBeenCalledWith('test', { data: 1 });

    unsubscribe();
    supervisor._notify('test2', {});
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('should get effective settings from DB', async () => {
    const settings = await supervisor.getEffectiveSettings();

    expect(settings).toBeDefined();
    expect(settings.supervisorProvider).toBe('routerai');
    expect(settings.supervisorModel).toBe('deepseek/deepseek-v4-flash');
    expect(settings.supervisorEndpoint).toBe('https://routerai.ru');
    expect(settings.maxRetries).toBe(3);
  });

  it('should update settings and reset cache', async () => {
    const { updateSettings } = await import('@/lib/db/repos/settingsRepo.js');
    updateSettings.mockResolvedValue({});

    const newSettings = { supervisorModel: 'gpt-4o', minQualityScore: 0.8 };
    const result = await supervisor.updateSettings(newSettings);

    expect(result.supervisorModel).toBe('gpt-4o');
    expect(result.minQualityScore).toBe(0.8);
    expect(updateSettings).toHaveBeenCalled();
  });

  it('should create default plan for chat request', () => {
    const plan = supervisor._createDefaultPlan('Hello, how are you?');
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0].type).toBe('chat');
    expect(plan.reasoning).toBeDefined();
  });

  it('should create default plan with vision task for image URLs', () => {
    const plan = supervisor._createDefaultPlan('What is in this image? https://example.com/photo.jpg');
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0].type).toBe('vision');
  });

  it('should create default plan with code task for code requests', () => {
    const plan = supervisor._createDefaultPlan('Напиши функцию на Python');
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0].type).toBe('code');
  });

  it('should parse valid JSON plan from model response', () => {
    const response = JSON.stringify({
      tasks: [
        { type: 'chat', description: 'Say hello', dependsOn: [], priority: 1, model_hint: 'auto' },
        { type: 'code', description: 'Write script', dependsOn: [], priority: 2, model_hint: 'auto' },
      ],
      reasoning: 'Test plan',
    });

    const plan = supervisor._parsePlan(response, 'test');
    expect(plan.tasks).toHaveLength(2);
    expect(plan.tasks[0].type).toBe('chat');
    expect(plan.tasks[1].type).toBe('code');
    expect(plan.reasoning).toBe('Test plan');
  });

  it('should fall back to default plan on invalid JSON', () => {
    const plan = supervisor._parsePlan('not json at all', 'test');
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0].type).toBe('chat');
  });

  it('should fall back to default plan on empty tasks array', () => {
    const response = JSON.stringify({ tasks: [], reasoning: 'empty' });
    const plan = supervisor._parsePlan(response, 'test');
    expect(plan.tasks).toHaveLength(1);
  });

  it('should build final result from plan, results and review', () => {
    const plan = { reasoning: 'Test plan' };
    const results = [
      { type: 'code', description: 'Write', status: 'completed', result: 'some code here' },
      { type: 'chat', description: 'Respond', status: 'completed', result: 'response text' },
    ];
    const review = { passed: true, summary: 'All good' };

    const finalResult = supervisor._buildFinalResult(plan, results, review);

    expect(finalResult.plan).toBe('Test plan');
    expect(finalResult.tasks).toHaveLength(2);
    expect(finalResult.review.passed).toBe(true);
    expect(finalResult.fullResults).toBe(results);
  });

  it('should handle getWorkflow and getActiveWorkflows', () => {
    expect(supervisor.getWorkflow('nonexistent')).toBeUndefined();
    expect(supervisor.getActiveWorkflows()).toEqual([]);
    expect(supervisor.getAllWorkflows()).toEqual([]);
  });
});