const TASK_PATTERNS = {
  code: [
    /\b(code|coding|program|function|class\s+\w+|implement|write\s+(a\s+)?function|debug|compile|syntax|algorithm|sort|search|bubble|recursive|iterate|api\s+|endpoint|route\s+|middleware|database|query|sql|nosql|async|await|promise|callback|loop|array|object|import|export|module)\b/i,
    /```\w*\n[\s\S]*?```/,
    /(def |function |class |const |let |var |import |export |from |require\()/,
    /fix\s+(this\s+)?(bug|error|issue|problem)|error\s+(in|at|line)|doesn'?t\s+work|broken|crash/i,
  ],
  refactoring: [
    /\b(refactor|rewrite|improve|clean\s+(up|code)|optimize|restructure|reorganize|simplify|reduce\s+(duplication|complexity)|extract\s+(method|function|class)|inline\s+|split\s+|merge\s+)\b/i,
    /\b(tech.?debt|spaghetti|legacy|smell|pattern|solid|dry|kiss|yagni|best\s+practices)\b/i,
  ],
  reasoning: [
    /\b(why|explain|analyze|compare|contrast|evaluate|justify|reason|think|reflect|consider|hypothesize|theorize|debate|argue|implications|consequences)\b/i,
    /\b(what\s+if|how\s+(does|would|should|could|might)|differences?\s+between|pros\s+and\s+cons|advantage|disadvantage|benefit|drawback)\b/i,
    /^\s*(?:why|how|what|explain|analyze|compare|describe|define|elaborate)\b/i,
  ],
  planning: [
    /\b(plan|roadmap|strategy|architecture|design\s+pattern|workflow|diagram|schema|blueprint|outline|proposal|suggestion|approach|solution)\b/i,
    /(steps?\s+to|how\s+to\s+build|what\s+(should|need)\s+(to\s+)?(do|consider|implement))/i,
  ],
  search_research: [
    /\b(search|find|look\s+(up|for)|research|investigate|explore|gather\s+info|documentation|docs?\s+for|tutorial|guide|howto|reference)\b/i,
    /\b(latest|news|update|version|release|changelog|deprecated|alternative)\b/i,
  ],
};

const TASK_CONFIDENCE = {
  code: ['code', 'refactoring', 'planning'],
  reasoning: ['reasoning', 'search_research'],
  chat: ['chat'],
};

export function classifyTask(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return 'chat';

  const lastUserMsg = findLastUserMessage(messages);
  if (!lastUserMsg) return 'chat';

  const text = extractText(lastUserMsg);
  if (!text || text.length < 3) return 'chat';

  const scores = { chat: 0.1 };
  for (const [task, patterns] of Object.entries(TASK_PATTERNS)) {
    scores[task] = 0;
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        scores[task] += 0.3;
      }
    }
    if (text.length > 200) scores[task] += 0.1;
  }

  const totalLength = text.length;
  const codeFences = (text.match(/```/g) || []).length;
  if (codeFences >= 2) scores.code += 0.4;
  if (/^[ \t]*(\/\/|#|<!--|\/\*)/m.test(text)) scores.code += 0.2;

  const questionWords = (text.match(/\b(why|how|what|explain|difference|compare|pros|cons|advantage|disadvantage)\b/gi) || []).length;
  if (questionWords >= 2) scores.reasoning += questionWords * 0.1;

  if (/refactor|rewrite|improve|clean/i.test(text) && (codeFences >= 2 || /\b(code|function|class)\b/i.test(text))) {
    scores.refactoring += 0.5;
  }

  const maxScore = Math.max(...Object.values(scores));
  if (maxScore === 0) return 'chat';

  const topTasks = Object.entries(scores)
    .filter(([, s]) => s >= maxScore - 0.1)
    .sort(([, a], [, b]) => b - a);

  let task = topTasks[0][0];

  if (task === 'refactoring' && scores.code >= scores.refactoring * 0.7) {
    task = task;
  }

  return task;
}

function findLastUserMessage(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg && (msg.role === 'user' || msg.role === 'human')) {
      const parts = Array.isArray(msg.content) ? msg.content : [msg];
      if (parts.some(p => p && p.type !== 'tool_result' && p.type !== 'tool_use')) {
        return msg;
      }
    }
  }
  return null;
}

function extractText(msg) {
  if (!msg) return '';
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter(b => b && (b.type === 'text' || !b.type))
      .map(b => b.text || '')
      .join('\n');
  }
  return '';
}

export function getTaskCategory(task) {
  const map = {
    code: 'code',
    refactoring: 'code',
    reasoning: 'reasoning',
    planning: 'reasoning',
    search_research: 'chat',
    chat: 'chat',
    vision: 'vision',
  };
  return map[task] || 'chat';
}
