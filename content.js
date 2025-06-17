/**
 * Jut.su NonStop - Extension for automating anime watching on jut.su
 * Content script - Handles all website interactions
 * 
 * This script provides the following features:
 * - Auto-skip openings
 * - Auto-play next episode
 * - Keep fullscreen mode when navigating between episodes
 * - Enhanced fullscreen mode (hiding site elements)
 * - Hide sidebar for better viewing experience
 */

/**
 * Checks if an element is visible on the page
 * @param {Element} element - DOM element to check
 * @returns {boolean} true if the element is visible
 */
function isElementVisible(element) {
  if (!element) return false;
  
  // Check for null and presence in DOM
  if (element.offsetParent === null) {
    // Check element styles for special cases (fixed position, etc.)
    const style = window.getComputedStyle(element);
    
    // If element has position: fixed, it may be visible even with offsetParent === null
    if (style.position === 'fixed') {
      // Check if element is hidden by other means
      return style.display !== 'none' && 
             style.visibility !== 'hidden' && 
             style.opacity !== '0' &&
             parseInt(style.zIndex, 10) >= 0;
    }
    
    // In normal case, if offsetParent === null, element is invisible
    return false;
  }
  
  // Check element styles
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || 
      style.visibility === 'hidden' || 
      style.opacity === '0') {
    return false;
  }
  
  // Check element dimensions
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return false;
  }
  
  // Check if element is in viewport
  // This is an optional check, as element may be outside screen but still considered visible
  // Uncomment if needed
  /*
  const windowHeight = window.innerHeight || document.documentElement.clientHeight;
  const windowWidth = window.innerWidth || document.documentElement.clientWidth;
  
  const vertInView = (rect.top <= windowHeight) && (rect.top + rect.height >= 0);
  const horInView = (rect.left <= windowWidth) && (rect.left + rect.width >= 0);
  
  if (!vertInView || !horInView) {
    return false;
  }
  */
  
  return true;
}

/**
 * Default settings
 */
let settings = {
  skipOpening: true,
  autoNextEpisode: true,
  fullscreenMode: true,
  videoSpeed: '1',
  clickDelay: '3'
};

/**
 * Global variables to save fullscreen mode state
 * Using localStorage to preserve state between page reloads
 */
let wasInFullscreen = false;
let fullscreenRestoreAttempted = false; // Flag to track restoration attempts
let isTransitioning = false; // Flag to track page transition process
let fullscreenRetryCount = 0; // Counter for fullscreen restoration attempts
let videoElement = null;      // Reference to the video element
let observer = null;          // Mutation observer for DOM changes
let skipButtonClicked = false; // Flag to track if skip button was clicked
let nextEpisodeClicked = false; // Flag to track if next episode button was clicked

/**
 * Global variables to track tab state
 */
let isTabActive = true;
let isInitialized = false;

/**
 * Toggles visibility of site elements for fullscreen mode
 * @param {boolean} hide - true to hide elements, false to show them
 */
function toggleSiteElements(hide) {
  // Elements to hide in fullscreen mode
  const elementsToHide = [
    '.header', 
    '.menu_line',
    '.content_shadow',
    '.footer',
    '.side_block',
    '.side_block_left',
    '.side_block_right',
    '.side_block_top',
    '.side_block_bottom',
    '.notice_top2',
    '.notice_cont',
    '.notice',
    '[class*="notice"]',
    '[class*="popup"]',
    '[class*="modal"]',
    '[class*="overlay"]:not(.vjs-overlay-skip-intro)',
    '.video_ad_content',
    '.video_ad_text',
    '.video_bottom_related',
    '.video_bottom_title',
    '.video_bottom_related_new',
    '.video_bottom_title_new',
    '.info_panel.clear'
  ];
  
  // Apply visibility changes
  elementsToHide.forEach(selector => {
    const elements = document.querySelectorAll(selector);
    elements.forEach(element => {
      if (hide) {
        // Save original display style if not already saved
        if (!element.dataset.originalDisplay) {
          element.dataset.originalDisplay = element.style.display || '';
        }
        element.style.display = 'none';
      } else {
        // Restore original display style if available
        if (element.dataset.originalDisplay) {
          element.style.display = element.dataset.originalDisplay;
        } else {
          element.style.display = '';
        }
      }
    });
  });
  
  // Handle special case for video container
  const videoContainer = document.querySelector('.video_plate');
  if (videoContainer) {
    if (hide) {
      // Save original width if not already saved
      if (!videoContainer.dataset.originalWidth) {
        videoContainer.dataset.originalWidth = videoContainer.style.width || '';
      }
      // Make video container full width
      videoContainer.style.width = '100%';
      videoContainer.style.maxWidth = '100%';
      videoContainer.style.margin = '0';
      videoContainer.style.padding = '0';
    } else {
      // Restore original width if available
      if (videoContainer.dataset.originalWidth) {
        videoContainer.style.width = videoContainer.dataset.originalWidth;
      } else {
        videoContainer.style.width = '';
      }
      videoContainer.style.maxWidth = '';
      videoContainer.style.margin = '';
      videoContainer.style.padding = '';
    }
  }
}

// Initialization: trying to restore state from localStorage
try {
  const savedFullscreenState = localStorage.getItem('jutsu_fullscreen_state');
  if (savedFullscreenState === 'true') {
    console.log('Restored fullscreen state from localStorage: TRUE');
    wasInFullscreen = true;
  }
} catch (e) {
  console.error('Error accessing localStorage:', e);
}

// Loading settings from storage
browser.storage.sync.get(settings).then((items) => {
  settings = items;
  console.log('Settings loaded:', settings);
  
  // Apply settings immediately after loading
  
  // Initialize fullscreen event handlers if enabled
  if (settings.fullscreenMode) {
    initFullscreenHandlers();
  }
});

/**
 * OVERCLICKING PROTECTION SYSTEM
 * 
 * To add new functions with spam protection, use:
 * 
 * 1. findAndClickSafely(actionType, selector, callback, options) 
 *    - for clicking elements
 * 
 * 2. performSafeAction(actionType, actionFunction, description)
 *    - for any other actions
 * 
 * 3. clickManager.performSafeClick(actionType, element, callback, options)
 *    - direct access to click manager
 * 
 * Cooldown configuration:
 * - clickManager.setCooldown('actionType', milliseconds)
 * - clickManager.updateGlobalCooldown(seconds)
 * 
 * Action types:
 * - 'skipOpening' - skip opening
 * - 'nextEpisode' - go to next episode
 * - 'videoControl' - video control
 * - 'sidebarToggle' - toggle sidebar
 * - 'general' - general actions
 */

/**
 * Checks if video is in fullscreen mode
 * @returns {boolean} true if in fullscreen mode
 */
function isVideoInFullscreen() {
  const isFullscreen = !!(document.fullscreenElement || 
         document.mozFullScreenElement || 
         document.webkitFullscreenElement || 
         document.msFullscreenElement);
  
  // Also check VideoJS class for fullscreen mode
  const vjsPlayer = document.querySelector('.video-js');
  const hasFullscreenClass = vjsPlayer && vjsPlayer.classList.contains('vjs-fullscreen');
  
  const result = isFullscreen || hasFullscreenClass;
  console.log(`Fullscreen check: Native=${isFullscreen}, VideoJS=${hasFullscreenClass}, Final=${result}`);
  return result;
}

/**
 * Handles page loading and automatically starts video playback
 */
