#!/usr/bin/env node

/**
 * Sponge Web Crawler - Main Entry Point
 * Automate extraction and downloading of content/documents from public websites
 */

const path = require('path');
const { program } = require('commander');
const { SpongeCrawler } = require('./crawler/SpongeCrawler');
const { ConfigManager } = require('./config/ConfigManager');
const { Logger } = require('./utils/Logger');

// Initialize logger
const logger = new Logger();

/**
 * Main application entry point
 */
async function main() {
    try {
        logger.info('🧽 Starting Sponge Web Crawler');
        
        // Load configuration
        const configManager = new ConfigManager();
        const config = await configManager.loadConfig();
        
        // Initialize crawler
        const crawler = new SpongeCrawler(config);
        
        // Start crawling
        await crawler.start();
        
        logger.info('✅ Crawling completed successfully');
        
    } catch (error) {
        logger.error('❌ Crawler failed:', error);
        process.exit(1);
    }
}

// CLI interface
program
    .name('sponge')
    .description('Website Content & Document Crawler for Developers')
    .version('1.0.0')
    .option('-u, --url <url>', 'starting URL to crawl')
    .option('-d, --depth <number>', 'maximum crawl depth', parseInt)
    .option('-o, --output <path>', 'output directory')
    .option('-c, --config <path>', 'configuration file path')
    .option('--dry-run', 'run without downloading files')
    .option('--verbose', 'enable verbose logging')
    .action(async (options) => {
        try {
            const configManager = new ConfigManager(options.config);
            const config = await configManager.loadConfig(options);
            
            const crawler = new SpongeCrawler(config);
            await crawler.start();
            
        } catch (error) {
            logger.error('CLI Error:', error);
            process.exit(1);
        }
    });

// Parse CLI arguments if running as CLI
if (require.main === module) {
    program.parse();
}

module.exports = { main, SpongeCrawler, ConfigManager, Logger };