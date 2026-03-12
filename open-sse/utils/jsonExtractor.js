/**
 * Extract JSON from content that may be wrapped in markdown code blocks
 * Only processes content when responseFormat is specified
 * @param {string} content - Raw response content
 * @param {object} responseFormat - The response_format from the request body
 * @returns {string} - Extracted JSON or original content
 */
export function extractJSON(content, responseFormat) {
  // Only process if response_format is specified
  if (!responseFormat || !content || typeof content !== 'string') {
    return content;
  }
  
  // Check if it's a structured output request
  const isStructuredOutput = responseFormat.type === 'json_schema' || 
                             responseFormat.type === 'json_object';
  
  if (!isStructuredOutput) {
    return content;
  }
  
  // Try to find JSON between markdown code blocks
  const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i);
  if (codeBlockMatch && codeBlockMatch[1]) {
    const extracted = codeBlockMatch[1].trim();
    // Validate it looks like JSON
    if (extracted.startsWith('{') || extracted.startsWith('[')) {
      return extracted;
    }
  }
  
  // Return original if no markdown found or doesn't look like JSON
  return content;
}