function handlePageLoad() {
  console.log('Page loaded, handling autoplay...');
  console.log('Current fullscreen state:', wasInFullscreen);
  
  // Check if tab is active
  if (!isTabActive) {
    console.log('Tab is not active, skipping autoplay on page load');
    return;
  }
  
  // Reset restoration attempt flag when loading a new page
  fullscreenRestoreAttempted = false;
  fullscreenRetryCount = 0;
  
  // Give the page time to initialize
  setTimeout(() => {
    // If no need to restore fullscreen, just start the video
    if (!wasInFullscreen) {
      console.log('No need to restore fullscreen, just starting playback');
      tryPlayVideo();
      return;
    }
    
    // If need to restore fullscreen
    console.log('Need to restore fullscreen, starting playback with fullscreen');
    tryPlayVideo(true);
    
    // Start additional attempts to restore fullscreen with interval
    const fullscreenInterval = setInterval(() => {
      // If tab became inactive, stop attempts
      if (!isTabActive) {
        console.log('Tab became inactive during fullscreen retry, clearing interval');
        clearInterval(fullscreenInterval);
        return;
      }
      
      fullscreenRetryCount++;
      
      // Check if fullscreen was already restored
      if (isVideoInFullscreen()) {
        console.log('Fullscreen successfully restored, clearing retry interval');
        clearInterval(fullscreenInterval);
        // Reset flag since fullscreen was successfully restored
        wasInFullscreen = false;
        localStorage.removeItem('jutsu_fullscreen_state');
        return;
      }
      
      // If exceeded number of attempts, stop
      if (fullscreenRetryCount >= 5) {
        console.log('Max fullscreen retry count reached, giving up');
        clearInterval(fullscreenInterval);
        // Reset flag since fullscreen couldn't be restored
        wasInFullscreen = false;
        localStorage.removeItem('jutsu_fullscreen_state');
        return;
      }
      
      console.log(`Retry #${fullscreenRetryCount} to restore fullscreen...`);
      forceFullscreen();
    }, 1500);
  }, 3000);
}

/**
 * Main page initialization function
 */
function initializePage() {
  console.log('Initializing page...');
  
  // Apply settings
  if (settings.fullscreenMode) {
    initFullscreenHandlers();
  }
  
  // Start DOM mutation observer to detect buttons
  startButtonObserver();
}

// DOM mutation observer for button detection
function startButtonObserver() {
  const observer = new MutationObserver(skipButton);
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  console.log('Button observer started');
}

// Сброс состояния менеджера кликов при переходе на новую страницу
window.addEventListener('beforeunload', () => {
  clickManager.reset();
});

// Сброс флагов при загрузке новой страницы
window.addEventListener('load', () => {
  clickManager.setNavigating(false);
});

// Handle page load for fullscreen mode restoration
window.addEventListener('load', () => {
  handlePageTransition('pageLoad');
});

// Alternative method for tracking page transitions
let lastUrl = location.href; 
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    console.log('URL changed to', url);
    setTimeout(() => handlePageTransition('urlChange'), 1500); // Small delay for complete player loading
  }
}).observe(document, {subtree: true, childList: true});

// Start initialization after DOM loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    // Check if tab is active and initialization has not been done yet
    if (isTabActive && !isInitialized) {
      initializePage();
      initialize();
    }
  });
} else {
  // Check if tab is active and initialization has not been done yet
  if (isTabActive && !isInitialized) {
    initializePage();
    initialize();
  }
}

/**
 * Message handler from popup
 */
browser.runtime.onMessage.addListener(handleMessage);

/**
 * Function for skipping opening and going to next episode
 */
function skipButton() {
  // Skip only if inside tab is active and we're not navigating
  if (!isTabActive || clickManager.isNavigating) {
    return;
  }
  
  // Check settings
  browser.storage.sync.get({
    skipOpening: true,
    autoNextEpisode: true
  }).then((settings) => {
    // Skip opening button
    if (settings.skipOpening) {
      const skipButton = document.querySelector('div.vjs-overlay.vjs-overlay-bottom-left.vjs-overlay-skip-intro.vjs-overlay-background');
      if (skipButton && isElementVisible(skipButton)) {
        handleSkipButtonAppearance(skipButton);
      }
    }
    
    // Auto next episode button
    if (settings.autoNextEpisode) {
      const nextEpisodeButton = document.querySelector('div.vjs-overlay.vjs-overlay-bottom-right.vjs-overlay-skip-intro.vjs-overlay-background');
      if (nextEpisodeButton && isElementVisible(nextEpisodeButton)) {
        // Mark as navigating to prevent multiple clicks
        clickManager.setNavigating(true);
        
        // Click the button
        clickManager.performSafeClick('nextEpisode', nextEpisodeButton, () => {
          console.log('Auto-clicking next episode button');
          
          // Save fullscreen state before navigation
          if (isVideoInFullscreen()) {
            wasInFullscreen = true;
            localStorage.setItem('jutsu_fullscreen_state', 'true');
          }
          
          // Handle page transition
          handlePageTransition('nextEpisode');
        });
      }
    }
  }).catch(error => {
    console.error('Error getting settings:', error);
  });
}

/**
 * Creates and applies styles for extended fullscreen mode
 * Raises player above all elements and stretches to full screen
 * @param {boolean} enable - true to activate, false to deactivate
 */
