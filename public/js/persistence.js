// persistence.js - Add this to your public/js/ folder
// This helps maintain data even when Render's free tier resets the server

class AnimePersistenceManager {
    constructor(apiBaseUrl) {
        this.apiBaseUrl = apiBaseUrl || '';
        this.localStorageKey = 'anime_tracker_backup';
        this.lastBackupKey = 'anime_tracker_last_backup';
        this.backupIntervalMinutes = 15; // Auto-backup every 15 minutes
        
        // Initialize
        this.initAutoBackup();
        this.sendBackupToServer();
    }
    
    // Initialize auto-backup system
    initAutoBackup() {
        // Check if we should perform a backup based on time elapsed
        const lastBackup = localStorage.getItem(this.lastBackupKey);
        const now = Date.now();
        
        if (!lastBackup || (now - parseInt(lastBackup)) > (this.backupIntervalMinutes * 60 * 1000)) {
            this.performBackup();
        }
        
        // Set up recurring backup
        setInterval(() => this.performBackup(), this.backupIntervalMinutes * 60 * 1000);
        
        // Add event listener for when the page is about to unload
        window.addEventListener('beforeunload', () => this.performBackup());
    }
    
    // Perform data backup to localStorage
    async performBackup() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/export`);
            if (!response.ok) throw new Error('Failed to fetch data for backup');
            
            const data = await response.json();
            
            // Store in localStorage
            localStorage.setItem(this.localStorageKey, JSON.stringify(data));
            localStorage.setItem(this.lastBackupKey, Date.now().toString());
            
            console.log('Anime data backed up to localStorage:', new Date().toLocaleString());
            return true;
        } catch (error) {
            console.error('Failed to backup anime data:', error);
            return false;
        }
    }
    
    // Send backup from localStorage to server (when server is fresh)
    async sendBackupToServer() {
        try {
            // First check if server has data
            const healthResponse = await fetch(`${this.apiBaseUrl}/health`);
            if (!healthResponse.ok) throw new Error('Server health check failed');
            
            const serverStatus = await healthResponse.json();
            
            // If server has no data, send our backup
            if (serverStatus.dataStats.customAnimeCount === 0 && 
                serverStatus.dataStats.episodesCount === 0 && 
                serverStatus.dataStats.scheduledCount === 0) {
                
                const backupData = localStorage.getItem(this.localStorageKey);
                if (!backupData) {
                    console.log('No local backup available to restore to server');
                    return false;
                }
                
                const parsedBackup = JSON.parse(backupData);
                
                // Send backup to server
                const restoreResponse = await fetch(`${this.apiBaseUrl}/api/browser-backup`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(parsedBackup)
                });
                
                if (!restoreResponse.ok) throw new Error('Failed to restore backup to server');
                
                const result = await restoreResponse.json();
                console.log('Backup restored to server:', result);
                return true;
            } else {
                console.log('Server already has data, no need to restore from browser backup');
                return false;
            }
        } catch (error) {
            console.error('Failed to restore backup to server:', error);
            return false;
        }
    }
    
    // Manual backup download as JSON file
    downloadBackup() {
        fetch(`${this.apiBaseUrl}/api/export`)
            .then(response => response.json())
            .then(data => {
                // Create a download link
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `anime_backup_${new Date().toISOString().slice(0,10)}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            })
            .catch(error => {
                console.error('Failed to download backup:', error);
                alert('Failed to download backup: ' + error.message);
            });
    }
    
    // Manual restore from backup file
    restoreFromFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = async (e) => {
                try {
                    const contents = e.target.result;
                    const data = JSON.parse(contents);
                    
                    // Send to server
                    const response = await fetch(`${this.apiBaseUrl}/api/import`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(data)
                    });
                    
                    if (!response.ok) throw new Error('Server returned error');
                    
                    const result = await response.json();
                    
                    // Also update local storage backup
                    localStorage.setItem(this.localStorageKey, JSON.stringify(data));
                    localStorage.setItem(this.lastBackupKey, Date.now().toString());
                    
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            };
            
            reader.onerror = (error) => {
                reject(error);
            };
            
            reader.readAsText(file);
        });
    }
    
    // Check if we have a local backup
    hasLocalBackup() {
        return localStorage.getItem(this.localStorageKey) !== null;
    }
    
    // Get backup info
    getBackupInfo() {
        const backupData = localStorage.getItem(this.localStorageKey);
        if (!backupData) return null;
        
        try {
            const parsed = JSON.parse(backupData);
            const lastBackup = localStorage.getItem(this.lastBackupKey);
            
            return {
                animeCount: parsed.anime ? parsed.anime.length : 0,
                episodesCount: parsed.episodes ? parsed.episodes.length : 0,
                scheduledCount: parsed.scheduled ? parsed.scheduled.length : 0,
                exportDate: parsed.exportDate,
                lastBackupTime: lastBackup ? new Date(parseInt(lastBackup)).toLocaleString() : 'Unknown'
            };
        } catch (error) {
            console.error('Error parsing backup info:', error);
            return null;
        }
    }
    
    // Add a component to your UI for backup and restore
    createBackupUI(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        const backupInfo = this.getBackupInfo();
        
        container.innerHTML = `
            <div class="backup-panel" style="border: 1px solid #ccc; padding: 15px; border-radius: 5px; margin-top: 20px;">
                <h3>Data Backup & Persistence</h3>
                ${backupInfo ? `
                    <p>Last backup: ${backupInfo.lastBackupTime}</p>
                    <p>Contains: ${backupInfo.animeCount} anime, ${backupInfo.episodesCount} episodes, ${backupInfo.scheduledCount} scheduled items</p>
                ` : '<p>No local backup data found</p>'}
                <div style="display: flex; gap: 10px; margin-top: 10px;">
                    <button id="manual-backup-btn" class="backup-btn">Backup Now</button>
                    <button id="download-backup-btn" class="backup-btn">Download Backup File</button>
                    <button id="restore-backup-btn" class="backup-btn">Restore from File</button>
                </div>
                <input type="file" id="backup-file-input" accept=".json" style="display: none;">
            </div>
        `;
        
        // Add event listeners
        document.getElementById('manual-backup-btn').addEventListener('click', () => {
            this.performBackup().then(success => {
                alert(success ? 'Backup successful!' : 'Backup failed!');
                this.createBackupUI(containerId); // Refresh UI
            });
        });
        
        document.getElementById('download-backup-btn').addEventListener('click', () => {
            this.downloadBackup();
        });
        
        document.getElementById('restore-backup-btn').addEventListener('click', () => {
            document.getElementById('backup-file-input').click();
        });
        
        document.getElementById('backup-file-input').addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (!file) return;
            
            this.restoreFromFile(file)
                .then(result => {
                    alert(`Backup restored successfully!\nAnime: ${result.counts.anime}\nEpisodes: ${result.counts.episodes}\nScheduled: ${result.counts.scheduled}`);
                    this.createBackupUI(containerId); // Refresh UI
                    window.location.reload(); // Reload page to show restored data
                })
                .catch(error => {
                    alert('Error restoring backup: ' + error.message);
                });
        });
    }
    
    // Keep the Render server alive
    startKeepAlive() {
        // Ping the server every 10 minutes to prevent sleep
        setInterval(() => {
            fetch(`${this.apiBaseUrl}/api/ping`)
                .then(response => response.json())
                .then(data => console.log('Server ping:', data))
                .catch(error => console.error('Server ping failed:', error));
        }, 10 * 60 * 1000); // 10 minutes
    }
}

// Example usage:
// const persistenceManager = new AnimePersistenceManager('');
// persistenceManager.createBackupUI('backup-container');
// persistenceManager.startKeepAlive();
