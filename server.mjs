import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENTS as AGENT_LIST } from './agents.config.mjs';
import {
  positionPrompt,
  synthesisPrompt,
  benchmarkTaskPrompt,
  benchmarkJudgePrompt,
} from './prompts.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const RANKINGS_FILE = path.join(ROOT, '.data', 'rankings.json');
const HOST = '127.0.0.1';
const PORT = Number(process.env.DUET_COUNCIL_PORT || 9977);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};
const USER_HOME = process.env.USERPROFILE || process.env.HOME || '.';

// The `duet` CLI (github project, not bundled here) is a separate tool used only by
// Implement — it isn't a council member, so it lives outside agents.config.mjs.
const DUET_TOOL = process.env.DUET_COMMAND
  ? { command: process.env.DUET_COMMAND, prefix: [] }
  : {
      command: process.execPath,
      prefix: [path.join(USER_HOME, 'duet', 'bin', 'duet.js')],
    };

// Every agent Quorum actually knows how to invoke, keyed by id. Add or remove agents in
// agents.config.mjs — this file has no agent-specific logic.
const AGENTS = Object.fromEntries(AGENT_LIST.map((a) => [a.id, a]));

// Courts. `tags: null` means every agent sits on it (Supreme Court). Otherwise an agent
// sits on a court if any of its tags match the court's tags.
const COUNCILS = [
  {
    id: 'supreme-court',
    name: 'Supreme Court',
    tagline: 'Every agent, every voice — for the calls that matter most.',
    tags: null,
  },
  {
    id: 'circuit-court',
    name: 'Circuit Court',
    tagline: 'Code, architecture, and engineering rulings.',
    tags: ['coding'],
  },
  {
    id: 'gallery',
    name: 'The Gallery',
    tagline: 'Image and visual creation.',
    tags: ['image'],
  },
  {
    id: 'foundry',
    name: 'The Foundry',
    tagline: 'STL and 3D fabrication.',
    tags: ['stl'],
  },
];

const BENCHMARK_TASKS = {
  coding: [
    'Write a one-line JavaScript function isPalindrome(str) that ignores case and non-alphanumeric characters. Reply with just the code.',
    'In three sentences or fewer, explain the difference between a race condition and a deadlock.',
  ],
  general: [
    'In three sentences or fewer, explain the tradeoff between consistency and availability in distributed systems.',
  ],
};

function councilById(id) {
  return COUNCILS.find((c) => c.id === id) || COUNCILS[0];
}
function agentsForCouncil(council) {
  const all = Object.values(AGENTS);
  return council.tags === null
    ? all
    : all.filter((a) => a.tags.some((t) => council.tags.includes(t)));
}
function tasksForCouncil(council) {
  return council.tags === null
    ? [...BENCHMARK_TASKS.coding, ...BENCHMARK_TASKS.general]
    : council.tags.flatMap((t) => BENCHMARK_TASKS[t] || []);
}
function publicAgent(a) {
  return {
    id: a.id,
    label: a.label,
    symbol: a.symbol,
    color: a.color,
    tags: a.tags,
  };
}

async function loadRankings() {
  try {
    return JSON.parse(await readFile(RANKINGS_FILE, 'utf8'));
  } catch {
    return {};
  }
}
async function saveRankings(rankings) {
  await mkdir(path.dirname(RANKINGS_FILE), { recursive: true });
  await writeFile(RANKINGS_FILE, JSON.stringify(rankings, null, 2));
}

