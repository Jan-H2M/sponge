#!/usr/bin/env node

/**
 * Sponge Web Crawler - Command Line Interface
 * Automate extraction and downloading of content/documents from public websites
 */

const { program } = require('commander');
const path = require('path');
const fs = require('fs-extra');

const { SpongeCrawler } = require('../src/crawler/SpongeCrawler');
const { ConfigManager } = require('../src/config/ConfigManager');
const { Logger } = require('../src/utils/Logger');

// Package info
const packageInfo = require('../package.json');

// Initialize logger
const logger = new Logger();

/**
 * Main CLI program
 */
program
    .name('sponge')
    .description('Website Content & Document Crawler for Developers')
    .version(packageInfo.version)
    .helpOption('-h, --help', 'display help for command');

/**
 * Crawl command
 */
program
    .command('crawl')
    .description('Start crawling a website')
    .argument('<url>', 'starting URL to crawl')
    .option('-d, --depth <number>', 'maximum crawl depth', parseInt, 3)
    .option('-o, --output <path>', 'output directory', './downloads')
    .option('-c, --config <path>', 'configuration file path')
    .option('--max-pages <number>', 'maximum pages to crawl', parseInt, 1000)
    .option('--concurrency <number>', 'concurrent requests', parseInt, 5)
    .option('--delay <number>', 'delay between requests (ms)', parseInt, 1000)
    .option('--dry-run', 'run without downloading files')
    .option('--verbose', 'enable verbose logging')
    .option('--debug', 'enable debug logging')
    .option('--no-robots', 'ignore robots.txt')
    .option('--stay-domain', 'stay on the same domain only')
    .option('--allowed-types <types>', 'comma-separated list of allowed file types')
    .option('--max-size <size>', 'maximum file size in MB', parseInt)
    .option('--auth-type <type>', 'authentication type (basic, bearer, cookie)')
    .option('--auth-user <username>', 'username for basic auth')
    .option('--auth-pass <password>', 'password for basic auth')
    .option('--auth-token <token>', 'bearer token for authentication')
    .action(async (url, options) => {
        try {
            await runCrawl(url, options);
        } catch (error) {
            logger.error('Crawl failed:', error);
            process.exit(1);
        }
    });

/**
 * Config command
 */
program
    .command('config')
    .description('Manage configuration')
    .option('--init', 'create example configuration file')
    .option('--validate <path>', 'validate configuration file')
    .option('--show <path>', 'show current configuration')
    .action(async (options) => {
        try {
            await runConfigCommand(options);
        } catch (error) {
            logger.error('Config command failed:', error);
            process.exit(1);
        }
    });

/**
 * Test command
 */
program
    .command('test')
    .description('Test crawler configuration')
    .argument('<url>', 'URL to test')
    .option('-c, --config <path>', 'configuration file path')
    .option('--auth-only', 'test authentication only')
    .option('--robots-only', 'test robots.txt only')
    .action(async (url, options) => {
        try {
            await runTestCommand(url, options);
        } catch (error) {
            logger.error('Test failed:', error);
            process.exit(1);
        }
    });


/**
 * Run crawl command
 */
async function runCrawl(url, options) {
    logger.info(`🧽 Starting Sponge Crawler v${packageInfo.version}`);
    
    // Create config manager
    const configManager = new ConfigManager(options.config);
    
    // Build configuration from options
    const cliConfig = buildConfigFromOptions(url, options);
    const config = await configManager.loadConfig(cliConfig);
    
    // Validate configuration for crawl execution
    configManager.validateCrawlConfig(config);
    
    // Initialize and start crawler
    const crawler = new SpongeCrawler(config);
    await crawler.start();
    
    logger.info('✅ Crawling completed successfully');
}

/**
 * Run config command
 */
async function runConfigCommand(options) {
    const configManager = new ConfigManager();
    
    if (options.init) {
        const examplePath = await configManager.createExampleConfig();
        logger.info(`Example configuration created: ${examplePath}`);
        return;
    }
    
    if (options.validate) {
        try {
            const config = await configManager.loadConfig();
            configManager.validateConfig(config);
            logger.info('✅ Configuration is valid');
        } catch (error) {
            logger.error('❌ Configuration validation failed:', error);
            process.exit(1);
        }
        return;
    }
    
    if (options.show) {
        try {
            const config = await configManager.loadConfig();
            console.log(JSON.stringify(config, null, 2));
        } catch (error) {
            logger.error('Failed to load configuration:', error);
            process.exit(1);
        }
        return;
    }
    
    // Default: show help
    program.commands.find(cmd => cmd.name() === 'config').help();
}

