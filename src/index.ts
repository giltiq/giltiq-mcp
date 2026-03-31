#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createGiltiqServer } from "./server.js";

const apiKey = process.env.GILTIQ_API_KEY;
const baseUrl = process.env.GILTIQ_API_URL;

const { mcpServer } = createGiltiqServer({
	apiKey,
	baseUrl,
	lazyAuth: !apiKey, // lazy-enable auth tools when no key is set (anonymous → might get key later)
});

const transport = new StdioServerTransport();
await mcpServer.connect(transport);
