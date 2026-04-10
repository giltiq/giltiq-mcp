import { describe, expect, it, vi } from "vitest";
import { createGiltiqServer } from "./server.js";

// Mock fetch for the API client
function mockFetch(
	responses: Record<string, { status: number; ok: boolean; body: unknown }>,
) {
	return vi.fn(async (url: string) => {
		for (const [pattern, response] of Object.entries(responses)) {
			if (url.includes(pattern)) {
				return {
					ok: response.ok,
					status: response.status,
					json: async () => response.body,
				};
			}
		}
		return {
			ok: false,
			status: 404,
			json: async () => ({ error: "not found" }),
		};
	});
}

const VALID_RESPONSE = {
	valid: true,
	vat_id: "DE811575812",
	country_code: "DE",
	vat_number: "811575812",
	company_name: "Bundeszentralamt für Steuern",
	company_address: "An der Küppe 1, 53225 Bonn",
	source: "vies",
	source_timestamp: "2026-03-25T09:58:12.000Z",
	cache: false,
	qualified_confirmation: null,
	request_id: "req_01",
	requested_at: "2026-03-25T10:00:00.000Z",
};

const STATUS_RESPONSE = {
	sources: {
		vies: {
			status: "operational",
			latency_ms: 42,
			last_checked: "2026-03-25T10:00:00.000Z",
		},
		bzst: {
			status: "operational",
			latency_ms: 50,
			last_checked: "2026-03-25T10:00:00.000Z",
		},
		cache: { status: "operational" },
	},
	active_source: "bzst",
	failover_active: false,
};

const USAGE_RESPONSE = {
	plan: "free",
	period: {
		start: "2026-03-01T00:00:00.000Z",
		end: "2026-04-01T00:00:00.000Z",
	},
	requests: { used: 23, remaining: 77, limit: 100 },
};

const QUALIFIED_RESPONSE = {
	...VALID_RESPONSE,
	source: "bzst",
	qualified_confirmation: {
		name_match: "match",
		street_match: "not_queried",
		city_match: "match",
		zip_match: "match",
		receipt_id: "GQ-QC-20260325-A7K2M9P4R3",
		issued_at: "2026-03-25T10:00:00.000Z",
	},
};

const STORED_RECEIPT = {
	receipt_id: "GQ-QC-20260325-A7K2M9P4R3",
	issued_at: "2026-03-25T10:00:00.000Z",
	vat_id: "DE811575812",
	company_name: "BZSt",
	company_street: null,
	company_zip: "53225",
	company_city: "Bonn",
	name_match: "match",
	street_match: "not_queried",
	zip_match: "match",
	city_match: "match",
	official_name: "Bundeszentralamt für Steuern",
	official_address: "An der Küppe 1, 53225 Bonn",
};

