/**
 * Task Router — маршрутизирует задачи на подходящие модели/агенты
 * с интеграцией ModelRouter для умного переключения моделей.
 * 
 * Поддерживает:
 * - Round-robin переключение моделей
 * - Condition-based выбор (цена/лимиты/тип задачи)
 * - Failover при недоступности
 * - Приоритеты моделей
 * - Бесплатные и локальные модели (Ollama)
 */

import { visionDispatcher } from './visionDispatcher.js';
import { codePipeline } from './codePipeline.js';
import { modelRouter } from './modelRouter.js';

// Стратегии выполнения задач
const EXECUTION_STRATEGIES = {
  parallel: async (taskDef, agent) => {
    return await visionDispatcher.process(taskDef, agent);
  },
  pipeline: async (taskDef, agent) => {
    return await codePipeline.process(taskDef, agent);
  },
  single: async (taskDef, agent) => {
    return await agent.execute(taskDef);
  }
};

class TaskRouter {
  constructor() {
    this.executionStrategies = EXECUTION_STRATEGIES;
  }

  /**
   * Главный метод — зароутить задачу с выбором модели через ModelRouter
   */
  async route(taskDef, agent) {
    const { type, description } = taskDef;
    const strategy = this._getStrategy(type);

    // Определяем есть ли изображения в задаче
    const hasImages = /https?:\/\/\S+\.(png|jpg|jpeg|gif|webp)/i.test(description || '') ||
                     /data:image\/[a-z]+;base64/.test(description || '');

    // Выбираем модель через ModelRouter
    const selectedModel = await modelRouter.selectModel(type, {
      priority: taskDef.priority,
      estimatedTokens: taskDef.estimatedTokens,
      modelHint: taskDef.model_hint,
      hasImages,
    });

    if (selectedModel) {
      taskDef.preferredProvider = selectedModel.provider;
      taskDef.selectedModel = selectedModel.id;
      taskDef.modelCostPer1K = selectedModel.costPer1K;
      console.log(`[TaskRouter] ${type} task -> model: ${selectedModel.id} (provider: ${selectedModel.provider}, cost: $${selectedModel.costPer1K}/1K)`);
    } else {
      // Fallback: первая доступная модель из ModelRouter или model_hint
      const fallback = modelRouter.getFirstAvailableModel?.();
      taskDef.preferredProvider = taskDef.model_hint && taskDef.model_hint !== 'auto' 
        ? taskDef.model_hint 
        : (fallback?.provider || 'ollama-local');
      taskDef.selectedModel = taskDef.model_hint && taskDef.model_hint !== 'auto'
        ? taskDef.model_hint
        : (fallback?.id || 'auto');
      console.log(`[TaskRouter] ${type} task -> fallback: ${taskDef.selectedModel}`);
    }

    try {
      // Выполняем через обработчик стратегии
      const result = await strategy(taskDef, agent);
      
      // Записываем usage (тут нужна оценка токенов — можно уточнить из результата)
      const tokensUsed = result?.usage?.total_tokens || result?.tokens || 0;
      const estimatedCost = (tokensUsed / 1000) * (selectedModel?.costPer1K || 0);
      modelRouter.recordUsage(taskDef.selectedModel || taskDef.preferredProvider, type, tokensUsed, estimatedCost);
      
      return result;
    } catch (error) {
      // Отмечаем модель как недоступную и пробуем failover
      if (taskDef.selectedModel) {
        modelRouter.markModelUnavailable(taskDef.selectedModel, error.message);
      }
      
      // Пробуем следующую доступную модель
      console.log(`[TaskRouter] Model ${taskDef.selectedModel} failed, trying failover...`);
      const failoverModel = await modelRouter.selectModel(type, {
        ...taskDef,
        priority: taskDef.priority
      });
      
      if (failoverModel && failoverModel.id !== taskDef.selectedModel) {
        taskDef.preferredProvider = failoverModel.provider;
        taskDef.selectedModel = failoverModel.id;
        console.log(`[TaskRouter] Failover to: ${failoverModel.id}`);
        return await strategy(taskDef, agent);
      }
      
      throw error;
    }
  }

  /**
   * Получить стратегию выполнения для типа задачи
   */
  _getStrategy(taskType) {
    switch (taskType) {
      case 'vision':
        return this.executionStrategies.parallel;
      case 'code':
      case 'code_review':
        return this.executionStrategies.pipeline;
      case 'chat':
      case 'web_search':
      case 'embeddings':
      case 'image_gen':
        return this.executionStrategies.single;
      default:
        return this.executionStrategies.single;
    }
  }

  /**
   * Получить список доступных моделей для типа задачи
   */
  getModelsForType(taskType) {
    const config = modelRouter.getConfig();
    const group = config.modelGroups[taskType];
    return group ? group.models : [];
  }

  /**
   * Получить статистику использования моделей
   */
  getModelStats() {
    return modelRouter.getDailyStats();
  }

  /**
   * Обновить конфигурацию роутера
   */
  updateConfig(newConfig) {
    modelRouter.updateConfig(newConfig);
  }

  /**
   * Проверить поддерживается ли тип задачи
   */
  isSupported(taskType) {
    const config = modelRouter.getConfig();
    return taskType in config.modelGroups;
  }
}

export const taskRouter = new TaskRouter();
