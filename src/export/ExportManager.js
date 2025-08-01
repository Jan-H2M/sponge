const fs = require('fs-extra');
const path = require('path');
const { URL } = require('url');

const { Logger } = require('../utils/Logger');

/**
 * Export manager for crawling results and metadata
 */
class ExportManager {
    constructor(config) {
        this.config = config;
        this.logger = new Logger({ level: config.logLevel });
    }

    /**
     * Export complete crawling metadata
     */
    async exportMetadata(foundDocuments, stats, errors) {
        try {
            const metadata = this.buildMetadata(foundDocuments, stats, errors);
            
            if (this.config.metadataFormat === 'csv') {
                await this.exportCSV(metadata);
            } else {
                await this.exportJSON(metadata);
            }
            
            // Also export summary file
            await this.exportSummary(stats, errors);
            
            this.logger.info('Metadata exported successfully');
            
        } catch (error) {
            this.logger.error('Failed to export metadata:', error);
            throw error;
        }
    }

    /**
     * Build comprehensive metadata object
     */
    buildMetadata(foundDocuments, stats, errors) {
        const documentsArray = Array.from(foundDocuments.entries()).map(([url, metadata]) => {
            const urlObj = new URL(url);
            
            return {
                url,
                domain: urlObj.hostname,
                path: urlObj.pathname,
                filename: this.extractFilename(url),
                extension: this.extractExtension(url),
                sourceUrl: metadata.sourceUrl || url,
                depth: metadata.depth || 0,
                contentType: metadata.contentType || null,
                size: metadata.size || null,
                sizeFormatted: metadata.size ? this.formatBytes(metadata.size) : null,
                discovered: new Date().toISOString(),
                status: metadata.downloaded ? 'downloaded' : 'pending'
            };
        });
        
        const errorArray = errors.map(error => ({
            url: error.url,
            error: error.error,
            timestamp: error.timestamp.toISOString()
        }));
        
        return {
            metadata: {
                crawlId: this.generateCrawlId(),
                startUrl: this.config.startUrl,
                crawlTime: new Date().toISOString(),
                config: this.sanitizeConfig(this.config)
            },
            statistics: {
                ...stats,
                duration: stats.endTime && stats.startTime ? 
                    stats.endTime - stats.startTime : null,
                durationFormatted: stats.endTime && stats.startTime ? 
                    this.formatDuration(stats.endTime - stats.startTime) : null
            },
            documents: documentsArray,
            errors: errorArray
        };
    }

    /**
     * Export metadata as JSON
     */
    async exportJSON(metadata) {
        const outputPath = path.join(this.config.outputDir, 'sponge-metadata.json');
        await fs.writeFile(outputPath, JSON.stringify(metadata, null, 2));
        
        this.logger.info(`JSON metadata exported: ${outputPath}`);
    }

    /**
     * Export metadata as CSV
     */
    async exportCSV(metadata) {
        // Export documents CSV
        const documentsCSV = this.arrayToCSV(metadata.documents);
        const documentsPath = path.join(this.config.outputDir, 'sponge-documents.csv');
        await fs.writeFile(documentsPath, documentsCSV);
        
        // Export errors CSV if any
        if (metadata.errors.length > 0) {
            const errorsCSV = this.arrayToCSV(metadata.errors);
            const errorsPath = path.join(this.config.outputDir, 'sponge-errors.csv');
            await fs.writeFile(errorsPath, errorsCSV);
        }
        
        this.logger.info(`CSV metadata exported: ${documentsPath}`);
    }

