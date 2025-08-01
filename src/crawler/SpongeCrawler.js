const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');
const pLimit = require('p-limit').default || require('p-limit');
const fs = require('fs-extra');
const path = require('path');

const { Logger } = require('../utils/Logger');
const { UrlQueue } = require('./UrlQueue');
const { RobotsChecker } = require('./RobotsChecker');
const { DocumentDownloader } = require('../downloader/DocumentDownloader');
const { AuthManager } = require('../auth/AuthManager');
const { FilterManager } = require('../utils/FilterManager');
const { ExportManager } = require('../export/ExportManager');

/**
 * Main crawler class that orchestrates the crawling process
 */
class SpongeCrawler {
    constructor(config) {
        this.config = config;
        this.logger = new Logger({ level: config.logLevel });
        
        // Initialize components
        this.urlQueue = new UrlQueue();
        this.robotsChecker = new RobotsChecker(config);
        this.downloader = new DocumentDownloader(config);
        this.authManager = new AuthManager(config);
        this.filterManager = new FilterManager(config);
        this.exportManager = new ExportManager(config);
        
        // Crawling state
        this.visitedUrls = new Set();
        this.foundDocuments = new Map();
        this.errors = [];
        this.currentUrl = null;
        this.stats = {
            pagesVisited: 0,
            documentsFound: 0,
            documentsDownloaded: 0,
            errors: 0,
            startTime: null,
            endTime: null,
            queueSize: 0,
            currentUrl: null,
            totalPagesDiscovered: 0,
            paginationDetected: false,
            estimatedTotalPages: 0,
            aborted: false
        };
        
        // Rate limiting
        this.concurrencyLimit = pLimit(config.concurrency);
        this.lastRequestTime = 0;
        
        // Setup axios instance with common configuration
        this.httpClient = axios.create({
            timeout: config.timeout,
            headers: {
                'User-Agent': config.userAgent,
                ...config.headers
            },
            maxRedirects: config.followRedirects ? 5 : 0,
            validateStatus: (status) => status < 500 // Don't throw on 4xx errors
        });
        
        // Setup authentication
        this.authManager.setupHttpClient(this.httpClient);
    }

    /**
     * Start the crawling process
     */
    async start() {
        try {
            this.logger.info('🧽 Starting Sponge Web Crawler', {
                startUrl: this.config.startUrl,
                maxDepth: this.config.maxDepth,
                outputDir: this.config.outputDir
            });

            this.stats.startTime = new Date();
            
            // Prepare output directory
            await this.prepareOutputDirectory();
            
            // Check robots.txt if enabled
            if (this.config.respectRobotsTxt) {
                await this.robotsChecker.loadRobotsTxt(this.config.startUrl);
            }
            
            // Add initial URL to queue
            this.urlQueue.enqueue(this.config.startUrl, 0);
            
            // Start crawling
            await this.crawl();
            
            // Export results
            await this.exportResults();
            
            this.stats.endTime = new Date();
            this.logFinalStats();
            
        } catch (error) {
            this.logger.error('Crawler failed:', error);
            throw error;
        }
    }

    /**
     * Main crawling loop
     */
    async crawl() {
        const startTime = Date.now();
        const maxCrawlTime = 30 * 60 * 1000; // 30 minutes max crawl time
        let noProgressCount = 0;
        let lastPageCount = 0;
        
        while (!this.urlQueue.isEmpty() && this.stats.pagesVisited < this.config.maxPages && !this.stats.aborted) {
            // Check for timeout
            if (Date.now() - startTime > maxCrawlTime) {
                this.logger.warn('⏰ Crawl timeout reached (30 minutes), stopping...');
                break;
            }
            
            // Check for no progress (stuck in loop)
            if (this.stats.pagesVisited === lastPageCount) {
                noProgressCount++;
                if (noProgressCount > 10) {
                    this.logger.warn('🔄 No progress detected, likely stuck in loop. Stopping crawl.');
                    break;
                }
            } else {
                noProgressCount = 0;
                lastPageCount = this.stats.pagesVisited;
            }
            // Update stats with current queue size
            this.stats.queueSize = this.urlQueue.size();
            this.logger.debug(`Queue size: ${this.stats.queueSize}, Pages visited: ${this.stats.pagesVisited}/${this.config.maxPages}`);
            
            const urlData = this.urlQueue.dequeue();
            if (!urlData) {
                this.logger.debug('No more URLs in queue');
                break;
            }
            
            const { url, depth } = urlData;
            this.currentUrl = url;
            this.stats.currentUrl = url;
            this.logger.debug(`Processing URL: ${url} (depth: ${depth})`);
            
            if (this.shouldSkipUrl(url, depth)) {
                this.logger.debug(`Skipping URL: ${url}`);
                continue;
            }
            
            // Process URL directly with concurrency limiting
            await this.concurrencyLimit(async () => {
                try {
                    await this.processUrl(url, depth);
                } catch (error) {
                    this.handleUrlError(url, error);
                }
            });
        }
        
        // Clear current processing state
        this.currentUrl = null;
        this.stats.currentUrl = null;
        this.stats.queueSize = 0;
        
        this.logger.debug(`Crawling completed. Total pages visited: ${this.stats.pagesVisited}`);
    }

