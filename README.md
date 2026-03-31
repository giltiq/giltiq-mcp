# @giltiq/mcp

MCP server for EU VAT validation with **multi-source reliability** (VIES + Germany's BZSt), automatic failover, and legally binding **qualified confirmations per §18e UStG**. Works when VIES is down. No other MCP server provides this.

## Install

```bash
npx @giltiq/mcp
```

## Configure

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "giltiq": {
      "command": "npx",
      "args": ["-y", "@giltiq/mcp"],
      "env": {
        "GILTIQ_API_KEY": "gq_live_your_key_here"
      }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "giltiq": {
      "command": "npx",
      "args": ["-y", "@giltiq/mcp"],
      "env": {
        "GILTIQ_API_KEY": "gq_live_your_key_here"
      }
    }
  }
}
```

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "giltiq": {
      "command": "npx",
      "args": ["-y", "@giltiq/mcp"],
      "env": {
        "GILTIQ_API_KEY": "gq_live_your_key_here"
      }
    }
  }
}
```

> **No API key?** The server works without one in anonymous mode (10 free validations, VIES only). Set `GILTIQ_API_KEY` to unlock 100 calls/month, qualified confirmations, and usage tracking.

## Tools

| Tool | Description |
|------|-------------|
| `validate_vat_id` | Validate an EU VAT ID against VIES + BZSt with automatic failover and cached fallback. Returns company data and source freshness. |
| `qualified_confirmation` | Request a legally binding BZSt qualified confirmation per §18e UStG for audit-proof cross-border VAT exemption in Germany. |
| `check_api_status` | Check real-time availability and latency of VIES and BZSt upstream sources. |
| `get_usage` | Get current API usage: calls used, monthly limit, tier, and reset date. |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GILTIQ_API_KEY` | No | API key for authenticated access. Without it, runs in anonymous mode (10 lifetime calls). Get one free at [giltiq.de](https://giltiq.de). |
| `GILTIQ_API_URL` | No | Override the API base URL (default: `https://api.giltiq.de`). |

## Links

- [API Documentation](https://giltiq.de/en/api-reference/overview/)
- [agents.json](https://giltiq.de/agents.json)
- [llms.txt](https://giltiq.de/llms.txt)
- [OpenAPI Spec](https://giltiq.de/openapi.json)

## License

MIT

---

Powered by [Giltiq](https://giltiq.de) — the only VAT validation API with legally binding German tax compliance.
