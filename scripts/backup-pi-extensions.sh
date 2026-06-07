#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$HOME/pi-shark-backup"
PI_EXTENSIONS_DIR="$HOME/.pi/agent/extensions"
TIMESTAMP=$(date "+%Y-%m-%d %H:%M:%S")

echo "=== pi extensions backup ==="
echo ""

# Ensure repo directory exists
if [ ! -d "$REPO_DIR" ]; then
    echo "ERROR: Repo directory $REPO_DIR not found."
    echo "Run: gh repo clone sims-tek/pi-shark-backup ~/pi-shark-backup"
    exit 1
fi

cd "$REPO_DIR"

# Ensure we're in a git repo
if [ ! -d ".git" ]; then
    echo "ERROR: $REPO_DIR is not a git repository."
    exit 1
fi

# Check for uncommitted changes
if ! git diff --quiet --cached; then
    echo "There are staged but uncommitted changes. Commit or stash them first."
    exit 1
fi

# Sync extensions from pi's extensions directory
echo "1. Copying extensions from $PI_EXTENSIONS_DIR ..."
mkdir -p extensions
cp -r "$PI_EXTENSIONS_DIR"/* extensions/ 2>/dev/null || true

# Remove any .git artifacts that might have been copied
find extensions -name ".git" -type d -exec rm -rf {} + 2>/dev/null || true

# Also back up settings if they exist
echo "2. Backing up pi configuration ..."
mkdir -p config
if [ -f "$HOME/.pi/agent/settings.json" ]; then
    cp "$HOME/.pi/agent/settings.json" config/
fi

# Check if anything changed
if git diff --quiet && git diff --quiet --cached && [ -z "$(git status --porcelain)" ]; then
    echo ""
    echo "✓ No changes detected. Everything is up to date."
    exit 0
fi

# Show what changed
echo ""
echo "3. Changes detected:"
git status --short

# Add everything
git add -A

# Commit
git commit -m "Backup pi extensions - $TIMESTAMP"

# Push
echo ""
echo "4. Pushing to GitHub..."
if git push origin main 2>&1; then
    echo ""
    echo "✓ Backup complete! Pushed to: https://github.com/sims-tek/pi-shark-backup"
else
    echo ""
    echo "⚠ Push failed. You may need to pull first: git pull --rebase"
    echo "  Or check your network connection."
    exit 1
fi
