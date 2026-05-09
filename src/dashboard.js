const { ChannelType, EmbedBuilder, PermissionsBitField } = require('discord.js');
const { CONFIG } = require('./config');
const {
    fetchGuildChannels,
    getVaActiveCategory,
    getVaOpCategory
} = require('./discord-utils');

const DASHBOARD_TITLE = '📊 OFM Management Dashboard';
const SECTION_DIVIDER = '━━━━━━━━━━━━━━━━━━━━';

function formatNumber(value) {
    return new Intl.NumberFormat('fr-FR').format(value || 0);
}

function formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);

    if (days > 0) return `${days}j ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

function formatMemoryUsage() {
    const memory = process.memoryUsage();
    const usedMb = Math.round(memory.rss / 1024 / 1024);
    const heapMb = Math.round(memory.heapUsed / 1024 / 1024);

    return `${usedMb} MB RSS / ${heapMb} MB heap`;
}

function formatDiscordTimestamp(date) {
    return `<t:${Math.floor(date.getTime() / 1000)}:R>`;
}

function metric(label, value) {
    return `**${label}**\n\`${value}\``;
}

function metricLine(icon, label, value) {
    return `${icon}  ${label}\n> **${value}**`;
}

function pair(left, right) {
    return `${left}\n\n${right}`;
}

function countTextChannels(channels, categoryId) {
    if (!categoryId) return 0;

    return channels.filter(channel =>
        channel.type === ChannelType.GuildText &&
        channel.parentId === categoryId
    ).size;
}

async function getDashboardChannel(guild, client) {
    const channels = await fetchGuildChannels(guild);
    const existingChannel = channels.find(channel =>
        channel.type === ChannelType.GuildText &&
        channel.name === CONFIG.guild.dashboardChannelName
    );

    if (existingChannel) return existingChannel;

    return guild.channels.create({
        name: CONFIG.guild.dashboardChannelName,
        type: ChannelType.GuildText,
        permissionOverwrites: [
            {
                id: guild.id,
                allow: [
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.ReadMessageHistory
                ],
                deny: [PermissionsBitField.Flags.SendMessages]
            },
            {
                id: client.user.id,
                allow: [
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.SendMessages,
                    PermissionsBitField.Flags.ReadMessageHistory,
                    PermissionsBitField.Flags.ManageMessages
                ]
            },
            {
                id: CONFIG.roles.manager,
                allow: [
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.ReadMessageHistory
                ]
            }
        ]
    });
}

async function collectDashboardStats(guild, client, metricsStore) {
    const [members] = await Promise.all([
        guild.members.fetch(),
        fetchGuildChannels(guild)
    ]);
    const [vaActiveRole, vaOpRole, vaActiveCategory, vaOpCategory] = await Promise.all([
        guild.roles.fetch(CONFIG.roles.vaActive).catch(() => null),
        guild.roles.fetch(CONFIG.roles.vaOp).catch(() => null),
        getVaActiveCategory(guild).catch(() => null),
        getVaOpCategory(guild).catch(() => null)
    ]);
    const snapshot = metricsStore.getSnapshot();
    const channels = guild.channels.cache;
    const vaActiveChannelCount = countTextChannels(channels, vaActiveCategory?.id || CONFIG.guild.vaActiveCategoryId);
    const vaOpChannelCount = countTextChannels(channels, vaOpCategory?.id || CONFIG.guild.vaOpCategoryId);
    const totalActiveChannels = vaActiveChannelCount + vaOpChannelCount;
    const { commandAnalytics } = snapshot;
    const completedOnboarding = Math.max(
        snapshot.totals.completedOnboarding || 0,
        vaOpRole?.members.size || 0
    );

    return {
        bot: {
            latency: client.ws.ping,
            memoryUsage: formatMemoryUsage(),
            uptime: formatDuration(client.uptime || process.uptime() * 1000)
        },
        commands: {
            last24h: commandAnalytics.last24h,
            today: commandAnalytics.today,
            totals: commandAnalytics.totals
        },
        general: {
            completedOnboarding,
            totalActiveChannels,
            totalDiscordMembers: members.size,
            totalVaActive: vaActiveRole?.members.size || 0,
            totalVaOp: vaOpRole?.members.size || 0,
            totalWorkflowChannelsCreated: Math.max(
                snapshot.totals.workflowChannelsCreated || 0,
                totalActiveChannels
            )
        },
        workflow: {
            instagramSubmissionsToday: snapshot.today.instagramSubmissions,
            onboardingStartsToday: snapshot.today.onboardingStarts,
            vaActiveChannelCount,
            vaOpChannelCount
        }
    };
}

