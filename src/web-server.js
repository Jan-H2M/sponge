const express = require('express');
const path = require('path');
const fs = require('fs-extra');

const { SpongeCrawler } = require('./crawler/SpongeCrawler');
const { ConfigManager } = require('./config/ConfigManager');
const { Logger } = require('./utils/Logger');
const { PageEstimator } = require('./crawler/PageEstimator');

/**
 * Web interface for Sponge Crawler
 */
class SpongeWebServer {
    constructor(port = 3000) {
        this.port = port;
        this.app = express();
        this.logger = new Logger();
        this.activeCrawls = new Map();
        
        this.setupMiddleware();
        this.setupRoutes();
    }

    setupMiddleware() {
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));
        this.app.use(express.static(path.join(__dirname, '../')));
    }

    setupRoutes() {
        // Serve main page
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, '../index.html'));
        });

        // API Routes
        
        // Health check
        this.app.get('/api/health', (req, res) => {
            res.json({
                status: 'healthy',
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                version: require('../package.json').version
            });
        });

        // Estimate pages before crawl
        this.app.post('/api/crawl/estimate', async (req, res) => {
            try {
                const { url, config } = req.body;
                
                if (!url) {
                    return res.status(400).json({ error: 'URL is required' });
                }

                this.logger.info(`🔍 Estimating pages for: ${url}`);
                
                const estimatorConfig = {
                    maxDepth: config?.maxDepth || 3,
                    timeout: config?.timeout || 10000,
                    userAgent: config?.userAgent || 'Sponge-Crawler/1.0.0'
                };

                const estimation = await PageEstimator.quickEstimate(url, estimatorConfig);
                
                // Auto-adjust maxPages based on estimation
                let suggestedMaxPages = estimation.estimatedTotal;
                
                // Apply intelligent limits
                if (suggestedMaxPages > 1000) {
                    suggestedMaxPages = 1000; // Cap at 1000 for safety
                } else if (suggestedMaxPages < 1) {
                    suggestedMaxPages = 1; // Minimum 1 page
                }

                res.json({
                    success: true,
                    url,
                    estimation: {
                        ...estimation,
                        suggestedMaxPages,
                        originalMaxPages: config?.maxPages || 100,
                        autoAdjusted: suggestedMaxPages !== (config?.maxPages || 100)
                    }
                });

            } catch (error) {
                this.logger.error('Failed to estimate pages:', error);
                res.status(500).json({ 
                    error: error.message,
                    estimation: {
                        estimatedTotal: 1,
                        discoveredUrls: 0,
                        paginationDetected: false,
                        sitemapFound: false,
                        patterns: [],
                        sampleUrls: [],
                        confidence: 'error',
                        suggestedMaxPages: 1
                    }
                });
            }
        });

        // Adjust max pages limit
        this.app.post('/api/crawl/adjust-limit', async (req, res) => {
            try {
                const { estimatedTotal, userLimit } = req.body;
                
                if (!estimatedTotal || !userLimit) {
                    return res.status(400).json({ error: 'estimatedTotal and userLimit are required' });
                }

                let adjustedLimit = parseInt(userLimit);
                
                // Validation and safety checks
                if (adjustedLimit < 1) {
                    adjustedLimit = 1;
                } else if (adjustedLimit > 10000) {
                    adjustedLimit = 10000; // Absolute maximum
                }

                // Calculate reduction percentage if applicable
                const reductionPercentage = adjustedLimit < estimatedTotal 
                    ? Math.round(((estimatedTotal - adjustedLimit) / estimatedTotal) * 100)
                    : 0;

                res.json({
                    success: true,
                    adjustedLimit,
                    originalEstimate: estimatedTotal,
                    reduction: reductionPercentage,
                    recommended: adjustedLimit <= estimatedTotal * 0.5 ? 'Consider crawling more pages for better coverage' : 'Good balance',
                    safety: adjustedLimit > 1000 ? 'Large crawl - may take significant time' : 'Reasonable crawl size'
                });

            } catch (error) {
                this.logger.error('Failed to adjust page limit:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Start crawl
        this.app.post('/api/crawl/start', async (req, res) => {
            try {
                const { url, config } = req.body;
                
                if (!url) {
                    return res.status(400).json({ error: 'URL is required' });
                }

                const crawlId = this.generateCrawlId();
                const configManager = new ConfigManager();
                // Process page-* file types before loading config
                const processedConfig = { ...config };
                if (config.allowedFileTypes) {
                    const pageTypes = config.allowedFileTypes.filter(ft => ft.startsWith('page-'));
                    if (pageTypes.length > 0) {
                        // Enable page content saving with the first page type found
                        const format = pageTypes[0].replace('page-', '');
                        processedConfig.savePageContent = true;
                        processedConfig.pageContentFormat = format;
                        
                        // Remove page-* from allowedFileTypes as they're not real file types
                        processedConfig.allowedFileTypes = config.allowedFileTypes.filter(ft => !ft.startsWith('page-'));
                        
                        // If only page types were selected and no other file types, disable document downloading
                        if (processedConfig.allowedFileTypes.length === 0) {
                            processedConfig.allowedFileTypes = []; // Empty array means no document types
                        }
                    }
                }
                
                const crawlConfig = await configManager.loadConfig({
                    startUrl: url,
                    ...processedConfig
                });
                
                // Validate the crawl configuration
                configManager.validateCrawlConfig(crawlConfig);

                // Start crawl in background
                const crawler = new SpongeCrawler(crawlConfig);
                this.activeCrawls.set(crawlId, {
                    crawler,
                    config: crawlConfig,
                    startTime: new Date(),
                    status: 'running'
                });

                // Start crawling
                crawler.start()
                    .then(() => {
                        const crawl = this.activeCrawls.get(crawlId);
                        if (crawl) {
                            crawl.status = 'completed';
                            crawl.endTime = new Date();
                            // Store final stats for later retrieval
                            if (crawl.crawler) {
                                crawl.finalStats = crawl.crawler.getCurrentStats();
                            }
                        }
                    })
                    .catch((error) => {
                        const crawl = this.activeCrawls.get(crawlId);
                        if (crawl) {
                            crawl.status = 'failed';
                            crawl.error = error.message;
                            crawl.endTime = new Date();
                            // Store final stats even for failed crawls
                            if (crawl.crawler) {
                                crawl.finalStats = crawl.crawler.getCurrentStats();
                            }
                        }
                    });

                res.json({
                    success: true,
                    crawlId,
                    message: 'Crawl started successfully'
                });

            } catch (error) {
                this.logger.error('Failed to start crawl:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Get crawl status
        this.app.get('/api/crawl/:id/status', (req, res) => {
            const crawlId = req.params.id;
            const crawl = this.activeCrawls.get(crawlId);
            
            if (!crawl) {
                return res.status(404).json({ error: 'Crawl not found' });
            }

            // Get real-time stats from crawler if available
            let stats = {};
            if (crawl.crawler) {
                try {
                    stats = crawl.crawler.getCurrentStats() || {};
                } catch (error) {
                    this.logger.error('Error getting crawler stats:', error);
                    stats = {};
                }
            }
            
            // If no stats from crawler, use stored final stats
            if (!stats.pagesVisited && crawl.finalStats) {
                stats = crawl.finalStats;
            }

            res.json({
                crawlId,
                status: crawl.status,
                startTime: crawl.startTime,
                endTime: crawl.endTime,
                error: crawl.error,
                config: {
                    startUrl: crawl.config.startUrl,
                    maxDepth: crawl.config.maxDepth,
                    maxPages: crawl.config.maxPages,
                    outputDir: crawl.config.outputDir
                },
                stats: {
                    pagesVisited: stats.pagesVisited || 0,
                    documentsFound: stats.documentsFound || 0,
                    documentsDownloaded: stats.documentsDownloaded || 0,
                    queueSize: stats.queueSize || 0,
                    currentUrl: stats.currentUrl || null,
                    errors: stats.totalErrors || 0,
                    totalPagesDiscovered: stats.totalPagesDiscovered || 0,
                    paginationDetected: stats.paginationDetected || false,
                    estimatedTotalPages: stats.estimatedTotalPages || 0,
                    aborted: stats.aborted || false
                }
            });
        });

        // Abort crawl
        this.app.post('/api/crawl/:id/abort', (req, res) => {
            const crawlId = req.params.id;
            const crawl = this.activeCrawls.get(crawlId);
            
            if (!crawl) {
                return res.status(404).json({ error: 'Crawl not found' });
            }

            if (crawl.status === 'completed' || crawl.status === 'failed') {
                return res.status(400).json({ error: 'Crawl already finished' });
            }

            // Abort the crawler
            if (crawl.crawler && crawl.crawler.abort) {
                crawl.crawler.abort();
                crawl.status = 'aborted';
                crawl.endTime = new Date();
                
                res.json({
                    success: true,
                    message: 'Crawl aborted successfully',
                    crawlId
                });
            } else {
                res.status(500).json({ error: 'Unable to abort crawl' });
            }
        });

        // List active crawls
        this.app.get('/api/crawls', (req, res) => {
            const crawls = Array.from(this.activeCrawls.entries()).map(([id, crawl]) => ({
                crawlId: id,
                status: crawl.status,
                startTime: crawl.startTime,
                endTime: crawl.endTime,
                url: crawl.config.startUrl
            }));

            res.json({ crawls });
        });

        // Get list of found documents for a crawl
        this.app.get('/api/crawl/:id/documents', (req, res) => {
            const crawlId = req.params.id;
            const crawl = this.activeCrawls.get(crawlId);
            
            if (!crawl) {
                return res.status(404).json({ error: 'Crawl not found' });
            }

            // Get documents from crawler
            let documents = [];
            if (crawl.crawler && crawl.crawler.foundDocuments) {
                documents = Array.from(crawl.crawler.foundDocuments.entries()).map(([url, metadata], index) => {
                    const urlObj = new URL(url);
                    const filename = this.extractFilename(url);
                    
                    return {
                        index,
                        url,
                        filename,
                        extension: path.extname(filename).toLowerCase().substring(1),
                        domain: urlObj.hostname,
                        sourceUrl: metadata.sourceUrl || url,
                        depth: metadata.depth || 0,
                        contentType: metadata.contentType || null,
                        size: metadata.size || null,
                        sizeFormatted: metadata.size ? this.formatBytes(metadata.size) : 'Unknown',
                        downloaded: metadata.downloaded || false,
                        downloadPath: metadata.filePath || null
                    };
                });
            }

            res.json({
                crawlId,
                status: crawl.status,
                totalDocuments: documents.length,
                documents
            });
        });

        // Download individual document
        this.app.get('/api/crawl/:id/download-file/:fileIndex', async (req, res) => {
            try {
                const crawlId = req.params.id;
                const fileIndex = parseInt(req.params.fileIndex);
                const crawl = this.activeCrawls.get(crawlId);
                
                if (!crawl) {
                    return res.status(404).json({ error: 'Crawl not found' });
                }

                if (!crawl.crawler || !crawl.crawler.foundDocuments) {
                    return res.status(404).json({ error: 'No documents found' });
                }

                const documents = Array.from(crawl.crawler.foundDocuments.entries());
                if (fileIndex < 0 || fileIndex >= documents.length) {
                    return res.status(404).json({ error: 'Document not found' });
                }

                const [url, metadata] = documents[fileIndex];
                const filename = this.extractFilename(url);

                // If file was already downloaded to output directory, serve it
                if (metadata.filePath && await fs.pathExists(metadata.filePath)) {
                    res.download(metadata.filePath, filename);
                } else {
                    // Download file directly from source URL
                    const axios = require('axios');
                    const response = await axios.get(url, {
                        responseType: 'stream',
                        timeout: 30000,
                        headers: {
                            'User-Agent': crawl.config.userAgent || 'Sponge-Crawler/1.0.0'
                        }
                    });

                    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
                    res.setHeader('Content-Type', response.headers['content-type'] || 'application/octet-stream');
                    
                    if (response.headers['content-length']) {
                        res.setHeader('Content-Length', response.headers['content-length']);
                    }

                    response.data.pipe(res);
                }

            } catch (error) {
                this.logger.error('Error downloading file:', error);
                res.status(500).json({ error: error.message });
            }
        });


        // Get statistics
        this.app.get('/api/stats', (req, res) => {
            res.json({
                activeCrawls: this.activeCrawls.size,
                uptime: process.uptime(),
                memory: process.memoryUsage()
            });
        });

        // Download all documents as ZIP
        this.app.get('/api/crawl/:id/download-all-zip', async (req, res) => {
            try {
                const crawlId = req.params.id;
                const crawl = this.activeCrawls.get(crawlId);
                
                if (!crawl) {
                    return res.status(404).json({ error: 'Crawl not found' });
                }

                if (!crawl.crawler || !crawl.crawler.foundDocuments) {
                    return res.status(404).json({ error: 'No documents found' });
                }

                const documents = Array.from(crawl.crawler.foundDocuments.entries());
                if (documents.length === 0) {
                    return res.status(404).json({ error: 'No documents to download' });
                }

                // Create a ZIP file containing all found documents
                const archiver = require('archiver');
                const axios = require('axios');
                const archive = archiver('zip', { zlib: { level: 9 } });
                
                res.attachment(`sponge-documents-${crawlId}.zip`);
                archive.pipe(res);

                // Add each document to the archive
                for (let i = 0; i < documents.length; i++) {
                    const [url, metadata] = documents[i];
                    const filename = this.extractFilename(url);
                    
                    try {
                        if (metadata.filePath && await fs.pathExists(metadata.filePath)) {
                            // Add file from disk if it exists
                            archive.file(metadata.filePath, { name: filename });
                        } else {
                            // Download file directly and add to archive
                            const response = await axios.get(url, {
                                responseType: 'stream',
                                timeout: 30000,
                                headers: {
                                    'User-Agent': crawl.config.userAgent || 'Sponge-Crawler/1.0.0'
                                }
                            });
                            
                            archive.append(response.data, { name: filename });
                        }
                    } catch (error) {
                        this.logger.error(`Error adding ${filename} to ZIP:`, error);
                        // Continue with other files even if one fails
                    }
                }

                // Add metadata file
                const metadata = {
                    crawlId,
                    crawlUrl: crawl.config.startUrl,
                    crawlTime: crawl.startTime,
                    documentsCount: documents.length,
                    documents: documents.map(([url, meta], index) => ({
                        index,
                        url,
                        filename: this.extractFilename(url),
                        sourceUrl: meta.sourceUrl || url,
                        depth: meta.depth || 0
                    }))
                };
                
                archive.append(JSON.stringify(metadata, null, 2), { name: 'crawl-metadata.json' });
                
                archive.finalize();

            } catch (error) {
                this.logger.error('Error creating ZIP download:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Download page content files as ZIP
        this.app.get('/api/crawl/:id/download-pages-zip', async (req, res) => {
            try {
                const crawlId = req.params.id;
                const crawl = this.activeCrawls.get(crawlId);
                
                if (!crawl) {
                    return res.status(404).json({ error: 'Crawl not found' });
                }

                const outputDir = crawl.config.outputDir;
                const pagesDir = path.join(outputDir, 'pages');
                
                if (!await fs.pathExists(pagesDir)) {
                    return res.status(404).json({ error: 'No page content files found' });
                }
                
                // Check if there are any files in pages directory
                const pageFiles = await fs.readdir(pagesDir, { recursive: true });
                const actualFiles = [];
                
                for (const file of pageFiles) {
                    const filePath = path.join(pagesDir, file);
                    const stat = await fs.stat(filePath);
                    if (stat.isFile()) {
                        actualFiles.push(file);
                    }
                }
                
                if (actualFiles.length === 0) {
                    return res.status(404).json({ error: 'No page content files found' });
                }

                // Create a ZIP file containing all page content files
                const archiver = require('archiver');
                const archive = archiver('zip', { zlib: { level: 9 } });
                
                res.attachment(`sponge-pages-${crawlId}.zip`);
                archive.pipe(res);
                
                // Add all files from the pages directory
                archive.directory(pagesDir, 'pages');
                
                archive.finalize();

            } catch (error) {
                this.logger.error('Error downloading page content files:', error);
                res.status(500).json({ error: 'Failed to download page content files' });
            }
        });

        // Download results (legacy endpoint)
        this.app.get('/api/crawl/:id/download', async (req, res) => {
            try {
                const crawlId = req.params.id;
                const crawl = this.activeCrawls.get(crawlId);
                
                if (!crawl) {
                    return res.status(404).json({ error: 'Crawl not found' });
                }

                const outputDir = crawl.config.outputDir;
                const metadataFile = path.join(outputDir, 'sponge-metadata.json');
                
                if (await fs.pathExists(metadataFile)) {
                    // Create a ZIP file containing all crawl results
                    const archiver = require('archiver');
                    const archive = archiver('zip', { zlib: { level: 9 } });
                    
                    res.attachment(`sponge-crawl-${crawlId}.zip`);
                    archive.pipe(res);
                    
                    // Add all files from the output directory
                    archive.directory(outputDir, false);
                    
                    archive.finalize();
                } else {
                    res.status(404).json({ error: 'Results not available yet' });
                }

            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Configuration endpoints
        
        // Get default config
        this.app.get('/api/config/default', async (req, res) => {
            try {
                const configManager = new ConfigManager();
                const defaultConfig = configManager.getDefaultConfig();
                res.json({ config: defaultConfig });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Validate config
        this.app.post('/api/config/validate', async (req, res) => {
            try {
                const { config } = req.body;
                const configManager = new ConfigManager();
                
                // Use crawl validation if startUrl is provided, otherwise basic validation
                if (config.startUrl) {
                    configManager.validateCrawlConfig(config);
                } else {
                    configManager.validateConfig(config);
                }
                
                res.json({ valid: true, message: 'Configuration is valid' });
                
            } catch (error) {
                res.status(400).json({ 
                    valid: false, 
                    error: error.message 
                });
            }
        });

        // File system browser endpoints
        
        // Browse directories
        this.app.get('/api/filesystem/browse', async (req, res) => {
            try {
                const dirPath = req.query.path || require('os').homedir();
                
                // Security check - only allow browsing within safe directories
                const homeDir = require('os').homedir();
                const allowedPaths = [
                    homeDir,
                    '/Users',
                    '/home',
                    process.cwd(),
                    path.join(process.cwd(), '..'),
                    path.join(homeDir, 'Downloads'),
                    path.join(homeDir, 'Documents'),
                    path.join(homeDir, 'Desktop'),
                    '/tmp',
                    '/var/tmp'
                ];
                
                const isAllowed = allowedPaths.some(allowedPath => 
                    path.resolve(dirPath).startsWith(path.resolve(allowedPath))
                );
                
                if (!isAllowed) {
                    return res.status(403).json({ error: 'Access denied to this directory' });
                }

                if (!await fs.pathExists(dirPath)) {
                    return res.status(404).json({ error: 'Directory not found' });
                }

                const stats = await fs.stat(dirPath);
                if (!stats.isDirectory()) {
                    return res.status(400).json({ error: 'Path is not a directory' });
                }

                const items = await fs.readdir(dirPath);
                const directories = [];
                const files = [];

                for (const item of items) {
                    try {
                        const itemPath = path.join(dirPath, item);
                        const itemStats = await fs.stat(itemPath);
                        
                        if (itemStats.isDirectory()) {
                            directories.push({
                                name: item,
                                path: itemPath,
                                type: 'directory',
                                size: null,
                                modified: itemStats.mtime
                            });
                        } else {
                            files.push({
                                name: item,
                                path: itemPath,
                                type: 'file',
                                size: itemStats.size,
                                sizeFormatted: this.formatBytes(itemStats.size),
                                modified: itemStats.mtime
                            });
                        }
                    } catch (error) {
                        // Skip items that can't be accessed
                        continue;
                    }
                }

                // Sort directories first, then files, both alphabetically
                directories.sort((a, b) => a.name.localeCompare(b.name));
                files.sort((a, b) => a.name.localeCompare(b.name));

                res.json({
                    currentPath: dirPath,
                    parentPath: path.dirname(dirPath),
                    canGoUp: dirPath !== path.parse(dirPath).root,
                    items: [...directories, ...files],
                    directories: directories.length,
                    files: files.length
                });

            } catch (error) {
                this.logger.error('Error browsing filesystem:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Create directory
        this.app.post('/api/filesystem/create-directory', async (req, res) => {
            try {
                const { parentPath, name } = req.body;
                
                if (!parentPath || !name) {
                    return res.status(400).json({ error: 'Parent path and directory name are required' });
                }

                // Validate directory name
                if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
                    return res.status(400).json({ error: 'Invalid directory name. Use only letters, numbers, dots, underscores, and hyphens.' });
                }

                const newDirPath = path.join(parentPath, name);
                
                // Security check - same as browse endpoint
                const homeDir = require('os').homedir();
                const allowedPaths = [
                    homeDir,
                    '/Users',
                    '/home',
                    process.cwd(),
                    path.join(process.cwd(), '..'),
                    path.join(homeDir, 'Downloads'),
                    path.join(homeDir, 'Documents'),
                    path.join(homeDir, 'Desktop'),
                    '/tmp',
                    '/var/tmp'
                ];
                
                const isAllowed = allowedPaths.some(allowedPath => 
                    path.resolve(newDirPath).startsWith(path.resolve(allowedPath))
                );
                
                if (!isAllowed) {
                    return res.status(403).json({ error: 'Access denied to create directory here' });
                }

                if (await fs.pathExists(newDirPath)) {
                    return res.status(409).json({ error: 'Directory already exists' });
                }

                await fs.ensureDir(newDirPath);

                res.json({
                    success: true,
                    path: newDirPath,
                    message: `Directory '${name}' created successfully`
                });

            } catch (error) {
                this.logger.error('Error creating directory:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Error handler
        this.app.use((err, req, res, next) => {
            this.logger.error('Web server error:', err);
            res.status(500).json({
                error: 'Internal server error',
                message: err.message
            });
        });

        // 404 handler
        this.app.use((req, res) => {
            res.status(404).json({
                error: 'Not found',
                path: req.path
            });
        });
    }

    generateCrawlId() {
        return `crawl-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    extractFilename(url) {
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;
            const filename = path.basename(pathname);
            
            // If no filename or it's just a directory, generate one from URL
            if (!filename || filename === '/' || !filename.includes('.')) {
                const cleanPath = pathname.replace(/[^a-zA-Z0-9.-]/g, '_');
                return cleanPath || 'document';
            }
            
            return filename;
        } catch (error) {
            return 'document';
        }
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    start() {
        return new Promise((resolve) => {
            this.server = this.app.listen(this.port, () => {
                this.logger.info(`🧽 Sponge Web Interface running on http://localhost:${this.port}`);
                this.logger.info(`📊 API endpoints available at http://localhost:${this.port}/api`);
                resolve(this.server);
            });
        });
    }

    stop() {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    this.logger.info('Web server stopped');
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }
}

// Start server if run directly
if (require.main === module) {
    const port = process.env.PORT || 3000;
    const server = new SpongeWebServer(port);
    
    server.start().catch(error => {
        console.error('Failed to start server:', error);
        process.exit(1);
    });

    // Graceful shutdown
    process.on('SIGTERM', async () => {
        console.log('SIGTERM received, shutting down gracefully');
        await server.stop();
        process.exit(0);
    });

    process.on('SIGINT', async () => {
        console.log('SIGINT received, shutting down gracefully');
        await server.stop();
        process.exit(0);
    });
}

module.exports = { SpongeWebServer };