require('dotenv').config();

const CATEGORY_ID = '1502055567760425122';
const COMPTE_CREE_CATEGORY_ID = '1502120982591045805';
const DASHBOARD_CHANNEL_NAME = '📊・dashboard';
const DASHBOARD_UPDATE_INTERVAL_MS = 12 * 60 * 60 * 1000;
const INSTAGRAM_BASE_URL = 'https://www.instagram.com';
const VA_ACTIVE_CATEGORY_NAME = 'VA ACTIF 😎';
const VA_OP_CATEGORY_NAME = 'VA OP ☑️';

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
    const instagramUrlMatch = content.match(/(?:https?:\/\/)?(?:www\.)?instagram\.com\/([a-zA-Z0-9._]+)(?:[/?#]|$)/i);

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

function normalizeInstagramHtml(html) {
    return decodeHtmlEntities(html)
        .replace(/\\u0022/g, '"')
        .replace(/\\"/g, '"')
        .replace(/\\\//g, '/')
        .replace(/\\u0026/g, '&');
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

function buildInstagramProfileUrl(username) {
    return `${INSTAGRAM_BASE_URL}/${username}/`;
}

function extractMetaContent(html, property) {
    const metaTags = html.match(/<meta\b[^>]*>/gi) || [];

    for (const tag of metaTags) {
        const propertyMatch = tag.match(/(?:property|name)=["']([^"']+)["']/i);
        if (!propertyMatch || propertyMatch[1] !== property) continue;

        const contentMatch = tag.match(/content=["']([^"']*)["']/i);
        return contentMatch ? decodeHtmlEntities(contentMatch[1]) : '';
    }

    return '';
}

function extractJsonLd(html) {
    const match = html.match(/<script type=["']application\/ld\+json["']>(.*?)<\/script>/is);

    if (!match) return null;

    try {
        return JSON.parse(decodeHtmlEntities(match[1]));
    } catch (error) {
        console.log('[Instagram] JSON-LD illisible.');
        return null;
    }
}

function extractJsonStringValue(html, key) {
    const pattern = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, 'i');
    const match = html.match(pattern) || normalizeInstagramHtml(html).match(pattern);

    if (!match) return '';

    try {
        return JSON.parse(`"${match[1]}"`);
    } catch (error) {
        return normalizeInstagramHtml(match[1]);
    }
}

function parseJsonBlock(rawJson) {
    try {
        const cleanJson = decodeHtmlEntities(rawJson)
            .replace(/^<!--/, '')
            .replace(/-->$/, '')
            .trim();

        return JSON.parse(cleanJson);
    } catch (error) {
        return null;
    }
}

function extractPublicJsonBlocks(html) {
    const blocks = [];
    const scriptPattern = /<script\b[^>]*type=["']application\/json["'][^>]*>(.*?)<\/script>/gis;
    const nextDataPattern = /<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>(.*?)<\/script>/is;
    let match;

    while ((match = scriptPattern.exec(html)) !== null) {
        const parsed = parseJsonBlock(match[1]);
        if (parsed) blocks.push(parsed);
    }

    const nextDataMatch = html.match(nextDataPattern);
    if (nextDataMatch) {
        const parsed = parseJsonBlock(nextDataMatch[1]);
        if (parsed) blocks.push(parsed);
    }

    const jsonLd = extractJsonLd(html);
    if (jsonLd) blocks.push(jsonLd);

    return blocks;
}

function isDefaultInstagramProfilePicture(value) {
    const text = String(value || '');
    return !text ||
        text.includes('44884218_345707102882519_2446069589734326272_n.jpg') ||
        text.includes('anonymousUser.jpg');
}

function rememberBiography(signals, value) {
    const biography = stripHtml(String(value || ''));
    if (biography && !signals.biography && !/^see instagram photos and videos/i.test(biography)) {
        signals.biography = biography;
    }
}

function collectInstagramSignals(value, username, signals, parentKey = '', depth = 0) {
    if (!value || depth > 18) return;

    if (Array.isArray(value)) {
        if (/edge_owner_to_timeline_media|timeline|media|post/i.test(parentKey) && value.length > 0) {
            signals.postCount = Math.max(signals.postCount, value.length);
        }

        for (const item of value) {
            collectInstagramSignals(item, username, signals, parentKey, depth + 1);
        }

        return;
    }

    if (typeof value !== 'object') return;

    for (const [key, childValue] of Object.entries(value)) {
        const lowerKey = key.toLowerCase();
        const nextParentKey = parentKey ? `${parentKey}.${lowerKey}` : lowerKey;

        if (['username', 'user_name', 'login'].includes(lowerKey) && String(childValue).toLowerCase() === username) {
            signals.usernameFound = true;
        }

        if (['biography', 'bio', 'biography_text'].includes(lowerKey) && typeof childValue === 'string') {
            rememberBiography(signals, childValue);
        }

        if (lowerKey === 'raw_text' && /biography|bio/.test(parentKey) && typeof childValue === 'string') {
            rememberBiography(signals, childValue);
        }

        if ([
            'profile_pic_url',
            'profile_pic_url_hd',
            'profile_picture',
            'profilepicture',
            'avatar',
            'image'
        ].includes(lowerKey) && !isDefaultInstagramProfilePicture(childValue)) {
            signals.profilePicture = String(childValue);
        }

        if (['media_count', 'posts_count', 'post_count'].includes(lowerKey) && Number.isFinite(Number(childValue))) {
            signals.postCount = Math.max(signals.postCount, Number(childValue));
        }

        if (lowerKey === 'count' && /edge_owner_to_timeline_media|timeline_media|posts|media/.test(parentKey) && Number.isFinite(Number(childValue))) {
            signals.postCount = Math.max(signals.postCount, Number(childValue));
        }

        if (lowerKey === 'edges' && /edge_owner_to_timeline_media|timeline_media|posts|media/.test(parentKey) && Array.isArray(childValue)) {
            signals.postCount = Math.max(signals.postCount, childValue.length);
        }

        collectInstagramSignals(childValue, username, signals, nextParentKey, depth + 1);
    }
}

function parsePublicInstagramPage(html, username, status) {
    const ogDescription = extractMetaContent(html, 'og:description');
    const ogImage = extractMetaContent(html, 'og:image');
    const canonicalUrl = extractMetaContent(html, 'og:url');
    const ogTitle = extractMetaContent(html, 'og:title');
    const lowerUsername = username.toLowerCase();
    const searchableHtml = normalizeInstagramHtml(html);
    const signals = {
        usernameFound: false,
        biography: '',
        profilePicture: '',
        postCount: 0
    };

    for (const jsonBlock of extractPublicJsonBlocks(html)) {
        collectInstagramSignals(jsonBlock, lowerUsername, signals);
    }

    const rawBiography = signals.biography ||
        extractJsonStringValue(html, 'biography') ||
        extractJsonStringValue(html, 'bio') ||
        searchableHtml.match(/"biography_with_entities"\s*:\s*\{[^}]*"raw_text"\s*:\s*"((?:\\.|[^"\\])*)"/i)?.[1] ||
        ogDescription.match(/(?:on Instagram|sur Instagram)\s*:\s*["“](.+?)["”]\s*$/i)?.[1] ||
        '';
    const rawProfilePicture = signals.profilePicture ||
        extractJsonStringValue(html, 'profile_pic_url_hd') ||
        extractJsonStringValue(html, 'profile_pic_url') ||
        extractJsonStringValue(html, 'profile_picture') ||
        ogImage ||
        '';
    const mediaCountMatch = searchableHtml.match(/"edge_owner_to_timeline_media"\s*:\s*\{\s*"count"\s*:\s*(\d+)/) ||
        searchableHtml.match(/"media_count"\s*:\s*(\d+)/) ||
        searchableHtml.match(/"posts_count"\s*:\s*(\d+)/) ||
        ogDescription.match(/([\d,.]+)\s+(?:posts?|publications?)/i);
    const biography = stripHtml(rawBiography);
    const hasVisiblePostMarker = /<meta[^>]+property=["']og:image["'][^>]+content=["'][^"']+instagram[^"']+["']/i.test(html) ||
        /"shortcode"\s*:\s*"[^"]+"/i.test(searchableHtml) ||
        /"display_url"\s*:\s*"[^"]+"/i.test(searchableHtml);
    const fallbackPostCount = mediaCountMatch ? Number(String(mediaCountMatch[1]).replace(/[,.]/g, '')) : 0;
    const postCount = Math.max(
        signals.postCount,
        Number.isFinite(fallbackPostCount) ? fallbackPostCount : 0,
        hasVisiblePostMarker ? 1 : 0
    );
    const profileExists = status === 200 &&
        !/Sorry, this page isn't available|Page Not Found|Cette page n’est malheureusement pas disponible/i.test(html) &&
        (
            signals.usernameFound ||
            canonicalUrl.toLowerCase().includes(`/${lowerUsername}/`) ||
            ogTitle.toLowerCase().includes(`@${lowerUsername}`) ||
            searchableHtml.toLowerCase().includes(`"username":"${lowerUsername}"`) ||
            searchableHtml.toLowerCase().includes(`/${lowerUsername}/`)
        );

    const hasProfilePicture = profileExists && !isDefaultInstagramProfilePicture(rawProfilePicture);

    console.log(`[Instagram] Signaux: profil=${profileExists} username=${signals.usernameFound} bio=${Boolean(biography)} photo=${hasProfilePicture} posts=${postCount}`);

    return {
        username,
        profileExists,
        biography,
        hasBio: Boolean(biography.trim()),
        hasProfilePicture,
        postCount: Number.isFinite(postCount) ? postCount : 0
    };
}

async function fetchPublicInstagramProfile(username) {
    const url = buildInstagramProfileUrl(username);

    console.log('====================');
    console.log(`[Instagram] Validation publique: @${username}`);
    console.log(`[Instagram] URL: ${url}`);
    console.log('====================');

    try {
        const response = await fetchWithTimeout(url, {
            headers: {
                'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'accept-language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
            }
        });
        const html = await response.text();

        console.log(`[Instagram] Status: ${response.status}`);
        console.log(`[Instagram] Taille HTML: ${html.length} caractères`);

        if (!response.ok && response.status !== 404) {
            return {
                ok: false,
                reason: 'unavailable'
            };
        }

        return {
            ok: true,
            profile: parsePublicInstagramPage(html, username, response.status)
        };
    } catch (error) {
        console.log('[Instagram] Erreur validation publique.');
        console.log(error?.message || error);

        return {
            ok: false,
            reason: 'unavailable'
        };
    }
}

function validateInstagramProfile(profile) {
    const missingItems = [];

    if (!profile.profileExists) {
        missingItems.push('profil introuvable');
    }

    if (!profile.hasBio) {
        missingItems.push('bio');
    }

    if (!profile.hasProfilePicture) {
        missingItems.push('photo de profil');
    }

    if (profile.postCount < 1) {
        missingItems.push('au moins 1 post');
    }

    return {
        isValid: missingItems.length === 0,
        missingItems
    };
}

function formatValidationDetails(missingItems) {
    return missingItems.map(item => `- ${item}`).join('\n');
}

function getVaChannelName(discordUsername, isValidated = false) {
    const safeUsername = discordUsername
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80);

    return `cpt-${safeUsername || 'va'}${isValidated ? '-✅' : ''}`;
}

async function getCategoryByNameOrId(guild, categoryName, fallbackId) {
    await guild.channels.fetch();

    const categoryByName = guild.channels.cache.find(channel =>
        channel.type === ChannelType.GuildCategory &&
        channel.name === categoryName
    );

    if (categoryByName) return categoryByName;

    const categoryById = guild.channels.cache.get(fallbackId);
    if (categoryById?.type === ChannelType.GuildCategory) return categoryById;

    throw new Error(`Catégorie Discord introuvable: ${categoryName}`);
}

async function sendDiscordMessage(channel, content) {
    try {
        await channel.send(content);
    } catch (error) {
        console.log('[Discord] Impossible d’envoyer le message.');
        console.log(error?.message || error);
    }
}

async function sendAndPinVaOpMessage(channel, instagramUrl) {
    const sentMessage = await channel.send(`
📸 **Compte Instagram détecté :**

${instagramUrl}

━━━━━━━━━━━━━━

✅ Ton compte est en cours de vérification automatique.

🔥 Continue maintenant :
• ton warm-up ;
• tes reels ;
• ta régularité.

📚 Ressources utiles :
➜ <#1485480560741847212>
➜ <#1485480522023964772>

🚀 Petit conseil :
Créer un compte Threads peut énormément aider ton compte à faire plus de vues.

━━━━━━━━━━━━━━
    `);

    await sentMessage.pin().catch(error => {
        console.log('[Discord] Impossible d’épingler le message VA OP.');
        console.log(error?.message || error);
    });
}

async function updateVaOpRoles(message) {
    const member = await message.guild.members.fetch(message.author.id);

    try {
        if (!member.roles.cache.has(COMPTE_CREE_ROLE_ID)) {
            await member.roles.add(COMPTE_CREE_ROLE_ID);
            console.log(`[Discord] Rôle VA OP ajouté à ${message.author.id}.`);
        }
    } catch (error) {
        console.log('[Discord] Impossible d’ajouter le rôle VA OP.');
        console.log(error?.message || error);
    }

    try {
        if (member.roles.cache.has(VA_ROLE_ID)) {
            await member.roles.remove(VA_ROLE_ID);
            console.log(`[Discord] Rôle VA ACTIF retiré à ${message.author.id}.`);
        }
    } catch (error) {
        console.log('[Discord] Impossible de retirer le rôle VA ACTIF.');
        console.log(error?.message || error);
    }
}

async function createInstagramWorkflowChannel(message, username) {
    const finalChannelName = getVaChannelName(message.author.username);
    const vaOpCategory = await getCategoryByNameOrId(
        message.guild,
        VA_OP_CATEGORY_NAME,
        COMPTE_CREE_CATEGORY_ID
    );

    await message.guild.channels.fetch();

    const existingFinalChannel = message.guild.channels.cache.find(channel =>
        channel.type === ChannelType.GuildText &&
        channel.parentId === vaOpCategory.id &&
        channel.topic === message.author.id
    );

    if (existingFinalChannel) {
        if (existingFinalChannel.name !== finalChannelName) {
            await existingFinalChannel.setName(finalChannelName);
        }

        await updateVaOpRoles(message);

        if (existingFinalChannel.id !== message.channel.id) {
            await message.channel.delete().catch(error => {
                console.log('[Discord] Impossible de supprimer l’ancien salon.');
                console.log(error?.message || error);
            });
        }

        await updateDashboard(message.guild);
        return existingFinalChannel;
    }

    const finalChannel = await message.guild.channels.create({
        name: finalChannelName,
        type: ChannelType.GuildText,
        parent: vaOpCategory.id,
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

    await updateVaOpRoles(message);
    await sendAndPinVaOpMessage(finalChannel, message.content);

    if (message.channel.id !== finalChannel.id) {
        await message.channel.delete().catch(error => {
            console.log('[Discord] Impossible de supprimer l’ancien salon.');
            console.log(error?.message || error);
        });
    }

    await updateDashboard(message.guild);
    return finalChannel;
}

async function validateInstagramAccount(channel, username, discordUsername) {
    try {
        const result = await fetchPublicInstagramProfile(username);

        if (!result.ok) {
            console.log(`[Instagram][FAIL] Validation publique impossible pour @${username}.`);
            await sendDiscordMessage(channel, '❌ Vérification Instagram temporairement indisponible. Réessaie plus tard.');
            return;
        }

        const validation = validateInstagramProfile(result.profile);

        console.log(`[Instagram][${validation.isValid ? 'SUCCESS' : 'FAIL'}] @${username} bio=${result.profile.hasBio} photo=${result.profile.hasProfilePicture} posts=${result.profile.postCount}`);

        if (!validation.isValid) {
            await sendDiscordMessage(channel, `
❌ **Compte Instagram non valide**

Il manque :
${formatValidationDetails(validation.missingItems)}
        `);
            return;
        }

        const validatedChannelName = getVaChannelName(discordUsername, true);

        if (channel.name !== validatedChannelName) {
            await channel.setName(validatedChannelName);
        }

        await sendDiscordMessage(channel, `
✅ Compte Instagram valide

Le compte respecte toutes les conditions :
• bio
• photo de profil
• au moins 1 post

Le salon a été validé automatiquement.
        `);
    } catch (error) {
        console.log('[Instagram] Erreur imprévue pendant la validation.');
        console.log(error?.message || error);
        await sendDiscordMessage(channel, '❌ Vérification Instagram temporairement indisponible. Réessaie plus tard.');
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

        const workflowKey = `${message.guild.id}:${message.author.id}`;

        // Verrou par utilisateur: évite deux transitions/réponses si deux liens arrivent en même temps.
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
            const workflowChannel = await createInstagramWorkflowChannel(message, instagramUsername);
            await validateInstagramAccount(workflowChannel, instagramUsername, message.author.username);
        } finally {
            instagramValidationsInProgress.delete(workflowKey);
        }

    } catch (error) {

        console.log('❌ ERREUR GLOBALE');
        console.log(error);
    }
});

client.login(process.env.DISCORD_TOKEN);
