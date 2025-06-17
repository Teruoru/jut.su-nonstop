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
 * Проверяет видимость элемента на странице
 * @param {Element} element - DOM элемент для проверки
 * @returns {boolean} true если элемент видим
 */
function isElementVisible(element) {
  if (!element) return false;
  
  // Проверка на null и наличие в DOM
  if (element.offsetParent === null) {
    // Проверяем стили элемента для особых случаев (fixed position и т.д.)
    const style = window.getComputedStyle(element);
    
    // Если элемент имеет position: fixed, он может быть видимым даже с offsetParent === null
    if (style.position === 'fixed') {
      // Проверяем, не скрыт ли элемент другими способами
      return style.display !== 'none' && 
             style.visibility !== 'hidden' && 
             style.opacity !== '0' &&
             parseInt(style.zIndex, 10) >= 0;
    }
    
    // В обычном случае, если offsetParent === null, элемент невидим
    return false;
  }
  
  // Проверяем стили элемента
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || 
      style.visibility === 'hidden' || 
      style.opacity === '0') {
    return false;
  }
  
  // Проверяем размеры элемента
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return false;
  }
  
  // Проверяем, находится ли элемент в области видимости окна
  // Это необязательная проверка, так как элемент может быть за пределами экрана, но все равно считаться видимым
  // Раскомментируйте при необходимости
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
 * Настройки по умолчанию
 */
let settings = {
  skipOpening: true,
  autoNextEpisode: true,
  fullscreenMode: true,
  videoSpeed: '1',
  clickDelay: '3'
};

/**
 * Глобальные переменные для сохранения состояния полноэкранного режима
 * Используем localStorage для сохранения состояния между перезагрузками страницы
 */
let wasInFullscreen = false;
let fullscreenRestoreAttempted = false; // Флаг для отслеживания попыток восстановления
let isTransitioning = false; // Флаг для отслеживания процесса перехода между страницами
let fullscreenRetryCount = 0; // Счетчик попыток восстановления полноэкрана
let videoElement = null;      // Reference to the video element
let observer = null;          // Mutation observer for DOM changes

/**
 * Глобальные переменные для отслеживания состояния вкладки
 */
let isTabActive = true;
let isInitialized = false;

// Инициализация: пытаемся восстановить состояние из localStorage
try {
  const savedFullscreenState = localStorage.getItem('jutsu_fullscreen_state');
  if (savedFullscreenState === 'true') {
    console.log('Restored fullscreen state from localStorage: TRUE');
    wasInFullscreen = true;
  }
} catch (e) {
  console.error('Error accessing localStorage:', e);
}

// Загружаем настройки из хранилища
browser.storage.sync.get(settings).then((items) => {
  settings = items;
  console.log('Settings loaded:', settings);
  
  // Применяем настройки сразу после загрузки
  
  // Инициализируем обработчики событий полноэкранного режима, если включено
  if (settings.fullscreenMode) {
    initFullscreenHandlers();
  }
});

/**
 * СИСТЕМА ЗАЩИТЫ ОТ ОВЕРКЛИКИНГА
 * 
 * Для добавления новых функций с защитой от спама используйте:
 * 
 * 1. findAndClickSafely(actionType, selector, callback, options) 
 *    - для кликов по элементам
 * 
 * 2. performSafeAction(actionType, actionFunction, description)
 *    - для любых других действий
 * 
 * 3. clickManager.performSafeClick(actionType, element, callback, options)
 *    - прямой доступ к менеджеру кликов
 * 
 * Настройка кулдаунов:
 * - clickManager.setCooldown('actionType', milliseconds)
 * - clickManager.updateGlobalCooldown(seconds)
 * 
 * Типы действий:
 * - 'skipOpening' - пропуск опенинга
 * - 'nextEpisode' - переход к следующей серии  
 * - 'videoControl' - управление видео
 * - 'sidebarToggle' - переключение боковой панели
 * - 'general' - общие действия
 */

/**
 * Проверяет, находится ли видео в полноэкранном режиме
 * @returns {boolean} true если в полноэкранном режиме
 */
function isVideoInFullscreen() {
  const isFullscreen = !!(document.fullscreenElement || 
         document.mozFullScreenElement || 
         document.webkitFullscreenElement || 
         document.msFullscreenElement);
  
  // Проверяем также класс VideoJS для полноэкранного режима
  const vjsPlayer = document.querySelector('.video-js');
  const hasFullscreenClass = vjsPlayer && vjsPlayer.classList.contains('vjs-fullscreen');
  
  const result = isFullscreen || hasFullscreenClass;
  console.log(`Fullscreen check: Native=${isFullscreen}, VideoJS=${hasFullscreenClass}, Final=${result}`);
  return result;
}

/**
 * Обрабатывает загрузку страницы и автоматически запускает воспроизведение видео
 */
