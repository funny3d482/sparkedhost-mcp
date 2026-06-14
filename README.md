# SparkedHost MCP Bridge

This repo is a starter MCP bridge for a SparkedHost-style client API.
It exposes tools for:

- listing files
- reading files
- writing files
- renaming files
- deleting files
- reading server statistics
- running console commands
- viewing a console snapshot
- restarting the server

## What this assumes

This bridge assumes SparkedHost exposes a Pterodactyl-style client API.
If one route name is different, edit the route helpers in `sparkedhost.js`.

## Files

- `index.js` — MCP server and tool definitions
- `sparkedhost.js` — API helper functions
- `package.json` — dependencies and start command
- `.env.example` — environment variables
- `render.yaml` — Render web service blueprint

## Environment variables

Set these on Render:

- `MCP_SHARED_SECRET` — shared secret Fleet will send in `x-mcp-secret`
- `SPARKEDHOST_PANEL_URL` — usually `https://control.sparkedhost.us`
- `SPARKEDHOST_SERVER_ID` — your server ID from the URL
- `SPARKEDHOST_API_KEY` — your SparkedHost API key
- `SPARKEDHOST_AUTH_HEADER_NAME` — optional, defaults to `Authorization`
- `SPARKEDHOST_AUTH_HEADER_VALUE` — optional, defaults to `Bearer <API_KEY>`
- `SPARKEDHOST_API_PREFIX` — optional, defaults to `/api/client/servers`
- `COMMAND_TIMEOUT_MS` — optional, defaults to `15000`
- `CONSOLE_SNAPSHOT_MS` — optional, defaults to `2500`
- `MAX_OUTPUT_BYTES` — optional, defaults to `250000`
- `MAX_LOG_LINES` — optional, defaults to `200`

## Deploy to Render

1. Create a GitHub repo and push these files.
2. In Render, click **New +** → **Web Service**.
3. Connect GitHub and pick the repo.
4. Add the environment variables above.
5. Deploy.
6. Copy the Render HTTPS URL and append `/mcp` when you add it in Fleet.

## Add it to Fleet

1. Go to **Integrations**.
2. Click **+ Custom MCP**.
3. Paste the Render HTTPS URL ending in `/mcp`.
4. Choose **Static headers**.
5. Add this header:
   - `x-mcp-secret: <same value as MCP_SHARED_SECRET>`
6. Save.
7. Add the MCP tools to your agent.

## Tool list

- `list_files(directory)`
- `read_file(file)`
- `write_file(file, content)`
- `rename_file(from, to)`
- `delete_files(files)`
- `get_statistics()`
- `run_command(command)`
- `view_console(durationMs, maxLines)`
- `restart_server()`

## Notes

- `run_command` sends a command to the server console.
- `view_console` opens the server websocket and returns a short snapshot of console output.
- This bridge is powerful. Only use it for servers you trust.
