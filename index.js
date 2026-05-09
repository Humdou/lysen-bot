require('dotenv').config();

const {
    Client,
    GatewayIntentBits,
    PermissionsBitField,
    ChannelType,
    EmbedBuilder,
    SlashCommandBuilder
} = require('discord.js');

const CONFIG = {
    guild: {
        vaActiveCategoryId: '1502055567760425122',
        vaOpCategoryId: '1502120982591045805',
        dashboardChannelName: '📊・dashboard',
        dashboardUpdateIntervalMs: 12 * 60 * 60 * 1000
    },
    categories: {
        vaActive: 'VA ACTIF 😎',
        vaOp: 'VA OP 🫡'
    },
    roles: {
        vaActive: '1502068514264055909',
        vaOp: '1502084425092169749',
        manager: '1502083797993263144'
    },
    resources: {
        formationUrl: 'https://discord.com/channels/1485476914218139740/1485480069358161940',
        warmupVideoUrl: 'https://discord.com/channels/1485476914218139740/1486893390262960320',
        usefulChannels: ['<#1485480560741847212>', '<#1485480522023964772>']
    }
};

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const dashboardMessages = new Map();
const startLocks = new Set();
const vaOpTransitionLocks = new Set();
const processedInstagramMessages = new Set();

// ========================================
// SHARED HELPERS
// ========================================

function getWorkflowKey(guildId, userId) {
    return `${guildId}:${userId}`;
}

function normalizeDiscordUsername(username = '') {
    return username
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80) || 'va';
}

function getVaChannelName(discordUsername) {
    return `cpt-${normalizeDiscordUsername(discordUsername)}`;
}

function getPrivateChannelOverwrites(guild, userId) {
    return [
        {
            id: guild.id,
            deny: [PermissionsBitField.Flags.ViewChannel]
        },
        {
            id: userId,
            allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory
            ]
        },
        {
            id: CONFIG.roles.manager,
            allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory
            ]
        }
    ];
}

async function fetchGuildChannels(guild) {
    await guild.channels.fetch();
    return guild.channels.cache;
}

async function getCategoryByNameOrId(guild, categoryName, fallbackId) {
    const channels = await fetchGuildChannels(guild);

    const categoryByName = channels.find(channel =>
        channel.type === ChannelType.GuildCategory &&
        channel.name === categoryName
    );

    if (categoryByName) return categoryByName;

    const categoryById = channels.get(fallbackId);
    if (categoryById?.type === ChannelType.GuildCategory) return categoryById;

    throw new Error(`Catégorie Discord introuvable: ${categoryName}`);
}

async function getVaActiveCategory(guild) {
    return getCategoryByNameOrId(
        guild,
        CONFIG.categories.vaActive,
        CONFIG.guild.vaActiveCategoryId
    );
}

async function getVaOpCategory(guild) {
    return getCategoryByNameOrId(
        guild,
        CONFIG.categories.vaOp,
        CONFIG.guild.vaOpCategoryId
    );
}

async function findUserWorkflowChannel(guild, userId, categoryId = null) {
    const channels = await fetchGuildChannels(guild);

    return channels.find(channel =>
        channel.type === ChannelType.GuildText &&
        channel.topic === userId &&
        (!categoryId || channel.parentId === categoryId)
    ) || null;
}

async function createPrivateWorkflowChannel(guild, user, category) {
    return guild.channels.create({
        name: getVaChannelName(user.username),
        type: ChannelType.GuildText,
        parent: category.id,
        topic: user.id,
        permissionOverwrites: getPrivateChannelOverwrites(guild, user.id)
    });
}

async function safePin(message, context) {
    await message.pin().catch(error => {
        console.log(`[Discord] Impossible d’épingler le message ${context}.`);
        console.log(error?.message || error);
    });
}

async function safeDeleteChannel(channel, context) {
    await channel.delete().catch(error => {
        console.log(`[Discord] Impossible de supprimer le salon ${context}.`);
        console.log(error?.message || error);
    });
}

