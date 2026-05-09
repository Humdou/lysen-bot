require('dotenv').config();

const CATEGORY_ID = '1502055567760425122';
const COMPTE_CREE_CATEGORY_ID = '1502120982591045805';
const DASHBOARD_CHANNEL_NAME = '📊・dashboard';
const DASHBOARD_UPDATE_INTERVAL_MS = 12 * 60 * 60 * 1000;
const RAPIDAPI_INSTAGRAM = {
    host: 'instagram-scraper21.p.rapidapi.com',
    profileUrl: 'https://instagram-scraper21.p.rapidapi.com/v1/info'
};
const REQUIRED_HIGHLIGHTS_COUNT = 2;
const INSTAGRAM_TEMPORARY_ERROR_MESSAGE = `❌ Vérification Instagram temporairement indisponible.
Réessaie plus tard.`;

const VA_ROLE_ID = '1502068514264055909';
const COMPTE_CREE_ROLE_ID = '1502084425092169749';
const MANAGER_ROLE_ID = '1502083797993263144';

const {
    Client,
    GatewayIntentBits,
    PermissionsBitField,
    ChannelType,
    EmbedBuilder
} = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const dashboardMessages = new Map();
const instagramValidationsInProgress = new Set();
const processedInstagramMessages = new Set();

// ========================================
// VALIDATION INSTAGRAM
// ========================================

function extractInstagramUsername(content) {
    const instagramUrlMatch = content.match(/(?:https?:\/\/)?(?:www\.)?instagram\.com\/([a-zA-Z0-9._]+)/i);

    if (!instagramUrlMatch) return null;

    const username = instagramUrlMatch[1]
        .split('?')[0]
        .split('#')[0]
        .replace(/^@/, '')
        .replace(/\/+$/, '')
        .toLowerCase();
    const reservedPaths = ['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'direct'];

    if (!username || reservedPaths.includes(username)) return null;

    return username;
}

function decodeHtmlEntities(value = '') {
    return value
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}

function stripHtml(value = '') {
    return decodeHtmlEntities(value.replace(/<[^>]*>/g, '')).trim();
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal,
            headers: options.headers || {}
        });
    } finally {
        clearTimeout(timeout);
    }
}

function findFirstValue(object, keys) {
    if (!object || typeof object !== 'object') return null;

    for (const key of keys) {
        if (object[key] !== undefined && object[key] !== null) {
            return object[key];
        }
    }

    for (const value of Object.values(object)) {
        const nestedValue = findFirstValue(value, keys);
        if (nestedValue !== null && nestedValue !== undefined) {
            return nestedValue;
        }
    }

    return null;
}

function getRapidApiProfilePayload(data) {
    return data?.data?.user ||
        data?.data ||
        data?.user ||
        data?.result?.user ||
        data?.result ||
        data;
}

function normalizeRapidApiProfile(data) {
    const profile = getRapidApiProfilePayload(data);
    const biography = findFirstValue(profile, [
        'biography',
        'bio',
        'biography_text',
        'biography_with_entities',
        'about',
        'description',
        'raw_text'
    ]);
    const profilePicture = findFirstValue(profile, [
        'profile_pic_url_hd',
        'profile_pic_url',
        'profile_picture',
        'profilePicture',
        'profile_pic',
        'hd_profile_pic_url_info',
        'avatar',
        'image'
    ]);
    const anonymousProfilePicture = findFirstValue(profile, [
        'has_anonymous_profile_picture',
        'is_default_profile_pic'
    ]);
    const highlights = findFirstValue(profile, [
        'highlight_reel_count',
        'highlights_count',
        'highlight_count',
        'highlights',
        'highlight_reels',
        'story_highlights_count',
        'total_highlights',
        'total_highlight_reels'
    ]);

    const normalizedBiography = typeof biography === 'object'
        ? biography.raw_text || biography.text || ''
        : biography;
    const normalizedProfilePicture = typeof profilePicture === 'object'
        ? profilePicture.url || profilePicture.uri || profilePicture.src
        : profilePicture;

    return {
        source: 'rapidapi',
        biography: stripHtml(String(normalizedBiography || '')),
        hasProfilePicture: Boolean(normalizedProfilePicture) && anonymousProfilePicture !== true,
        highlightsCount: Array.isArray(highlights)
            ? highlights.length
            : Number.isFinite(Number(highlights)) ? Number(highlights) : 0
    };
}

