// Sponge Crawler Web Interface JavaScript

let currentCrawlId = null;
let statusCheckInterval = null;

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    console.log('🧽 Sponge Crawler web interface initialized');
    
    // Add smooth scrolling to navigation links
    setupSmoothScrolling();
    
    // Add fade-in animations to sections
    setupScrollAnimations();
    
    // Setup automatic page estimation when URL is entered
    setupAutoEstimation();
    
    
});


// Show crawler section
function showCrawlerSection() {
    document.getElementById('crawler').scrollIntoView({
        behavior: 'smooth',
        block: 'start'
    });
}

// New crawl - clear all data and reset interface
function newCrawl() {
    console.log('🆕 Starting new crawl - clearing all data');
    
    // Clear form fields
    document.getElementById('crawlUrl').value = '';
    document.getElementById('maxDepth').value = '3';
    document.getElementById('downloadDir').value = './downloads';
    
    // Clear adjusted max pages if it exists
    const adjustedMaxPagesField = document.getElementById('adjustedMaxPages');
    if (adjustedMaxPagesField) {
        adjustedMaxPagesField.value = '';
    }
    document.getElementById('stayOnDomain').checked = true;
    
    // Clear all file type checkboxes
    const fileTypeCheckboxes = document.querySelectorAll('input[name="fileTypes"]');
    fileTypeCheckboxes.forEach(checkbox => {
        checkbox.checked = false;
    });
    
    // Hide and clear crawl status
    const statusSection = document.getElementById('crawlStatus');
    if (statusSection) {
        statusSection.style.display = 'none';
    }
    
    // Clear results sections
    const resultsSection = document.getElementById('resultsSection');
    if (resultsSection) {
        resultsSection.style.display = 'none';
    }
    
    // Hide estimation results
    const estimationSection = document.getElementById('estimationResults');
    if (estimationSection) {
        estimationSection.style.display = 'none';
    }
    
    // Clear current crawl data
    currentCrawlId = null;
    
    // Stop any running status checks
    if (statusCheckInterval) {
        clearInterval(statusCheckInterval);
        statusCheckInterval = null;
    }
    
    // Clear any displayed results data
    const progressBar = document.querySelector('.progress-bar');
    if (progressBar) {
        progressBar.style.width = '0%';
    }
    
    const progressText = document.querySelector('.progress-text');
    if (progressText) {
        progressText.textContent = '';
    }
    
    // Clear status details
    const statusDetails = document.querySelector('.status-details');
    if (statusDetails) {
        statusDetails.innerHTML = '';
    }
    
    // Reset buttons to initial state
    const startButton = document.querySelector('.cta-button');
    if (startButton) {
        startButton.textContent = 'Start Crawl';
        startButton.disabled = false;
    }
    
    console.log('✅ New crawl interface reset completed');
    
    // Show success message briefly
    showNotification('🆕 Ready for new crawl! All data cleared.', 'success');
}

// Start crawl
async function startCrawl() {
    const url = document.getElementById('crawlUrl').value.trim();
    const maxDepth = parseInt(document.getElementById('maxDepth').value) || 3;
    // Get maxPages from adjusted field if available, otherwise use default
    const adjustedMaxPagesField = document.getElementById('adjustedMaxPages');
    const maxPages = adjustedMaxPagesField && adjustedMaxPagesField.value 
        ? parseInt(adjustedMaxPagesField.value) 
        : 1000;
    const downloadDir = document.getElementById('downloadDir').value.trim();
    const stayOnDomain = document.getElementById('stayOnDomain').checked;
    
    // Collect selected file types from checkboxes
    const selectedFileTypes = [];
    let detectedPageContentType = null;
    const fileTypeCheckboxes = document.querySelectorAll('input[name="fileTypes"]:checked');
    fileTypeCheckboxes.forEach(checkbox => {
        const value = checkbox.value;
        // Handle page content types specially
        if (value.startsWith('page-')) {
            detectedPageContentType = value.replace('page-', '');
        } else {
            const types = value.split(',');
            selectedFileTypes.push(...types);
        }
    });
    
    // Basic validation
    if (!url) {
        displayMessage('Please enter a URL to crawl', 'error');
        return;
    }
    
    if (!isValidUrl(url)) {
        displayMessage('Please enter a valid URL', 'error');
        return;
    }
    
    // Build config - handle both old and new page content settings
    const config = {
        maxDepth,
        maxPages,
        respectRobotsTxt: false,
        stayOnDomain
    };
    
    // Handle page content settings from new page-* file types
    if (detectedPageContentType) {
        config.savePageContent = true;
        config.pageContentFormat = detectedPageContentType;
    }
    
    // Always set allowedFileTypes (even if empty) to override defaults
    config.allowedFileTypes = selectedFileTypes;
    
    if (downloadDir) {
        config.outputDir = downloadDir;
    }
    
    try {
        displayMessage('Starting crawl...', 'info');
        
        const response = await fetch('/api/crawl/start', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ url, config })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            currentCrawlId = result.crawlId;
            displayMessage(`Crawl started successfully! ID: ${result.crawlId}`, 'success');
            showCrawlStatus();
            startStatusPolling();
        } else {
            displayMessage(`Failed to start crawl: ${result.error}`, 'error');
        }
        
    } catch (error) {
        displayMessage(`Error starting crawl: ${error.message}`, 'error');
    }
}