function handlePageLoad() {
  console.log('Page loaded, handling autoplay...');
  console.log('Current fullscreen state:', wasInFullscreen);
  
  // Проверяем, активна ли вкладка
  if (!isTabActive) {
    console.log('Tab is not active, skipping autoplay on page load');
    return;
  }
  
  // Сбрасываем флаг попытки восстановления при загрузке новой страницы
  fullscreenRestoreAttempted = false;
  fullscreenRetryCount = 0;
  
  // Даем странице время на инициализацию
  setTimeout(() => {
    // Если не нужно восстанавливать полноэкран, просто запускаем видео
    if (!wasInFullscreen) {
      console.log('No need to restore fullscreen, just starting playback');
      tryPlayVideo();
      return;
    }
    
    // Если нужно восстановить полноэкран
    console.log('Need to restore fullscreen, starting playback with fullscreen');
    tryPlayVideo(true);
    
    // Запускаем дополнительные попытки восстановления полноэкрана с интервалом
    const fullscreenInterval = setInterval(() => {
      // Если вкладка стала неактивной, прекращаем попытки
      if (!isTabActive) {
        console.log('Tab became inactive during fullscreen retry, clearing interval');
        clearInterval(fullscreenInterval);
        return;
      }
      
      fullscreenRetryCount++;
      
      // Проверяем, удалось ли уже восстановить полноэкран
      if (isVideoInFullscreen()) {
        console.log('Fullscreen successfully restored, clearing retry interval');
        clearInterval(fullscreenInterval);
        // Сбрасываем флаг, так как полноэкран успешно восстановлен
        wasInFullscreen = false;
        localStorage.removeItem('jutsu_fullscreen_state');
        return;
      }
      
      // Если превысили количество попыток, останавливаем
      if (fullscreenRetryCount >= 5) {
        console.log('Max fullscreen retry count reached, giving up');
        clearInterval(fullscreenInterval);
        // Сбрасываем флаг, так как не удалось восстановить полноэкран
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
 * Основная функция инициализации страницы
 */
function initializePage() {
  console.log('Initializing page...');
  
  // Применяем настройки
  if (settings.fullscreenMode) {
    initFullscreenHandlers();
  }
  
  // Запускаем наблюдатель за изменениями DOM для обнаружения кнопок
  startButtonObserver();
}

// Наблюдатель за изменениями DOM для обнаружения кнопок
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

// Обработка загрузки страницы для восстановления полноэкранного режима
window.addEventListener('load', () => {
  handlePageTransition('pageLoad');
});

// Альтернативный метод для отслеживания перехода между страницами
let lastUrl = location.href; 
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    console.log('URL changed to', url);
    setTimeout(() => handlePageTransition('urlChange'), 1500); // Небольшая задержка для полной загрузки плеера
  }
}).observe(document, {subtree: true, childList: true});

// Запускаем инициализацию после загрузки DOM
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    // Проверяем, что вкладка активна и инициализация еще не выполнена
    if (isTabActive && !isInitialized) {
      initializePage();
      initialize();
    }
  });
} else {
  // Проверяем, что вкладка активна и инициализация еще не выполнена
  if (isTabActive && !isInitialized) {
    initializePage();
    initialize();
  }
}

/**
 * Обработчик сообщений от попапа
 */
browser.runtime.onMessage.addListener(handleMessage);

/**
 * Функция для пропуска опенинга и перехода к следующей серии
 */
function skipButton() {
  // Проверяем, активна ли вкладка
  if (!isTabActive) {
    // Если вкладка неактивна, не выполняем автоматические действия
    return;
  }

  browser.storage.sync.get({
    skipOpening: true,
    autoNextEpisode: true
  }).then((items) => {
    if (items.skipOpening) {
      // Находим кнопку пропуска опенинга
      const skipOpeningButton = document.querySelector('div.vjs-overlay.vjs-overlay-bottom-left.vjs-overlay-skip-intro.vjs-overlay-background');
      
      // Если кнопка найдена, обрабатываем ее для полноэкранного режима
      if (skipOpeningButton) {
        handleSkipButtonAppearance(skipOpeningButton);
      }
      
      // Кликаем по кнопке, если включена соответствующая настройка
      findAndClickSafely(
        'skipOpening',
        'div.vjs-overlay.vjs-overlay-bottom-left.vjs-overlay-skip-intro.vjs-overlay-background',
        () => console.log("op skip"),
        { removeAfterClick: true }
      );
    }

    if (items.autoNextEpisode) {
      // Находим кнопку перехода к следующей серии
      const nextEpisodeButton = document.querySelector('div.vjs-overlay.vjs-overlay-bottom-right.vjs-overlay-skip-intro.vjs-overlay-background');
      
      // Если кнопка найдена, обрабатываем ее для полноэкранного режима
      if (nextEpisodeButton) {
        handleSkipButtonAppearance(nextEpisodeButton);
      }
      
      // Используем функцию handlePageTransition для сохранения состояния полноэкранного режима
      findAndClickSafely(
        'nextEpisode',
        'div.vjs-overlay.vjs-overlay-bottom-right.vjs-overlay-skip-intro.vjs-overlay-background',
        () => {
          handlePageTransition('nextEpisode');
          console.log("next ep");
        },
        { removeAfterClick: true, blockAfterClick: true, blockDuration: 3000 }
      );
    }
  });
}

/**
 * Скрывает или показывает элементы сайта в полноэкранном режиме
 * @param {boolean} hide - true для скрытия, false для показа
 */
