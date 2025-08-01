const axios = require('axios');
const robotsParser = require('robots-parser');
const { URL } = require('url');

/**
 * Robots.txt compliance checker
 */
class RobotsChecker {
    constructor(config) {
        this.config = config;
        this.robotsCache = new Map();
        this.userAgent = config.userAgent || '*';
    }

    /**
     * Load and parse robots.txt for a given URL
     */
    async loadRobotsTxt(url) {
        try {
            const urlObj = new URL(url);
            const baseUrl = `${urlObj.protocol}//${urlObj.host}`;
            
            // Check cache first
            if (this.robotsCache.has(baseUrl)) {
                return this.robotsCache.get(baseUrl);
            }
            
            const robotsUrl = `${baseUrl}/robots.txt`;
            
            try {
                const response = await axios.get(robotsUrl, {
                    timeout: 10000,
                    validateStatus: (status) => status < 500
                });
                
                if (response.status === 200) {
                    const robots = robotsParser(robotsUrl, response.data);
                    this.robotsCache.set(baseUrl, robots);
                    return robots;
                } else {
                    // No robots.txt or error - allow everything
                    const allowAll = robotsParser(robotsUrl, 'User-agent: *\nAllow: /');
                    this.robotsCache.set(baseUrl, allowAll);
                    return allowAll;
                }
            } catch (error) {
                // Network error or timeout - allow everything
                const allowAll = robotsParser(robotsUrl, 'User-agent: *\nAllow: /');
                this.robotsCache.set(baseUrl, allowAll);
                return allowAll;
            }
        } catch (error) {
            // Invalid URL or other error - allow everything
            return robotsParser('', 'User-agent: *\nAllow: /');
        }
    }

    /**
     * Check if URL is allowed by robots.txt
     */
    async isAllowed(url) {
        if (!this.config.respectRobotsTxt) {
            return true;
        }
        
        try {
            const robots = await this.loadRobotsTxt(url);
            return robots.isAllowed(url, this.userAgent);
        } catch (error) {
            // On error, default to allowing the URL
            return true;
        }
    }

    /**
     * Get crawl delay from robots.txt
     */
    async getCrawlDelay(url) {
        try {
            const robots = await this.loadRobotsTxt(url);
            return robots.getCrawlDelay(this.userAgent) * 1000 || this.config.delay;
        } catch (error) {
            return this.config.delay;
        }
    }

    /**
     * Get sitemap URLs from robots.txt
     */
    async getSitemaps(url) {
        try {
            const robots = await this.loadRobotsTxt(url);
            return robots.getSitemaps() || [];
        } catch (error) {
            return [];
        }
    }

    /**
     * Clear robots cache
     */
    clearCache() {
        this.robotsCache.clear();
    }
}

module.exports = { RobotsChecker };