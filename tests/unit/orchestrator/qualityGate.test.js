import { describe, it, expect, vi, beforeEach } from 'vitest';

// Мокаем settingsRepo
vi.mock('../../../src/lib/db/repos/settingsRepo.js', () => ({
  getSettings: vi.fn(),
}));

const { getSettings } = await import('../../../src/lib/db/repos/settingsRepo.js');
const { qualityGate } = await import('../../../src/orchestrator/qualityGate.js');

describe('QualityGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    qualityGate._settingsCache = null;
    qualityGate._settingsCacheTime = 0;

    // По умолчанию getSettings возвращает пустой объект
    getSettings.mockResolvedValue({});
  });

  describe('review', () => {
    it('должен вернуть passed=true если нет результатов', async () => {
      const result = await qualityGate.review({ tasks: [] }, [], 'test');

      expect(result.passed).toBe(true);
      expect(result.summary).toBe('Нет задач для проверки');
      expect(result.score).toBe(1.0);
    });

    it('должен вернуть passed=false если есть невыполненные задачи', async () => {
      const results = [
        {
          type: 'chat',
          description: 'Say hi',
          status: 'failed',
          error: 'API error',
          result: null,
        },
      ];

      const result = await qualityGate.review({ tasks: [] }, results, 'test');

      expect(result.passed).toBe(false);
      expect(result.score).toBe(0);
      expect(result.feedback).toContain('API error');
    });

    it('должен вернуть passed=false если результат пустой', async () => {
      const results = [
        {
          type: 'chat',
          description: 'Say hi',
          status: 'completed',
          result: null,
        },
      ];

      const result = await qualityGate.review({ tasks: [] }, results, 'test');

      expect(result.passed).toBe(false);
      expect(result.score).toBe(0.3);
    });

    it('должен вернуть passed=false при эвристике если minScore не задан', async () => {
      const results = [
        {
          type: 'chat',
          description: 'Say hi',
          status: 'completed',
          result: 'Привет! Это длинный ответ, который точно превышает 50 символов для прохождения эвристической проверки.',
        },
      ];

      const result = await qualityGate.review({ tasks: [] }, results, 'test');

      // score = 0.5 (base) - 0.1 (длина < 200) = 0.4, minScore=undefined → passed=false
      expect(result.passed).toBe(false);
      expect(result.score).toBe(0.4);
    });
  });

  describe('_heuristicReview', () => {
    it('должен дать низкий балл для короткого ответа', () => {
      const review = qualityGate._heuristicReview({
        type: 'chat',
        result: 'Коротко',
      });

      // score = 0.5 - 0.3 (короткий) = 0.2
      expect(review.score).toBe(0.2);
      expect(review.passed).toBe(false);
    });

    it('должен дать балл 0.6 для длинного ответа', () => {
      const review = qualityGate._heuristicReview({
        type: 'chat',
        result: 'А'.repeat(600),
      });

      // score = 0.5 + 0.1 (длинный) = 0.6
      expect(review.score).toBe(0.6);
    });

    it('должен штрафовать за слова-ошибки', () => {
      const review = qualityGate._heuristicReview({
        type: 'chat',
        result: 'Произошла ошибка при выполнении запроса. Попробуйте позже.',
      });

      // 0.5 - 0.2 (error) = 0.3, но длина > 50 значит -0.1 → 0.4
      expect(review.score).toBeLessThan(0.5);
    });

    it('должен давать бонус для кода с markdown-блоками', () => {
      const review = qualityGate._heuristicReview({
        type: 'code',
        result: '```javascript\nconst x = 1;\n```',
      });

      // 0.5 + 0.2 (```) + 0.1 (const) = 0.8, но длина < 50 → -0.3 → 0.5
      // base 0.5 + 0.2 (```) + 0.1 (const) = 0.8, text.length=28 < 50 → -0.3 = 0.5
      expect(review.score).toBe(0.5);
    });
  });

  describe('_calculateHeuristicScore', () => {
    it('должен вернуть 0.2 для пустого текста (0.5 - 0.3 за короткий)', () => {
      const score = qualityGate._calculateHeuristicScore('', { type: 'chat' });
      expect(score).toBe(0.2); // 0.5 - 0.3
    });

    it('должен штрафовать за текст менее 50 символов', () => {
      const score = qualityGate._calculateHeuristicScore('Короткий ответ', { type: 'chat' });
      expect(score).toBe(0.2); // 0.5 - 0.3
    });

    it('должен добавлять бонус за длинный текст', () => {
      const score = qualityGate._calculateHeuristicScore('А'.repeat(600), { type: 'chat' });
      expect(score).toBe(0.6); // 0.5 + 0.1
    });

    it('должен удерживать score в границах [0, 1]', () => {
      const score = qualityGate._calculateHeuristicScore('ошибка!', { type: 'chat' });
      // 0.5 - 0.3 (короткий) - 0.2 (ошибка) = 0.0
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('должен давать бонус для кода с function/const/import/def', () => {
      const score = qualityGate._calculateHeuristicScore('```\nconst x = 1\nfunction foo() {}\n```', { type: 'code' });
      // 0.5 - 0.3 (длина < 50) + 0.2 (```) + 0.1 (function/const) = 0.5
      expect(score).toBe(0.5);
    });
  });
});

describe('QualityGate._aiReview fallback', () => {
  beforeEach(() => {
    qualityGate._settingsCache = null;
    qualityGate._settingsCacheTime = 0;
    getSettings.mockResolvedValue({});
  });

  it('должен использовать эвристику если AI ревью недоступен', async () => {
    const review = await qualityGate._reviewTask({
      type: 'chat',
      status: 'completed',
      result: 'Это достаточно длинный ответ, который точно пройдёт эвристическую проверку качества.',
    }, 'test');

    expect(review).toHaveProperty('score');
    expect(review).toHaveProperty('passed');
    expect(review).toHaveProperty('feedback');
  });
});