const fs = require('fs/promises');
const path = require('path');
const { CONFIG } = require('./config');

const METRICS_FILE = path.join(__dirname, '..', 'data', 'dashboard-metrics.json');
const MAX_COMMAND_EVENTS = 20000;
const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_METRICS = {
    version: 2,
    totals: {
        onboardingStarts: 0,
        instagramSubmissions: 0,
        workflowChannelsCreated: 0,
        completedOnboarding: 0
    },
    commands: {},
    commandEvents: [],
    days: {}
};

function getDayKey(date = new Date(), timeZone = CONFIG.guild.metricsTimeZone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        day: '2-digit',
        month: '2-digit',
        timeZone,
        year: 'numeric'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));

    return `${values.year}-${values.month}-${values.day}`;
}

function createDailyMetrics() {
    return {
        onboardingStarts: 0,
        instagramSubmissions: 0,
        completedOnboarding: 0,
        commands: {},
        users: {
            commands: [],
            start: [],
            warmup: [],
            views: []
        }
    };
}

function normalizeUserList(value) {
    return Array.isArray(value) ? value : [];
}

function normalizeDailyMetrics(day = {}) {
    const defaultDay = createDailyMetrics();
    const normalized = {
        ...defaultDay,
        ...day,
        commands: day.commands || {},
        users: {
            ...defaultDay.users,
            ...(day.users || {})
        }
    };

    normalized.users.commands = normalizeUserList(normalized.users.commands);
    normalized.users.start = normalizeUserList(normalized.users.start);
    normalized.users.warmup = normalizeUserList(normalized.users.warmup);
    normalized.users.views = normalizeUserList(normalized.users.views);

    return normalized;
}

function normalizeCommandStats(commandStats = {}) {
    const normalized = {};

    for (const [commandName, stats] of Object.entries(commandStats || {})) {
        normalized[commandName] = {
            total: Number(stats?.total || 0),
            users: normalizeUserList(stats?.users)
        };
    }

    return normalized;
}

function normalizeCommandEvents(commandEvents = []) {
    return commandEvents
        .filter(event => event?.commandName && event?.userId && event?.timestamp)
        .map(event => ({
            commandName: String(event.commandName),
            timestamp: String(event.timestamp),
            userId: String(event.userId)
        }))
        .sort((first, second) => new Date(first.timestamp) - new Date(second.timestamp))
        .slice(-MAX_COMMAND_EVENTS);
}

function getLegacyEventTimestamp(dayKey, now = new Date()) {
    if (dayKey === getDayKey(now)) {
        return now.toISOString();
    }

    return `${dayKey}T12:00:00.000Z`;
}

function buildLegacyCommandEvents(rawMetrics = {}) {
    const events = [];

    for (const [dayKey, day] of Object.entries(rawMetrics.days || {})) {
        const timestamp = getLegacyEventTimestamp(dayKey);

        for (const [commandName, count] of Object.entries(day.commands || {})) {
            for (let index = 0; index < Number(count || 0); index += 1) {
                events.push({
                    commandName,
                    timestamp,
                    userId: `legacy-${commandName}`
                });
            }
        }
    }

    return events;
}

function normalizeMetrics(rawMetrics = {}) {
    const commandEvents = rawMetrics.commandEvents?.length
        ? rawMetrics.commandEvents
        : buildLegacyCommandEvents(rawMetrics);
    const normalized = {
        ...structuredClone(DEFAULT_METRICS),
        ...rawMetrics,
        totals: {
            ...DEFAULT_METRICS.totals,
            ...(rawMetrics.totals || {})
        },
        commands: normalizeCommandStats(rawMetrics.commands),
        commandEvents: normalizeCommandEvents(commandEvents),
        days: {}
    };

    for (const [dayKey, day] of Object.entries(rawMetrics.days || {})) {
        normalized.days[dayKey] = normalizeDailyMetrics(day);
    }

    return normalized;
}

function addUnique(values, value) {
    if (!values.includes(value)) {
        values.push(value);
    }
}

function countEvents(events, predicate) {
    return events.reduce((total, event) => total + (predicate(event) ? 1 : 0), 0);
}

function countUniqueUsers(events) {
    return new Set(events.map(event => event.userId)).size;
}

function getCommandCount(commands, commandName) {
    return commands[commandName]?.total || 0;
}