// Show crawl status section
function showCrawlStatus() {
    const statusDiv = document.getElementById('crawlStatus');
    statusDiv.style.display = 'block';
    statusDiv.scrollIntoView({ behavior: 'smooth' });
}

// Start polling for crawl status
function startStatusPolling() {
    if (statusCheckInterval) {
        clearInterval(statusCheckInterval);
    }
    
    statusCheckInterval = setInterval(async () => {
        if (currentCrawlId) {
            await updateCrawlStatus();
        }
    }, 1000); // Check every 1 second
}

// Update crawl status
async function updateCrawlStatus() {
    if (!currentCrawlId) return;
    
    try {
        const response = await fetch(`/api/crawl/${currentCrawlId}/status`);
        
        if (response.status === 404) {
            // Crawl doesn't exist anymore, stop checking
            console.log('Crawl not found, stopping status checks');
            clearInterval(statusCheckInterval);
            statusCheckInterval = null;
            currentCrawlId = null;
            document.getElementById('crawlStatus').style.display = 'none';
            return;
        }
        
        const status = await response.json();
        
        if (response.ok) {
            displayCrawlStatus(status);
            
            if (status.status === 'completed' || status.status === 'failed') {
                clearInterval(statusCheckInterval);
                statusCheckInterval = null;
            }
        }
    } catch (error) {
        console.error('Error checking crawl status:', error);
        // Stop checking after network errors to prevent spam
        if (error.message.includes('Failed to fetch')) {
            clearInterval(statusCheckInterval);
            statusCheckInterval = null;
            currentCrawlId = null;
        }
    }
}

// Clear crawl status
function clearCrawlStatus() {
    if (statusCheckInterval) {
        clearInterval(statusCheckInterval);
        statusCheckInterval = null;
    }
    currentCrawlId = null;
    document.getElementById('crawlStatus').style.display = 'none';
    document.getElementById('statusContent').innerHTML = '';
}

