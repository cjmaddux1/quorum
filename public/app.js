const $ = (id) => document.getElementById(id);
const COLOR_VAR = {
  blue: '--blue',
  violet: '--violet',
  green: '--green',
  amber: '--amber',
  red: '--red',
};
const state = {
  turns: [],
  lastPrompt: '',
  busy: false,
  councilId: 'supreme-court',
  agents: {},
  councils: [],
  hasOpenRouterKey: false,
  models: null,
};

function activeCouncil() {
  return (
    state.councils.find((c) => c.id === state.councilId) || state.councils[0]
  );
}
function setBusy(
  value,
  title = 'Court in session',
  detail = 'Members are inspecting the project…',
) {
  state.busy = value;
  $('busy').classList.toggle('hidden', !value);
  $('busyTitle').textContent = title;
  $('busyDetail').textContent = detail;
  $('discussBtn').disabled = value;
  const council = activeCouncil();
  const canImplement = new Set(council?.agents || []).has('codex');
  $('implementBtn').disabled = value || !state.lastPrompt || !canImplement;
}

function turn(role, label, content, colorVar) {
  const el = document.createElement('article');
  el.className = `turn ${role}`;
  if (colorVar) el.style.borderTopColor = `var(${colorVar})`;
  const head = document.createElement('div');
  head.className = 'turn-head';
  const who = document.createElement('span');
  who.textContent = label;
  const time = document.createElement('span');
  time.textContent = new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  head.append(who, time);
  const body = document.createElement('div');
  body.className = 'turn-body';
  body.textContent = content;
  el.append(head, body);
  return el;
}
function context() {
  return state.turns.map((x) => `${x.role}: ${x.text}`).join('\n\n');
}
async function api(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function agentRow(agent, rank) {
  const el = document.createElement('div');
  el.className = 'agent-row';
  const symbol = document.createElement('span');
  symbol.className = 'agent-symbol';
  const colorVar = COLOR_VAR[agent.color] || '--amber';
  symbol.style.color = `var(${colorVar})`;
  symbol.style.borderColor = `var(${colorVar})`;
  symbol.textContent = agent.symbol || agent.label[0];
  const mid = document.createElement('div');
  const strong = document.createElement('strong');
  strong.textContent = agent.label;
  const small = document.createElement('small');
  small.id = `ver-${agent.id}`;
  small.textContent =
    agent.online === false
      ? 'not detected'
      : agent.online === true
        ? agent.version || 'online'
        : 'connecting…';
  mid.append(strong, small);
  if (rank) {
    const badge = document.createElement('small');
    badge.className = 'rank-badge';
    badge.textContent = `★ ${rank.average} · ${rank.runs} run${rank.runs === 1 ? '' : 's'}`;
    mid.append(badge);
  }
  const dot = document.createElement('span');
  dot.className = `status-dot${agent.online ? ' online' : agent.online === false ? ' offline' : ''}`;
  el.append(symbol, mid, dot);
  if (agent.removable) {
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'agent-remove';
    removeBtn.textContent = '✕';
    removeBtn.title = `Remove ${agent.label}`;
    removeBtn.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (!confirm(`Remove ${agent.label}?`)) return;
      try {
        const response = await fetch(
          `/api/agents/${encodeURIComponent(agent.id)}`,
          {
            method: 'DELETE',
          },
        );
        if (!response.ok) throw new Error((await response.json()).error);
        await loadConfig();
      } catch (error) {
        alert(`Couldn't remove ${agent.label}: ${error.message}`);
      }
    });
    el.append(removeBtn);
  }
  return el;
}

