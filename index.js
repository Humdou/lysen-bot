require('dotenv').config();

const CATEGORY_ID = '1502055567760425122';
const COMPTE_CREE_CATEGORY_ID = '1502120982591045805';
const DASHBOARD_CHANNEL_NAME = '📊・dashboard';
const DASHBOARD_UPDATE_INTERVAL_MS = 12 * 60 * 60 * 1000;
const INSTAGRAM_WEB_PROFILE_URL = 'https://www.instagram.com/api/v1/users/web_profile_info/';
const INSTAGRAM_PROFILE_PAGE_URL = 'https://www.instagram.com/';
const INSTAGRAM_REQUIRED_HIGHLIGHTS = 2;

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

// ========================================
// VALIDATION INSTAGRAM
// ========================================

function extractInstagramUsername(content) {
    const instagramUrlMatch = content.match(/https?:\/\/(?:www\.)?(?:instagram\.com|instagr\.am)\/([A-Za-z0-9._]+)/i);

    if (!instagramUrlMatch) return null;

    const username = instagramUrlMatch[1].replace(/^@/, '').toLowerCase();
    const reservedPaths = ['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'direct'];

    if (!username || reservedPaths.includes(username)) return null;

    return username;
}

function buildInstagramProfileUrl(username) {
    const url = new URL(INSTAGRAM_WEB_PROFILE_URL);
    url.searchParams.set('username', username);

    return url;
}

function buildInstagramProfilePageUrl(username) {
    return `${INSTAGRAM_PROFILE_PAGE_URL}${username}/`;
}

function getInstagramCookieHeader() {
    if (process.env.INSTAGRAM_COOKIE) {
        return process.env.INSTAGRAM_COOKIE;
    }

    if (process.env.INSTAGRAM_SESSION_ID) {
        return `sessionid=${process.env.INSTAGRAM_SESSION_ID}`;
    }

    return null;
}

function getInstagramCsrfToken(cookieHeader) {
    if (!cookieHeader) return null;

    const csrfMatch = cookieHeader.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return csrfMatch ? csrfMatch[1] : null;
}

function getInstagramHeaders({ accept = 'application/json', referer = INSTAGRAM_PROFILE_PAGE_URL } = {}) {
    const cookieHeader = getInstagramCookieHeader();
    const csrfToken = getInstagramCsrfToken(cookieHeader);
    const headers = {
        accept,
        'accept-language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
        referer,
        'sec-fetch-dest': accept.includes('html') ? 'document' : 'empty',
        'sec-fetch-mode': accept.includes('html') ? 'navigate' : 'cors',
        'sec-fetch-site': 'same-origin',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'x-asbd-id': '129477',
        'x-ig-app-id': '936619743392459',
        'x-requested-with': 'XMLHttpRequest'
    };

    if (cookieHeader) {
        headers.cookie = cookieHeader;
        console.log('[Instagram] Cookie fournie via variable d’environnement.');
    }

    if (csrfToken) {
        headers['x-csrftoken'] = csrfToken;
    }

    return headers;
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

function getTextBetween(text, start, end) {
    const startIndex = text.indexOf(start);

    if (startIndex === -1) return null;

    const contentStart = startIndex + start.length;
    const endIndex = text.indexOf(end, contentStart);

    if (endIndex === -1) return null;

    return text.slice(contentStart, endIndex);
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

function normalizeInstagramProfile(profile, source) {
    return {
        source,
        biography: profile.biography || '',
        highlightCount: typeof profile.highlight_reel_count === 'number'
            ? profile.highlight_reel_count
            : null,
        hasProfilePicture: Boolean(profile.profile_pic_url || profile.profile_pic_url_hd) &&
            profile.has_anonymous_profile_picture !== true
    };
}

async function fetchInstagramProfileFromWebApi(username) {
    const url = buildInstagramProfileUrl(username);

    console.log(`[Instagram][web_api] Requête: ${url.toString()}`);

    const response = await fetchWithTimeout(url, {
        headers: getInstagramHeaders({
            accept: 'application/json',
            referer: buildInstagramProfilePageUrl(username)
        })
    });

    const contentType = response.headers.get('content-type') || 'unknown';
    const body = await response.text();

    console.log(`[Instagram][web_api] Status: ${response.status}`);
    console.log(`[Instagram][web_api] Content-Type: ${contentType}`);
    console.log(`[Instagram][web_api] Taille réponse: ${body.length} caractères`);

    if (response.status === 404) {
        return {
            ok: false,
            reason: 'not_found'
        };
    }

    if (response.status === 401 || response.status === 403 || response.status === 429) {
        console.log(`[Instagram][web_api] Accès limité ou bloqué par Instagram. Extrait: ${body.slice(0, 180)}`);
        return {
            ok: false,
            reason: 'blocked'
        };
    }

    if (!response.ok) {
        console.log(`[Instagram][web_api] Réponse non OK. Extrait: ${body.slice(0, 180)}`);
        return {
            ok: false,
            reason: 'instagram_unavailable'
        };
    }

    let data;

    try {
        data = JSON.parse(body);
    } catch (error) {
        console.log('[Instagram][web_api] JSON invalide.');
        console.log(`[Instagram][web_api] Extrait: ${body.slice(0, 180)}`);
        return {
            ok: false,
            reason: 'invalid_json'
        };
    }

    const profile = data?.data?.user;

    if (!profile) {
        console.log('[Instagram][web_api] Champ data.user absent.');
        return {
            ok: false,
            reason: 'profile_missing'
        };
    }

    const normalizedProfile = normalizeInstagramProfile(profile, 'web_api');

    console.log(`[Instagram][web_api] Bio: ${Boolean(normalizedProfile.biography.trim())}`);
    console.log(`[Instagram][web_api] Photo: ${normalizedProfile.hasProfilePicture}`);
    console.log(`[Instagram][web_api] Highlights: ${normalizedProfile.highlightCount}`);

    return {
        ok: true,
        profile: normalizedProfile
    };
}

function parseInstagramProfileFromHtml(html) {
    const ldJsonRaw = getTextBetween(html, '<script type="application/ld+json">', '</script>');
    const ogDescriptionMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]*)"/i);
    const ogImageMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]*)"/i);
    let biography = '';
    let hasProfilePicture = false;

    if (ldJsonRaw) {
        try {
            const ldJson = JSON.parse(decodeHtmlEntities(ldJsonRaw));
            biography = stripHtml(ldJson.description || '');
            hasProfilePicture = Boolean(ldJson.image);
        } catch (error) {
            console.log('[Instagram][html] JSON-LD invalide, fallback sur meta tags.');
        }
    }

    if (!biography && ogDescriptionMatch?.[1]) {
        const description = decodeHtmlEntities(ogDescriptionMatch[1]);
        const bioCandidate = description.split(' - ')[1] || description;
        biography = stripHtml(bioCandidate.replace(/^See Instagram photos and videos from\s+/i, ''));
    }

    if (!hasProfilePicture && ogImageMatch?.[1]) {
        hasProfilePicture = Boolean(decodeHtmlEntities(ogImageMatch[1]).trim());
    }

    return {
        source: 'html',
        biography,
        hasProfilePicture,
        highlightCount: null
    };
}