// Display crawl status
function displayCrawlStatus(status) {
    const statusContent = document.getElementById('statusContent');
    
    let statusClass = 'status-' + status.status;
    let statusIcon = status.status === 'running' ? '⏳' : 
                    status.status === 'completed' ? '✅' : 
                    status.status === 'failed' ? '❌' : 
                    status.status === 'aborted' ? '⏹️' : '❓';
    
    let duration = '';
    if (status.startTime) {
        const start = new Date(status.startTime);
        const end = status.endTime ? new Date(status.endTime) : new Date();
        const durationMs = end - start;
        duration = formatDuration(durationMs);
    }
    
    // Safely access stats with defaults
    const stats = status.stats || {};
    const maxPages = (status.config && status.config.maxPages) || 1000;
    const pagesVisited = stats.pagesVisited || 0;
    const totalPagesDiscovered = stats.totalPagesDiscovered || 0;
    const paginationDetected = stats.paginationDetected || false;
    const estimatedTotalPages = stats.estimatedTotalPages || 0;
    const aborted = stats.aborted || false;
    
    // Use estimated pages if available, otherwise fall back to maxPages
    const effectiveMaxPages = estimatedTotalPages > 0 ? estimatedTotalPages : maxPages;
    const totalProgress = Math.min((pagesVisited / effectiveMaxPages) * 100, 100);
    
    // Calculate pagination progress if detected
    let paginationProgress = 0;
    if (paginationDetected && totalPagesDiscovered > 0) {
        // Count how many pagination pages have been visited
        const paginationPagesVisited = Math.min(pagesVisited, totalPagesDiscovered);
        paginationProgress = (paginationPagesVisited / totalPagesDiscovered) * 100;
    }
    
    // Format current URL for display (truncate if too long)
    const currentUrlDisplay = stats.currentUrl ? 
        (stats.currentUrl.length > 60 ? 
            stats.currentUrl.substring(0, 60) + '...' : 
            stats.currentUrl) : 'None';

    statusContent.innerHTML = `
        <div class="status-card ${statusClass}">
            <div class="status-header">
                <span class="status-icon">${statusIcon}</span>
                <span class="status-text">${status.status.toUpperCase()}</span>
                ${duration ? `<span class="status-duration">${duration}</span>` : ''}
                ${status.status === 'running' ? `
                    <button class="abort-btn" onclick="abortCrawl('${status.crawlId}')" title="Stop crawling">
                        ⏹️ Abort
                    </button>
                ` : ''}
            </div>
            
            ${status.status === 'running' ? `
                <div class="progress-section">
                    ${paginationDetected ? `
                        <div class="pagination-info">
                            <span class="pagination-badge">🔍 Found ${totalPagesDiscovered} pagination pages</span>
                            ${estimatedTotalPages > 0 ? `<span class="estimation-badge">📋 ~${estimatedTotalPages} content pages discovered</span>` : ''}
                        </div>
                        <div class="progress-item">
                            <div class="progress-label">
                                <span>📑 Pagination Progress: ${Math.min(pagesVisited, totalPagesDiscovered)}/${totalPagesDiscovered}</span>
                                <span>${paginationProgress.toFixed(1)}%</span>
                            </div>
                            <div class="progress-bar">
                                <div class="progress-fill" style="width: ${paginationProgress}%"></div>
                            </div>
                        </div>
                    ` : ''}
                    <div class="progress-item">
                        <div class="progress-label">
                            <span>📄 Total Pages: ${pagesVisited}/${estimatedTotalPages > 0 ? estimatedTotalPages : maxPages}</span>
                            <span>${totalProgress.toFixed(1)}%</span>
                        </div>
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${totalProgress}%"></div>
                        </div>
                    </div>
                    
                    <div class="stats-grid">
                        <div class="stat-item">
                            <span class="stat-icon">📋</span>
                            <div>
                                <div class="stat-number">${stats.documentsFound || 0}</div>
                                <div class="stat-label">Documents Found</div>
                            </div>
                        </div>
                        <div class="stat-item">
                            <span class="stat-icon">💾</span>
                            <div>
                                <div class="stat-number">${stats.documentsDownloaded || 0}</div>
                                <div class="stat-label">Downloaded</div>
                            </div>
                        </div>
                        <div class="stat-item">
                            <span class="stat-icon">⏳</span>
                            <div>
                                <div class="stat-number">${stats.queueSize || 0}</div>
                                <div class="stat-label">Queue</div>
                            </div>
                        </div>
                        <div class="stat-item">
                            <span class="stat-icon">⚠️</span>
                            <div>
                                <div class="stat-number">${stats.errors || 0}</div>
                                <div class="stat-label">Errors</div>
                            </div>
                        </div>
                    </div>
                    
                    ${stats.currentUrl ? `
                        <div class="current-activity">
                            <strong>Currently processing:</strong><br>
                            <code class="current-url">${currentUrlDisplay}</code>
                        </div>
                    ` : ''}
                </div>
            ` : ''}
            
            <div class="status-details">
                <p><strong>Crawl ID:</strong> ${status.crawlId}</p>
                <p><strong>URL:</strong> ${(status.config && status.config.startUrl) || 'Unknown'}</p>
                <p><strong>Max Depth:</strong> ${(status.config && status.config.maxDepth) || 'Unknown'}</p>
                ${status.error ? `<p class="error"><strong>Error:</strong> ${status.error}</p>` : ''}
            </div>
            
            ${status.status === 'completed' ? `
                <div class="completion-stats">
                    <div class="completion-summary">
                        <span>✅ Completed: ${pagesVisited} pages crawled, ${stats.documentsFound || 0} documents found and available for download</span>
                        ${paginationDetected ? `<br><span>📑 Pagination: ${totalPagesDiscovered} pages discovered and processed</span>` : ''}
                    </div>
                </div>
                <div class="download-actions">
                    <button class="download-btn" onclick="downloadResults('${status.crawlId}')">
                        📥 Download All Results
                    </button>
                    <button class="download-btn btn-secondary" onclick="downloadPageContent('${status.crawlId}')">
                        📄 Download Page Content
                    </button>
                </div>
            ` : ''}
        </div>
    `;
}

// Global variables for download management
let downloadState = {
    isDownloading: false,
    isPaused: false,
    currentIndex: 0,
    totalFiles: 0,
    documents: [],
    selectedFiles: new Set(),
    downloadStats: {
        completed: 0,
        failed: 0,
        skipped: 0
    }
};

// Show document list and download interface
async function showDownloadInterface(crawlId) {
    try {
        console.log('Loading documents for crawl:', crawlId);
        const response = await fetch(`/api/crawl/${crawlId}/documents`);
        const data = await response.json();
        
        console.log('Documents response:', data);
        
        if (!response.ok) {
            displayMessage(`Error loading documents: ${data.error}`, 'error');
            console.error('Error response:', data);
            return;
        }
        
        if (data.documents.length === 0) {
            displayMessage('No documents found yet. The crawl may still be running.', 'info');
            return;
        }
        
        downloadState.documents = data.documents;
        downloadState.totalFiles = data.documents.length;
        downloadState.selectedFiles = new Set(data.documents.map((_, index) => index));
        
        displayDownloadInterface(crawlId, data);
        
    } catch (error) {
        console.error('Error loading documents:', error);
        displayMessage(`Error loading documents: ${error.message}`, 'error');
    }
}

