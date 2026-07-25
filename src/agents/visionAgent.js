/**
 * Vision Agent — специализированный агент для анализа изображений.
 * 
 * Отправляет изображения на vision-модели через open-sse движок.
 * Умеет работать с:
 * - URL изображениями
 * - Base64 data URI
 * - Множественными изображениями в одном запросе
 */

import { fetchWithTimeout } from '@/shared/utils/fetchWithTimeout.js';

const FETCH_TIMEOUT = 60000; // 60s

export class VisionAgent {
  constructor() {
    this.name = 'Vision Agent';
    this.supportedModels = ['gpt-4o', 'claude-3-5-sonnet-20241022', 'gemini-2.5-pro'];
  }

  /**
   * Выполнить задачу анализа изображений
   */
  async execute(taskDef) {
    const { description } = taskDef;

    const messages = [{
      role: 'user',
      content: [
        { type: 'text', text: this._buildPrompt(description) }
      ]
    }];

    // Добавляем изображения, если они есть
    const images = this._extractImages(description);
    if (images.length > 0) {
      for (const img of images) {
        messages[0].content.push({
          type: 'image_url',
          image_url: {
            url: img.type === 'url' ? img.url : img.data,
            detail: 'high'
          }
        });
      }
    }

    const response = await fetchWithTimeout(`http://localhost:${process.env.PORT || 20128}/api/sse/chat`, {
      timeoutMs: FETCH_TIMEOUT,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: taskDef.preferredProvider || 'openai:gpt-4o',
        messages,
        stream: false,
        max_tokens: 4096,
        temperature: 0.3
      })
    });

    if (!response.ok) {
      throw new Error(`VisionAgent error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || JSON.stringify(data);
  }

  _buildPrompt(description) {
    // Очищаем описание от URL/base64 изображений, оставляя только текстовую часть
    const cleanText = description
      .replace(/https?:\/\/\S+\.(png|jpg|jpeg|gif|webp)(\?\S*)?/gi, '')
      .replace(/data:image\/\w+;base64,[^"'\s]+/gi, '')
      .trim();

    return cleanText || 'Проанализируй изображение и опиши что на нём находится.';
  }

  _extractImages(text) {
    const images = [];

    const urlRegex = /https?:\/\/\S+\.(png|jpg|jpeg|gif|webp)(\?\S*)?/gi;
    let match;
    while ((match = urlRegex.exec(text)) !== null) {
      images.push({ type: 'url', url: match[0] });
    }

    const base64Regex = /data:image\/(\w+);base64,([^"'\s]+)/gi;
    while ((match = base64Regex.exec(text)) !== null) {
      images.push({ type: 'base64', data: match[0] });
    }

    return images;
  }

  getName() { return this.name; }
}