describe("createGiltiqServer", () => {
	it("returns an McpServer instance", () => {
		const { mcpServer } = createGiltiqServer({ fetchFn: mockFetch({}) });
		expect(mcpServer).toBeDefined();
		expect(mcpServer.server).toBeDefined();
	});

	describe("tool registration", () => {
		it("registers validate_vat_id and check_api_status by default", () => {
			const { mcpServer } = createGiltiqServer({ fetchFn: mockFetch({}) });
			const tools = getRegisteredToolNames(mcpServer);
			expect(tools).toContain("validate_vat_id");
			expect(tools).toContain("check_api_status");
		});

		it("registers auth-only tools as disabled without API key", () => {
			const { mcpServer } = createGiltiqServer({ fetchFn: mockFetch({}) });
			const tools = getToolStates(mcpServer);
			expect(tools.get("qualified_confirmation")).toBe(false);
			expect(tools.get("get_qualified_confirmation")).toBe(false);
			expect(tools.get("list_qualified_confirmations")).toBe(false);
			expect(tools.get("get_usage")).toBe(false);
		});

		it("registers all tools as enabled with API key", () => {
			const { mcpServer } = createGiltiqServer({
				apiKey: "gq_live_test",
				fetchFn: mockFetch({}),
			});
			const tools = getToolStates(mcpServer);
			expect(tools.get("validate_vat_id")).toBe(true);
			expect(tools.get("check_api_status")).toBe(true);
			expect(tools.get("qualified_confirmation")).toBe(true);
			expect(tools.get("get_qualified_confirmation")).toBe(true);
			expect(tools.get("list_qualified_confirmations")).toBe(true);
			expect(tools.get("get_usage")).toBe(true);
		});
	});

	describe("validate_vat_id tool", () => {
		it("calls API and returns slimmed result as text content", async () => {
			const fetchFn = mockFetch({
				"/v1/validate/": { status: 200, ok: true, body: VALID_RESPONSE },
			});
			const { callTool } = createGiltiqServer({
				apiKey: "gq_live_test",
				fetchFn,
			});

			const result = await callTool("validate_vat_id", {
				vat_id: "DE811575812",
			});

			expect(result.isError).toBeUndefined();
			const text = (result.content[0] as { text: string }).text;
			const parsed = JSON.parse(text);
			expect(parsed.valid).toBe(true);
			expect(parsed.vat_id).toBe("DE811575812");
			expect(parsed).not.toHaveProperty("request_id");
			expect(parsed).not.toHaveProperty("country_code");
		});

		it("passes force_live parameter", async () => {
			const fetchFn = mockFetch({
				"/v1/validate/": { status: 200, ok: true, body: VALID_RESPONSE },
			});
			const { callTool } = createGiltiqServer({
				apiKey: "gq_live_test",
				fetchFn,
			});

			await callTool("validate_vat_id", {
				vat_id: "DE811575812",
				force_live: true,
			});

			const calledUrl = fetchFn.mock.calls[0][0] as string;
			expect(calledUrl).toContain("force_live=true");
		});

		it("returns error content on 401", async () => {
			const fetchFn = mockFetch({
				"/v1/validate/": {
					status: 401,
					ok: false,
					body: {
						error: "anonymous_limit_reached",
						message: "Register for a free API key.",
						register_url: "https://api.giltiq.de/v1/register",
					},
				},
			});
			const { callTool } = createGiltiqServer({ fetchFn });

			const result = await callTool("validate_vat_id", {
				vat_id: "DE811575812",
			});

			expect(result.isError).toBe(true);
			const text = (result.content[0] as { text: string }).text;
			expect(text).toContain("anonymous_limit_reached");
			expect(text).toContain("register");
		});

		it("returns error content on 402", async () => {
			const fetchFn = mockFetch({
				"/v1/validate/": {
					status: 402,
					ok: false,
					body: {
						error: "quota_exceeded",
						message: "Monthly limit reached.",
						upgrade_url: "https://giltiq.de/upgrade",
					},
				},
			});
			const { callTool } = createGiltiqServer({
				apiKey: "gq_live_test",
				fetchFn,
			});

			const result = await callTool("validate_vat_id", {
				vat_id: "DE811575812",
			});

			expect(result.isError).toBe(true);
			const text = (result.content[0] as { text: string }).text;
			expect(text).toContain("quota_exceeded");
		});
	});

	describe("qualified_confirmation tool", () => {
		it("calls API with company params and returns canonical result", async () => {
			const fetchFn = mockFetch({
				"/v1/validate/": { status: 200, ok: true, body: QUALIFIED_RESPONSE },
			});
			const { callTool } = createGiltiqServer({
				apiKey: "gq_live_test",
				fetchFn,
			});

			const result = await callTool("qualified_confirmation", {
				vat_id: "DE811575812",
				company_name: "BZSt",
				company_city: "Bonn",
				company_zip: "53225",
			});

			expect(result.isError).toBeUndefined();
			const text = (result.content[0] as { text: string }).text;
			const parsed = JSON.parse(text);
			expect(parsed.qualified_confirmation.name_match).toBe("match");
			expect(parsed.qualified_confirmation.receipt_id).toBe(
				"GQ-QC-20260325-A7K2M9P4R3",
			);
			expect(parsed.qualified_confirmation).not.toHaveProperty(
				"confirmation_number",
			);

			const calledUrl = fetchFn.mock.calls[0][0] as string;
			expect(calledUrl).toContain("company_name=BZSt");
			expect(calledUrl).toContain("company_city=Bonn");
			expect(calledUrl).toContain("company_zip=53225");
		});

		it("sends company_street when provided", async () => {
			const fetchFn = mockFetch({
				"/v1/validate/": { status: 200, ok: true, body: QUALIFIED_RESPONSE },
			});
			const { callTool } = createGiltiqServer({
				apiKey: "gq_live_test",
				fetchFn,
			});

			await callTool("qualified_confirmation", {
				vat_id: "DE811575812",
				company_street: "An der Küppe 1",
			});

			const calledUrl = fetchFn.mock.calls[0][0] as string;
			expect(calledUrl).toContain("company_street=");
		});

		it("returns error on API error", async () => {
			const fetchFn = mockFetch({
				"/v1/validate/": {
					status: 403,
					ok: false,
					body: {
						error: "plan_upgrade_required",
						message: "Qualified confirmation requires a paid plan.",
					},
				},
			});
			const { callTool } = createGiltiqServer({
				apiKey: "gq_live_test",
				fetchFn,
			});

			const result = await callTool("qualified_confirmation", {
				vat_id: "DE811575812",
			});

			expect(result.isError).toBe(true);
			const text = (result.content[0] as { text: string }).text;
			expect(text).toContain("plan_upgrade_required");
		});
	});

	describe("get_qualified_confirmation tool", () => {
		it("retrieves a stored receipt by receipt_id", async () => {
			const fetchFn = mockFetch({
				"/v1/qualified-confirmations/": {
					status: 200,
					ok: true,
					body: STORED_RECEIPT,
				},
			});
			const { callTool } = createGiltiqServer({
				apiKey: "gq_live_test",
				fetchFn,
			});

			const result = await callTool("get_qualified_confirmation", {
				receipt_id: "GQ-QC-20260325-A7K2M9P4R3",
			});

			expect(result.isError).toBeUndefined();
			const text = (result.content[0] as { text: string }).text;
			const parsed = JSON.parse(text);
			expect(parsed.receipt_id).toBe("GQ-QC-20260325-A7K2M9P4R3");
			expect(parsed.name_match).toBe("match");
		});

		it("returns error result on API error", async () => {
			const fetchFn = mockFetch({
				"/v1/qualified-confirmations/": {
					status: 404,
					ok: false,
					body: { error: "not_found", message: "Receipt not found." },
				},
			});
			const { callTool } = createGiltiqServer({
				apiKey: "gq_live_test",
				fetchFn,
			});

			const result = await callTool("get_qualified_confirmation", {
				receipt_id: "GQ-QC-INVALID",
			});

			expect(result.isError).toBe(true);
			const text = (result.content[0] as { text: string }).text;
			expect(text).toContain("not_found");
		});
	});

	describe("list_qualified_confirmations tool", () => {
		it("lists receipts and returns paginated result", async () => {
			const listBody = { items: [STORED_RECEIPT], next_cursor: null };
			const fetchFn = mockFetch({
				"/v1/qualified-confirmations": {
					status: 200,
					ok: true,
					body: listBody,
				},
			});
			const { callTool } = createGiltiqServer({
				apiKey: "gq_live_test",
				fetchFn,
			});

			const result = await callTool("list_qualified_confirmations", {});

			expect(result.isError).toBeUndefined();
			const text = (result.content[0] as { text: string }).text;
			const parsed = JSON.parse(text);
			expect(parsed.items).toHaveLength(1);
			expect(parsed.next_cursor).toBeNull();
		});

		it("passes target_vat_id filter", async () => {
			const fetchFn = mockFetch({
				"/v1/qualified-confirmations": {
					status: 200,
					ok: true,
					body: { items: [], next_cursor: null },
				},
			});
			const { callTool } = createGiltiqServer({
				apiKey: "gq_live_test",
				fetchFn,
			});

			await callTool("list_qualified_confirmations", {
				target_vat_id: "DE811575812",
			});

			const calledUrl = fetchFn.mock.calls[0][0] as string;
			expect(calledUrl).toContain("target_vat_id=DE811575812");
		});

		it("returns error result on API error", async () => {
			const fetchFn = mockFetch({
				"/v1/qualified-confirmations": {
					status: 401,
					ok: false,
					body: { error: "unauthorized", message: "API key required." },
				},
			});
			const { callTool } = createGiltiqServer({
				apiKey: "gq_live_test",
				fetchFn,
			});

			const result = await callTool("list_qualified_confirmations", {});

			expect(result.isError).toBe(true);
			const text = (result.content[0] as { text: string }).text;
			expect(text).toContain("unauthorized");
		});
	});

	describe("check_api_status tool", () => {
		it("returns flattened status string", async () => {
			const fetchFn = mockFetch({
				"/v1/status": { status: 200, ok: true, body: STATUS_RESPONSE },
			});
			const { callTool } = createGiltiqServer({ fetchFn });

			const result = await callTool("check_api_status", {});

			const text = (result.content[0] as { text: string }).text;
			expect(text).toBe(
				"vies: operational (42ms), bzst: operational (50ms), failover: inactive",
			);
		});
	});

	describe("get_usage tool", () => {
		it("returns usage data as JSON", async () => {
			const fetchFn = mockFetch({
				"/v1/usage": { status: 200, ok: true, body: USAGE_RESPONSE },
			});
			const { callTool } = createGiltiqServer({
				apiKey: "gq_live_test",
				fetchFn,
			});

			const result = await callTool("get_usage", {});

			const text = (result.content[0] as { text: string }).text;
			const parsed = JSON.parse(text);
			expect(parsed.plan).toBe("free");
			expect(parsed.requests.used).toBe(23);
		});
	});

	describe("lazy tool enabling", () => {
		it("enables auth-only tools after first successful authenticated validate call", async () => {
			const fetchFn = mockFetch({
				"/v1/validate/": { status: 200, ok: true, body: VALID_RESPONSE },
			});
			const { mcpServer, callTool } = createGiltiqServer({
				apiKey: "gq_live_test",
				lazyAuth: true,
				fetchFn,
			});

			// Initially disabled
			const toolsBefore = getToolStates(mcpServer);
			expect(toolsBefore.get("qualified_confirmation")).toBe(false);
			expect(toolsBefore.get("get_qualified_confirmation")).toBe(false);
			expect(toolsBefore.get("list_qualified_confirmations")).toBe(false);
			expect(toolsBefore.get("get_usage")).toBe(false);

			// Make an authenticated call
			await callTool("validate_vat_id", { vat_id: "DE811575812" });

			// Now enabled
			const toolsAfter = getToolStates(mcpServer);
			expect(toolsAfter.get("qualified_confirmation")).toBe(true);
			expect(toolsAfter.get("get_qualified_confirmation")).toBe(true);
			expect(toolsAfter.get("list_qualified_confirmations")).toBe(true);
			expect(toolsAfter.get("get_usage")).toBe(true);
		});

		it("does not enable auth tools on failed call", async () => {
			const fetchFn = mockFetch({
				"/v1/validate/": {
					status: 401,
					ok: false,
					body: { error: "anonymous_limit_reached", message: "Register." },
				},
			});
			const { mcpServer, callTool } = createGiltiqServer({
				apiKey: "gq_live_test",
				lazyAuth: true,
				fetchFn,
			});

			await callTool("validate_vat_id", { vat_id: "DE811575812" });

			const tools = getToolStates(mcpServer);
			expect(tools.get("qualified_confirmation")).toBe(false);
			expect(tools.get("get_qualified_confirmation")).toBe(false);
			expect(tools.get("list_qualified_confirmations")).toBe(false);
			expect(tools.get("get_usage")).toBe(false);
		});
	});
});

// Helper: extract registered tool names from McpServer internals
function getRegisteredToolNames(
	mcpServer: { server: unknown } & Record<string, unknown>,
): string[] {
	const tools = (
		mcpServer as unknown as { _registeredTools: Record<string, unknown> }
	)._registeredTools;
	return Object.keys(tools);
}

// Helper: get tool name → enabled state map
function getToolStates(
	mcpServer: { server: unknown } & Record<string, unknown>,
): Map<string, boolean> {
	const tools = (
		mcpServer as unknown as {
			_registeredTools: Record<string, { enabled: boolean }>;
		}
	)._registeredTools;
	const states = new Map<string, boolean>();
	for (const [name, tool] of Object.entries(tools)) {
		states.set(name, tool.enabled);
	}
	return states;
}