function renderMembers() {
  const council = activeCouncil();
  if (!council) return;
  const memberIds = new Set(council.agents || []);
  const allAgents = Object.values(state.agents);
  const members = allAgents.filter((a) => memberIds.has(a.id));
  const others = allAgents.filter((a) => !memberIds.has(a.id));
  $('inSession').replaceChildren(
    ...members.map((a) => agentRow(a, (council.rankings || {})[a.id])),
  );
  $('holdingCell').replaceChildren(...others.map((a) => agentRow(a)));
  $('holdingEyebrow').classList.toggle('hidden', others.length === 0);
  $('noAgents').classList.toggle('hidden', members.length > 0);
  $('councilTagline').textContent = council.tagline || '';
  $('emptyHeadline').textContent = members.length
    ? `Put ${council.name} on the same problem.`
    : `${council.name} has no members yet.`;
  $('modeLabel').textContent = `${council.name} · read only`;
  $('discussBtn').textContent =
    members.length > 1
      ? 'CONVENE ↗'
      : members.length === 1
        ? `ASK ${members[0].label.toUpperCase()} ↗`
        : 'NO AGENTS ↗';
  $('discussBtn').disabled = state.busy || members.length === 0;
  $('benchmarkBtn').disabled = state.busy || members.length === 0;
  const canImplement = memberIds.has('codex');
  $('implementBtn').disabled = state.busy || !state.lastPrompt || !canImplement;
  $('implementNote').textContent = canImplement
    ? 'Codex implements, Claude reviews, and Codex gets one correction pass.'
    : `Codex isn't seated on ${council.name}, so implementation is unavailable here.`;
}

function renderCouncils() {
  $('councilTabs').replaceChildren(
    ...state.councils.map((c) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `council-tab${c.id === state.councilId ? ' active' : ''}`;
      btn.textContent = c.name;
      btn.addEventListener('click', () => selectCouncil(c.id));
      return btn;
    }),
  );
}

function selectCouncil(id) {
  if (id === state.councilId) return;
  if (
    state.turns.length &&
    !confirm(
      `Switch to ${state.councils.find((c) => c.id === id)?.name}? This clears the current room.`,
    )
  )
    return;
  state.councilId = id;
  clearRoom();
  renderCouncils();
  renderMembers();
}

async function loadConfig() {
  try {
    const data = await (await fetch('/api/config')).json();
    state.agents = Object.fromEntries(
      (data.agents || []).map((a) => [a.id, a]),
    );
    state.councils = data.councils || [];
    state.hasOpenRouterKey = Boolean(data.hasOpenRouterKey);
  } catch {
    state.agents = {
      codex: { id: 'codex', label: 'Codex', symbol: 'C', color: 'blue' },
      claude: {
        id: 'claude',
        label: 'Claude Code',
        symbol: 'A',
        color: 'violet',
      },
    };
    state.councils = [
      {
        id: 'supreme-court',
        name: 'Supreme Court',
        tagline: 'Every agent, every voice.',
        agents: ['codex', 'claude'],
        rankings: {},
      },
    ];
  }
  if (!state.councils.some((c) => c.id === state.councilId))
    state.councilId = state.councils[0]?.id || 'supreme-court';
  renderCouncils();
  renderMembers();
}

async function discuss(prompt) {
  $('emptyState').classList.add('hidden');
  $('transcript').append(turn('user', 'YOU', prompt));
  state.turns.push({ role: 'You', text: prompt });
  state.lastPrompt = prompt;
  setBusy(true);
  try {
    const result = await api('/api/discuss', {
      prompt,
      project: $('project').value,
      councilId: state.councilId,
      history: context(),
    });
    const positions = result.positions || [];
    const box = document.createElement('div');
    box.className = 'positions';
    box.style.gridTemplateColumns = `repeat(${Math.max(positions.length, 1)}, 1fr)`;
    for (const p of positions) {
      const agent = state.agents[p.agent];
      box.append(
        turn(
          p.agent,
          `${(p.label || p.agent).toUpperCase()} · POSITION`,
          p.output,
          agent ? COLOR_VAR[agent.color] : null,
        ),
      );
    }
    $('transcript').append(box);
    state.turns.push(
      ...positions.map((p) => ({ role: p.label || p.agent, text: p.output })),
      { role: 'Consensus', text: result.consensus },
    );
    $('decisionEmpty').classList.add('hidden');
    $('decisionContent').classList.remove('hidden');
    $('decisionContent').textContent = result.consensus;
    if (result.agreement) {
      $('agreementEmpty').classList.add('hidden');
      $('agreementContent').classList.remove('hidden');
      $('agreementContent').textContent = result.agreement;
    } else {
      $('agreementEmpty').classList.remove('hidden');
      $('agreementContent').classList.add('hidden');
      $('agreementContent').textContent = '';
    }
    $('implementBtn').disabled = false;
  } catch (error) {
    $('transcript').append(turn('error', 'SYSTEM ERROR', error.message));
  } finally {
    setBusy(false);
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }
}

