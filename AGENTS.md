# giltiq-mcp — Agent Rules

Client-side MCP server for the Giltiq VAT validation API, published as `@giltiq/mcp` on npm. Stdio transport only: an MCP host (Claude Desktop, Cursor, Claude Code) launches it as a subprocess on the user's machine and it calls `api.giltiq.de` over HTTPS like any REST client. No server-side infrastructure.

- Exposes the same tool set as the hosted `giltiq-mcp-server` (`mcp.giltiq.de`): validate, status, usage, register, plus qualified-confirmation and receipt retrieval. The two repos are kept in lockstep; neither supersedes the other (DECISIONS.md, DECISION-007 in the workspace root).
- TypeScript ESM, Biome (tabs), Vitest (`npm test`). Quality gates before commit: `npx biome check .`, `npm run build`, `npm test`.
- Agent commits: `agent: <type>(<scope>): <description>`.
- Workspace-wide rules (protected paths, production SSH freeze, API-parity pre-flight) live in `../CLAUDE.md` and `../giltiq-agent/CLAUDE.md`.


## Project memory (Hindsight)

This repo is scoped to the shared `giltiq` Hindsight bank (see `.pi/hindsight.json`), which holds both engineering context and company strategy (business plan, DECISIONS.md, hypotheses, gate state). Before scouting the codebase or re-deriving architecture, check the `hindsight_knowledge` tool (action "search" or "tree", then "get") for existing pages — component map, core concepts, conventions, key decisions, initiatives. They refresh automatically from project memory. Use `hindsight_recall` for dated facts (what was decided when, what shipped vs. what a card claims). When you learn something durable — a decision, a root cause, an incident, a market signal — retain it with `hindsight_retain` and name the source.
