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
        // If no file types are allowed, don't treat anything as a document
        if (this.documentExtensions.size === 0) {
            return false;
        }
        
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname.toLowerCase();
            
            // Check file extension
            const extension = pathname.split('.').pop();
            if (extension && this.documentExtensions.has(extension)) {
                return true;
            }
            
            // Only check document patterns if the extensions match our allowed types
            const documentPatterns = [];
            if (this.documentExtensions.has('pdf')) {
                documentPatterns.push(/\.pdf[\?#]?/i);
            }
            if (this.documentExtensions.has('doc') || this.documentExtensions.has('docx')) {
                documentPatterns.push(/\.docx?[\?#]?/i);
            }
            if (this.documentExtensions.has('xls') || this.documentExtensions.has('xlsx')) {
                documentPatterns.push(/\.xlsx?[\?#]?/i);
            }
            if (this.documentExtensions.has('ppt') || this.documentExtensions.has('pptx')) {
                documentPatterns.push(/\.pptx?[\?#]?/i);
            }
            
            // Only check download patterns if we have any allowed document types
            if (this.documentExtensions.size > 0) {
                documentPatterns.push(
                    /\/(download|file|document|attachment)\//i,
                    /[\?&](file|download|attachment)=/i
                );
            }
            
            return documentPatterns.some(pattern => pattern.test(url));
        } catch (error) {
            return false;
        }
    }

    /**
     * Check if content type indicates a document
     */
    isDocumentType(url, contentType) {
        // If no file types are allowed, don't treat anything as a document
        if (this.documentExtensions.size === 0) {
            return false;
        }
        
        if (!contentType) {
            return this.isDocumentUrl(url);
        }
        
        const mimeType = contentType.split(';')[0].trim().toLowerCase();
        
        // Only check MIME types for allowed file extensions
        const allowedMimeTypes = new Set();
        
        if (this.documentExtensions.has('pdf')) {
            allowedMimeTypes.add('application/pdf');
        }
        if (this.documentExtensions.has('doc')) {
            allowedMimeTypes.add('application/msword');
        }
        if (this.documentExtensions.has('docx')) {
            allowedMimeTypes.add('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        }
        if (this.documentExtensions.has('xls')) {
            allowedMimeTypes.add('application/vnd.ms-excel');
        }
        if (this.documentExtensions.has('xlsx')) {
            allowedMimeTypes.add('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        }
        if (this.documentExtensions.has('ppt')) {
            allowedMimeTypes.add('application/vnd.ms-powerpoint');
        }
        if (this.documentExtensions.has('pptx')) {
            allowedMimeTypes.add('application/vnd.openxmlformats-officedocument.presentationml.presentation');
        }
        if (this.documentExtensions.has('txt')) {
            allowedMimeTypes.add('text/plain');
        }
        if (this.documentExtensions.has('csv')) {
            allowedMimeTypes.add('text/csv');
        }
        if (this.documentExtensions.has('json')) {
            allowedMimeTypes.add('application/json');
        }
        if (this.documentExtensions.has('xml')) {
            allowedMimeTypes.add('application/xml');
            allowedMimeTypes.add('text/xml');
        }
        if (this.documentExtensions.has('jpg') || this.documentExtensions.has('jpeg')) {
            allowedMimeTypes.add('image/jpeg');
            allowedMimeTypes.add('image/jpg');
        }
        if (this.documentExtensions.has('png')) {
            allowedMimeTypes.add('image/png');
        }
        if (this.documentExtensions.has('gif')) {
            allowedMimeTypes.add('image/gif');
        }
        if (this.documentExtensions.has('webp')) {
            allowedMimeTypes.add('image/webp');
        }
        if (this.documentExtensions.has('svg')) {
            allowedMimeTypes.add('image/svg+xml');
        }
        
        return allowedMimeTypes.has(mimeType);
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