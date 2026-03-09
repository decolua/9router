/**
 * Truncate text with ellipsis
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated text
 */
function truncate(text, maxLength) {
  if (!text || text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength - 3) + "...";
}

/**
 * Mask API key showing only first and last characters
 * @param {string} key - API key to mask
 * @returns {string} Masked key
 */
function maskKey(key) {
  if (!key || key.length < 8) {
    return "***";
  }
  const firstChars = key.substring(0, 4);
  const lastChars = key.substring(key.length - 4);
  return `${firstChars}${"*".repeat(key.length - 8)}${lastChars}`;
}

/**
 * Format date to readable string
 * @param {Date|string|number} date - Date to format
 * @returns {string} Formatted date string
 */
function formatDate(date) {
  const d = new Date(date);
  if (isNaN(d.getTime())) {
    return "Invalid Date";
  }

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const seconds = String(d.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Format number with commas
 * @param {number} num - Number to format
 * @returns {string} Formatted number
 */
function formatNumber(num) {
  if (typeof num !== "number" || isNaN(num)) {
    return "0";
  }
  return num.toLocaleString("en-US");
}

/**
 * Format bytes to human readable size
 * @param {number} bytes - Bytes to format
 * @returns {string} Formatted size string
 */
function formatBytes(bytes) {
  if (typeof bytes !== "number" || isNaN(bytes) || bytes < 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * Get relative time string
 * @param {Date|string|number} date - Date to compare
 * @returns {string} Relative time string
 */
function getRelativeTime(date) {
  const d = new Date(date);
  if (isNaN(d.getTime())) {
    return "Invalid Date";
  }

  const now = new Date();
  const diffMs = now - d;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  const diffMonth = Math.floor(diffDay / 30);
  const diffYear = Math.floor(diffDay / 365);

  if (diffSec < 60) {
    return "just now";
  } else if (diffMin < 60) {
    return `${diffMin} minute${diffMin > 1 ? "s" : ""} ago`;
  } else if (diffHour < 24) {
    return `${diffHour} hour${diffHour > 1 ? "s" : ""} ago`;
  } else if (diffDay < 30) {
    return `${diffDay} day${diffDay > 1 ? "s" : ""} ago`;
  } else if (diffMonth < 12) {
    return `${diffMonth} month${diffMonth > 1 ? "s" : ""} ago`;
  } else {
    return `${diffYear} year${diffYear > 1 ? "s" : ""} ago`;
  }
}

module.exports = {
  truncate,
  maskKey,
  formatDate,
  formatNumber,
  formatBytes,
  getRelativeTime
};
