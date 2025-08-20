// Основные переменные состояния приложения
let currentUser = null;
let authToken = localStorage.getItem('authToken');
let currentView = 'dashboard';
let currentDate = new Date();
let shifts = [];
let notifications = [];
let users = [];
let swapRequests = [];

// Элементы DOM
const mainNav = document.getElementById('mainNav');
const navToggle = document.getElementById('navToggle');
const userMenuBtn = document.getElementById('userMenuBtn');
const userDropdown = document.getElementById('userDropdown');
const userName = document.getElementById('userName');
const tabContents = document.querySelectorAll('.tab-content');
const tabs = document.querySelectorAll('.tab');
const loginModal = document.getElementById('loginModal');
const shiftDetailsModal = document.getElementById('shiftDetailsModal');
const profileModal = document.getElementById('profileModal');
const settingsModal = document.getElementById('settingsModal');
const installPrompt = document.getElementById('installPrompt');
const installBtn = document.getElementById('installBtn');
window.API_BASE_URL = 'https://lot-schedule-api.onrender.com';

// Утилита для дебаунсинга
function debounce(func, wait) {
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

// Инициализация приложения
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM fully loaded, initializing app...');
    initApp();
    setupEventListeners();
    
    // Проверка аутентификации
    if (authToken) {
        fetchUserProfile();
    } else {
        showLoginModal();
    }
});

// Инициализация приложения
function initApp() {
    console.log('Initializing app...');
    // Проверка поддержки PWA
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(registration => {
                console.log('SW registered: ', registration);
            })
            .catch(registrationError => {
                console.log('SW registration failed: ', registrationError);
            });
    }

    // Обработка запроса на установку PWA
    let deferredPrompt;
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        installPrompt.classList.add('show');
    });

    installBtn.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            installPrompt.classList.remove('show');
        }
        deferredPrompt = null;
    });

    // Загрузка настроек из localStorage
    const savedTheme = localStorage.getItem('theme') || 'light';
    const savedFontSize = localStorage.getItem('fontSize') || 'medium';
    applySettings(savedTheme, savedFontSize);
}

// Настройка обработчиков событий
function setupEventListeners() {
    console.log('Setting up event listeners...');
    // Навигационное меню
    navToggle.addEventListener('click', () => {
        mainNav.classList.toggle('show');
    });

    // Меню пользователя
    userMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        userDropdown.classList.toggle('show');
    });

    document.addEventListener('click', () => {
        userDropdown.classList.remove('show');
    });

    // Переключение между вкладками
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabId = tab.getAttribute('data-tab');
            switchTab(tabId);
        });
    });

    // Навигация по разделам
    document.querySelectorAll('nav a').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const target = e.target.getAttribute('href').substring(1);
            switchView(target);
            if (window.innerWidth < 768) {
                mainNav.classList.remove('show');
            }
        });
    });

    // Кнопки пользовательского меню
    document.getElementById('profileBtn').addEventListener('click', showProfileModal);
    document.getElementById('settingsBtn').addEventListener('click', showSettingsModal);
    document.getElementById('logoutBtn').addEventListener('click', logout);

    // Закрытие модальных окон
    document.querySelectorAll('.close-btn, [data-dismiss="modal"]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.modal').forEach(modal => {
                modal.classList.remove('show');
            });
        });
    });

    // Формы с обработчиками
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        console.log('Login form found, adding submit listener...');
        loginForm.addEventListener('submit', handleLogin);
    } else {
        console.error('Login form not found!');
    }
    document.getElementById('profileForm').addEventListener('submit', debounce(updateProfile, 300));
    document.getElementById('settingsForm').addEventListener('submit', debounce(updateSettings, 300));
    document.getElementById('swapRequestForm').addEventListener('submit', debounce(requestSwap, 300));

    // Навигация по календарю
    document.getElementById('prevMonth').addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() - 1);
        renderCalendar();
    });

    document.getElementById('nextMonth').addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() + 1);
        renderCalendar();
    });

    // Навигация по календарю доступности
    document.getElementById('prevWeek').addEventListener('click', () => {
        currentDate.setDate(currentDate.getDate() - 7);
        renderAvailabilityCalendar();
    });

    document.getElementById('nextWeek').addEventListener('click', () => {
        currentDate.setDate(currentDate.getDate() + 7);
        renderAvailabilityCalendar();
    });

    document.getElementById('saveAvailability').addEventListener('click', debounce(saveAvailability, 300));
}

