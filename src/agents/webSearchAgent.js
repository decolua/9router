/**
 * Web Search Agent — агент для поиска информации в интернете.
 * 
 * Использует Web Search API проекта (9router-web-search скилл),
 * чтобы находить актуальную информацию и возвращать её.
 */

import { fetchWithTimeout } from '@/shared/utils/fetchWithTimeout.js';

const FETCH_TIMEOUT = 30000; // 30s

export class WebSearchAgent {
  constructor() {
    this.name = 'Web Search Agent';
    this.searchEndpoint = process.env.WEB_SEARCH_ENDPOINT || '/api/sse/search';
  }

  /**
   * Выполнить поисковый запрос
   */
  async execute(taskDef) {
    const { description } = taskDef;

    // Извлекаем поисковый запрос из описания задачи
    const query = this._extractQuery(description);

    if (!query) {
      return 'Поисковый запрос не указан. Уточните что нужно найти.';
    }

    // Выполняем поиск через API проекта
    const searchResults = await this._performSearch(query);

    // Если есть результаты, суммаризируем их
    if (searchResults && searchResults.length > 0) {
      return this._formatResults(query, searchResults);
    }

    return `По запросу "${query}" ничего не найдено.`;
  }

  /**
   * Извлечь поисковый запрос из описания
   */
  _extractQuery(description) {
    // Пытаемся найти запрос в кавычках
    const quotedMatch = description.match(/[""]([^""]+)[""]/);
    if (quotedMatch) return quotedMatch[1];

    // Ищем после "найди", "поищи", "search for", "find"
    const patterns = [
      /найди\s+(.+)/i,
      /поищи\s+(.+)/i,
      /поиск\s+(.+)/i,
      /найти\s+(.+)/i,
      /search\s+for\s+(.+)/i,
      /find\s+(.+)/i,
      /look\s+up\s+(.+)/i
    ];

    for (const pattern of patterns) {
      const match = description.match(pattern);
      if (match) return match[1].trim();
    }

    // Если ничего не нашли — используем всё описание как запрос
    // Но чистим от лишних слов
    const cleanQuery = description
      .replace(/выполни поиск|произведи поиск|найди информацию/i, '')
      .trim();

    return cleanQuery || description;
  }

  /**
   * Выполнить поиск через Web Search API
   */
  async _performSearch(query) {
    try {
      const response = await fetchWithTimeout(`http://localhost:${process.env.PORT || 20128}${this.searchEndpoint}`, {
        timeoutMs: FETCH_TIMEOUT,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          num_results: 5,
          stream: false
        })
      });

      if (!response.ok) {
        console.warn(`[WebSearchAgent] Search API error: ${response.status}`);
        return this._mockSearch(query);
      }

      const data = await response.json();
      return data.results || data;
    } catch (error) {
      console.warn(`[WebSearchAgent] Search failed, using mock: ${error.message}`);
      return this._mockSearch(query);
    }
  }

  /**
   * Мок-поиск (если API поиска недоступен)
   */
  _mockSearch(query) {
    return [
      {
        title: `Результаты поиска по запросу: ${query}`,
        url: `https://example.com/search?q=${encodeURIComponent(query)}`,
        snippet: `Здесь были бы результаты поиска по запросу "${query}". Для полноценного поиска необходимо настроить Web Search API (9router-web-fetch skill).`
      }
    ];
  }

  /**
   * Форматировать результаты поиска
   */
  _formatResults(query, results) {
    let output = `## Результаты поиска по запросу: "${query}"\n\n`;

    results.forEach((result, index) => {
      if (typeof result === 'string') {
        output += `${index + 1}. ${result}\n`;
      } else {
        const title = result.title || result.name || 'Результат';
        const url = result.url || result.link || '#';
        const snippet = result.snippet || result.description || result.content || '';
        
        output += `${index + 1}. **${title}**\n`;
        if (snippet) output += `   ${snippet.substring(0, 300)}\n`;
        output += `   _Источник: ${url}_\n\n`;
      }
    });

    return output;
  }

  getName() { return this.name; }
}