function applyCustomFullscreen(enable) {
  // Check if fullscreen feature is enabled
  if (!settings.fullscreenMode && enable) {
    console.log('Fullscreen mode disabled in settings');
    return;
  }
  
  // Check if tab is active
  if (!isTabActive) {
    console.log('Tab is not active, skipping custom fullscreen');
    return;
  }
  
  console.log(`${enable ? 'Enabling' : 'Disabling'} custom fullscreen mode`);
  
  // Find player container
  const playerContainer = document.querySelector('.video-js') || document.querySelector('#my-player');
  if (!playerContainer) {
    console.log('Player container not found');
    return;
  }
  
  // Find player parent element
  const playerParent = playerContainer.parentElement;
  if (!playerParent) {
    console.log('Player parent not found');
    return;
  }
  
  // Find video container
  const videoContainer = document.querySelector('.video_plate');
  
  if (enable) {
    // Save original styles for restoration
    if (!playerContainer.dataset.originalWidth) {
      playerContainer.dataset.originalWidth = playerContainer.style.width || '';
    }
    if (!playerContainer.dataset.originalHeight) {
      playerContainer.dataset.originalHeight = playerContainer.style.height || '';
    }
    if (!playerContainer.dataset.originalPosition) {
      playerContainer.dataset.originalPosition = playerContainer.style.position || '';
    }
    if (!playerContainer.dataset.originalZIndex) {
      playerContainer.dataset.originalZIndex = playerContainer.style.zIndex || '';
    }
    
    // Save original styles for video container
    if (videoContainer) {
      if (!videoContainer.dataset.originalWidth) {
        videoContainer.dataset.originalWidth = videoContainer.style.width || '';
      }
      if (!videoContainer.dataset.originalHeight) {
        videoContainer.dataset.originalHeight = videoContainer.style.height || '';
      }
      if (!videoContainer.dataset.originalPosition) {
        videoContainer.dataset.originalPosition = videoContainer.style.position || '';
      }
      if (!videoContainer.dataset.originalZIndex) {
        videoContainer.dataset.originalZIndex = videoContainer.style.zIndex || '';
      }
      if (!videoContainer.dataset.originalMargin) {
        videoContainer.dataset.originalMargin = videoContainer.style.margin || '';
      }
      if (!videoContainer.dataset.originalPadding) {
        videoContainer.dataset.originalPadding = videoContainer.style.padding || '';
      }
      if (!videoContainer.dataset.originalTop) {
        videoContainer.dataset.originalTop = videoContainer.style.top || '';
      }
      if (!videoContainer.dataset.originalLeft) {
        videoContainer.dataset.originalLeft = videoContainer.style.left || '';
      }
    }
    
    // Create styles for extended fullscreen mode
    const customFullscreenStyle = document.createElement('style');
    customFullscreenStyle.id = 'jutsu-custom-fullscreen-style';
    customFullscreenStyle.textContent = `
      .jutsu-custom-fullscreen {
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        max-width: 100vw !important;
        max-height: 100vh !important;
        z-index: 999999 !important;
        background: #000 !important;
        margin: 0 !important;
        padding: 0 !important;
        border: none !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
      }
      
      .jutsu-custom-fullscreen video {
        width: 100% !important;
        height: 100% !important;
        max-width: 100% !important;
        max-height: 100% !important;
        object-fit: contain !important;
      }
      
      .jutsu-custom-fullscreen .vjs-control-bar {
        z-index: 1000000 !important;
      }
      
      /* Styles for skip opening and next episode buttons */
      .vjs-overlay-skip-intro {
        z-index: 1000001 !important;
        position: fixed !important;
        visibility: visible !important;
        opacity: 1 !important;
        pointer-events: auto !important;
      }
      
      /* Style for skip opening button (usually bottom-left) */
      .vjs-overlay-bottom-left.vjs-overlay-skip-intro {
        bottom: 70px !important;
        left: 20px !important;
      }
      
      /* Style for next episode button (usually bottom-right) */
      .vjs-overlay-bottom-right.vjs-overlay-skip-intro {
        bottom: 70px !important;
        right: 20px !important;
      }
      
      body.jutsu-fullscreen-active {
        overflow: hidden !important;
      }
      
      /* Hide all notifications and elements with high z-index */
      body.jutsu-fullscreen-active .notice_top2,
      body.jutsu-fullscreen-active .notice_cont,
      body.jutsu-fullscreen-active .notice,
      body.jutsu-fullscreen-active [class*="notice"],
      body.jutsu-fullscreen-active [class*="popup"],
      body.jutsu-fullscreen-active [class*="modal"],
      body.jutsu-fullscreen-active [class*="overlay"]:not(.vjs-overlay-skip-intro) {
        display: none !important;
        z-index: -1 !important;
        opacity: 0 !important;
        visibility: hidden !important;
      }
    `;
    document.head.appendChild(customFullscreenStyle);
    
    // Add classes to activate fullscreen mode
    playerContainer.classList.add('jutsu-custom-fullscreen');
    document.body.classList.add('jutsu-fullscreen-active');
    
    // Hide site elements
    toggleSiteElements(true);
    
    console.log('Custom fullscreen mode enabled');
  } else {
    // Remove extended fullscreen mode styles
    const customFullscreenStyle = document.getElementById('jutsu-custom-fullscreen-style');
    if (customFullscreenStyle) {
      customFullscreenStyle.remove();
    }
    
    // Remove fullscreen classes
    playerContainer.classList.remove('jutsu-custom-fullscreen');
    document.body.classList.remove('jutsu-fullscreen-active');
    
    // Restore original player styles
    if (playerContainer.dataset.originalWidth) {
      playerContainer.style.width = playerContainer.dataset.originalWidth;
    }
    if (playerContainer.dataset.originalHeight) {
      playerContainer.style.height = playerContainer.dataset.originalHeight;
    }
    if (playerContainer.dataset.originalPosition) {
      playerContainer.style.position = playerContainer.dataset.originalPosition;
    }
    if (playerContainer.dataset.originalZIndex) {
      playerContainer.style.zIndex = playerContainer.dataset.originalZIndex;
    }
    
    // Restore original styles for video container
    if (videoContainer) {
      if (videoContainer.dataset.originalWidth) {
        videoContainer.style.width = videoContainer.dataset.originalWidth;
      } else {
        videoContainer.style.width = '';
      }
      
      if (videoContainer.dataset.originalHeight) {
        videoContainer.style.height = videoContainer.dataset.originalHeight;
      } else {
        videoContainer.style.height = '';
      }
      
      if (videoContainer.dataset.originalPosition) {
        videoContainer.style.position = videoContainer.dataset.originalPosition;
      } else {
        videoContainer.style.position = '';
      }
      
      if (videoContainer.dataset.originalZIndex) {
        videoContainer.style.zIndex = videoContainer.dataset.originalZIndex;
      } else {
        videoContainer.style.zIndex = '';
      }
      
      if (videoContainer.dataset.originalMargin) {
        videoContainer.style.margin = videoContainer.dataset.originalMargin;
      } else {
        videoContainer.style.margin = '';
      }
      
      if (videoContainer.dataset.originalPadding) {
        videoContainer.style.padding = videoContainer.dataset.originalPadding;
      } else {
        videoContainer.style.padding = '';
      }
      
      if (videoContainer.dataset.originalTop) {
        videoContainer.style.top = videoContainer.dataset.originalTop;
      } else {
        videoContainer.style.top = '';
      }
      
      if (videoContainer.dataset.originalLeft) {
        videoContainer.style.left = videoContainer.dataset.originalLeft;
      } else {
        videoContainer.style.left = '';
      }
    }
    
    // Show site elements
    toggleSiteElements(false);
    
    console.log('Custom fullscreen mode disabled');
  }
}

/**
 * Handle fullscreen state changes
 */
function handleFullscreenChange() {
  isFullscreen = !!document.fullscreenElement;
  console.log('Fullscreen state changed:', isFullscreen);
  
  // Apply custom fullscreen mode if native fullscreen is disabled
  if (!isFullscreen && settings.fullscreenMode) {
    console.log('Native fullscreen exited, applying custom fullscreen');
    applyCustomFullscreen(true);
  } else {
    // In native fullscreen mode, disable custom fullscreen
    applyCustomFullscreen(false);
  }
}

/**
 * Force fullscreen mode using all available methods
 */
function forceFullscreen() {
  console.log('Forcing fullscreen mode...');
  
  const vjsPlayer = document.querySelector('.video-js');
  if (!vjsPlayer) {
    console.log('VideoJS player not found for forced fullscreen');
    return;
  }
  
  // Hide site elements before entering fullscreen mode
  toggleSiteElements(true);
  
  // Method 1: Direct click on fullscreen button
  const fullscreenButton = vjsPlayer.querySelector('.vjs-fullscreen-control');
  if (fullscreenButton) {
    console.log('Forcing click on fullscreen button');
    
    // Show control elements
    vjsPlayer.classList.add('vjs-user-active');
    vjsPlayer.classList.remove('vjs-user-inactive');
    
    // Simulate mouse movement over player
    const moveEvent = new MouseEvent('mousemove', {
      view: window,
      bubbles: true,
      cancelable: true,
      clientX: vjsPlayer.offsetWidth / 2,
      clientY: vjsPlayer.offsetHeight / 2
    });
    vjsPlayer.dispatchEvent(moveEvent);
    
    // Simulate button click
    try {
      ['mouseover', 'mouseenter', 'mousedown', 'mouseup', 'click'].forEach(eventName => {
        const event = new MouseEvent(eventName, {
          view: window,
          bubbles: true,
          cancelable: true,
          buttons: 1
        });
        fullscreenButton.dispatchEvent(event);
      });
      console.log('Forced fullscreen button click completed');
    } catch (e) {
      console.error('Error forcing fullscreen button click:', e);
    }
  }
  
  // Method 2: VideoJS API
  try {
    if (typeof videojs !== 'undefined' && vjsPlayer.id) {
      const player = videojs(vjsPlayer.id);
      if (player) {
        console.log('Forcing fullscreen via VideoJS API');
        if (player.requestFullscreen) {
          player.requestFullscreen();
        } else if (player.enterFullScreen) {
          player.enterFullScreen();
        }
      }
    }
  } catch (e) {
    console.error('Error forcing fullscreen via VideoJS API:', e);
  }
  
  // Method 3: Native API for fullscreen mode
  try {
    console.log('Forcing fullscreen via native API');
    if (vjsPlayer.requestFullscreen) {
      vjsPlayer.requestFullscreen();
    } else if (vjsPlayer.mozRequestFullScreen) {
      vjsPlayer.mozRequestFullScreen();
    } else if (vjsPlayer.webkitRequestFullscreen) {
      vjsPlayer.webkitRequestFullscreen();
    } else if (vjsPlayer.msRequestFullscreen) {
      vjsPlayer.msRequestFullscreen();
    }
  } catch (e) {
    console.error('Error forcing fullscreen via native API:', e);
  }
  
  // Method 4: Programmatic addition of fullscreen class
  try {
    console.log('Adding fullscreen class programmatically');
    vjsPlayer.classList.add('vjs-fullscreen');
    document.body.classList.add('vjs-full-window');
  } catch (e) {
    console.error('Error adding fullscreen class:', e);
  }
}