async function fetchInstagramProfileWithRapidApi(username) {
    console.log('====================');
    console.log(`[RapidAPI] Analyse du profil Instagram @${username}`);
    console.log('====================');

    if (!process.env.RAPIDAPI_KEY) {
        console.log('[RapidAPI] RAPIDAPI_KEY manquante dans les variables d’environnement.');
        return {
            ok: false,
            reason: 'missing_rapidapi_key'
        };
    }

    try {
        const url = new URL(RAPIDAPI_INSTAGRAM.profileUrl);
        url.searchParams.set('username', username);

        console.log(`[RapidAPI] Host: ${RAPIDAPI_INSTAGRAM.host}`);
        console.log(`[RapidAPI] Requête: ${url.toString()}`);

        const response = await fetchWithTimeout(url, {
            headers: {
                'x-rapidapi-key': process.env.RAPIDAPI_KEY,
                'x-rapidapi-host': RAPIDAPI_INSTAGRAM.host
            }
        });
        const contentType = response.headers.get('content-type') || 'unknown';
        const body = await response.text();

        console.log(`[RapidAPI] Endpoint utilisé: ${url.toString()}`);
        console.log(`[RapidAPI] Status: ${response.status}`);
        console.log(`[RapidAPI] Content-Type: ${contentType}`);
        console.log(`[RapidAPI] Taille réponse: ${body.length} caractères`);
        console.log(`[RapidAPI] Réponse API: ${body}`);

        if (response.status === 401 || response.status === 403) {
            return {
                ok: false,
                reason: 'rapidapi_auth'
            };
        }

        if (response.status === 429) {
            console.log('[RapidAPI] Quota dépassé ou rate-limit atteint.');
            return {
                ok: false,
                reason: 'rapidapi_rate_limited'
            };
        }

        if (response.status === 404) {
            return {
                ok: false,
                reason: 'not_found'
            };
        }

        if (!response.ok) {
            console.log(`[RapidAPI] Réponse non OK. Extrait: ${body.slice(0, 180)}`);
            return {
                ok: false,
                reason: 'rapidapi_unavailable'
            };
        }

        let data;

        try {
            data = JSON.parse(body);
        } catch (error) {
            console.log('[RapidAPI] JSON invalide.');
            console.log(`[RapidAPI] Extrait: ${body.slice(0, 180)}`);
            return {
                ok: false,
                reason: 'invalid_json'
            };
        }

        const profile = normalizeRapidApiProfile(data);

        console.log(`[RapidAPI] Bio: ${Boolean(profile.biography.trim())}`);
        console.log(`[RapidAPI] Photo: ${profile.hasProfilePicture}`);
        console.log(`[RapidAPI] Highlights: ${profile.highlightsCount}`);

        return {
            ok: true,
            profile
        };
    } catch (error) {
        console.log('[RapidAPI] Erreur globale pendant la récupération.');
        console.log(error?.message || error);

        return {
            ok: false,
            reason: 'rapidapi_unavailable'
        };
    }
}

