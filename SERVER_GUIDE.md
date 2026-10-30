# EduSMS — Server Startup, cPanel (`edusms.edusphere.co.tz`) & GitHub Auto-Sync Guide

> **Interactive Copy-Paste Version**: You can also open [SERVER_COMMANDS.html](file:///home/hacker/Desktop/fullsmsgateway/SERVER_COMMANDS.html) in any browser or visit **Server & GitHub Sync** (`/server-ops`) inside the EduSMS Web Dashboard to click **Copy Command** or **Sync from GitHub Now** with one click.

---

## 1. Quick Start — Start the EduSMS Server Locally

### Step A: Start PostgreSQL, Redis & Django ASGI Server (`daphne`)
```bash
bash scripts/dev_services.sh start
backend/.venv/bin/python backend/manage.py migrate
backend/.venv/bin/daphne -b 0.0.0.0 -p 8000 --chdir backend edusms.asgi:application
```

### Step B: Start the React Web Dashboard
```bash
npm --prefix web run dev
```

### Step C: Start Celery Worker & Beat Scheduler (for Scheduled Campaigns & Webhooks)
```bash
backend/.venv/bin/celery --workdir backend -A edusms worker -l info
backend/.venv/bin/celery --workdir backend -A edusms beat -l info
```

---

## 2. Docker Compose Startup (All Services in One Command)

```bash
cp .env.example .env
docker compose up --build -d
docker compose exec backend python manage.py migrate
```

---

## 3. GitHub Repository Setup & Auto-Sync (`https://github.com/Hemedi18/edusms.git`)

### First-Time Push to GitHub
```bash
echo "# edusms" >> README.md
git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/Hemedi18/edusms.git
git push -u origin main
```

### Sync Latest GitHub Updates to Your Server
You can click the **"Sync from GitHub Now (Pull Latest)"** button inside the EduSMS Web Dashboard (`/server-ops`), or run:
```bash
git fetch origin main
git pull --ff-only origin main
backend/.venv/bin/python backend/manage.py migrate --noinput
npm --prefix web run build
```

### Automatic GitHub Webhook Sync
In GitHub → `Hemedi18/edusms` → **Settings → Webhooks → Add webhook**:
- **Payload URL**: `https://edusms.edusphere.co.tz/api/v1/ops/github-webhook/`
- **Content type**: `application/json`
- **Events**: `Just the push event`

---

## 4. cPanel Hosting on `edusms.edusphere.co.tz` & Support Email Setup

### Summary of Configured cPanel Architecture
- **Primary Domain**: `edusphere.co.tz`
- **Application Subdomain**: `https://edusms.edusphere.co.tz`
- **Document Root**: `/home/<cpanel_user>/public_html/edusms`
- **Passenger WSGI Entrypoint**: [passenger_wsgi.py](file:///home/hacker/Desktop/fullsmsgateway/passenger_wsgi.py)
- **Support & Error Alert Email**: `support@edusms.edusphere.co.tz`
- **Password Verification & Reset Email**: `noreply@edusms.edusphere.co.tz`
- **Inbound Email Reply Pipe**: [cpanel_email_pipe.py](file:///home/hacker/Desktop/fullsmsgateway/scripts/cpanel_email_pipe.py)

### Terminal Commands for cPanel SSH / Terminal
```bash
mkdir -p ~/public_html/edusms
cd ~/public_html/edusms
git clone https://github.com/Hemedi18/edusms.git . || git pull origin main
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt
backend/.venv/bin/python backend/manage.py migrate --noinput
backend/.venv/bin/python backend/manage.py collectstatic --noinput
npm --prefix web install && npm --prefix web run build
mkdir -p tmp && touch tmp/restart.txt
```

### Direct Email Reply → Live Chat Pipe in cPanel
In **cPanel → Email → Forwarders → Add Forwarder**:
- **Address to Forward**: `support@edusms.edusphere.co.tz`
- **Destination → Pipe to a Program**: `public_html/edusms/scripts/cpanel_email_pipe.py`
Whenever a customer sends their first Live Chat message, you receive an email at `support@edusms.edusphere.co.tz`. Replying directly to that email routes your message straight into the customer's Live Chat side panel in real time.