// Display the download interface
function displayDownloadInterface(crawlId, data) {
    const statusContent = document.getElementById('statusContent');
    
    const completedCrawlInfo = statusContent.innerHTML; // Keep existing crawl info
    
    statusContent.innerHTML = completedCrawlInfo + `
        <div class="download-interface">
            <div class="download-header">
                <h3>📁 Found ${data.totalDocuments} Documents</h3>
                <div class="download-actions">
                    <button class="download-btn" onclick="downloadAllAsZip('${crawlId}')">
                        📦 Download All as ZIP
                    </button>
                    <button class="download-btn btn-secondary" onclick="startAutomaticDownload('${crawlId}')">
                        🚀 Individual Downloads
                    </button>
                    <button class="download-btn btn-secondary" onclick="selectAllFiles(true)">
                        ✅ Select All
                    </button>
                    <button class="download-btn btn-secondary" onclick="selectAllFiles(false)">
                        ❌ Deselect All
                    </button>
                </div>
            </div>
            
            <div id="downloadProgress" class="download-progress" style="display: none;">
                <div class="progress-header">
                    <span id="downloadProgressText">Ready to start...</span>
                    <div class="download-controls">
                        <button id="pauseBtn" class="btn-small" onclick="pauseDownload()">⏸️ Pause</button>
                        <button id="stopBtn" class="btn-small btn-danger" onclick="stopDownload()">⏹️ Stop</button>
                    </div>
                </div>
                <div class="progress-bar">
                    <div id="downloadProgressBar" class="progress-fill" style="width: 0%"></div>
                </div>
                <div class="download-stats">
                    <span id="downloadStats">Completed: 0 | Failed: 0 | Remaining: ${data.totalDocuments}</span>
                </div>
            </div>
            
            <div class="document-list">
                <div class="document-list-header">
                    <span class="col-select">✓</span>
                    <span class="col-filename">Filename</span>
                    <span class="col-size">Size</span>
                    <span class="col-type">Type</span>
                    <span class="col-status">Status</span>
                </div>
                <div class="document-items">
                    ${data.documents.map((doc, index) => `
                        <div class="document-item" data-index="${index}">
                            <span class="col-select">
                                <input type="checkbox" class="file-checkbox" data-index="${index}" checked onchange="toggleFileSelection(${index})">
                            </span>
                            <span class="col-filename" title="${doc.url}">${doc.filename}</span>
                            <span class="col-size">${doc.sizeFormatted}</span>
                            <span class="col-type">${doc.extension || 'unknown'}</span>
                            <span class="col-status status-available">Available</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `;
}

// Toggle file selection
function toggleFileSelection(index) {
    if (downloadState.selectedFiles.has(index)) {
        downloadState.selectedFiles.delete(index);
    } else {
        downloadState.selectedFiles.add(index);
    }
    updateDownloadButtonText();
}

// Select/deselect all files
function selectAllFiles(select) {
    const checkboxes = document.querySelectorAll('.file-checkbox');
    checkboxes.forEach((cb, index) => {
        cb.checked = select;
        if (select) {
            downloadState.selectedFiles.add(index);
        } else {
            downloadState.selectedFiles.delete(index);
        }
    });
    updateDownloadButtonText();
}

// Update download button text with selected count
function updateDownloadButtonText() {
    const downloadBtn = document.querySelector('.download-interface .download-btn');
    if (downloadBtn) {
        const selectedCount = downloadState.selectedFiles.size;
        downloadBtn.textContent = `🚀 Start Automatic Downloads (${selectedCount} files)`;
    }
}

// Start automatic download process
async function startAutomaticDownload(crawlId) {
    if (downloadState.isDownloading) {
        displayMessage('Download already in progress', 'info');
        return;
    }
    
    const selectedIndices = Array.from(downloadState.selectedFiles);
    if (selectedIndices.length === 0) {
        displayMessage('Please select at least one file to download', 'error');
        return;
    }
    
    downloadState.isDownloading = true;
    downloadState.isPaused = false;
    downloadState.currentIndex = 0;
    downloadState.downloadStats = { completed: 0, failed: 0, skipped: 0 };
    
    // Show progress interface
    document.getElementById('downloadProgress').style.display = 'block';
    
    // Start downloading selected files
    await processDownloadQueue(crawlId, selectedIndices);
}

// Process download queue
async function processDownloadQueue(crawlId, selectedIndices) {
    const totalSelected = selectedIndices.length;
    
    for (let i = 0; i < totalSelected; i++) {
        if (!downloadState.isDownloading) break;
        
        // Wait if paused
        while (downloadState.isPaused && downloadState.isDownloading) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        if (!downloadState.isDownloading) break;
        
        const docIndex = selectedIndices[i];
        const document = downloadState.documents[docIndex];
        
        downloadState.currentIndex = i;
        updateDownloadProgress(document.filename, i + 1, totalSelected);
        updateDocumentStatus(docIndex, 'downloading');
        
        try {
            await downloadSingleFile(crawlId, docIndex, document);
            downloadState.downloadStats.completed++;
            updateDocumentStatus(docIndex, 'completed');
        } catch (error) {
            console.error(`Failed to download ${document.filename}:`, error);
            downloadState.downloadStats.failed++;
            updateDocumentStatus(docIndex, 'failed');
        }
        
        updateDownloadStats(i + 1, totalSelected);
        
        // Small delay between downloads to be respectful
        if (i < totalSelected - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
    
    // Download completed
    downloadState.isDownloading = false;
    updateDownloadProgress('Download completed!', totalSelected, totalSelected);
    displayMessage(`Download completed! ${downloadState.downloadStats.completed} files downloaded, ${downloadState.downloadStats.failed} failed.`, 'success');
}

// Download single file
async function downloadSingleFile(crawlId, fileIndex, docMetadata) {
    const response = await fetch(`/api/crawl/${crawlId}/download-file/${fileIndex}`);
    
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    a.href = url;
    a.download = docMetadata.filename;
    a.style.display = 'none';
    
    window.document.body.appendChild(a);
    a.click();
    window.document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}

// Update download progress display
function updateDownloadProgress(filename, current, total) {
    const progressText = document.getElementById('downloadProgressText');
    const progressBar = document.getElementById('downloadProgressBar');
    
    const percentage = (current / total) * 100;
    
    progressText.textContent = `Downloading ${current} of ${total}: ${filename}`;
    progressBar.style.width = `${percentage}%`;
}

// Update download statistics
function updateDownloadStats(current, total) {
    const statsElement = document.getElementById('downloadStats');
    const remaining = total - current;
    
    statsElement.textContent = `Completed: ${downloadState.downloadStats.completed} | Failed: ${downloadState.downloadStats.failed} | Remaining: ${remaining}`;
}

// Update document status in the list
function updateDocumentStatus(index, status) {
    const statusElement = document.querySelector(`.document-item[data-index="${index}"] .col-status`);
    if (statusElement) {
        statusElement.className = `col-status status-${status}`;
        const statusText = {
            'pending': 'Pending',
            'downloading': '⬇️ Downloading',
            'completed': '✅ Completed',
            'failed': '❌ Failed',
            'skipped': '⏭️ Skipped'
        };
        statusElement.textContent = statusText[status] || status;
    }
}

// Pause download
function pauseDownload() {
    if (!downloadState.isDownloading) return;
    
    downloadState.isPaused = !downloadState.isPaused;
    const pauseBtn = document.getElementById('pauseBtn');
    
    if (downloadState.isPaused) {
        pauseBtn.textContent = '▶️ Resume';
        displayMessage('Download paused', 'info');
    } else {
        pauseBtn.textContent = '⏸️ Pause';
        displayMessage('Download resumed', 'info');
    }
}

// Stop download
function stopDownload() {
    downloadState.isDownloading = false;
    downloadState.isPaused = false;
    
    const pauseBtn = document.getElementById('pauseBtn');
    pauseBtn.textContent = '⏸️ Pause';
    
    document.getElementById('downloadProgressText').textContent = 'Download stopped';
    displayMessage('Download stopped', 'info');
}

// Abort crawl
async function abortCrawl(crawlId) {
    if (!confirm('Are you sure you want to abort this crawl? You can still download any documents found so far.')) {
        return;
    }
    
    try {
        displayMessage('Aborting crawl...', 'info');
        
        const response = await fetch(`/api/crawl/${crawlId}/abort`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const result = await response.json();
        
        if (response.ok) {
            displayMessage('Crawl aborted successfully!', 'success');
            // The status will update automatically via polling
        } else {
            displayMessage(`Failed to abort crawl: ${result.error}`, 'error');
        }
        
    } catch (error) {
        displayMessage(`Error aborting crawl: ${error.message}`, 'error');
    }
}

// Download all documents as ZIP
async function downloadAllAsZip(crawlId) {
    try {
        displayMessage('Preparing ZIP download...', 'info');
        
        // Create download link for ZIP file
        const downloadUrl = `/api/crawl/${crawlId}/download-all-zip`;
        const a = window.document.createElement('a');
        a.href = downloadUrl;
        a.download = `sponge-documents-${crawlId}.zip`;
        a.style.display = 'none';
        
        window.document.body.appendChild(a);
        a.click();
        window.document.body.removeChild(a);
        
        displayMessage('ZIP download started! Check your downloads folder.', 'success');
        
    } catch (error) {
        console.error('Error starting ZIP download:', error);
        displayMessage(`Error starting ZIP download: ${error.message}`, 'error');
    }
}

// Legacy download function (keep for compatibility)
async function downloadResults(crawlId) {
    await showDownloadInterface(crawlId);
}

// Download page content files as ZIP
async function downloadPageContent(crawlId) {
    try {
        displayMessage('Preparing page content download...', 'info');
        
        const response = await fetch(`/api/crawl/${crawlId}/download-pages-zip`);
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(errorData.error || `HTTP ${response.status}`);
        }
        
        // Create download link
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `sponge-pages-${crawlId}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        window.URL.revokeObjectURL(url);
        
        displayMessage('Page content ZIP download started! Check your downloads folder.', 'success');
        
    } catch (error) {
        console.error('Error downloading page content:', error);
        displayMessage(`Error downloading page content: ${error.message}`, 'error');
    }
}