// Функции для работы с API
async function apiCall(endpoint, options = {}) {
    const API_BASE_URL = window.API_BASE_URL || window.location.origin;
    const url = `${API_BASE_URL}/api${endpoint}`;
    
    const authToken = localStorage.getItem('authToken');
    console.log('API Call - Token:', authToken);
    
    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json',
        }
    };
    
    if (authToken) {
        defaultOptions.headers.Authorization = `Bearer ${authToken}`;
    }
    
    const config = { 
        ...defaultOptions, 
        ...options,
        headers: {
            ...defaultOptions.headers,
            ...(options.headers || {})
        }
    };
    
    if (config.body && typeof config.body === 'object') {
        config.body = JSON.stringify(config.body);
    }

    try {
        const response = await fetch(url, config);
        const contentType = response.headers.get('content-type');
        
        if (!response.ok) {
            if (response.status === 401) {
                logout();
                showNotification('Sesja wygasła. Zaloguj się ponownie.', 'error');
                return null;
            }
            if (response.status === 403) {
                showNotification('Brak uprawnień do wykonania tej akcji.', 'error');
                return null;
            }
            if (response.status === 404) {
                showNotification('Nie znaleziono zasobu.', 'error');
                return null;
            }
            if (response.status === 400) {
                const data = contentType && contentType.includes('application/json') 
                    ? await response.json() 
                    : {};
                showNotification(data.error || 'Nieprawidłowe dane.', 'error');
                return null;
            }
            throw new Error(`HTTP error ${response.status}`);
        }
        
        if (contentType && contentType.includes('application/json')) {
            return await response.json();
        }
        return { status: response.status, statusText: response.statusText };
    } catch (error) {
        console.error('API call failed:', error);
        showNotification('Błąd połączenia z serwerem', 'error');
        return null;
    }
}

async function fetchUserProfile() {
    const data = await apiCall('/me');
    if (data) {
        currentUser = data;
        userName.textContent = currentUser.full_name;
        
        fetchShifts();
        fetchNotifications();
        fetchUsers();
        fetchSwapRequests();
    }
}

async function fetchShifts() {
    const startDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const endDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
    
    const formattedStart = formatDate(startDate);
    const formattedEnd = formatDate(endDate);
    
    const data = await apiCall(`/schedule/day?start_date=${formattedStart}&end_date=${formattedEnd}`);
    if (data) {
        shifts = data;
        renderCalendar();
        renderUpcomingShifts();
        renderMyShifts();
        renderTodayShifts();
    }
}

async function fetchNotifications() {
    const data = await apiCall('/notifications');
    if (data) {
        notifications = data;
        renderNotifications();
        renderRecentNotifications();
    }
}

async function fetchUsers() {
    const data = await apiCall('/users');
    if (data) {
        users = data;
        populateUserSelect();
    }
}

async function fetchSwapRequests() {
    const data = await apiCall('/swaps');
    if (data) {
        swapRequests = data;
        renderSwapRequests();
    }
}

// Функции отображения
function switchView(view) {
    currentView = view;
    tabContents.forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(view).classList.add('active');
    
    if (view === 'schedule') {
        renderCalendar();
    } else if (view === 'notifications') {
        renderNotifications();
    } else if (view === 'availability') {
        renderAvailabilityCalendar();
    }
}

function switchTab(tabId) {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    
    document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');
    document.getElementById(tabId).classList.add('active');
}