async function updateMemberRoles(member, { add = [], remove = [] }) {
    for (const roleId of add) {
        try {
            if (!member.roles.cache.has(roleId)) {
                await member.roles.add(roleId);
            }
        } catch (error) {
            console.log(`[Discord] Impossible d’ajouter le rôle ${roleId}.`);
            console.log(error?.message || error);
        }
    }

    for (const roleId of remove) {
        try {
            if (member.roles.cache.has(roleId)) {
                await member.roles.remove(roleId);
            }
        } catch (error) {
            console.log(`[Discord] Impossible de retirer le rôle ${roleId}.`);
            console.log(error?.message || error);
        }
    }
}

async function replySafely(interaction, options) {
    if (interaction.deferred || interaction.replied) {
        return interaction.followUp(options);
    }

    return interaction.reply(options);
}

// ========================================
// INSTAGRAM LINK DETECTION ONLY
// ========================================

function parseInstagramUrl(rawValue) {
    const candidate = rawValue.startsWith('http://') || rawValue.startsWith('https://')
        ? rawValue
        : `https://${rawValue}`;

    try {
        const url = new URL(candidate);
        const hostname = url.hostname.replace(/^www\./, '').toLowerCase();

        if (hostname !== 'instagram.com') return null;

        const pathParts = url.pathname
            .split('/')
            .map(part => part.trim())
            .filter(Boolean);

        if (!pathParts.length) return null;

        const reservedPaths = new Set([
            'about',
            'accounts',
            'direct',
            'explore',
            'p',
            'privacy',
            'reel',
            'reels'
        ]);

        const firstPart = pathParts[0].toLowerCase();
        const username = firstPart === 'stories' ? pathParts[1] : pathParts[0];

        if (!username || reservedPaths.has(firstPart)) return null;

        const cleanUsername = username
            .replace(/^@/, '')
            .replace(/[^a-zA-Z0-9._]/g, '')
            .toLowerCase();

        if (!cleanUsername || cleanUsername.length > 30) return null;

        return {
            username: cleanUsername,
            url: `https://www.instagram.com/${cleanUsername}/`
        };
    } catch {
        return null;
    }
}

function extractInstagramProfile(content = '') {
    const urlMatches = content.match(/(?:https?:\/\/)?(?:www\.)?instagram\.com\/[^\s<>()]+/gi) || [];

    for (const match of urlMatches) {
        const profile = parseInstagramUrl(match);
        if (profile) return profile;
    }

    return null;
}

function isVaActiveWorkflowChannel(message, vaActiveCategoryId) {
    return message.channel?.type === ChannelType.GuildText &&
        message.channel.topic === message.author.id &&
        message.channel.parentId === vaActiveCategoryId;
}

// ========================================
// MESSAGES
// ========================================

function getOnboardingMessage() {
    return `
👋 **Bienvenue chez Lysen Agency**

━━━━━━━━━━━━━━

⚠️ IMPORTANT :
Lis bien toutes les étapes avant de commencer.

📚 **ÉTAPE 1 — FORMATIONS**

➜ ${CONFIG.resources.formationUrl}

━━━━━━━━━━━━━━

📱 **ÉTAPE 2 — CRÉATION DU COMPTE INSTAGRAM**

Une fois les formations regardées :

• crée ton compte Instagram ;
• prépare correctement le compte ;
• puis envoie le lien du compte directement dans ce salon.

━━━━━━━━━━━━━━

✅ **EXEMPLE :**

https://instagram.com/nomducompte

━━━━━━━━━━━━━━

🔥 Une fois le lien envoyé,
le bot déplacera automatiquement ton salon dans la suite du workflow.
    `;
}

function getVaOpMessage(instagramProfile) {
    return `
📸 **Compte Instagram reçu :**

${instagramProfile.url}

━━━━━━━━━━━━━━

✅ Ton salon est maintenant passé en **VA OP 🫡**.

🔥 Continue maintenant :
• ton warm-up ;
• tes reels ;
• ta régularité.

📚 Ressources utiles :
➜ ${CONFIG.resources.usefulChannels[0]}
➜ ${CONFIG.resources.usefulChannels[1]}

🚀 Petit conseil :
Créer un compte Threads peut énormément aider ton compte à faire plus de vues.

━━━━━━━━━━━━━━
    `;
}

async function sendAndPin(channel, content, context) {
    const sentMessage = await channel.send(content);
    await safePin(sentMessage, context);
    return sentMessage;
}