    /**
     * Get current crawling statistics
     */
    getCurrentStats() {
        return {
            ...this.stats,
            documentsFound: this.foundDocuments.size,
            documentsDownloaded: this.stats.documentsDownloaded,
            totalErrors: this.errors.length
        };
    }

    /**
     * Process a single URL
     */
    async processUrl(url, depth) {
        // Rate limiting
        await this.enforceRateLimit();
        
        this.logger.logUrl('Crawling', url);
        this.visitedUrls.add(url);
        this.stats.pagesVisited++;
        
        try {
            // Make HTTP request
            const response = await this.httpClient.get(url);
            
            if (response.status >= 400) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const contentType = response.headers['content-type'] || '';
            
            // Handle different content types
            if (contentType.includes('text/html')) {
                await this.processHtmlPage(url, response.data, depth);
            } else if (this.filterManager.isDocumentType(url, contentType)) {
                await this.processDocument(url, response, contentType);
            }
            
        } catch (error) {
            this.handleUrlError(url, error);
        }
    }

    /**
     * Process HTML page to find links and documents
     */
    async processHtmlPage(url, html, depth) {
        const $ = cheerio.load(html);
        const baseUrl = new URL(url);
        
        // Save page content if enabled
        if (this.config.savePageContent) {
            try {
                const result = await this.downloader.savePageContent(url, html, { sourceUrl: url, depth });
                if (result.success) {
                    this.logger.debug(`Saved page content: ${url} -> ${result.filePath}`);
                } else if (!result.skipped) {
                    this.logger.warn(`Failed to save page content for ${url}: ${result.error || result.reason}`);
                }
            } catch (error) {
                this.logger.error(`Error saving page content for ${url}:`, error);
            }
        }
        
        // Find all links
        const links = [];
        $('a[href]').each((i, element) => {
            const href = $(element).attr('href');
            if (href) {
                try {
                    const absoluteUrl = new URL(href, baseUrl).toString();
                    links.push(absoluteUrl);
                } catch (error) {
                    // Invalid URL, skip
                }
            }
        });
        
        // Process found links
        this.logger.debug(`Found ${links.length} links on ${url}`);
        
        // Detect pagination on the first page
        if (depth === 0 && !this.stats.paginationDetected) {
            const paginationInfo = this.detectPagination(links, url);
            if (paginationInfo.detected) {
                this.stats.paginationDetected = true;
                this.stats.totalPagesDiscovered = paginationInfo.totalPages;
                this.logger.info(`🔍 Pagination detected: Found ${paginationInfo.totalPages} pagination pages`);
                
                // Add discovered pagination URLs to queue
                for (const pageUrl of paginationInfo.pageUrls) {
                    if (!this.visitedUrls.has(pageUrl)) {
                        this.urlQueue.enqueue(pageUrl, depth + 1);
                    }
                }
            }
        }

        // Estimate total content pages after processing some pagination pages
        if (this.stats.paginationDetected && this.stats.pagesVisited >= 5 && this.stats.estimatedTotalPages === 0) {
            this.estimateTotalPages(links);
        }
        
        for (const link of links) {
            const shouldFollow = this.filterManager.shouldFollowLink(link);
            const isVisited = this.visitedUrls.has(link);
            const isDocument = this.filterManager.isDocumentUrl(link);
            
            this.logger.debug(`Link: ${link} | ShouldFollow: ${shouldFollow} | Visited: ${isVisited} | IsDocument: ${isDocument} | Depth: ${depth}/${this.config.maxDepth}`);
            
            if (shouldFollow && !isVisited) {
                // Check if it's a document
                if (isDocument) {
                    this.foundDocuments.set(link, { sourceUrl: url, depth });
                    this.stats.documentsFound++;
                    this.logger.debug(`Added document: ${link}`);
                } else if (depth < this.config.maxDepth) {
                    // Add to crawl queue if within depth limit (skip if already added by pagination detection)
                    if (!this.stats.paginationDetected || !this.isPaginationUrl(link)) {
                        this.urlQueue.enqueue(link, depth + 1);
                        this.logger.debug(`Added to crawl queue: ${link} (depth ${depth + 1})`);
                    }
                }
            }
        }
        
        // Find embedded documents (images, PDFs in iframes, etc.)
        await this.findEmbeddedDocuments($, url, depth);
    }

