# Pulse MCP — stdio bridge for tooling that expects a runnable image.
#
# The production server is hosted at https://pulsebenchmarks.com/mcp. This
# image exists so Glama's introspector and other registry tooling can run a
# `docker run` against the repo and exercise the MCP surface without us
# pretending Pulse is locally installable. mcp-remote forwards stdio
# JSON-RPC to the hosted endpoint; nothing else runs locally.
FROM node:20-alpine
RUN npm install -g mcp-remote
ENTRYPOINT ["mcp-remote", "https://pulsebenchmarks.com/mcp"]
