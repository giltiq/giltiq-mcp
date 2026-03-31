const DEFAULT_BASE_URL = "https://api.giltiq.de";

type FetchFn = typeof globalThis.fetch;

export interface ApiClientOptions {
	apiKey?: string;
	baseUrl?: string;
	fetchFn?: FetchFn;
}

export interface ValidateOptions {
	forceLive?: boolean;
}

export interface QualifiedOptions {
	companyName?: string;
	companyCity?: string;
	companyZip?: string;
}

export interface SlimValidationResult {
	valid: boolean;
	vat_id: string;
	company_name: string | null;
	company_address: string | null;
	source: string;
	source_timestamp: string | null;
	cache: boolean;
	qualified_confirmation: {
		name_match: string;
		city_match: string;
		zip_match: string;
		confirmation_number: string | null;
	} | null;
}

export interface ApiError {
	error: string | { code: string; message: string };
	message?: string;
	register_url?: string;
	upgrade_url?: string;
}

export interface UsageResult {
	plan: string;
	period: { start: string; end: string };
	requests: { used: number; remaining: number; limit: number };
}

export class GiltiqApiClient {
	readonly baseUrl: string;
	private readonly apiKey: string | undefined;
	private readonly fetchFn: FetchFn;

	constructor(options: ApiClientOptions = {}) {
		this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
		this.apiKey = options.apiKey;
		this.fetchFn = options.fetchFn ?? globalThis.fetch;
	}

	get isAuthenticated(): boolean {
		return this.apiKey !== undefined && this.apiKey !== "";
	}

	async validateVatId(
		vatId: string,
		options?: ValidateOptions,
	): Promise<SlimValidationResult | ApiError> {
		try {
			const params = new URLSearchParams();
			if (options?.forceLive) {
				params.set("force_live", "true");
			}
			const qs = params.toString();
			const url = `${this.baseUrl}/v1/validate/${encodeURIComponent(vatId)}${qs ? `?${qs}` : ""}`;

			const res = await this.fetchFn(url, {
				headers: this.authHeaders(),
			});

			const data = await res.json();

			if (!res.ok) {
				return data as ApiError;
			}

			return slimValidationResponse(data);
		} catch (err) {
			return {
				error: "network_error",
				message: err instanceof Error ? err.message : String(err),
			};
		}
	}

	async qualifiedConfirmation(
		vatId: string,
		options?: QualifiedOptions,
	): Promise<SlimValidationResult | ApiError> {
		try {
			const params = new URLSearchParams();
			// Use the client's own API key as requester_vat_id is separate,
			// but the API expects it as a query param for qualified confirmation.
			// The VAT ID of the requester should be the client's own VAT ID,
			// but since we don't have it, we pass the target as requester too
			// (the API's qualified confirmation needs requester_vat_id).
			// Actually, looking at the API: requester_vat_id is the caller's own VAT ID.
			// For the MCP tool, we don't expose requester_vat_id — the API uses the
			// BZST_OWN_VAT_ID from server config as the requester.
			if (options?.companyName) params.set("company_name", options.companyName);
			if (options?.companyCity) params.set("company_city", options.companyCity);
			if (options?.companyZip) params.set("company_zip", options.companyZip);

			const qs = params.toString();
			const url = `${this.baseUrl}/v1/validate/${encodeURIComponent(vatId)}${qs ? `?${qs}` : ""}`;

			const res = await this.fetchFn(url, {
				headers: this.authHeaders(),
			});

			const data = await res.json();

			if (!res.ok) {
				return data as ApiError;
			}

			return slimValidationResponse(data);
		} catch (err) {
			return {
				error: "network_error",
				message: err instanceof Error ? err.message : String(err),
			};
		}
	}

	async checkStatus(): Promise<string> {
		try {
			const res = await this.fetchFn(`${this.baseUrl}/v1/status`, {
				headers: { "User-Agent": "giltiq-mcp/0.1.0" },
			});
			const data = await res.json();

			const vies = data.sources.vies;
			const bzst = data.sources.bzst;
			const failover = data.failover_active ? "active" : "inactive";

			const viesStr =
				vies.latency_ms !== null
					? `vies: ${vies.status} (${vies.latency_ms}ms)`
					: `vies: ${vies.status}`;
			const bzstStr =
				bzst.latency_ms !== null
					? `bzst: ${bzst.status} (${bzst.latency_ms}ms)`
					: `bzst: ${bzst.status}`;

			return `${viesStr}, ${bzstStr}, failover: ${failover}`;
		} catch (err) {
			return `error: ${err instanceof Error ? err.message : String(err)}`;
		}
	}

	async getUsage(): Promise<UsageResult | ApiError> {
		try {
			const res = await this.fetchFn(`${this.baseUrl}/v1/usage`, {
				headers: this.authHeaders(),
			});
			const data = await res.json();

			if (!res.ok) {
				return data as ApiError;
			}

			return data as UsageResult;
		} catch (err) {
			return {
				error: "network_error",
				message: err instanceof Error ? err.message : String(err),
			};
		}
	}

	private authHeaders(): Record<string, string> {
		const headers: Record<string, string> = {
			"User-Agent": "giltiq-mcp/0.1.0",
		};
		if (this.apiKey) {
			headers["X-Api-Key"] = this.apiKey;
		}
		return headers;
	}
}

function slimValidationResponse(
	data: Record<string, unknown>,
): SlimValidationResult {
	return {
		valid: data.valid as boolean,
		vat_id: data.vat_id as string,
		company_name: data.company_name as string | null,
		company_address: data.company_address as string | null,
		source: data.source as string,
		source_timestamp: data.source_timestamp as string | null,
		cache: data.cache as boolean,
		qualified_confirmation:
			data.qualified_confirmation as SlimValidationResult["qualified_confirmation"],
	};
}