$('promptForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const prompt = $('prompt').value.trim();
  if (!prompt || state.busy) return;
  $('prompt').value = '';
  await discuss(prompt);
});
$('prompt').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey))
    $('promptForm').requestSubmit();
});
$('implementBtn').addEventListener('click', async () => {
  const council = activeCouncil();
  if (!new Set(council?.agents || []).has('codex')) {
    $('transcript').append(
      turn(
        'error',
        'SYSTEM ERROR',
        `Codex isn't seated on ${council?.name || 'this court'}.`,
      ),
    );
    return;
  }
  if (
    !state.lastPrompt ||
    state.busy ||
    !confirm(
      'Let Codex edit the selected project and Claude Code review the result?',
    )
  )
    return;
  setBusy(
    true,
    'Implementation underway',
    'Codex is building; Claude Code will review next…',
  );
  try {
    const result = await api('/api/implement', {
      prompt: state.lastPrompt,
      project: $('project').value,
      councilId: state.councilId,
    });
    $('transcript').append(
      turn('codex', 'IMPLEMENTATION REPORT', result.output),
    );
    state.turns.push({ role: 'Implementation', text: result.output });
  } catch (error) {
    $('transcript').append(
      turn('error', 'IMPLEMENTATION ERROR', error.message),
    );
  } finally {
    setBusy(false);
  }
});
$('benchmarkBtn').addEventListener('click', async () => {
  if (state.busy) return;
  const council = activeCouncil();
  if (!council || !(council.agents || []).length) return;
  setBusy(
    true,
    'Benchmark underway',
    `Scoring ${council.name} on its specialty…`,
  );
  try {
    const result = await api('/api/benchmark', {
      project: $('project').value,
      councilId: state.councilId,
    });
    const idx = state.councils.findIndex((c) => c.id === result.council);
    if (idx >= 0) state.councils[idx].rankings = result.rankings;
    renderMembers();
    $('transcript').append(
      turn('consensus', 'BENCHMARK VERDICT', result.verdict),
    );
  } catch (error) {
    $('transcript').append(turn('error', 'BENCHMARK ERROR', error.message));
  } finally {
    setBusy(false);
  }
});
function clearRoom() {
  state.turns = [];
  state.lastPrompt = '';
  $('transcript').replaceChildren();
  $('emptyState').classList.remove('hidden');
  $('decisionEmpty').classList.remove('hidden');
  $('decisionContent').classList.add('hidden');
  $('decisionContent').textContent = '';
  $('agreementEmpty').classList.remove('hidden');
  $('agreementContent').classList.add('hidden');
  $('agreementContent').textContent = '';
  $('implementBtn').disabled = true;
}
$('clearBtn').addEventListener('click', () => {
  if (state.turns.length && !confirm("Clear this room's visible conversation?"))
    return;
  clearRoom();
});

