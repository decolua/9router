import { describe, it, expect, vi } from 'vitest';
import { DefaultExecutor } from '../../open-sse/executors/default.js';

// Mocking dependencies if necessary
vi.mock('../../src/shared/utils/clineAuth.js', () => ({
  buildClineHeaders: vi.fn(() => ({})),
}));

describe('DefaultExecutor', () => {
  it('should fallback json_schema to json_object and inject prompt', () => {
    const executor = new DefaultExecutor('openai');
    const body = {
      model: 'gpt-4o',
      messages: [
        { role: 'user', content: 'Extract name from: My name is John' }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'Name',
          schema: {
            type: 'object',
            properties: {
              name: { type: 'string' }
            },
            required: ['name']
          }
        }
      }
    };

    const transformed = executor.transformRequest('gpt-4o', body);

    expect(transformed.response_format.type).toBe('json_object');
    expect(transformed.messages[0].role).toBe('system');
    expect(transformed.messages[0].content).toContain('You must respond with valid JSON that strictly follows this JSON schema');
    expect(transformed.messages[0].content).toContain('"name": {');
    expect(transformed.messages[1].content).toBe('Extract name from: My name is John');
  });

  it('should append to existing system message', () => {
    const executor = new DefaultExecutor('openai');
    const body = {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'Extract name from: My name is John' }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'Name',
          schema: {
            type: 'object',
            properties: {
              name: { type: 'string' }
            },
            required: ['name']
          }
        }
      }
    };

    const transformed = executor.transformRequest('gpt-4o', body);

    expect(transformed.response_format.type).toBe('json_object');
    expect(transformed.messages[0].role).toBe('system');
    expect(transformed.messages[0].content).toContain('Be concise.');
    expect(transformed.messages[0].content).toContain('You must respond with valid JSON');
  });

  it('should not modify body if no json_schema is present', () => {
    const executor = new DefaultExecutor('openai');
    const body = {
      model: 'gpt-4o',
      messages: [
        { role: 'user', content: 'Hello' }
      ]
    };

    const transformed = executor.transformRequest('gpt-4o', body);

    expect(transformed.response_format).toBeUndefined();
    expect(transformed.messages.length).toBe(1);
    expect(transformed.messages[0].content).toBe('Hello');
  });
});
