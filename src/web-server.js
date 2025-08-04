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
        this.crawlRegistryPath = path.join(__dirname, '../crawl-registry.json');
        
        this.setupMiddleware();
        this.setupRoutes();
        this.setupCleanup();
        
        // Load crawl registry asynchronously but don't block constructor
        this.loadCrawlRegistry().catch(error => {
            this.logger.error('Failed to load crawl registry during startup:', error);
        });
    }

    setupMiddleware() {
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));
        
        // Add request logging for debugging
        this.app.use((req, res, next) => {
            this.logger.debug(`${req.method} ${req.path}`);
            next();
        });
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
                    timeout: Math.min(config?.timeout || 5000, 15000), // Cap at 15 seconds
                    userAgent: config?.userAgent || 'Sponge-Crawler/1.0.0'
                };

                // Add timeout wrapper to prevent hanging
                const estimationPromise = PageEstimator.quickEstimate(url, estimatorConfig).catch(error => {
                    // Log the error but don't crash the server
                    this.logger.error(`PageEstimator failed for ${url}:`, error);
                    throw error;
                });
                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('Page estimation timeout after 30 seconds')), 30000);
                });

                const estimation = await Promise.race([estimationPromise, timeoutPromise]);
                
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
                        originalMaxPages: req.body.config?.maxPages || 100,
                        autoAdjusted: suggestedMaxPages !== (req.body.config?.maxPages || 100)
                    }
                });

            } catch (error) {
                this.logger.error('Failed to estimate pages:', error);
                
                // Return graceful fallback instead of server error
                const fallbackEstimation = {
                    estimatedTotal: 100, // Reasonable default
                    discoveredUrls: 0,
                    paginationDetected: false,
                    sitemapFound: false,
                    patterns: [],
                    sampleUrls: [],
                    confidence: 'low',
                    suggestedMaxPages: 100,
                    originalMaxPages: req.body.config?.maxPages || 100,
                    autoAdjusted: false,
                    warning: 'Page estimation failed - using default values',
                    errorMessage: error.message.includes('timeout') ? 'Estimation timed out' : 'Estimation failed'
                };
                
                res.json({
                    success: true, // Don't fail the request
                    url: req.body.url,
                    estimation: fallbackEstimation
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
                    const documentTypes = config.allowedFileTypes.filter(ft => !ft.startsWith('page-'));
                    
                    if (pageTypes.length > 0) {
                        // Enable page content saving with the first page type found
                        const format = pageTypes[0].replace('page-', '');
                        processedConfig.savePageContent = true;
                        processedConfig.pageContentFormat = format;
                    }
                    
                    // Always set allowedFileTypes to only the non-page types selected
                    // This ensures only selected document types are downloaded
                    processedConfig.allowedFileTypes = documentTypes;
                }
                
                const crawlConfig = await configManager.loadConfig({
                    startUrl: url,
                    flatFileStructure: true, // Use flat structure for web interface downloads
                    createMirrorStructure: false, // Disable mirror structure when using flat structure
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
                    .then(async () => {
                        const crawl = this.activeCrawls.get(crawlId);
                        if (crawl) {
                            crawl.status = 'completed';
                            crawl.endTime = new Date();
                            // Store final stats for later retrieval
                            if (crawl.crawler) {
                                crawl.finalStats = crawl.crawler.getCurrentStats();
                            }
                            // Save to registry
                            await this.saveCrawlRegistry();
                        }
                    })
                    .catch(async (error) => {
                        const crawl = this.activeCrawls.get(crawlId);
                        if (crawl) {
                            crawl.status = 'failed';
                            crawl.error = error.message;
                            crawl.endTime = new Date();
                            // Store final stats even for failed crawls
                            if (crawl.crawler) {
                                crawl.finalStats = crawl.crawler.getCurrentStats();
                            }
                            // Save to registry
                            await this.saveCrawlRegistry();
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
        this.app.post('/api/crawl/:id/abort', async (req, res) => {
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
                
                // Save to registry
                await this.saveCrawlRegistry();
                
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
                url: crawl.config.startUrl,
                stats: crawl.finalStats || crawl.stats,
                restored: crawl.restored || false,
                detected: crawl.detected || false
            }));

            res.json({ crawls });
        });

        // Get list of found documents for a crawl
        this.app.get('/api/crawl/:id/documents', async (req, res) => {
            const crawlId = req.params.id;
            const crawl = this.activeCrawls.get(crawlId);
            
            if (!crawl) {
                return res.status(404).json({ error: 'Crawl not found' });
            }

            let documents = [];

            // Handle restored/detected crawls
            if (crawl.restored || crawl.detected) {
                try {
                    const outputDir = crawl.config.outputDir || './downloads';
                    
                    // Scan directory for documents
                    if (await fs.pathExists(outputDir)) {
                        const files = await fs.readdir(outputDir);
                        
                        for (let i = 0; i < files.length; i++) {
                            const file = files[i];
                            const filePath = path.join(outputDir, file);
                            const stats = await fs.stat(filePath);
                            
                            // Only include actual document files (not metadata files)
                            if (stats.isFile() && !file.startsWith('sponge-') && !file.startsWith('www_')) {
                                const extension = path.extname(file).toLowerCase().substring(1);
                                
                                documents.push({
                                    index: i,
                                    url: `file:///${filePath}`, // Local file URL
                                    filename: file,
                                    extension,
                                    domain: 'local',
                                    sourceUrl: `Downloaded from ${crawl.config.startUrl}`,
                                    depth: 0,
                                    contentType: this.getContentType(extension),
                                    size: stats.size,
                                    sizeFormatted: this.formatBytes(stats.size),
                                    downloaded: true,
                                    downloadPath: filePath,
                                    status: 'available'
                                });
                            }
                        }
                    }
                } catch (error) {
                    this.logger.error('Error scanning documents directory:', error);
                }
            } else {
                // Get documents from active crawler
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
                            downloaded: true, // Mark as available for on-demand download
                            downloadPath: metadata.filePath || null,
                            status: 'available' // Explicitly set status
                        };
                    });
                }
            }

            res.json({
                crawlId,
                status: crawl.status,
                totalDocuments: documents.length,
                documents,
                restored: crawl.restored || false
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

                // Handle restored/detected crawls
                if (crawl.restored || crawl.detected) {
                    const outputDir = crawl.config.outputDir || './downloads';
                    
                    // Get file list from directory
                    if (await fs.pathExists(outputDir)) {
                        const files = await fs.readdir(outputDir);
                        const documentFiles = [];
                        
                        for (const file of files) {
                            const filePath = path.join(outputDir, file);
                            const stats = await fs.stat(filePath);
                            
                            // Only include actual document files (not metadata files)
                            if (stats.isFile() && !file.startsWith('sponge-') && !file.startsWith('www_')) {
                                documentFiles.push({ filename: file, path: filePath });
                            }
                        }
                        
                        if (fileIndex < 0 || fileIndex >= documentFiles.length) {
                            return res.status(404).json({ error: 'Document not found' });
                        }
                        
                        const document = documentFiles[fileIndex];
                        res.download(document.path, document.filename);
                        return;
                    }
                } else {
                    // Handle active crawls
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

        // Manual cleanup endpoint
        this.app.post('/api/crawl/:id/cleanup', async (req, res) => {
            try {
                const crawlId = req.params.id;
                const crawl = this.activeCrawls.get(crawlId);
                
                if (!crawl) {
                    return res.status(404).json({ error: 'Crawl not found' });
                }

                if (crawl.status === 'running') {
                    return res.status(400).json({ error: 'Cannot cleanup running crawl' });
                }

                if (crawl.cleanedUp) {
                    return res.status(200).json({ 
                        success: true, 
                        message: 'Crawl already cleaned up',
                        cleanupTime: crawl.cleanupTime
                    });
                }

                await this.cleanupCrawlDirectory(crawlId, crawl.config.outputDir);

                res.json({
                    success: true,
                    message: 'Crawl directory cleaned up successfully',
                    crawlId
                });

            } catch (error) {
                this.logger.error('Error during manual cleanup:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Download all documents as ZIP
        this.app.get('/api/crawl/:id/download-all-zip', async (req, res) => {
            try {
                const crawlId = req.params.id;
                const crawl = this.activeCrawls.get(crawlId);
                
                if (!crawl) {
                    return res.status(404).json({ error: 'Crawl not found' });
                }

                // Create a ZIP file containing all found documents
                const archiver = require('archiver');
                const archive = archiver('zip', { zlib: { level: 9 } });
                
                res.attachment(`sponge-documents-${crawlId}.zip`);
                archive.pipe(res);

                // Handle restored/detected crawls
                if (crawl.restored || crawl.detected) {
                    const outputDir = crawl.config.outputDir || './downloads';
                    
                    if (await fs.pathExists(outputDir)) {
                        const files = await fs.readdir(outputDir);
                        let documentCount = 0;
                        
                        for (const file of files) {
                            const filePath = path.join(outputDir, file);
                            const stats = await fs.stat(filePath);
                            
                            // Only include actual document files (not metadata files)
                            if (stats.isFile() && !file.startsWith('sponge-') && !file.startsWith('www_')) {
                                try {
                                    archive.file(filePath, { name: file });
                                    documentCount++;
                                } catch (error) {
                                    this.logger.error(`Error adding ${file} to ZIP:`, error);
                                }
                            }
                        }
                        
                        if (documentCount === 0) {
                            return res.status(404).json({ error: 'No documents to download' });
                        }
                        
                        // Add metadata file
                        const metadata = {
                            crawlId,
                            crawlUrl: crawl.config.startUrl,
                            crawlTime: crawl.startTime,
                            documentsCount: documentCount,
                            restored: true
                        };
                        
                        archive.append(JSON.stringify(metadata, null, 2), { name: 'crawl-metadata.json' });
                    }
                } else {
                    // Handle active crawls
                    if (!crawl.crawler || !crawl.crawler.foundDocuments) {
                        return res.status(404).json({ error: 'No documents found' });
                    }

                    const documents = Array.from(crawl.crawler.foundDocuments.entries());
                    if (documents.length === 0) {
                        return res.status(404).json({ error: 'No documents to download' });
                    }

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
                                const axios = require('axios');
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
                    
                    // Clean up directory after successful download (only for new crawls)
                    archive.on('end', () => {
                        this.cleanupCrawlDirectory(crawlId, crawl.config.outputDir);
                    });
                }
                
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
                
                // Check for page content files - they could be in a pages subdirectory or directly in outputDir
                let pageFiles = [];
                let sourceDir = outputDir;
                
                // First try pages subdirectory (legacy structure)
                const pagesDir = path.join(outputDir, 'pages');
                if (await fs.pathExists(pagesDir)) {
                    sourceDir = pagesDir;
                    const files = await fs.readdir(pagesDir, { recursive: true });
                    for (const file of files) {
                        const filePath = path.join(pagesDir, file);
                        const stat = await fs.stat(filePath);
                        if (stat.isFile() && (file.endsWith('.md') || file.endsWith('.txt') || file.endsWith('.html'))) {
                            pageFiles.push(file);
                        }
                    }
                } else {
                    // Check for page content files directly in output directory (flat structure)
                    const files = await fs.readdir(outputDir);
                    for (const file of files) {
                        const filePath = path.join(outputDir, file);
                        const stat = await fs.stat(filePath);
                        if (stat.isFile() && (file.endsWith('.md') || file.endsWith('.txt') || file.endsWith('.html'))) {
                            pageFiles.push(file);
                        }
                    }
                }
                
                if (pageFiles.length === 0) {
                    return res.status(404).json({ error: 'No page content files found' });
                }

                // Create a ZIP file containing all page content files
                const archiver = require('archiver');
                const archive = archiver('zip', { zlib: { level: 9 } });
                
                res.attachment(`sponge-pages-${crawlId}.zip`);
                archive.pipe(res);
                
                // Add page content files to the archive
                for (const file of pageFiles) {
                    const filePath = path.join(sourceDir, file);
                    archive.file(filePath, { name: file });
                }
                
                // Clean up directory after successful download
                archive.on('end', () => {
                    this.cleanupCrawlDirectory(crawlId, crawl.config.outputDir);
                });
                
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
                    
                    // Clean up directory after successful download
                    archive.on('end', () => {
                        this.cleanupCrawlDirectory(crawlId, crawl.config.outputDir);
                    });
                    
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

        // Serve static files AFTER all API routes
        this.app.use(express.static(path.join(__dirname, '../'), {
            index: false, // Don't serve index.html automatically
            maxAge: '1h'  // Cache static files for 1 hour
        }));
        
        // 404 handler - distinguishes between API and web requests
        this.app.use((req, res) => {
            if (req.path.startsWith('/api/')) {
                res.status(404).json({
                    error: 'API endpoint not found',
                    path: req.path
                });
            } else {
                // For non-API requests, serve the index.html (SPA fallback)
                res.sendFile(path.join(__dirname, '../index.html'));
            }
        });
    }

    setupCleanup() {
        // Clean up old crawls every 30 minutes
        setInterval(() => {
            const now = Date.now();
            const maxAge = 2 * 60 * 60 * 1000; // 2 hours
            
            for (const [crawlId, crawl] of this.activeCrawls.entries()) {
                const age = now - crawl.startTime.getTime();
                if (age > maxAge && (crawl.status === 'completed' || crawl.status === 'failed' || crawl.status === 'aborted')) {
                    this.logger.debug(`Cleaning up old crawl: ${crawlId}`);
                    this.activeCrawls.delete(crawlId);
                }
            }
        }, 30 * 60 * 1000); // Every 30 minutes
    }

    /**
     * Load crawl registry from disk and restore active crawls
     */
    async loadCrawlRegistry() {
        try {
            if (await fs.pathExists(this.crawlRegistryPath)) {
                const registry = await fs.readJson(this.crawlRegistryPath);
                this.logger.info(`📁 Loading ${Object.keys(registry.crawls || {}).length} crawls from registry`);
                
                for (const [crawlId, crawlData] of Object.entries(registry.crawls || {})) {
                    // Restore completed crawls to activeCrawls for access
                    this.activeCrawls.set(crawlId, {
                        ...crawlData,
                        restored: true // Mark as restored from registry
                    });
                }
                
                this.logger.info(`✅ Restored ${this.activeCrawls.size} crawls from registry`);
            } else {
                // First time - detect existing crawls in downloads directory
                await this.detectExistingCrawls();
            }
        } catch (error) {
            this.logger.error('Failed to load crawl registry:', error);
        }
    }

    /**
     * Save crawl registry to disk
     */
    async saveCrawlRegistry() {
        try {
            const registry = {
                version: '1.0.0',
                lastUpdated: new Date().toISOString(),
                crawls: {}
            };

            // Save all crawls to registry
            for (const [crawlId, crawlData] of this.activeCrawls.entries()) {
                registry.crawls[crawlId] = {
                    id: crawlId,
                    status: crawlData.status,
                    startTime: crawlData.startTime,
                    endTime: crawlData.endTime,
                    config: crawlData.config,
                    stats: crawlData.finalStats || crawlData.stats,
                    restored: crawlData.restored || false
                };
            }

            await fs.writeJson(this.crawlRegistryPath, registry, { spaces: 2 });
            this.logger.debug(`💾 Saved ${Object.keys(registry.crawls).length} crawls to registry`);
        } catch (error) {
            this.logger.error('Failed to save crawl registry:', error);
        }
    }

    /**
     * Detect existing crawls from downloads directory
     */
    async detectExistingCrawls() {
        try {
            this.logger.info('🔍 Detecting existing crawls in downloads directory...');
            
            const downloadsDir = './downloads';
            if (!await fs.pathExists(downloadsDir)) {
                return;
            }

            // Look for sponge-metadata.json and sponge-summary.json files
            const metadataFile = path.join(downloadsDir, 'sponge-metadata.json');
            const summaryFile = path.join(downloadsDir, 'sponge-summary.json');
            
            if (await fs.pathExists(metadataFile) && await fs.pathExists(summaryFile)) {
                const metadata = await fs.readJson(metadataFile);
                const summary = await fs.readJson(summaryFile);
                
                const crawlId = metadata.metadata?.crawlId || summary.crawlId || `detected-${Date.now()}`;
                
                // Create crawl entry from existing data
                const crawlData = {
                    id: crawlId,
                    status: 'completed',
                    startTime: new Date(metadata.metadata?.crawlTime || summary.completedAt),
                    endTime: new Date(summary.completedAt),
                    config: {
                        startUrl: metadata.metadata?.startUrl || summary.startUrl,
                        outputDir: downloadsDir,
                        ...metadata.metadata?.config,
                        ...summary.configuration
                    },
                    stats: {
                        pagesVisited: summary.statistics?.pagesVisited || 0,
                        documentsFound: summary.statistics?.documentsFound || 0,
                        documentsDownloaded: summary.statistics?.documentsDownloaded || 0,
                        errors: summary.statistics?.errors || 0,
                        totalErrors: summary.statistics?.errors || 0,
                    },
                    finalStats: {
                        pagesVisited: summary.statistics?.pagesVisited || 0,
                        documentsFound: summary.statistics?.documentsFound || 0,
                        documentsDownloaded: summary.statistics?.documentsDownloaded || 0,
                        errors: summary.statistics?.errors || 0,
                        totalErrors: summary.statistics?.errors || 0,
                    },
                    restored: true,
                    detected: true
                };

                this.activeCrawls.set(crawlId, crawlData);
                this.logger.info(`🎯 Detected existing crawl: ${crawlId} (${crawlData.stats.documentsFound} documents)`);
                
                // Save to registry
                await this.saveCrawlRegistry();
            }
        } catch (error) {
            this.logger.error('Failed to detect existing crawls:', error);
        }
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

    getContentType(extension) {
        const contentTypes = {
            'pdf': 'application/pdf',
            'doc': 'application/msword',
            'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'xls': 'application/vnd.ms-excel',
            'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'txt': 'text/plain',
            'md': 'text/markdown'
        };
        return contentTypes[extension] || 'application/octet-stream';
    }

    /**
     * Clean up crawl output directory after download
     */
    async cleanupCrawlDirectory(crawlId, outputDir) {
        try {
            this.logger.info(`🧹 Cleaning up crawl directory: ${outputDir}`);
            
            // Remove all files and subdirectories in the output directory
            await fs.emptyDir(outputDir);
            
            // Remove the output directory itself if it's not the default downloads folder
            if (outputDir !== './downloads' && !outputDir.endsWith('/downloads')) {
                await fs.remove(outputDir);
                this.logger.info(`🗑️ Removed output directory: ${outputDir}`);
            }
            
            // Mark crawl for cleanup from memory
            const crawl = this.activeCrawls.get(crawlId);
            if (crawl) {
                crawl.cleanedUp = true;
                crawl.cleanupTime = new Date();
            }
            
            this.logger.info(`✅ Cleanup completed for crawl: ${crawlId}`);
            
        } catch (error) {
            this.logger.error(`❌ Failed to cleanup crawl directory ${outputDir}:`, error);
        }
    }

    start() {
        return new Promise((resolve, reject) => {
            this.server = this.app.listen(this.port, '127.0.0.1', () => {
                this.logger.info(`🧽 Sponge Web Interface running on http://127.0.0.1:${this.port}`);
                this.logger.info(`📊 API endpoints available at http://127.0.0.1:${this.port}/api`);
                resolve(this.server);
            });
            
            // Handle server startup errors
            this.server.on('error', (error) => {
                if (error.code === 'EADDRINUSE') {
                    this.logger.error(`Port ${this.port} is already in use`);
                } else if (error.code === 'EACCES') {
                    this.logger.error(`Permission denied to bind to port ${this.port}`);
                } else {
                    this.logger.error('Server startup error:', error);
                }
                reject(error);
            });
            
            // Handle uncaught server errors
            this.server.on('clientError', (err, socket) => {
                this.logger.error('Client error:', err);
                socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
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

    // Handle uncaught exceptions and unhandled rejections
    process.on('uncaughtException', (error) => {
        console.error('Uncaught Exception:', error);
        console.error('Stack trace:', error.stack);
        // Don't exit immediately - try to continue running
    });

    process.on('unhandledRejection', (reason, promise) => {
        console.error('Unhandled Rejection at:', promise, 'reason:', reason);
        if (reason && reason.stack) {
            console.error('Stack trace:', reason.stack);
        }
        // Don't exit - log and continue
    });
}

module.exports = { SpongeWebServer };