// Directory Browser Functions
let directoryBrowserState = {
    currentPath: null,
    isOpen: false
};

// Open directory browser modal
async function openDirectoryBrowser() {
    directoryBrowserState.isOpen = true;
    document.getElementById('directoryModal').style.display = 'block';
    
    // Start browsing from home directory
    const homeDir = await getHomeDirectory();
    await browseDirectory(homeDir);
}

// Close directory browser modal
function closeDirectoryBrowser() {
    directoryBrowserState.isOpen = false;
    document.getElementById('directoryModal').style.display = 'none';
}

// Get user's home directory
async function getHomeDirectory() {
    try {
        const response = await fetch('/api/filesystem/browse');
        const data = await response.json();
        return data.currentPath;
    } catch (error) {
        console.error('Error getting home directory:', error);
        return './downloads'; // fallback
    }
}

// Browse directory
async function browseDirectory(path) {
    try {
        document.getElementById('directoryList').innerHTML = '<div class="loading">Loading directories...</div>';
        
        const response = await fetch(`/api/filesystem/browse?path=${encodeURIComponent(path)}`);
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Failed to browse directory');
        }
        
        directoryBrowserState.currentPath = data.currentPath;
        updateDirectoryDisplay(data);
        
    } catch (error) {
        console.error('Error browsing directory:', error);
        document.getElementById('directoryList').innerHTML = `
            <div class="error">Error: ${error.message}</div>
        `;
    }
}

