#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────
#  frontier-advisor-mcp installer
# ─────────────────────────────────────────────

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
IMAGE_NAME="mcp/frontier-advisor"

bold="\033[1m"
dim="\033[2m"
cyan="\033[36m"
yellow="\033[33m"
green="\033[32m"
reset="\033[0m"

banner() {
  echo ""
  echo -e "${bold}  ┌─────────────────────────────────────────┐${reset}"
  echo -e "${bold}  │       frontier-advisor-mcp  setup        │${reset}"
  echo -e "${bold}  └─────────────────────────────────────────┘${reset}"
  echo ""
}

menu() {
  echo -e "  ${cyan}1)${reset}  Docker + mcp-vault     ${dim}(OS keychain, recommended)${reset}"
  echo -e "  ${cyan}2)${reset}  Docker + env vars      ${dim}(quick start)${reset}"
  echo -e "  ${cyan}3)${reset}  Docker MCP Toolkit     ${dim}(gateway + mcp.json)${reset}"
  echo ""
  echo -ne "  ${bold}Pick an option [1/2/3]:${reset} "
}

build_image() {
  echo ""
  echo -e "  ${dim}Building Docker image...${reset}"
  docker build -t "$IMAGE_NAME" "$REPO_DIR" --quiet > /dev/null
  echo -e "  ${green}✓${reset} Image built: ${bold}${IMAGE_NAME}${reset}"
}

# ── Option 1: Docker + mcp-vault ─────────────

install_vault() {
  build_image

  echo ""
  if ! command -v mcp-vault > /dev/null 2>&1; then
    echo -e "  ${yellow}!${reset} mcp-vault not found on PATH."
    echo -e "    Install it from: ${dim}https://github.com/Shane/mcp-vault${reset}"
    echo ""
  fi

  echo -e "  ${bold}Store your API keys (at least one):${reset}"
  echo ""

  echo -ne "  Anthropic API key (Enter to skip): "
  read -rs anthropic_key
  echo ""
  if [ -n "$anthropic_key" ]; then
    echo "$anthropic_key" | mcp-vault store anthropic/api-key 2>/dev/null \
      && echo -e "  ${green}✓${reset} Stored anthropic/api-key" \
      || echo -e "  ${yellow}!${reset} Could not store — run ${dim}mcp-vault store anthropic/api-key${reset} manually"
  fi

  echo -ne "  OpenAI API key (Enter to skip): "
  read -rs openai_key
  echo ""
  if [ -n "$openai_key" ]; then
    echo "$openai_key" | mcp-vault store openai/api-key 2>/dev/null \
      && echo -e "  ${green}✓${reset} Stored openai/api-key" \
      || echo -e "  ${yellow}!${reset} Could not store — run ${dim}mcp-vault store openai/api-key${reset} manually"
  fi

  echo ""
  echo -e "  ${bold}Add this to your MCP client config (mcp.json):${reset}"
  echo ""
  cat <<'SNIPPET'
    "frontier-advisor": {
      "command": "mcp-vault",
      "args": [
        "--", "docker", "run", "-i", "--rm",
        "-e", "ANTHROPIC_API_KEY=vault:anthropic/api-key",
        "-e", "OPENAI_API_KEY=vault:openai/api-key",
        "mcp/frontier-advisor"
      ]
    }
SNIPPET
  echo ""
  echo -e "  ${dim}(also saved in mcp.json.example)${reset}"
}

# ── Option 2: Docker + env vars ──────────────

install_env() {
  build_image

  echo ""
  echo -e "  ${yellow}!${reset} Keys in mcp.json are easily leaked when sharing config."
  echo -e "    Consider ${bold}mcp-vault${reset} (option 2) to keep them in your OS keychain."
  echo ""
  echo -e "  ${bold}Add this to your MCP client config (mcp.json):${reset}"
  echo ""
  cat <<'SNIPPET'
    "frontier-advisor": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "ANTHROPIC_API_KEY=<your-key-here>",
        "mcp/frontier-advisor"
      ]
    }
SNIPPET
}

# ── Option 3: Docker MCP Toolkit ──────────────

install_toolkit() {
  build_image

  echo ""
  if ! docker mcp version > /dev/null 2>&1; then
    echo -e "  ${yellow}✗${reset} Docker MCP plugin not found."
    echo -e "    Update Docker Desktop to 4.62+ and enable MCP Toolkit."
    exit 1
  fi

  # Create catalog (ignore if exists)
  docker mcp catalog create "$IMAGE_NAME" 2>/dev/null || true

  docker mcp catalog add "$IMAGE_NAME" "$IMAGE_NAME" \
    "$REPO_DIR/docker-mcp-catalog.yaml" --force > /dev/null

  docker mcp server enable "$IMAGE_NAME" 2>/dev/null || true

  echo -e "  ${green}✓${reset} Registered in MCP Toolkit (tools visible via gateway)"
  echo ""
  echo -e "  ${dim}Note: Custom catalog servers don't yet appear in the Desktop UI.${reset}"
  echo -e "  ${dim}Tools are routed through the gateway to connected clients.${reset}"
  echo ""
  echo -e "  ${bold}Add API keys to your MCP client config (mcp.json):${reset}"
  echo ""
  cat <<'SNIPPET'
    "frontier-advisor": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "ANTHROPIC_API_KEY=<your-key-here>",
        "mcp/frontier-advisor"
      ]
    }
SNIPPET
  echo ""
  echo -e "  ${bold}Then connect a client:${reset}"
  echo -e "    ${dim}docker mcp client connect claude${reset}"
  echo -e "    ${dim}docker mcp client connect cursor${reset}"
}

# ── Main ─────────────────────────────────────

banner
menu
read -r choice

case "$choice" in
  1) install_vault ;;
  2) install_env ;;
  3) install_toolkit ;;
  *)
    echo -e "\n  ${yellow}!${reset} Invalid choice. Run this script again."
    exit 1
    ;;
esac

echo ""
echo -e "  ${green}Done.${reset} See README.md for usage details."
echo ""