/**
 * Function to click fullscreen button
 * @returns {boolean} true if button was clicked
 */
const clickFullscreenButton = () => {
  console.log('Attempting to click fullscreen button...');
  
  // Find player and fullscreen button
  const vjsPlayer = document.querySelector('.video-js');
  if (!vjsPlayer) {
    console.log('VideoJS player not found for fullscreen');
    // Use custom fullscreen as a fallback option
    applyCustomFullscreen(true);
    return false;
  }
  
  // First show control elements, simulating mouse movement over player
  console.log('Showing player controls by simulating mouse movement');
  
  try {
    // Add classes that show control elements
    vjsPlayer.classList.add('vjs-user-active');
    vjsPlayer.classList.remove('vjs-user-inactive');
    
    // Simulate mouse movement over player
    const moveEvent = new MouseEvent('mousemove', {
      view: window,
      bubbles: true,
      cancelable: true,
      clientX: vjsPlayer.offsetWidth / 2,
      clientY: vjsPlayer.offsetHeight / 2
    });
    vjsPlayer.dispatchEvent(moveEvent);
    
    console.log('Player controls should be visible now');
  } catch (e) {
    console.error('Error showing player controls:', e);
  }
  
  // Try multiple methods to click fullscreen button
  
  // Method 1: Direct search for fullscreen button
  const fullscreenButton = vjsPlayer.querySelector('.vjs-fullscreen-control');
  if (fullscreenButton) {
    console.log('Fullscreen button found, clicking it');
    
    // Simulate full click sequence
    try {
      ['mouseover', 'mouseenter', 'mousedown', 'mouseup', 'click'].forEach(eventName => {
        const event = new MouseEvent(eventName, {
          view: window,
          bubbles: true,
          cancelable: true,
          buttons: 1
        });
        fullscreenButton.dispatchEvent(event);
        console.log(`${eventName} event dispatched on fullscreen button`);
      });
      
      console.log('Fullscreen button clicked successfully');
      return true;
    } catch (e) {
      console.error('Error clicking fullscreen button:', e);
    }
  } else {
    console.log('Fullscreen button not found via direct selector');
  }
  
  // Method 2: Search via XPath
  try {
    const xpathExpressions = [
      '//button[@title="Полноэкранный режим"]',
      '//button[contains(@class, "vjs-fullscreen-control")]',
      '//div[contains(@class, "video-js")]//button[contains(@class, "vjs-fullscreen")]'
    ];
    
    let fsButton = null;
    for (const xpath of xpathExpressions) {
      const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      fsButton = result.singleNodeValue;
      if (fsButton) {
        console.log(`Fullscreen button found via XPath: ${xpath}`);
        break;
      }
    }
    
    if (fsButton) {
      console.log('Clicking fullscreen button found via XPath');
      ['mouseover', 'mouseenter', 'mousedown', 'mouseup', 'click'].forEach(eventName => {
        const event = new MouseEvent(eventName, {
          view: window,
          bubbles: true,
          cancelable: true,
          buttons: 1
        });
        fsButton.dispatchEvent(event);
      });
      return true;
    }
  } catch (e) {
    console.error('Error using XPath to find fullscreen button:', e);
  }
  
  // Method 3: Direct request for fullscreen mode for player element
  try {
    console.log('Requesting fullscreen directly for player element');
    vjsPlayer.requestFullscreen();
    return true;
  } catch (e) {
    console.error('Error requesting fullscreen directly:', e);
  }
  
  // If all methods fail, use custom fullscreen
  console.log('All native fullscreen methods failed, using custom fullscreen');
  applyCustomFullscreen(true);
  
  return false;
};

/**
 * Tries to start video playback using different methods
 * @param {boolean} restoreFullscreen - should we restore fullscreen after playback
 */
function tryPlayVideo(restoreFullscreen = false) {
  // Check if tab is active
  if (!isTabActive) {
    console.log('Tab is not active, skipping video playback');
    return;
  }
  
  console.log('Trying to play video, restore fullscreen:', restoreFullscreen);
  
  // Method 1: Using safe click on CSS selector
  findAndClickSafely('autoPlay', '.vjs-big-play-button', (button) => {
    console.log('Auto-clicking play button via CSS selector');
    
    // If need to restore fullscreen
    if (restoreFullscreen && !fullscreenRestoreAttempted && isTabActive) {
      fullscreenRestoreAttempted = true;
      
      // Small delay to allow video to start playing
      setTimeout(() => {
        // Check tab activity before entering fullscreen
        if (!isTabActive) {
          console.log('Tab became inactive during fullscreen restoration, aborting');
          return;
        }
        
        console.log('Immediate fullscreen activation after play button');
        if (!clickFullscreenButton()) {
          console.log('Failed to click fullscreen button, falling back to activateFullscreen');
          activateFullscreen();
        }
      }, 1000);
    }
  });
  
  // Method 2: Direct access to video element
  setTimeout(() => {
    // Check tab activity
    if (!isTabActive) {
      console.log('Tab became inactive during direct play attempt, aborting');
      return;
    }
    
    if (videoElement && !videoElement.playing) {
      console.log('Trying direct video play method');
      try {
        videoElement.play().then(() => {
          console.log('Video started playing via direct play method');
          
          // If need to restore fullscreen and not already attempted
          if (restoreFullscreen && !fullscreenRestoreAttempted && isTabActive) {
            fullscreenRestoreAttempted = true;
            setTimeout(() => {
              // Another check tab activity
              if (!isTabActive) {
                console.log('Tab became inactive during fullscreen restoration, aborting');
                return;
              }
              
              if (!document.fullscreenElement) {
                console.log('Activating fullscreen after direct play');
                activateFullscreen();
              }
            }, 1000);
          }
        }).catch(err => {
          console.error('Error playing video directly:', err);
        });
      } catch (e) {
        console.error('Exception playing video directly:', e);
      }
    }
  }, 1500);
  
  // Method 3: Search via XPath
  setTimeout(() => {
    // Check tab activity
    if (!isTabActive) {
      console.log('Tab became inactive during XPath play attempt, aborting');
      return;
    }
    
    // If first method failed, try XPath
    try {
      // If already attempted to restore fullscreen, don't do it again
      if (fullscreenRestoreAttempted && restoreFullscreen) {
        console.log('Fullscreen restore already attempted, skipping XPath method');
        return;
      }
      
      console.log('Trying to find play button via XPath...');
      
      // XPath for play button
      const xpathExpressions = [
        // Main XPath from example
        '/html/body/div[5]/div/div/div/div[4]/div[1]/div[1]/div[2]/div[2]/div[1]/button',
        // More flexible XPath for finding large play button
        '//div[contains(@class, "video-js")]//button[contains(@class, "vjs-big-play-button")]',
        // Alternative XPath for finding by title attribute
        '//button[@title="Воспроизвести видео"]',
        // Search by class inside video-js
        '//div[@class="video-js"]//button[@class="vjs-big-play-button"]'
      ];
      
      // Try different XPath expressions
      let playButton = null;
      for (const xpath of xpathExpressions) {
        const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        playButton = result.singleNodeValue;
        if (playButton) {
          console.log(`Play button found via XPath: ${xpath}`);
          break;
        }
      }
      
      if (playButton) {
        console.log('Found play button via XPath, clicking it');
        performSafeAction('xpathPlay', () => {
          // Check tab activity
          if (!isTabActive) {
            console.log('Tab became inactive before XPath click, aborting');
            return false;
          }
          
          // Simulate full click sequence
          const simulateMouseEvent = (element, eventName) => {
            const event = new MouseEvent(eventName, {
              view: window,
              bubbles: true,
              cancelable: true,
              buttons: 1
            });
            element.dispatchEvent(event);
          };
          
          simulateMouseEvent(playButton, 'mouseover');
          simulateMouseEvent(playButton, 'mousedown');
          simulateMouseEvent(playButton, 'mouseup');
          playButton.click();
          
          // If was in fullscreen mode and not already attempted to restore
          if (restoreFullscreen && !fullscreenRestoreAttempted && isTabActive) {
            fullscreenRestoreAttempted = true;
            
            // Immediately try to click fullscreen button
            setTimeout(() => {
              // Another check tab activity
              if (!isTabActive) {
                console.log('Tab became inactive during fullscreen restoration, aborting');
                return;
              }
              
              console.log('Immediate fullscreen activation after XPath play');
              if (!clickFullscreenButton()) {
                activateFullscreen();
              }
            }, 1000);
          }
          
          return true;
        }, 'Clicked play button via XPath');
      } else {
        console.log('Play button not found via any XPath expressions');
      }
    } catch (e) {
      console.error('Error using XPath to find play button:', e);
    }
  }, 2000);
  
  // Method 4: Direct access to VideoJS API
  setTimeout(() => {
    // Check tab activity
    if (!isTabActive) {
      console.log('Tab became inactive during VideoJS API attempt, aborting');
      return;
    }
    
    try {
      // If already attempted to restore fullscreen, don't do it again
      if (fullscreenRestoreAttempted && restoreFullscreen) {
        console.log('Fullscreen restore already attempted, skipping VideoJS API method');
        return;
      }
      
      const vjsPlayer = document.querySelector('.video-js');
      if (vjsPlayer && vjsPlayer.id && typeof videojs !== 'undefined') {
        console.log('Trying direct VideoJS API access...');
        const player = videojs(vjsPlayer.id);
        if (player) {
          console.log('VideoJS API found, playing video...');
          player.play();
          
          // After starting playback, activate fullscreen
          if (restoreFullscreen && !fullscreenRestoreAttempted && isTabActive) {
            fullscreenRestoreAttempted = true;
            
            // Immediate fullscreen activation via API
            setTimeout(() => {
              // Another check tab activity
              if (!isTabActive) {
                console.log('Tab became inactive during fullscreen restoration, aborting');
                return;
              }
              
              console.log('Immediate fullscreen activation via API');
              if (player.requestFullscreen) {
                player.requestFullscreen();
              } else if (player.enterFullScreen) {
                player.enterFullScreen();
              } else {
                clickFullscreenButton();
              }
            }, 1000);
          }
        }
      }
    } catch (e) {
      console.error('Error using VideoJS API:', e);
    }
  }, 3000);
}

