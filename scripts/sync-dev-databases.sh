#!/bin/bash
# sync-dev-databases.sh - Sync production databases to local development copies
#
# Usage: ./sync-dev-databases.sh [--sai-only|--n8n-only|--both]
#
# Prerequisites:
# 1. SSH access to inference-public configured in ~/.ssh/config
# 2. Local PostgreSQL running with postgres user accessible
# 3. Port 5433 available for temporary tunnel

set -e

# Configuration
REMOTE_HOST="inference-public"  # SSH config alias
REMOTE_PG_PORT=5432
LOCAL_TUNNEL_PORT=5433
REMOTE_SAI_DB="sai_dashboard"
REMOTE_N8N_DB="n8n"
LOCAL_SAI_DB="sai_dashboard_dev"
LOCAL_N8N_DB="n8n_dev"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Parse arguments
SYNC_SAI=false
SYNC_N8N=false

case "${1:-both}" in
  --sai-only) SYNC_SAI=true ;;
  --n8n-only) SYNC_N8N=true ;;
  --both|"") SYNC_SAI=true; SYNC_N8N=true ;;
  *)
    echo "Usage: $0 [--sai-only|--n8n-only|--both]"
    exit 1
    ;;
esac

# Check SSH connectivity
log_info "Checking SSH connectivity to $REMOTE_HOST..."
if ! ssh -o ConnectTimeout=5 "$REMOTE_HOST" "echo 'SSH OK'" &>/dev/null; then
  log_error "Cannot connect to $REMOTE_HOST. Check your SSH config."
  exit 1
fi
log_info "SSH connection OK"

# Setup port forward (background)
log_info "Setting up SSH tunnel (localhost:$LOCAL_TUNNEL_PORT -> $REMOTE_HOST:$REMOTE_PG_PORT)..."
ssh -f -N -L "$LOCAL_TUNNEL_PORT:localhost:$REMOTE_PG_PORT" "$REMOTE_HOST"
TUNNEL_PID=$(pgrep -f "ssh.*-L.*$LOCAL_TUNNEL_PORT")
log_info "Tunnel established (PID: $TUNNEL_PID)"

cleanup() {
  log_info "Cleaning up SSH tunnel..."
  kill "$TUNNEL_PID" 2>/dev/null || true
}
trap cleanup EXIT

# Wait for tunnel
sleep 2

# Function to sync a database
sync_database() {
  local remote_db=$1
  local local_db=$2
  local remote_user=$3

  log_info "Syncing $remote_db -> $local_db..."

  # Drop and recreate local database
  log_info "  Dropping local database $local_db (if exists)..."
  sudo -u postgres dropdb --if-exists "$local_db" 2>/dev/null || true

  log_info "  Creating local database $local_db..."
  sudo -u postgres createdb "$local_db"

  # Dump from remote and restore locally
  log_info "  Dumping from remote (this may take a while)..."

  # Use pg_dump through the tunnel
  PGPASSWORD="$REMOTE_PG_PASSWORD" pg_dump \
    -h localhost \
    -p "$LOCAL_TUNNEL_PORT" \
    -U "$remote_user" \
    -d "$remote_db" \
    --no-owner \
    --no-acl \
    -Fc \
    -f "/tmp/${remote_db}_dump.custom"

  log_info "  Restoring to local database..."
  sudo -u postgres pg_restore \
    -d "$local_db" \
    --no-owner \
    --no-acl \
    "/tmp/${remote_db}_dump.custom" || true  # Ignore some errors (roles, etc)

  rm -f "/tmp/${remote_db}_dump.custom"
  log_info "  ✅ $remote_db synced successfully"
}

# Get remote password
echo ""
echo "Enter the PostgreSQL password for remote server:"
read -s REMOTE_PG_PASSWORD
export REMOTE_PG_PASSWORD
echo ""

# Sync SAI Dashboard database
if $SYNC_SAI; then
  sync_database "$REMOTE_SAI_DB" "$LOCAL_SAI_DB" "n8n_user"
fi

# Sync N8N database (execution_data only for efficiency)
if $SYNC_N8N; then
  log_info "Syncing n8n execution_data table only (not full database)..."

  # Create local n8n_dev database
  sudo -u postgres dropdb --if-exists "$LOCAL_N8N_DB" 2>/dev/null || true
  sudo -u postgres createdb "$LOCAL_N8N_DB"

  # Dump only the execution_data table (with schema)
  log_info "  Dumping execution_data table from remote..."
  PGPASSWORD="$REMOTE_PG_PASSWORD" pg_dump \
    -h localhost \
    -p "$LOCAL_TUNNEL_PORT" \
    -U "n8n_user" \
    -d "$REMOTE_N8N_DB" \
    --no-owner \
    --no-acl \
    -t "execution_data" \
    -Fc \
    -f "/tmp/n8n_execution_data_dump.custom"

  log_info "  Restoring to local database..."
  sudo -u postgres pg_restore \
    -d "$LOCAL_N8N_DB" \
    --no-owner \
    --no-acl \
    "/tmp/n8n_execution_data_dump.custom" || true

  rm -f "/tmp/n8n_execution_data_dump.custom"
  log_info "  ✅ n8n execution_data synced successfully"
fi

echo ""
log_info "============================================"
log_info "Database sync complete!"
log_info ""
log_info "Local databases created:"
$SYNC_SAI && log_info "  - $LOCAL_SAI_DB (copy of $REMOTE_SAI_DB)"
$SYNC_N8N && log_info "  - $LOCAL_N8N_DB (execution_data from $REMOTE_N8N_DB)"
log_info ""
log_info "To use these in development, update your .env:"
log_info "  SAI_DB_NAME=$LOCAL_SAI_DB"
log_info "  N8N_DB_NAME=$LOCAL_N8N_DB"
log_info "  SAI_DB_USER=postgres"
log_info "  N8N_DB_USER=postgres"
log_info "  SAI_DB_PASSWORD="
log_info "  N8N_DB_PASSWORD="
log_info "============================================"
