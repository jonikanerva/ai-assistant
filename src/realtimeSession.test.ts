import { describe, expect, it } from 'vitest';
import { createBobAgent } from './realtimeSession.ts';

describe('createBobAgent', () => {
  it('registers the hosted web_search tool on the agent (issue #6)', () => {
    // Assert registration on OUR constructed agent — importing via the app path
    // exercises the real `@openai/agents` import (and its `zod`-at-load peer), so
    // a broken peer resolution or a future SDK move of `webSearchTool` turns this
    // RED. The agent exposes its tools as a readable array, so we assert the
    // strongest form: a hosted tool named `web_search` is present.
    const tools = createBobAgent().tools;
    const webSearch = tools.find((tool) => tool.name === 'web_search');

    expect(webSearch).toBeDefined();
    // It is a HOSTED tool: it runs remotely on OpenAI's side (hosted MCP), we own
    // no router/fetch/result handling (STACK.md Reject list).
    expect(webSearch?.type).toBe('hosted_tool');
  });
});