// Update directory display
function updateDirectoryDisplay(data) {
    // Update current path
    document.getElementById('currentPath').textContent = data.currentPath;
    
    // Update up button
    const upButton = document.getElementById('upButton');
    upButton.disabled = !data.canGoUp;
    
    // Update directory list
    const directoryList = document.getElementById('directoryList');
    
    if (data.items.length === 0) {
        directoryList.innerHTML = '<div class="empty">No directories found</div>';
        return;
    }
    
    // Only show directories, not files
    const directories = data.items.filter(item => item.type === 'directory');
    
    if (directories.length === 0) {
        directoryList.innerHTML = '<div class="empty">No subdirectories found</div>';
        return;
    }
    
    const html = directories.map(dir => `
        <div class="directory-item" onclick="browseDirectory('${dir.path.replace(/'/g, "\\'")}')">
            <span class="dir-icon">📁</span>
            <span class="dir-name">${dir.name}</span>
            <span class="dir-date">${new Date(dir.modified).toLocaleDateString()}</span>
        </div>
    `).join('');
    
    directoryList.innerHTML = html;
}

// Navigate up one directory
async function navigateUp() {
    if (!directoryBrowserState.currentPath) return;
    
    try {
        const response = await fetch(`/api/filesystem/browse?path=${encodeURIComponent(directoryBrowserState.currentPath)}`);
        const data = await response.json();
        
        if (data.canGoUp) {
            await browseDirectory(data.parentPath);
        }
    } catch (error) {
        console.error('Error navigating up:', error);
    }
}

// Refresh current directory
async function refreshDirectory() {
    if (directoryBrowserState.currentPath) {
        await browseDirectory(directoryBrowserState.currentPath);
    }
}

// Create new directory
async function createNewDirectory() {
    const nameInput = document.getElementById('newDirName');
    const name = nameInput.value.trim();
    
    if (!name) {
        displayMessage('Please enter a directory name', 'error');
        return;
    }
    
    if (!directoryBrowserState.currentPath) {
        displayMessage('No current directory selected', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/filesystem/create-directory', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                parentPath: directoryBrowserState.currentPath,
                name: name
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Failed to create directory');
        }
        
        displayMessage(data.message, 'success');
        nameInput.value = '';
        
        // Refresh directory list
        await refreshDirectory();
        
    } catch (error) {
        console.error('Error creating directory:', error);
        displayMessage(`Error creating directory: ${error.message}`, 'error');
    }
}

// Select current directory
function selectCurrentDirectory() {
    if (!directoryBrowserState.currentPath) {
        displayMessage('No directory selected', 'error');
        return;
    }
    
    // Update the download directory input
    document.getElementById('downloadDir').value = directoryBrowserState.currentPath;
    
    // Close the modal
    closeDirectoryBrowser();
    
    displayMessage(`Directory selected: ${directoryBrowserState.currentPath}`, 'success');
}






// URL validation
function isValidUrl(string) {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
}