/**
 * Handles page transition
 * @param {string} actionType - type of action causing transition (for logging)
 */
function handlePageTransition(actionType = '') {
  // Check if tab is active
  if (!isTabActive) {
    console.log('Tab is not active, skipping page transition handling');
    return;
  }
  
  // If don't need to save fullscreen mode, just exit
  if (!settings.fullscreenMode) {
    console.log('Fullscreen preservation disabled in settings, not saving state');
    return;
  }
  
  // If already in transition process, don't save state again
  if (isTransitioning) {
    return;
  }
  
  // Set transition flag
  isTransitioning = true;
  
  // Save fullscreen mode state before transition
  const isFullscreen = isVideoInFullscreen();
  wasInFullscreen = isFullscreen;
  
  // Save state to localStorage for restoration after page reload
  try {
    if (isFullscreen) {
      localStorage.setItem('jutsu_fullscreen_state', 'true');
      console.log('Saved fullscreen state to localStorage: TRUE');
    } else {
      localStorage.removeItem('jutsu_fullscreen_state');
    }
  } catch (e) {
    console.error('Error saving to localStorage:', e);
  }
  
  if (isFullscreen) {
    console.log(`Fullscreen state saved before navigation (${actionType}): TRUE`);
  } else {
    console.log(`Fullscreen state NOT saved before navigation (${actionType}): FALSE`);
  }
  
  // Reset flags
  fullscreenRestoreAttempted = false;
  fullscreenRetryCount = 0;
  
  // Reset transition flag after some time
  setTimeout(() => {
    isTransitioning = false;
  }, 2000);
  
  // If transition happened, start page load handler
  setTimeout(() => {
    handlePageLoad();
  }, 1000);
}

/**
 * Sets video playback speed with spam protection
 * @param {string} speed - Playback speed value
 */
function setVideoSpeed(speed) {
  const video = document.querySelector('video');
  if (video) {
    const numericSpeed = parseFloat(speed);
    video.playbackRate = numericSpeed;
    console.log(`Video speed set to ${speed}x`);
    
    // For high speeds, we need special handling
    if (numericSpeed >= 5) {
      console.log(`High speed detected (${numericSpeed}x), enabling special handling`);
      
      // Check for next episode button more aggressively at high speeds
      const checkHighSpeedNextButton = () => {
        // Проверяем оба возможных селектора кнопки следующей серии
        const nextButton = document.querySelector('.vjs-next-button') || 
                          document.querySelector('div.vjs-overlay.vjs-overlay-bottom-right.vjs-overlay-skip-intro.vjs-overlay-background');
        
        if (nextButton && isElementVisible(nextButton) && !nextEpisodeClicked && settings.autoNextEpisode) {
          console.log(`High speed: Next episode button found at ${numericSpeed}x speed`);
          checkForNextEpisodeButton();
        }
      };
      
      // Set up periodic checks for the next episode button
      const highSpeedInterval = setInterval(() => {
        // Only continue if video is still playing at high speed
        if (video.playbackRate < 5 || !isTabActive || document.hidden) {
          console.log('High speed monitoring stopped');
          clearInterval(highSpeedInterval);
          return;
        }
        
        checkHighSpeedNextButton();
      }, 500); // Check every 500ms for high speeds
      
      // Clear interval when speed changes
      const originalPlaybackRate = video.playbackRate;
      const rateChangeHandler = () => {
        if (video.playbackRate !== originalPlaybackRate) {
          console.log('Playback rate changed, clearing high speed monitoring');
          clearInterval(highSpeedInterval);
          video.removeEventListener('ratechange', rateChangeHandler);
        }
      };
      
      video.addEventListener('ratechange', rateChangeHandler);
    }
  }
}

/**
 * Applies saved settings when page loads
 */
function applySettings() {
  browser.storage.sync.get({
      skipOpening: true,
      autoNextEpisode: true,
      fullscreenMode: true,
      videoSpeed: '1',
      clickDelay: '3'
  }).then((settings) => {
      if (settings.fullscreenMode) {
          initFullscreenHandlers();
      }
      if (settings.videoSpeed !== '1') {
          setVideoSpeed(settings.videoSpeed);
      }
      // Update click delay in click manager
      clickManager.updateGlobalCooldown(parseInt(settings.clickDelay));
  });
}

/**
 * Universal click manager with spam protection
 */
class ClickManager {
    constructor() {
        this.clickTimes = new Map(); // Stores time of last clicks by action type
        this.blockedActions = new Set(); // Blocked actions
        this.defaultCooldown = 3000; // Default 3 seconds
        this.isNavigating = false;
        this.cooldowns = {
            skipOpening: 3000,
            nextEpisode: 3000,
            videoControl: 1000,
            sidebarToggle: 2000,
            general: 1000
        };
    }

    /**
     * Sets cooldown for specific action type
     * @param {string} actionType - Action type
     * @param {number} cooldown - Cooldown in milliseconds
     */
    setCooldown(actionType, cooldown) {
        this.cooldowns[actionType] = cooldown;
    }