async function ensureVaOpMessage(channel, instagramProfile) {
    const pinnedMessages = await channel.messages.fetchPinned().catch(() => null);
    const existingPinnedBotMessage = pinnedMessages?.find(message =>
        message.author.id === client.user.id &&
        (
            message.content.includes('VA OP 🫡') ||
            message.content.includes('Compte Instagram reçu') ||
            message.content.includes('Compte Instagram détecté')
        )
    );

    if (existingPinnedBotMessage) return existingPinnedBotMessage;

    return sendAndPin(channel, getVaOpMessage(instagramProfile), 'VA OP');
}

// ========================================
// WORKFLOW
// ========================================

async function startOnboarding(interaction) {
    const workflowKey = getWorkflowKey(interaction.guild.id, interaction.user.id);

    if (startLocks.has(workflowKey)) {
        return replySafely(interaction, {
            content: '⚠️ Création déjà en cours. Réessaie dans quelques secondes.',
            ephemeral: true
        });
    }

    startLocks.add(workflowKey);

    try {
        const existingChannel = await findUserWorkflowChannel(
            interaction.guild,
            interaction.user.id
        );

        if (existingChannel) {
            return replySafely(interaction, {
                content: `⚠️ Tu as déjà un salon privé : ${existingChannel}`,
                ephemeral: true
            });
        }

        const vaActiveCategory = await getVaActiveCategory(interaction.guild);
        const member = await interaction.guild.members.fetch(interaction.user.id);

        await updateMemberRoles(member, {
            add: [CONFIG.roles.vaActive]
        });

        const channel = await createPrivateWorkflowChannel(
            interaction.guild,
            interaction.user,
            vaActiveCategory
        );

        await sendAndPin(channel, getOnboardingMessage(), 'onboarding');
        await updateDashboard(interaction.guild);

        return replySafely(interaction, {
            content: `✅ Ton salon privé a été créé : ${channel}`,
            ephemeral: true
        });
    } finally {
        startLocks.delete(workflowKey);
    }
}

async function moveUserToVaOp(message, instagramProfile) {
    const workflowKey = getWorkflowKey(message.guild.id, message.author.id);

    if (vaOpTransitionLocks.has(workflowKey)) {
        console.log(`[Workflow] Transition VA OP déjà en cours pour ${workflowKey}.`);
        return;
    }

    vaOpTransitionLocks.add(workflowKey);

    try {
        const vaOpCategory = await getVaOpCategory(message.guild);
        const finalChannelName = getVaChannelName(message.author.username);
        const existingFinalChannel = await findUserWorkflowChannel(
            message.guild,
            message.author.id,
            vaOpCategory.id
        );
        const finalChannel = existingFinalChannel || await createPrivateWorkflowChannel(
            message.guild,
            message.author,
            vaOpCategory
        );

        if (finalChannel.name !== finalChannelName) {
            await finalChannel.setName(finalChannelName);
        }

        const member = await message.guild.members.fetch(message.author.id);

        await updateMemberRoles(member, {
            add: [CONFIG.roles.vaOp],
            remove: [CONFIG.roles.vaActive]
        });

        await ensureVaOpMessage(finalChannel, instagramProfile);

        if (message.channel.id !== finalChannel.id) {
            await safeDeleteChannel(message.channel, 'VA ACTIF');
        }

        await updateDashboard(message.guild);

        console.log(`[Workflow] ${message.author.id} déplacé en VA OP avec @${instagramProfile.username}.`);
    } finally {
        vaOpTransitionLocks.delete(workflowKey);
    }
}

// ========================================
// DASHBOARD
// ========================================

