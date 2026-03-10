# Brezel Installer

Official installer for Brezel ERP. This tool automates the setup of Brezel instances across different environments, including native Linux/macOS, Laravel Valet, and Docker.

## Fast-Track Installation

Run this command in your terminal to start the installation:

```bash
curl -sL https://brezel.io/install.sh | sh
```

## Features

- **Environment Validation:** Checks for Git, Node, NPM, and PHP 8.3+ before execution.
- **macOS Valet Support:** Automatically handles domain linking (`valet link`) and SSL configuration (`valet secure`).
- **Docker Integration:** Complete containerized setup including service orchestration and networking.
- **Native Setup:** Automates dependency installation and system configuration for bare-metal deployments.
- **System Components:** Optional automated setup for MariaDB, Nginx, SSL (Certbot), and Cron tasks.
- **Output Preview:** Provides real-time feedback for background tasks like Composer and NPM builds.
- **Non-Interactive Mode:** Full CLI support for automated deployments and CI/CD pipelines.

## Usage

### Interactive Mode
Run the installer and follow the terminal prompts:
```bash
./install.sh
# OR
node dist/index.js
```

### Non-Interactive Mode
Specify configuration via CLI flags:
```bash
node dist/index.js \
  --dir ./my-brezel \
  --system production \
  --mode native \
  --url https://api.brezel.io \
  --no-interactive
```

### CLI Options

| Option | Description | Default |
| :--- | :--- | :--- |
| `-d, --dir` | Installation directory | `./brezel` |
| `-m, --mode` | Installation mode (`native`, `valet`, `docker`) | `native` |
| `-s, --system` | System/tenant name | `example` |
| `-u, --url` | API URL | `http://{system}.test` |
| `--spa-url` | SPA (frontend) URL | `http://localhost:5173` |
| `--php-path` | Path to PHP 8.3+ executable | `php` |
| `--gitlab-token` | GitLab Personal Access Token | (Prompted) |
| `--source-mode` | `clone` or `fork` | `clone` |
| `--components` | Optional components (`mariadb,nginx,ssl,cron`) | `""` |
| `--no-interactive`| Run without user prompts | `false` |

## Development

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Build:**
   ```bash
   npm run build
   ```

3. **Run Dev:**
   ```bash
   npm run dev
   ```

## Prerequisites

- **Node.js:** v18+
- **Git:** Latest
- **Native/Valet:** PHP 8.3+ and Composer
- **Docker:** Docker Compose
