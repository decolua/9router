import { describe, it, expect } from 'vitest';
import { cleanJSONSchemaForAntigravity } from '../../open-sse/translator/helpers/geminiHelper.js';

describe('cleanJSONSchemaForAntigravity', () => {
  it('should NOT strip `pattern` or `required` from a valid schema', () => {
    const schema = {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'The glob pattern.'
        },
        path: {
          type: 'string',
          description: 'The path.'
        }
      },
      required: ['pattern']
    };

    const cleanedSchema = cleanJSONSchemaForAntigravity(JSON.parse(JSON.stringify(schema)));

    expect(cleanedSchema.properties.pattern).toBeDefined();
    expect(cleanedSchema.properties.pattern.type).toBe('string');
    expect(cleanedSchema.required).toEqual(['pattern']);
  });
});