function createStore() {
    let metrics = normalizeMetrics();
    let writeQueue = Promise.resolve();

    async function load() {
        try {
            const raw = await fs.readFile(METRICS_FILE, 'utf8');
            metrics = normalizeMetrics(JSON.parse(raw));
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.log('[Metrics] Impossible de lire le fichier de stats.');
                console.log(error?.message || error);
            }
        }
    }

    async function save() {
        const snapshot = JSON.stringify(metrics, null, 2);

        writeQueue = writeQueue
            .catch(() => null)
            .then(async () => {
                await fs.mkdir(path.dirname(METRICS_FILE), { recursive: true });
                await fs.writeFile(`${METRICS_FILE}.tmp`, snapshot);
                await fs.rename(`${METRICS_FILE}.tmp`, METRICS_FILE);
            })
            .catch(error => {
                console.log('[Metrics] Impossible d’enregistrer les stats.');
                console.log(error?.message || error);
            });

        return writeQueue;
    }

    function getDay(dayKey = getDayKey()) {
        if (!metrics.days[dayKey]) {
            metrics.days[dayKey] = createDailyMetrics();
        }

        return metrics.days[dayKey];
    }

    function incrementTotal(key) {
        metrics.totals[key] = (metrics.totals[key] || 0) + 1;
    }

    async function recordCommand(commandName, userId, occurredAt = new Date()) {
        const safeCommandName = String(commandName);
        const safeUserId = String(userId);
        const timestamp = occurredAt.toISOString();
        const day = getDay(getDayKey(occurredAt));

        metrics.commands[safeCommandName] = metrics.commands[safeCommandName] || {
            total: 0,
            users: []
        };
        metrics.commands[safeCommandName].total += 1;
        addUnique(metrics.commands[safeCommandName].users, safeUserId);

        metrics.commandEvents.push({
            commandName: safeCommandName,
            timestamp,
            userId: safeUserId
        });
        metrics.commandEvents = metrics.commandEvents.slice(-MAX_COMMAND_EVENTS);

        day.commands[safeCommandName] = (day.commands[safeCommandName] || 0) + 1;
        addUnique(day.users.commands, safeUserId);

        if (!day.users[safeCommandName]) {
            day.users[safeCommandName] = [];
        }

        addUnique(day.users[safeCommandName], safeUserId);

        await save();
    }

    async function recordOnboardingStart() {
        incrementTotal('onboardingStarts');
        incrementTotal('workflowChannelsCreated');
        getDay().onboardingStarts += 1;
        await save();
    }

    async function recordInstagramSubmission() {
        incrementTotal('instagramSubmissions');
        getDay().instagramSubmissions += 1;
        await save();
    }

    async function recordVaOpChannelCreated() {
        incrementTotal('workflowChannelsCreated');
        await save();
    }

    async function recordCompletedOnboarding() {
        incrementTotal('completedOnboarding');
        getDay().completedOnboarding += 1;
        await save();
    }

    function getCommandAnalytics(now = new Date()) {
        const todayKey = getDayKey(now);
        const last24hStart = now.getTime() - DAY_MS;
        const eventsToday = metrics.commandEvents.filter(event =>
            getDayKey(new Date(event.timestamp)) === todayKey
        );
        const eventsLast24h = metrics.commandEvents.filter(event =>
            new Date(event.timestamp).getTime() >= last24hStart
        );

        return {
            commands: structuredClone(metrics.commands),
            last24h: {
                all: eventsLast24h.length,
                start: countEvents(eventsLast24h, event => event.commandName === 'start'),
                uniqueUsers: countUniqueUsers(eventsLast24h),
                views: countEvents(eventsLast24h, event => event.commandName === 'views'),
                warmup: countEvents(eventsLast24h, event => event.commandName === 'warmup')
            },
            today: {
                all: eventsToday.length,
                start: countEvents(eventsToday, event => event.commandName === 'start'),
                uniqueUsers: countUniqueUsers(eventsToday),
                views: countEvents(eventsToday, event => event.commandName === 'views'),
                warmup: countEvents(eventsToday, event => event.commandName === 'warmup')
            },
            totals: {
                all: Object.values(metrics.commands).reduce((total, stats) => total + (stats.total || 0), 0),
                start: getCommandCount(metrics.commands, 'start'),
                views: getCommandCount(metrics.commands, 'views'),
                warmup: getCommandCount(metrics.commands, 'warmup')
            }
        };
    }

    function getSnapshot() {
        const today = getDay();

        return {
            commandAnalytics: getCommandAnalytics(),
            totals: structuredClone(metrics.totals),
            today: structuredClone(today)
        };
    }

    return {
        getSnapshot,
        load,
        recordCommand,
        recordCompletedOnboarding,
        recordInstagramSubmission,
        recordOnboardingStart,
        recordVaOpChannelCreated
    };
}

module.exports = {
    createStore,
    getDayKey
};