    /**
     * Find embedded documents in HTML
     */
    async findEmbeddedDocuments($, url, depth) {
        const baseUrl = new URL(url);
        const selectors = [
            'img[src]',
            'iframe[src]',
            'embed[src]',
            'object[data]',
            'source[src]',
            'a[href$=".pdf"]',
            'a[href$=".doc"]',
            'a[href$=".docx"]',
            'a[href$=".xls"]',
            'a[href$=".xlsx"]'
        ];
        
        for (const selector of selectors) {
            $(selector).each((i, element) => {
                const src = $(element).attr('src') || $(element).attr('data') || $(element).attr('href');
                if (src) {
                    try {
                        const absoluteUrl = new URL(src, baseUrl).toString();
                        if (this.filterManager.isDocumentUrl(absoluteUrl) && !this.foundDocuments.has(absoluteUrl)) {
                            this.foundDocuments.set(absoluteUrl, { sourceUrl: url, depth });
                            this.stats.documentsFound++;
                        }
                    } catch (error) {
                        // Invalid URL, skip
                    }
                }
            });
        }
    }

    /**
     * Process document file
     */
    async processDocument(url, response, contentType) {
        this.foundDocuments.set(url, { 
            sourceUrl: url, 
            depth: 0,
            contentType,
            size: response.headers['content-length']
        });
        this.stats.documentsFound++;
    }

    /**
     * Check if URL should be skipped
     */
    shouldSkipUrl(url, depth) {
        if (this.visitedUrls.has(url)) {
            return true;
        }
        
        if (depth > this.config.maxDepth) {
            return true;
        }
        
        if (!this.filterManager.shouldCrawlUrl(url)) {
            return true;
        }
        
        if (this.config.respectRobotsTxt && !this.robotsChecker.isAllowed(url)) {
            this.logger.debug(`Skipping ${url} (blocked by robots.txt)`);
            return true;
        }
        
        return false;
    }

    /**
     * Enforce rate limiting between requests
     */
    async enforceRateLimit() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        
        let delay = this.config.delay;
        if (this.config.randomDelay) {
            delay = Math.random() * delay + (delay * 0.5);
        }
        
        if (timeSinceLastRequest < delay) {
            const waitTime = delay - timeSinceLastRequest;
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        
        this.lastRequestTime = Date.now();
    }

    /**
     * Handle URL processing errors
     */
    handleUrlError(url, error) {
        this.stats.errors++;
        this.errors.push({ url, error: error.message, timestamp: new Date() });
        this.logger.logUrlError(url, error);
    }

    /**
     * Prepare output directory
     */
    async prepareOutputDirectory() {
        try {
            await fs.ensureDir(this.config.outputDir);
            this.logger.info(`Output directory prepared: ${this.config.outputDir}`);
        } catch (error) {
            throw new Error(`Failed to create output directory: ${error.message}`);
        }
    }

    /**
     * Export crawling results
     */
    async exportResults() {
        this.logger.info('Exporting results...');
        
        // Download documents
        if (!this.config.dryRun) {
            await this.downloadDocuments();
        }
        
        // Export metadata
        if (this.config.exportMetadata) {
            await this.exportManager.exportMetadata(this.foundDocuments, this.stats, this.errors);
        }
    }

    /**
     * Stop/abort the crawling process
     */
    abort() {
        this.logger.info('🛑 Crawl aborted by user');
        this.stats.aborted = true;
    }

    /**
     * Download all found documents
     */
    async downloadDocuments() {
        const documents = Array.from(this.foundDocuments.entries());
        
        for (const [url, metadata] of documents) {
            try {
                const downloadResult = await this.downloader.download(url, metadata);
                
                if (downloadResult.success && !downloadResult.skipped) {
                    // Mark as successfully downloaded
                    this.foundDocuments.set(url, { 
                        ...metadata, 
                        downloaded: true,
                        downloadedAt: new Date().toISOString(),
                        filePath: downloadResult.path,
                        actualSize: downloadResult.size
                    });
                    this.stats.documentsDownloaded++;
                } else if (downloadResult.skipped) {
                    // Mark as skipped
                    this.foundDocuments.set(url, { 
                        ...metadata, 
                        downloaded: false, 
                        skipped: true,
                        skipReason: downloadResult.reason
                    });
                }
                
                if (this.config.logProgress) {
                    this.logger.logProgress(
                        this.stats.documentsDownloaded,
                        this.foundDocuments.size,
                        'documents downloaded'
                    );
                }
            } catch (error) {
                this.foundDocuments.set(url, { 
                    ...metadata, 
                    downloaded: false, 
                    error: error.message 
                });
                this.handleUrlError(url, error);
            }
        }
    }

