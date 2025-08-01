const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');
const { Logger } = require('../utils/Logger');

class PageEstimator {
    constructor(config = {}) {
        this.config = {
            maxDepth: config.maxDepth || 3,
            timeout: config.timeout || 10000,
            userAgent: config.userAgent || 'Sponge-Crawler/Page-Estimator',
            maxSamplePages: 50, // Limit sample pages for estimation
            ...config
        };
        
        this.logger = new Logger();
        this.visitedUrls = new Set();
        this.discoveredUrls = new Set();
        this.paginationPatterns = [];
        this.sitemapUrls = [];
    }

    async estimatePages(startUrl) {
        this.logger.info(`🔍 Starting page estimation for: ${startUrl}`);
        
        try {
            const results = {
                estimatedTotal: 0,
                discoveredUrls: 0,
                paginationDetected: false,
                sitemapFound: false,
                patterns: [],
                sampleUrls: [],
                confidence: 'unknown'
            };

            // Step 1: Check for sitemap
            const sitemapPages = await this.checkSitemap(startUrl);
            if (sitemapPages > 0) {
                results.sitemapFound = true;
                results.estimatedTotal = sitemapPages;
                results.confidence = 'high';
                this.logger.info(`📋 Found sitemap with ${sitemapPages} pages`);
                return results;
            }

            // Step 2: Crawl sample pages to discover structure
            await this.sampleCrawl(startUrl, 0);
            
            results.discoveredUrls = this.discoveredUrls.size;
            results.sampleUrls = Array.from(this.discoveredUrls).slice(0, 20);

            // Step 3: Analyze pagination patterns
            const paginationEstimate = await this.analyzePagination(startUrl);
            if (paginationEstimate > 0) {
                results.paginationDetected = true;
                results.estimatedTotal = Math.max(results.discoveredUrls, paginationEstimate);
                results.confidence = 'medium';
                results.patterns = this.paginationPatterns;
            } else {
                // Step 4: Use discovery-based estimation
                results.estimatedTotal = this.estimateFromDiscovery();
                results.confidence = results.estimatedTotal > results.discoveredUrls ? 'low' : 'medium';
            }

            this.logger.info(`📊 Page estimation complete: ~${results.estimatedTotal} pages (confidence: ${results.confidence})`);
            return results;

        } catch (error) {
            this.logger.error('Error during page estimation:', error);
            return {
                estimatedTotal: 1,
                discoveredUrls: 1,
                paginationDetected: false,
                sitemapFound: false,
                patterns: [],
                sampleUrls: [startUrl],
                confidence: 'error',
                error: error.message
            };
        }
    }

    async checkSitemap(startUrl) {
        const baseUrl = new URL(startUrl);
        const sitemapUrls = [
            `${baseUrl.protocol}//${baseUrl.host}/sitemap.xml`,
            `${baseUrl.protocol}//${baseUrl.host}/sitemap_index.xml`,
            `${baseUrl.protocol}//${baseUrl.host}/robots.txt`
        ];

        for (const sitemapUrl of sitemapUrls) {
            try {
                const response = await axios.get(sitemapUrl, {
                    timeout: this.config.timeout,
                    headers: { 'User-Agent': this.config.userAgent }
                });

                if (sitemapUrl.includes('robots.txt')) {
                    const robotsSitemaps = this.extractSitemapsFromRobots(response.data);
                    for (const robotsSitemap of robotsSitemaps) {
                        const count = await this.parseSitemap(robotsSitemap);
                        if (count > 0) return count;
                    }
                } else {
                    const count = await this.parseSitemap(sitemapUrl, response.data);
                    if (count > 0) return count;
                }
            } catch (error) {
                // Continue to next sitemap URL
                continue;
            }
        }

        return 0;
    }

    extractSitemapsFromRobots(robotsContent) {
        const sitemaps = [];
        const lines = robotsContent.split('\n');
        
        for (const line of lines) {
            const trimmed = line.trim().toLowerCase();
            if (trimmed.startsWith('sitemap:')) {
                const sitemapUrl = line.substring(line.indexOf(':') + 1).trim();
                sitemaps.push(sitemapUrl);
            }
        }
        
        return sitemaps;
    }

    async parseSitemap(sitemapUrl, content = null) {
        try {
            if (!content) {
                const response = await axios.get(sitemapUrl, {
                    timeout: this.config.timeout,
                    headers: { 'User-Agent': this.config.userAgent }
                });
                content = response.data;
            }

            const $ = cheerio.load(content, { xmlMode: true });
            
            // Check if it's a sitemap index
            const sitemapElements = $('sitemap loc');
            if (sitemapElements.length > 0) {
                let totalUrls = 0;
                // Parse each individual sitemap (limit to prevent timeout)
                const sitemaps = sitemapElements.toArray().slice(0, 10);
                
                for (const element of sitemaps) {
                    const sitemapUrl = $(element).text();
                    const count = await this.parseSitemap(sitemapUrl);
                    totalUrls += count;
                }
                
                return totalUrls;
            }

            // Count URL elements in regular sitemap
            const urlElements = $('url loc');
            return urlElements.length;

        } catch (error) {
            this.logger.error(`Error parsing sitemap ${sitemapUrl}:`, error.message);
            return 0;
        }
    }

