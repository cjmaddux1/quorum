// Quorum's agent roster. Add, remove, or edit entries here to change which AI CLIs are
// available — no changes to server.mjs or the frontend are needed. If you only have Codex
// and one other CLI installed, delete the entries you don't have (or never add Claude at
// all) and Quorum adapts: courts, the sidebar, and the Holding Cell all read this list.
//
// Requirements for an agent to work here: it must be runnable non-interactively (no
// prompts it blocks on), accept a text prompt either as a command-line argument or over
// stdin, and print its final answer as plain text to stdout, exiting 0 on success.
//
// Field reference:
//   id          unique short id (lowercase, no spaces) — used internally and in URLs
//   label       display name shown in the UI
//   symbol      one letter shown in the sidebar badge
//   color       "blue" | "violet" | "green" | "amber" | "red" — reused across the UI
//   tags        which courts this agent sits on. "general" + "coding" seats it on
//               Supreme Court and Circuit Court; add "image" or "stl" for those courts,
//               or invent your own tag and a matching court (see server.mjs COUNCILS).
//   command     the executable to spawn. A bare name (e.g. "gemini") is resolved via
//               PATH; a full path also works.
//   prefix      optional args to prepend before every call, e.g. a script path when
//               `command` is a runtime like `node` (see the Codex entry below).
//   versionArgs args that make the tool print its version, for the health check.
//   askArgs     args for asking the agent a question. Use the literal string "{cwd}" as
//               a whole array element for the working directory. If promptVia is "arg",
//               also include the literal string "{prompt}" as a whole array element —
//               it gets replaced with the actual prompt text. If promptVia is "stdin",
//               put whatever flag/value your tool uses to mean "read the prompt from
//               stdin" there instead (Codex uses a literal "-").
//   promptVia   "arg" — the prompt is substituted into askArgs. Simple, but long room
//               history gets truncated to stay under command-line length limits.
//               "stdin" — the prompt is piped over stdin instead. No length limit, so
//               prefer this for tools that support it.
//
// A Windows note: some npm-installed CLIs ship as a `.cmd` shim, which Quorum's
// `shell: false` process spawning won't execute directly (this is a real Node.js/Windows
// limitation, not a bug here). If your tool doesn't run, point `command` at the actual
// script Node should run (see the Codex entry, which does exactly this) rather than the
// shim on PATH.

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const USER_HOME = process.env.USERPROFILE || process.env.HOME || '.';
const APP_DATA =
  process.env.APPDATA || path.join(USER_HOME, 'AppData', 'Roaming');
const LOCAL_APP_DATA =
  process.env.LOCALAPPDATA || path.join(USER_HOME, 'AppData', 'Local');

// Codex's Windows installs are a plain JS file, not a directly-executable binary, and
// where that file lives differs between a plain `npm install -g` and an MSIX-packaged
// install (e.g. via winget). This resolves both; override entirely with DUET_CODEX_COMMAND
// if you install it somewhere else.
function resolveCodexScript() {
  const npmInstall = path.join(
    APP_DATA,
    'npm',
    'node_modules',
    '@openai',
    'codex',
    'bin',
    'codex.js',
  );
  if (existsSync(npmInstall)) return npmInstall;
  const packagesDir = path.join(LOCAL_APP_DATA, 'Packages');
  const pkg = existsSync(packagesDir)
    ? readdirSync(packagesDir).find((name) => name.startsWith('OpenAI.Codex_'))
    : undefined;
  if (pkg) {
    const packaged = path.join(
      packagesDir,
      pkg,
      'LocalCache',
      'Roaming',
      'npm',
      'node_modules',
      '@openai',
      'codex',
      'bin',
      'codex.js',
    );
    if (existsSync(packaged)) return packaged;
  }
  return npmInstall; // fall through so the original error message still points somewhere sensible
}

export const AGENTS = [
  {
    id: 'codex',
    label: 'Codex',
    symbol: 'C',
    color: 'blue',
    tags: ['coding', 'general'],
    command: process.env.DUET_CODEX_COMMAND || process.execPath,
    prefix: process.env.DUET_CODEX_COMMAND ? [] : [resolveCodexScript()],
    versionArgs: ['--version'],
    askArgs: [
      'exec',
      '--color',
      'never',
      '--config',
      'model_reasoning_effort="low"',
      '--sandbox',
      'read-only',
      '--cd',
      '{cwd}',
      '--skip-git-repo-check',
      '-',
    ],
    promptVia: 'stdin',
  },
  {
    id: 'claude',
    label: 'Claude Code',
    symbol: 'A',
    color: 'violet',
    tags: ['coding', 'general'],
    command:
      process.env.DUET_CLAUDE_COMMAND ||
      path.join(USER_HOME, '.local', 'bin', 'claude.exe'),
    prefix: [],
    versionArgs: ['--version'],
    askArgs: [
      '--print',
      '{prompt}',
      '--output-format',
      'text',
      '--permission-mode',
      'plan',
      '--tools',
      'Read,Glob,Grep,WebSearch,WebFetch',
    ],
    promptVia: 'arg',
  },

  // --- Add your own agents below. A couple of worked examples: ---
  //
  // Gemini CLI (github.com/google-gemini/gemini-cli), asked read-only, prompt as an arg:
  // {
  //   id: 'gemini', label: 'Gemini', symbol: 'G', color: 'green', tags: ['coding', 'general'],
  //   command: process.env.DUET_GEMINI_COMMAND || 'gemini', prefix: [],
  //   versionArgs: ['--version'],
  //   askArgs: ['--prompt', '{prompt}', '--approval-mode', 'default'],
  //   promptVia: 'arg',
  // },
  //
  // A hypothetical image-generation CLI that reads its prompt from stdin, seated on
  // The Gallery court instead of the coding courts:
  // {
  //   id: 'imagegen', label: 'ImageGen', symbol: 'I', color: 'red', tags: ['image'],
  //   command: 'imagegen', prefix: [],
  //   versionArgs: ['--version'],
  //   askArgs: ['generate', '--out-dir', '{cwd}', '--prompt-stdin'],
  //   promptVia: 'stdin',
  // },
];
