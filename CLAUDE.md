# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is **Sponge Crawler** - a Node.js-based web crawler and document downloader that respects robots.txt and supports authentication. It can be used as a CLI tool, programmatically via API, or through a web interface.

## Development Commands

### Essential Commands
```bash
# Install dependencies
npm install

# Start main application (uses src/index.js)
npm start

# Start web interface on http://localhost:3000
npm run web

# Web server management (background processes)
npm run web:start    # Start in background
npm run web:stop     # Stop background server
npm run web:restart  # Restart server
npm run web:logs     # View server logs

# Run CLI directly
npm run cli

# Development with auto-reload
npm run dev
```

### Testing & Quality
```bash
# Run tests
npm test

# Lint code
npm run lint

# Build distribution package
npm run build
```

### CLI Usage Examples
```bash
# Basic crawl
npx sponge crawl https://example.com

# Advanced crawl with options
npx sponge crawl https://example.com -d 3 -o ./downloads --max-pages 500 --delay 2000

# Create example configuration
npm run config:init
# OR
npx sponge config --init

# Test crawler configuration
npx sponge test https://example.com

# Schedule recurring crawl
npx sponge schedule "0 2 * * *" https://example.com --name daily-crawl
```

## Architecture

### Core Components
- **SpongeCrawler** (`src/crawler/SpongeCrawler.js`) - Main orchestration class that coordinates all crawling activities
- **UrlQueue** (`src/crawler/UrlQueue.js`) - Manages URL discovery and queuing with deduplication
- **DocumentDownloader** (`src/downloader/DocumentDownloader.js`) - Handles file detection and downloading
- **AuthManager** (`src/auth/AuthManager.js`) - Supports basic auth, bearer tokens, and cookie-based authentication
- **RobotsChecker** (`src/crawler/RobotsChecker.js`) - Respects robots.txt rules and crawl delays
- **ConfigManager** (`src/config/ConfigManager.js`) - Loads and validates configuration from files or CLI options
- **FilterManager** (`src/utils/FilterManager.js`) - Applies filtering rules for file types, sizes, and URL patterns
- **ExportManager** (`src/export/ExportManager.js`) - Handles result export in various formats
- **ScheduleManager** (`src/scheduler/ScheduleManager.js`) - Manages cron-based scheduled crawling jobs

### Entry Points
- **CLI**: `bin/sponge.js` - Full-featured command line interface with subcommands
- **Programmatic**: `src/index.js` - Main entry point for direct usage
- **Web Interface**: `src/web-server.js` - Express server providing REST API and web UI

### Key Libraries
- **axios** - HTTP client with configurable timeouts and auth
- **cheerio** - Server-side HTML parsing and manipulation
- **archiver** - ZIP file creation for bulk downloads
- **express** - Web server framework for REST API and UI
- **puppeteer** - Headless browser automation (optional, for dynamic content)
- **commander** - CLI argument parsing and command structure
- **winston** - Structured logging
- **p-limit** - Concurrency control for crawling operations
- **robots-parser** - Robots.txt parsing and compliance

### Configuration System
The application uses a hierarchical configuration system:
1. Default configuration in ConfigManager
2. Config file (`sponge.config.json`)
3. CLI options (highest priority)

Key configuration options include crawl depth, file types, authentication settings, rate limiting, and output formats.

### Authentication Support
Supports multiple authentication methods:
- Basic Auth (username/password)
- Bearer Token
- Cookie-based authentication
- Custom headers

### Rate Limiting & Ethics
- Respects robots.txt by default (configurable)
- Implements request delays and concurrency limits
- Designed for legitimate use cases like documentation archiving
- Built-in safeguards against aggressive crawling

## File Structure Notes
- Test/output directories (`downloads/`, `final-test/`, etc.) contain crawl results and should not be modified directly
- `logs/` directory contains crawler and error logs
- Web interface files (`index.html`, `app.js`, `styles.css`) provide the frontend UI

## Web Interface Features
- Real-time crawl progress with pagination detection
- Smart page count estimation based on discovered content
- Abort functionality to stop crawls while preserving results
- ZIP download for bulk document retrieval
- Directory browser for output path selection
- Dual progress tracking (pagination vs total pages)