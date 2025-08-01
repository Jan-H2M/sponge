# 🧽 Sponge Crawler

Website Content & Document Crawler for Developers - Automate extraction and downloading of content/documents from public websites.

## Key Features

🌐 **Customizable Web Crawler**: Define crawl depth, allowed domains, content types (HTML, JSON, documents, images), and rate limits.

📂 **Document Collector**: Automatically detect and download file assets such as PDFs, Office documents, images, and other static files.

🔐 **Auth Support**: Supports session-based or token-based authentication (e.g., Basic Auth, Bearer tokens, cookies).

🧠 **Smart Filtering**: Include/exclude resources based on file type, URL pattern, or content size.

📁 **Structured Export**: Save content using a mirrored directory structure or export metadata in JSON/CSV for further processing.

🔁 **Automated Jobs**: Schedule recurring downloads or integrate into pipelines (e.g., via CLI or API).

## Installation & Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the web interface:**
   ```bash
   npm run web
   ```
   Navigate to `http://localhost:3000`

3. **Use the CLI:**
   ```bash
   # Crawl a website
   npx sponge crawl https://example.com -d 2 -o ./downloads

   # Create example config
   npx sponge config --init

   # Schedule a job
   npx sponge schedule "0 2 * * *" https://example.com --name daily-crawl
   ```

## Project Structure

```
sponge/
├── bin/
│   └── sponge.js           # CLI entry point
├── src/
│   ├── crawler/            # Core crawling logic
│   │   ├── SpongeCrawler.js
│   │   ├── UrlQueue.js
│   │   └── RobotsChecker.js
│   ├── downloader/         # File downloading
│   │   └── DocumentDownloader.js
│   ├── auth/               # Authentication handling
│   │   └── AuthManager.js
│   ├── config/             # Configuration management
│   │   └── ConfigManager.js
│   ├── export/             # Results export
│   │   └── ExportManager.js
│   ├── scheduler/          # Job scheduling
│   │   └── ScheduleManager.js
│   ├── utils/              # Utility functions
│   │   ├── Logger.js
│   │   └── FilterManager.js
│   ├── index.js            # Main entry point
│   └── web-server.js       # Web interface server
├── index.html              # Web interface
├── app.js                  # Frontend JavaScript
├── styles.css              # Web interface styles
├── server.js               # Original server (deprecated)
├── package.json            # Project configuration
└── README.md               # This file
```

## Usage Examples

### Command Line Interface

```bash
# Basic crawl
sponge crawl https://example.com

# Advanced crawl with options
sponge crawl https://example.com \
  --depth 3 \
  --output ./my-downloads \
  --allowed-types pdf,docx,xlsx \
  --max-pages 500 \
  --delay 2000

# With authentication
sponge crawl https://example.com \
  --auth-type basic \
  --auth-user myuser \
  --auth-pass mypass

# Schedule recurring crawl
sponge schedule "0 2 * * *" https://example.com --name daily-docs

# Test configuration
sponge test https://example.com --config ./my-config.json
```

### Configuration File

Create `sponge.config.json`:

```json
{
  "startUrl": "https://example.com",
  "maxDepth": 3,
  "maxPages": 1000,
  "allowedFileTypes": ["pdf", "docx", "xlsx", "jpg", "png"],
  "maxFileSize": 104857600,
  "outputDir": "./downloads",
  "respectRobotsTxt": true,
  "delay": 1000,
  "auth": {
    "type": "basic",
    "username": "user",
    "password": "pass"
  }
}
```

### Programmatic Usage

```javascript
const { SpongeCrawler } = require('sponge-crawler');

const config = {
  startUrl: 'https://example.com',
  maxDepth: 2,
  outputDir: './downloads',
  allowedFileTypes: ['pdf', 'docx']
};

const crawler = new SpongeCrawler(config);
await crawler.start();
```

## API Endpoints (Web Interface)

- `GET /` - Web interface
- `POST /api/crawl/start` - Start new crawl
- `GET /api/crawl/:id/status` - Check crawl status
- `GET /api/crawl/:id/download` - Download results
- `GET /api/jobs` - List scheduled jobs
- `POST /api/jobs` - Create scheduled job
- `DELETE /api/jobs/:name` - Remove scheduled job
- `GET /api/health` - Health check

## Use Cases

- **Automated archiving** of project documentation or web-based knowledge bases
- **Bulk download** of legal/public datasets spread over multiple URLs
- **Building offline mirrors** of static sites for testing, compliance, or research
- **Extracting content** for analysis or NLP pipelines
- **Compliance monitoring** - regularly download and check website content

## Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| `startUrl` | Starting URL to crawl | Required |
| `maxDepth` | Maximum crawl depth | 3 |
| `maxPages` | Maximum pages to crawl | 1000 |
| `allowedFileTypes` | File extensions to download | See config |
| `maxFileSize` | Maximum file size (bytes) | 100MB |
| `outputDir` | Download directory | `./downloads` |
| `respectRobotsTxt` | Follow robots.txt rules | `true` |
| `delay` | Delay between requests (ms) | 1000 |
| `concurrency` | Concurrent requests | 5 |

## Authentication Support

- **Basic Auth**: Username/password
- **Bearer Token**: API tokens
- **Cookie Auth**: Session cookies
- **Custom Headers**: Flexible header-based auth

## Legal & Ethical Use

⚖️ **Important**: This tool is designed for ethical use within legal boundaries:

- Respects `robots.txt` by default (configurable)
- Not intended for scraping private, copyrighted, or protected content without consent
- Users are responsible for complying with target sites' terms of service and copyright laws
- Built for legitimate use cases like archiving public documentation and research

## Development

### Scripts

- `npm start` - Start main application
- `npm run web` - Start web interface
- `npm run cli` - Run CLI directly
- `npm run config:init` - Create example config
- `npm test` - Run tests
- `npm run lint` - Lint code
- `npm run build` - Build for distribution

### Technologies Used

- **Core**: Node.js, Express.js
- **Crawling**: Axios, Cheerio, Puppeteer (optional)
- **CLI**: Commander.js
- **Scheduling**: node-cron
- **Logging**: Winston
- **Frontend**: HTML5, CSS3, Vanilla JavaScript

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test your changes thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

---

Built with ❤️ for the developer community. Use responsibly! 🧽