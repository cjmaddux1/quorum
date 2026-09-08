// Agents added at runtime through the "+ Add Agent" UI, backed by OpenRouter
// (openrouter.ai) — one API key unlocks nearly every hosted model. Stored locally in
// .data/dynamic-agents.json (gitignored: this file holds the raw API key, never commit
// or share it). These agents answer from the conversation text only — unlike Codex or
// Claude Code, they have no ability to read files in your project.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const OPENROUTER_API = 'https://openrouter.ai/api/v1';

export async function callOpenRouter(
  apiKey,
  model,
  prompt,
  { timeoutMs = 120000 } = {},
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${OPENROUTER_API}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'X-Title': 'Quorum',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(
        data.error?.message || `OpenRouter request failed (${response.status})`,
      );
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('OpenRouter returned an empty response.');
    return text.trim();
  } finally {
    clearTimeout(timer);
  }
}

let modelCatalogCache = null;
export async function fetchModelCatalog() {
  if (modelCatalogCache) return modelCatalogCache;
  const response = await fetch(`${OPENROUTER_API}/models`);
  if (!response.ok)
    throw new Error(`Could not reach OpenRouter (${response.status})`);
  const data = await response.json();
  modelCatalogCache = (data.data || [])
    .map((m) => ({ id: m.id, name: m.name || m.id }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return modelCatalogCache;
}

export function createAgentStore(dataDir) {
  const file = path.join(dataDir, 'dynamic-agents.json');

  async function load() {
    try {
      return JSON.parse(await readFile(file, 'utf8'));
    } catch {
      return { openrouterKey: '', agents: [] };
    }
  }
  async function save(state) {
    await mkdir(dataDir, { recursive: true });
    await writeFile(file, JSON.stringify(state, null, 2));
  }

  // One-time convenience: if no key is saved yet, borrow the OpenRouter key already
  // configured for the sibling AICouncil tool, so the user doesn't have to paste it
  // twice. Silently does nothing if that tool/file isn't present.
  async function importKeyFromSibling(rootDir) {
    const state = await load();
    if (state.openrouterKey) return state;
    const envPath = path.join(rootDir, '..', 'AICouncil', '.env');
    if (!existsSync(envPath)) return state;
    try {
      const text = await readFile(envPath, 'utf8');
      const match = /^OPENROUTER_API_KEY=(.+)$/m.exec(text);
      if (match && match[1].trim()) {
        state.openrouterKey = match[1].trim();
        await save(state);
      }
    } catch {
      // ignore — the user can paste a key manually in the UI instead
    }
    return state;
  }

  async function listAgents() {
    return (await load()).agents;
  }
  async function getKey() {
    return (await load()).openrouterKey;
  }

  async function addAgent({ label, model, tags, apiKey }) {
    const state = await load();
    const key = apiKey || state.openrouterKey;
    if (!key) throw new Error('An OpenRouter API key is required.');
    if (!model) throw new Error('A model is required.');

    // Validate the key/model combination for real before saving anything.
    await callOpenRouter(key, model, 'Reply with the single word: ok', {
      timeoutMs: 30000,
    });

    if (apiKey) state.openrouterKey = apiKey;
    const id = `or-${model.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${Date.now().toString(36)}`;
    const agent = {
      id,
      label: label || model,
      symbol: (label || model)[0]?.toUpperCase() || '?',
      color: 'amber',
      tags: tags && tags.length ? tags : ['coding', 'general'],
      provider: 'openrouter',
      model,
      removable: true,
    };
    state.agents.push(agent);
    await save(state);
    return agent;
  }

  async function removeAgent(id) {
    const state = await load();
    const before = state.agents.length;
    state.agents = state.agents.filter((a) => a.id !== id);
    if (state.agents.length === before) throw new Error('Agent not found.');
    await save(state);
  }

  return {
    load,
    importKeyFromSibling,
    listAgents,
    getKey,
    addAgent,
    removeAgent,
  };
}