    /**
     * Updates global cooldown for all actions
     * @param {number} seconds - Cooldown in seconds
     */
    updateGlobalCooldown(seconds) {
        const cooldown = seconds * 1000;
        this.cooldowns.skipOpening = cooldown;
        this.cooldowns.nextEpisode = cooldown;
        this.defaultCooldown = cooldown;
    }

    /**
     * Checks if action can be performed
     * @param {string} actionType - Action type
     * @returns {boolean} true if action can be performed
     */
    canPerformAction(actionType) {
        if (this.isNavigating && (actionType === 'nextEpisode' || actionType === 'skipOpening')) {
            return false;
        }

        if (this.blockedActions.has(actionType)) {
            return false;
        }

        const currentTime = Date.now();
        const lastClickTime = this.clickTimes.get(actionType) || 0;
        const cooldown = this.cooldowns[actionType] || this.defaultCooldown;

        return (currentTime - lastClickTime) > cooldown;
    }

    /**
     * Performs safe click
     * @param {string} actionType - Action type
     * @param {Element} element - Element to click
     * @param {Function} callback - Callback after click (optional)
     * @param {Object} options - Additional options
     * @returns {boolean} true if click was performed
     */
    performSafeClick(actionType, element, callback = null, options = {}) {
        if (!element || !isElementVisible(element)) {
            return false;
        }

        if (!this.canPerformAction(actionType)) {
            return false;
        }

        // Record click time
        this.clickTimes.set(actionType, Date.now());

        // Perform click
        try {
            element.click();
            console.log(`Safe click performed: ${actionType}`);

            // Remove element if specified
            if (options.removeAfterClick) {
                element.remove();
            }

            // Block action if specified
            if (options.blockAfterClick) {
                this.blockAction(actionType, options.blockDuration || 5000);
            }

            // Set navigation flag for transitions
            if (actionType === 'nextEpisode') {
                this.setNavigating(true, 5000);
            }

            // Perform callback
            if (callback && typeof callback === 'function') {
                callback();
            }

            return true;
        } catch (error) {
            console.error(`Error performing click for ${actionType}:`, error);
            return false;
        }
    }

    /**
     * Blocks action for specified time
     * @param {string} actionType - Action type
     * @param {number} duration - Duration of blocking in milliseconds
     */
    blockAction(actionType, duration = 5000) {
        this.blockedActions.add(actionType);
        setTimeout(() => {
            this.blockedActions.delete(actionType);
        }, duration);
    }

    /**
     * Sets navigation state
     * @param {boolean} navigating - Navigation flag
     * @param {number} duration - Duration in milliseconds
     */
    setNavigating(navigating, duration = 5000) {
        this.isNavigating = navigating;
        if (navigating && duration > 0) {
            setTimeout(() => {
                this.isNavigating = false;
            }, duration);
        }
    }

    /**
     * Resets all states
     */
    reset() {
        this.clickTimes.clear();
        this.blockedActions.clear();
        this.isNavigating = false;
    }
}

// Create global click manager instance
const clickManager = new ClickManager();

/**
 * Universal function for safe search and click on elements
 * @param {string} actionType - Action type for logging and cooldown
 * @param {string} selector - CSS selector of element
 * @param {Function} callback - Callback after successful click
 * @param {Object} options - Additional options
 * @returns {boolean} true if click was performed
 */
function findAndClickSafely(actionType, selector, callback = null, options = {}) {
    const element = document.querySelector(selector);
    return clickManager.performSafeClick(actionType, element, callback, options);
}

/**
 * Universal function for safe execution of actions on elements
 * @param {string} actionType - Action type
 * @param {Function} actionFunction - Function to execute
 * @param {string} description - Description of action for logging
 * @returns {boolean} true if action was performed
 */
function performSafeAction(actionType, actionFunction, description = '') {
    if (!clickManager.canPerformAction(actionType)) {
        console.log(`${description} blocked due to cooldown`);
        return false;
    }

    try {
        clickManager.clickTimes.set(actionType, Date.now());
        const result = actionFunction();
        console.log(`${description} performed successfully`);
        return result !== false;
    } catch (error) {
        console.error(`Error performing ${description}:`, error);
        return false;
    }
}

/**
 * Activates fullscreen mode for video player
 */
function activateFullscreen() {
  console.log('Attempting to restore fullscreen mode...');
  
  // Check if we need to restore
  if (!wasInFullscreen) {
    console.log('No need to restore fullscreen - was not in fullscreen before');
    return false;
  }
  
  console.log('RESTORING FULLSCREEN - was in fullscreen before!');
  
  // Reset flag since we're already trying to restore
  wasInFullscreen = false;
  
  // Video player fullscreen function with multiple methods
  const activateVideoAndFullscreen = function() {
    console.log('Looking for VideoJS player...');
    
    // Find VideoJS player
    const vjsPlayer = document.querySelector('.video-js');
    if (!vjsPlayer) {
      console.log('VideoJS player not found, retrying in 2s...');
      setTimeout(activateVideoAndFullscreen, 2000);
      return;
    }
    
    console.log('VideoJS player found!', vjsPlayer);
    
    // Hide site elements before entering fullscreen mode
    toggleSiteElements(true);
    
    // METHOD 1: Direct access to VideoJS API
    if (typeof videojs !== 'undefined' && vjsPlayer.id) {
      try {
        console.log('Trying direct VideoJS API access for fullscreen...');
        const player = videojs(vjsPlayer.id);
        if (player) {
          console.log('VideoJS API found, setting fullscreen...');
          
          // Activate fullscreen via API
          if (player.requestFullscreen) {
            player.requestFullscreen();
            console.log('Fullscreen requested via VideoJS API');
            return;
          } else if (player.enterFullScreen) {
            console.log('Using enterFullScreen method');
            player.enterFullScreen();
            return;
          } else {
            console.log('VideoJS fullscreen methods not available, trying other methods...');
          }
        }
      } catch (e) {
        console.error('Error using VideoJS API:', e);
      }
    }
    
    // METHOD 2: Fullscreen button
    const fullscreenButton = vjsPlayer.querySelector('.vjs-fullscreen-control');
    if (fullscreenButton) {
      console.log('Fullscreen button found, simulating click...');
      
      // Function to simulate full click sequence
      function fullClickSequence(element) {
        if (!element) return false;
        
        console.log('Performing full click sequence on fullscreen button');
        
        try {
          // Create and dispatch mouse events
          ['mouseover', 'mouseenter', 'mousedown', 'mouseup', 'click'].forEach(eventName => {
            const event = new MouseEvent(eventName, {
              view: window,
              bubbles: true,
              cancelable: true,
              buttons: 1
            });
            element.dispatchEvent(event);
            console.log(`${eventName} event dispatched on fullscreen button`);
          });
          
          return true;
        } catch (e) {
          console.error('Error in fullscreen click sequence:', e);
          return false;
        }
      }
      
      fullClickSequence(fullscreenButton);
      return;
    } else {
      console.log('Fullscreen button not found!');
    }
    
    // METHOD 3: Native API fullscreen mode
    console.log('Using native fullscreen API...');
    try {
      if (vjsPlayer.requestFullscreen) {
        console.log('Using standard requestFullscreen');
        vjsPlayer.requestFullscreen();
      } else if (vjsPlayer.mozRequestFullScreen) {
        console.log('Using Mozilla mozRequestFullScreen');
        vjsPlayer.mozRequestFullScreen();
      } else if (vjsPlayer.webkitRequestFullscreen) {
        console.log('Using WebKit webkitRequestFullscreen');
        vjsPlayer.webkitRequestFullscreen();
      } else if (vjsPlayer.msRequestFullscreen) {
        console.log('Using MS msRequestFullscreen');
        vjsPlayer.msRequestFullscreen();
      } else {
        console.error('No fullscreen method available!');
      }
    } catch (e) {
      console.error('Error using native fullscreen API:', e);
    }
  };

  // Start with delay to allow page to fully load
  setTimeout(activateVideoAndFullscreen, 1000);
  return true;
}

