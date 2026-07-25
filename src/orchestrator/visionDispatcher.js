/**
 * Vision Dispatcher — распределяет изображения по vision-моделям.
 * 
 * Умеет:
 * 1. Извлекать изображения из запроса (URL или base64)
 * 2. Отправлять на анализ нескольким vision-моделям параллельно
 * 3. Собирать и агрегировать результаты
 * 4. Выбирать лучший ответ
 * 
 * Поддерживаемые модели:
 * - GPT-4o (OpenAI) — мультимодальный
 * - Claude 3.5 Sonnet (Anthropic) — анализ изображений
 * - Gemini 2.5 Pro (Google) — мультимодальный
 * - Qwen2-VL (Ollama) — open-source vision модель
 */

import { fetchWithTimeout } from '@/shared/utils/fetchWithTimeout.js';

class VisionDispatcher {
  constructor() {
    this.supportedProviders = ['opencode', 'ollama', 'openai', 'anthropic', 'google'];
    this.confidenceThreshold = 0.5;
  }

  /**
   * Обработать задачу с изображениями
   */
  async process(taskDef, agent) {
    const { description } = taskDef;

    // Извлекаем изображения из описания
    const images = this._extractImages(description);
    
    if (images.length === 0) {
      // Если изображений нет, но тип vision — возможно запрос на генерацию
      return {
        type: 'vision',
        description: 'Анализ изображений не требуется',
        result: 'Изображения не найдены в запросе',
        imagesAnalyzed: 0
      };
    }

    // Определяем какие модели использовать
    const modelsToUse = this._selectModels(taskDef, images);
    
    // Отправляем на анализ параллельно разным моделям
    const results = await Promise.allSettled(
      modelsToUse.map(model => {
        if (model.provider === 'ollama') return this._analyzeWithOllama(model, images, description);
        if (model.provider === 'opencode') return this._analyzeWithOpenCode(model, images, description);
        return this._analyzeWithModel(model, images, description);
      })
    );

    // Собираем успешные результаты
    const successfulResults = results
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value);

    if (successfulResults.length === 0) {
      throw new Error('Ни одна vision-модель не смогла обработать изображения');
    }

    // Выбираем лучший результат
    const bestResult = this._selectBestResult(successfulResults);

