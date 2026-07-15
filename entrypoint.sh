#!/bin/sh
set -e

# Sync JSON source into SQLite on first run (or if the DB is missing).
if [ ! -f "$SQLITE_DSN" ]; then
  echo "Initializing database at $SQLITE_DSN..."
  ./dbsync --data-dir="$DATA_DIR"
  if [ -f "$VOYAGE_JSON" ]; then
    echo "Ingesting voyage JSON..."
    ./ingestvoyage --json="$VOYAGE_JSON"
  elif [ -f "$VOYAGE_LOG" ]; then
    echo "Ingesting voyage log..."
    ./ingestvoyage --file="$VOYAGE_LOG"
  fi
fi

echo "Starting server on $SERVER_ADDR..."
exec ./server
