#!/usr/bin/env bash
set -euo pipefail

PG_BIN="/usr/lib/postgresql/18/bin"
if [ ! -d "$PG_BIN" ]; then
  PG_BIN="/usr/lib/postgresql/17/bin"
fi

PG_DIR="/tmp/edusms-pg"
PG_SOCK="/tmp/edusms-pg-sock"
REDIS_DIR="/tmp/edusms-redis"
PG_PORT="${POSTGRES_PORT:-5432}"
REDIS_PORT="${REDIS_PORT:-6379}"

start_services() {
  mkdir -p "$PG_SOCK" "$REDIS_DIR"
  if [ ! -f "$PG_DIR/PG_VERSION" ]; then
    echo "[EduSMS] Initializing local PostgreSQL cluster in $PG_DIR..."
    "$PG_BIN/initdb" -D "$PG_DIR" -U postgres -A trust --encoding=UTF8 --locale=C >/dev/null
    cat >> "$PG_DIR/postgresql.conf" <<EOF
unix_socket_directories = '$PG_SOCK'
port = $PG_PORT
listen_addresses = '127.0.0.1'
max_connections = 100
EOF
  fi

  if ! "$PG_BIN/pg_isready" -h "$PG_SOCK" -p "$PG_PORT" >/dev/null 2>&1; then
    echo "[EduSMS] Starting PostgreSQL on 127.0.0.1:$PG_PORT and $PG_SOCK..."
    "$PG_BIN/pg_ctl" -D "$PG_DIR" -l "$PG_DIR/postgres.log" start
  fi

  "$PG_BIN/psql" -h "$PG_SOCK" -p "$PG_PORT" -U postgres -tc "SELECT 1 FROM pg_roles WHERE rolname='edusms'" | grep -q 1 || \
    "$PG_BIN/psql" -h "$PG_SOCK" -p "$PG_PORT" -U postgres -c "CREATE USER edusms WITH PASSWORD 'edusms_dev_pass' CREATEDB;"
  "$PG_BIN/psql" -h "$PG_SOCK" -p "$PG_PORT" -U postgres -tc "SELECT 1 FROM pg_database WHERE datname='edusms'" | grep -q 1 || \
    "$PG_BIN/createdb" -h "$PG_SOCK" -p "$PG_PORT" -U postgres -O edusms edusms

  if ! redis-cli -s "$REDIS_DIR/redis.sock" ping >/dev/null 2>&1; then
    echo "[EduSMS] Starting Redis on 127.0.0.1:$REDIS_PORT and $REDIS_DIR/redis.sock..."
    redis-server --daemonize yes \
      --dir "$REDIS_DIR" \
      --pidfile "$REDIS_DIR/redis.pid" \
      --logfile "$REDIS_DIR/redis.log" \
      --bind 127.0.0.1 \
      --port "$REDIS_PORT" \
      --unixsocket "$REDIS_DIR/redis.sock" \
      --unixsocketperm 700
  fi

  echo "[EduSMS] PostgreSQL and Redis are healthy."
}

stop_services() {
  if [ -f "$PG_DIR/PG_VERSION" ] && "$PG_BIN/pg_isready" -h "$PG_SOCK" -p "$PG_PORT" >/dev/null 2>&1; then
    "$PG_BIN/pg_ctl" -D "$PG_DIR" stop
  fi
  if [ -S "$REDIS_DIR/redis.sock" ]; then
    redis-cli -s "$REDIS_DIR/redis.sock" shutdown || true
  fi
  echo "[EduSMS] Local services stopped."
}

case "${1:-start}" in
  start) start_services ;;
  daemon)
    start_services
    echo "[EduSMS] Holding local PostgreSQL & Redis alive in daemon mode..."
    while true; do
      sleep 30
      "$PG_BIN/pg_isready" -h "$PG_SOCK" -p "$PG_PORT" >/dev/null 2>&1 || "$PG_BIN/pg_ctl" -D "$PG_DIR" -l "$PG_DIR/postgres.log" start
      redis-cli -s "$REDIS_DIR/redis.sock" ping >/dev/null 2>&1 || redis-server --daemonize yes --dir "$REDIS_DIR" --pidfile "$REDIS_DIR/redis.pid" --logfile "$REDIS_DIR/redis.log" --bind 127.0.0.1 --port "$REDIS_PORT" --unixsocket "$REDIS_DIR/redis.sock" --unixsocketperm 700
    done
    ;;
  stop) stop_services ;;
  restart) stop_services; start_services ;;
  *) echo "Usage: $0 {start|daemon|stop|restart}"; exit 1 ;;
esac
