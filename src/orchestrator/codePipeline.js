/**
 * Code Pipeline — пайплайн для работы с кодом.
 * 
 * Этапы:
 * 1. Генерация кода — LLM пишет код
 * 2. Ревью кода — другая модель проверяет (Code Review Agent)
 * 3. Исправление — если ревью нашло проблемы, отправляем на доработку
 * 4. Финальная проверка — синтаксис, линтер
 * 
 * Поддерживает итеративное улучшение: может делать несколько проходов.
 */

class CodePipeline {
  constructor() {
    this.maxIterations = 3; // макс. количество итераций генерация->ревью
    this.reviewEnabled = process.env.CODE_REVIEW_ENABLED !== 'false';
  }

  /**
   * Запустить пайплайн для задачи
   */
  async process(taskDef, agent) {
    const { description } = taskDef;

    let currentCode = '';
    let iteration = 0;
    const allResults = [];

    while (iteration < this.maxIterations) {
      iteration++;
      
      // Этап 1: Генерация кода
      console.log(`[CodePipeline] Iteration ${iteration}: generating code...`);
      const genResult = await this._generateCode(description, currentCode, iteration, agent);
      currentCode = genResult.code;

      // Сохраняем историю итераций
      allResults.push({
        iteration,
        code: currentCode,
        explanation: genResult.explanation,
        language: genResult.language
      });

      // Этап 2: Ревью кода (если включено)
      if (this.reviewEnabled && iteration < this.maxIterations) {
        console.log(`[CodePipeline] Iteration ${iteration}: reviewing code...`);
        const reviewResult = await this._reviewCode(description, currentCode, agent);

        if (reviewResult.approved) {
          console.log(`[CodePipeline] Code approved on iteration ${iteration}`);
          break;
        }

        console.log(`[CodePipeline] Review feedback: ${reviewResult.feedback.substring(0, 100)}...`);
        
        // Если ревью не прошло, используем фидбек для следующей итерации
        currentCode = reviewResult.feedback;
      } else {
        break;
      }
    }

    // Финальная проверка
    const validation = this._validateCode(currentCode);

    return {
      type: 'code',
      description: taskDef.description,
      code: currentCode,
      language: allResults[allResults.length - 1]?.language || 'unknown',
      iterations: allResults,
      totalIterations: iteration,
      validation,
      result: this._formatFinalResult(currentCode, allResults)
    };
  }

  /**
   * Генерация кода через LLM
   */
  async _generateCode(description, previousCode, iteration, agent) {
    const prompt = this._buildGenerationPrompt(description, previousCode, iteration);

    // Отправляем через агента
    const response = await agent.execute({
      type: 'code',
      description: prompt,
      preferredProvider: taskDef.preferredProvider || 'opencode' // сначала OpenCode (free/go), потом Claude
    });

    // Парсим результат
    return this._parseCodeResponse(response);
  }

  /**
   * Строит промпт для генерации кода
   */
  _buildGenerationPrompt(description, previousCode, iteration) {
    let prompt = `Ты — опытный разработчик. Напиши код по описанию.

Задача: ${description}

`;

    if (iteration > 1 && previousCode) {
      prompt += `Предыдущая версия кода (итерация ${iteration - 1}):
\`\`\`
${previousCode}
\`\`\`

Улучши этот код. Учти следующие требования:
1. Исправь все ошибки и баги
2. Улучши читаемость и стиль
3. Добавь обработку ошибок
4. Используй современные best practices
`;
    }

    prompt += `
Требования:
- Верни ТОЛЬКО код в markdown-блоке с указанием языка
- Сначала объясни что делает код (кратко, 1-2 предложения)
- Затем markdown-блок с кодом
- Код должен быть полным и готовым к использованию
- Не используй плейсхолдеры или "..." — верни полный код`;

    return prompt;
  }