export function run(command, args, { cwd, timeoutMs = 1_200_000, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
    });
    child.stdin.on('error', (error) => {
      if (error.code !== 'EPIPE') reject(error);
    });
    child.stdin.end(input);
    let stdout = '',
      stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} timed out`));
    }, timeoutMs);
    child.stdout.on('data', (data) => {
      stdout += data;
    });
    child.stderr.on('data', (data) => {
      stderr += data;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else
        reject(
          new Error(`${command} exited ${code}: ${stderr.trim().slice(-1200)}`),
        );
    });
  });
}

function runTool(tool, args, options) {
  return run(tool.command, [...(tool.prefix || []), ...args], options);
}

// Fills an agent's askArgs template: "{cwd}" and "{prompt}" as whole array elements are
// substituted; everything else passes through literally. See agents.config.mjs.
function fillTemplate(template, vars) {
  return template.map((a) => (a in vars ? vars[a] : a));
}

function callAgent(agent, prompt, cwd, options) {
  const args = fillTemplate(agent.askArgs, {
    '{cwd}': cwd,
    '{prompt}': prompt,
  });
  const runOptions = { cwd, ...options };
  if (agent.promptVia === 'stdin') runOptions.input = prompt;
  return runTool(agent, args, runOptions);
}
function checkVersion(agent) {
  return runTool(agent, agent.versionArgs, { timeoutMs: 15000 });
}

async function body(req) {
  let value = '';
  for await (const chunk of req) {
    value += chunk;
    if (Buffer.byteLength(value) > 16 * 1024 * 1024)
      throw new Error(
        'Room context exceeds the 16 MB request limit; no history was silently removed.',
      );
  }
  return JSON.parse(value || '{}');
}
async function projectPath(value) {
  const project = path.resolve(String(value || process.cwd()));
  if (!(await stat(project)).isDirectory())
    throw new Error('Project path must be a directory');
  return project;
}

function extractAgreement(consensus) {
  const text = String(consensus || '').trimStart();
  const match =
    /^AGREEMENT:\s*([\s\S]*?)\n\s*\n/i.exec(text) ||
    /^AGREEMENT:\s*([\s\S]*)$/i.exec(text);
  return match ? match[1].trim() : '';
}

async function healthCheck() {
  const list = Object.values(AGENTS);
  const settled = await Promise.allSettled(list.map((a) => checkVersion(a)));
  const agents = settled.map((r, i) =>
    r.status === 'fulfilled'
      ? { id: list[i].id, label: list[i].label, ok: true, version: r.value }
      : {
          id: list[i].id,
          label: list[i].label,
          ok: false,
          error: r.reason.message,
        },
  );
  return { ok: agents.some((a) => a.ok), agents };
}

async function discuss(payload) {
  const council = councilById(payload.councilId);
  const cwd = await projectPath(payload.project);
  const members = agentsForCouncil(council);
  if (!members.length)
    throw new Error(`No agents are currently assigned to ${council.name} yet.`);

  const settled = await Promise.allSettled(
    members.map(async (a) => ({
      agent: a.id,
      label: a.label,
      output: await callAgent(
        a,
        positionPrompt(a, payload, { unlimited: a.promptVia === 'stdin' }),
        cwd,
      ),
    })),
  );
  const results = settled.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : {
          agent: members[i].id,
          label: members[i].label,
          output: `ERROR: ${r.reason.message}`,
          failed: true,
        },
  );
  const usable = results.filter((r) => !r.failed);

  if (results.length === 1) {
    if (results[0].failed)
      throw new Error(results[0].output.replace(/^ERROR: /, ''));
    return {
      council: council.id,
      positions: results,
      consensus: results[0].output,
      agreement: '',
    };
  }
  if (!usable.length)
    throw new Error(
      `Every agent on ${council.name} failed to respond. First error: ${results[0].output}`,
    );

  const chair = usable.find((r) => r.agent === 'claude') || usable[0];
  const chairAgent = AGENTS[chair.agent];
  const consensus = await callAgent(
    chairAgent,
    synthesisPrompt(chairAgent, council, payload, results, {
      unlimited: chairAgent.promptVia === 'stdin',
    }),
    cwd,
  );
  return {
    council: council.id,
    positions: results,
    consensus,
    agreement: extractAgreement(consensus),
  };
}

async function implement(payload) {
  const council = councilById(payload.councilId);
  const cwd = await projectPath(payload.project);
  const task = String(payload.prompt || '').slice(0, 12000);
  if (!task) throw new Error('A task is required');
  if (!agentsForCouncil(council).some((a) => a.id === 'codex'))
    throw new Error(
      `Codex isn't seated on ${council.name}; implementation is unavailable here.`,
    );
  return {
    output: await runTool(DUET_TOOL, ['run', '--project', cwd, task], {
      cwd,
      timeoutMs: 2_400_000,
    }),
  };
}

