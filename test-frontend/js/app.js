// Configuration
const API_BASE_URL = 'http://localhost:3000/api/v1';

// State Management
const State = {
    token: localStorage.getItem('accessToken'),
    user: JSON.parse(localStorage.getItem('user') || 'null'),

    setAuth: (data) => {
        State.token = data.tokens.accessToken;
        State.user = data.user;
        localStorage.setItem('accessToken', State.token);
        localStorage.setItem('user', JSON.stringify(State.user));
    },

    clearAuth: () => {
        State.token = null;
        State.user = null;
        localStorage.removeItem('accessToken');
        localStorage.removeItem('user');
        window.location.href = 'index.html';
    },

    getHeaders: () => {
        const headers = {
            'Content-Type': 'application/json'
        };
        if (State.token) {
            headers['Authorization'] = `Bearer ${State.token}`;
        }
        return headers;
    }
};

// API Client
const API = {
    async request(endpoint, method = 'GET', body = null) {
        try {
            const options = {
                method,
                headers: State.getHeaders()
            };
            if (body) options.body = JSON.stringify(body);

            const res = await fetch(`${API_BASE_URL}${endpoint}`, options);
            const data = await res.json();

            if (!res.ok) {
                // Handle 401 Unauthorized
                if (res.status === 401) State.clearAuth();
                throw new Error(data.message || 'API Error');
            }
            return data;
        } catch (err) {
            UI.showToast(err.message, 'error');
            throw err;
        }
    },

    // Auth
    auth: {
        getWidgetConfig: () => API.request('/auth/widget-config'),
        verifyToken: (accessToken) => API.request('/auth/verify-widget-token', 'POST', { accessToken }),
        register: (name, verificationToken) => API.request('/auth/register', 'POST', { name, verificationToken }),
    },

    // Trips
    trips: {
        create: (data) => API.request('/trips', 'POST', data),
        list: () => API.request('/trips'),
        get: (id) => API.request(`/trips/${id}`),
        updateStatus: (id, status, lat, lng) => API.request(`/trips/${id}/status`, 'PATCH', { status, latitude: lat, longitude: lng }),
    },

    // Trucks
    trucks: {
        create: (data) => API.request('/trucks', 'POST', data),
        list: () => API.request('/trucks'),
    },

    // Drivers
    drivers: {
        create: (data) => API.request('/drivers', 'POST', data),
        list: () => API.request('/drivers'),
    },

    // Tracking
    tracking: {
        ping: (data) => API.request('/tracking/ping', 'POST', data),
        getLatest: (tripId) => API.request(`/tracking/${tripId}/latest`),
        getHistory: (tripId) => API.request(`/tracking/${tripId}/history`),
    },

    // Chat
    chat: {
        getThreads: () => API.request('/chat/threads'),
        getMessages: (threadId) => API.request(`/chat/threads/${threadId}/messages`),
        sendMessage: (threadId, content) => API.request(`/chat/threads/${threadId}/messages`, 'POST', { content, type: 'TEXT' }),
        createThread: (data) => API.request('/chat/threads', 'POST', data),
    }
};

// Real-time Socket Wrapper
const Socket = {
    io: null,

    connect: () => {
        if (!State.token) return;
        if (Socket.io && Socket.io.connected) return;

        // Ensure socket.io is loaded
        if (typeof io === 'undefined') {
            console.error("Socket.io client not loaded");
            return;
        }

        Socket.io = io('http://localhost:3000', {
            path: '/socket.io/',
            auth: { token: State.token },
            transports: ['websocket']
        });

        Socket.io.on('connect', () => {
            console.log('✅ Socket Connected:', Socket.io.id);
            UI.showToast('Real-time connection established');
        });

        Socket.io.on('connect_error', (err) => {
            console.error('Socket Error:', err);
            // UI.showToast('Socket connection failed', 'error');
        });
    },

    subscribeTrip: (tripId) => Socket.io?.emit('tracking:subscribe', { tripId }),
    unsubscribeTrip: (tripId) => Socket.io?.emit('tracking:unsubscribe', { tripId }),

    joinChat: (threadId) => Socket.io?.emit('chat:join', { threadId }),
    leaveChat: (threadId) => Socket.io?.emit('chat:leave', { threadId }),

    on: (event, callback) => Socket.io?.on(event, callback),
    off: (event) => Socket.io?.off(event)
};

// UI Utilities
const UI = {
    showToast: (msg, type = 'success') => {
        const toast = document.createElement('div');
        toast.className = `fixed top-5 right-5 px-6 py-3 rounded-lg text-white shadow-xl z-50 transform transition-all duration-300 translate-y-0 ${type === 'error' ? 'bg-red-500' : 'bg-green-500'
            }`;
        toast.textContent = msg;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    },

    setLoading: (btnId, isLoading) => {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        if (isLoading) {
            btn.dataset.original = btn.innerHTML;
            btn.innerHTML = `<span class="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></span>Loading...`;
            btn.disabled = true;
        } else {
            btn.innerHTML = btn.dataset.original;
            btn.disabled = false;
        }
    },

    renderList: (containerId, items, renderFn, emptyMsg = 'No items found') => {
        const el = document.getElementById(containerId);
        if (!el) return;
        if (!items || items.length === 0) {
            el.innerHTML = `<div class="p-4 text-center text-gray-500 bg-gray-50 rounded italic">${emptyMsg}</div>`;
            return;
        }
        el.innerHTML = items.map(renderFn).join(''); // Fixed map call
    }
};