function rankRow(rankNum, name, sub, score) {
  const el = document.createElement('div');
  el.className = 'rank-row';
  const num = document.createElement('span');
  num.className = 'rank-num';
  num.textContent = `#${rankNum}`;
  const mid = document.createElement('div');
  const strong = document.createElement('strong');
  strong.className = 'rank-name';
  strong.textContent = name;
  const small = document.createElement('small');
  small.className = 'rank-sub';
  small.textContent = sub;
  mid.append(strong, small);
  const scoreEl = document.createElement('span');
  scoreEl.className = 'rank-score';
  scoreEl.textContent = score;
  el.append(num, mid, scoreEl);
  return el;
}

function renderLeaderboard() {
  const overall = {};
  let anyRankings = false;
  for (const council of state.councils) {
    const rankings = council.rankings || {};
    for (const [agentId, r] of Object.entries(rankings)) {
      anyRankings = true;
      const entry = overall[agentId] || { totalAverage: 0, courts: 0, runs: 0 };
      entry.totalAverage += r.average;
      entry.courts += 1;
      entry.runs += r.runs;
      overall[agentId] = entry;
    }
  }

  if (!anyRankings) {
    $('overallBoard').replaceChildren();
    $('courtBoards').replaceChildren();
    const empty = document.createElement('p');
    empty.className = 'board-empty';
    empty.textContent =
      'No benchmarks run yet — use RUN BENCHMARK on a court to populate the leaderboard.';
    $('overallBoard').append(empty);
    return;
  }

  const overallRanked = Object.entries(overall)
    .map(([agentId, e]) => ({
      agentId,
      composite: Math.round((e.totalAverage / e.courts) * 10) / 10,
      courts: e.courts,
      runs: e.runs,
    }))
    .sort((a, b) => b.composite - a.composite);
  const overallTitle = document.createElement('div');
  overallTitle.className = 'board-title';
  overallTitle.textContent = 'OVERALL';
  const overallRows = overallRanked.map((e, i) =>
    rankRow(
      i + 1,
      state.agents[e.agentId]?.label || e.agentId,
      `across ${e.courts} court${e.courts === 1 ? '' : 's'} · ${e.runs} run${e.runs === 1 ? '' : 's'}`,
      e.composite,
    ),
  );
  $('overallBoard').replaceChildren(overallTitle, ...overallRows);

  const courtBoards = state.councils
    .filter((c) => Object.keys(c.rankings || {}).length > 0)
    .map((c) => {
      const ranked = Object.entries(c.rankings)
        .map(([agentId, r]) => ({ agentId, ...r }))
        .sort((a, b) => b.average - a.average);
      const board = document.createElement('div');
      board.className = 'board';
      const title = document.createElement('div');
      title.className = 'board-title';
      title.textContent = c.name.toUpperCase();
      board.append(
        title,
        ...ranked.map((r, i) =>
          rankRow(
            i + 1,
            state.agents[r.agentId]?.label || r.agentId,
            `${r.runs} run${r.runs === 1 ? '' : 's'}`,
            r.average,
          ),
        ),
      );
      return board;
    });
  $('courtBoards').replaceChildren(...courtBoards);
}

$('leaderboardBtn').addEventListener('click', () => {
  renderLeaderboard();
  $('leaderboardOverlay').classList.remove('hidden');
});
$('leaderboardCloseBtn').addEventListener('click', () => {
  $('leaderboardOverlay').classList.add('hidden');
});
$('leaderboardOverlay').addEventListener('click', (event) => {
  if (event.target.id === 'leaderboardOverlay')
    $('leaderboardOverlay').classList.add('hidden');
});

async function loadModelCatalog() {
  if (state.models) return state.models;
  const data = await (await fetch('/api/openrouter/models')).json();
  state.models = data.models || [];
  return state.models;
}

function renderModelOptions(filter) {
  const query = (filter || '').trim().toLowerCase();
  const models = state.models || [];
  const matches = query
    ? models.filter(
        (m) =>
          m.id.toLowerCase().includes(query) ||
          m.name.toLowerCase().includes(query),
      )
    : models;
  $('agentModel').replaceChildren(
    ...matches.slice(0, 200).map((m) => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name === m.id ? m.id : `${m.name} — ${m.id}`;
      return opt;
    }),
  );
}