    /**
     * Detect pagination patterns in found links
     */
    detectPagination(links, currentUrl) {
        const result = {
            detected: false,
            totalPages: 0,
            pageUrls: []
        };

        try {
            const currentUrlObj = new URL(currentUrl);
            const pageNumbers = new Set();
            const paginationUrls = [];

            // Look for pagination patterns in links
            for (const link of links) {
                try {
                    const linkUrl = new URL(link);
                    
                    // Check if it's the same base path (likely pagination)
                    if (linkUrl.hostname === currentUrlObj.hostname && 
                        linkUrl.pathname === currentUrlObj.pathname) {
                        
                        // Look for page parameter patterns
                        const pageParam = linkUrl.searchParams.get('page');
                        if (pageParam && /^\d+$/.test(pageParam)) {
                            const pageNum = parseInt(pageParam);
                            if (pageNum > 0 && pageNum <= 100) { // Reasonable page limit
                                pageNumbers.add(pageNum);
                                paginationUrls.push(link);
                            }
                        }
                    }
                } catch (error) {
                    // Skip invalid URLs
                }
            }

            // If we found multiple page numbers, it's likely pagination
            if (pageNumbers.size >= 2) {
                const maxPage = Math.max(...pageNumbers);
                const minPage = Math.min(...pageNumbers);
                
                // Generate missing page URLs if there's a clear pattern
                if (maxPage > minPage + 1) {
                    const baseUrl = new URL(currentUrl);
                    for (let i = minPage; i <= maxPage; i++) {
                        baseUrl.searchParams.set('page', i.toString());
                        const pageUrl = baseUrl.toString();
                        if (!paginationUrls.includes(pageUrl)) {
                            paginationUrls.push(pageUrl);
                        }
                    }
                }

                result.detected = true;
                result.totalPages = maxPage;
                result.pageUrls = paginationUrls;
            }

        } catch (error) {
            this.logger.debug('Error detecting pagination:', error);
        }

        return result;
    }

    /**
     * Check if a URL is a pagination URL
     */
    isPaginationUrl(url) {
        try {
            const urlObj = new URL(url);
            const pageParam = urlObj.searchParams.get('page');
            return pageParam && /^\d+$/.test(pageParam);
        } catch (error) {
            return false;
        }
    }

    /**
     * Estimate total content pages based on discovered links
     */
    estimateTotalPages(links) {
        try {
            // Count unique content page links (non-documents, non-pagination)
            const contentPages = new Set();
            
            for (const link of links) {
                if (this.filterManager.shouldFollowLink(link) && 
                    !this.filterManager.isDocumentUrl(link) && 
                    !this.isPaginationUrl(link)) {
                    contentPages.add(link);
                }
            }

            // Estimate based on discovered content pages plus queue
            const currentContentPages = contentPages.size;
            const queueSize = this.urlQueue.size();
            const estimatedTotal = Math.min(currentContentPages + queueSize + this.stats.pagesVisited, this.config.maxPages);
            
            if (estimatedTotal > this.stats.pagesVisited) {
                this.stats.estimatedTotalPages = estimatedTotal;
                this.logger.info(`📋 Estimated ${estimatedTotal} content pages to crawl`);
            }
        } catch (error) {
            this.logger.debug('Error estimating total pages:', error);
        }
    }

    /**
     * Abort the crawling process
     */
    abort() {
        this.stats.aborted = true;
        this.logger.info('⏹️ Crawl aborted by user');
    }

    /**
     * Log final crawling statistics
     */
    logFinalStats() {
        const duration = this.stats.endTime - this.stats.startTime;
        const durationSeconds = Math.round(duration / 1000);
        
        this.logger.info('🎉 Crawling completed!', {
            pagesVisited: this.stats.pagesVisited,
            documentsFound: this.foundDocuments.size,
            documentsDownloaded: this.stats.documentsDownloaded,
            errors: this.stats.errors,
            durationSeconds,
            outputDir: this.config.outputDir,
            totalPagesDiscovered: this.stats.totalPagesDiscovered
        });
    }
}

module.exports = { SpongeCrawler };