    return {
      type: 'vision',
      description: taskDef.description,
      imagesAnalyzed: images.length,
      modelsUsed: modelsToUse.map(m => m.provider),
      results: successfulResults.map(r => ({
        provider: r.provider,
        model: r.model,
        analysis: r.analysis
      })),
      result: bestResult.analysis,
      metadata: {
        model: bestResult.model,
        provider: bestResult.provider,
        confidence: bestResult.confidence
      }
    };
  }

  /**
   * Извлечь изображения из описания задачи
   */
  _extractImages(text) {
    const images = [];

    // URL изображений
    const urlRegex = /https?:\/\/\S+\.(png|jpg|jpeg|gif|webp)(\?\S*)?/gi;
    let match;
    while ((match = urlRegex.exec(text)) !== null) {
      images.push({
        type: 'url',
        url: match[0],
        format: match[1].toLowerCase()
      });
    }

    // Base64 изображения
    const base64Regex = /data:image\/(\w+);base64,([^"'\s]+)/gi;
    while ((match = base64Regex.exec(text)) !== null) {
      images.push({
        type: 'base64',
        format: match[1],
        data: match[0] // full data URI
      });
    }

    return images;
  }

  /**
   * Выбрать модели для анализа
   */
  _selectModels(taskDef, images = []) {
    const models = [];

    if (taskDef.preferredProvider && taskDef.preferredProvider !== 'auto') {
      models.push({ provider: taskDef.preferredProvider, model: this._getModelForProvider(taskDef.preferredProvider) });
    } else {
      // Если есть изображения — впервую очередь OpenCode vision-модели
      if (images.length > 0) {
        const key = process.env.PROVIDER_OPENCODE_KEY || '';
        if (key.trim()) {
          // minimax-m3 поддерживает vision
          models.push({ provider: 'opencode', model: 'minimax-m3', format: 'claude' });
        }
      }

      // Локальная Ollama vision-модель всегда доступна
      if (images.length > 0) {
        models.push({ provider: 'ollama', model: 'qwen2.5vl:7b' });
      }

      // Остальные провайдеры
      for (const provider of this.supportedProviders) {
        if (provider !== 'opencode' && provider !== 'ollama') {
          models.push({ provider, model: this._getModelForProvider(provider) });
        }
      }
    }

    return models;
  }

  /**
   * Получить модель для провайдера
   */
  _getModelForProvider(provider) {
    const modelMap = {
      openai: 'gpt-4o',
      anthropic: 'claude-3-5-sonnet-20241022',
      google: 'gemini-2.5-pro',
      ollama: 'qwen2.5vl:7b',
    };
    return modelMap[provider] || 'gpt-4o';
  }

  /**
   * Отправить изображения на анализ через Ollama (локальная vision-модель)
   */
  async _analyzeWithOllama(modelConfig, images, prompt) {
    const { model } = modelConfig;
    const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

    const base64Images = images
      .filter(img => img.type === 'base64')
      .map(img => img.data.replace(/^data:image\/\w+;base64,/, ''));

    // Формируем сообщение для Ollama (передаём URL изображения или base64)
    const userContent = { role: 'user', content: prompt };
    const messages = [userContent];

    // Ollama поддерживает изображения через поле images
    const body = {
      model,
      messages,
      stream: false,
      options: { temperature: 0.3, num_predict: 1024 },
    };

    // Если есть URL изображения — скачиваем, если base64 — передаём напрямую
    const urlImage = images.find(img => img.type === 'url');
    if (urlImage) {
      try {
        const imgRes = await fetch(urlImage.url, { signal: AbortSignal.timeout(10000) });
        if (imgRes.ok) {
          const buf = await imgRes.arrayBuffer();
          const b64 = Buffer.from(buf).toString('base64');
          body.images = [b64];
        }
      } catch { /* fallback: пробуем без изображения */ }
    } else if (base64Images.length > 0) {
      body.images = base64Images;
    }

    try {
      const response = await fetchWithTimeout(`${ollamaUrl}/api/chat`, {
        method: 'POST',
        timeoutMs: 60_000,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`Ollama vision (${model}): HTTP ${response.status} ${errText.substring(0, 200)}`);
      }

      const data = await response.json();

      return {
        provider: 'ollama',
        model,
        analysis: data.message?.content || JSON.stringify(data),
        confidence: 0.6,
        tokensUsed: data.eval_count || 0,
      };
    } catch (err) {
      throw new Error(`Ollama vision (${model}): ${err.message}`);
    }
  }

  /**
   * Отправить изображения на анализ конкретной модели
   */
  async _analyzeWithModel(modelConfig, images, prompt) {
    const { provider, model } = modelConfig;

    // Строим сообщение с изображениями для мультимодального запроса
    const messages = [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        ...images.map(img => ({
          type: 'image_url',
          image_url: {
            url: img.type === 'url' ? img.url : img.data,
            detail: 'high'
          }
        }))
      ]
    }];

    // Отправляем через внутренний SSE endpoint с таймаутом
    const response = await fetchWithTimeout(`http://localhost:${process.env.PORT || 20128}/api/sse/chat`, {
      method: 'POST',
      timeoutMs: 30_000,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `${provider}:${model}`,
        messages,
        stream: false,
        max_tokens: 4096
      })
    });

    if (!response.ok) {
      throw new Error(`Vision model ${provider}/${model} error: ${response.status}`);
    }

    const data = await response.json();

    return {
      provider,
      model,
      analysis: data.choices?.[0]?.message?.content || JSON.stringify(data),
      confidence: this._estimateConfidence(data),
      tokensUsed: data.usage?.total_tokens || 0
    };
  }

  /**
   * Оценить уверенность в ответе
   */
  _estimateConfidence(response) {
    const text = response.choices?.[0]?.message?.content || '';
    
    // Оценка на основе длины и структуры ответа
    let confidence = 0.5;
    
    if (text.length > 200) confidence += 0.2;
    if (text.includes('на изображении') || text.includes('на картинке') || 
        text.includes('изображение') || text.includes('видно')) confidence += 0.15;
    if (/находится|расположен|содержит|имеет/i.test(text)) confidence += 0.1;
    
    // Штраф за неопределённость
    if (/не вижу|не понятно|размыто|сложно определить/i.test(text)) confidence -= 0.2;
    
    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Выбрать лучший результат из нескольких
   */
  _selectBestResult(results) {
    return results.reduce((best, current) => 
      current.confidence > best.confidence ? current : best
    );
  }
}

export const visionDispatcher = new VisionDispatcher();