async function openAddAgentModal() {
  $('addAgentError').classList.add('hidden');
  $('addAgentForm').reset();
  $('tagGeneral').checked = true;
  const needsKey = !state.hasOpenRouterKey;
  $('agentKeyLabel').classList.toggle('hidden', !needsKey);
  $('agentKey').classList.toggle('hidden', !needsKey);
  $('agentKey').required = needsKey;
  $('agentKeyHint').textContent = needsKey
    ? 'Get one at openrouter.ai/keys — pastes once, reused for every agent you add.'
    : 'Using the OpenRouter key already on file.';
  $('addAgentOverlay').classList.remove('hidden');
  $('agentModelSearch').value = '';
  const loading = document.createElement('option');
  loading.textContent = 'Loading models…';
  $('agentModel').replaceChildren(loading);
  try {
    await loadModelCatalog();
    renderModelOptions('');
  } catch (error) {
    const err = document.createElement('option');
    err.textContent = `Couldn't load models: ${error.message}`;
    $('agentModel').replaceChildren(err);
  }
}
function closeAddAgentModal() {
  $('addAgentOverlay').classList.add('hidden');
}

$('addAgentBtn').addEventListener('click', openAddAgentModal);
$('addAgentCloseBtn').addEventListener('click', closeAddAgentModal);
$('addAgentOverlay').addEventListener('click', (event) => {
  if (event.target.id === 'addAgentOverlay') closeAddAgentModal();
});
$('agentModelSearch').addEventListener('input', () =>
  renderModelOptions($('agentModelSearch').value),
);

$('addAgentForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('addAgentError').classList.add('hidden');
  const model = $('agentModel').value;
  if (!model) {
    $('addAgentError').textContent = 'Pick a model from the list.';
    $('addAgentError').classList.remove('hidden');
    return;
  }
  const tags = [];
  if ($('tagGeneral').checked) tags.push('coding', 'general');
  if ($('tagImage').checked) tags.push('image');
  if ($('tagStl').checked) tags.push('stl');
  const payload = { label: $('agentLabel').value.trim() || model, model, tags };
  if (!state.hasOpenRouterKey) payload.apiKey = $('agentKey').value.trim();
  $('addAgentSubmitBtn').disabled = true;
  $('addAgentSubmitBtn').textContent = 'ADDING…';
  try {
    const response = await fetch('/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not add agent');
    closeAddAgentModal();
    await loadConfig();
  } catch (error) {
    $('addAgentError').textContent = error.message;
    $('addAgentError').classList.remove('hidden');
  } finally {
    $('addAgentSubmitBtn').disabled = false;
    $('addAgentSubmitBtn').textContent = 'ADD AGENT';
  }
});

loadConfig().then(() =>
  fetch('/api/health')
    .then(async (r) => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Agent check failed');
      return data;
    })
    .then((data) => {
      const agents = data.agents || [];
      for (const a of agents) {
        if (state.agents[a.id]) {
          state.agents[a.id].online = a.ok;
          state.agents[a.id].version = a.ok ? a.version : a.error;
        }
      }
      const onlineCount = agents.filter((a) => a.ok).length;
      $('systemLabel').textContent = !agents.length
        ? 'NO AGENTS CONFIGURED'
        : onlineCount === agents.length
          ? 'ALL AGENTS ONLINE'
          : onlineCount === 0
            ? 'ALL AGENTS OFFLINE'
            : `${onlineCount}/${agents.length} AGENTS ONLINE`;
      if (onlineCount === 0)
        document.querySelector('.pulse').style.background = 'var(--red)';
      renderMembers();
    })
    .catch((error) => {
      $('systemLabel').textContent = 'AGENT CHECK FAILED';
      document.querySelector('.pulse').style.background = 'var(--red)';
      console.error(error);
    }),
);
