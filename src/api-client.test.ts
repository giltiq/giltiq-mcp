import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GiltiqApiClient } from "./api-client.js";

const BASE_URL = "https://api.giltiq.de";

describe("GiltiqApiClient", () => {
	let client: GiltiqApiClient;
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		client = new GiltiqApiClient({
			apiKey: "gq_live_test123",
			fetchFn: fetchMock,
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("constructor", () => {
		it("uses default base URL", () => {
			const c = new GiltiqApiClient({ fetchFn: fetchMock });
			expect(c.baseUrl).toBe(BASE_URL);
		});

		it("accepts custom base URL", () => {
			const c = new GiltiqApiClient({
				baseUrl: "https://custom.api",
				fetchFn: fetchMock,
			});
			expect(c.baseUrl).toBe("https://custom.api");
		});

		it("strips trailing slash from base URL", () => {
			const c = new GiltiqApiClient({
				baseUrl: "https://custom.api/",
				fetchFn: fetchMock,
			});
			expect(c.baseUrl).toBe("https://custom.api");
		});

		it("works without API key (anonymous mode)", () => {
			const c = new GiltiqApiClient({ fetchFn: fetchMock });
			expect(c.isAuthenticated).toBe(false);
		});

		it("reports authenticated when API key is set", () => {
			expect(client.isAuthenticated).toBe(true);
		});
	});

	describe("validateVatId", () => {
		it("calls GET /v1/validate/{vat_id} and returns slimmed response", async () => {
			fetchMock.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: async () => ({
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
					request_id: "req_01HZ9X2Y3Z4A5B6C7D8E9F0G",
					requested_at: "2026-03-25T10:00:00.000Z",
				}),
			});

			const result = await client.validateVatId("DE811575812");

			expect(fetchMock).toHaveBeenCalledWith(
				`${BASE_URL}/v1/validate/DE811575812`,
				expect.objectContaining({
					headers: expect.objectContaining({ "X-Api-Key": "gq_live_test123" }),
				}),
			);

			// Slimmed: no request_id, requested_at, vat_number, country_code
			expect(result).toEqual({
				valid: true,
				vat_id: "DE811575812",
				company_name: "Bundeszentralamt für Steuern",
				company_address: "An der Küppe 1, 53225 Bonn",
				source: "vies",
				source_timestamp: "2026-03-25T09:58:12.000Z",
				cache: false,
				qualified_confirmation: null,
			});
			expect(result).not.toHaveProperty("request_id");
			expect(result).not.toHaveProperty("requested_at");
			expect(result).not.toHaveProperty("vat_number");
			expect(result).not.toHaveProperty("country_code");
		});

		it("passes force_live query parameter", async () => {
			fetchMock.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: async () => ({
					valid: true,
					vat_id: "DE811575812",
					country_code: "DE",
					vat_number: "811575812",
					company_name: null,
					company_address: null,
					source: "bzst",
					source_timestamp: null,
					cache: false,
					qualified_confirmation: null,
					request_id: "req_x",
					requested_at: "2026-03-25T10:00:00.000Z",
				}),
			});

			await client.validateVatId("DE811575812", { forceLive: true });

			const calledUrl = fetchMock.mock.calls[0][0] as string;
			expect(calledUrl).toContain("force_live=true");
		});

		it("works without API key (anonymous mode)", async () => {
			const anonClient = new GiltiqApiClient({ fetchFn: fetchMock });
			fetchMock.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: async () => ({
					valid: true,
					vat_id: "DE811575812",
					country_code: "DE",
					vat_number: "811575812",
					company_name: null,
					company_address: null,
					source: "vies",
					source_timestamp: null,
					cache: false,
					qualified_confirmation: null,
					request_id: "req_x",
					requested_at: "2026-03-25T10:00:00.000Z",
				}),
			});

			await anonClient.validateVatId("DE811575812");

			const headers = fetchMock.mock.calls[0][1].headers;
			expect(headers).not.toHaveProperty("X-Api-Key");
		});

		it("returns error structure on 401 (anonymous limit)", async () => {
			fetchMock.mockResolvedValueOnce({
				ok: false,
				status: 401,
				json: async () => ({
					error: "anonymous_limit_reached",
					message:
						"Register for a free API key to continue (100 calls/month, no payment required).",
					register_url: "https://api.giltiq.de/v1/register",
				}),
			});

			const result = await client.validateVatId("DE811575812");
			expect(result).toEqual({
				error: "anonymous_limit_reached",
				message:
					"Register for a free API key to continue (100 calls/month, no payment required).",
				register_url: "https://api.giltiq.de/v1/register",
			});
		});

		it("returns error structure on 402 (quota exceeded)", async () => {
			fetchMock.mockResolvedValueOnce({
				ok: false,
				status: 402,
				json: async () => ({
					error: "quota_exceeded",
					message: "Monthly free tier limit reached. Upgrade to continue.",
					upgrade_url: "https://giltiq.de/upgrade",
				}),
			});

			const result = await client.validateVatId("DE811575812");
			expect(result).toEqual({
				error: "quota_exceeded",
				message: "Monthly free tier limit reached. Upgrade to continue.",
				upgrade_url: "https://giltiq.de/upgrade",
			});
		});

		it("returns error structure on 400 (invalid VAT ID)", async () => {
			fetchMock.mockResolvedValueOnce({
				ok: false,
				status: 400,
				json: async () => ({
					error: {
						code: "INVALID_VAT_ID",
						message: "The VAT ID format is invalid.",
					},
				}),
			});

			const result = await client.validateVatId("INVALID");
			expect(result).toHaveProperty("error");
		});

		it("returns error on network failure", async () => {
			fetchMock.mockRejectedValueOnce(new Error("Network error"));

			const result = await client.validateVatId("DE811575812");
			expect(result).toEqual({
				error: "network_error",
				message: "Network error",
			});
		});
	});

	describe("qualifiedConfirmation", () => {
		it("calls validate with requester params and returns slimmed response", async () => {
			fetchMock.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: async () => ({
					valid: true,
					vat_id: "DE811575812",
					country_code: "DE",
					vat_number: "811575812",
					company_name: "Bundeszentralamt für Steuern",
					company_address: "An der Küppe 1, 53225 Bonn",
					source: "bzst",
					source_timestamp: "2026-03-25T10:00:00.000Z",
					cache: false,
					qualified_confirmation: {
						name_match: "A",
						city_match: "A",
						zip_match: "A",
						confirmation_number: "DE20260325123456",
					},
					request_id: "req_02",
					requested_at: "2026-03-25T10:00:00.000Z",
				}),
			});

			const result = await client.qualifiedConfirmation("DE811575812", {
				companyName: "Bundeszentralamt für Steuern",
				companyCity: "Bonn",
				companyZip: "53225",
			});

			const calledUrl = fetchMock.mock.calls[0][0] as string;
			expect(calledUrl).toContain("company_name=Bundeszentralamt");
			expect(calledUrl).toContain("company_city=Bonn");
			expect(calledUrl).toContain("company_zip=53225");

			expect(result).toEqual({
				valid: true,
				vat_id: "DE811575812",
				company_name: "Bundeszentralamt für Steuern",
				company_address: "An der Küppe 1, 53225 Bonn",
				source: "bzst",
				source_timestamp: "2026-03-25T10:00:00.000Z",
				cache: false,
				qualified_confirmation: {
					name_match: "A",
					city_match: "A",
					zip_match: "A",
					confirmation_number: "DE20260325123456",
				},
			});
		});
	});

	describe("checkStatus", () => {
		it("calls GET /v1/status and returns flattened string", async () => {
			fetchMock.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: async () => ({
					sources: {
						vies: {
							status: "operational",
							latency_ms: 42,
							last_checked: "2026-03-25T10:00:00.000Z",
						},
						bzst: {
							status: "degraded",
							latency_ms: 310,
							last_checked: "2026-03-25T10:00:00.000Z",
						},
						cache: { status: "operational" },
					},
					active_source: "vies",
					failover_active: true,
				}),
			});

			const result = await client.checkStatus();

			expect(result).toBe(
				"vies: operational (42ms), bzst: degraded (310ms), failover: active",
			);
		});

		it("handles unavailable source with no latency", async () => {
			fetchMock.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: async () => ({
					sources: {
						vies: {
							status: "unavailable",
							latency_ms: null,
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
				}),
			});

			const result = await client.checkStatus();

			expect(result).toBe(
				"vies: unavailable, bzst: operational (50ms), failover: inactive",
			);
		});

		it("does not send API key header", async () => {
			fetchMock.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: async () => ({
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
				}),
			});

			await client.checkStatus();

			// Status is public — no auth needed even if client has a key
			const calledUrl = fetchMock.mock.calls[0][0] as string;
			expect(calledUrl).toBe(`${BASE_URL}/v1/status`);
		});

		it("returns error on network failure", async () => {
			fetchMock.mockRejectedValueOnce(new Error("timeout"));

			const result = await client.checkStatus();
			expect(result).toBe("error: timeout");
		});
	});

	describe("getUsage", () => {
		it("calls GET /v1/usage and returns response", async () => {
			fetchMock.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: async () => ({
					plan: "free",
					period: {
						start: "2026-03-01T00:00:00.000Z",
						end: "2026-04-01T00:00:00.000Z",
					},
					requests: {
						used: 23,
						remaining: 77,
						limit: 100,
					},
				}),
			});

			const result = await client.getUsage();

			expect(fetchMock).toHaveBeenCalledWith(
				`${BASE_URL}/v1/usage`,
				expect.objectContaining({
					headers: expect.objectContaining({ "X-Api-Key": "gq_live_test123" }),
				}),
			);

			expect(result).toEqual({
				plan: "free",
				period: {
					start: "2026-03-01T00:00:00.000Z",
					end: "2026-04-01T00:00:00.000Z",
				},
				requests: {
					used: 23,
					remaining: 77,
					limit: 100,
				},
			});
		});

		it("returns error on 401", async () => {
			fetchMock.mockResolvedValueOnce({
				ok: false,
				status: 401,
				json: async () => ({
					error: { code: "UNAUTHORIZED", message: "API key required." },
				}),
			});

			const result = await client.getUsage();
			expect(result).toHaveProperty("error");
		});
	});
});
