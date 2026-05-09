const fs = require('fs/promises');
const path = require('path');

const DEFAULT_METRICS = {
    totals: {
        onboardingStarts: 0,
        instagramSubmissions: 0,
        workflowChannelsCreated: 0,
        completedOnboarding: 0
    },
    commands: {},
    days: {}
};

const METRICS_FILE = path.join(__dirname, '..', 'data', 'dashboard-metrics.json');

function getTodayKey(date = new Date()) {
    return date.toISOString().slice(0, 10);
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
            warmup: []
        }
    };
}

function normalizeDailyMetrics(day = {}) {
    const normalized = {
        ...createDailyMetrics(),
        ...day,
        users: {
            ...createDailyMetrics().users,
            ...(day.users || {})
        }
    };

    normalized.users.commands = Array.isArray(normalized.users.commands) ? normalized.users.commands : [];
    normalized.users.start = Array.isArray(normalized.users.start) ? normalized.users.start : [];
    normalized.users.warmup = Array.isArray(normalized.users.warmup) ? normalized.users.warmup : [];

    return normalized;
}

function normalizeMetrics(rawMetrics = {}) {
    const normalized = {
        ...structuredClone(DEFAULT_METRICS),
        ...rawMetrics,
        totals: {
            ...DEFAULT_METRICS.totals,
            ...(rawMetrics.totals || {})
        },
        commands: rawMetrics.commands || {},
        days: {}
    };

    for (const [dayKey, day] of Object.entries(rawMetrics.days || {})) {
        normalized.days[dayKey] = normalizeDailyMetrics(day);
    }

    return normalized;
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
                await fs.writeFile(METRICS_FILE, snapshot);
            })
            .catch(error => {
                console.log('[Metrics] Impossible d’enregistrer les stats.');
                console.log(error?.message || error);
            });

        return writeQueue;
    }

    function getDay(dayKey = getTodayKey()) {
        if (!metrics.days[dayKey]) {
            metrics.days[dayKey] = createDailyMetrics();
        }

        return metrics.days[dayKey];
    }

    function incrementTotal(key) {
        metrics.totals[key] = (metrics.totals[key] || 0) + 1;
    }

    function addUnique(values, value) {
        if (!values.includes(value)) {
            values.push(value);
        }
    }

    async function recordCommand(commandName, userId) {
        const day = getDay();

        metrics.commands[commandName] = metrics.commands[commandName] || {
            total: 0,
            users: []
        };
        metrics.commands[commandName].total += 1;
        addUnique(metrics.commands[commandName].users, userId);

        day.commands[commandName] = (day.commands[commandName] || 0) + 1;
        addUnique(day.users.commands, userId);

        if (commandName === 'start') addUnique(day.users.start, userId);
        if (commandName === 'warmup') addUnique(day.users.warmup, userId);

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

    function getSnapshot() {
        const today = getDay();

        return {
            totals: structuredClone(metrics.totals),
            commands: structuredClone(metrics.commands),
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
    getTodayKey
};
