# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is **Sponge Crawler** - a Node.js-based web crawler and document downloader that respects robots.txt and supports authentication. It can be used as a CLI tool, programmatically via API, or through a web interface.

## Development Commands

### Essential Commands
```bash
# Install dependencies
npm install

# Start web interface (primary entry point) on http://127.0.0.1:3000
npm start

# Alternative web interface commands
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
- **DocumentDownloader** (`src/downloader/DocumentDownloader.js`) - Handles file detection, downloading, and flat file structure management
- **PageEstimator** (`src/crawler/PageEstimator.js`) - Pre-crawl page estimation via sitemap analysis and pagination detection
- **AuthManager** (`src/auth/AuthManager.js`) - Supports basic auth, bearer tokens, and cookie-based authentication
- **RobotsChecker** (`src/crawler/RobotsChecker.js`) - Respects robots.txt rules and crawl delays
- **ConfigManager** (`src/config/ConfigManager.js`) - Hierarchical configuration system with CLI/file/default merging
- **FilterManager** (`src/utils/FilterManager.js`) - Smart filtering for file types, preventing unwanted downloads when not requested
- **ExportManager** (`src/export/ExportManager.js`) - Handles result export in various formats
- **ScheduleManager** (`src/scheduler/ScheduleManager.js`) - Manages cron-based scheduled crawling jobs

### Entry Points
- **CLI**: `bin/sponge.js` - Full-featured command line interface with subcommands
- **Programmatic**: `src/index.js` - Main entry point for direct usage
- **Web Interface**: `src/web-server.js` - Express server providing REST API and web UI (primary interface)

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
The application uses a hierarchical configuration system with intelligent merging:
1. Default configuration in ConfigManager (includes sensible defaults)
2. Config file (`sponge.config.json`) 
3. CLI/API options (highest priority)

**Critical Configuration Logic:**
- Web interface automatically sets `flatFileStructure: true` and `createMirrorStructure: false`
- Empty `allowedFileTypes: []` prevents ALL document downloads (not fallback to defaults)
- Page content saving is controlled separately via file type prefixes (e.g., "page-markdown")

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

## Critical Implementation Details

### File Structure Management
- **Flat File Structure**: Web interface enforces flat file structure where ALL files (documents + page content) are saved at the same level in the user-specified directory
- **Conflict Resolution**: `getFlatOutputPath()` method handles filename conflicts using hostname prefixes and counters
- **Automatic Cleanup**: Download endpoints automatically clean up crawl directories after ZIP download completion to prevent disk space bloat

### Document Filtering Logic
- **FilterManager**: `isDocumentUrl()` and `isDocumentType()` return `false` when `allowedFileTypes` is empty, preventing any document detection
- **Page Content Separation**: Page content (HTML→text/markdown) is handled separately from document downloads
- **Smart Type Detection**: File type selection in UI is processed into separate document types and page content formats

### Web Server Architecture
- **Network Binding**: Server binds to `127.0.0.1:3000` (not `0.0.0.0`) to avoid IPv6/IPv4 conflicts
- **API-First Design**: Core functionality exposed via REST endpoints with web UI as consumer
- **Memory Management**: Active crawls stored in-memory Map with automatic cleanup after 2 hours
- **Graceful Error Handling**: Comprehensive error handling with structured logging

### Page Estimation System
- **Pre-Crawl Analysis**: `PageEstimator.js` analyzes sitemaps and pagination patterns before crawling
- **Intelligent Limits**: Auto-adjusts `maxPages` based on discovered content patterns
- **Confidence Scoring**: Provides confidence levels for page count estimates

## File Structure Notes
- Output directories are user-configurable and automatically cleaned after downloads
- Web interface files (`index.html`, `app.js`, `styles.css`) provide the frontend UI
- Server logs to `server.log` when run in background mode

## Web Interface Features
- **Real-time Progress**: Live crawl progress with pagination detection and dual progress tracking
- **Page Estimation**: Pre-crawl analysis with intelligent page count suggestions
- **Flat File Downloads**: All content organized in single directory structure
- **Automatic Cleanup**: Downloaded content automatically cleaned from server after ZIP download
- **Abort Functionality**: Stop crawls while preserving results
- **Directory Browser**: File system navigation for output path selection