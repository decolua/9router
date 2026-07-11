import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all external dependencies to prevent network calls during constructor
vi.mock('../../../src/shared/utils/fetchWithTimeout.js', () => ({ fetchWithTimeout: vi.fn() }));
vi.mock('../../../src/orchestrator/opencodeConnect.js', () => ({
  discoverOpenCodeFreeModels: vi.fn(() => Promise.resolve([])),
  hasOpenCodeGoKey: vi.fn(() => false),
  getAvailableFreeModels: vi.fn(() => []),
  setFreeModelsCache: vi.fn(),
  OPENCODE_GO_MODELS: [],
  OPENCODE_FREE_FALLBACK: [],
}));

import ModelRouter from '../../../src/orchestrator/modelRouter.js';

describe('ModelRouter — квоты и лимиты', () => {
  let router;

  beforeEach(() => {
    // Чистый инстанс с дефолтным конфигом
    router = new ModelRouter();
    // Отключаем авто-дискавери
    router._scheduleInitialDiscovery = () => {};
    // Сбрасываем вручную
    router.resetAll();
  });

  /* ================================================================
     resetAll()
     ================================================================ */
  describe('resetAll()', () => {
    it('сбрасывает dailyUsage в ноль', () => {
      router.recordUsage('test-model', 1000, 0.05);
      expect(router.dailyUsage.totalTokens).toBe(1000);
      expect(router.dailyUsage.totalCost).toBe(0.05);

      router.resetAll();
      expect(router.dailyUsage.totalTokens).toBe(0);
      expect(router.dailyUsage.totalCost).toBe(0);
      expect(router.dailyUsage.totalRequests).toBe(0);
      expect(router.dailyUsage.totalErrors).toBe(0);
      expect(Object.keys(router.dailyUsage.costs)).toHaveLength(0);
    });

    it('сбрасывает hourlyUsage', () => {
      router.recordUsage('test-model', 100, 0.01);
      expect(router.hourlyUsage.totalCost).toBeGreaterThan(0);

      router.resetAll();
      expect(router.hourlyUsage.totalCost).toBe(0);
      expect(Object.keys(router.hourlyUsage.costs)).toHaveLength(0);
    });

    it('сбрасывает rotationHistory', () => {
      router.rotationHistory.push({ modelId: 'm1', timestamp: Date.now() });
      expect(router.rotationHistory.length).toBe(1);

      router.resetAll();
      expect(router.rotationHistory.length).toBe(0);
    });

    it('сбрасывает requestTimestamps', () => {
      router.requestTimestamps = [Date.now(), Date.now()];
      router.resetAll();
      expect(router.requestTimestamps.length).toBe(0);
    });

    it('сбрасывает consecutiveFreeRequests', () => {
      router.consecutiveFreeRequests = 7;
      router.resetAll();
      expect(router.consecutiveFreeRequests).toBe(0);
    });
  });

  /* ================================================================
     _checkDailyRollover()
     ================================================================ */
  describe('_checkDailyRollover()', () => {
    it('не сбрасывает если день не сменился', () => {
      router.recordUsage('m1', 500, 0.02);
      router._checkDailyRollover();
      expect(router.dailyUsage.totalTokens).toBe(500);
    });

    it('сбрасывает при смене дня', () => {
      router.recordUsage('m1', 500, 0.02);
      router.dailyUsage.date = 'Thu Jan 01 2020'; // подмена прошлой даты
      router._checkDailyRollover();
      expect(router.dailyUsage.totalTokens).toBe(0);
      expect(router.dailyUsage.totalCost).toBe(0);
      expect(router.dailyUsage.date).not.toBe('Thu Jan 01 2020');
    });
  });

  /* ================================================================
     _checkHourlyRollover()
     ================================================================ */
  describe('_checkHourlyRollover()', () => {
    it('сбрасывает при смене часа', () => {
      router.recordUsage('m1', 100, 0.01);
      router.hourlyUsage.currentHour = (new Date().getHours() + 3) % 24; // другой час
      router._checkHourlyRollover();
      expect(router.hourlyUsage.totalCost).toBe(0);
    });
  });

  /* ================================================================
     _checkGlobalLimits()
     ================================================================ */
  describe('_checkGlobalLimits()', () => {
    it('разрешает при лимите 0 (выключено)', () => {
      router.config.globalCostLimitPerDay = 0;
      expect(router._checkGlobalLimits().allowed).toBe(true);
    });

    it('блокирует при превышении costLimit', () => {
      router.config.globalCostLimitPerDay = 0.10;
      router.dailyUsage.totalCost = 0.15;
      const result = router._checkGlobalLimits();
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('cost limit');
    });

    it('блокирует при превышении tokenLimit', () => {
      router.config.globalTokenLimitPerDay = 1000;
      router.dailyUsage.totalTokens = 1500;
      const result = router._checkGlobalLimits();
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('token limit');
    });

    it('разрешает когда лимиты не превышены', () => {
      router.config.globalCostLimitPerDay = 5.0;
      router.config.globalTokenLimitPerDay = 100000;
      router.dailyUsage.totalCost = 1.0;
      router.dailyUsage.totalTokens = 50000;
      expect(router._checkGlobalLimits().allowed).toBe(true);
    });
  });

  /* ================================================================
     _isRateLimited()
     ================================================================ */
  describe('_isRateLimited()', () => {
    it('не лимитирует когда rate limiting выключен', () => {
      router.config.rateLimiting.enabled = false;
      expect(router._isRateLimited()).toBe(false);
    });

    it('лимитирует при превышении RPM', () => {
      router.config.rateLimiting.enabled = true;
      router.config.rateLimiting.globalRequestsPerMinute = 3;
      router.requestTimestamps = [Date.now(), Date.now(), Date.now(), Date.now()];
      expect(router._isRateLimited()).toBe(true);
    });

    it('не лимитирует при RPM в пределах нормы', () => {
      router.config.rateLimiting.enabled = true;
      router.config.rateLimiting.globalRequestsPerMinute = 10;
      router.requestTimestamps = [Date.now(), Date.now(), Date.now()];
      expect(router._isRateLimited()).toBe(false);
    });

    it('фильтрует старые таймстемпы', () => {
      router.config.rateLimiting.enabled = true;
      router.config.rateLimiting.globalRequestsPerMinute = 2;
      router.requestTimestamps = [Date.now() - 120000, Date.now()]; // 2 мин назад + сейчас
      expect(router._isRateLimited()).toBe(false); // старый отфильтрован
    });
  });

  /* ================================================================
     recordUsage()
     ================================================================ */
  describe('recordUsage()', () => {
    it('инкрементирует счётчики', () => {
      router.recordUsage('m1', 1000, 0.05);
      expect(router.dailyUsage.requests['m1']).toBe(1);
      expect(router.dailyUsage.tokens['m1']).toBe(1000);
      expect(router.dailyUsage.costs['m1']).toBe(0.05);
      expect(router.dailyUsage.totalRequests).toBe(1);
      expect(router.dailyUsage.totalTokens).toBe(1000);
      expect(router.dailyUsage.totalCost).toBe(0.05);
    });

    it('суммирует повторные записи', () => {
      router.recordUsage('m1', 500, 0.02);
      router.recordUsage('m1', 300, 0.01);
      expect(router.dailyUsage.requests['m1']).toBe(2);
      expect(router.dailyUsage.tokens['m1']).toBe(800);
      expect(router.dailyUsage.costs['m1']).toBe(0.03);
    });

    it('трекает часовые затраты', () => {
      router.recordUsage('m1', 100, 0.01);
      router.recordUsage('m1', 200, 0.02);
      expect(router.hourlyUsage.costs['m1']).toBe(0.03);
      expect(router.hourlyUsage.totalCost).toBe(0.03);
    });

    it('трекает последовательные бесплатные запросы', () => {
      router.recordUsage('free-model', 100, 0);
      expect(router.consecutiveFreeRequests).toBe(1);
      router.recordUsage('free-model', 100, 0);
      expect(router.consecutiveFreeRequests).toBe(2);
    });

    it('сбрасывает consecutiveFreeRequests при платном запросе', () => {
      router.recordUsage('free-model', 100, 0);
      router.recordUsage('free-model', 100, 0);
      router.recordUsage('paid-model', 100, 0.01);
      expect(router.consecutiveFreeRequests).toBe(0);
    });
  });

  /* ================================================================
     getNextModel() — проверка лимитов
     ================================================================ */
  describe('getNextModel() — лимиты', () => {
    beforeEach(() => {
      router.config.modelGroups = {
        chat: {
          models: [
            { id: 'gpt-4', provider: 'openai', costPer1K: 0.03, priority: 1 },
            { id: 'gpt-3.5', provider: 'openai', costPer1K: 0.002, priority: 2 },
            { id: 'free-model', provider: 'ollama', costPer1K: 0, priority: 3 },
          ],
          enabled: true,
          strategy: 'round_robin',
          fallbackModel: 'gpt-4',
        }
      };
    });

    it('возвращает null при превышении глобального costLimit', () => {
      router.config.globalCostLimitPerDay = 1.0;
      router.dailyUsage.totalCost = 1.5;
      const model = router.getNextModel('chat');
      expect(model).toBeNull();
    });

    it('возвращает null при превышении глобального tokenLimit', () => {
      router.config.globalTokenLimitPerDay = 500;
      router.dailyUsage.totalTokens = 600;
      const model = router.getNextModel('chat');
      expect(model).toBeNull();
    });

    it('возвращает null при rate limit', () => {
      router.config.rateLimiting.enabled = true;
      router.config.rateLimiting.globalRequestsPerMinute = 2;
      router.requestTimestamps = [Date.now(), Date.now(), Date.now()];
      const model = router.getNextModel('chat');
      expect(model).toBeNull();
    });

    it('возвращает модель когда лимиты в порядке', () => {
      router.config.globalCostLimitPerDay = 0;
      const model = router.getNextModel('chat');
      expect(model).not.toBeNull();
      expect(model.id).toBeTruthy();
    });

    it('форсит платную модель после free streak', () => {
      router.consecutiveFreeRequests = 10;
      router.config.switching.maxConsecutiveFreeRequests = 10;
      const model = router.getNextModel('chat');
      expect(model).not.toBeNull();
      expect(model.costPer1K).toBeGreaterThan(0);
    });

    it('записывает ротацию в историю', () => {
      router.getNextModel('chat');
      expect(router.rotationHistory.length).toBe(1);
      expect(router.rotationHistory[0].group).toBe('chat');
      expect(router.rotationHistory[0].modelId).toBeTruthy();
    });
  });

  /* ================================================================
     getStats() — новые поля
     ================================================================ */
  describe('getStats()', () => {
    it('возвращает totalRequests / totalTokens / totalCost / totalErrors', () => {
      const stats = router.getStats();
      expect(stats).toHaveProperty('totalRequests');
      expect(stats).toHaveProperty('totalTokens');
      expect(stats).toHaveProperty('totalCost');
      expect(stats).toHaveProperty('totalErrors');
      expect(stats).toHaveProperty('rpmCurrent');
      expect(stats).toHaveProperty('rateLimitActive');
      expect(stats).toHaveProperty('consecutiveFreeRequests');
    });

    it('возвращает modelHealth как алиас modelStatus', () => {
      const stats = router.getStats();
      expect(stats).toHaveProperty('modelHealth');
      expect(stats.modelHealth).toEqual(stats.modelStatus);
    });

    it('возвращает hourlyUsage', () => {
      const stats = router.getStats();
      expect(stats).toHaveProperty('hourlyUsage');
      expect(stats.hourlyUsage).toHaveProperty('currentHour');
      expect(stats.hourlyUsage).toHaveProperty('totalCost');
    });
  });
});