function renderCalendar() {
    const calendarEl = document.getElementById('calendar');
    const monthNames = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
    document.getElementById('currentMonth').textContent = `${monthNames[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
    
    calendarEl.innerHTML = '';
    
    const days = ['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Ndz'];
    days.forEach(day => {
        const dayEl = document.createElement('div');
        dayEl.className = 'calendar-day';
        dayEl.textContent = day;
        calendarEl.appendChild(dayEl);
    });
    
    const firstDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const lastDay = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
    const startDay = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
    
    for (let i = 0; i < startDay; i++) {
        const emptyEl = document.createElement('div');
        emptyEl.className = 'calendar-date';
        calendarEl.appendChild(emptyEl);
    }
    
    for (let i = 1; i <= lastDay.getDate(); i++) {
        const dateEl = document.createElement('div');
        dateEl.className = 'calendar-date';
        
        const dateNumber = document.createElement('div');
        dateNumber.className = 'date-number';
        dateNumber.textContent = i;
        dateEl.appendChild(dateNumber);
        
        const currentDateStr = formatDate(new Date(currentDate.getFullYear(), currentDate.getMonth(), i));
        const dayShifts = shifts.filter(shift => shift.date === currentDateStr);
        
        dayShifts.forEach(shift => {
            const shiftEl = document.createElement('div');
            shiftEl.className = `shift-item ${shift.is_coordinator ? 'shift-coordinator' : ''}`;
            shiftEl.textContent = `${shift.shift_code} (${shift.user?.full_name || 'Unknown'})`;
            shiftEl.addEventListener('click', () => showShiftDetails(shift));
            dateEl.appendChild(shiftEl);
        });
        
        calendarEl.appendChild(dateEl);
    }
}

function renderUpcomingShifts() {
    const upcomingShiftsEl = document.getElementById('upcomingShifts');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const userShifts = shifts.filter(shift => {
        const shiftDate = new Date(shift.date);
        return shift.user_id === currentUser.id && shiftDate >= today;
    }).sort((a, b) => new Date(a.date) - new Date(b.date)).slice(0, 5);
    
    if (userShifts.length === 0) {
        upcomingShiftsEl.innerHTML = '<p>Brak nadchodzących zmian</p>';
        return;
    }
    
    upcomingShiftsEl.innerHTML = userShifts.map(shift => `
        <div class="shift-item ${shift.is_coordinator ? 'shift-coordinator' : ''}">
            <strong>${formatDisplayDate(shift.date)}</strong>: ${shift.shift_code} (${shift.hours}h)
        </div>
    `).join('');
}

function renderTodayShifts() {
    const todayShiftsEl = document.getElementById('todayShifts');
    const today = new Date();
    const todayStr = formatDate(today);
    
    const userShifts = shifts.filter(shift => {
        return shift.user_id === currentUser.id && shift.date === todayStr;
    });
    
    if (userShifts.length === 0) {
        todayShiftsEl.innerHTML = '<p>Brak zmian na dzisiaj</p>';
        return;
    }
    
    todayShiftsEl.innerHTML = userShifts.map(shift => `
        <div class="shift-item ${shift.is_coordinator ? 'shift-coordinator' : ''}">
            <strong>${formatDisplayDate(shift.date)}</strong>: ${shift.shift_code} (${shift.hours}h)
            <button class="btn" data-shift-id="${shift.id}" data-action="details">Szczegóły</button>
        </div>
    `).join('');
    
    todayShiftsEl.querySelectorAll('[data-action="details"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const shiftId = btn.getAttribute('data-shift-id');
            const shift = shifts.find(s => s.id == shiftId);
            if (shift) showShiftDetails(shift);
        });
    });
}

function renderMyShifts() {
    const myShiftsEl = document.getElementById('myShifts');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const userShifts = shifts.filter(shift => shift.user_id === currentUser.id)
        .sort((a, b) => new Date(a.date) - new Date(b.date));
    
    if (userShifts.length === 0) {
        myShiftsEl.innerHTML = '<p>Brak przypisanych zmian</p>';
        return;
    }
    
    myShiftsEl.innerHTML = userShifts.map(shift => `
        <div class="shift-item ${shift.is_coordinator ? 'shift-coordinator' : ''}">
            <strong>${formatDisplayDate(shift.date)}</strong>: ${shift.shift_code} (${shift.hours}h)
            <button class="btn" data-shift-id="${shift.id}" data-action="details">Szczegóły</button>
            ${new Date(shift.date) >= today ? `
                <button class="btn btn-warning" data-shift-id="${shift.id}" data-action="request-swap">Zamiana</button>
            ` : ''}
        </div>
    `).join('');
    
    myShiftsEl.querySelectorAll('[data-action="details"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const shiftId = btn.getAttribute('data-shift-id');
            const shift = shifts.find(s => s.id == shiftId);
            if (shift) showShiftDetails(shift);
        });
    });
    
    myShiftsEl.querySelectorAll('[data-action="request-swap"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const shiftId = btn.getAttribute('data-shift-id');
            switchView('swaps');
            document.getElementById('shiftSelect').value = shiftId;
        });
    });
}

function renderNotifications() {
    const notificationsListEl = document.getElementById('notificationsList');
    
    if (notifications.length === 0) {
        notificationsListEl.innerHTML = '<p>Brak powiadomień</p>';
        return;
    }
    
    notificationsListEl.innerHTML = notifications.map(notification => `
        <div class="notification-item ${notification.is_read ? '' : 'unread'}">
            <h4>${notification.title}</h4>
            <p>${notification.message}</p>
            <small>${formatDateTime(notification.created_at)}</small>
            ${!notification.is_read ? `
                <button class="btn" data-notification-id="${notification.id}" data-action="mark-read">Oznacz jako przeczytane</button>
            ` : ''}
        </div>
    `).join('');
    
    notificationsListEl.querySelectorAll('[data-action="mark-read"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const notificationId = btn.getAttribute('data-notification-id');
            markNotificationAsRead(notificationId);
        });
    });
}

function renderRecentNotifications() {
    const recentNotificationsEl = document.getElementById('recentNotifications');
    const recentNotifications = notifications.slice(0, 3);
    
    if (recentNotifications.length === 0) {
        recentNotificationsEl.innerHTML = '<p>Brak ostatnich powiadomień</p>';
        return;
    }
    
    recentNotificationsEl.innerHTML = recentNotifications.map(notification => `
        <div class="notification-item ${notification.is_read ? '' : 'unread'}">
            <h4>${notification.title}</h4>
            <p>${notification.message}</p>
            <small>${formatDateTime(notification.created_at)}</small>
        </div>
    `).join('');
}

function renderSwapRequests() {
    const incomingRequestsEl = document.getElementById('incomingRequests');
    const outgoingRequestsEl = document.getElementById('outgoingRequests');
    
    const incoming = swapRequests.filter(req => req.to_user_id === currentUser.id && req.status === 'pending');
    if (incoming.length === 0) {
        incomingRequestsEl.innerHTML = '<p>Brak przychodzących próśb</p>';
    } else {
        incomingRequestsEl.innerHTML = incoming.map(req => `
            <div class="swap-request">
                <p><strong>${req.from_user.full_name}</strong> prosi o zamianę zmiany 
                ${req.shift.shift_code} w dniu ${formatDisplayDate(req.shift.date)}</p>
                <button class="btn btn-secondary" data-request-id="${req.id}" data-action="accept">Zaakceptuj</button>
                <button class="btn btn-danger" data-request-id="${req.id}" data-action="decline">Odrzuć</button>
            </div>
        `).join('');
        
        incomingRequestsEl.querySelectorAll('[data-action="accept"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const requestId = btn.getAttribute('data-request-id');
                respondToSwapRequest(requestId, 'accepted');
            });
        });
        
        incomingRequestsEl.querySelectorAll('[data-action="decline"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const requestId = btn.getAttribute('data-request-id');
                respondToSwapRequest(requestId, 'declined');
            });
        });
    }
    
    const outgoing = swapRequests.filter(req => req.from_user_id === currentUser.id);
    if (outgoing.length === 0) {
        outgoingRequestsEl.innerHTML = '<p>Brak wychodzących próśb</p>';
    } else {
        outgoingRequestsEl.innerHTML = outgoing.map(req => `
            <div class="swap-request">
                <p>Prośba do <strong>${req.to_user.full_name}</strong> o zamianę zmiany 
                ${req.shift.shift_code} w dniu ${formatDisplayDate(req.shift.date)}</p>
                <p>Status: <strong>${getStatusText(req.status)}</strong></p>
                ${req.status === 'pending' ? `
                    <button class="btn btn-danger" data-request-id="${req.id}" data-action="cancel">Anuluj</button>
                ` : ''}
            </div>
        `).join('');
        
        outgoingRequestsEl.querySelectorAll('[data-action="cancel"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const requestId = btn.getAttribute('data-request-id');
                cancelSwapRequest(requestId);
            });
        });
    }
}

async function renderAvailabilityCalendar() {
    const availabilityEl = document.getElementById('availabilityCalendar');
    const currentWeekStart = new Date(currentDate);
    currentWeekStart.setDate(currentDate.getDate() - currentDate.getDay() + 1);
    
    const weekDays = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(currentWeekStart);
        d.setDate(currentWeekStart.getDate() + i);
        return d;
    });
    
    document.getElementById('currentWeek').textContent = 
        `${formatDisplayDate(weekDays[0])} - ${formatDisplayDate(weekDays[6])}`;
    
    const startDate = formatDate(weekDays[0]);
    const endDate = formatDate(weekDays[6]);
    const data = await apiCall(`/availabilities?start_date=${startDate}&end_date=${endDate}`);
    
    availabilityEl.innerHTML = weekDays.map(day => {
        const dayAvailabilities = data?.filter(a => a.date === formatDate(day)) || [];
        return `
            <div class="availability-day">
                <strong>${formatDisplayDate(day)}</strong>
                <div class="availability-slots">
                    ${['morning', 'afternoon', 'evening'].map(slot => {
                        const availability = dayAvailabilities.find(a => a.slot === slot) || { status: 'unavailable' };
                        return `
                            <div class="availability-slot">
                                <span>${slot.charAt(0).toUpperCase() + slot.slice(1)}</span>
                                <div class="slot-status">
                                    <button class="status-btn ${availability.status === 'available' ? 'available active' : ''}" 
                                            data-date="${formatDate(day)}" 
                                            data-slot="${slot}" 
                                            data-status="available">Dostępny</button>
                                    <button class="status-btn ${availability.status === 'unavailable' ? 'unavailable active' : ''}" 
                                            data-date="${formatDate(day)}" 
                                            data-slot="${slot}" 
                                            data-status="unavailable">Niedostępny</button>
                                    <button class="status-btn ${availability.status === 'preferred' ? 'active' : ''}" 
                                            data-date="${formatDate(day)}" 
                                            data-slot="${slot}" 
                                            data-status="preferred">Preferowany</button>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }).join('');
    
    availabilityEl.querySelectorAll('.status-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const date = btn.getAttribute('data-date');
            const slot = btn.getAttribute('data-slot');
            const status = btn.getAttribute('data-status');
            
            const data = await apiCall('/availabilities', {
                method: 'POST',
                body: { date, slot, status }
            });
            
            if (data) {
                showNotification('Dostępność zaktualizowana', 'success');
                renderAvailabilityCalendar();
            }
        });
    });
}

async function saveAvailability() {
    showNotification('Dostępność zapisana', 'success');
}

function populateUserSelect() {
    const userSelect = document.getElementById('targetUser');
    userSelect.innerHTML = '';
    
    users.filter(user => user.id !== currentUser.id).forEach(user => {
        const option = document.createElement('option');
        option.value = user.id;
        option.textContent = user.full_name;
        userSelect.appendChild(option);
    });
    
    const shiftSelect = document.getElementById('shiftSelect');
    shiftSelect.innerHTML = '';
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    shifts.filter(shift => {
        const shiftDate = new Date(shift.date);
        return shift.user_id === currentUser.id && shiftDate >= today;
    }).forEach(shift => {
        const option = document.createElement('option');
        option.value = shift.id;
        option.textContent = `${formatDisplayDate(shift.date)}: ${shift.shift_code}`;
        shiftSelect.appendChild(option);
    });
}

// Вспомогательные функции
function formatDate(date) {
    return date.toISOString().split('T')[0];
}

function formatDisplayDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('pl-PL');
}

function formatDateTime(dateTimeString) {
    const date = new Date(dateTimeString);
    return date.toLocaleString('pl-PL');
}

function getStatusText(status) {
    const statusMap = {
        'pending': 'Oczekujące',
        'accepted': 'Zaakceptowane',
        'declined': 'Odrzucone',
        'cancelled': 'Anulowane'
    };
    return statusMap[status] || status;
}

function applySettings(theme, fontSize) {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.setProperty('--font-size-base', {
        'small': '14px',
        'medium': '16px',
        'large': '18px'
    }[fontSize]);
    
    localStorage.setItem('theme', theme);
    localStorage.setItem('fontSize', fontSize);
}

function showNotification(message, type = 'info') {
    const notificationEl = document.createElement('div');
    notificationEl.className = `notification ${type}`;
    notificationEl.textContent = message;
    notificationEl.style.position = 'fixed';
    notificationEl.style.top = '20px';
    notificationEl.style.right = '20px';
    notificationEl.style.padding = '1rem';
    notificationEl.style.borderRadius = '4px';
    notificationEl.style.backgroundColor = {
        'info': 'var(--primary-color)',
        'success': 'var(--secondary-color)',
        'error': 'var(--danger-color)'
    }[type];
    notificationEl.style.color = 'white';
    notificationEl.style.zIndex = '2000';
    document.body.appendChild(notificationEl);
    
    setTimeout(() => {
        notificationEl.remove();
    }, 3000);
}

// Обработчики действий
function showLoginModal() {
    loginModal.classList.add('show');
}

async function handleLogin(e) {
    e.preventDefault();
    console.log('Attempting login...', new Date().toISOString());
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    console.log('Login data:', { email, password });

    const data = await apiCall('/login', {
        method: 'POST',
        body: { email, password }
    });
    console.log('Login response:', data);
    if (data && data.access_token) {
        console.log('Login successful, token received:', data.access_token);
        authToken = data.access_token;
        localStorage.setItem('authToken', authToken);
        console.log('Token saved:', authToken);
        loginModal.classList.remove('show');
        fetchUserProfile();
    } else {
        console.error('Login failed:', data);
        showNotification('Błąd logowania. Sprawdź dane i spróbuj ponownie.', 'error');
    }
}

function logout() {
    authToken = null;
    currentUser = null;
    localStorage.removeItem('authToken');
    showLoginModal();
}

function showShiftDetails(shift) {
    const contentEl = document.getElementById('shiftDetailsContent');
    contentEl.innerHTML = `
        <p><strong>Data:</strong> ${formatDisplayDate(shift.date)}</p>
        <p><strong>Zmiana:</strong> ${shift.shift_code}</p>
        <p><strong>Godziny:</strong> ${shift.hours}h</p>
        <p><strong>Pracownik:</strong> ${shift.user?.full_name || 'Unknown'}</p>
        ${shift.is_coordinator ? '<p><strong>Koordynator</strong></p>' : ''}
        ${shift.color_hex ? `<p><strong>Kolor:</strong> <span style="background-color: ${shift.color_hex}; padding: 2px 5px; border-radius: 3px;">${shift.color_hex}</span></p>` : ''}
        ${shift.actual_start ? `<p><strong>Rozpoczęcie:</strong> ${formatDateTime(shift.actual_start)}</p>` : ''}
        ${shift.actual_end ? `<p><strong>Zakończenie:</strong> ${formatDateTime(shift.actual_end)}</p>` : ''}
        
        ${shift.user_id === currentUser.id ? `
            <div style="margin-top: 1rem;">
                ${!shift.actual_start ? `
                    <button class="btn" id="checkInBtn">Zamelduj przyjście</button>
                ` : ''}
                ${shift.actual_start && !shift.actual_end ? `
                    <button class="btn" id="checkOutBtn">Zamelduj wyjście</button>
                ` : ''}
            </div>
        ` : ''}
    `;
    
    if (shift.user_id === currentUser.id) {
        if (!shift.actual_start) {
            document.getElementById('checkInBtn').addEventListener('click', () => {
                checkIn(shift.id);
            });
        }
        
        if (shift.actual_start && !shift.actual_end) {
            document.getElementById('checkOutBtn').addEventListener('click', () => {
                checkOut(shift.id);
            });
        }
    }
    
    shiftDetailsModal.classList.add('show');
}

async function checkIn(shiftId) {
    const data = await apiCall(`/shifts/${shiftId}/check-in`, {
        method: 'POST'
    });
    
    if (data) {
        showNotification('Zarejestrowano przyjście', 'success');
        shiftDetailsModal.classList.remove('show');
        fetchShifts();
    }
}

async function checkOut(shiftId) {
    const data = await apiCall(`/shifts/${shiftId}/check-out`, {
        method: 'POST'
    });
    
    if (data) {
        showNotification('Zarejestrowano wyjście', 'success');
        shiftDetailsModal.classList.remove('show');
        fetchShifts();
    }
}

function showProfileModal() {
    if (!currentUser) return;
    
    document.getElementById('profileName').value = currentUser.full_name;
    document.getElementById('profileEmail').value = currentUser.email;
    document.getElementById('profilePhone').value = currentUser.phone || '';
    
    profileModal.classList.add('show');
}

async function updateProfile(e) {
    e.preventDefault();
    const fullName = document.getElementById('profileName').value;
    const email = document.getElementById('profileEmail').value;
    const phone = document.getElementById('profilePhone').value;
    
    const data = await apiCall('/profile', {
        method: 'PUT',
        body: { full_name: fullName, email, phone }
    });
    
    if (data) {
        showNotification('Profil zaktualizowany', 'success');
        profileModal.classList.remove('show');
        fetchUserProfile();
    }
}

function showSettingsModal() {
    if (!currentUser) return;
    
    document.getElementById('languageSelect').value = currentUser.language || 'pl';
    document.getElementById('themeSelect').value = currentUser.theme || 'light';
    document.getElementById('fontSizeSelect').value = currentUser.font_size || 'medium';
    document.getElementById('quietHoursStart').value = currentUser.quiet_hours_start || 22;
    document.getElementById('quietHoursEnd').value = currentUser.quiet_hours_end || 8;
    
    settingsModal.classList.add('show');
}

async function updateSettings(e) {
    e.preventDefault();
    const language = document.getElementById('languageSelect').value;
    const theme = document.getElementById('themeSelect').value;
    const fontSize = document.getElementById('fontSizeSelect').value;
    const quietHoursStart = parseInt(document.getElementById('quietHoursStart').value);
    const quietHoursEnd = parseInt(document.getElementById('quietHoursEnd').value);
    const fcmToken = currentUser.fcm_token;
    
    const data = await apiCall('/profile', {
        method: 'PUT',
        body: {
            language,
            theme,
            font_size: fontSize,
            quiet_hours_start: quietHoursStart,
            quiet_hours_end: quietHoursEnd,
            fcm_token: fcmToken
        }
    });
    
    if (data) {
        showNotification('Ustawienia zaktualizowane', 'success');
        settingsModal.classList.remove('show');
        applySettings(theme, fontSize);
        fetchUserProfile();
    }
}

async function requestSwap(e) {
    e.preventDefault();
    const shiftId = document.getElementById('shiftSelect').value;
    const targetUserId = document.getElementById('targetUser').value;
    
    const data = await apiCall('/swaps', {
        method: 'POST',
        body: {
            shift_id: parseInt(shiftId),
            to_user_id: parseInt(targetUserId)
        }
    });
    
    if (data) {
        showNotification('Prośba o zamianę wysłana', 'success');
        document.getElementById('swapRequestForm').reset();
        fetchSwapRequests();
    }
}

async function respondToSwapRequest(requestId, response) {
    const data = await apiCall(`/swaps/${requestId}/${response}`, {
        method: 'POST'
    });
    
    if (data) {
        showNotification(`Prośba ${response === 'accepted' ? 'zaakceptowana' : 'odrzucona'}`, 'success');
        fetchSwapRequests();
        fetchShifts();
    }
}

async function cancelSwapRequest(requestId) {
    const data = await apiCall(`/swaps/${requestId}/cancel`, {
        method: 'POST'
    });
    
    if (data) {
        showNotification('Prośba anulowana', 'success');
        fetchSwapRequests();
    }
}

async function markNotificationAsRead(notificationId) {
    const data = await apiCall(`/notifications/${notificationId}/read`, {
        method: 'POST'
    });
    
    if (data) {
        fetchNotifications();
    }
}

// Инициализация календаря при загрузке
renderCalendar();