    async sampleCrawl(url, depth) {
        if (depth >= this.config.maxDepth || this.visitedUrls.has(url) || this.visitedUrls.size >= this.config.maxSamplePages) {
            return;
        }

        try {
            this.visitedUrls.add(url);
            
            const response = await axios.get(url, {
                timeout: this.config.timeout,
                headers: { 'User-Agent': this.config.userAgent }
            });

            const $ = cheerio.load(response.data);
            const baseUrl = new URL(url);

            // Extract all links
            const links = new Set();
            $('a[href]').each((_, element) => {
                try {
                    const href = $(element).attr('href');
                    const absoluteUrl = new URL(href, url).href;
                    const linkUrl = new URL(absoluteUrl);
                    
                    // Only include same-domain links
                    if (linkUrl.hostname === baseUrl.hostname) {
                        links.add(absoluteUrl);
                        this.discoveredUrls.add(absoluteUrl);
                    }
                } catch (e) {
                    // Skip invalid URLs
                }
            });

            // Recursively crawl a sample of discovered links
            const linksArray = Array.from(links);
            const sampleSize = Math.min(5, linksArray.length);
            const sampleLinks = linksArray.slice(0, sampleSize);

            for (const link of sampleLinks) {
                await this.sampleCrawl(link, depth + 1);
            }

        } catch (error) {
            this.logger.error(`Error sampling page ${url}:`, error.message);
        }
    }

    async analyzePagination(startUrl) {
        try {
            const response = await axios.get(startUrl, {
                timeout: this.config.timeout,
                headers: { 'User-Agent': this.config.userAgent }
            });

            const $ = cheerio.load(response.data);
            let maxPageNumber = 0;

            // Common pagination patterns
            const paginationSelectors = [
                'a[href*="page="]',
                'a[href*="p="]',
                'a[href*="/page/"]',
                '.pagination a',
                '.pager a',
                '.page-numbers a',
                'nav a[href*="page"]'
            ];

            for (const selector of paginationSelectors) {
                $(selector).each((_, element) => {
                    const href = $(element).attr('href');
                    const text = $(element).text().trim();
                    
                    // Extract page numbers from URLs and text
                    const urlPageMatch = href?.match(/page[=/](\d+)/i) || href?.match(/p=(\d+)/i);
                    const textPageMatch = text.match(/^\d+$/);
                    
                    if (urlPageMatch) {
                        const pageNum = parseInt(urlPageMatch[1]);
                        if (pageNum > maxPageNumber) {
                            maxPageNumber = pageNum;
                            this.paginationPatterns.push(`URL pattern: ${href}`);
                        }
                    }
                    
                    if (textPageMatch) {
                        const pageNum = parseInt(text);
                        if (pageNum > maxPageNumber) {
                            maxPageNumber = pageNum;
                            this.paginationPatterns.push(`Text pattern: "${text}"`);
                        }
                    }
                });
            }

            // Look for "last page" or "total pages" indicators
            const lastPageIndicators = [
                'span:contains("of")',
                '.total-pages',
                '[data-total-pages]'
            ];

            for (const selector of lastPageIndicators) {
                const element = $(selector).first();
                if (element.length) {
                    const text = element.text();
                    const totalMatch = text.match(/of\s+(\d+)/i) || text.match(/(\d+)\s+total/i);
                    if (totalMatch) {
                        const total = parseInt(totalMatch[1]);
                        if (total > maxPageNumber) {
                            maxPageNumber = total;
                            this.paginationPatterns.push(`Total indicator: "${text}"`);
                        }
                    }
                }
            }

            return maxPageNumber;

        } catch (error) {
            this.logger.error('Error analyzing pagination:', error.message);
            return 0;
        }
    }

    estimateFromDiscovery() {
        const discovered = this.discoveredUrls.size;
        
        // Apply heuristics based on discovery patterns
        if (discovered < 10) {
            return discovered;
        } else if (discovered < 50) {
            return Math.floor(discovered * 1.5); // Assume 50% more pages exist
        } else {
            return Math.floor(discovered * 2); // Assume 100% more pages exist
        }
    }

    static async quickEstimate(startUrl, config = {}) {
        const estimator = new PageEstimator(config);
        return await estimator.estimatePages(startUrl);
    }
}

module.exports = { PageEstimator };