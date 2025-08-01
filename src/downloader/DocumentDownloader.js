const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const { URL } = require('url');
const { pipeline } = require('stream');
const { promisify } = require('util');

const { Logger } = require('../utils/Logger');
const { FilterManager } = require('../utils/FilterManager');

const streamPipeline = promisify(pipeline);

/**
 * Document downloader with progress tracking and error handling
 */
class DocumentDownloader {
    constructor(config) {
        this.config = config;
        this.logger = new Logger({ level: config.logLevel });
        this.filterManager = new FilterManager(config);
        
        // Download statistics
        this.stats = {
            attempted: 0,
            successful: 0,
            failed: 0,
            totalBytes: 0,
            skipped: 0
        };
        
        // Create axios instance for downloads
        this.httpClient = axios.create({
            timeout: config.timeout || 30000,
            headers: {
                'User-Agent': config.userAgent
            },
            responseType: 'stream'
        });
    }

    /**
     * Download a document from URL
     */
    async download(url, metadata = {}) {
        this.stats.attempted++;
        
        try {
            this.logger.debug(`Downloading: ${url}`);
            
            // Pre-download checks
            if (!await this.shouldDownload(url, metadata)) {
                this.stats.skipped++;
                return { success: false, skipped: true, reason: 'Filtered out' };
            }
            
            // Get file info
            const fileInfo = await this.getFileInfo(url);
            
            // Size check
            if (!this.filterManager.isFileSizeAllowed(fileInfo.size)) {
                this.stats.skipped++;
                this.logger.debug(`Skipping ${url} - file size ${fileInfo.size} outside limits`);
                return { success: false, skipped: true, reason: 'File size out of range' };
            }
            
            // Determine output path
            const outputPath = this.getOutputPath(url, fileInfo, metadata);
            
            // Check if file already exists
            if (await fs.pathExists(outputPath) && !this.config.overwriteExisting) {
                this.stats.skipped++;
                this.logger.debug(`Skipping ${url} - file already exists: ${outputPath}`);
                return { success: false, skipped: true, reason: 'File already exists' };
            }
            
            // Ensure output directory exists
            await fs.ensureDir(path.dirname(outputPath));
            
            // Download file
            const result = await this.downloadFile(url, outputPath, fileInfo);
            
            if (result.success) {
                this.stats.successful++;
                this.stats.totalBytes += result.size;
                this.logger.info(`Downloaded: ${url} -> ${outputPath} (${result.size} bytes)`);
            } else {
                this.stats.failed++;
                this.logger.error(`Failed to download ${url}: ${result.error}`);
            }
            
            return result;
            
        } catch (error) {
            this.stats.failed++;
            this.logger.error(`Download error for ${url}:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get file information without downloading
     */
    async getFileInfo(url) {
        try {
            const response = await axios.head(url, {
                timeout: 10000,
                headers: { 'User-Agent': this.config.userAgent }
            });
            
            return {
                size: parseInt(response.headers['content-length']) || null,
                contentType: response.headers['content-type'] || null,
                lastModified: response.headers['last-modified'] || null,
                etag: response.headers['etag'] || null
            };
        } catch (error) {
            // If HEAD request fails, try to get info from URL
            return {
                size: null,
                contentType: null,
                lastModified: null,
                etag: null
            };
        }
    }

    /**
     * Perform actual file download
     */
    async downloadFile(url, outputPath, fileInfo) {
        try {
            const response = await this.httpClient.get(url);
            
            if (response.status !== 200) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            // Create write stream
            const writeStream = fs.createWriteStream(outputPath);
            
            // Track download progress
            let downloadedBytes = 0;
            const totalBytes = fileInfo.size;
            
            response.data.on('data', (chunk) => {
                downloadedBytes += chunk.length;
                
                if (totalBytes && this.config.logProgress) {
                    const progress = Math.round((downloadedBytes / totalBytes) * 100);
                    if (progress % 10 === 0) { // Log every 10%
                        this.logger.debug(`Download progress for ${url}: ${progress}%`);
                    }
                }
            });
            
            // Download file using stream pipeline
            await streamPipeline(response.data, writeStream);
            
            // Verify file was written
            const stats = await fs.stat(outputPath);
            if (stats.size === 0) {
                await fs.remove(outputPath);
                throw new Error('Downloaded file is empty');
            }
            
            return {
                success: true,
                size: stats.size,
                path: outputPath
            };
            
        } catch (error) {
            // Clean up partial file on error
            try {
                if (await fs.pathExists(outputPath)) {
                    await fs.remove(outputPath);
                }
            } catch (cleanupError) {
                this.logger.warn(`Failed to clean up partial file ${outputPath}:`, cleanupError);
            }
            
            throw error;
        }
    }

    /**
     * Determine output path for downloaded file
     */
    getOutputPath(url, fileInfo, metadata) {
        const urlObj = new URL(url);
        const baseOutputDir = this.config.outputDir;
        
        // Generate filename
        const filename = this.filterManager.sanitizeFilename(url, fileInfo.contentType);
        
        if (this.config.createMirrorStructure) {
            // Create directory structure mirroring the website
            const hostname = urlObj.hostname;
            const pathname = urlObj.pathname;
            const dirs = pathname.split('/').filter(Boolean).slice(0, -1); // Remove filename
            
            const outputDir = path.join(baseOutputDir, hostname, ...dirs);
            return path.join(outputDir, filename);
        } else {
            // Flat structure - group by file type
            const extension = this.filterManager.getFileExtension(url, fileInfo.contentType);
            const typeDir = path.join(baseOutputDir, extension);
            
            // Add hostname to filename to avoid conflicts
            const hostnamePrefix = urlObj.hostname.replace(/[^a-zA-Z0-9]/g, '_');
            const prefixedFilename = `${hostnamePrefix}_${filename}`;
            
            return path.join(typeDir, prefixedFilename);
        }
    }

    /**
     * Check if file should be downloaded based on filters
     */
    async shouldDownload(url, metadata) {
        // Check URL patterns
        if (!this.filterManager.isDocumentUrl(url)) {
            return false;
        }
        
        // Check domain restrictions
        try {
            const urlObj = new URL(url);
            if (!this.filterManager.isDomainAllowed(urlObj.hostname)) {
                return false;
            }
        } catch (error) {
            return false;
        }
        
        // Check file type based on metadata
        if (metadata.contentType && !this.filterManager.isDocumentType(url, metadata.contentType)) {
            return false;
        }
        
        return true;
    }

    /**
     * Download multiple files with concurrency control
     */
    async downloadBatch(urls, metadata = new Map()) {
        const results = [];
        const limit = this.config.downloadConcurrency || 3;
        
        for (let i = 0; i < urls.length; i += limit) {
            const batch = urls.slice(i, i + limit);
            const batchPromises = batch.map(url => {
                const urlMetadata = metadata.get(url) || {};
                return this.download(url, urlMetadata);
            });
            
            const batchResults = await Promise.allSettled(batchPromises);
            results.push(...batchResults.map(result => 
                result.status === 'fulfilled' ? result.value : { success: false, error: result.reason }
            ));
            
            // Brief pause between batches to be respectful
            if (i + limit < urls.length) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        return results;
    }

    /**
     * Save HTML page content as text
     */
    async savePageContent(url, htmlContent, metadata = {}) {
        if (!this.config.savePageContent) {
            return { success: false, skipped: true, reason: 'Page content saving disabled' };
        }

        try {
            const cheerio = require('cheerio');
            const $ = cheerio.load(htmlContent);
            
            // Remove script and style elements
            $('script, style, noscript').remove();
            
            let content;
            const format = this.config.pageContentFormat || 'text';
            
            switch (format) {
                case 'html':
                    // Clean HTML but keep structure
                    content = $.html();
                    break;
                case 'markdown':
                    // Basic HTML to Markdown conversion
                    content = this.htmlToMarkdown($);
                    break;
                case 'text':
                default:
                    // Extract plain text
                    content = $('body').text().replace(/\s+/g, ' ').trim();
                    if (!content) {
                        content = $.text().replace(/\s+/g, ' ').trim();
                    }
                    break;
            }
            
            if (!content || content.length < 50) {
                return { success: false, skipped: true, reason: 'No meaningful content found' };
            }
            
            // Determine file extension based on format
            const ext = format === 'html' ? 'html' : (format === 'markdown' ? 'md' : 'txt');
            
            // Generate filename
            const urlObj = new URL(url);
            const pageName = urlObj.pathname === '/' ? 'index' : 
                            urlObj.pathname.split('/').filter(p => p).join('_') || 'page';
            const filename = `${pageName.replace(/[^a-zA-Z0-9._-]/g, '_')}.${ext}`;
            
            // Determine output path
            const outputPath = this.getPageContentPath(url, filename, metadata);
            
            // Ensure output directory exists
            await fs.ensureDir(path.dirname(outputPath));
            
            // Save content
            await fs.writeFile(outputPath, content, 'utf8');
            
            this.logger.debug(`Saved page content: ${url} -> ${outputPath} (${content.length} chars)`);
            
            return {
                success: true,
                filePath: outputPath,
                size: content.length,
                format: format
            };
            
        } catch (error) {
            this.logger.error(`Failed to save page content for ${url}:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Basic HTML to Markdown conversion
     */
    htmlToMarkdown($) {
        let markdown = '';
        
        // Handle headings
        $('h1, h2, h3, h4, h5, h6').each(function() {
            const level = parseInt(this.tagName.substring(1));
            const text = $(this).text().trim();
            if (text) {
                markdown += '#'.repeat(level) + ' ' + text + '\n\n';
            }
        });
        
        // Handle paragraphs
        $('p').each(function() {
            const text = $(this).text().trim();
            if (text) {
                markdown += text + '\n\n';
            }
        });
        
        // Handle links
        $('a[href]').each(function() {
            const text = $(this).text().trim();
            const href = $(this).attr('href');
            if (text && href) {
                markdown += `[${text}](${href})\n\n`;
            }
        });
        
        // Handle lists
        $('ul, ol').each(function() {
            const isOrdered = this.tagName === 'ol';
            $(this).find('li').each(function(index) {
                const text = $(this).text().trim();
                if (text) {
                    const bullet = isOrdered ? `${index + 1}. ` : '- ';
                    markdown += bullet + text + '\n';
                }
            });
            markdown += '\n';
        });
        
        // Fallback to plain text if no structured content found
        if (markdown.trim().length < 100) {
            markdown = $('body').text().replace(/\s+/g, ' ').trim();
        }
        
        return markdown.trim();
    }

    /**
     * Get output path for page content
     */
    getPageContentPath(url, filename, metadata) {
        const urlObj = new URL(url);
        
        if (this.config.createMirrorStructure) {
            // Create directory structure based on URL
            const domain = urlObj.hostname;
            const pathParts = urlObj.pathname.split('/').filter(p => p);
            
            // Remove filename from path parts if it exists
            if (pathParts.length > 0 && pathParts[pathParts.length - 1].includes('.')) {
                pathParts.pop();
            }
            
            const dirPath = path.join(this.config.outputDir, 'pages', domain, ...pathParts);
            return path.join(dirPath, filename);
        } else {
            // Flat structure in pages subdirectory
            const domain = urlObj.hostname.replace(/[^a-zA-Z0-9.-]/g, '_');
            const flatFilename = `${domain}_${filename}`;
            return path.join(this.config.outputDir, 'pages', flatFilename);
        }
    }

    /**
     * Get download statistics
     */
    getStats() {
        return {
            ...this.stats,
            successRate: this.stats.attempted > 0 ? 
                Math.round((this.stats.successful / this.stats.attempted) * 100) : 0,
            totalMB: Math.round(this.stats.totalBytes / (1024 * 1024) * 100) / 100
        };
    }

    /**
     * Reset download statistics
     */
    resetStats() {
        this.stats = {
            attempted: 0,
            successful: 0,
            failed: 0,
            totalBytes: 0,
            skipped: 0
        };
    }
}

module.exports = { DocumentDownloader };