async function fetchInstagramProfileFromHtml(username) {
    const url = buildInstagramProfilePageUrl(username);

    console.log(`[Instagram][html] Requête: ${url}`);

    const response = await fetchWithTimeout(url, {
        headers: getInstagramHeaders({
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            referer: INSTAGRAM_PROFILE_PAGE_URL
        })
    });

    const contentType = response.headers.get('content-type') || 'unknown';
    const body = await response.text();

    console.log(`[Instagram][html] Status: ${response.status}`);
    console.log(`[Instagram][html] Content-Type: ${contentType}`);
    console.log(`[Instagram][html] Taille réponse: ${body.length} caractères`);

    if (response.status === 404) {
        return {
            ok: false,
            reason: 'not_found'
        };
    }

    if (!response.ok) {
        console.log(`[Instagram][html] Réponse non OK. Extrait: ${body.slice(0, 180)}`);
        return {
            ok: false,
            reason: 'instagram_unavailable'
        };
    }

    const profile = parseInstagramProfileFromHtml(body);

    console.log(`[Instagram][html] Bio: ${Boolean(profile.biography.trim())}`);
    console.log(`[Instagram][html] Photo: ${profile.hasProfilePicture}`);
    console.log('[Instagram][html] Highlights: indisponible dans le HTML public.');

    if (!profile.biography && !profile.hasProfilePicture) {
        return {
            ok: false,
            reason: 'profile_missing'
        };
    }

    return {
        ok: true,
        profile
    };
}

function mergeInstagramProfiles(primaryProfile, fallbackProfile) {
    if (!fallbackProfile) return primaryProfile;

    return {
        source: `${primaryProfile.source}+${fallbackProfile.source}`,
        biography: primaryProfile.biography || fallbackProfile.biography || '',
        hasProfilePicture: primaryProfile.hasProfilePicture || fallbackProfile.hasProfilePicture,
        highlightCount: primaryProfile.highlightCount ?? fallbackProfile.highlightCount
    };
}

async function fetchInstagramProfile(username) {
    console.log('====================');
    console.log(`[Instagram] Analyse du profil @${username}`);
    console.log(`[Instagram] Auth optionnelle: ${getInstagramCookieHeader() ? 'cookie/session configurée' : 'aucune cookie/session'}`);
    console.log('====================');

    try {
        const webApiResult = await fetchInstagramProfileFromWebApi(username);

        if (webApiResult.ok) {
            const htmlResult = await fetchInstagramProfileFromHtml(username).catch(error => {
                console.log('[Instagram][html] Fallback HTML échoué après succès API.');
                console.log(error);
                return null;
            });

            return {
                ok: true,
                profile: mergeInstagramProfiles(webApiResult.profile, htmlResult?.profile)
            };
        }

        if (webApiResult.reason === 'not_found') {
            return {
                ok: false,
                reason: 'not_found'
            };
        }

        console.log(`[Instagram] API web indisponible (${webApiResult.reason}), tentative fallback HTML.`);

        const htmlResult = await fetchInstagramProfileFromHtml(username);

        if (htmlResult.ok) {
            return htmlResult;
        }

        return {
            ok: false,
            reason: htmlResult.reason === 'not_found' ? 'not_found' : webApiResult.reason
        };
    } catch (error) {
        console.log('[Instagram] Erreur globale pendant la récupération.');
        console.log(error);

        return {
            ok: false,
            reason: 'instagram_unavailable'
        };
    }
}