function buildDashboardEmbed(guild, stats, refreshedAt = new Date()) {
    return new EmbedBuilder()
        .setColor(0x27AE60)
        .setTitle(DASHBOARD_TITLE)
        .setDescription([
            '**Pilotage central de l’agence OFM**',
            'Suivi onboarding, progression VA, activité Discord et santé opérationnelle.',
            '',
            SECTION_DIVIDER
        ].join('\n'))
        .addFields(
            {
                name: '📌 Vue Générale',
                value: [
                    pair(
                        metricLine('👥', 'Membres Discord', formatNumber(stats.general.totalDiscordMembers)),
                        metricLine('✅', 'Onboardings complétés', formatNumber(stats.general.completedOnboarding))
                    ),
                    '',
                    SECTION_DIVIDER
                ].join('\n'),
                inline: false
            },
            {
                name: '👥 Progression VA',
                value: [
                    metric('😎 VA ACTIF', formatNumber(stats.general.totalVaActive)),
                    '',
                    metric('🫡 VA OP', formatNumber(stats.general.totalVaOp))
                ].join('\n'),
                inline: true
            },
            {
                name: '🏗️ Salons Workflow',
                value: [
                    metric('🏗️ Créés', formatNumber(stats.general.totalWorkflowChannelsCreated)),
                    '',
                    metric('🔓 Actifs', formatNumber(stats.general.totalActiveChannels))
                ].join('\n'),
                inline: true
            },
            {
                name: '\u200B',
                value: [
                    metric('📍 Refresh', formatDiscordTimestamp(refreshedAt)),
                    '',
                    metric('📡 Ping', `${Math.round(stats.bot.latency)} ms`)
                ].join('\n'),
                inline: true
            },
            {
                name: '📸 Workflow Instagram',
                value: [
                    SECTION_DIVIDER,
                    '',
                    pair(
                        metricLine('😎', 'Salons actuellement en VA ACTIF', formatNumber(stats.workflow.vaActiveChannelCount)),
                        metricLine('🫡', 'Salons actuellement en VA OP', formatNumber(stats.workflow.vaOpChannelCount))
                    ),
                    '',
                    pair(
                        metricLine('📨', 'Comptes envoyés aujourd’hui', formatNumber(stats.workflow.instagramSubmissionsToday)),
                        metricLine('🚀', 'Onboardings lancés aujourd’hui', formatNumber(stats.workflow.onboardingStartsToday))
                    )
                ].join('\n'),
                inline: false
            },
            {
                name: '🧵 Commandes & Activité',
                value: [
                    SECTION_DIVIDER,
                    '',
                    pair(
                        metricLine('🚀', '/start', `${formatNumber(stats.commands.totals.start)} total • ${formatNumber(stats.commands.today.start)} aujourd’hui • ${formatNumber(stats.commands.last24h.start)} sur 24h`),
                        metricLine('🔥', '/warmup', `${formatNumber(stats.commands.totals.warmup)} total • ${formatNumber(stats.commands.today.warmup)} aujourd’hui • ${formatNumber(stats.commands.last24h.warmup)} sur 24h`)
                    ),
                    '',
                    pair(
                        metricLine('📈', '/views', `${formatNumber(stats.commands.totals.views)} total • ${formatNumber(stats.commands.today.views)} aujourd’hui • ${formatNumber(stats.commands.last24h.views)} sur 24h`),
                        metricLine('⚡', 'Toutes commandes', `${formatNumber(stats.commands.totals.all)} total • ${formatNumber(stats.commands.today.all)} aujourd’hui • ${formatNumber(stats.commands.last24h.all)} sur 24h`)
                    ),
                    '',
                    metricLine('👤', 'Utilisateurs uniques de commandes', `${formatNumber(stats.commands.today.uniqueUsers)} aujourd’hui • ${formatNumber(stats.commands.last24h.uniqueUsers)} sur 24h`)
                ].join('\n'),
                inline: false
            },
            {
                name: '🤖 Santé du Bot',
                value: [
                    SECTION_DIVIDER,
                    '',
                    pair(
                        metricLine('⏱️', 'Uptime', stats.bot.uptime),
                        metricLine('🧠', 'Mémoire', stats.bot.memoryUsage)
                    ),
                    '',
                    pair(
                        metricLine('📡', 'Latence Discord', `${Math.round(stats.bot.latency)} ms`),
                        metricLine('🔄', 'Dernier refresh dashboard', formatDiscordTimestamp(refreshedAt))
                    )
                ].join('\n'),
                inline: false
            }
        )
        .setFooter({ text: `${guild.name} • Dashboard OFM • refresh automatique toutes les 30 minutes` })
        .setTimestamp(refreshedAt);
}

