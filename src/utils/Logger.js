const winston = require('winston');
const path = require('path');

/**
 * Centralized logging utility for Sponge Crawler
 */
class Logger {
    constructor(options = {}) {
        this.logLevel = options.level || process.env.LOG_LEVEL || 'info';
        this.logDir = options.logDir || path.join(process.cwd(), 'logs');
        
        this.logger = winston.createLogger({
            level: this.logLevel,
            format: winston.format.combine(
                winston.format.timestamp({
                    format: 'YYYY-MM-DD HH:mm:ss'
                }),
                winston.format.errors({ stack: true }),
                winston.format.printf(({ level, message, timestamp, ...meta }) => {
                    let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;
                    if (Object.keys(meta).length > 0) {
                        log += ` ${JSON.stringify(meta)}`;
                    }
                    return log;
                })
            ),
            transports: [
                // Console output
                new winston.transports.Console({
                    format: winston.format.combine(
                        winston.format.colorize(),
                        winston.format.simple()
                    )
                }),
                // File output
                new winston.transports.File({
                    filename: path.join(this.logDir, 'error.log'),
                    level: 'error'
                }),
                new winston.transports.File({
                    filename: path.join(this.logDir, 'crawler.log'),
                    maxsize: 5242880, // 5MB
                    maxFiles: 5
                })
            ]
        });

        // Create logs directory if it doesn't exist
        this.ensureLogDir();
    }

    ensureLogDir() {
        const fs = require('fs');
        try {
            if (!fs.existsSync(this.logDir)) {
                fs.mkdirSync(this.logDir, { recursive: true });
            }
        } catch (error) {
            console.warn('Could not create logs directory:', error.message);
        }
    }

    info(message, meta = {}) {
        this.logger.info(message, meta);
    }

    warn(message, meta = {}) {
        this.logger.warn(message, meta);
    }

    error(message, meta = {}) {
        this.logger.error(message, meta);
    }

    debug(message, meta = {}) {
        this.logger.debug(message, meta);
    }

    verbose(message, meta = {}) {
        this.logger.verbose(message, meta);
    }

    // Progress logging for crawler operations
    logProgress(current, total, message = '') {
        const percent = Math.round((current / total) * 100);
        this.info(`Progress: ${current}/${total} (${percent}%) ${message}`);
    }

    // URL logging
    logUrl(action, url, statusCode = null, size = null) {
        const meta = {};
        if (statusCode) meta.statusCode = statusCode;
        if (size) meta.size = size;
        
        this.info(`${action}: ${url}`, meta);
    }

    // Error with URL context
    logUrlError(url, error, statusCode = null) {
        const meta = { url };
        if (statusCode) meta.statusCode = statusCode;
        
        this.error(`Failed to process ${url}: ${error.message}`, meta);
    }
}

module.exports = { Logger };