// Format duration
function formatDuration(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
        return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
}

// Format date
function formatDate(dateString) {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }).format(date);
}

// Display notification message
function displayMessage(text, type = 'success') {
    // Remove existing message if any
    const existingMessage = document.querySelector('.message');
    if (existingMessage) {
        existingMessage.remove();
    }
    
    // Create new message element
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    messageDiv.textContent = text;
    
    // Add to page
    document.body.appendChild(messageDiv);
    
    // Show message
    setTimeout(() => {
        messageDiv.classList.add('show');
    }, 100);
    
    // Hide message after 3 seconds
    setTimeout(() => {
        messageDiv.classList.remove('show');
        setTimeout(() => {
            if (messageDiv.parentNode) {
                messageDiv.parentNode.removeChild(messageDiv);
            }
        }, 300);
    }, 3000);
}

// Email validation
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Setup smooth scrolling for navigation links
function setupSmoothScrolling() {
    const navLinks = document.querySelectorAll('.nav-links a[href^="#"]');
    
    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            
            const targetId = this.getAttribute('href');
            const targetSection = document.querySelector(targetId);
            
            if (targetSection) {
                targetSection.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });
}

// Setup scroll animations
function setupScrollAnimations() {
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };
    
    const observer = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('fade-in');
            }
        });
    }, observerOptions);
    
    // Observe all content sections
    const sections = document.querySelectorAll('.content-section');
    sections.forEach(section => {
        observer.observe(section);
    });
}

// Utility functions
const utils = {
    // Generate random ID
    generateId: function() {
        return Math.random().toString(36).substr(2, 9);
    },
    
    // Debounce function
    debounce: function(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
};

// Export utilities for potential module use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { utils, displayMessage, isValidEmail, isValidUrl };
}

// Setup automatic page estimation when URL is entered
function setupAutoEstimation() {
    const urlInput = document.getElementById('crawlUrl');
    let estimationTimeout = null;
    
    if (urlInput) {
        urlInput.addEventListener('input', function() {
            const url = this.value.trim();
            
            // Clear previous timeout
            if (estimationTimeout) {
                clearTimeout(estimationTimeout);
            }
            
            // Only estimate if URL looks valid and is not empty
            if (url && isValidUrl(url)) {
                // Debounce the estimation call by 1 second to avoid rapid requests
                estimationTimeout = setTimeout(() => {
                    console.log('🔍 Auto-triggering page estimation for:', url);
                    estimatePages();
                }, 1000);
            } else {
                // Hide estimation results if URL becomes invalid
                const estimationResults = document.getElementById('estimationResults');
                if (estimationResults) {
                    estimationResults.style.display = 'none';
                }
                lastEstimation = null;
            }
        });
    }
}

// Page Estimation Functions
let lastEstimation = null;

// Estimate pages before crawling
async function estimatePages() {
    const url = document.getElementById('crawlUrl').value.trim();
    const maxDepth = parseInt(document.getElementById('maxDepth').value) || 3;
    // Get current max pages from adjusted field if available, otherwise use default
    const adjustedMaxPagesField = document.getElementById('adjustedMaxPages');
    const currentMaxPages = adjustedMaxPagesField && adjustedMaxPagesField.value 
        ? parseInt(adjustedMaxPagesField.value) 
        : 1000;
    
    if (!url) {
        displayMessage('Please enter a URL first', 'error');
        return;
    }
    
    if (!isValidUrl(url)) {
        displayMessage('Please enter a valid URL', 'error');
        return;
    }
    
    const estimateButton = document.querySelector('.estimate-button');
    const originalText = estimateButton.textContent;
    
    try {
        // Update button to show loading
        estimateButton.textContent = '🔍 Estimating...';
        estimateButton.disabled = true;
        
        const response = await fetch('/api/crawl/estimate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                url: url,
                config: {
                    maxDepth: maxDepth,
                    maxPages: currentMaxPages,
                    timeout: 10000
                }
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Failed to estimate pages');
        }
        
        lastEstimation = data.estimation;
        displayEstimationResults(data.estimation);
        
        // Auto-update max pages with suggestion in the adjustment field
        if (data.estimation.autoAdjusted) {
            const adjustedMaxPagesField = document.getElementById('adjustedMaxPages');
            if (adjustedMaxPagesField) {
                adjustedMaxPagesField.value = data.estimation.suggestedMaxPages;
            }
            displayMessage(`Max pages auto-adjusted to ${data.estimation.suggestedMaxPages}`, 'info');
        }
        
    } catch (error) {
        console.error('Error estimating pages:', error);
        displayMessage(`Error estimating pages: ${error.message}`, 'error');
    } finally {
        // Reset button
        estimateButton.textContent = originalText;
        estimateButton.disabled = false;
    }
}

