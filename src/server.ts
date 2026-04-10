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
		getConfirmationTool.enable();
		listConfirmationsTool.enable();
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
				"Request a legally binding BZSt qualified confirmation per §18e UStG — required for audit-proof cross-border VAT exemption in Germany. Returns official confirmation with company match details and a receipt_id you can use with get_qualified_confirmation to retrieve this record later for audit purposes. No other MCP server provides this.",
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
				company_street: z
					.string()
					.optional()
					.describe("Company street address to match"),
				company_city: z.string().optional().describe("Company city to match"),
				company_zip: z
					.string()
					.optional()
					.describe("Company postal code to match"),
			},
		},
		async ({
			vat_id,
			company_name,
			company_street,
			company_city,
			company_zip,
		}) => {
			const result = await client.qualifiedConfirmation(vat_id, {
				companyName: company_name,
				companyStreet: company_street,
				companyCity: company_city,
				companyZip: company_zip,
			});

			if (isApiError(result)) {
				return errorResult(result);
			}

			return successResult(result);
		},
	);

	// --- Tool: get_qualified_confirmation (auth-only, may be lazy) ---
	const getConfirmationTool = mcpServer.registerTool(
		"get_qualified_confirmation",
		{
			description:
				"Retrieve a past qualified confirmation by receipt id. Use this for §18e UStG audit evidence — fetch a receipt Giltiq issued in a prior validation call.",
			inputSchema: {
				receipt_id: z
					.string()
					.describe("Giltiq receipt id (e.g. GQ-QC-20260410-A7K2M9P4R3)"),
			},
		},
		async ({ receipt_id }) => {
			const result = await client.getQualifiedConfirmation(receipt_id);

			if (isApiError(result)) {
				return errorResult(result);
			}

			return successResult(result);
		},
	);

	// --- Tool: list_qualified_confirmations (auth-only, may be lazy) ---
	const listConfirmationsTool = mcpServer.registerTool(
		"list_qualified_confirmations",
		{
			description:
				"List qualified confirmation receipts you've issued, newest first. Filter by target_vat_id to find past audits of a specific customer.",
			inputSchema: {
				target_vat_id: z
					.string()
					.optional()
					.describe("Filter receipts by target VAT ID"),
				limit: z
					.number()
					.optional()
					.describe("Maximum number of results to return"),
				cursor: z
					.string()
					.optional()
					.describe("Pagination cursor from a previous list call"),
			},
		},
		async ({ target_vat_id, limit, cursor }) => {
			const result = await client.listQualifiedConfirmations({
				targetVatId: target_vat_id,
				limit,
				cursor,
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
		getConfirmationTool.disable();
		listConfirmationsTool.disable();
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