async function updateVaRoles(message) {
    const member = await message.guild.members.fetch(message.author.id);

    try {
        if (!member.roles.cache.has(COMPTE_CREE_ROLE_ID)) {
            await member.roles.add(COMPTE_CREE_ROLE_ID);
            console.log(`[Discord] Rôle VA OP ajouté à ${message.author.id}.`);
        }
    } catch (error) {
        console.log('[Discord] Erreur ajout rôle VA OP.');
        console.log(error);
    }

    try {
        if (member.roles.cache.has(VA_ROLE_ID)) {
            await member.roles.remove(VA_ROLE_ID);
            console.log(`[Discord] Ancien rôle VA retiré à ${message.author.id}.`);
        }
    } catch (error) {
        console.log('[Discord] Erreur retrait ancien rôle VA.');
        console.log(error);
    }
}

function validateInstagramProfile(profile) {
    const missingItems = [];
    const biography = profile.biography || '';
    const hasProfilePicture = profile.hasProfilePicture === true;
    const highlightsCount = Number(profile.highlightsCount || 0);

    if (!biography.trim()) {
        missingItems.push({
            summary: 'il manque une bio',
            details: 'Ajoute une bio sur le profil Instagram.'
        });
    }

    if (!hasProfilePicture) {
        missingItems.push({
            summary: 'il manque une photo de profil',
            details: 'Ajoute une photo de profil.'
        });
    }

    if (highlightsCount !== REQUIRED_HIGHLIGHTS_COUNT) {
        const summary = highlightsCount < REQUIRED_HIGHLIGHTS_COUNT
            ? `il manque ${REQUIRED_HIGHLIGHTS_COUNT - highlightsCount} highlight${REQUIRED_HIGHLIGHTS_COUNT - highlightsCount > 1 ? 's' : ''}`
            : `il faut supprimer ${highlightsCount - REQUIRED_HIGHLIGHTS_COUNT} highlight${highlightsCount - REQUIRED_HIGHLIGHTS_COUNT > 1 ? 's' : ''}`;

        missingItems.push({
            summary,
            details: `Le compte doit avoir exactement ${REQUIRED_HIGHLIGHTS_COUNT} highlights. Actuellement : ${highlightsCount}.`
        });
    }

    return {
        isValid: missingItems.length === 0,
        missingItems
    };
}

function formatMissingItems(missingItems) {
    const summaries = missingItems.map(item => item.summary);
    const sentence = summaries.length === 1
        ? summaries[0]
        : `${summaries.slice(0, -1).join(', ')} et ${summaries[summaries.length - 1]}`;

    return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

function formatValidationDetails(missingItems) {
    return missingItems.map(item => `• ${item.details}`).join('\n');
}

function getValidatedChannelName(discordUsername) {
    const safeUsername = discordUsername
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80);

    return `cpt-${safeUsername || 'va'}-✅`;
}

function getInstagramFetchErrorMessage(reason, username) {
    if (reason === 'not_found') {
        return `❌ Impossible de trouver le compte Instagram **@${username}**. Vérifie le lien puis renvoie-le ici.`;
    }

    return INSTAGRAM_TEMPORARY_ERROR_MESSAGE;
}

async function sendDiscordMessage(channel, content) {
    try {
        await channel.send(content);
    } catch (error) {
        console.log('[Discord] Impossible d’envoyer le message.');
        console.log(error?.message || error);
    }
}

async function createValidatedVaOpChannel(message, username) {
    await updateVaRoles(message);

    const channel = await message.guild.channels.create({
        name: getValidatedChannelName(message.author.username),
        type: ChannelType.GuildText,
        parent: COMPTE_CREE_CATEGORY_ID,
        topic: message.author.id,
        permissionOverwrites: [
            {
                id: message.guild.id,
                deny: [PermissionsBitField.Flags.ViewChannel],
            },
            {
                id: message.author.id,
                allow: [
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.SendMessages,
                    PermissionsBitField.Flags.ReadMessageHistory
                ],
            },
            {
                id: MANAGER_ROLE_ID,
                allow: [
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.SendMessages,
                    PermissionsBitField.Flags.ReadMessageHistory
                ],
            },
        ],
    });

    await channel.send(`
✅ **Compte Instagram valide**

Bio présente.
Photo de profil présente.
Exactement ${REQUIRED_HIGHLIGHTS_COUNT} highlights.

Compte analysé : @${username}
    `);

    await message.channel.delete();
    await updateDashboard(message.guild);
}