/**
 * Initializes fullscreen event handlers
 */
function initFullscreenHandlers() {
  console.log('Initializing fullscreen handlers');
  document.addEventListener('fullscreenchange', handleFullscreenChange);
  document.addEventListener('mozfullscreenchange', handleFullscreenChange);
  document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
  document.addEventListener('MSFullscreenChange', handleFullscreenChange);
}

/**
 * Removes fullscreen event handlers
 */
function removeFullscreenHandlers() {
  console.log('Removing fullscreen handlers');
  document.removeEventListener('fullscreenchange', handleFullscreenChange);
  document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
  document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
  document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
  
  // Restore site elements visibility
  toggleSiteElements(false);
}

/**
 * Initialize the extension
 */
function initialize() {
  console.log('Jut.su NonStop: Initializing...');
  
  // Mark initialization as done
  isInitialized = true;
  
  // Load settings from storage
  loadSettings().then(() => {
    // Set up event listeners
    setupEventListeners();
    
    // Set up mutation observer to detect DOM changes
    setupMutationObserver();
    
    // Apply custom fullscreen if enabled and tab is active
    if (settings.fullscreenMode && isTabActive) {
      setTimeout(() => {
        applyCustomFullscreen(true);
      }, 2000); // Delay for full player load
    }
    
    console.log('Jut.su NonStop: Initialization complete');
  });
}

/**
 * Load settings from browser storage
 * @returns {Promise} Promise that resolves when settings are loaded
 */
function loadSettings() {
  console.log('Loading settings from storage...');
  
  return new Promise((resolve) => {
    browser.storage.sync.get(settings).then((loadedSettings) => {
      settings = loadedSettings;
      console.log('Settings loaded:', settings);
      resolve();
    }).catch(error => {
      console.error('Error loading settings:', error);
      resolve();
    });
  });
}

/**
 * Set up event listeners for various page elements and browser messages
 */
function setupEventListeners() {
  console.log('Setting up event listeners...');
  
  // Listen for messages from popup
  browser.runtime.onMessage.addListener(handleMessage);
  
  // Listen for fullscreen changes
  document.addEventListener('fullscreenchange', handleFullscreenChange);
  
  // Wait for page to be fully loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onDOMContentLoaded);
  } else {
    onDOMContentLoaded();
  }
}

/**
 * Handle messages from the popup
 * @param {Object} message - Message object from popup
 */
function handleMessage(message) {
  console.log('Received message:', message);
  
  switch (message.action) {
    case 'updateSettings':
      // Update settings
      Object.assign(settings, message.settings);
      console.log('Settings updated:', settings);
      
      // Apply new settings
      if ('fullscreenMode' in message.settings) {
        if (message.settings.fullscreenMode) {
          // If fullscreen mode is enabled, apply it
          initFullscreenHandlers();
          
          // Apply fullscreen mode only if tab is active
          if (isTabActive) {
            console.log('Applying fullscreen mode after settings change');
            applyCustomFullscreen(true);
          }
        } else {
          // If fullscreen mode is disabled, remove it
          removeFullscreenHandlers();
          
          // Force disable fullscreen mode and restore original state
          console.log('Disabling fullscreen mode after settings change');
          
          // Exit native fullscreen mode
          if (document.fullscreenElement) {
            console.log('Exiting native fullscreen');
            document.exitFullscreen().catch(err => {
              console.error('Error exiting fullscreen:', err);
            });
          }
          
          // Disable custom fullscreen mode
          applyCustomFullscreen(false);
          
          // Reset flag to not restore fullscreen during navigation
          wasInFullscreen = false;
          localStorage.removeItem('jutsu_fullscreen_state');
        }
      }
      break;
    case 'changeSpeed':
      setVideoSpeed(message.speed);
      break;
    case 'updateDelay':
      settings.clickDelay = message.delay;
      clickManager.updateGlobalCooldown(parseInt(message.delay));
      console.log("Updated click delay to", parseInt(message.delay), "seconds");
      break;
    default:
      console.log('Unknown message action:', message.action);
  }
}

/**
 * Handle video playing event
 * This is called when the video starts playing
 */
function onVideoPlaying() {
  console.log('Video started playing');
  
  // Check if tab is active
  if (!isTabActive) {
    console.log('Tab is not active, skipping fullscreen actions');
    return;
  }
  
  // Reset flags
  skipButtonClicked = false;
  nextEpisodeClicked = false;
  
  // If fullscreen mode is enabled in settings
  if (settings.fullscreenMode && !document.fullscreenElement) {
    console.log('Fullscreen mode enabled in settings');
    
    // First try native fullscreen mode
    if (videoElement) {
      try {
        videoElement.requestFullscreen().catch(err => {
          console.error('Error attempting to enable native fullscreen:', err);
          // If native fullscreen failed, use custom fullscreen
          console.log('Falling back to custom fullscreen');
          applyCustomFullscreen(true);
        });
      } catch (e) {
        console.error('Exception in requestFullscreen:', e);
        // If error occurred, use custom fullscreen
        console.log('Falling back to custom fullscreen after exception');
        applyCustomFullscreen(true);
      }
    } else {
      // If video element not found, use custom fullscreen
      console.log('Video element not found, using custom fullscreen');
      applyCustomFullscreen(true);
    }
  }
}

/**
 * Check if we need to restore fullscreen state
 * This is called during initialization
 */
function checkFullscreenRestore() {
  console.log('Checking if fullscreen needs to be enabled based on settings');
  
  // Determine if we need to enter fullscreen based on settings
  if (settings.fullscreenMode) {
    console.log('Auto fullscreen enabled in settings');
    // Start playback with fullscreen mode
    setTimeout(() => {
      tryPlayVideo(true);
    }, 1500);
  } else {
    console.log('Auto fullscreen disabled in settings');
    // Just start playback without fullscreen
    setTimeout(() => {
      tryPlayVideo(false);
    }, 1500);
  }
}

/**
 * Check for skip opening button and click it if found
 */
function checkForSkipButton() {
  if (!settings.skipOpening || skipButtonClicked) {
    return;
  }
  
  // Проверяем оба возможных селектора кнопки пропуска опенинга
  let skipButton = document.querySelector('.vjs-skip-opening');
  
  // Если не нашли по первому селектору, пробуем второй
  if (!skipButton) {
    skipButton = document.querySelector('div.vjs-overlay.vjs-overlay-bottom-left.vjs-overlay-skip-intro.vjs-overlay-background');
  }
  
  if (skipButton && isElementVisible(skipButton)) {
    console.log('Skip opening button found, clicking it');
    skipButtonClicked = true;
    skipButton.click();
  }
}

/**
 * Check for next episode button and click it if found
 */
