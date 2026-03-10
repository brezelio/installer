#!/bin/sh
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "${BLUE}🥨 Welcome to the Brezel Installer!${NC}"

# Check for Node.js
if ! command -v node >/dev/null 2>&1; then
    echo "${RED}❌ Node.js is required but not found.${NC}"
    echo "Please install Node.js 18+ and try again."
    exit 1
fi

# Check for npm
if ! command -v npm >/dev/null 2>&1; then
    echo "${RED}❌ npm is required but not found.${NC}"
    exit 1
fi

# In production, we would use npx -y @kibro/brezel-installer@latest
# For development/demo purposes in this repo:
if [ -f "package.json" ] && [ -d "src" ]; then
    echo "📦 Preparing installer..."
    npm install --silent
    npm run build --silent
fi

if [ -f "./dist/index.js" ]; then
    echo "🚀 Launching installer..."
    # Pass all arguments to the TS installer
    node ./dist/index.js "$@"
else
    # Fallback to npx if no local build is found
    echo "🚀 Fetching and launching latest installer..."
    npx -y @brezel/installer@latest "$@"
fi
