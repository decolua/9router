// Simple logger utility for bulk import services
// Can be replaced with a more sophisticated logger if needed

const isDev = process.env.NODE_ENV === 'development';

export function debug(tag, message, data) {
  if (isDev) {
    const dataStr = data ? ` ${formatData(data)}` : '';
    console.log(`[🔍 ${tag}] ${message}${dataStr}`);
  }
}

export function info(tag, message, data) {
  const dataStr = data ? ` ${formatData(data)}` : '';
  console.log(`[ℹ️ ${tag}] ${message}${dataStr}`);
}

export function warn(tag, message, data) {
  const dataStr = data ? ` ${formatData(data)}` : '';
  console.warn(`[⚠️ ${tag}] ${message}${dataStr}`);
}

export function error(tag, message, data) {
  const dataStr = data ? ` ${formatData(data)}` : '';
  console.error(`[❌ ${tag}] ${message}${dataStr}`);
}

function formatData(data) {
  if (!data) return '';
  if (typeof data === 'string') return data;
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

export default { debug, info, warn, error };
