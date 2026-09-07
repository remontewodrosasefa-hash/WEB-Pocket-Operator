#!/bin/bash
# Double-click this file in Finder to run the PO-33 locally on macOS.
# It serves the folder on http://localhost:5000 and opens your browser.

cd "$(dirname "$0")" || exit 1

PORT=5000
URL="http://localhost:$PORT/"

echo "Serving PO-33 at $URL"
echo "Leave this window open while you play. Press Ctrl+C to stop."

# Open the browser once the server is up.
( sleep 1; open "$URL" ) &

if command -v python3 >/dev/null 2>&1; then
	exec python3 -m http.server "$PORT"
elif command -v npx >/dev/null 2>&1; then
	exec npx --yes serve -l "$PORT" .
else
	echo "Need python3 or Node.js installed. Install Xcode Command Line Tools:"
	echo "  xcode-select --install"
	read -r -p "Press Return to close."
	exit 1
fi
