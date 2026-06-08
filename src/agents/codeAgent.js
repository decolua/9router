/**
 * Code Agent — специализированный агент для написания и отладки кода.
 * 
 * Предпочитает Claude для написания кода (лучший код-генератор),
 * но может использовать любую доступную модель.
 */

import { fetchWithTimeout } from '@/shared/utils/fetchWithTimeout.js';

const FETCH_TIMEOUT = 60000; // 60s

export class CodeAgent {
  constructor() {
    this.name = 'Code Agent';
    this.preferredModel = 'anthropic:claude-3-5-sonnet-20241022';
    this.fallbackModel = 'openai:gpt-4o';
  }

  /**
   * Выполнить задачу по написанию или изменению кода
   */
  async execute(taskDef) {
    const { description, preferredProvider } = taskDef;
    const model = preferredProvider === 'anthropic' ? this.preferredModel : this.fallbackModel;

    const messages = [{
      role: 'user',
      content: this._buildPrompt(description)
    }];

    const response = await fetchWithTimeout(`http://localhost:${process.env.PORT || 20128}/api/sse/chat`, {
      timeoutMs: FETCH_TIMEOUT,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        max_tokens: 8192,
        temperature: 0.3
      })
    });

    if (!response.ok) {
      throw new Error(`CodeAgent error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || JSON.stringify(data);
  }

  _buildPrompt(description) {
    return `Ты — эксперт по программированию. Напиши качественный, готовый к использованию код.

Задача: ${description}

Требования:
1. Верни полный, рабочий код без плейсхолдеров
2. Используй современный синтаксис и best practices
3. Добавь обработку ошибок
4. Прокомментируй сложные участки
5. Если нужен конкретный язык/фреймворк — используй его
6. Код должен быть готов к копированию и запуску`;
  }

  getName() { return this.name; }
}