    /**
     * Export crawl summary
     */
    async exportSummary(stats, errors) {
        const summary = {
            crawlId: this.generateCrawlId(),
            startUrl: this.config.startUrl,
            completedAt: new Date().toISOString(),
            statistics: {
                pagesVisited: stats.pagesVisited,
                documentsFound: stats.documentsFound,
                documentsDownloaded: stats.documentsDownloaded,
                errors: stats.errors,
                successRate: stats.pagesVisited > 0 ? 
                    Math.round((stats.documentsDownloaded / stats.documentsFound) * 100) : 0,
                totalSize: stats.totalBytes ? this.formatBytes(stats.totalBytes) : '0 B',
                duration: stats.endTime && stats.startTime ? 
                    this.formatDuration(stats.endTime - stats.startTime) : 'Unknown'
            },
            configuration: {
                maxDepth: this.config.maxDepth,
                maxPages: this.config.maxPages,
                outputDir: this.config.outputDir,
                respectRobotsTxt: this.config.respectRobotsTxt,
                allowedFileTypes: this.config.allowedFileTypes,
                authEnabled: !!(this.config.auth && this.config.auth.type)
            },
            topDomains: this.getTopDomains(errors),
            commonErrors: this.getCommonErrors(errors)
        };
        
        const summaryPath = path.join(this.config.outputDir, 'sponge-summary.json');
        await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));
        
        this.logger.info(`Summary exported: ${summaryPath}`);
        
        // Also create human-readable report
        await this.exportReadableReport(summary);
    }

    /**
     * Export human-readable report
     */
    async exportReadableReport(summary) {
        const report = `
# Sponge Crawler Report

**Crawl ID:** ${summary.crawlId}
**Start URL:** ${summary.startUrl}
**Completed:** ${summary.completedAt}

## Statistics

- **Pages Visited:** ${summary.statistics.pagesVisited}
- **Documents Found:** ${summary.statistics.documentsFound}
- **Documents Downloaded:** ${summary.statistics.documentsDownloaded}
- **Success Rate:** ${summary.statistics.successRate}%
- **Total Size:** ${summary.statistics.totalSize}
- **Duration:** ${summary.statistics.duration}
- **Errors:** ${summary.statistics.errors}

## Configuration

- **Max Depth:** ${summary.configuration.maxDepth}
- **Max Pages:** ${summary.configuration.maxPages}
- **Output Directory:** ${summary.configuration.outputDir}
- **Robots.txt Respected:** ${summary.configuration.respectRobotsTxt ? 'Yes' : 'No'}
- **Authentication:** ${summary.configuration.authEnabled ? 'Enabled' : 'Disabled'}
- **Allowed File Types:** ${summary.configuration.allowedFileTypes.join(', ')}

${summary.topDomains.length > 0 ? `
## Top Domains
${summary.topDomains.map(domain => `- ${domain.domain}: ${domain.count} documents`).join('\n')}
` : ''}

${summary.commonErrors.length > 0 ? `
## Common Errors
${summary.commonErrors.map(error => `- ${error.error}: ${error.count} occurrences`).join('\n')}
` : ''}

---
Generated by Sponge Crawler v${require('../../package.json').version}
`;
        
        const reportPath = path.join(this.config.outputDir, 'sponge-report.md');
        await fs.writeFile(reportPath, report.trim());
        
        this.logger.info(`Human-readable report exported: ${reportPath}`);
    }

    /**
     * Convert array of objects to CSV string
     */
    arrayToCSV(array) {
        if (array.length === 0) return '';
        
        const headers = Object.keys(array[0]);
        const csvRows = [headers.join(',')];
        
        for (const row of array) {
            const values = headers.map(header => {
                const value = row[header];
                // Escape commas and quotes in CSV values
                if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
                    return `"${value.replace(/"/g, '""')}"`;
                }
                return value || '';
            });
            csvRows.push(values.join(','));
        }
        
        return csvRows.join('\n');
    }

    /**
     * Extract filename from URL
     */
    extractFilename(url) {
        try {
            const urlObj = new URL(url);
            const pathname = decodeURIComponent(urlObj.pathname);
            return pathname.split('/').pop() || 'index';
        } catch (error) {
            return 'unknown';
        }
    }

    /**
     * Extract file extension from URL
     */
    extractExtension(url) {
        try {
            const filename = this.extractFilename(url);
            const parts = filename.split('.');
            return parts.length > 1 ? parts.pop().toLowerCase() : '';
        } catch (error) {
            return '';
        }
    }

    /**
     * Format bytes to human readable format
     */
    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * Format duration to human readable format
     */
    formatDuration(milliseconds) {
        const seconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        
        if (hours > 0) {
            return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }

    /**
     * Generate unique crawl ID
     */
    generateCrawlId() {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substr(2, 9);
        return `sponge-${timestamp}-${random}`;
    }

    /**
     * Sanitize config for export (remove sensitive data)
     */
    sanitizeConfig(config) {
        const sanitized = { ...config };
        
        // Remove sensitive authentication data
        if (sanitized.auth) {
            sanitized.auth = {
                type: sanitized.auth.type,
                hasCredentials: !!(
                    sanitized.auth.username || 
                    sanitized.auth.token || 
                    sanitized.auth.cookies
                )
            };
        }
        
        return sanitized;
    }

    /**
     * Get top domains from crawled data
     */
    getTopDomains(errors) {
        const domainCounts = {};
        
        // This would normally be calculated from foundDocuments
        // For now, return empty array
        return [];
    }

    /**
     * Get common error types
     */
    getCommonErrors(errors) {
        const errorCounts = {};
        
        errors.forEach(error => {
            const errorType = error.error.split(':')[0]; // Get error type
            errorCounts[errorType] = (errorCounts[errorType] || 0) + 1;
        });
        
        return Object.entries(errorCounts)
            .map(([error, count]) => ({ error, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10); // Top 10 errors
    }
}

module.exports = { ExportManager };