async function getDashboardMessage(channel, client) {
    const messages = await channel.messages.fetch({ limit: 100 });
    const botMessages = messages.filter(message => message.author.id === client.user.id);
    const matchingDashboards = botMessages.filter(message =>
        message.embeds.some(embed => embed.title === DASHBOARD_TITLE)
    );
    const dashboardMessage = matchingDashboards
        .sort((first, second) => second.createdTimestamp - first.createdTimestamp)
        .first() || null;
    const duplicates = botMessages.filter(message => message.id !== dashboardMessage?.id);

    for (const duplicate of duplicates.values()) {
        await duplicate.delete().catch(() => null);
    }

    return dashboardMessage;
}

function createDashboardService(client, metricsStore) {
    const dashboardMessageIds = new Map();
    const guildUpdateQueues = new Map();
    let updateInProgress = false;

    async function updateGuildDashboardOnce(guild) {
        try {
            const channel = await getDashboardChannel(guild, client);
            const refreshedAt = new Date();
            const stats = await collectDashboardStats(guild, client, metricsStore);
            const embed = buildDashboardEmbed(guild, stats, refreshedAt);
            const cachedMessageId = dashboardMessageIds.get(guild.id);
            const cachedMessage = cachedMessageId
                ? await channel.messages.fetch(cachedMessageId).catch(() => null)
                : null;
            const dashboardMessage = cachedMessage || await getDashboardMessage(channel, client);

            if (dashboardMessage) {
                await dashboardMessage.edit({ content: '', embeds: [embed] });
                dashboardMessageIds.set(guild.id, dashboardMessage.id);
                return;
            }

            const sentMessage = await channel.send({ embeds: [embed] });
            dashboardMessageIds.set(guild.id, sentMessage.id);
        } catch (error) {
            console.log('❌ Erreur dashboard');
            console.log(error?.message || error);
        }
    }

    async function updateGuildDashboard(guild) {
        const previousUpdate = guildUpdateQueues.get(guild.id) || Promise.resolve();
        const nextUpdate = previousUpdate
            .catch(() => null)
            .then(() => updateGuildDashboardOnce(guild))
            .finally(() => {
                if (guildUpdateQueues.get(guild.id) === nextUpdate) {
                    guildUpdateQueues.delete(guild.id);
                }
            });

        guildUpdateQueues.set(guild.id, nextUpdate);
        return nextUpdate;
    }

    async function updateAllDashboards() {
        if (updateInProgress) {
            console.log('[Dashboard] Mise à jour déjà en cours, cycle ignoré.');
            return;
        }

        updateInProgress = true;

        try {
            for (const guild of client.guilds.cache.values()) {
                await updateGuildDashboard(guild);
            }
        } finally {
            updateInProgress = false;
        }
    }

    return {
        updateAllDashboards,
        updateGuildDashboard
    };
}

module.exports = {
    createDashboardService
};
