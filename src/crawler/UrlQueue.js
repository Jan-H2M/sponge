/**
 * URL queue implementation for managing crawl URLs with priority
 */
class UrlQueue {
    constructor() {
        this.queue = [];
        this.seen = new Set();
    }

    /**
     * Add URL to queue if not already seen
     */
    enqueue(url, depth = 0, priority = 0) {
        if (this.seen.has(url)) {
            return false;
        }
        
        this.seen.add(url);
        this.queue.push({
            url,
            depth,
            priority,
            timestamp: Date.now()
        });
        
        // Sort by priority (higher first), then by depth (lower first)
        this.queue.sort((a, b) => {
            if (a.priority !== b.priority) {
                return b.priority - a.priority;
            }
            return a.depth - b.depth;
        });
        
        return true;
    }

    /**
     * Remove and return next URL from queue
     */
    dequeue() {
        return this.queue.shift();
    }

    /**
     * Check if queue is empty
     */
    isEmpty() {
        return this.queue.length === 0;
    }

    /**
     * Get queue size
     */
    size() {
        return this.queue.length;
    }

    /**
     * Check if URL has been seen
     */
    hasSeen(url) {
        return this.seen.has(url);
    }

    /**
     * Get queue statistics
     */
    getStats() {
        const depthCounts = {};
        for (const item of this.queue) {
            depthCounts[item.depth] = (depthCounts[item.depth] || 0) + 1;
        }
        
        return {
            total: this.queue.length,
            seen: this.seen.size,
            depthDistribution: depthCounts
        };
    }

    /**
     * Clear the queue
     */
    clear() {
        this.queue = [];
        this.seen.clear();
    }
}

module.exports = { UrlQueue };