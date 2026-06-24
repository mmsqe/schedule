        // Firebase Configuration
        const firebaseConfig = {
            apiKey: "AIzaSyCpAAex1hdFHLiNiEkRNK2J-2gPjnH7Dvs",
            authDomain: "marcus-f191d.firebaseapp.com",
            projectId: "marcus-f191d",
            storageBucket: "marcus-f191d.firebasestorage.app",
            messagingSenderId: "100344969516",
            appId: "1:100344969516:web:5d00ea7faa2b6b0af49489",
            databaseURL: "https://marcus-f191d-default-rtdb.asia-southeast1.firebasedatabase.app"
        };

        // Initialize Firebase
        firebase.initializeApp(firebaseConfig);
        const database = firebase.database();

        // State
        let state = {
            view: 'weekly',
            currentDay: 'monday',
            monthDate: new Date(),
            weekDate: new Date(),
            startHour: 7,
            endHour: 23,
            showWeekends: true,
            title: 'Schedule Maker',
            selectedColor: '#4A90A4',
            editingEventId: null,
            editingEventDate: null,      // YMD of the occurrence being edited, if known
            editingExcludeDates: [],     // working copy of the event's skipped dates
            copiedEvent: null,
            syncRoomId: null,
            editKey: null,
            viewOnly: true,  // Default to view-only for safety
            events: {
                monday: [],
                tuesday: [],
                wednesday: [],
                thursday: [],
                friday: [],
                saturday: [],
                sunday: []
            }
        };

        let syncListener = null;

        const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        const dayNamesShort = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

        // Shorthand for document.getElementById
        const $ = document.getElementById.bind(document);

        // Palette for event colours; also rendered as the modal's swatch grid.
        const COLORS = ['#4A90A4', '#7B68EE', '#E57373', '#81C784', '#FFB74D', '#F06292', '#90A4AE', '#9575CD'];

        // Generate the repeated controls from data so the weekday/colour lists
        // live in one place instead of being duplicated in markup. Runs before the
        // cached NodeLists below so they pick up the generated .day-btn/.color-option.
        function buildControls() {
            $('daySelectorDaily').innerHTML = days
                .map((d, i) => `<button class="day-btn" data-day="${d}">${dayNamesShort[i]}</button>`).join('');
            $('eventDay').innerHTML = days
                .map((d, i) => `<option value="${d}">${dayNames[i]}</option>`).join('');
            $('colorPicker').innerHTML = COLORS
                .map((c, i) => `<div class="color-option${i === 0 ? ' selected' : ''}" data-color="${c}" style="background: ${c};"></div>`).join('');
        }
        buildControls();

        // DOM Elements
        const calendarGrid = $('calendarGrid');
        const eventModal = $('eventModal');
        const settingsModal = $('settingsModal');
        const exportModal = $('exportModal');
        const shareModal = $('shareModal');
        const syncModal = $('syncModal');
        const viewToggleBtns = document.querySelectorAll('.view-toggle button');
        const dayBtns = document.querySelectorAll('.day-btn');
        const colorOptions = document.querySelectorAll('.color-option');

        // LocalStorage functions
        const STORAGE_KEY = 'schedulemaker_data';

        // Each room caches its own data so switching rooms never shows another
        // room's events. Standalone (no room) uses the base key.
        function currentStorageKey() {
            return state.syncRoomId ? STORAGE_KEY + '_' + state.syncRoomId : STORAGE_KEY;
        }

        // The persistable slice of state (shared by local cache and Firebase sync).
        function scheduleSnapshot() {
            return {
                events: state.events,
                startHour: state.startHour,
                endHour: state.endHour,
                showWeekends: state.showWeekends,
                title: state.title
            };
        }

        function persistLocal() {
            localStorage.setItem(currentStorageKey(), JSON.stringify(scheduleSnapshot()));
        }

        // Apply a loaded/synced schedule object onto state. Always resets every day
        // (Firebase drops empty arrays) so removed events don't linger.
        function applyScheduleData(data) {
            days.forEach(day => {
                const list = (data.events && data.events[day]) || [];
                // Firebase may return an array field as an object ({0:..,1:..});
                // normalise excludeDates back to a plain array so .includes works.
                list.forEach(ev => {
                    if (ev.excludeDates && !Array.isArray(ev.excludeDates)) {
                        ev.excludeDates = Object.values(ev.excludeDates);
                    }
                });
                state.events[day] = list;
            });
            if (data.startHour) state.startHour = data.startHour;
            if (data.endHour) state.endHour = data.endHour;
            if (typeof data.showWeekends === 'boolean') state.showWeekends = data.showWeekends;
            if (data.title) state.title = data.title;
        }

        function saveState() {
            persistLocal();
            if (state.syncRoomId) syncToFirebase();
        }

        function syncToFirebase() {
            if (!state.syncRoomId || state.viewOnly) return;

            // An editor must always have an edit key. Without this, Firebase drops
            // the null value and the room ends up with synced events but no editKey,
            // leaving nobody able to claim edit access.
            if (!state.editKey) {
                state.editKey = generateEditKey();
                localStorage.setItem('schedulemaker_editKey_' + state.syncRoomId, state.editKey);
            }

            const dataToSync = {
                ...scheduleSnapshot(),
                editKey: state.editKey,
                lastUpdated: Date.now()
            };

            database.ref('rooms/' + state.syncRoomId).set(dataToSync)
                .then(() => showToast('Saved & synced', 'success'))
                .catch(err => {
                    console.error('Sync error:', err);
                    const msg = (err && /permission/i.test(err.message || ''))
                        ? "Couldn't sync: permission denied for this room."
                        : "Couldn't sync to server. Changes saved locally only.";
                    showToast(msg, 'error');
                });
        }

        // Lightweight, non-blocking toast for sync feedback
        let toastTimer = null;
        function showToast(message, type = 'info') {
            let toast = $('toast');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'toast';
                toast.className = 'toast';
                document.body.appendChild(toast);
            }
            toast.textContent = message;
            toast.classList.remove('success', 'error', 'info', 'show');
            toast.classList.add(type);
            // Force reflow so re-triggering the animation works
            void toast.offsetWidth;
            toast.classList.add('show');
            if (toastTimer) clearTimeout(toastTimer);
            toastTimer = setTimeout(() => toast.classList.remove('show'),
                type === 'error' ? 5000 : 2000);
        }

        function loadState() {
            const saved = localStorage.getItem(currentStorageKey());
            if (!saved) return;
            try {
                applyScheduleData(JSON.parse(saved));
            } catch (e) {
                console.error('Failed to load saved data:', e);
            }
        }

        let joiningFromUrl = false;
        let dayFromUrl = false;

        function loadFromUrl() {
            const params = new URLSearchParams(window.location.search);

            // View state (applies to room, legacy, and plain URLs)
            const view = params.get('view');
            if (view === 'weekly' || view === 'daily' || view === 'monthly') {
                state.view = view;
            }
            const monthParam = params.get('month');
            if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
                const [y, m] = monthParam.split('-').map(Number);
                state.monthDate = new Date(y, m - 1, 1);
            }
            const dayParam = params.get('day');
            if (dayParam && days.includes(dayParam)) {
                state.currentDay = dayParam;
                dayFromUrl = true;
            }
            const weekParam = params.get('week');
            if (weekParam && /^\d{4}-\d{2}-\d{2}$/.test(weekParam)) {
                const [y, mo, d] = weekParam.split('-').map(Number);
                state.weekDate = new Date(y, mo - 1, d);
            }

            // Check for room code first (short URL)
            const roomCode = params.get('room');
            if (roomCode) {
                joiningFromUrl = true;
                // Check for edit key - if valid, allow editing
                const editKey = params.get('key');
                state.editKey = editKey || null;
                // Default to view-only, will verify key after joining
                state.viewOnly = true;
                // Will join room after init completes
                setTimeout(() => joinRoom(roomCode.toUpperCase(), false, editKey), 100);
                return true;
            }

            // Legacy: check for compressed data URL
            const data = params.get('s');
            if (data) {
                try {
                    const json = LZString.decompressFromEncodedURIComponent(data);
                    const parsed = JSON.parse(json);

                    // Restore events with full structure
                    if (parsed.e) {
                        days.forEach(day => {
                            if (parsed.e[day]) {
                                state.events[day] = parsed.e[day].map(e => ({
                                    id: Date.now() + Math.random(),
                                    title: e.t,
                                    location: e.l || '',
                                    start: e.s,
                                    end: e.e,
                                    color: e.c,
                                    startDate: e.sd || '',
                                    endDate: e.ed || '',
                                    ...(Array.isArray(e.xd) && e.xd.length ? { excludeDates: e.xd } : {})
                                }));
                            }
                        });
                    }
                    if (parsed.h) {
                        state.startHour = parsed.h[0];
                        state.endHour = parsed.h[1];
                    }
                    if (typeof parsed.w !== 'undefined') state.showWeekends = parsed.w === 1;
                    return true;
                } catch (e) {
                    console.error('Failed to load from URL:', e);
                }
            }
            return false;
        }

        // Title function
        function updateTitle() {
            const headerTitle = document.querySelector('.header h1');
            const displayTitle = state.title || 'Schedule Maker';
            document.title = displayTitle;
            if (!state.viewOnly) {
                headerTitle.textContent = displayTitle;
            } else {
                headerTitle.innerHTML = displayTitle + ' <span style="font-size: 0.7rem; background: #1976d2; color: white; padding: 2px 8px; border-radius: 4px; margin-left: 8px;">VIEW ONLY</span>';
            }
        }

        // ---- Day / Night theme (auto by time, manual override) ----
        const THEME_KEY = 'schedulemaker_theme'; // 'auto' | 'light' | 'dark'
        let themeAutoTimer = null;
        const THEME_ICONS = {
            light: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path></svg>',
            dark: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>'
        };
        function getThemeMode() { return localStorage.getItem(THEME_KEY) || 'auto'; }
        function autoThemeByTime() {
            const h = new Date().getHours();
            return (h < 7 || h >= 19) ? 'dark' : 'light';
        }
        function updateThemeButton(mode, theme) {
            const icon = $('themeIcon'), label = $('themeLabel');
            if (icon) icon.innerHTML = THEME_ICONS[theme] || THEME_ICONS.light;
            if (label) label.textContent = mode === 'auto' ? 'Auto' : (mode === 'dark' ? 'Night' : 'Day');
        }
        // In 'auto' mode, flip the theme if time-of-day now calls for a different one.
        function refreshAutoTheme() {
            if (getThemeMode() !== 'auto') return;
            const t = autoThemeByTime();
            if (t !== document.body.getAttribute('data-theme')) {
                document.body.setAttribute('data-theme', t);
                updateThemeButton('auto', t);
                renderCalendar();
            }
        }

        function applyTheme() {
            const mode = getThemeMode();
            const theme = mode === 'auto' ? autoThemeByTime() : mode;
            document.body.setAttribute('data-theme', theme);
            updateThemeButton(mode, theme);
            // Keep 'Auto' fresh: timer (tab left open) + visibility/focus (instant catch-up).
            if (!themeAutoTimer) {
                themeAutoTimer = setInterval(refreshAutoTheme, 60 * 1000);
                document.addEventListener('visibilitychange', () => {
                    if (!document.hidden) refreshAutoTheme();
                });
                window.addEventListener('focus', refreshAutoTheme);
            }
        }
        function cycleTheme() {
            const order = ['auto', 'light', 'dark'];
            const next = order[(order.indexOf(getThemeMode()) + 1) % order.length];
            localStorage.setItem(THEME_KEY, next);
            applyTheme();
            renderCalendar();
        }

        // Initialize
        init();

        function init() {
            applyTheme();
            // Resolve the room BEFORE loadState so we read this room's own cache.
            const params = new URLSearchParams(window.location.search);
            const urlRoom = params.get('room');
            const savedRoom = localStorage.getItem('schedulemaker_syncRoom');
            if (urlRoom) {
                state.syncRoomId = urlRoom.toUpperCase();
            } else if (savedRoom) {
                state.syncRoomId = savedRoom;
            }

            // Load this room's (or standalone) cached data first
            loadState();

            // Then check URL for room/key
            const fromUrl = loadFromUrl();
            if (!fromUrl) {
                // Not joining from URL, allow editing by default
                state.viewOnly = false;
            }
            renderCalendar();
            setupEventListeners();
            setActiveDay();
            syncViewControls();
            // Auto-reconnect to Firebase sync room if previously connected
            autoReconnectSync();
            // Update UI for view-only mode
            updateViewOnlyUI();
            // Update title
            updateTitle();
        }

        function updateViewOnlyUI() {
            const addBtn = $('addBtn');
            const resetBtn = $('resetBtn');

            if (state.viewOnly) {
                addBtn.style.opacity = '0.5';
                addBtn.style.cursor = 'not-allowed';
                resetBtn.style.opacity = '0.5';
                resetBtn.style.cursor = 'not-allowed';
            } else {
                addBtn.style.opacity = '1';
                addBtn.style.cursor = 'pointer';
                resetBtn.style.opacity = '1';
                resetBtn.style.cursor = 'pointer';
            }
            updateTitle();
        }

        function setupEventListeners() {
            // Title click to edit
            document.querySelector('.header h1').addEventListener('click', () => {
                if (state.viewOnly) return;
                const newTitle = prompt('Enter schedule title:', state.title || 'Schedule Maker');
                if (newTitle !== null) {
                    state.title = newTitle.trim() || 'Schedule Maker';
                    updateTitle();
                    saveState();
                }
            });

            // View toggle
            viewToggleBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    viewToggleBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    state.view = btn.dataset.view;
                    syncViewControls();
                    renderCalendar();
                });
            });

            // Day selector for daily view
            dayBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    dayBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    state.currentDay = btn.dataset.day;
                    renderCalendar();
                });
            });

            // Month navigation for monthly view
            $('prevMonth').addEventListener('click', () => {
                state.monthDate = new Date(state.monthDate.getFullYear(), state.monthDate.getMonth() - 1, 1);
                renderCalendar();
            });
            $('nextMonth').addEventListener('click', () => {
                state.monthDate = new Date(state.monthDate.getFullYear(), state.monthDate.getMonth() + 1, 1);
                renderCalendar();
            });

            // Week navigation for weekly / daily views
            $('prevWeek').addEventListener('click', () => {
                state.weekDate = new Date(state.weekDate.getTime() - 7 * 86400000);
                renderCalendar();
            });
            $('nextWeek').addEventListener('click', () => {
                state.weekDate = new Date(state.weekDate.getTime() + 7 * 86400000);
                renderCalendar();
            });
            $('weekLabel').addEventListener('click', () => {
                state.weekDate = new Date();
                renderCalendar();
            });

            // Color picker
            colorOptions.forEach(option => {
                option.addEventListener('click', () => {
                    colorOptions.forEach(o => o.classList.remove('selected'));
                    option.classList.add('selected');
                    state.selectedColor = option.dataset.color;
                });
            });

            // Sidebar buttons
            $('addBtn').addEventListener('click', () => {
                if (state.viewOnly) {
                    alert('View-only mode. You cannot add events.');
                    return;
                }
                openEventModal();
            });
            $('settingsBtn').addEventListener('click', () => openSettingsModal());
            $('shareBtn').addEventListener('click', () => openShareModal());
            $('syncBtn').addEventListener('click', () => openSyncModal());
            $('exportBtn').addEventListener('click', () => openExportModal());
            $('resetBtn').addEventListener('click', () => {
                if (state.viewOnly) {
                    alert('View-only mode. You cannot reset.');
                    return;
                }
                resetSchedule();
            });
            $('themeBtn').addEventListener('click', cycleTheme);

            // Modal buttons
            $('modalClose').addEventListener('click', closeEventModal);
            $('cancelEvent').addEventListener('click', closeEventModal);
            $('saveEvent').addEventListener('click', saveEvent);
            $('deleteEvent').addEventListener('click', deleteEvent);
            $('copyEvent').addEventListener('click', copyEvent);
            $('pasteEvent').addEventListener('click', pasteEvent);

            // Stage the current occurrence's date into the skip list.
            $('skipThisDate').addEventListener('click', () => {
                const d = state.editingEventDate;
                if (d && !state.editingExcludeDates.includes(d)) {
                    state.editingExcludeDates.push(d);
                    renderSkipUI(true);
                }
            });
            // Remove a date from the skip list (delegated to the chip × buttons).
            $('skipChips').addEventListener('click', (e) => {
                const d = e.target.dataset.skip;
                if (!d) return;
                state.editingExcludeDates = state.editingExcludeDates.filter(x => x !== d);
                renderSkipUI(true);
            });

            // Close modals on overlay click
            eventModal.addEventListener('click', (e) => {
                if (e.target === eventModal) closeEventModal();
            });
            settingsModal.addEventListener('click', (e) => {
                if (e.target === settingsModal) closeSettingsModal();
            });
            exportModal.addEventListener('click', (e) => {
                if (e.target === exportModal) closeExportModal();
            });
            shareModal.addEventListener('click', (e) => {
                if (e.target === shareModal) closeShareModal();
            });
            syncModal.addEventListener('click', (e) => {
                if (e.target === syncModal) closeSyncModal();
            });
        }

        function setActiveDay() {
            // Keep a URL-specified day; otherwise default to today
            if (!dayFromUrl) {
                state.currentDay = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
            }
            dayBtns.forEach(btn => {
                btn.classList.toggle('active', btn.dataset.day === state.currentDay);
            });
        }

        // Reflect state.view in the toggle buttons and day/week/month selectors
        function syncViewControls() {
            viewToggleBtns.forEach(b => b.classList.toggle('active', b.dataset.view === state.view));
            $('daySelectorDaily').style.display =
                state.view === 'daily' ? 'flex' : 'none';
            $('weekSelector').style.display =
                (state.view === 'weekly' || state.view === 'daily') ? 'flex' : 'none';
            $('monthSelector').style.display =
                state.view === 'monthly' ? 'flex' : 'none';
        }

        // Update the "Jun 8 – 14" week-range label
        function updateWeekLabel() {
            const monday = startOfWeek(state.weekDate);
            const sunday = new Date(monday);
            sunday.setDate(sunday.getDate() + 6);
            const opts = { month: 'short', day: 'numeric' };
            const left = monday.toLocaleDateString('en-US', opts);
            const right = sunday.getMonth() === monday.getMonth()
                ? sunday.getDate()
                : sunday.toLocaleDateString('en-US', opts);
            $('weekLabel').textContent = `${left} – ${right}`;
        }

        function renderCalendar() {
            syncUrl();
            if (state.view === 'monthly') {
                renderMonthly();
                attachMonthHandlers();
                return;
            }

            updateWeekLabel();

            const visibleDays = state.showWeekends ? days : days.slice(0, 5);
            const totalHours = state.endHour - state.startHour;

            // Time column
            let timeLabels = '';
            for (let h = state.startHour; h <= state.endHour; h++) {
                const hour = h % 12 || 12;
                const ampm = h >= 12 ? 'PM' : 'AM';
                timeLabels += `<div class="time-label">${hour} ${ampm}</div>`;
            }

            if (state.view === 'weekly') {
                // Weekly view - the week containing today, with real dates
                const todayYMD = toYMD(new Date());

                let dayColumns = '';
                visibleDays.forEach((day, index) => {
                    const dayIndex = days.indexOf(day);
                    const colDate = dateForWeekday(day);
                    const isToday = toYMD(colDate) === todayYMD;

                    let hourSlots = '';
                    for (let h = state.startHour; h < state.endHour; h++) {
                        hourSlots += `<div class="hour-slot" data-day="${day}" data-hour="${h}"></div>`;
                    }

                    const events = renderDayEvents(day, colDate);

                    dayColumns += `
                        <div class="day-column">
                            <div class="day-header ${isToday ? 'today' : ''}">${dayNamesShort[dayIndex]} <span style="font-weight:400; opacity:0.7;">${colDate.getDate()}</span></div>
                            <div class="day-events" style="height: ${totalHours * 60}px;">
                                ${hourSlots}
                                ${events}
                            </div>
                        </div>
                    `;
                });

                calendarGrid.innerHTML = `
                    <div class="time-column">
                        <div class="time-header">&nbsp;</div>
                        ${timeLabels}
                    </div>
                    <div class="days-container">${dayColumns}</div>
                `;
            } else {
                // Daily view - the selected weekday within the current week
                const dayIndex = days.indexOf(state.currentDay);
                const colDate = dateForWeekday(state.currentDay);
                const dateLabel = colDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

                let hourSlots = '';
                for (let h = state.startHour; h < state.endHour; h++) {
                    hourSlots += `<div class="hour-slot" data-day="${state.currentDay}" data-hour="${h}"></div>`;
                }

                const events = renderDayEvents(state.currentDay, colDate);

                calendarGrid.innerHTML = `
                    <div class="time-column">
                        <div class="time-header">&nbsp;</div>
                        ${timeLabels}
                    </div>
                    <div class="days-container">
                        <div class="day-column" style="flex: 1;">
                            <div class="day-header">${dayNames[dayIndex]} <span style="font-weight:400; opacity:0.7;">${dateLabel}</span></div>
                            <div class="day-events" style="height: ${totalHours * 60}px;">
                                ${hourSlots}
                                ${events}
                            </div>
                        </div>
                    </div>
                `;
            }

            // Add click handlers for hour slots (disabled in view-only mode)
            document.querySelectorAll('.hour-slot').forEach(slot => {
                slot.addEventListener('click', (e) => {
                    if (state.viewOnly) return;
                    const day = slot.dataset.day;
                    const hour = parseInt(slot.dataset.hour);
                    openEventModal(null, day, hour);
                });
            });

            // Add click handlers for events (disabled in view-only mode)
            document.querySelectorAll('.event-block').forEach(block => {
                block.addEventListener('click', (e) => {
                    if (state.viewOnly) return;
                    if (suppressNextClick) return;
                    e.stopPropagation();
                    const eventId = block.dataset.id;
                    const day = block.dataset.day;
                    const dayEvents = state.events[day] || [];
                    // Compare as strings since Firebase might change types
                    const event = dayEvents.find(ev => String(ev.id) === String(eventId));
                    if (event) {
                        openEventModal(event, day, null, parseYMD(block.dataset.date));
                    }
                });
            });

            // Initialize drag & drop
            initDragHandlers();
        }

        // --- Date helpers for per-event start/end date ranges ---
        function toYMD(date) {
            const y = date.getFullYear();
            const m = (date.getMonth() + 1).toString().padStart(2, '0');
            const d = date.getDate().toString().padStart(2, '0');
            return `${y}-${m}-${d}`;
        }

        // Parse a 'YYYY-MM-DD' string into a local Date (null/empty -> null)
        function parseYMD(ymd) {
            if (!ymd) return null;
            const [y, m, d] = ymd.split('-').map(Number);
            return new Date(y, m - 1, d);
        }

        // Human-friendly label for a YMD string, e.g. "Mon, 29 Jun 2026"
        function formatYMD(ymd) {
            const d = parseYMD(ymd);
            return d ? d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : ymd;
        }

        // Monday (00:00) of the week containing the given date
        function startOfWeek(date) {
            const d = new Date(date);
            const offset = (d.getDay() + 6) % 7; // 0=Mon
            d.setDate(d.getDate() - offset);
            d.setHours(0, 0, 0, 0);
            return d;
        }

        // Real date for a weekday key within the currently-navigated week
        function dateForWeekday(dayKey) {
            const monday = startOfWeek(state.weekDate);
            const idx = days.indexOf(dayKey);
            const d = new Date(monday);
            d.setDate(d.getDate() + idx);
            return d;
        }

        // Is an event active on a given date? No range = always active, except
        // for any one-off dates listed in excludeDates.
        function eventActiveOnDate(event, date) {
            const ymd = toYMD(date);
            if (event.excludeDates && event.excludeDates.includes(ymd)) return false;
            if (!event.startDate && !event.endDate) return true;
            if (event.startDate && ymd < event.startDate) return false;
            if (event.endDate && ymd > event.endDate) return false;
            return true;
        }

        function renderDayEvents(day, date = null) {
            let events = state.events[day] || [];
            if (date) events = events.filter(ev => eventActiveOnDate(ev, date));
            if (events.length === 0) return '';

            return events.map(event => {
                const { top, height } = getEventPosition(event);
                const sizeClass = height < 40 ? 'tiny' : height < 60 ? 'small' : '';
                const _dark = isDarkTheme();
                const bgColor = hexToRgba(event.color, _dark ? 0.26 : 0.2);
                const textColor = _dark ? lightenColor(event.color, 0.6) : darkenColor(event.color, 0.3);
                const dated = event.startDate || event.endDate;

                return `
                    <div class="event-block ${sizeClass}"
                         data-id="${event.id}"
                         data-day="${day}"
                         data-date="${date ? toYMD(date) : ''}"
                         title="${dated ? 'Active ' + (event.startDate || '…') + ' to ' + (event.endDate || '…') : ''}"
                         style="top: ${top}px; height: ${height}px;
                                background: ${bgColor};
                                border-left-color: ${event.color};
                                color: ${textColor};">
                        <div class="event-title">${dated ? '📅 ' : ''}${event.title}</div>
                        ${event.location ? `<div class="event-location">${event.location}</div>` : ''}
                        <div class="event-time">${formatTime(event.start)} - ${formatTime(event.end)}</div>
                    </div>
                `;
            }).join('');
        }

        function renderMonthly() {
            const ref = state.monthDate;
            const year = ref.getFullYear();
            const month = ref.getMonth();
            const today = new Date();

            const firstDay = new Date(year, month, 1);
            // JS getDay(): 0=Sun..6=Sat. Convert to Monday-first index (0=Mon..6=Sun)
            const startOffset = (firstDay.getDay() + 6) % 7;
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;

            const maxShow = 3;
            let cells = '';
            for (let i = 0; i < totalCells; i++) {
                const dayOffset = i - startOffset;
                const cellDate = new Date(year, month, dayOffset + 1);
                const inMonth = cellDate.getMonth() === month;
                const weekdayIdx = (cellDate.getDay() + 6) % 7; // 0=Mon
                const dayKey = days[weekdayIdx];
                const isToday = cellDate.toDateString() === today.toDateString();

                const dayEvents = (state.events[dayKey] || [])
                    .filter(ev => eventActiveOnDate(ev, cellDate))
                    .sort((a, b) => a.start.localeCompare(b.start));

                let eventsHtml = dayEvents.slice(0, maxShow).map(ev => `
                    <div class="month-event" data-id="${ev.id}" data-day="${dayKey}"
                         title="${formatTime(ev.start)} - ${formatTime(ev.end)} ${ev.title}"
                         style="background: ${hexToRgba(ev.color, isDarkTheme() ? 0.24 : 0.18)};
                                border-left-color: ${ev.color};
                                color: ${isDarkTheme() ? lightenColor(ev.color, 0.6) : darkenColor(ev.color, 0.3)};">
                        ${formatTime(ev.start)} ${ev.title}
                    </div>
                `).join('');
                if (dayEvents.length > maxShow) {
                    eventsHtml += `<div class="month-more">+${dayEvents.length - maxShow} more</div>`;
                }

                cells += `
                    <div class="month-cell ${inMonth ? '' : 'other-month'} ${isToday ? 'today' : ''}" data-day="${dayKey}" data-date="${toYMD(cellDate)}">
                        <div class="month-date">${cellDate.getDate()}</div>
                        ${eventsHtml}
                    </div>
                `;
            }

            const weekdaysHtml = dayNamesShort.map(w => `<div class="month-weekday">${w}</div>`).join('');
            $('monthLabel').textContent =
                ref.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

            calendarGrid.innerHTML = `
                <div class="month-grid">
                    <div class="month-weekdays">${weekdaysHtml}</div>
                    <div class="month-weeks">${cells}</div>
                </div>
            `;
        }

        function attachMonthHandlers() {
            document.querySelectorAll('.month-event').forEach(el => {
                el.addEventListener('click', (e) => {
                    if (state.viewOnly) return;
                    e.stopPropagation();
                    const id = el.dataset.id;
                    const day = el.dataset.day;
                    const cell = el.closest('.month-cell');
                    const event = (state.events[day] || []).find(ev => String(ev.id) === String(id));
                    if (event) openEventModal(event, day, null, parseYMD(cell && cell.dataset.date));
                });
            });

            document.querySelectorAll('.month-cell').forEach(cell => {
                cell.addEventListener('click', () => {
                    if (state.viewOnly) return;
                    const [y, m, d] = cell.dataset.date.split('-').map(Number);
                    openEventModal(null, cell.dataset.day, null, new Date(y, m - 1, d));
                });
            });
        }

        function getEventPosition(event) {
            const startMinutes = timeToMinutes(event.start);
            const endMinutes = timeToMinutes(event.end);
            const duration = endMinutes - startMinutes;

            const top = ((startMinutes - state.startHour * 60) / 60) * 60;
            const height = (duration / 60) * 60;

            return { top: Math.max(0, top), height: Math.max(20, height) };
        }

        function timeToMinutes(time) {
            const [hours, minutes] = time.split(':').map(Number);
            return hours * 60 + minutes;
        }

        function formatTime(time) {
            const [hours, minutes] = time.split(':');
            const h = parseInt(hours);
            const ampm = h >= 12 ? 'PM' : 'AM';
            const displayHour = h % 12 || 12;
            return `${displayHour}:${minutes} ${ampm}`;
        }

        function hexToRgba(hex, alpha) {
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        }

        function darkenColor(hex, amount) {
            const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - 255 * amount);
            const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - 255 * amount);
            const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - 255 * amount);
            return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
        }

        // Lighten a hex toward white (for readable event text in dark mode)
        function lightenColor(hex, amount) {
            const ch = i => {
                const v = parseInt(hex.slice(i, i + 2), 16);
                return Math.round(v + (255 - v) * amount);
            };
            return `rgb(${ch(1)}, ${ch(3)}, ${ch(5)})`;
        }

        function isDarkTheme() {
            return document.body.getAttribute('data-theme') === 'dark';
        }

        // The date in focus for the current view (defaults a new event's range).
        function selectedViewDate(dayKey = null) {
            if (state.view === 'monthly') {
                const md = state.monthDate;
                const today = new Date();
                // today if the displayed month is the current month, else the 1st
                return (md.getFullYear() === today.getFullYear() && md.getMonth() === today.getMonth())
                    ? today
                    : new Date(md.getFullYear(), md.getMonth(), 1);
            }
            // weekly / daily: the date of the relevant weekday in the navigated week
            return dateForWeekday(dayKey || state.currentDay);
        }

        // Modal Functions
        function openEventModal(event = null, day = null, hour = null, dateContext = null) {
            state.editingEventId = event ? event.id : null;

            $('modalTitle').textContent = event ? 'Edit Event' : 'Add Event';
            $('deleteEvent').style.display = event ? 'inline-block' : 'none';
            $('copyEvent').style.display = event ? 'inline-block' : 'none';
            $('pasteEvent').style.display = (!event && state.copiedEvent) ? 'inline-block' : 'none';

            // Track which occurrence was clicked and this event's skipped dates.
            state.editingEventDate = dateContext ? toYMD(dateContext) : null;
            state.editingExcludeDates = event && event.excludeDates ? [...event.excludeDates] : [];

            if (event) {
                $('eventTitle').value = event.title;
                $('eventLocation').value = event.location || '';
                $('eventDay').value = day;
                $('eventStart').value = event.start;
                $('eventEnd').value = event.end;
                $('eventStartDate').value = event.startDate || '';
                $('eventEndDate').value = event.endDate || '';
                selectColor(event.color);
            } else {
                $('eventTitle').value = '';
                $('eventLocation').value = '';
                $('eventDay').value = day || state.currentDay;
                // Default the date range start to the date in focus (clicked cell /
                // column, or the current view's selected date), not today.
                const defDate = dateContext || selectedViewDate(day);
                $('eventStartDate').value = defDate ? toYMD(defDate) : '';
                $('eventEndDate').value = '';

                if (hour !== null) {
                    const startTime = `${hour.toString().padStart(2, '0')}:00`;
                    const endHour = Math.min(hour + 1, state.endHour);
                    const endTime = `${endHour.toString().padStart(2, '0')}:00`;
                    $('eventStart').value = startTime;
                    $('eventEnd').value = endTime;
                } else {
                    $('eventStart').value = '09:00';
                    $('eventEnd').value = '10:00';
                }
                selectColor('#4A90A4');
            }

            renderSkipUI(!!event);
            eventModal.classList.add('active');
            $('eventTitle').focus();
        }

        // Render the "Skip specific dates" section of the event modal. Only shown
        // when editing an existing event (you skip an occurrence of something that
        // already repeats).
        function renderSkipUI(isExisting) {
            const group = $('skipGroup');
            group.style.display = isExisting ? 'block' : 'none';
            if (!isExisting) return;

            const dates = state.editingExcludeDates;
            $('skipChips').innerHTML = dates.length
                ? dates.slice().sort().map(d =>
                    `<span class="skip-chip">📅 ${formatYMD(d)}<button type="button" data-skip="${d}" title="Un-skip">&times;</button></span>`
                  ).join('')
                : '<span class="skip-empty">Not skipped on any date.</span>';

            const btn = $('skipThisDate');
            const cur = state.editingEventDate;
            if (cur && !dates.includes(cur)) {
                btn.style.display = 'inline-block';
                btn.textContent = `Skip ${formatYMD(cur)}`;
            } else {
                btn.style.display = 'none';
            }
        }

        function closeEventModal() {
            eventModal.classList.remove('active');
            state.editingEventId = null;
            state.editingEventDate = null;
            state.editingExcludeDates = [];
        }

        function selectColor(color) {
            state.selectedColor = color;
            colorOptions.forEach(opt => {
                opt.classList.toggle('selected', opt.dataset.color === color);
            });
        }

        // Read the event modal fields. `day` is the target day; the rest form the
        // stored event object.
        function readEventForm() {
            const { day, ...event } = {
                day: $('eventDay').value,
                title: $('eventTitle').value.trim(),
                location: $('eventLocation').value.trim(),
                start: $('eventStart').value,
                end: $('eventEnd').value,
                color: state.selectedColor,
                startDate: $('eventStartDate').value,
                endDate: $('eventEndDate').value
            };
            // Only attach excludeDates when there are some, so unaffected events
            // stay clean (and Firebase doesn't carry empty arrays).
            const skipped = (state.editingExcludeDates || []).slice().sort();
            if (skipped.length) event.excludeDates = skipped;
            return { day, event };
        }

        function saveEvent() {
            const { day, event } = readEventForm();

            if (!event.title) { alert('Please enter an event title'); return; }
            if (event.start >= event.end) { alert('End time must be after start time'); return; }
            if (event.startDate && event.endDate && event.startDate > event.endDate) {
                alert('End date must be on or after start date');
                return;
            }

            if (!state.events[day]) state.events[day] = [];

            if (state.editingEventId) {
                // Remove from wherever it currently lives (day may have changed)...
                const loc = findEventLocation(state.editingEventId);
                if (loc) state.events[loc.day].splice(loc.index, 1);
                // ...and re-add to the selected day, keeping its id.
                state.events[day].push({ id: state.editingEventId, ...event });
            } else {
                state.events[day].push({ id: Date.now(), ...event });
            }

            closeEventModal();
            renderCalendar();
            saveState();
        }

        function deleteEvent() {
            if (!state.editingEventId) return;

            const loc = findEventLocation(state.editingEventId);
            if (loc) state.events[loc.day].splice(loc.index, 1);

            closeEventModal();
            renderCalendar();
            saveState();
        }

        function copyEvent() {
            const event = findEvent(state.editingEventId);
            if (event) {
                const { id, excludeDates, ...rest } = event;
                state.copiedEvent = { ...rest, startDate: event.startDate || '', endDate: event.endDate || '' };
                closeEventModal();
                // Show brief feedback
                const btn = $('addBtn');
                btn.style.background = '#27ae60';
                setTimeout(() => btn.style.background = '', 500);
            }
        }

        function pasteEvent() {
            if (!state.copiedEvent) return;

            $('eventTitle').value = state.copiedEvent.title;
            $('eventLocation').value = state.copiedEvent.location || '';
            $('eventStart').value = state.copiedEvent.start;
            $('eventEnd').value = state.copiedEvent.end;
            $('eventStartDate').value = state.copiedEvent.startDate || '';
            $('eventEndDate').value = state.copiedEvent.endDate || '';
            selectColor(state.copiedEvent.color);
        }

        function openSettingsModal() {
            $('scheduleTitle').value = state.title || '';
            $('startHour').value = state.startHour;
            $('endHour').value = state.endHour;
            $('showWeekends').checked = state.showWeekends;
            settingsModal.classList.add('active');
        }

        function closeSettingsModal() {
            settingsModal.classList.remove('active');
        }

        function applySettings() {
            const newTitle = $('scheduleTitle').value.trim();
            state.title = newTitle || 'Schedule Maker';
            state.startHour = parseInt($('startHour').value);
            state.endHour = parseInt($('endHour').value);
            state.showWeekends = $('showWeekends').checked;
            updateTitle();
            closeSettingsModal();
            renderCalendar();
            saveState();
        }

        function openExportModal() {
            exportModal.classList.add('active');
        }

        function closeExportModal() {
            exportModal.classList.remove('active');
        }

        function openShareModal() {
            let roomId = state.syncRoomId;
            if (!roomId) {
                // Create a new room for sharing
                roomId = generateRoomCode();
                joinRoom(roomId, true);
                // Wait for room to be created before showing URLs
                setTimeout(() => showShareUrls(roomId), 200);
            } else {
                showShareUrls(roomId);
            }
            shareModal.classList.add('active');
        }

        // Write the current view + position onto a URLSearchParams (clearing any
        // stale month/week/day first). Shared by the share links and the address
        // bar so both describe exactly what's on screen.
        function applyViewParams(p) {
            p.set('view', state.view);
            p.delete('month'); p.delete('week'); p.delete('day');
            if (state.view === 'monthly') {
                const y = state.monthDate.getFullYear();
                const m = (state.monthDate.getMonth() + 1).toString().padStart(2, '0');
                p.set('month', y + '-' + m);
            } else {
                // weekly / daily: carry the displayed week (Monday) and, for daily, the day
                p.set('week', toYMD(startOfWeek(state.weekDate)));
                if (state.view === 'daily') p.set('day', state.currentDay);
            }
            return p;
        }

        function currentViewParams() {
            return '&' + applyViewParams(new URLSearchParams()).toString();
        }

        // Mirror the current view/week (and room/key) into the address bar without
        // adding history entries, so a refresh restores the same position instead
        // of snapping back to today.
        function syncUrl() {
            const p = applyViewParams(new URLSearchParams(window.location.search));
            history.replaceState(null, '', window.location.pathname + '?' + p.toString());
        }

        function showShareUrls(roomId) {
            const baseUrl = window.location.origin + window.location.pathname;
            const vp = currentViewParams();
            if (state.editKey) {
                $('shareUrlEdit').value = baseUrl + '?room=' + roomId + '&key=' + state.editKey + vp;
            } else {
                $('shareUrlEdit').value = 'No edit access';
            }
            $('shareUrlView').value = baseUrl + '?room=' + roomId + vp;
            $('copyStatus').style.display = 'none';
        }

        function closeShareModal() {
            shareModal.classList.remove('active');
        }

        function copyShareUrl(mode) {
            const urlInput = $(mode === 'view' ? 'shareUrlView' : 'shareUrlEdit');
            urlInput.select();
            navigator.clipboard.writeText(urlInput.value).then(() => {
                $('copyStatus').style.display = 'block';
                setTimeout(() => {
                    $('copyStatus').style.display = 'none';
                }, 2000);
            });
        }

        // Sync Modal Functions
        function openSyncModal() {
            updateSyncUI();
            syncModal.classList.add('active');
        }

        function closeSyncModal() {
            syncModal.classList.remove('active');
        }

        function updateSyncUI() {
            const statusEl = $('syncStatus');
            const statusText = $('syncStatusText');
            const roomInfo = $('syncRoomInfo');
            const roomCodeInput = $('syncRoomCode');
            const disconnectBtn = $('disconnectSync');
            const joinInput = $('syncRoomId');

            if (state.syncRoomId) {
                statusEl.style.background = '#e8f5e9';
                statusText.innerHTML = '<span style="color: #2e7d32;">&#10003; Connected to room</span>';
                roomInfo.style.display = 'block';
                roomCodeInput.value = state.syncRoomId;
                disconnectBtn.style.display = 'block';
                joinInput.value = state.syncRoomId;
            } else {
                statusEl.style.background = '#f5f5f5';
                statusText.textContent = 'Not synced';
                roomInfo.style.display = 'none';
                disconnectBtn.style.display = 'none';
                joinInput.value = '';
            }
        }

        function generateRoomCode() {
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            let code = '';
            for (let i = 0; i < 6; i++) {
                code += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return code;
        }

        function createSyncRoom() {
            const roomId = generateRoomCode();
            joinRoom(roomId, true);
        }

        function joinSyncRoom() {
            const roomId = $('syncRoomId').value.trim().toUpperCase();
            if (!roomId) {
                alert('Please enter a room code');
                return;
            }
            joinRoom(roomId, false);
        }

        function generateEditKey() {
            const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            let key = '';
            for (let i = 0; i < 12; i++) {
                key += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return key;
        }

        function joinRoom(roomId, isNewRoom, editKey = null) {
            // Remove existing listener if any
            if (syncListener) {
                database.ref('rooms/' + state.syncRoomId).off('value', syncListener);
            }

            // Snapshot local events ONLY to migrate them into a room we explicitly
            // create. We must never push these into a room we're merely joining,
            // or every empty room ends up with the same data.
            const localEvents = JSON.parse(JSON.stringify(state.events));

            state.syncRoomId = roomId;

            // Save room ID to localStorage
            localStorage.setItem('schedulemaker_syncRoom', roomId);

            // Check room and decide whether to push or pull
            database.ref('rooms/' + roomId).once('value', (snapshot) => {
                const data = snapshot.val();
                const roomExists = !!data;

                if (isNewRoom) {
                    // Explicitly creating a room (Share / Create button) - seed it
                    // with the current local events and take edit access.
                    state.events = localEvents;
                    state.editKey = editKey || generateEditKey();
                    state.viewOnly = false;
                    localStorage.setItem('schedulemaker_editKey_' + roomId, state.editKey);
                    syncToFirebase();
                } else if (!roomExists) {
                    // Joining a room code that doesn't exist remotely. Seed it with
                    // this room's own cache (empty on a first visit; your data if you
                    // previously owned it and it was lost server-side). Because the
                    // cache is per-room, this can't leak another room's events.
                    state.events = localEvents;
                    state.editKey = editKey
                        || localStorage.getItem('schedulemaker_editKey_' + roomId)
                        || generateEditKey();
                    state.viewOnly = false;
                    localStorage.setItem('schedulemaker_editKey_' + roomId, state.editKey);
                    syncToFirebase();
                } else {
                    // Joining an existing room - the room is the source of truth.
                    // Verify edit key for permissions.
                    if (data.editKey) {
                        if (editKey) {
                            // Key provided in URL - only accept exact match
                            if (editKey === data.editKey) {
                                state.viewOnly = false;
                                state.editKey = editKey;
                                localStorage.setItem('schedulemaker_editKey_' + roomId, editKey);
                            } else {
                                state.viewOnly = true;
                                state.editKey = null;
                            }
                        } else {
                            // No key in URL - check localStorage for saved key
                            const savedKey = localStorage.getItem('schedulemaker_editKey_' + roomId);
                            if (savedKey && savedKey === data.editKey) {
                                state.viewOnly = false;
                                state.editKey = savedKey;
                            } else {
                                state.viewOnly = true;
                                state.editKey = null;
                            }
                        }
                    }
                    let claimedKeylessRoom = false;
                    if (!data.editKey) {
                        // Room exists but has no edit key (legacy / malformed data).
                        // Let this visitor claim edit access and repair it.
                        state.viewOnly = false;
                        state.editKey = editKey
                            || localStorage.getItem('schedulemaker_editKey_' + roomId)
                            || generateEditKey();
                        localStorage.setItem('schedulemaker_editKey_' + roomId, state.editKey);
                        claimedKeylessRoom = true;
                    }

                    // Replace local state with this room's data (clears stale events
                    // from a different room), then cache it.
                    applyScheduleData(data);
                    persistLocal();
                    // Persist the freshly-generated key so the room is repaired now,
                    // not only after the next edit.
                    if (claimedKeylessRoom) syncToFirebase();
                    renderCalendar();
                    updateTitle();
                }

                // Update UI after permission check
                updateViewOnlyUI();

                // Set up real-time listener after initial check
                setupSyncListener(roomId);
            });

            updateSyncUI();
        }

        function setupSyncListener(roomId) {
            syncListener = database.ref('rooms/' + roomId).on('value', (snapshot) => {
                const data = snapshot.val();
                if (data) {
                    applyScheduleData(data);
                    persistLocal();
                    renderCalendar();
                    updateTitle();
                }
            });

            updateSyncUI();
        }

        function disconnectSync() {
            if (syncListener && state.syncRoomId) {
                database.ref('rooms/' + state.syncRoomId).off('value', syncListener);
            }
            state.syncRoomId = null;
            syncListener = null;
            localStorage.removeItem('schedulemaker_syncRoom');
            updateSyncUI();
        }

        function copySyncCode() {
            const codeInput = $('syncRoomCode');
            codeInput.select();
            navigator.clipboard.writeText(codeInput.value).then(() => {
                const btn = event.target;
                btn.textContent = 'Copied!';
                setTimeout(() => btn.textContent = 'Copy', 1500);
            });
        }

        // Auto-reconnect to saved room on load
        function autoReconnectSync() {
            // Skip if joining from URL room
            if (joiningFromUrl) return;

            const savedRoom = localStorage.getItem('schedulemaker_syncRoom');
            if (savedRoom) {
                const savedKey = localStorage.getItem('schedulemaker_editKey_' + savedRoom);
                state.editKey = savedKey || null;
                joinRoom(savedRoom, false, savedKey);
            }
        }

        function resetSchedule() {
            if (!confirm('Reset all events? This cannot be undone.')) return;
            days.forEach(day => state.events[day] = []);
            renderCalendar();
            saveState();
        }

        // Drag & Drop Support
        let dragState = null;
        let dropIndicator = null;
        let suppressNextClick = false;

        // Locate an event by id across all days. Returns {day, index} or null.
        // (ids compared as strings since Firebase may change their type.)
        function findEventLocation(eventId) {
            for (const day of days) {
                const arr = state.events[day] || [];
                const index = arr.findIndex(e => String(e.id) === String(eventId));
                if (index !== -1) return { day, index };
            }
            return null;
        }

        function findEvent(eventId) {
            const loc = findEventLocation(eventId);
            return loc ? state.events[loc.day][loc.index] : null;
        }

        function minutesToTime(totalMinutes) {
            const h = Math.floor(totalMinutes / 60);
            const m = totalMinutes % 60;
            return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
        }

        function initDragHandlers() {
            if (state.viewOnly) return;
            document.querySelectorAll('.event-block').forEach(block => {
                block.addEventListener('mousedown', onEventMouseDown);
                block.addEventListener('touchstart', onEventTouchStart, { passive: false });
            });
        }

        function onEventMouseDown(e) {
            if (e.button !== 0 || state.viewOnly) return;
            e.stopPropagation();
            beginDrag(e.currentTarget, e.clientX, e.clientY);
            const onMove = (ev) => handleDragMove(ev.clientX, ev.clientY);
            const onUp = (ev) => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                endDrag(ev.clientX, ev.clientY);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        }

        function onEventTouchStart(e) {
            if (state.viewOnly) return;
            e.preventDefault();
            const touch = e.touches[0];
            beginDrag(e.currentTarget, touch.clientX, touch.clientY);
            const onMove = (ev) => {
                ev.preventDefault();
                const t = ev.touches[0];
                handleDragMove(t.clientX, t.clientY);
            };
            const onEnd = (ev) => {
                document.removeEventListener('touchmove', onMove);
                document.removeEventListener('touchend', onEnd);
                const t = ev.changedTouches[0];
                endDrag(t.clientX, t.clientY);
            };
            document.addEventListener('touchmove', onMove, { passive: false });
            document.addEventListener('touchend', onEnd);
        }

        function beginDrag(block, clientX, clientY) {
            const eventId = block.dataset.id;
            const day = block.dataset.day;
            const event = findEvent(eventId);
            if (!event) return;

            const rect = block.getBoundingClientRect();
            const offsetY = clientY - rect.top;
            const durationMinutes = timeToMinutes(event.end) - timeToMinutes(event.start);

            const ghost = block.cloneNode(true);
            Object.assign(ghost.style, {
                position: 'fixed',
                width: rect.width + 'px',
                height: rect.height + 'px',
                left: rect.left + 'px',
                top: rect.top + 'px',
                zIndex: '9999',
                opacity: '0.85',
                pointerEvents: 'none',
                boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
                transform: 'scale(1.03)',
                cursor: 'grabbing',
                margin: '0',
                transition: 'none',
            });
            document.body.appendChild(ghost);
            block.classList.add('dragging');

            dragState = {
                eventId, originalDay: day, event, ghost,
                originalBlock: block, offsetY, durationMinutes,
                startX: clientX, startY: clientY, moved: false,
            };
        }

        function handleDragMove(clientX, clientY) {
            if (!dragState) return;
            const { ghost, offsetY } = dragState;

            if (!dragState.moved) {
                const dx = Math.abs(clientX - dragState.startX);
                const dy = Math.abs(clientY - dragState.startY);
                if (dx < 5 && dy < 5) return;
                dragState.moved = true;
            }

            ghost.style.left = (clientX - parseFloat(ghost.style.width) / 2) + 'px';
            ghost.style.top = (clientY - offsetY) + 'px';

            const target = getDragTarget(clientX, clientY - offsetY);
            if (target) {
                showDropIndicator(target.eventsEl, target.absoluteMinutes, dragState.durationMinutes);
            } else {
                removeDropIndicator();
            }
        }

        function endDrag(clientX, clientY) {
            if (!dragState) return;
            const { ghost, originalBlock, eventId, originalDay, durationMinutes, moved } = dragState;

            ghost.remove();
            originalBlock.classList.remove('dragging');
            removeDropIndicator();

            if (moved) {
                suppressNextClick = true;
                setTimeout(() => suppressNextClick = false, 150);
                const target = getDragTarget(clientX, clientY - dragState.offsetY);
                if (target) {
                    moveEventByDrag(eventId, originalDay, target.day, target.absoluteMinutes, durationMinutes);
                }
            }

            dragState = null;
        }

        function getDragTarget(clientX, ghostTop) {
            const dayColumns = document.querySelectorAll('.day-column');
            for (const col of dayColumns) {
                const rect = col.getBoundingClientRect();
                if (clientX < rect.left || clientX > rect.right) continue;

                const eventsEl = col.querySelector('.day-events');
                if (!eventsEl) continue;

                const evRect = eventsEl.getBoundingClientRect();
                const relY = ghostTop - evRect.top;
                const rawMinutes = (relY / 60) * 60;
                const snappedRelMinutes = Math.round(rawMinutes / 15) * 15;
                const absoluteMinutes = state.startHour * 60 + snappedRelMinutes;

                const slot = col.querySelector('.hour-slot');
                const day = slot ? slot.dataset.day : null;
                if (!day) continue;

                return { day, eventsEl, absoluteMinutes };
            }
            return null;
        }

        function showDropIndicator(eventsEl, absoluteStartMinutes, durationMinutes) {
            if (!dropIndicator) {
                dropIndicator = document.createElement('div');
                dropIndicator.className = 'drag-indicator';
            }
            const top = ((absoluteStartMinutes - state.startHour * 60) / 60) * 60;
            const height = (durationMinutes / 60) * 60;
            dropIndicator.style.top = Math.max(0, top) + 'px';
            dropIndicator.style.height = Math.max(20, height) + 'px';
            if (dropIndicator.parentElement !== eventsEl) {
                dropIndicator.remove();
                eventsEl.appendChild(dropIndicator);
            }
        }

        function removeDropIndicator() {
            if (dropIndicator) {
                dropIndicator.remove();
                dropIndicator = null;
            }
        }

        function moveEventByDrag(eventId, fromDay, toDay, newStartMinutes, durationMinutes) {
            if (!toDay) return;
            const fromEvents = state.events[fromDay];
            if (!fromEvents) return;

            const idx = fromEvents.findIndex(e => String(e.id) === String(eventId));
            if (idx === -1) return;

            const event = { ...fromEvents[idx] };

            // Clamp within calendar bounds
            const maxStart = state.endHour * 60 - durationMinutes;
            const clampedStart = Math.max(state.startHour * 60, Math.min(newStartMinutes, maxStart));
            event.start = minutesToTime(clampedStart);
            event.end = minutesToTime(clampedStart + durationMinutes);

            fromEvents.splice(idx, 1);
            if (!state.events[toDay]) state.events[toDay] = [];
            state.events[toDay].push(event);

            renderCalendar();
            saveState();
        }

        // Export Functions
        function exportSchedule(format) {
            let allEvents = [];
            days.forEach(day => {
                state.events[day].forEach(event => {
                    allEvents.push({ ...event, day });
                });
            });

            if (allEvents.length === 0) {
                alert('No events to export');
                return;
            }

            allEvents.sort((a, b) => {
                const dayDiff = days.indexOf(a.day) - days.indexOf(b.day);
                if (dayDiff !== 0) return dayDiff;
                return a.start.localeCompare(b.start);
            });

            let content = '';
            let filename = 'schedule';
            let mimeType = '';

            switch (format) {
                case 'csv':
                    content = 'Day,Start,End,Title,Location,From Date,Until Date\n';
                    content += allEvents.map(e =>
                        `${e.day},${e.start},${e.end},"${e.title}","${e.location || ''}",${e.startDate || ''},${e.endDate || ''}`
                    ).join('\n');
                    filename += '.csv';
                    mimeType = 'text/csv';
                    break;
                case 'json':
                    content = JSON.stringify({ events: allEvents }, null, 2);
                    filename += '.json';
                    mimeType = 'application/json';
                    break;
                case 'md':
                    content = '# Weekly Schedule\n\n';
                    days.forEach(day => {
                        const dayEvents = allEvents.filter(e => e.day === day);
                        if (dayEvents.length > 0) {
                            const dayIndex = days.indexOf(day);
                            content += `## ${dayNames[dayIndex]}\n\n`;
                            content += '| Time | Event | Location | Dates |\n|------|-------|----------|-------|\n';
                            dayEvents.forEach(e => {
                                let range = (e.startDate || e.endDate)
                                    ? `${e.startDate || '…'} → ${e.endDate || '…'}`
                                    : 'Every week';
                                if (e.excludeDates && e.excludeDates.length) {
                                    range += ` (skips ${e.excludeDates.join(', ')})`;
                                }
                                content += `| ${formatTime(e.start)} - ${formatTime(e.end)} | ${e.title} | ${e.location || '-'} | ${range} |\n`;
                            });
                            content += '\n';
                        }
                    });
                    filename += '.md';
                    mimeType = 'text/markdown';
                    break;
            }

            const blob = new Blob([content], { type: mimeType });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
            closeExportModal();
        }