/**
 * Run test command
 */
async function runTestCommand(url, options) {
    const configManager = new ConfigManager(options.config);
    const config = await configManager.loadConfig({ startUrl: url });
    
    if (options.authOnly) {
        const { AuthManager } = require('../src/auth/AuthManager');
        const auth = new AuthManager(config);
        
        const validation = auth.validateAuth();
        if (!validation.valid) {
            logger.error('Auth validation failed:', validation.errors);
            return;
        }
        
        const testResult = await auth.testAuth(url);
        if (testResult.success) {
            logger.info('✅ Authentication test passed:', testResult.message);
        } else {
            logger.error('❌ Authentication test failed:', testResult.message);
        }
        return;
    }
    
    if (options.robotsOnly) {
        const { RobotsChecker } = require('../src/crawler/RobotsChecker');
        const robots = new RobotsChecker(config);
        
        const isAllowed = await robots.isAllowed(url);
        if (isAllowed) {
            logger.info('✅ URL is allowed by robots.txt');
        } else {
            logger.warn('❌ URL is blocked by robots.txt');
        }
        
        const delay = await robots.getCrawlDelay(url);
        logger.info(`Recommended crawl delay: ${delay}ms`);
        
        const sitemaps = await robots.getSitemaps(url);
        if (sitemaps.length > 0) {
            logger.info('Found sitemaps:', sitemaps);
        }
        return;
    }
    
    // Full test
    logger.info(`Testing crawler configuration for: ${url}`);
    
    // Test basic connectivity
    const axios = require('axios');
    try {
        const response = await axios.head(url, { timeout: 10000 });
        logger.info(`✅ URL accessible (${response.status})`);
    } catch (error) {
        logger.error(`❌ URL not accessible: ${error.message}`);
    }
    
    // Test auth if configured
    if (config.auth && config.auth.type) {
        const { AuthManager } = require('../src/auth/AuthManager');
        const auth = new AuthManager(config);
        const testResult = await auth.testAuth(url);
        
        if (testResult.success) {
            logger.info('✅ Authentication test passed');
        } else {
            logger.warn('⚠️  Authentication test failed:', testResult.message);
        }
    }
    
    // Test robots.txt
    if (config.respectRobotsTxt) {
        const { RobotsChecker } = require('../src/crawler/RobotsChecker');
        const robots = new RobotsChecker(config);
        const isAllowed = await robots.isAllowed(url);
        
        if (isAllowed) {
            logger.info('✅ URL allowed by robots.txt');
        } else {
            logger.warn('⚠️  URL blocked by robots.txt');
        }
    }
    
    logger.info('Test completed');
}


/**
 * Build configuration from CLI options
 */
function buildConfigFromOptions(url, options) {
    const config = { startUrl: url };
    
    if (options.depth !== undefined) config.maxDepth = options.depth;
    if (options.output) config.outputDir = options.output;
    if (options.maxPages !== undefined) config.maxPages = options.maxPages;
    if (options.concurrency !== undefined) config.concurrency = options.concurrency;
    if (options.delay !== undefined) config.delay = options.delay;
    if (options.dryRun) config.dryRun = true;
    if (options.verbose) config.logLevel = 'verbose';
    if (options.debug) config.logLevel = 'debug';
    if (options.noRobots) config.respectRobotsTxt = false;
    if (options.stayDomain) config.stayOnDomain = true;
    if (options.maxSize !== undefined) config.maxFileSize = options.maxSize * 1024 * 1024;
    
    if (options.allowedTypes) {
        config.allowedFileTypes = options.allowedTypes.split(',').map(t => t.trim());
    }
    
    // Authentication options
    if (options.authType) {
        config.auth = { type: options.authType };
        
        if (options.authUser && options.authPass) {
            config.auth.username = options.authUser;
            config.auth.password = options.authPass;
        }
        
        if (options.authToken) {
            config.auth.token = options.authToken;
        }
    }
    
    return config;
}

/**
 * Handle uncaught errors
 */
process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Parse command line arguments
if (require.main === module) {
    program.parse(process.argv);
    
    // Show help if no command provided
    if (!process.argv.slice(2).length) {
        program.outputHelp();
    }
}