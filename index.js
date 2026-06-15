import express from 'express';
import * as z from 'zod/v4';
import { McpServer } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import {
  loadConfig,
  listFiles,
  readFile,
  writeFile,
  renameFile,
  deleteFiles,
  runCommand,
  restartServer,
  getStatistics,
  getConsoleSnapshot,
  normalizeFileListing
} from './sparkedhost.js';

const app = express();
app.use(express.json({ limit: '2mb' }));

const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const MCP_SHARED_SECRET = process.env.MCP_SHARED_SECRET;
const config = loadConfig();

function summarize(value, limit = config.maxOutputBytes) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n...<truncated>`;
}

function jsonError(res, status, message) {
  return res.status(status).json({
    jsonrpc: '2.0',
    error: { code: status, message },
    id: null
  });
}

function requireSharedSecret(req, res, next) {
  if (!MCP_SHARED_SECRET) {
    return jsonError(res, 500, 'MCP_SHARED_SECRET is not set');
  }

  const incoming = req.get('x-mcp-secret');
  if (incoming !== MCP_SHARED_SECRET) {
    return jsonError(res, 401, 'Unauthorized');
  }

  return next();
}

function createServer() {
  const server = new McpServer(
    {
      name: 'sparkedhost-mcp-bridge',
      version: '1.0.0'
    },
    { capabilities: { logging: {} } }
  );

  server.registerTool(
    'list_files',
    {
      title: 'List Files',
      description: 'List files in a SparkedHost server directory.',
      inputSchema: z.object({
        directory: z.string().default('/').describe('Directory to list')
      })
    },
    async ({ directory }) => {
      const response = await listFiles(config, directory);
      return {
        content: [{ type: 'text', text: summarize(normalizeFileListing(response)) }]
      };
    }
  );

  server.registerTool(
    'read_file',
    {
      title: 'Read File',
      description: 'Read a file from the SparkedHost server.',
      inputSchema: z.object({
        file: z.string().describe('Path to the file')
      })
    },
    async ({ file }) => {
      const response = await readFile(config, file);
      const text = summarize(response);
      return {
        content: [{ type: 'text', text }]
      };
    }
  );

  server.registerTool(
    'write_file',
    {
      title: 'Write File',
      description: 'Write content to a file on the SparkedHost server.',
      inputSchema: z.object({
        file: z.string().describe('Path to the file'),
        content: z.string().describe('File contents')
      })
    },
    async ({ file, content }) => {
      const response = await writeFile(config, file, content);
      return {
        content: [{ type: 'text', text: summarize(response) }]
      };
    }
  );

  server.registerTool(
    'rename_file',
    {
      title: 'Rename File',
      description: 'Rename or move a file on the SparkedHost server.',
      inputSchema: z.object({
        from: z.string().describe('Current file path'),
        to: z.string().describe('New file path')
      })
    },
    async ({ from, to }) => {
      const response = await renameFile(config, from, to);
      return {
        content: [{ type: 'text', text: summarize(response) }]
      };
    }
  );

  server.registerTool(
    'delete_files',
    {
      title: 'Delete Files',
      description: 'Delete one or more files on the SparkedHost server.',
      inputSchema: z.object({
        files: z.union([z.string(), z.array(z.string())]).describe('File or files to delete')
      })
    },
    async ({ files }) => {
      const response = await deleteFiles(config, files);
      return {
        content: [{ type: 'text', text: summarize(response) }]
      };
    }
  );

  server.registerTool(
    'get_statistics',
    {
      title: 'Get Statistics',
      description: 'Fetch server statistics and resources.',
      inputSchema: z.object({})
    },
    async () => {
      const response = await getStatistics(config);
      return {
        content: [{ type: 'text', text: summarize(response) }]
      };
    }
  );

  server.registerTool(
    'run_command',
    {
      title: 'Run Command',
      description: 'Send a command to the server console.',
      inputSchema: z.object({
        command: z.string().describe('Command to run')
      })
    },
    async ({ command }) => {
      const response = await runCommand(config, command);
      return {
        content: [{ type: 'text', text: summarize(response) }]
      };
    }
  );

  server.registerTool(
    'view_console',
    {
      title: 'View Console',
      description: 'Capture a console snapshot from the server websocket.',
      inputSchema: z.object({
        durationMs: z.number().default(config.consoleSnapshotMs).describe('How long to collect console output'),
        maxLines: z.number().default(config.maxLogLines).describe('Maximum lines to return')
      })
    },
    async ({ durationMs, maxLines }) => {
      const snapshot = await getConsoleSnapshot(config, { durationMs, maxLines });
      return {
        content: [
          {
            type: 'text',
            text: snapshot.lines.length ? summarize(snapshot.lines.join('\n')) : '(No console output captured)'
          }
        ]
      };
    }
  );

  server.registerTool(
    'restart_server',
    {
      title: 'Restart Server',
      description: 'Restart the SparkedHost server.',
      inputSchema: z.object({})
    },
    async () => {
      const response = await restartServer(config);
      return {
        content: [{ type: 'text', text: summarize(response) }]
      };
    }
  );

  return server;
}

app.get('/', (_req, res) => {
  res.status(200).send('SparkedHost MCP bridge is running. Use /mcp for MCP requests.');
});

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

app.post('/mcp', requireSharedSecret, async (req, res) => {
  try {
    const server = createServer();
    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);

    res.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
  } catch (error) {
    console.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      jsonError(res, 500, 'Internal server error');
    }
  }
});

app.get('/mcp', requireSharedSecret, (_req, res) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed.' },
    id: null
  });
});

app.delete('/mcp', requireSharedSecret, (_req, res) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed.' },
    id: null
  });
});

app.listen(PORT, error => {
  if (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
  console.log(`SparkedHost MCP bridge listening on port ${PORT}`);
});

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
