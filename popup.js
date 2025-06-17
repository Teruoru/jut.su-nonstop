/**
 * Jut.su NonStop - Extension for automating anime watching on jut.su
 * Popup script - Handles settings UI and storage
 */

// Default settings
const defaultSettings = {
    skipOpening: true,
    autoNextEpisode: true,
    fullscreenMode: true,
    videoSpeed: '1',
    language: 'ru' // Default language: Russian
};

// Current settings object
let settings = {};

// UI elements
const elements = {
    skipOpening: document.getElementById('skipOpening'),
    autoNextEpisode: document.getElementById('autoNextEpisode'),
    fullscreenMode: document.getElementById('fullscreenMode'),
    videoSpeed: document.getElementById('videoSpeed'),
    languageToggle: document.getElementById('languageToggle'),
    allEpisodesButton: document.getElementById('allEpisodesButton'),
    ongoingButton: document.getElementById('ongoingButton')
};

/**
 * Load settings from storage and update UI
 */
function loadSettings() {
    chrome.storage.sync.get(defaultSettings, (loadedSettings) => {
        settings = loadedSettings;
        console.log('Settings loaded:', settings);
        
        // Update UI checkboxes
        for (const [key, element] of Object.entries(elements)) {
            if (key === 'languageToggle' || key === 'allEpisodesButton' || key === 'ongoingButton') continue;
            if (element && typeof settings[key] === 'boolean') {
                element.checked = settings[key];
            } else if (key === 'videoSpeed' && element) {
                element.value = settings[key];
            }
        }
        
        // Update language toggle button text
        elements.languageToggle.textContent = settings.language === 'ru' ? 'EN' : 'RU';
        
        // Update UI language
        updateLanguage(settings.language);
    });
}

/**
 * Save settings to storage
 */
function saveSettings() {
    // Update settings object from UI
    for (const [key, element] of Object.entries(elements)) {
        if (key === 'languageToggle' || key === 'allEpisodesButton' || key === 'ongoingButton') continue;
        if (element) {
            if (key === 'videoSpeed') {
                settings[key] = element.value;
            } else {
                settings[key] = element.checked;
            }
        }
    }
    
    // Save to storage
    chrome.storage.sync.set(settings, () => {
        console.log('Settings saved:', settings);
    });
}

/**
 * Update UI language based on selected language
 * @param {string} lang - Language code ('ru' or 'en')
 */
function updateLanguage(lang) {
    const elements = document.querySelectorAll('[data-lang-ru]');
    
    elements.forEach(element => {
        if (lang === 'ru') {
            element.textContent = element.getAttribute('data-lang-ru');
        } else {
            element.textContent = element.getAttribute('data-lang-en');
        }
    });
}

/**
 * Toggle language between Russian and English
 */
function toggleLanguage() {
    settings.language = settings.language === 'ru' ? 'en' : 'ru';
    elements.languageToggle.textContent = settings.language === 'ru' ? 'EN' : 'RU';
    updateLanguage(settings.language);
    saveSettings();
}

/**
 * Navigate to list of all episodes of current anime
 */
function navigateToAllEpisodes() {
    // Using activeTab to get URL of current page
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        const currentUrl = tabs[0].url;
        // Check if we are on episode page
        if (currentUrl.includes('jut.su') && currentUrl.includes('episode-')) {
            // Extract anime name from URL
            const urlParts = currentUrl.split('/');
            let animeIndex = -1;
            
            // Find index of URL part with anime name
            for (let i = 0; i < urlParts.length; i++) {
                if (urlParts[i] === 'jut.su' && i + 1 < urlParts.length) {
                    animeIndex = i + 1;
                    break;
                }
            }
            
            if (animeIndex !== -1 && animeIndex < urlParts.length) {
                const animeName = urlParts[animeIndex];
                // Form URL for list of all episodes
                const allEpisodesUrl = `https://jut.su/${animeName}/`;
                chrome.tabs.update(tabs[0].id, { url: allEpisodesUrl });
            } else {
                console.log('Could not determine anime name from URL');
            }
        } else {
            console.log('Current page is not an episode page');
        }
    });
}

/**
 * Change video playback speed
 */
function changeVideoSpeed() {
    const speed = elements.videoSpeed.value;
    settings.videoSpeed = speed;
    saveSettings();
    
    // Send message to content script to change speed
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        chrome.tabs.sendMessage(tabs[0].id, {
            action: "changeSpeed",
            speed: speed
        });
    });
}

// Initialize popup
document.addEventListener('DOMContentLoaded', () => {
    // Load settings
    loadSettings();
    
    // Add event listeners for settings changes
    for (const [key, element] of Object.entries(elements)) {
        if (key === 'languageToggle' || key === 'allEpisodesButton' || key === 'ongoingButton' || key === 'videoSpeed') continue;
        if (element) {
            element.addEventListener('change', () => {
                saveSettings();
                
                // Send message to content script when settings change
                chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
                    chrome.tabs.sendMessage(tabs[0].id, {
                        action: "updateSettings",
                        settings: {
                            [key]: element.checked
                        }
                    });
                });
            });
        }
    }
    
    // Add video speed change event listener
    elements.videoSpeed.addEventListener('change', changeVideoSpeed);
    
    // Add language toggle event listener
    elements.languageToggle.addEventListener('click', toggleLanguage);
    
    // Add all episodes button event listener
    elements.allEpisodesButton.addEventListener('click', navigateToAllEpisodes);
    
    // Add ongoing button event listener
    elements.ongoingButton.addEventListener('click', () => {
        chrome.tabs.create({ url: 'https://jut.su/anime/ongoing' });
    });
});