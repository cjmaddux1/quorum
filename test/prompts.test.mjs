import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { positionPrompt } from '../prompts.mjs';
import { run } from '../server.mjs';

const AGENT = { id: 'codex', label: 'Codex', promptVia: 'stdin' };
const ARG_AGENT = { id: 'claude', label: 'Claude Code', promptVia: 'arg' };

test('stdin-fed agents keep the complete history untruncated', () => {
  const history = `You: original budget is $500\n${'Long earlier response. '.repeat(4000)}\nYou: also make it blue`;
  const prompt = 'Extra detail. '.repeat(1100);
  const result = positionPrompt(
    AGENT,
    { history, prompt },
    { unlimited: true },
  );
  assert.ok(result.includes(history));
  assert.ok(result.includes(prompt));
  assert.ok(
    !positionPrompt(
      AGENT,
      { prompt: 'new room' },
      { unlimited: true },
    ).includes('original budget'),
  );
});

test('arg-fed agents truncate history to stay under command-line limits', () => {
  const history = `EARLY REQUIREMENT\n${'x'.repeat(30000)}\nLATEST DETAIL`;
  const result = positionPrompt(
    ARG_AGENT,
    { history, prompt: 'go' },
    { unlimited: false },
  );
  assert.ok(result.includes('LATEST DETAIL'));
  assert.ok(!result.includes('EARLY REQUIREMENT'));
});

test('browser sends every room turn and clears its context with the room', async () => {
  const elements = new Map();
  const element = () => ({
    value: '',
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    append() {},
    replaceChildren() {},
    addEventListener(type, fn) {
      this[type] = fn;
    },
  });
  const requests = [];
  const sandbox = {
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, element());
        return elements.get(id);
      },
      createElement: element,
      body: { scrollHeight: 0 },
      querySelectorAll: () => [],
      querySelector: element,
    },
    window: { scrollTo() {} },
    confirm: () => true,
    console,
    fetch: async (url, options) => {
      if (options) requests.push(JSON.parse(options.body));
      if (url === '/api/health')
        return { ok: true, json: async () => ({ ok: true, agents: [] }) };
      if (url === '/api/config')
        return {
          ok: true,
          json: async () => ({
            agents: [
              { id: 'codex', label: 'Codex', symbol: 'C', color: 'blue' },
              {
                id: 'claude',
                label: 'Claude Code',
                symbol: 'A',
                color: 'violet',
              },
            ],
            councils: [
              {
                id: 'supreme-court',
                name: 'Supreme Court',
                tagline: 'Every agent, every voice.',
                agents: ['codex', 'claude'],
                rankings: {},
              },
            ],
          }),
        };
      return {
        ok: true,
        json: async () => ({
          positions: [
            { agent: 'codex', label: 'Codex', output: 'c' },
            { agent: 'claude', label: 'Claude Code', output: 'a' },
          ],
          consensus: 's',
          agreement: '',
        }),
      };
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(
    await readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    sandbox,
  );
  await vm.runInContext('discuss("original budget is $500")', sandbox);
  await vm.runInContext('discuss("also make it blue")', sandbox);
  await vm.runInContext('discuss("and mobile friendly")', sandbox);
  assert.match(requests[2].history, /original budget is \$500/);
  assert.match(requests[2].history, /also make it blue/);
  elements.get('clearBtn').click();
  await vm.runInContext('discuss("fresh task")', sandbox);
  assert.doesNotMatch(requests[3].history, /original budget|make it blue/);
});

test('large stdin payloads travel intact', async () => {
  const input =
    'earliest requirement\n' + 'context '.repeat(16000) + '\nlatest addition';
  const output = await run(
    process.execPath,
    ['-e', 'process.stdin.pipe(process.stdout)'],
    {
      input,
    },
  );
  assert.equal(output, input);
});