async function benchmark(payload) {
  const council = councilById(payload.councilId);
  const cwd = await projectPath(payload.project);
  const members = agentsForCouncil(council);
  if (!members.length)
    throw new Error(`No agents are currently assigned to ${council.name} yet.`);
  const tasks = tasksForCouncil(council);

  const answers = await Promise.all(
    members.map(async (a) => ({
      agent: a.id,
      label: a.label,
      answers: await Promise.all(
        tasks.map((t) =>
          callAgent(a, benchmarkTaskPrompt(t), cwd).catch(
            (error) => `ERROR: ${error.message}`,
          ),
        ),
      ),
    })),
  );

  const judge = answers.find((a) => a.agent === 'claude') || answers[0];
  const judgeAgent = AGENTS[judge.agent];
  const verdict = await callAgent(
    judgeAgent,
    benchmarkJudgePrompt(council, tasks, answers),
    cwd,
  );

  const scores = {};
  for (const m of verdict.matchAll(/SCORE\s+(\S+):\s*(\d+(?:\.\d+)?)/gi))
    scores[m[1].toLowerCase()] = Number(m[2]);

  const rankings = await loadRankings();
  rankings[council.id] = rankings[council.id] || {};
  const now = new Date().toISOString();
  for (const a of members) {
    const score = scores[a.id];
    if (score == null) continue;
    const prev = rankings[council.id][a.id] || { runs: 0, average: 0 };
    const runs = prev.runs + 1;
    const average =
      Math.round(((prev.average * prev.runs + score) / runs) * 10) / 10;
    rankings[council.id][a.id] = {
      lastScore: score,
      average,
      runs,
      lastRun: now,
    };
  }
  await saveRankings(rankings);
  return { council: council.id, verdict, rankings: rankings[council.id] };
}

async function configResponse() {
  const rankings = await loadRankings();
  return {
    agents: Object.values(AGENTS).map(publicAgent),
    councils: COUNCILS.map((c) => ({
      ...c,
      agents: agentsForCouncil(c).map((a) => a.id),
      rankings: rankings[c.id] || {},
    })),
  };
}

function send(res, status, value) {
  const data = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(data);
}
async function staticFile(req, res) {
  const name = req.url === '/' ? 'index.html' : req.url.slice(1).split('?')[0];
  const file = path.resolve(PUBLIC, name);
  if (!file.startsWith(PUBLIC + path.sep))
    return send(res, 403, { error: 'Forbidden' });
  try {
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy':
        "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
    });
    res.end(data);
  } catch {
    send(res, 404, { error: 'Not found' });
  }
}

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/api/health')
        return send(res, 200, await healthCheck());
      if (req.method === 'GET' && req.url === '/api/config')
        return send(res, 200, await configResponse());
      if (req.method === 'POST' && req.url === '/api/discuss')
        return send(res, 200, await discuss(await body(req)));
      if (req.method === 'POST' && req.url === '/api/implement')
        return send(res, 200, await implement(await body(req)));
      if (req.method === 'POST' && req.url === '/api/benchmark')
        return send(res, 200, await benchmark(await body(req)));
      if (req.method === 'GET') return staticFile(req, res);
      send(res, 405, { error: 'Method not allowed' });
    } catch (error) {
      send(res, 500, { error: error.message || 'Unexpected error' });
    }
  });
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  createServer().listen(PORT, HOST, () =>
    console.log(`Quorum ready at http://${HOST}:${PORT}/`),
  );
