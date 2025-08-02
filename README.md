# 🧽 Sponge Crawler

A powerful, user-friendly web crawler and document downloader that extracts content and documents from websites while respecting ethical crawling practices.

![Sponge Crawler Interface](https://img.shields.io/badge/Interface-Web%20%26%20CLI-blue)
![Node.js](https://img.shields.io/badge/Node.js-16+-green)
![License](https://img.shields.io/badge/License-MIT-blue)

## ✨ Features

### 🎯 **Smart Crawling**
- **Intelligent Page Discovery** - Analyzes sitemaps and pagination patterns
- **Pre-Crawl Estimation** - Shows expected page count with confidence scoring
- **Configurable Depth Control** - Set crawling depth (1-10 levels)
- **Domain Filtering** - Stay within target domains or explore freely
- **Real-Time Progress** - Live monitoring with detailed statistics

### 📄 **Content Extraction**
- **Multiple Content Types** - HTML, Markdown, Plain Text page content
- **Document Detection** - Automatically finds PDFs, DOCs, images, and more
- **Flat File Structure** - Organized downloads in user-friendly format
- **On-Demand Downloads** - Files downloaded when requested (ZIP format)
- **Smart Status Display** - Clear "Available" status for all discoverable content

### 🌐 **Modern Web Interface**
- **Single-Page Layout** - Everything visible without scrolling
- **Compact Design** - Streamlined, focused user experience
- **Mobile Responsive** - Works on desktop, tablet, and mobile
- **Enhanced Tooltips** - Detailed explanations for all features
- **Bulk Downloads** - Download all found documents as ZIP

### 🔧 **Advanced Options**
- **File Type Filtering** - Select specific document types to download
- **Rate Limiting** - Configurable delays to be respectful to target sites
- **Robust Error Handling** - Graceful timeouts and recovery
- **Export Formats** - JSON metadata, human-readable reports

## 🚀 Quick Start

### Prerequisites
- Node.js 16+ 
- npm or yarn

### Installation
```bash
# Clone the repository
git clone https://github.com/Jan-H2M/sponge.git
cd sponge

# Install dependencies
npm install

# Start the web interface
npm start
```

The web interface will be available at **http://127.0.0.1:3000**

### Basic Usage

1. **Enter Website URL** - Input the target website URL
2. **Configure Options** - Set crawl depth and select content types
3. **View Page Estimation** - See predicted page count and analysis
4. **Start Crawling** - Watch real-time progress
5. **Download Results** - Get all found documents as ZIP file

## 🛠️ Usage

### Web Interface (Recommended)
The easiest way to use Sponge Crawler is through the streamlined web interface:

```bash
npm start
# Open http://127.0.0.1:3000 in your browser
```

**Features:**
- Compact single-page layout
- Pre-crawl page estimation with confidence scoring
- Real-time progress monitoring
- Bulk ZIP downloads
- Enhanced status descriptions

### Command Line Interface
```bash
# Basic crawl
npx sponge crawl https://example.com

# Advanced crawl with options
npx sponge crawl https://example.com -d 3 -o ./downloads --max-pages 500 --delay 2000

# Create configuration file
npm run config:init

# Test crawler setup
npx sponge test https://example.com
```

### Programmatic Usage
```javascript
const { SpongeCrawler } = require('./src/crawler/SpongeCrawler');

const config = {
    startUrl: 'https://example.com',
    maxDepth: 3,
    maxPages: 100,
    outputDir: './downloads',
    allowedFileTypes: ['pdf', 'doc', 'docx'],
    respectRobotsTxt: false  // Optional: ignore robots.txt
};

const crawler = new SpongeCrawler(config);
await crawler.crawl();
```

## 📁 Configuration

### Content Types
Select from various content and document types:

**Page Content:**
- 📄 HTML pages
- 📝 Markdown conversion  
- 📋 Plain text extraction

**Documents:**
- 📎 PDFs, Word docs, Excel files
- 🖼️ Images (PNG, JPG, GIF, etc.)
- 📦 Archives (ZIP, RAR, 7Z)
- 🎵 Audio files (MP3, WAV, etc.)
- 🎬 Video files (MP4, AVI, etc.)

### Crawl Settings
- **Max Depth**: How deep to crawl (1-10 levels)
- **Max Pages**: Maximum pages to visit (prevents runaway crawls)
- **Stay on Domain**: Limit crawling to the starting domain
- **Output Directory**: Where to save downloaded content

## 🎯 Key Features Explained

### **Page Estimation**
Before crawling, Sponge analyzes the target website to:
- 📊 Estimate total crawlable pages
- 🔗 Detect pagination patterns
- 🗺️ Find and analyze sitemaps
- ⭐ Provide confidence ratings (HIGH/MEDIUM/LOW)

Example estimation results:
```
📊 Page Estimation Results
Confidence: HIGH ⭐⭐⭐

Estimated Total: 2,267 pages
Pages Discovered: 0 (sitemap-based)
Pagination: No
Sitemap: Yes ✅
```

### **Smart Document Detection**
The crawler intelligently identifies downloadable content:
- 🔍 Scans page links for document URLs
- 📋 Checks file extensions and MIME types
- 🎯 Filters based on your selected file types
- 📈 Shows real-time discovery progress

### **On-Demand Downloads**
Efficient download system:
- 📝 Documents detected and cataloged during crawling
- ⚡ Actual downloads happen when you request the ZIP
- 💾 Saves bandwidth and storage during exploration
- 🔄 Fresh downloads ensure latest versions

## 📊 Understanding Results

### Status Indicators
- **Available** 🟢 - Document found and ready for download
- **Downloading** 🔵 - Currently being fetched
- **Completed** ✅ - Successfully downloaded
- **Failed** ❌ - Download encountered an error

### Confidence Levels
- **HIGH** ⭐⭐⭐ - Based on sitemap analysis (very reliable)
- **MEDIUM** ⭐⭐ - Based on link analysis (moderately reliable)  
- **LOW** ⭐ - Limited data available (less reliable)

## 🛡️ Recent Improvements

### v2.0 Features
- ✅ **Fixed Status Display** - Documents now show "Available" instead of confusing "Pending"
- ✅ **Streamlined Interface** - Compact single-page layout without scrolling
- ✅ **Enhanced Page Estimation** - Detailed descriptions and confidence tooltips
- ✅ **Improved Error Handling** - Graceful timeouts and fallback responses
- ✅ **Robots.txt Handling** - Option removed (always ignored for better crawling)

## 🔧 Development

### Project Structure
```
sponge/
├── src/
│   ├── crawler/          # Core crawling logic
│   │   ├── SpongeCrawler.js
│   │   ├── UrlQueue.js
│   │   ├── PageEstimator.js
│   │   └── RobotsChecker.js
│   ├── downloader/       # Document download handling
│   │   └── DocumentDownloader.js
│   ├── auth/            # Authentication support
│   │   └── AuthManager.js
│   ├── utils/           # Utility functions
│   │   ├── FilterManager.js
│   │   └── Logger.js
│   ├── export/          # Result export formats
│   │   └── ExportManager.js
│   └── web-server.js    # Express server
├── bin/sponge.js        # CLI entry point
├── index.html          # Web interface
├── app.js              # Frontend JavaScript
├── styles.css          # Interface styling
└── CLAUDE.md           # Technical documentation
```

### Available Scripts
```bash
npm start              # Start web interface
npm run web            # Alternative web interface command
npm run cli            # Run CLI directly
npm run dev            # Development with auto-reload
npm test               # Run tests
npm run lint           # Lint code
npm run build          # Build distribution package
```

### Server Management
```bash
npm run web:start      # Start server in background
npm run web:stop       # Stop background server
npm run web:restart    # Restart server
npm run web:logs       # View server logs
```
