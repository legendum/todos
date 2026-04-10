#!/bin/sh
set -e

REPO="https://github.com/legendum/todos.git"
INSTALL_DIR="$HOME/.config/todos/src"

echo "Installing todos..."

# Check for bun
if ! command -v bun >/dev/null 2>&1; then
  echo "Bun not found. Installing..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi

# Clone or update
if [ -d "$INSTALL_DIR" ]; then
  echo "Updating existing installation..."
  cd "$INSTALL_DIR"
  git pull
else
  echo "Cloning repository..."
  git clone "$REPO" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# Install dependencies
bun install

# Link globally
bun link

echo ""
echo "Done! Run 'todos' to get started."
echo ""
echo "Quick start:"
echo "  cd your-project"
echo "  todos              # list todos"
echo "  todos Buy milk     # add a todo"
echo "  todos done 1       # mark todo 1 as done"
