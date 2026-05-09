require('dotenv').config();

const CATEGORY_ID = '1502055567760425122';
const COMPTE_CREE_CATEGORY_ID = '1502120982591045805';
const DASHBOARD_CHANNEL_NAME = '📊・dashboard';
const DASHBOARD_UPDATE_INTERVAL_MS = 12 * 60 * 60 * 1000;
const INSTAGRAM_BASE_URL = 'https://www.instagram.com';

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
    const decodedHtml = decodeHtmlEntities(html)
        .replace(/\\u0022/g, '"')
        .replace(/\\"/g, '"')
        .replace(/\\\//g, '/');
    const pattern = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, 'i');
    const match = decodedHtml.match(pattern);

    if (!match) return '';

    try {
        return JSON.parse(`"${match[1]}"`);
    } catch (error) {
        return decodeHtmlEntities(match[1].replace(/\\u0026/g, '&'));
    }
}

function parsePublicInstagramPage(html, username, status) {
    const jsonLd = extractJsonLd(html);
    const ogDescription = extractMetaContent(html, 'og:description');
    const ogImage = extractMetaContent(html, 'og:image');
    const canonicalUrl = extractMetaContent(html, 'og:url');
    const ogTitle = extractMetaContent(html, 'og:title');
    const searchableHtml = decodeHtmlEntities(html)
        .replace(/\\u0022/g, '"')
        .replace(/\\"/g, '"')
        .replace(/\\\//g, '/');
    const rawBiography = extractJsonStringValue(html, 'biography') ||
        extractJsonStringValue(html, 'bio') ||
        searchableHtml.match(/"biography_with_entities"\s*:\s*\{[^}]*"raw_text"\s*:\s*"((?:\\.|[^"\\])*)"/i)?.[1] ||
        jsonLd?.description ||
        '';
    const rawProfilePicture = extractJsonStringValue(html, 'profile_pic_url_hd') ||
        extractJsonStringValue(html, 'profile_pic_url') ||
        extractJsonStringValue(html, 'profile_picture') ||
        jsonLd?.image ||
        ogImage ||
        '';
    const mediaCountMatch = searchableHtml.match(/"edge_owner_to_timeline_media"\s*:\s*\{\s*"count"\s*:\s*(\d+)/) ||
        searchableHtml.match(/"media_count"\s*:\s*(\d+)/) ||
        searchableHtml.match(/"posts_count"\s*:\s*(\d+)/) ||
        ogDescription.match(/([\d,.]+)\s+(?:posts?|publications?)/i);
    const biography = stripHtml(rawBiography);
    const postCount = mediaCountMatch ? Number(String(mediaCountMatch[1]).replace(/[,.]/g, '')) : 0;
    const lowerUsername = username.toLowerCase();
    const profileExists = status === 200 &&
        !/Sorry, this page isn't available|Page Not Found|Cette page n’est malheureusement pas disponible/i.test(html) &&
        (
            canonicalUrl.toLowerCase().includes(`/${lowerUsername}/`) ||
            ogTitle.toLowerCase().includes(`@${lowerUsername}`) ||
            searchableHtml.toLowerCase().includes(`"username":"${lowerUsername}"`) ||
            searchableHtml.toLowerCase().includes(`/${lowerUsername}/`)
        );

    return {
        username,
        profileExists,
        biography,
        hasBio: Boolean(biography.trim()),
        hasProfilePicture: Boolean(rawProfilePicture) && !String(rawProfilePicture).includes('44884218_345707102882519_2446069589734326272_n.jpg'),
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

function getValidatedChannelName(instagramUsername) {
    const safeUsername = instagramUsername
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80);

    return `cpt-${safeUsername || 'va'}-✅`;
}

async function sendDiscordMessage(channel, content) {
    try {
        await channel.send(content);
    } catch (error) {
        console.log('[Discord] Impossible d’envoyer le message.');
        console.log(error?.message || error);
    }
}

async function createInstagramWorkflowChannel(message, username) {
    const finalChannelName = getValidatedChannelName(username);

    await message.guild.channels.fetch();

    const existingFinalChannel = message.guild.channels.cache.find(channel =>
        channel.type === ChannelType.GuildText &&
        channel.parentId === COMPTE_CREE_CATEGORY_ID &&
        channel.topic === message.author.id
    );

    if (existingFinalChannel) {
        if (existingFinalChannel.name !== finalChannelName) {
            await existingFinalChannel.setName(finalChannelName);
        }

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

    if (message.channel.id !== finalChannel.id) {
        await message.channel.delete().catch(error => {
            console.log('[Discord] Impossible de supprimer l’ancien salon.');
            console.log(error?.message || error);
        });
    }

    await updateDashboard(message.guild);
    return finalChannel;
}

async function validateInstagramAccount(channel, username) {
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

        await sendDiscordMessage(channel, `
✅ Compte Instagram valide : @${username}

✅ Bio détectée
✅ Photo de profil détectée
✅ ${result.profile.postCount} post détecté${result.profile.postCount > 1 ? 's' : ''}

Salon déplacé vers salon privé 2.
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
            await validateInstagramAccount(workflowChannel, instagramUsername);
        } finally {
            instagramValidationsInProgress.delete(workflowKey);
        }

    } catch (error) {

        console.log('❌ ERREUR GLOBALE');
        console.log(error);
    }
});

client.login(process.env.DISCORD_TOKEN);