async function validateInstagramAccount(message, username) {
    try {
        const result = await fetchInstagramProfileWithRapidApi(username);

        if (!result.ok) {
            console.log(`[RapidAPI] Validation impossible pour @${username}. Raison: ${result.reason}`);
            await sendDiscordMessage(message.channel, getInstagramFetchErrorMessage(result.reason, username));
            return;
        }

        console.log(`[RapidAPI] Profil récupéré via: ${result.profile.source}`);

        const validation = validateInstagramProfile(result.profile);

        console.log(`[RapidAPI] Validation @${username}: ${validation.isValid ? 'valide' : 'non valide'}`);

        if (!validation.isValid) {
            await sendDiscordMessage(message.channel, `
❌ **Compte Instagram non valide**

${formatMissingItems(validation.missingItems)}.

${formatValidationDetails(validation.missingItems)}

Corrige le compte, puis renvoie le lien Instagram ici pour une nouvelle vérification automatique.
        `);
            return;
        }

        await createValidatedVaOpChannel(message, username);
    } catch (error) {
        console.log('[Instagram] Erreur imprévue pendant la validation.');
        console.log(error?.message || error);
        await sendDiscordMessage(message.channel, INSTAGRAM_TEMPORARY_ERROR_MESSAGE);
    }
}

// ========================================
// DASHBOARD
// ========================================