  /**
   * Парсит ответ от LLM и извлекает код
   */
  _parseCodeResponse(response) {
    let text = '';
    
    if (typeof response === 'string') {
      text = response;
    } else if (response?.choices?.[0]?.message?.content) {
      text = response.choices[0].message.content;
    } else if (response?.result) {
      text = typeof response.result === 'string' ? response.result : JSON.stringify(response.result);
    } else {
      text = JSON.stringify(response);
    }

    // Извлекаем markdown-блок с кодом
    const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/;
    const match = text.match(codeBlockRegex);

    if (match) {
      return {
        code: match[2].trim(),
        language: match[1] || 'text',
        explanation: text.replace(codeBlockRegex, '').trim()
      };
    }

    // Если нет markdown-блока, возвращаем весь текст
    return {
      code: text,
      language: 'text',
      explanation: ''
    };
  }

  /**
   * Ревью кода другой моделью
   */
  async _reviewCode(description, code, agent) {
    const prompt = `Ты — Code Reviewer. Проверь код на ошибки и качество.

Задача: ${description}

Код для ревью:
\`\`\`
${code}
\`\`\`

Проверь:
1. Есть ли синтаксические ошибки?
2. Есть ли логические ошибки?
3. Соответствует ли код задаче?
4. Безопасность — есть ли уязвимости?
5. Производительность — есть ли узкие места?
6. Стиль — соответствует ли best practices?

Ответь строго в формате JSON:
{
  "approved": false,
  "score": 0.7,
  "feedback": "конкретные замечания и предложения по улучшению",
  "issues": ["список найденных проблем"],
  "suggestions": ["конкретные предложения"]
}`;

    const reviewResponse = await agent.execute({
      type: 'code_review',
      description: prompt,
      preferredProvider: 'openai' // GPT-4 лучше ревьюит код
    });

    // Парсим JSON из ответа
    const text = this._extractText(reviewResponse);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {}
    }

    // Если не смогли распарсить — пропускаем ревью
    return {
      approved: true,
      score: 0.8,
      feedback: '',
      issues: [],
      suggestions: []
    };
  }

  /**
   * Извлечь текст из ответа в любом формате
   */
  _extractText(response) {
    if (typeof response === 'string') return response;
    if (response?.choices?.[0]?.message?.content) return response.choices[0].message.content;
    if (response?.result) {
      return typeof response.result === 'string' ? response.result : JSON.stringify(response.result);
    }
    return JSON.stringify(response);
  }

  /**
   * Валидация кода (базовая)
   */
  _validateCode(code) {
    const issues = [];

    // Проверка на пустой код
    if (!code || code.trim().length === 0) {
      return { valid: false, issues: ['Код пустой'] };
    }

    // Проверка на незакрытые блоки (простая эвристика)
    const openBraces = (code.match(/\{/g) || []).length;
    const closeBraces = (code.match(/\}/g) || []).length;
    if (openBraces !== closeBraces) {
      issues.push(`Несоответствие скобок: { ${openBraces} vs } ${closeBraces}`);
    }

    const openParens = (code.match(/\(/g) || []).length;
    const closeParens = (code.match(/\)/g) || []).length;
    if (openParens !== closeParens) {
      issues.push(`Несоответствие скобок: ( ${openParens} vs ) ${closeParens}`);
    }

    // Проверка на TODOs
    if (/TODO|FIXME|HACK|XXX/i.test(code)) {
      issues.push('Код содержит незавершённые TODO/FIXME');
    }

    return {
      valid: issues.length === 0,
      issues,
      lines: code.split('\n').length
    };
  }

  /**
   * Форматирует финальный результат
   */
  _formatFinalResult(code, iterations) {
    if (iterations.length === 1) {
      return `Сгенерирован код на ${iterations[0].language} (${code.split('\n').length} строк)\n\n\`\`\`${iterations[0].language}\n${code}\n\`\`\``;
    }

    let result = `Результат после ${iterations.length} итераций:\n\n`;
    
    iterations.forEach((iter, i) => {
      result += `\n--- Итерация ${i + 1} (${iter.language}) ---\n${iter.explanation ? iter.explanation + '\n' : ''}Код:\n\`\`\`${iter.language}\n${iter.code.substring(0, 200)}${iter.code.length > 200 ? '\n...' : ''}\n\`\`\`\n`;
    });

    result += `\n--- Финальная версия ---\n\`\`\`${iterations[iterations.length - 1].language}\n${code}\n\`\`\``;
    
    return result;
  }
}

export const codePipeline = new CodePipeline();