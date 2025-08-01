const { URL } = require('url');
const mime = require('mime-types');

/**
 * URL and content filtering manager
 */
class FilterManager {
    constructor(config) {
        this.config = config;
        
        // Compile document file extensions
        this.documentExtensions = new Set(
            config.allowedFileTypes.map(type => type.toLowerCase())
        );
        
        // URL patterns to ignore
        this.ignorePatterns = [
            /\.(js|css|woff|woff2|ttf|eot|ico)$/i,
            /javascript:/i,
            /mailto:/i,
            /tel:/i,
            /^#/,
            /#[^\/]*$/, // Ignore anchor links (e.g., example.com/page#section)
            /\?.*=.*javascript/i
        ];
        
        // Common document MIME types
        this.documentMimeTypes = new Set([
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'text/plain',
            'text/csv',
            'application/json',
            'application/xml',
            'text/xml',
            'image/jpeg',
            'image/jpg',
            'image/png',
            'image/gif',
            'image/webp',
            'image/svg+xml'
        ]);

        // HTML content types (for page content saving)
        this.htmlMimeTypes = new Set([
            'text/html',
            'application/xhtml+xml'
        ]);
    }

    /**
     * Check if URL should be crawled
     */
    shouldCrawlUrl(url) {
        try {
            const urlObj = new URL(url);
            
            // Check protocol
            if (!['http:', 'https:'].includes(urlObj.protocol)) {
                return false;
            }
            
            // Check domain restrictions
            if (!this.isDomainAllowed(urlObj.hostname)) {
                return false;
            }
            
            // Check ignore patterns
            if (this.matchesIgnorePatterns(url)) {
                return false;
            }
            
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Check if we should follow a link (for crawling deeper)
     */
    shouldFollowLink(url) {
        if (!this.shouldCrawlUrl(url)) {
            return false;
        }
        
        // Don't follow document links as crawl targets (but we'll download them)
        if (this.isDocumentUrl(url)) {
            return false;
        }
        
        return true;
    }

    /**
     * Check if URL points to a document
     */
    isDocumentUrl(url) {
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname.toLowerCase();
            
            // Check file extension
            const extension = pathname.split('.').pop();
            if (extension && this.documentExtensions.has(extension)) {
                return true;
            }
            
            // Check for common document patterns in URL
            const documentPatterns = [
                /\/(download|file|document|attachment)\//i,
                /[\?&](file|download|attachment)=/i,
                /\.pdf[\?#]?/i,
                /\.docx?[\?#]?/i,
                /\.xlsx?[\?#]?/i,
                /\.pptx?[\?#]?/i
            ];
            
            return documentPatterns.some(pattern => pattern.test(url));
        } catch (error) {
            return false;
        }
    }

    /**
     * Check if content type indicates a document
     */
    isDocumentType(url, contentType) {
        if (!contentType) {
            return this.isDocumentUrl(url);
        }
        
        const mimeType = contentType.split(';')[0].trim().toLowerCase();
        return this.documentMimeTypes.has(mimeType);
    }

    /**
     * Check if content is HTML page that should have content saved
     */
    isHtmlPageContent(url, contentType) {
        if (!this.config.savePageContent) {
            return false;
        }
        
        if (!contentType) {
            // Assume HTML if no content type and URL doesn't have file extension
            const urlObj = new URL(url);
            const pathname = urlObj.pathname.toLowerCase();
            return !pathname.includes('.') || pathname.endsWith('/') || pathname.endsWith('.html') || pathname.endsWith('.htm');
        }
        
        const mimeType = contentType.split(';')[0].trim().toLowerCase();
        return this.htmlMimeTypes.has(mimeType);
    }

    /**
     * Check if URL/content should be saved (either as document or page content)
     */
    shouldSaveContent(url, contentType) {
        return this.isDocumentType(url, contentType) || this.isHtmlPageContent(url, contentType);
    }

    /**
     * Check if domain is allowed
     */
    isDomainAllowed(hostname) {
        const domain = hostname.toLowerCase();
        
        // Check blocked domains first
        if (this.config.blockedDomains.length > 0) {
            for (const blocked of this.config.blockedDomains) {
                if (domain.includes(blocked.toLowerCase())) {
                    return false;
                }
            }
        }
        
        // Check allowed domains
        if (this.config.allowedDomains.length > 0) {
            return this.config.allowedDomains.some(allowed => 
                domain.includes(allowed.toLowerCase())
            );
        }
        
        // Check stay on domain restriction
        if (this.config.stayOnDomain && this.config.startUrl) {
            try {
                const startDomain = new URL(this.config.startUrl).hostname.toLowerCase();
                return domain === startDomain || domain.endsWith('.' + startDomain);
            } catch (error) {
                return true;
            }
        }
        
        return true;
    }

    /**
     * Check if URL matches ignore patterns
     */
    matchesIgnorePatterns(url) {
        return this.ignorePatterns.some(pattern => pattern.test(url));
    }

    /**
     * Check if file size is within limits
     */
    isFileSizeAllowed(size) {
        if (!size) return true;
        
        const fileSize = parseInt(size);
        if (isNaN(fileSize)) return true;
        
        return fileSize >= this.config.minFileSize && fileSize <= this.config.maxFileSize;
    }

    /**
     * Get file extension from URL or content type
     */
    getFileExtension(url, contentType = null) {
        try {
            // Try URL first
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;
            const urlExt = pathname.split('.').pop().toLowerCase();
            
            if (urlExt && this.documentExtensions.has(urlExt)) {
                return urlExt;
            }
            
            // Try content type
            if (contentType) {
                const mimeType = contentType.split(';')[0].trim();
                const ext = mime.extension(mimeType);
                if (ext && this.documentExtensions.has(ext)) {
                    return ext;
                }
            }
            
            // Fallback to URL extension
            return urlExt || 'unknown';
        } catch (error) {
            return 'unknown';
        }
    }

    /**
     * Generate safe filename from URL
     */
    sanitizeFilename(url, contentType = null) {
        try {
            const urlObj = new URL(url);
            let filename = decodeURIComponent(urlObj.pathname.split('/').pop()) || 'index';
            
            // Remove query parameters and fragments
            filename = filename.split('?')[0].split('#')[0];
            
            // Ensure file has extension
            if (!filename.includes('.')) {
                const ext = this.getFileExtension(url, contentType);
                filename += ext !== 'unknown' ? `.${ext}` : '.html';
            }
            
            // Sanitize filename
            filename = filename
                .replace(/[^a-zA-Z0-9._-]/g, '_')
                .replace(/_+/g, '_')
                .substring(0, 255);
            
            return filename || 'unknown_file';
        } catch (error) {
            return 'unknown_file';
        }
    }
}

module.exports = { FilterManager };