function checkForNextEpisodeButton() {
  if (!settings.autoNextEpisode || nextEpisodeClicked) {
    return;
  }
  
  // Проверяем оба возможных селектора кнопки следующей серии
  let nextButton = document.querySelector('.vjs-next-button');
  
  // Если не нашли по первому селектору, пробуем второй
  if (!nextButton) {
    nextButton = document.querySelector('div.vjs-overlay.vjs-overlay-bottom-right.vjs-overlay-skip-intro.vjs-overlay-background');
  }
  
  if (nextButton && isElementVisible(nextButton)) {
    console.log(`Next episode button found, clicking in ${settings.clickDelay} seconds`);
    nextEpisodeClicked = true;
    
    // Adjust delay based on video speed for faster transitions at high speeds
    let adjustedDelay = parseInt(settings.clickDelay) * 1000;
    
    // If video speed is high (5x or 10x), use shorter delay
    const videoSpeed = parseFloat(settings.videoSpeed);
    if (videoSpeed >= 5) {
      // For high speeds, use much shorter delay
      adjustedDelay = Math.max(500, adjustedDelay / videoSpeed);
      console.log(`Using adjusted delay for high speed (${videoSpeed}x): ${adjustedDelay}ms`);
    }
    
    // Click after specified delay
    setTimeout(() => {
      console.log('Auto-clicking next episode button');
      nextButton.click();
      
      // If click didn't work, try direct navigation
      setTimeout(() => {
        // Check if we're still on the same page
        const stillHasButton = document.querySelector('.vjs-next-button') || 
                               document.querySelector('div.vjs-overlay.vjs-overlay-bottom-right.vjs-overlay-skip-intro.vjs-overlay-background');
        if (stillHasButton && nextEpisodeClicked) {
          console.log('Next episode click may have failed, trying direct navigation');
          
          // Try to find the next episode link
          const nextEpisodeLink = document.querySelector('a.short-btn.green.video-page-next');
          if (nextEpisodeLink && nextEpisodeLink.href) {
            console.log('Found next episode link, navigating to:', nextEpisodeLink.href);
            window.location.href = nextEpisodeLink.href;
          }
        }
      }, 1000);
    }, adjustedDelay);
  }
}

/**
 * Change video playback speed
 * @param {string} speed - Playback speed value
 */
function changeVideoSpeed(speed) {
  console.log(`Changing video speed to ${speed}`);
  
  const video = document.querySelector('video');
  if (video) {
    const numericSpeed = parseFloat(speed);
    video.playbackRate = numericSpeed;
    
    // Update settings to remember this speed
    settings.videoSpeed = speed;
    
    // For high speeds, we need special handling
    if (numericSpeed >= 5) {
      console.log(`High speed detected (${numericSpeed}x), enabling special handling`);
      
      // Check for next episode button more aggressively at high speeds
      const checkHighSpeedNextButton = () => {
        // Проверяем оба возможных селектора кнопки следующей серии
        const nextButton = document.querySelector('.vjs-next-button') || 
                          document.querySelector('div.vjs-overlay.vjs-overlay-bottom-right.vjs-overlay-skip-intro.vjs-overlay-background');
        
        if (nextButton && isElementVisible(nextButton) && !nextEpisodeClicked && settings.autoNextEpisode) {
          console.log(`High speed: Next episode button found at ${numericSpeed}x speed`);
          checkForNextEpisodeButton();
        }
      };
      
      // Check immediately
      checkHighSpeedNextButton();
      
      // And set up periodic checks
      const highSpeedInterval = setInterval(() => {
        // Only continue if video is still playing at high speed
        if (video.playbackRate < 5 || !isTabActive || document.hidden) {
          console.log('High speed monitoring stopped');
          clearInterval(highSpeedInterval);
          return;
        }
        
        checkHighSpeedNextButton();
      }, 500); // Check every 500ms for high speeds
      
      // Clear interval when speed changes
      const originalPlaybackRate = video.playbackRate;
      const rateChangeHandler = () => {
        if (video.playbackRate !== originalPlaybackRate) {
          console.log('Playback rate changed, clearing high speed monitoring');
          clearInterval(highSpeedInterval);
          video.removeEventListener('ratechange', rateChangeHandler);
        }
      };
      
      video.addEventListener('ratechange', rateChangeHandler);
    }
  } else {
    console.log('Video element not found');
  }
}

/**
 * Actions to perform when DOM is fully loaded
 */
function onDOMContentLoaded() {
  console.log('DOM fully loaded');
  
  // Find video element
  videoElement = document.querySelector('video');
  
  if (videoElement) {
    console.log('Video element found');
    
    // Set video speed if specified
    if (settings.videoSpeed !== '1') {
      changeVideoSpeed(settings.videoSpeed);
    }
    
    // Listen for video playing event to handle auto-skip and fullscreen restoration
    videoElement.addEventListener('playing', onVideoPlaying);
    
    // Automatically start playback only if tab is active
    if (isTabActive) {
      checkFullscreenRestore();
    }
  } else {
    console.log('Video element not found on page load');
  }
}

/**
 * Handle appearance of skip opening and next episode buttons
 * @param {Element} button - Button to process
 */
function handleSkipButtonAppearance(button) {
  if (!button || !isElementVisible(button)) return;
  
  console.log('Skip button appeared, ensuring it is visible in fullscreen mode');
  
  // Check if we are in fullscreen mode
  const isFullscreen = isVideoInFullscreen() || document.body.classList.contains('jutsu-fullscreen-active');
  
  if (isFullscreen) {
    // Save original styles
    if (!button.dataset.originalZIndex) {
      button.dataset.originalZIndex = button.style.zIndex || '';
    }
    if (!button.dataset.originalPosition) {
      button.dataset.originalPosition = button.style.position || '';
    }
    
    // Raise button above player
    button.style.zIndex = '1000001';
    button.style.position = 'fixed';
    
    // Set position depending on button class
    if (button.classList.contains('vjs-overlay-bottom-left')) {
      // Skip opening button
      button.style.bottom = '70px';
      button.style.left = '20px';
    } else if (button.classList.contains('vjs-overlay-bottom-right')) {
      // Next episode button
      button.style.bottom = '70px';
      button.style.right = '20px';
    }
    
    // Ensure visibility
    button.style.visibility = 'visible';
    button.style.opacity = '1';
    button.style.pointerEvents = 'auto';
  }
}

/**
 * Set up mutation observer to detect DOM changes
 * This helps us identify when skip buttons or next episode buttons appear
 */
function setupMutationObserver() {
  console.log('Setting up mutation observer');
  
  // Create a new observer
  observer = new MutationObserver(mutations => {
    mutations.forEach(mutation => {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        // Check added nodes for skip buttons
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if added node is a skip button
            if (node.classList && node.classList.contains('vjs-overlay-skip-intro')) {
              handleSkipButtonAppearance(node);
            }
            
            // Check if added node contains skip buttons
            const skipButtons = node.querySelectorAll('.vjs-overlay-skip-intro');
            skipButtons.forEach(button => handleSkipButtonAppearance(button));
          }
        });
        
        // Check for skip opening button
        checkForSkipButton();
        
        // Check for next episode button
        checkForNextEpisodeButton();
      }
    });
  });
  
  // Start observing the document body for changes
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

/**
 * Tab activity event handlers
 */
document.addEventListener('visibilitychange', handleVisibilityChange);

/**
 * Handle tab visibility change
 */
function handleVisibilityChange() {
  const wasActive = isTabActive;
  isTabActive = document.visibilityState === 'visible';
  console.log('Tab visibility changed:', isTabActive ? 'active' : 'inactive');
  
  // If tab became inactive
  if (!isTabActive && wasActive) {
    console.log('Tab became inactive, pausing video and disabling fullscreen');
    
    // Pause video playback
    if (videoElement && !videoElement.paused) {
      videoElement.pause();
      console.log('Video paused due to tab becoming inactive');
    }
    
    // Disable fullscreen mode
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(err => {
        console.error('Error exiting fullscreen:', err);
      });
    }
    
    // Disable custom fullscreen mode
    applyCustomFullscreen(false);
  }
  // If tab became active and extension is already initialized
  else if (isTabActive && !wasActive && isInitialized) {
    console.log('Tab became active, checking state');
    
    // If player exists and need to restore fullscreen
    if (settings.fullscreenMode && wasInFullscreen) {
      console.log('Restoring fullscreen on tab activation');
      
      // Start playback and restore fullscreen
      setTimeout(() => {
        if (videoElement) {
          videoElement.play().catch(err => {
            console.error('Error playing video on tab activation:', err);
          });
        }
        
        // Apply custom fullscreen
        applyCustomFullscreen(true);
      }, 500);
    }
    // If extension is not initialized yet, initialize it
    else if (!isInitialized) {
      console.log('Initializing extension on tab activation');
      initializePage();
      initialize();
    }
  }
}

// Initialize the extension
initialize();