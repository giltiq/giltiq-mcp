import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { type ApiError, GiltiqApiClient } from "./api-client.js";

type FetchFn = typeof globalThis.fetch;

export interface CreateServerOptions {
	apiKey?: string;
	baseUrl?: string;
	fetchFn?: FetchFn;
	/** When true + apiKey set, start with auth-only tools disabled until first successful call */
	lazyAuth?: boolean;
}

export function createGiltiqServer(options: CreateServerOptions = {}) {
	const client = new GiltiqApiClient({
		apiKey: options.apiKey,
		baseUrl: options.baseUrl,
		fetchFn: options.fetchFn,
	});

	const mcpServer = new McpServer(
		{ name: "giltiq-mcp", version: "0.1.0" },
		{
			capabilities: { tools: { listChanged: true } },
			instructions:
				"Giltiq MCP server for EU VAT validation. Validates against VIES + BZSt with automatic failover. Supports §18e UStG qualified confirmations for German tax compliance.",
		},
	);

	const shouldLazyEnable = options.lazyAuth === true && client.isAuthenticated;
	let authToolsEnabled = client.isAuthenticated && !shouldLazyEnable;

	function enableAuthTools() {
		if (authToolsEnabled) return;
		authToolsEnabled = true;
		qualifiedTool.enable();
		usageTool.enable();
		try {
			mcpServer.sendToolListChanged();
		} catch {
			// Not connected yet, ignore
		}
	}

	// --- Tool: validate_vat_id (always enabled) ---
	mcpServer.registerTool(
		"validate_vat_id",
		{
			description:
				"Validate an EU VAT ID against multiple sources (VIES + Germany's BZSt) with automatic failover and cached fallback. Returns structured company data with parsed address and source freshness indicator. Works when VIES is down.",
			inputSchema: {
				vat_id: z.string().describe("EU VAT ID to validate (e.g. DE811575812)"),
				force_live: z
					.boolean()
					.optional()
					.describe("Skip cache and query validation source in real time"),
			},
		},
		async ({ vat_id, force_live }) => {
			const result = await client.validateVatId(vat_id, {
				forceLive: force_live,
			});

			if (isApiError(result)) {
				return errorResult(result);
			}

			// Lazy enable auth tools on first successful authenticated call
			if (shouldLazyEnable && !authToolsEnabled) {
				enableAuthTools();
			}

			return successResult(result);
		},
	);

	// --- Tool: check_api_status (always enabled) ---
	mcpServer.registerTool(
		"check_api_status",
		{
			description:
				"Check real-time availability and latency of VIES and BZSt upstream sources. Shows which source is active, whether failover is engaged, and per-source latency in milliseconds.",
		},
		async () => {
			const result = await client.checkStatus();
			return { content: [{ type: "text" as const, text: result }] };
		},
	);

	// --- Tool: qualified_confirmation (auth-only, may be lazy) ---
	const qualifiedTool = mcpServer.registerTool(
		"qualified_confirmation",
		{
			description:
				"Request a legally binding BZSt qualified confirmation per §18e UStG — required for audit-proof cross-border VAT exemption in Germany. Returns official confirmation with requestor/target company match details. No other MCP server provides this. Audit-proof document generation (PDF) coming soon.",
			inputSchema: {
				vat_id: z
					.string()
					.describe(
						"EU VAT ID to check (must be DE prefix for qualified confirmation)",
					),
				company_name: z
					.string()
					.optional()
					.describe("Company name to match against BZSt registry"),
				company_city: z.string().optional().describe("Company city to match"),
				company_zip: z
					.string()
					.optional()
					.describe("Company postal code to match"),
			},
		},
		async ({ vat_id, company_name, company_city, company_zip }) => {
			const result = await client.qualifiedConfirmation(vat_id, {
				companyName: company_name,
				companyCity: company_city,
				companyZip: company_zip,
			});

			if (isApiError(result)) {
				return errorResult(result);
			}

			return successResult(result);
		},
	);

	// --- Tool: get_usage (auth-only, may be lazy) ---
	const usageTool = mcpServer.registerTool(
		"get_usage",
		{
			description:
				"Get current API usage for the authenticated account: calls used, monthly limit, tier, and days until reset. Useful for agents to self-regulate before hitting limits.",
		},
		async () => {
			const result = await client.getUsage();

			if (isApiError(result)) {
				return errorResult(result);
			}

			return successResult(result);
		},
	);

	// Disable auth-only tools if not authenticated or lazy
	if (!authToolsEnabled) {
		qualifiedTool.disable();
		usageTool.disable();
	}

	// --- Direct tool call helper for testing ---
	async function callTool(
		name: string,
		args: Record<string, unknown>,
	): Promise<CallToolResult> {
		const tools = (
			mcpServer as unknown as {
				_registeredTools: Record<
					string,
					{
						handler: (args: Record<string, unknown>) => Promise<CallToolResult>;
					}
				>;
			}
		)._registeredTools;
		const tool = tools[name];
		if (!tool) {
			throw new Error(`Tool not found: ${name}`);
		}
		return tool.handler(args);
	}

	return {
		mcpServer,
		callTool,
	};
}

function isApiError(result: unknown): result is ApiError {
	return (
		typeof result === "object" &&
		result !== null &&
		"error" in result &&
		!("valid" in result)
	);
}

function successResult(data: unknown): CallToolResult {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
	};
}

function errorResult(error: ApiError): CallToolResult {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(error, null, 2) }],
		isError: true,
	};
}