async function getDashboardChannel(guild) {
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

async function getDashboardStats(guild) {
    await guild.members.fetch();
    await fetchGuildChannels(guild);

    const vaActiveRole = await guild.roles.fetch(CONFIG.roles.vaActive).catch(() => null);
    const vaOpRole = await guild.roles.fetch(CONFIG.roles.vaOp).catch(() => null);
    const vaActiveCategory = await getVaActiveCategory(guild).catch(() => null);
    const vaOpCategory = await getVaOpCategory(guild).catch(() => null);
    const workflowCategoryIds = [
        vaActiveCategory?.id || CONFIG.guild.vaActiveCategoryId,
        vaOpCategory?.id || CONFIG.guild.vaOpCategoryId
    ];

    const openChannelsCount = guild.channels.cache.filter(channel =>
        channel.type === ChannelType.GuildText &&
        workflowCategoryIds.includes(channel.parentId)
    ).size;

    return {
        activeVaCount: vaActiveRole ? vaActiveRole.members.size : 0,
        vaOpCount: vaOpRole ? vaOpRole.members.size : 0,
        openChannelsCount
    };
}

function buildDashboardEmbed(guild, stats) {
    return new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('📊 Dashboard Lysen Agency')
        .setDescription('Statut actuel du bot et de l’activité VA.')
        .addFields(
            {
                name: '👥 VA actifs',
                value: `${stats.activeVaCount}`,
                inline: true
            },
            {
                name: '🫡 VA OP',
                value: `${stats.vaOpCount}`,
                inline: true
            },
            {
                name: '🔓 Salons ouverts',
                value: `${stats.openChannelsCount}`,
                inline: true
            },
            {
                name: '🤖 Statut du bot',
                value: '🟢 ONLINE',
                inline: true
            }
        )
        .setFooter({ text: guild.name })
        .setTimestamp();
}

async function getDashboardMessage(channel) {
    const cachedMessageId = dashboardMessages.get(channel.guild.id);

    if (cachedMessageId) {
        const cachedMessage = await channel.messages.fetch(cachedMessageId).catch(() => null);
        if (cachedMessage) return cachedMessage;
    }

    const messages = await channel.messages.fetch({ limit: 100 });
    const botMessages = messages
        .filter(message => message.author.id === client.user.id)
        .sort((first, second) => second.createdTimestamp - first.createdTimestamp);

    const dashboardMessage = botMessages.first() || null;
    const duplicateMessages = botMessages.filter(message => message.id !== dashboardMessage?.id);

    for (const duplicateMessage of duplicateMessages.values()) {
        await duplicateMessage.delete().catch(() => null);
    }

    if (dashboardMessage) {
        dashboardMessages.set(channel.guild.id, dashboardMessage.id);
    }

    return dashboardMessage;
}

async function updateDashboard(guild) {
    try {
        const channel = await getDashboardChannel(guild);
        const stats = await getDashboardStats(guild);
        const embed = buildDashboardEmbed(guild, stats);
        const dashboardMessage = await getDashboardMessage(channel);

        if (dashboardMessage) {
            await dashboardMessage.edit({ content: '', embeds: [embed] });
            return;
        }

        const sentMessage = await channel.send({ embeds: [embed] });
        dashboardMessages.set(guild.id, sentMessage.id);
    } catch (error) {
        console.log('❌ Erreur dashboard');
        console.log(error?.message || error);
    }
}

async function updateAllDashboards() {
    for (const guild of client.guilds.cache.values()) {
        await updateDashboard(guild);
    }
}

// ========================================
// SLASH COMMANDS
// ========================================

const COMMAND_RESPONSES = {
    warmup: `
🔥 **WARM-UP INSTAGRAM**

━━━━━━━━━━━━━━

⏱️ Le warm-up doit durer environ 10 à 20 minutes.

📱 Pendant le warm-up :
• scroll ;
• like ;
• regarde des stories ;
• commente naturellement ;
• interagis normalement avec l’application.

⚠️ Fais tout comme dans la vidéo.

📚 Vidéo warm-up :
➜ ${CONFIG.resources.warmupVideoUrl}

━━━━━━━━━━━━━━
    `,
    pay: `
💸 **PAIEMENTS**

━━━━━━━━━━━━━━

Les informations de paiement sont gérées par l’équipe.

Si tu as une question sur un paiement, contacte un manager dans ton salon privé.

━━━━━━━━━━━━━━
    `,
    reels: `
🎬 **REELS**

━━━━━━━━━━━━━━

Poste régulièrement, garde un rythme stable et suis les consignes données dans les ressources.

📚 Ressources utiles :
➜ ${CONFIG.resources.usefulChannels[0]}
➜ ${CONFIG.resources.usefulChannels[1]}

━━━━━━━━━━━━━━
    `,
    threads: `
🧵 **THREADS**

━━━━━━━━━━━━━━

Créer un compte Threads peut aider ton compte Instagram à obtenir plus de visibilité.

Utilise-le naturellement et évite les actions trop répétitives.

━━━━━━━━━━━━━━
    `,
    views: `
📈 **VUES**

━━━━━━━━━━━━━━

Pour augmenter tes vues :
• poste régulièrement ;
• fais ton warm-up ;
• teste plusieurs formats ;
• garde les meilleurs hooks.

━━━━━━━━━━━━━━
    `,
    shadowban: `
⚠️ **SHADOWBAN**

━━━━━━━━━━━━━━

Si tes vues chutent fortement :
• ralentis les actions répétitives ;
• évite le spam ;
• fais un warm-up propre ;
• demande à un manager de regarder la situation avec toi.

━━━━━━━━━━━━━━
    `,
    help: `
📚 **COMMANDES DISPONIBLES**

━━━━━━━━━━━━━━

➜ /start
➜ /warmup
➜ /pay
➜ /reels
➜ /threads
➜ /views
➜ /shadowban
➜ /help

━━━━━━━━━━━━━━
    `
};

function getSlashCommands() {
    return [
        new SlashCommandBuilder()
            .setName('start')
            .setDescription('Commencer l’onboarding'),
        new SlashCommandBuilder()
            .setName('warmup')
            .setDescription('Explication du warm-up Instagram'),
        new SlashCommandBuilder()
            .setName('pay')
            .setDescription('Informations sur les paiements'),
        new SlashCommandBuilder()
            .setName('reels')
            .setDescription('Conseils pour poster des reels'),
        new SlashCommandBuilder()
            .setName('threads')
            .setDescription('Conseils et aide Threads'),
        new SlashCommandBuilder()
            .setName('views')
            .setDescription('Conseils pour augmenter les vues'),
        new SlashCommandBuilder()
            .setName('shadowban')
            .setDescription('Informations sur le shadowban'),
        new SlashCommandBuilder()
            .setName('help')
            .setDescription('Afficher toutes les commandes')
    ].map(command => command.toJSON());
}

async function registerSlashCommands() {
    const commands = getSlashCommands();

    for (const guild of client.guilds.cache.values()) {
        await guild.commands.set(commands);
        console.log(`[Discord] Commandes slash enregistrées pour ${guild.name}.`);
    }
}

async function handleSlashCommand(interaction) {
    if (interaction.commandName === 'start') {
        await startOnboarding(interaction);
        return;
    }

    const response = COMMAND_RESPONSES[interaction.commandName];

    if (!response) return;

    await interaction.reply({
        content: response,
        ephemeral: true
    });
}

// ========================================
// DISCORD EVENTS
// ========================================

client.once('ready', async () => {
    console.log(`🔥 Bot connecté : ${client.user.tag}`);

    await registerSlashCommands().catch(error => {
        console.log('[Discord] Impossible d’enregistrer les commandes slash.');
        console.log(error?.message || error);
    });

    await updateAllDashboards();
    setInterval(updateAllDashboards, CONFIG.guild.dashboardUpdateIntervalMs);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    try {
        await handleSlashCommand(interaction);
    } catch (error) {
        console.log('[Discord] Erreur commande slash.');
        console.log(error?.message || error);

        await replySafely(interaction, {
            content: '❌ Une erreur est survenue.',
            ephemeral: true
        }).catch(() => null);
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;

    try {
        const vaActiveCategory = await getVaActiveCategory(message.guild);

        if (!isVaActiveWorkflowChannel(message, vaActiveCategory.id)) return;

        const instagramProfile = extractInstagramProfile(message.content);

        if (!instagramProfile) return;

        if (processedInstagramMessages.has(message.id)) {
            console.log(`[Workflow] Message Instagram déjà traité: ${message.id}`);
            return;
        }

        processedInstagramMessages.add(message.id);
        setTimeout(() => processedInstagramMessages.delete(message.id), 10 * 60 * 1000);

        console.log('====================');
        console.log(`[Workflow] Lien Instagram détecté: @${instagramProfile.username}`);
        console.log(`[Workflow] URL normalisée: ${instagramProfile.url}`);
        console.log(`[Workflow] Message: ${message.id}`);
        console.log(`[Workflow] Salon: ${message.channel.id}`);
        console.log(`[Workflow] Auteur: ${message.author.id}`);
        console.log('====================');

        await moveUserToVaOp(message, instagramProfile);
    } catch (error) {
        console.log('❌ Erreur workflow message');
        console.log(error?.message || error);
    }
});

client.login(process.env.DISCORD_TOKEN);