function validateInstagramProfile(profile) {
    const missingItems = [];
    const biography = profile.biography || '';
    const highlightCount = typeof profile.highlightCount === 'number' ? profile.highlightCount : null;
    const hasProfilePicture = profile.hasProfilePicture === true;

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

    if (highlightCount === null) {
        missingItems.push({
            summary: 'le nombre de highlights n’a pas pu être vérifié',
            details: 'Instagram n’a pas renvoyé le compteur de highlights. Configure INSTAGRAM_COOKIE ou INSTAGRAM_SESSION_ID sur Render pour fiabiliser cette vérification.'
        });
    } else if (highlightCount !== INSTAGRAM_REQUIRED_HIGHLIGHTS) {
        const missingHighlightCount = Math.max(INSTAGRAM_REQUIRED_HIGHLIGHTS - highlightCount, 0);
        const extraHighlightCount = Math.max(highlightCount - INSTAGRAM_REQUIRED_HIGHLIGHTS, 0);

        missingItems.push({
            summary: missingHighlightCount > 0
                ? `il manque ${missingHighlightCount} highlight${missingHighlightCount > 1 ? 's' : ''}`
                : `il faut supprimer ${extraHighlightCount} highlight${extraHighlightCount > 1 ? 's' : ''}`,
            details: `Le compte doit avoir exactement ${INSTAGRAM_REQUIRED_HIGHLIGHTS} highlights. Actuellement : ${highlightCount}.`
        });
    }

    return {
        isValid: missingItems.length === 0,
        missingItems,
        highlightCount
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

function getValidatedChannelName(username) {
    const safeUsername = username
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80);

    return `cpt-${safeUsername || 'instagram'}-✅`;
}

function getInstagramFetchErrorMessage(reason, username) {
    if (reason === 'not_found') {
        return `❌ Impossible de trouver le compte Instagram **@${username}**. Vérifie le lien puis renvoie-le ici.`;
    }

    if (reason === 'blocked') {
        return '❌ Instagram bloque temporairement la récupération du profil depuis le serveur. Réessaie dans quelques minutes. Si ça revient souvent, configure `INSTAGRAM_COOKIE` ou `INSTAGRAM_SESSION_ID` sur Render.';
    }

    return '❌ Impossible d’analyser le compte Instagram pour le moment. Réessaie en renvoyant le lien dans quelques minutes.';
}

async function validateInstagramAccount(message, username) {
    await message.channel.send('🔎 Analyse automatique du compte Instagram en cours...');

    const result = await fetchInstagramProfile(username);

    if (!result.ok) {
        console.log(`[Instagram] Validation impossible pour @${username}. Raison: ${result.reason}`);
        await message.channel.send(getInstagramFetchErrorMessage(result.reason, username));
        return;
    }

    console.log(`[Instagram] Profil récupéré via: ${result.profile.source}`);

    const validation = validateInstagramProfile(result.profile);

    console.log(`[Instagram] Validation @${username}: ${validation.isValid ? 'valide' : 'non valide'}`);

    if (!validation.isValid) {
        await message.channel.send(`
❌ **Compte Instagram non valide**

${formatMissingItems(validation.missingItems)}.

${formatValidationDetails(validation.missingItems)}

Corrige le compte, puis renvoie le lien Instagram ici pour une nouvelle vérification automatique.
        `);
        return;
    }

    const updatedChannel = await message.channel.setName(getValidatedChannelName(username));

    await message.channel.send(`
✅ **Compte Instagram valide**

Bio présente.
Photo de profil présente.
Exactement ${INSTAGRAM_REQUIRED_HIGHLIGHTS} highlights.

Le salon a été renommé en **${updatedChannel.name}**.
    `);

    await updateDashboard(message.guild);
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

        // DEBUG LOGS
        console.log('====================');
        console.log('MESSAGE DETECTÉ');
        console.log(message.content);
        console.log('TOPIC:', message.channel.topic);
        console.log('AUTHOR:', message.author.id);
        console.log('====================');

        // Vérifie salon privé utilisateur
        if (message.channel.topic !== message.author.id) return;

        const instagramUsername = extractInstagramUsername(message.content);

        if (!instagramUsername) return;

        console.log(`🔥 Lien Instagram détecté : @${instagramUsername}`);

        await validateInstagramAccount(message, instagramUsername);

    } catch (error) {

        console.log('❌ ERREUR GLOBALE');
        console.log(error);
    }
});

client.login(process.env.DISCORD_TOKEN);