async function getDashboardChannel(guild) {
    await guild.channels.fetch();

    const existingChannel = guild.channels.cache.find(channel =>
        channel.type === ChannelType.GuildText &&
        channel.name === DASHBOARD_CHANNEL_NAME
    );

    if (existingChannel) return existingChannel;

    return guild.channels.create({
        name: DASHBOARD_CHANNEL_NAME,
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
                id: MANAGER_ROLE_ID,
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
    await guild.channels.fetch();

    const vaRole = await guild.roles.fetch(VA_ROLE_ID).catch(() => null);
    const compteCreeRole = await guild.roles.fetch(COMPTE_CREE_ROLE_ID).catch(() => null);

    const openChannelsCount = guild.channels.cache.filter(channel =>
        channel.type === ChannelType.GuildText &&
        [CATEGORY_ID, COMPTE_CREE_CATEGORY_ID].includes(channel.parentId)
    ).size;

    return {
        activeVaCount: vaRole ? vaRole.members.size : 0,
        createdAccountsCount: compteCreeRole ? compteCreeRole.members.size : 0,
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
                name: '📱 Comptes créés',
                value: `${stats.createdAccountsCount}`,
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
        console.log(error);
    }
}

async function updateAllDashboards() {
    for (const guild of client.guilds.cache.values()) {
        await updateDashboard(guild);
    }
}

client.once('ready', async () => {
    console.log(`🔥 Bot connecté : ${client.user.tag}`);

    await updateAllDashboards();
    setInterval(updateAllDashboards, DASHBOARD_UPDATE_INTERVAL_MS);
});

// ========================================
// COMMANDES SLASH
// ========================================

client.on('interactionCreate', async interaction => {

    if (!interaction.isChatInputCommand()) return;

    // ========================================
    // /start
    // ========================================

    if (interaction.commandName === 'start') {

        try {

            const existingChannel = interaction.guild.channels.cache.find(
                channel => channel.topic === interaction.user.id
            );

            if (existingChannel) {
                return interaction.reply({
                    content: `⚠️ Tu as déjà un salon privé : ${existingChannel}`,
                    ephemeral: true
                });
            }

            const member = interaction.member;

            await member.roles.add(VA_ROLE_ID);

            const channel = await interaction.guild.channels.create({
                name: `va-${interaction.user.username}`,
                type: ChannelType.GuildText,
                parent: CATEGORY_ID,
                topic: interaction.user.id,

                permissionOverwrites: [
                    {
                        id: interaction.guild.id,
                        deny: [PermissionsBitField.Flags.ViewChannel],
                    },
                    {
                        id: interaction.user.id,
                        allow: [
                            PermissionsBitField.Flags.ViewChannel,
                            PermissionsBitField.Flags.SendMessages,
                            PermissionsBitField.Flags.ReadMessageHistory
                        ],
                    },
                    {
                        id: MANAGER_ROLE_ID,
                        allow: [
                            PermissionsBitField.Flags.ViewChannel,
                            PermissionsBitField.Flags.SendMessages,
                            PermissionsBitField.Flags.ReadMessageHistory
                        ],
                    },
                ],
            });

            await channel.send(`
👋 **Bienvenue chez Lysen Agency**

━━━━━━━━━━━━━━

⚠️ IMPORTANT :
Lis bien toutes les étapes avant de commencer.

📚 **ÉTAPE 1 — FORMATIONS**

➜ https://discord.com/channels/1485476914218139740/1485480069358161940

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
le bot vérifiera automatiquement ton compte Instagram.
            `);

            await interaction.reply({
                content: `✅ Ton salon privé a été créé : ${channel}`,
                ephemeral: true
            });

            await updateDashboard(interaction.guild);

        } catch (error) {

            console.log(error);

            await interaction.reply({
                content: `❌ Une erreur est survenue.`,
                ephemeral: true
            });
        }
    }

    // ========================================
    // /warmup
    // ========================================

    if (interaction.commandName === 'warmup') {

        await interaction.reply({
            content: `
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
➜ https://discord.com/channels/1485476914218139740/1486893390262960320

━━━━━━━━━━━━━━
            `,
            ephemeral: true
        });
    }

    // ========================================
    // /help
    // ========================================

    if (interaction.commandName === 'help') {

        await interaction.reply({
            content: `
📚 **COMMANDES DISPONIBLES**

━━━━━━━━━━━━━━

➜ /start
➜ /warmup

━━━━━━━━━━━━━━
            `,
            ephemeral: true
        });
    }
});

// ========================================
// DETECTION LIENS INSTAGRAM
// ========================================

client.on('messageCreate', async message => {

    try {

        if (message.author.bot) return;

        // Vérifie salon privé utilisateur
        if (message.channel.topic !== message.author.id) return;

        const instagramUsername = extractInstagramUsername(message.content);

        if (!instagramUsername) return;

        // Verrou par message: évite qu'un même événement Discord déclenche deux workflows.
        if (processedInstagramMessages.has(message.id)) {
            console.log(`[Instagram] Message déjà traité, ignoré: ${message.id}`);
            return;
        }

        processedInstagramMessages.add(message.id);
        setTimeout(() => processedInstagramMessages.delete(message.id), 10 * 60 * 1000);

        const workflowKey = `${message.guild.id}:${message.channel.id}`;

        // Verrou par salon: évite deux transitions/réponses si deux liens arrivent en même temps.
        if (instagramValidationsInProgress.has(workflowKey)) {
            console.log(`[Instagram] Workflow déjà en cours dans ${message.channel.id}, message ignoré: ${message.id}`);
            return;
        }

        console.log('====================');
        console.log(`[Instagram] Lien détecté: @${instagramUsername}`);
        console.log(`[Instagram] Message: ${message.id}`);
        console.log(`[Instagram] Salon: ${message.channel.id}`);
        console.log(`[Instagram] Auteur: ${message.author.id}`);
        console.log('====================');

        instagramValidationsInProgress.add(workflowKey);

        try {
            await validateInstagramAccount(message, instagramUsername);
        } finally {
            instagramValidationsInProgress.delete(workflowKey);
        }

    } catch (error) {

        console.log('❌ ERREUR GLOBALE');
        console.log(error);
    }
});

client.login(process.env.DISCORD_TOKEN);