function toggleSiteElements(hide) {
  console.log(`${hide ? 'Hiding' : 'Showing'} site elements for fullscreen mode`);
  
  // Список селекторов элементов для скрытия в полноэкранном режиме
  const elementsToHide = [
    '.header',
    '.header_block',
    '.menu',
    '.content_block > .text',
    '.title',
    '.info_panel',
    '.info_panel_arrow',
    '.info',
    '.logo',
    '.footer',
    '.footer.wrapper.z_fix',  // Добавленный класс футера
    '.comments',
    '.side_block',
    '.side_block_right',
    '.side_block_left',
    '.scroll_top_button',
    '.anime_padding',
    '.anime_video_body > div:not(.video_plate)',
    '.anime_video_body > h1',
    '.anime_video_body > p',
    '.anime_video_body_watch_online > div:not(.video_plate)',
    '.notice_top2.notice_cont',  // Добавляем элемент, который остается поверх плеера
    '.notice_top2',              // Дополнительный селектор
    '.notice_cont',              // Дополнительный селектор
    '.notice',                   // Общий класс для уведомлений
    '.top_notice',               // Возможный класс верхних уведомлений
    '[class*="notice"]',         // Любые элементы с "notice" в классе
    '[class*="popup"]',          // Любые всплывающие окна
    '[class*="modal"]',          // Любые модальные окна
    '[class*="overlay"]',        // Любые оверлеи
    '[style*="z-index"]'         // Элементы с явно заданным z-index
  ];
  
  // Для каждого селектора находим элементы и скрываем/показываем их
  elementsToHide.forEach(selector => {
    const elements = document.querySelectorAll(selector);
    elements.forEach(element => {
      if (element) {
        // Проверяем, не является ли элемент частью видеоплеера, кнопкой пропуска или кнопкой следующей серии
        if (!element.classList.contains('video_plate') && 
            !element.classList.contains('video-js') && 
            !element.classList.contains('jutsu-custom-fullscreen') &&
            !element.classList.contains('vjs-overlay-skip-intro') &&
            !element.closest('.video_plate') && 
            !element.closest('.video-js')) {
          
          // Сохраняем оригинальное значение display для восстановления
          if (hide) {
            if (!element.dataset.originalDisplay) {
              element.dataset.originalDisplay = element.style.display || '';
            }
            element.style.display = 'none';
          } else {
            // Восстанавливаем оригинальное значение display
            if (element.dataset.originalDisplay !== undefined) {
              element.style.display = element.dataset.originalDisplay;
              delete element.dataset.originalDisplay;
            } else {
              element.style.display = '';
            }
          }
        }
      }
    });
  });
  
  // Поднимаем кнопки пропуска опенинга и перехода к следующей серии над плеером
  if (hide) {
    // Находим кнопки пропуска опенинга и перехода к следующей серии
    const skipButtons = document.querySelectorAll('.vjs-overlay-skip-intro');
    skipButtons.forEach(button => {
      if (button) {
        // Сохраняем оригинальные стили
        if (!button.dataset.originalZIndex) {
          button.dataset.originalZIndex = button.style.zIndex || '';
        }
        if (!button.dataset.originalPosition) {
          button.dataset.originalPosition = button.style.position || '';
        }
        
        // Поднимаем кнопки над плеером
        button.style.zIndex = '1000000';
        button.style.position = 'fixed';
      }
    });
  } else {
    // Восстанавливаем оригинальные стили кнопок
    const skipButtons = document.querySelectorAll('.vjs-overlay-skip-intro');
    skipButtons.forEach(button => {
      if (button) {
        if (button.dataset.originalZIndex !== undefined) {
          button.style.zIndex = button.dataset.originalZIndex;
          delete button.dataset.originalZIndex;
        } else {
          button.style.zIndex = '';
        }
        
        if (button.dataset.originalPosition !== undefined) {
          button.style.position = button.dataset.originalPosition;
          delete button.dataset.originalPosition;
        } else {
          button.style.position = '';
        }
      }
    });
  }
  
  // Дополнительно находим все элементы с высоким z-index и скрываем их
  if (hide) {
    const allElements = document.querySelectorAll('*');
    allElements.forEach(element => {
      const style = window.getComputedStyle(element);
      const zIndex = parseInt(style.zIndex);
      
      // Если элемент имеет z-index больше 1000 и не является частью видеоплеера или кнопкой пропуска
      if (zIndex > 1000 && 
          !element.classList.contains('video_plate') && 
          !element.classList.contains('video-js') && 
          !element.classList.contains('jutsu-custom-fullscreen') &&
          !element.classList.contains('vjs-overlay-skip-intro') &&
          !element.closest('.video_plate') && 
          !element.closest('.video-js')) {
        
        console.log('Hiding high z-index element:', element, 'z-index:', zIndex);
        
        // Сохраняем оригинальные стили
        if (!element.dataset.originalDisplay) {
          element.dataset.originalDisplay = element.style.display || '';
        }
        if (!element.dataset.originalZIndex) {
          element.dataset.originalZIndex = element.style.zIndex || '';
        }
        
        // Скрываем элемент и устанавливаем низкий z-index
        element.style.display = 'none';
        element.style.zIndex = '-1';
      }
    });
  } else {
    // Восстанавливаем элементы с сохраненными z-index
    const elementsWithSavedZIndex = document.querySelectorAll('[data-original-z-index]');
    elementsWithSavedZIndex.forEach(element => {
      if (element.dataset.originalDisplay !== undefined) {
        element.style.display = element.dataset.originalDisplay;
        delete element.dataset.originalDisplay;
      }
      if (element.dataset.originalZIndex !== undefined) {
        element.style.zIndex = element.dataset.originalZIndex;
        delete element.dataset.originalZIndex;
      }
    });
  }
  
  // Настраиваем стиль контейнера видео для полноэкранного режима
  const videoContainer = document.querySelector('.video_plate');
  if (videoContainer) {
    if (hide) {
      // Сохраняем оригинальные стили перед изменением
      if (!videoContainer.dataset.originalWidth) {
        videoContainer.dataset.originalWidth = videoContainer.style.width || '';
      }
      if (!videoContainer.dataset.originalHeight) {
        videoContainer.dataset.originalHeight = videoContainer.style.height || '';
      }
      if (!videoContainer.dataset.originalMaxWidth) {
        videoContainer.dataset.originalMaxWidth = videoContainer.style.maxWidth || '';
      }
      if (!videoContainer.dataset.originalMargin) {
        videoContainer.dataset.originalMargin = videoContainer.style.margin || '';
      }
      if (!videoContainer.dataset.originalPadding) {
        videoContainer.dataset.originalPadding = videoContainer.style.padding || '';
      }
      if (!videoContainer.dataset.originalZIndex) {
        videoContainer.dataset.originalZIndex = videoContainer.style.zIndex || '';
      }
      if (!videoContainer.dataset.originalPosition) {
        videoContainer.dataset.originalPosition = videoContainer.style.position || '';
      }
      if (!videoContainer.dataset.originalTop) {
        videoContainer.dataset.originalTop = videoContainer.style.top || '';
      }
      if (!videoContainer.dataset.originalLeft) {
        videoContainer.dataset.originalLeft = videoContainer.style.left || '';
      }
      
      // Применяем стили для полноэкранного режима
      videoContainer.style.width = '100%';
      videoContainer.style.height = '100vh';
      videoContainer.style.maxWidth = '100%';
      videoContainer.style.margin = '0';
      videoContainer.style.padding = '0';
      videoContainer.style.zIndex = '99999';
      videoContainer.style.position = 'fixed';
      videoContainer.style.top = '0';
      videoContainer.style.left = '0';
    } else {
      // Восстанавливаем оригинальные стили
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
      
      if (videoContainer.dataset.originalMaxWidth) {
        videoContainer.style.maxWidth = videoContainer.dataset.originalMaxWidth;
      } else {
        videoContainer.style.maxWidth = '';
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
      
      if (videoContainer.dataset.originalZIndex) {
        videoContainer.style.zIndex = videoContainer.dataset.originalZIndex;
      } else {
        videoContainer.style.zIndex = '';
      }
      
      if (videoContainer.dataset.originalPosition) {
        videoContainer.style.position = videoContainer.dataset.originalPosition;
      } else {
        videoContainer.style.position = '';
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
  }
}

/**
 * Создает и применяет стили для расширенного полноэкранного режима
 * Поднимает плеер поверх всех элементов и растягивает на весь экран
 * @param {boolean} enable - true для активации, false для деактивации
 */
function applyCustomFullscreen(enable) {
  // Проверяем, включена ли функция полноэкранного режима
  if (!settings.fullscreenMode && enable) {
    console.log('Fullscreen mode disabled in settings');
    return;
  }
  
  // Проверяем, активна ли вкладка
  if (!isTabActive) {
    console.log('Tab is not active, skipping custom fullscreen');
    return;
  }
  
  console.log(`${enable ? 'Enabling' : 'Disabling'} custom fullscreen mode`);
  
  // Находим контейнер плеера
  const playerContainer = document.querySelector('.video-js') || document.querySelector('#my-player');
  if (!playerContainer) {
    console.log('Player container not found');
    return;
  }
  
  // Находим родительский элемент плеера
  const playerParent = playerContainer.parentElement;
  if (!playerParent) {
    console.log('Player parent not found');
    return;
  }
  
  // Находим контейнер видео
  const videoContainer = document.querySelector('.video_plate');
  
  if (enable) {
    // Сохраняем оригинальные стили для восстановления
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
    
    // Сохраняем оригинальные стили для видео-контейнера
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
    
    // Создаем стили для расширенного полноэкранного режима
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
      
      /* Стили для кнопок пропуска опенинга и перехода к следующей серии */
      .vjs-overlay-skip-intro {
        z-index: 1000001 !important;
        position: fixed !important;
        visibility: visible !important;
        opacity: 1 !important;
        pointer-events: auto !important;
      }
      
      /* Стиль для кнопки пропуска опенинга (обычно слева внизу) */
      .vjs-overlay-bottom-left.vjs-overlay-skip-intro {
        bottom: 70px !important;
        left: 20px !important;
      }
      
      /* Стиль для кнопки перехода к следующей серии (обычно справа внизу) */
      .vjs-overlay-bottom-right.vjs-overlay-skip-intro {
        bottom: 70px !important;
        right: 20px !important;
      }
      
      body.jutsu-fullscreen-active {
        overflow: hidden !important;
      }
      
      /* Скрываем все уведомления и элементы с высоким z-index */
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
    
    // Добавляем классы для активации полноэкранного режима
    playerContainer.classList.add('jutsu-custom-fullscreen');
    document.body.classList.add('jutsu-fullscreen-active');
    
    // Скрываем элементы сайта
    toggleSiteElements(true);
    
    console.log('Custom fullscreen mode enabled');
  } else {
    // Удаляем стили расширенного полноэкранного режима
    const customFullscreenStyle = document.getElementById('jutsu-custom-fullscreen-style');
    if (customFullscreenStyle) {
      customFullscreenStyle.remove();
    }
    
    // Удаляем классы полноэкранного режима
    playerContainer.classList.remove('jutsu-custom-fullscreen');
    document.body.classList.remove('jutsu-fullscreen-active');
    
    // Восстанавливаем оригинальные стили плеера
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
    
    // Восстанавливаем оригинальные стили для видео-контейнера
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
    
    // Показываем элементы сайта
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
  
  // Применяем кастомный полноэкранный режим, если нативный полноэкран отключен
  if (!isFullscreen && settings.fullscreenMode) {
    console.log('Native fullscreen exited, applying custom fullscreen');
    applyCustomFullscreen(true);
  } else {
    // В нативном полноэкранном режиме отключаем кастомный
    applyCustomFullscreen(false);
  }
}

/**
 * Принудительно активирует полноэкранный режим всеми доступными методами
 */
function forceFullscreen() {
  console.log('Forcing fullscreen mode...');
  
  const vjsPlayer = document.querySelector('.video-js');
  if (!vjsPlayer) {
    console.log('VideoJS player not found for forced fullscreen');
    return;
  }
  
  // Скрываем элементы сайта перед входом в полноэкранный режим
  toggleSiteElements(true);
  
  // Метод 1: Прямое нажатие на кнопку полноэкранного режима
  const fullscreenButton = vjsPlayer.querySelector('.vjs-fullscreen-control');
  if (fullscreenButton) {
    console.log('Forcing click on fullscreen button');
    
    // Показываем элементы управления
    vjsPlayer.classList.add('vjs-user-active');
    vjsPlayer.classList.remove('vjs-user-inactive');
    
    // Симулируем движение мыши над плеером
    const moveEvent = new MouseEvent('mousemove', {
      view: window,
      bubbles: true,
      cancelable: true,
      clientX: vjsPlayer.offsetWidth / 2,
      clientY: vjsPlayer.offsetHeight / 2
    });
    vjsPlayer.dispatchEvent(moveEvent);
    
    // Симулируем нажатие на кнопку
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
  
  // Метод 2: API VideoJS
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
  
  // Метод 3: Нативный API полноэкранного режима
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
  
  // Метод 4: Программное добавление класса полноэкранного режима
  try {
    console.log('Adding fullscreen class programmatically');
    vjsPlayer.classList.add('vjs-fullscreen');
    document.body.classList.add('vjs-full-window');
  } catch (e) {
    console.error('Error adding fullscreen class:', e);
  }
}

/**
 * Функция для нажатия на кнопку полноэкранного режима
 * @returns {boolean} true если удалось нажать на кнопку
 */
const clickFullscreenButton = () => {
  console.log('Attempting to click fullscreen button...');
  
  // Находим плеер и кнопку полноэкранного режима
  const vjsPlayer = document.querySelector('.video-js');
  if (!vjsPlayer) {
    console.log('VideoJS player not found for fullscreen');
    // Используем кастомный полноэкранный режим как запасной вариант
    applyCustomFullscreen(true);
    return false;
  }
  
  // Сначала показываем элементы управления, симулируя движение мыши над плеером
  console.log('Showing player controls by simulating mouse movement');
  
  try {
    // Добавляем классы, которые показывают элементы управления
    vjsPlayer.classList.add('vjs-user-active');
    vjsPlayer.classList.remove('vjs-user-inactive');
    
    // Симулируем движение мыши над плеером
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
  
  // Пробуем несколько методов для нажатия на кнопку полноэкранного режима
  
  // Метод 1: Прямой поиск кнопки полноэкранного режима
  const fullscreenButton = vjsPlayer.querySelector('.vjs-fullscreen-control');
  if (fullscreenButton) {
    console.log('Fullscreen button found, clicking it');
    
    // Симулируем последовательность событий мыши
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
  
  // Метод 2: Поиск через XPath
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
  
  // Метод 3: Прямой запрос полноэкранного режима для плеера
  try {
    console.log('Requesting fullscreen directly for player element');
    vjsPlayer.requestFullscreen();
    return true;
  } catch (e) {
    console.error('Error requesting fullscreen directly:', e);
  }
  
  // Если все методы не сработали, используем кастомный полноэкранный режим
  console.log('All native fullscreen methods failed, using custom fullscreen');
  applyCustomFullscreen(true);
  
  return false;
};

/**
 * Пытается запустить воспроизведение видео различными методами
 * @param {boolean} restoreFullscreen - нужно ли восстанавливать полноэкран после запуска
 */
function tryPlayVideo(restoreFullscreen = false) {
  // Проверяем, активна ли вкладка
  if (!isTabActive) {
    console.log('Tab is not active, skipping video playback');
    return;
  }
  
  console.log('Trying to play video, restore fullscreen:', restoreFullscreen);
  
  // Метод 1: Используем безопасный клик по селектору CSS
  findAndClickSafely('autoPlay', '.vjs-big-play-button', (button) => {
    console.log('Auto-clicking play button via CSS selector');
    
    // Если нужно восстановить полноэкран
    if (restoreFullscreen && !fullscreenRestoreAttempted && isTabActive) {
      fullscreenRestoreAttempted = true;
      
      // Небольшая задержка, чтобы видео начало воспроизводиться
      setTimeout(() => {
        // Повторная проверка активности вкладки перед входом в полноэкран
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
  
  // Метод 2: Прямой доступ к видео элементу
  setTimeout(() => {
    // Повторная проверка активности вкладки
    if (!isTabActive) {
      console.log('Tab became inactive during direct play attempt, aborting');
      return;
    }
    
    if (videoElement && !videoElement.playing) {
      console.log('Trying direct video play method');
      try {
        videoElement.play().then(() => {
          console.log('Video started playing via direct play method');
          
          // Если нужно восстановить полноэкран и еще не пытались
          if (restoreFullscreen && !fullscreenRestoreAttempted && isTabActive) {
            fullscreenRestoreAttempted = true;
            setTimeout(() => {
              // Еще одна проверка активности вкладки
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
  
  // Метод 3: Поиск через XPath
  setTimeout(() => {
    // Повторная проверка активности вкладки
    if (!isTabActive) {
      console.log('Tab became inactive during XPath play attempt, aborting');
      return;
    }
    
    // Если первый метод не сработал, пробуем XPath
    try {
      // Если уже пытались восстановить полноэкран, не делаем этого снова
      if (fullscreenRestoreAttempted && restoreFullscreen) {
        console.log('Fullscreen restore already attempted, skipping XPath method');
        return;
      }
      
      console.log('Trying to find play button via XPath...');
      
      // XPath для кнопки воспроизведения
      const xpathExpressions = [
        // Основной XPath из примера
        '/html/body/div[5]/div/div/div/div[4]/div[1]/div[1]/div[2]/div[2]/div[1]/button',
        // Более гибкий XPath для поиска большой кнопки воспроизведения
        '//div[contains(@class, "video-js")]//button[contains(@class, "vjs-big-play-button")]',
        // Альтернативный XPath для поиска по атрибуту title
        '//button[@title="Воспроизвести видео"]',
        // Поиск по классу внутри video-js
        '//div[@class="video-js"]//button[@class="vjs-big-play-button"]'
      ];
      
      // Пробуем разные XPath выражения
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
          // Повторная проверка активности вкладки
          if (!isTabActive) {
            console.log('Tab became inactive before XPath click, aborting');
            return false;
          }
          
          // Симулируем полную последовательность кликов
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
          
          // Если был в полноэкранном режиме и еще не пытались восстановить
          if (restoreFullscreen && !fullscreenRestoreAttempted && isTabActive) {
            fullscreenRestoreAttempted = true;
            
            // Немедленно пытаемся нажать на кнопку полноэкранного режима
            setTimeout(() => {
              // Еще одна проверка активности вкладки
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
  
  // Метод 4: Прямой доступ к API VideoJS
  setTimeout(() => {
    // Повторная проверка активности вкладки
    if (!isTabActive) {
      console.log('Tab became inactive during VideoJS API attempt, aborting');
      return;
    }
    
    try {
      // Если уже пытались восстановить полноэкран, не делаем этого снова
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
          
          // После начала воспроизведения активируем полноэкран
          if (restoreFullscreen && !fullscreenRestoreAttempted && isTabActive) {
            fullscreenRestoreAttempted = true;
            
            // Немедленная активация полноэкрана через API
            setTimeout(() => {
              // Еще одна проверка активности вкладки
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
 * Обрабатывает переход между страницами
 * @param {string} actionType - тип действия, вызвавшего переход (для логирования)
 */
function handlePageTransition(actionType = '') {
  // Проверяем, активна ли вкладка
  if (!isTabActive) {
    console.log('Tab is not active, skipping page transition handling');
    return;
  }
  
  // Если не нужно сохранять полноэкранный режим, просто выходим
  if (!settings.fullscreenMode) {
    console.log('Fullscreen preservation disabled in settings, not saving state');
    return;
  }
  
  // Если уже в процессе перехода, не сохраняем состояние повторно
  if (isTransitioning) {
    return;
  }
  
  // Устанавливаем флаг перехода
  isTransitioning = true;
  
  // Сохраняем состояние полноэкранного режима перед переходом
  const isFullscreen = isVideoInFullscreen();
  wasInFullscreen = isFullscreen;
  
  // Сохраняем состояние в localStorage для восстановления после перезагрузки страницы
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
  
  // Сбрасываем флаги
  fullscreenRestoreAttempted = false;
  fullscreenRetryCount = 0;
  
  // Сбрасываем флаг перехода через некоторое время
  setTimeout(() => {
    isTransitioning = false;
  }, 2000);
  
  // Если переход произошел, запускаем обработчик загрузки страницы
  setTimeout(() => {
    handlePageLoad();
  }, 1000);
}

/**
 * Устанавливает скорость воспроизведения видео с защитой от спама
 * @param {string} speed - Скорость воспроизведения
 */
function setVideoSpeed(speed) {
  if (!clickManager.canPerformAction('videoControl')) {
      console.log('Video speed change blocked due to cooldown');
      return false;
  }

  const video = document.querySelector('video');
  if (video) {
      clickManager.clickTimes.set('videoControl', Date.now());
      video.playbackRate = parseFloat(speed);
      console.log(`Video speed changed to ${speed}x`);
      return true;
  }
  return false;
}

/**
 * Применяет сохраненные настройки при загрузке страницы
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
      // Обновляем задержку между кликами в менеджере
      clickManager.updateGlobalCooldown(parseInt(settings.clickDelay));
  });
}

/**
 * Универсальный менеджер кликов с защитой от спама
 */
class ClickManager {
    constructor() {
        this.clickTimes = new Map(); // Хранит время последних кликов по типам действий
        this.blockedActions = new Set(); // Заблокированные действия
        this.defaultCooldown = 3000; // По умолчанию 3 секунды
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
     * Устанавливает кулдаун для конкретного типа действия
     * @param {string} actionType - Тип действия
     * @param {number} cooldown - Кулдаун в миллисекундах
     */
    setCooldown(actionType, cooldown) {
        this.cooldowns[actionType] = cooldown;
    }

    /**
     * Обновляет общий кулдаун для всех действий
     * @param {number} seconds - Кулдаун в секундах
     */
    updateGlobalCooldown(seconds) {
        const cooldown = seconds * 1000;
        this.cooldowns.skipOpening = cooldown;
        this.cooldowns.nextEpisode = cooldown;
        this.defaultCooldown = cooldown;
    }

    /**
     * Проверяет можно ли выполнить действие
     * @param {string} actionType - Тип действия
     * @returns {boolean} true если действие можно выполнить
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
     * Выполняет защищенный клик
     * @param {string} actionType - Тип действия
     * @param {Element} element - Элемент для клика
     * @param {Function} callback - Колбэк после клика (опционально)
     * @param {Object} options - Дополнительные опции
     * @returns {boolean} true если клик был выполнен
     */
    performSafeClick(actionType, element, callback = null, options = {}) {
        if (!element || !isElementVisible(element)) {
            return false;
        }

        if (!this.canPerformAction(actionType)) {
            return false;
        }

        // Записываем время клика
        this.clickTimes.set(actionType, Date.now());

        // Выполняем клик
        try {
            element.click();
            console.log(`Safe click performed: ${actionType}`);

            // Удаляем элемент если указано
            if (options.removeAfterClick) {
                element.remove();
            }

            // Блокируем действие если указано
            if (options.blockAfterClick) {
                this.blockAction(actionType, options.blockDuration || 5000);
            }

            // Устанавливаем флаг навигации для переходов
            if (actionType === 'nextEpisode') {
                this.setNavigating(true, 5000);
            }

            // Выполняем колбэк
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
     * Блокирует действие на определенное время
     * @param {string} actionType - Тип действия
     * @param {number} duration - Длительность блокировки в миллисекундах
     */
    blockAction(actionType, duration = 5000) {
        this.blockedActions.add(actionType);
        setTimeout(() => {
            this.blockedActions.delete(actionType);
        }, duration);
    }

    /**
     * Устанавливает состояние навигации
     * @param {boolean} navigating - Флаг навигации
     * @param {number} duration - Длительность в миллисекундах
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
     * Сбрасывает все состояния
     */
    reset() {
        this.clickTimes.clear();
        this.blockedActions.clear();
        this.isNavigating = false;
    }
}

// Создаем глобальный экземпляр менеджера кликов
const clickManager = new ClickManager();

/**
 * Универсальная функция для безопасного поиска и клика по элементам
 * @param {string} actionType - Тип действия для логирования и кулдауна
 * @param {string} selector - CSS селектор элемента
 * @param {Function} callback - Колбэк после успешного клика
 * @param {Object} options - Дополнительные опции
 * @returns {boolean} true если клик был выполнен
 */
function findAndClickSafely(actionType, selector, callback = null, options = {}) {
    const element = document.querySelector(selector);
    return clickManager.performSafeClick(actionType, element, callback, options);
}

/**
 * Универсальная функция для безопасного выполнения действий с элементами
 * @param {string} actionType - Тип действия
 * @param {Function} actionFunction - Функция для выполнения
 * @param {string} description - Описание действия для логирования
 * @returns {boolean} true если действие было выполнено
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
 * Активирует полноэкранный режим для видеоплеера
 */
function activateFullscreen() {
  console.log('Attempting to restore fullscreen mode...');
  
  // Проверяем необходимость восстановления
  if (!wasInFullscreen) {
    console.log('No need to restore fullscreen - was not in fullscreen before');
    return false;
  }
  
  console.log('RESTORING FULLSCREEN - was in fullscreen before!');
  
  // Сбрасываем флаг, так как мы уже пытаемся восстановить
  wasInFullscreen = false;
  
  // Функция перевода в полноэкран видеоплеера VideoJS с несколькими методами
  const activateVideoAndFullscreen = function() {
    console.log('Looking for VideoJS player...');
    
    // Находим плеер VideoJS
    const vjsPlayer = document.querySelector('.video-js');
    if (!vjsPlayer) {
      console.log('VideoJS player not found, retrying in 2s...');
      setTimeout(activateVideoAndFullscreen, 2000);
      return;
    }
    
    console.log('VideoJS player found!', vjsPlayer);
    
    // Скрываем элементы сайта перед входом в полноэкранный режим
    toggleSiteElements(true);
    
    // МЕТОД 1: Прямой доступ к API VideoJS
    if (typeof videojs !== 'undefined' && vjsPlayer.id) {
      try {
        console.log('Trying direct VideoJS API access for fullscreen...');
        const player = videojs(vjsPlayer.id);
        if (player) {
          console.log('VideoJS API found, setting fullscreen...');
          
          // Активируем полноэкран через API
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
    
    // МЕТОД 2: Кнопка полноэкранного режима
    const fullscreenButton = vjsPlayer.querySelector('.vjs-fullscreen-control');
    if (fullscreenButton) {
      console.log('Fullscreen button found, simulating click...');
      
      // Функция для симуляции полной последовательности кликов
      function fullClickSequence(element) {
        if (!element) return false;
        
        console.log('Performing full click sequence on fullscreen button');
        
        try {
          // Создаем и запускаем события мыши
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
    
    // МЕТОД 3: Нативный API полноэкранного режима
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

  // Запускаем с задержкой, чтобы страница успела загрузиться полностью
  setTimeout(activateVideoAndFullscreen, 1000);
  return true;
}

/**
 * Инициализирует обработчики событий полноэкранного режима
 */
function initFullscreenHandlers() {
  console.log('Initializing fullscreen handlers');
  document.addEventListener('fullscreenchange', handleFullscreenChange);
  document.addEventListener('mozfullscreenchange', handleFullscreenChange);
  document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
  document.addEventListener('MSFullscreenChange', handleFullscreenChange);
}

/**
 * Удаляет обработчики событий полноэкранного режима
 */
function removeFullscreenHandlers() {
  console.log('Removing fullscreen handlers');
  document.removeEventListener('fullscreenchange', handleFullscreenChange);
  document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
  document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
  document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
  
  // Восстанавливаем видимость элементов сайта
  toggleSiteElements(false);
}

/**
 * Initialize the extension
 */
function initialize() {
  console.log('Jut.su NonStop: Initializing...');
  
  // Отмечаем, что инициализация выполнена
  isInitialized = true;
  
  // Load settings from storage
  loadSettings().then(() => {
    // Set up event listeners
    setupEventListeners();
    
    // Set up mutation observer to detect DOM changes
    setupMutationObserver();
    
    // Apply custom fullscreen if enabled and вкладка активна
    if (settings.fullscreenMode && isTabActive) {
      setTimeout(() => {
        applyCustomFullscreen(true);
      }, 2000); // Задержка для полной загрузки плеера
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
      // Обновляем настройки
      Object.assign(settings, message.settings);
      console.log('Settings updated:', settings);
      
      // Применяем новые настройки
      if ('fullscreenMode' in message.settings) {
        if (message.settings.fullscreenMode) {
          // Если включен полноэкранный режим, применяем его
          initFullscreenHandlers();
          
          // Применяем полноэкранный режим только если вкладка активна
          if (isTabActive) {
            console.log('Applying fullscreen mode after settings change');
            applyCustomFullscreen(true);
          }
        } else {
          // Если отключен полноэкранный режим, отключаем его
          removeFullscreenHandlers();
          
          // Принудительно отключаем полноэкранный режим и восстанавливаем исходное состояние
          console.log('Disabling fullscreen mode after settings change');
          
          // Выходим из нативного полноэкранного режима
          if (document.fullscreenElement) {
            console.log('Exiting native fullscreen');
            document.exitFullscreen().catch(err => {
              console.error('Error exiting fullscreen:', err);
            });
          }
          
          // Отключаем кастомный полноэкранный режим
          applyCustomFullscreen(false);
          
          // Сбрасываем флаг, чтобы не восстанавливать полноэкран при переходах
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
  
  // Проверяем, активна ли вкладка
  if (!isTabActive) {
    console.log('Tab is not active, skipping fullscreen actions');
    return;
  }
  
  // Reset flags
  skipButtonClicked = false;
  nextEpisodeClicked = false;
  
  // Если в настройках включен полноэкранный режим
  if (settings.fullscreenMode && !document.fullscreenElement) {
    console.log('Fullscreen mode enabled in settings');
    
    // Сначала пробуем нативный полноэкранный режим
    if (videoElement) {
      try {
        videoElement.requestFullscreen().catch(err => {
          console.error('Error attempting to enable native fullscreen:', err);
          // Если нативный полноэкран не сработал, используем кастомный
          console.log('Falling back to custom fullscreen');
          applyCustomFullscreen(true);
        });
      } catch (e) {
        console.error('Exception in requestFullscreen:', e);
        // Если произошла ошибка, используем кастомный полноэкран
        console.log('Falling back to custom fullscreen after exception');
        applyCustomFullscreen(true);
      }
    } else {
      // Если видеоэлемент не найден, используем кастомный полноэкран
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
  
  // Определяем необходимость входа в полноэкран на основе настроек
  if (settings.fullscreenMode) {
    console.log('Auto fullscreen enabled in settings');
    // Запускаем воспроизведение с входом в полноэкран
    setTimeout(() => {
      tryPlayVideo(true);
    }, 1500);
  } else {
    console.log('Auto fullscreen disabled in settings');
    // Просто запускаем воспроизведение без полноэкрана
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
  
  const skipButton = document.querySelector('.vjs-skip-opening');
  
  if (skipButton) {
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
  
  const nextButton = document.querySelector('.vjs-next-button');
  
  if (nextButton) {
    console.log(`Next episode button found, clicking in ${settings.clickDelay} seconds`);
    nextEpisodeClicked = true;
    
    // Click after specified delay
    setTimeout(() => {
      nextButton.click();
    }, parseInt(settings.clickDelay) * 1000);
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
    video.playbackRate = parseFloat(speed);
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
    
    // Автоматически запускаем воспроизведение только если вкладка активна
    if (isTabActive) {
      setTimeout(() => {
        // Если в настройках включен автоматический вход в полноэкран
        const shouldEnterFullscreen = settings.fullscreenMode;
        tryPlayVideo(shouldEnterFullscreen);
      }, 1000);
    } else {
      console.log('Tab is not active, skipping auto-play');
    }
  } else {
    console.log('Video element not found');
  }
}

/**
 * Обрабатывает появление кнопок пропуска опенинга и перехода к следующей серии
 * @param {Element} button - Кнопка, которую нужно обработать
 */
function handleSkipButtonAppearance(button) {
  if (!button || !isElementVisible(button)) return;
  
  console.log('Skip button appeared, ensuring it is visible in fullscreen mode');
  
  // Проверяем, находимся ли мы в полноэкранном режиме
  const isFullscreen = isVideoInFullscreen() || document.body.classList.contains('jutsu-fullscreen-active');
  
  if (isFullscreen) {
    // Сохраняем оригинальные стили
    if (!button.dataset.originalZIndex) {
      button.dataset.originalZIndex = button.style.zIndex || '';
    }
    if (!button.dataset.originalPosition) {
      button.dataset.originalPosition = button.style.position || '';
    }
    
    // Поднимаем кнопку над плеером
    button.style.zIndex = '1000001';
    button.style.position = 'fixed';
    
    // Устанавливаем позицию в зависимости от класса кнопки
    if (button.classList.contains('vjs-overlay-bottom-left')) {
      // Кнопка пропуска опенинга
      button.style.bottom = '70px';
      button.style.left = '20px';
    } else if (button.classList.contains('vjs-overlay-bottom-right')) {
      // Кнопка перехода к следующей серии
      button.style.bottom = '70px';
      button.style.right = '20px';
    }
    
    // Обеспечиваем видимость
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
        // Проверяем добавленные узлы на наличие кнопок пропуска
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Проверяем, является ли добавленный узел кнопкой пропуска
            if (node.classList && node.classList.contains('vjs-overlay-skip-intro')) {
              handleSkipButtonAppearance(node);
            }
            
            // Проверяем, содержит ли добавленный узел кнопки пропуска
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
 * Обработчики событий активности вкладки
 */
document.addEventListener('visibilitychange', handleVisibilityChange);

/**
 * Обработчик изменения видимости вкладки
 */
function handleVisibilityChange() {
  const wasActive = isTabActive;
  isTabActive = document.visibilityState === 'visible';
  console.log('Tab visibility changed:', isTabActive ? 'active' : 'inactive');
  
  // Если вкладка стала неактивной
  if (!isTabActive && wasActive) {
    console.log('Tab became inactive, pausing video and disabling fullscreen');
    
    // Приостанавливаем воспроизведение видео
    if (videoElement && !videoElement.paused) {
      videoElement.pause();
      console.log('Video paused due to tab becoming inactive');
    }
    
    // Отключаем полноэкранный режим
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(err => {
        console.error('Error exiting fullscreen:', err);
      });
    }
    
    // Отключаем кастомный полноэкранный режим
    applyCustomFullscreen(false);
  }
  // Если вкладка стала активной и расширение уже инициализировано
  else if (isTabActive && !wasActive && isInitialized) {
    console.log('Tab became active, checking state');
    
    // Если плеер существует и нужно восстановить полноэкран
    if (settings.fullscreenMode && wasInFullscreen) {
      console.log('Restoring fullscreen on tab activation');
      
      // Запускаем воспроизведение и восстанавливаем полноэкран
      setTimeout(() => {
        if (videoElement) {
          videoElement.play().catch(err => {
            console.error('Error playing video on tab activation:', err);
          });
        }
        
        // Применяем кастомный полноэкран
        applyCustomFullscreen(true);
      }, 500);
    }
    // Если расширение еще не инициализировано, инициализируем его
    else if (!isInitialized) {
      console.log('Initializing extension on tab activation');
      initializePage();
      initialize();
    }
  }
}

// Initialize the extension
initialize();