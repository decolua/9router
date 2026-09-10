// Semantic upstream summary, never a raw provider response or exact client wire copy.
// Independent of persistence settings: bound per-stream memory even when logging is disabled.
const DEFAULT_MAX_CHARS = 1024 * 1024;
const MAX_ITEMS = 1024;
export function createActivityStreamCapture({ maxChars = DEFAULT_MAX_CHARS, maxItems = MAX_ITEMS } = {}) {
  const texts = new Map(), thoughts = new Map(), tools = new Map();
  let seen = false, size = 0, truncated = false, terminal = null;
  function put(map, key, value, append = false) {
    if (typeof value !== 'string') return;
    if (!map.has(key) && texts.size + thoughts.size + tools.size >= maxItems) { truncated = true; return; }
    const old = map.get(key) || '';
    const available = Math.max(0, maxChars - size + (append ? 0 : old.length));
    if (value.length > available) truncated = true;
    const next = (append ? old : '') + value.slice(0, available);
    size += next.length - old.length;
    map.set(key, next);
  }
  function tool(index, item, append = false) {
    // Store each tool as bounded JSON metadata and bounded arguments in the same budget.
    const key = `tool:${index}`;
    if (!tools.has(key) && texts.size + thoughts.size + tools.size >= maxItems) { truncated = true; return; }
    const old = tools.get(key) || { id: '', type: 'function', function: {name:'', arguments:''} };
    const next = { id:item.call_id || old.id || item.id || '', type:'function', function:{name:item.name || old.function.name, arguments:(append ? old.function.arguments : '') + (item.arguments ?? old.function.arguments)} };
    const encoded = JSON.stringify(next);
    const oldSize = tools.has(key) ? JSON.stringify(old).length : 0;
    if (size - oldSize + encoded.length > maxChars) { truncated = true; return; }
    size += encoded.length - oldSize;
    tools.set(key, next);
  }
  function snapshot(item, index) {
    if (item?.type === 'function_call') tool(index, item);
    for (const [i, part] of (item?.content || []).entries()) if (part.type === 'output_text') put(texts, `${index}:${i}`, part.text);
    for (const [i, part] of (item?.summary || []).entries()) put(thoughts, `${index}:${i}`, part.text);
  }
  function accept(event, eventName) {
    const type = event.type || eventName || '';
    if (!type.startsWith('response.')) return;
    seen = true;
    const index = event.output_index ?? event.item_id ?? 0;
    const key = `${index}:${event.content_index ?? event.summary_index ?? 0}`;
    if (type === 'response.output_text.delta') put(texts, key, event.delta, true);
    if (type === 'response.output_text.done') put(texts, key, event.text);
    if (type === 'response.reasoning_summary_text.delta' || type === 'response.reasoning_text.delta') put(thoughts, key, event.delta, true);
    if (type === 'response.reasoning_summary_text.done' || type === 'response.reasoning_text.done') put(thoughts, key, event.text);
    if (type === 'response.output_item.added' || type === 'response.output_item.done') snapshot(event.item, index);
    if (type === 'response.function_call_arguments.delta') tool(index, {id:event.item_id, arguments:event.delta || ''}, true);
    if (type === 'response.function_call_arguments.done') tool(index, {id:event.item_id, name:event.name, arguments:event.arguments});
    if (['response.completed','response.failed','response.incomplete'].includes(type)) {
      terminal = type;
      for (const [i,item] of (event.response?.output || []).entries()) snapshot(item, i);
    }
  }
  return { accept, result: () => seen ? { content: [...texts.values()].join(''), thinking: [...thoughts.values()].join(''), tool_calls: [...tools.values()], capture: { kind:'semantic_upstream_summary', truncated, terminal, maxChars } } : null };
}
