const { Logger } = require('../utils/Logger');

/**
 * Authentication manager for handling different auth methods
 */
class AuthManager {
    constructor(config) {
        this.config = config;
        this.logger = new Logger({ level: config.logLevel });
        this.authConfig = config.auth || {};
    }

    /**
     * Setup HTTP client with authentication
     */
    setupHttpClient(httpClient) {
        if (!this.authConfig.type) {
            return httpClient;
        }

        switch (this.authConfig.type.toLowerCase()) {
            case 'basic':
                this.setupBasicAuth(httpClient);
                break;
            case 'bearer':
                this.setupBearerAuth(httpClient);
                break;
            case 'cookie':
                this.setupCookieAuth(httpClient);
                break;
            case 'custom':
                this.setupCustomAuth(httpClient);
                break;
            default:
                this.logger.warn(`Unknown auth type: ${this.authConfig.type}`);
        }

        return httpClient;
    }

    /**
     * Setup Basic Authentication
     */
    setupBasicAuth(httpClient) {
        if (!this.authConfig.username || !this.authConfig.password) {
            throw new Error('Basic auth requires username and password');
        }

        const credentials = Buffer.from(
            `${this.authConfig.username}:${this.authConfig.password}`
        ).toString('base64');

        httpClient.defaults.headers.common['Authorization'] = `Basic ${credentials}`;
        
        this.logger.info('Basic authentication configured');
    }

    /**
     * Setup Bearer Token Authentication
     */
    setupBearerAuth(httpClient) {
        if (!this.authConfig.token) {
            throw new Error('Bearer auth requires token');
        }

        httpClient.defaults.headers.common['Authorization'] = `Bearer ${this.authConfig.token}`;
        
        this.logger.info('Bearer token authentication configured');
    }

    /**
     * Setup Cookie-based Authentication
     */
    setupCookieAuth(httpClient) {
        if (!this.authConfig.cookies || !Array.isArray(this.authConfig.cookies)) {
            throw new Error('Cookie auth requires cookies array');
        }

        const cookieString = this.authConfig.cookies
            .map(cookie => {
                if (typeof cookie === 'string') {
                    return cookie;
                } else if (cookie.name && cookie.value) {
                    return `${cookie.name}=${cookie.value}`;
                }
                return '';
            })
            .filter(Boolean)
            .join('; ');

        if (cookieString) {
            httpClient.defaults.headers.common['Cookie'] = cookieString;
            this.logger.info('Cookie authentication configured');
        }
    }

    /**
     * Setup Custom Authentication Headers
     */
    setupCustomAuth(httpClient) {
        if (!this.authConfig.headers || typeof this.authConfig.headers !== 'object') {
            throw new Error('Custom auth requires headers object');
        }

        Object.entries(this.authConfig.headers).forEach(([key, value]) => {
            httpClient.defaults.headers.common[key] = value;
        });

        this.logger.info('Custom authentication headers configured');
    }

    /**
     * Add authentication to individual request
     */
    addAuthToRequest(requestConfig) {
        if (!this.authConfig.type) {
            return requestConfig;
        }

        const config = { ...requestConfig };

        switch (this.authConfig.type.toLowerCase()) {
            case 'basic':
                config.auth = {
                    username: this.authConfig.username,
                    password: this.authConfig.password
                };
                break;

            case 'bearer':
                config.headers = {
                    ...config.headers,
                    'Authorization': `Bearer ${this.authConfig.token}`
                };
                break;

            case 'cookie':
                const cookieString = this.authConfig.cookies
                    .map(cookie => {
                        if (typeof cookie === 'string') {
                            return cookie;
                        } else if (cookie.name && cookie.value) {
                            return `${cookie.name}=${cookie.value}`;
                        }
                        return '';
                    })
                    .filter(Boolean)
                    .join('; ');

                if (cookieString) {
                    config.headers = {
                        ...config.headers,
                        'Cookie': cookieString
                    };
                }
                break;

            case 'custom':
                config.headers = {
                    ...config.headers,
                    ...this.authConfig.headers
                };
                break;
        }

        return config;
    }

    /**
     * Validate authentication configuration
     */
    validateAuth() {
        if (!this.authConfig.type) {
            return { valid: true };
        }

        const errors = [];

        switch (this.authConfig.type.toLowerCase()) {
            case 'basic':
                if (!this.authConfig.username) errors.push('Basic auth missing username');
                if (!this.authConfig.password) errors.push('Basic auth missing password');
                break;

            case 'bearer':
                if (!this.authConfig.token) errors.push('Bearer auth missing token');
                break;

            case 'cookie':
                if (!this.authConfig.cookies || !Array.isArray(this.authConfig.cookies)) {
                    errors.push('Cookie auth requires cookies array');
                } else if (this.authConfig.cookies.length === 0) {
                    errors.push('Cookie auth cookies array is empty');
                }
                break;

            case 'custom':
                if (!this.authConfig.headers || typeof this.authConfig.headers !== 'object') {
                    errors.push('Custom auth requires headers object');
                }
                break;

            default:
                errors.push(`Unknown auth type: ${this.authConfig.type}`);
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Test authentication by making a test request
     */
    async testAuth(testUrl) {
        if (!this.authConfig.type) {
            return { success: true, message: 'No authentication configured' };
        }

        try {
            const axios = require('axios');
            const client = axios.create();
            this.setupHttpClient(client);

            const response = await client.head(testUrl, { timeout: 10000 });
            
            if (response.status === 401) {
                return { success: false, message: 'Authentication failed (401 Unauthorized)' };
            } else if (response.status === 403) {
                return { success: false, message: 'Authentication succeeded but access forbidden (403)' };
            } else if (response.status < 400) {
                return { success: true, message: 'Authentication test successful' };
            } else {
                return { success: false, message: `Unexpected response: ${response.status}` };
            }

        } catch (error) {
            if (error.response && error.response.status === 401) {
                return { success: false, message: 'Authentication failed (401 Unauthorized)' };
            } else if (error.response && error.response.status === 403) {
                return { success: false, message: 'Authentication succeeded but access forbidden (403)' };
            } else {
                return { success: false, message: `Auth test error: ${error.message}` };
            }
        }
    }

    /**
     * Get authentication info for logging (without sensitive data)
     */
    getAuthInfo() {
        if (!this.authConfig.type) {
            return { type: 'none' };
        }

        const info = { type: this.authConfig.type };

        switch (this.authConfig.type.toLowerCase()) {
            case 'basic':
                info.username = this.authConfig.username;
                break;
            case 'bearer':
                info.hasToken = !!this.authConfig.token;
                break;
            case 'cookie':
                info.cookieCount = this.authConfig.cookies ? this.authConfig.cookies.length : 0;
                break;
            case 'custom':
                info.headerCount = this.authConfig.headers ? Object.keys(this.authConfig.headers).length : 0;
                break;
        }

        return info;
    }

    /**
     * Handle authentication errors during crawling
     */
    handleAuthError(error, url) {
        if (error.response) {
            const status = error.response.status;
            
            if (status === 401) {
                this.logger.error(`Authentication failed for ${url} - credentials may be invalid`);
                return { retry: false, authError: true };
            } else if (status === 403) {
                this.logger.warn(`Access forbidden for ${url} - may need different permissions`);
                return { retry: false, authError: true };
            }
        }

        return { retry: true, authError: false };
    }
}

module.exports = { AuthManager };