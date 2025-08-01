const fs = require('fs-extra');
const path = require('path');

/**
 * Configuration management for Sponge Crawler
 */
class ConfigManager {
    constructor(configPath = null) {
        this.configPath = configPath || path.join(process.cwd(), 'sponge.config.json');
        this.defaultConfig = this.getDefaultConfig();
    }

    /**
     * Get default configuration
     */
    getDefaultConfig() {
        return {
            // Basic crawling settings
            maxDepth: 3,
            maxPages: 1000,
            concurrency: 5,
            
            // Output settings
            outputDir: './downloads',
            createMirrorStructure: true,
            flatFileStructure: false, // When true, saves all files directly in outputDir without subdirectories
            
            // File filtering
            allowedFileTypes: [
                'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
                'txt', 'csv', 'json', 'xml',
                'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'
            ],
            maxFileSize: 100 * 1024 * 1024, // 100MB
            minFileSize: 100, // 100 bytes (allows small logos/icons)
            
            // Domain filtering
            allowedDomains: [],
            blockedDomains: [],
            stayOnDomain: true,
            
            // Rate limiting
            delay: 1000, // ms between requests
            randomDelay: true,
            respectRobotsTxt: true,
            
            // Authentication
            auth: {
                type: null, // 'basic', 'bearer', 'cookie'
                username: null,
                password: null,
                token: null,
                cookies: []
            },
            
            // Request settings
            timeout: 30000,
            userAgent: 'Sponge-Crawler/1.0.0 (+https://github.com/username/sponge-crawler)',
            headers: {},
            
            // Export settings
            exportMetadata: true,
            metadataFormat: 'json', // 'json' or 'csv'
            
            // Page content saving
            savePageContent: false,
            pageContentFormat: 'text', // 'html', 'text', 'markdown'
            
            // Logging
            logLevel: 'info',
            logProgress: true,
            
            // Advanced
            followRedirects: true,
            ignoreSSLErrors: false,
            useHeadlessMode: false // for JavaScript-heavy sites
        };
    }

    /**
     * Load configuration from file and merge with CLI options
     */
    async loadConfig(cliOptions = {}) {
        let fileConfig = {};
        
        // Try to load from file
        try {
            if (await fs.pathExists(this.configPath)) {
                const configData = await fs.readFile(this.configPath, 'utf8');
                fileConfig = JSON.parse(configData);
            }
        } catch (error) {
            console.warn(`Warning: Could not load config from ${this.configPath}:`, error.message);
        }
        
        // Merge configurations: default < file < CLI options
        const normalizedOptions = this.normalizeCliOptions(cliOptions);
        const config = {
            ...this.defaultConfig,
            ...fileConfig,
            ...normalizedOptions
        };
        
        // Also directly merge any remaining cliOptions that weren't normalized
        // This handles cases where config is passed directly (like from web interface)
        Object.keys(cliOptions).forEach(key => {
            if (cliOptions[key] !== undefined && cliOptions[key] !== null && !(key in normalizedOptions)) {
                config[key] = cliOptions[key];
            }
        });
        
        return config;
    }

    /**
     * Normalize CLI options to match config structure
     */
    normalizeCliOptions(options) {
        const normalized = {};
        
        if (options.url) normalized.startUrl = options.url;
        if (options.depth !== undefined) normalized.maxDepth = options.depth;
        if (options.output) normalized.outputDir = options.output;
        if (options.verbose) normalized.logLevel = 'verbose';
        if (options.dryRun) normalized.dryRun = true;
        
        return normalized;
    }

    /**
     * Validate configuration
     */
    validateConfig(config) {
        const errors = [];
        
        // Only validate startUrl if it's provided (for web server startup)
        if (config.startUrl) {
            try {
                new URL(config.startUrl);
            } catch (error) {
                errors.push('Invalid start URL format');
            }
        }
        
        if (config.maxDepth !== undefined && config.maxDepth < 0) {
            errors.push('Max depth must be >= 0');
        }
        
        if (config.concurrency !== undefined && (config.concurrency < 1 || config.concurrency > 20)) {
            errors.push('Concurrency must be between 1 and 20');
        }
        
        if (config.delay !== undefined && config.delay < 0) {
            errors.push('Delay must be >= 0');
        }
        
        if (errors.length > 0) {
            throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
        }
    }

    /**
     * Validate configuration for crawl execution
     */
    validateCrawlConfig(config) {
        const errors = [];
        
        if (!config.startUrl) {
            errors.push('Start URL is required');
        }
        
        if (config.startUrl) {
            try {
                new URL(config.startUrl);
            } catch (error) {
                errors.push('Invalid start URL format');
            }
        }
        
        if (config.maxDepth < 0) {
            errors.push('Max depth must be >= 0');
        }
        
        if (config.concurrency < 1 || config.concurrency > 20) {
            errors.push('Concurrency must be between 1 and 20');
        }
        
        if (config.delay < 0) {
            errors.push('Delay must be >= 0');
        }
        
        if (errors.length > 0) {
            throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
        }
    }

    /**
     * Save current configuration to file
     */
    async saveConfig(config) {
        try {
            await fs.ensureDir(path.dirname(this.configPath));
            await fs.writeFile(this.configPath, JSON.stringify(config, null, 2));
            return true;
        } catch (error) {
            throw new Error(`Failed to save config: ${error.message}`);
        }
    }

    /**
     * Create example configuration file
     */
    async createExampleConfig() {
        const exampleConfig = {
            ...this.defaultConfig,
            startUrl: 'https://example.com',
            maxDepth: 2,
            outputDir: './example-downloads',
            allowedFileTypes: ['pdf', 'docx', 'jpg', 'png']
        };
        
        const examplePath = path.join(process.cwd(), 'sponge.config.example.json');
        await fs.writeFile(examplePath, JSON.stringify(exampleConfig, null, 2));
        
        return examplePath;
    }
}

module.exports = { ConfigManager };