// Display estimation results in the UI
function displayEstimationResults(estimation) {
    const resultsDiv = document.getElementById('estimationResults');
    const confidenceBadge = document.getElementById('estimationConfidence');
    const estimatedTotal = document.getElementById('estimatedTotal');
    const discoveredPages = document.getElementById('discoveredPages');
    const paginationStatus = document.getElementById('paginationStatus');
    const sitemapStatus = document.getElementById('sitemapStatus');
    const adjustedMaxPages = document.getElementById('adjustedMaxPages');
    const patternsDiv = document.getElementById('estimationPatterns');
    const patternsList = document.getElementById('patternsList');
    
    // Update confidence badge
    const confidenceClass = {
        'high': 'confidence-high',
        'medium': 'confidence-medium',
        'low': 'confidence-low',
        'error': 'confidence-error'
    };
    
    confidenceBadge.textContent = estimation.confidence.toUpperCase();
    confidenceBadge.className = `confidence-badge ${confidenceClass[estimation.confidence] || 'confidence-unknown'}`;
    
    // Add tooltip for confidence levels
    const confidenceTooltips = {
        'high': 'Very reliable - based on sitemap or comprehensive analysis',
        'medium': 'Moderately reliable - based on link analysis and patterns',
        'low': 'Less reliable - limited data available or estimation failed',
        'error': 'Estimation failed - using default values'
    };
    confidenceBadge.title = confidenceTooltips[estimation.confidence] || 'Unknown confidence level';
    
    // Update stats
    estimatedTotal.textContent = estimation.estimatedTotal.toLocaleString();
    discoveredPages.textContent = estimation.discoveredUrls.toLocaleString();
    paginationStatus.textContent = estimation.paginationDetected ? 'Yes' : 'No';
    sitemapStatus.textContent = estimation.sitemapFound ? 'Yes' : 'No';
    
    // Set initial adjustment value
    adjustedMaxPages.value = estimation.suggestedMaxPages || estimation.estimatedTotal;
    
    // Show patterns if any
    if (estimation.patterns && estimation.patterns.length > 0) {
        patternsList.innerHTML = estimation.patterns.map(pattern => 
            `<li>${pattern}</li>`
        ).join('');
        patternsDiv.style.display = 'block';
    } else {
        patternsDiv.style.display = 'none';
    }
    
    // Show results
    resultsDiv.style.display = 'block';
    
    // Scroll to results
    resultsDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Adjust max pages based on user input
async function adjustMaxPages() {
    if (!lastEstimation) {
        displayMessage('Please estimate pages first', 'error');
        return;
    }
    
    const userLimit = parseInt(document.getElementById('adjustedMaxPages').value);
    
    if (!userLimit || userLimit < 1) {
        displayMessage('Please enter a valid page limit', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/crawl/adjust-limit', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                estimatedTotal: lastEstimation.estimatedTotal,
                userLimit: userLimit
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Failed to adjust limit');
        }
        
        // Update the adjusted max pages input
        const adjustedMaxPagesField = document.getElementById('adjustedMaxPages');
        if (adjustedMaxPagesField) {
            adjustedMaxPagesField.value = data.adjustedLimit;
        }
        
        // Show adjustment info
        const adjustmentInfo = document.getElementById('adjustmentInfo');
        let infoHtml = `<div class="adjustment-result">`;
        
        if (data.reduction > 0) {
            infoHtml += `<span class="reduction-info">Reduced by ${data.reduction}%</span>`;
        }
        
        infoHtml += `<div class="recommendation">${data.recommended}</div>`;
        infoHtml += `<div class="safety-info">${data.safety}</div>`;
        infoHtml += `</div>`;
        
        adjustmentInfo.innerHTML = infoHtml;
        
        displayMessage(`Max pages adjusted to ${data.adjustedLimit}`, 'success');
        
    } catch (error) {
        console.error('Error adjusting limit:', error);
        displayMessage(`Error adjusting limit: ${error.message}`, 'error');
    }
}

// Show notification message
function showNotification(message, type = 'info', duration = 3000) {
    // Remove existing notifications
    const existingNotifications = document.querySelectorAll('.notification');
    existingNotifications.forEach(notification => notification.remove());
    
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    
    // Style the notification
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 12px 20px;
        border-radius: 8px;
        color: white;
        font-weight: 600;
        z-index: 10000;
        opacity: 0;
        transform: translateX(100px);
        transition: all 0.3s ease;
        max-width: 300px;
        word-wrap: break-word;
    `;
    
    // Set background color based on type
    const colors = {
        'success': '#28a745',
        'error': '#dc3545',
        'warning': '#ffc107',
        'info': '#17a2b8'
    };
    
    notification.style.background = colors[type] || colors['info'];
    
    // Add to document
    document.body.appendChild(notification);
    
    // Animate in
    setTimeout(() => {
        notification.style.opacity = '1';
        notification.style.transform = 'translateX(0)';
    }, 10);
    
    // Remove after duration
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(100px)';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, duration);
}

console.log('🧽 Sponge Crawler web interface scripts loaded');
