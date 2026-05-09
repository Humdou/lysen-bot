require('dotenv').config();

const {
    Client,
    GatewayIntentBits
} = require('discord.js');

const { COMMAND_RESPONSES, getSlashCommands } = require('./src/commands');
const { CONFIG } = require('./src/config');
const { createDashboardService } = require('./src/dashboard');
const {
    createPrivateWorkflowChannel,
    findUserWorkflowChannel,
    getVaActiveCategory,
    getVaChannelName,
    getVaOpCategory,
    getWorkflowKey,
    isVaActiveWorkflowChannel,
    replySafely,
    safeDeleteChannel,
    safePin,
    updateMemberRoles
} = require('./src/discord-utils');
const { extractInstagramProfile } = require('./src/instagram-link');
const { createStore } = require('./src/metrics-store');
const { getOnboardingMessage, getVaOpMessage } = require('./src/messages');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const startLocks = new Set();
const vaOpTransitionLocks = new Set();
const processedInstagramMessages = new Set();
const metricsStore = createStore();
const dashboardService = createDashboardService(client, metricsStore);

function requireDiscordToken() {
    if (!process.env.DISCORD_TOKEN) {
        throw new Error('DISCORD_TOKEN est manquant dans l’environnement.');
    }
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

async function startOnboarding(interaction) {
    const workflowKey = getWorkflowKey(interaction.guild.id, interaction.user.id);

    if (startLocks.has(workflowKey)) {
        return replySafely(interaction, {
            content: '⚠️ Création déjà en cours. Réessaie dans quelques secondes.'
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
                content: `⚠️ Tu as déjà un salon privé : ${existingChannel}`
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
        await metricsStore.recordOnboardingStart();
        await dashboardService.updateGuildDashboard(interaction.guild);

        return replySafely(interaction, {
            content: `✅ Ton salon privé a été créé : ${channel}`
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

        if (!existingFinalChannel) {
            await metricsStore.recordVaOpChannelCreated();
        }

        if (finalChannel.name !== finalChannelName) {
            await finalChannel.setName(finalChannelName);
        }

        const member = await message.guild.members.fetch(message.author.id);
        const wasAlreadyVaOp = member.roles.cache.has(CONFIG.roles.vaOp);

        await updateMemberRoles(member, {
            add: [CONFIG.roles.vaOp],
            remove: [CONFIG.roles.vaActive]
        });

        await ensureVaOpMessage(finalChannel, instagramProfile);

        if (!wasAlreadyVaOp || !existingFinalChannel) {
            await metricsStore.recordCompletedOnboarding();
        }

        if (message.channel.id !== finalChannel.id) {
            await safeDeleteChannel(message.channel, 'VA ACTIF');
        }

        await dashboardService.updateGuildDashboard(message.guild);

        console.log(`[Workflow] ${message.author.id} déplacé en VA OP avec @${instagramProfile.username}.`);
    } finally {
        vaOpTransitionLocks.delete(workflowKey);
    }
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
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply({ ephemeral: true });
        }

        await metricsStore.recordCommand(interaction.commandName, interaction.user.id);
        await startOnboarding(interaction);
        return;
    }

    const response = COMMAND_RESPONSES[interaction.commandName];

    if (!response) {
        await interaction.reply({
            content: '❌ Commande inconnue.',
            ephemeral: true
        });
        return;
    }

    await interaction.reply({
        content: response,
        ephemeral: true
    });

    await metricsStore.recordCommand(interaction.commandName, interaction.user.id);
}

async function handleInstagramMessage(message) {
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
    await metricsStore.recordInstagramSubmission();

    console.log('====================');
    console.log(`[Workflow] Lien Instagram détecté: @${instagramProfile.username}`);
    console.log(`[Workflow] URL normalisée: ${instagramProfile.url}`);
    console.log(`[Workflow] Message: ${message.id}`);
    console.log(`[Workflow] Salon: ${message.channel.id}`);
    console.log(`[Workflow] Auteur: ${message.author.id}`);
    console.log('====================');

    await moveUserToVaOp(message, instagramProfile);
}

function installProcessGuards() {
    process.on('unhandledRejection', error => {
        console.log('[Process] Promesse rejetée non gérée.');
        console.log(error?.message || error);
    });

    process.on('uncaughtException', error => {
        console.log('[Process] Exception non gérée.');
        console.log(error?.message || error);
    });
}

async function bootstrap() {
    installProcessGuards();
    requireDiscordToken();
    await metricsStore.load();
    await client.login(process.env.DISCORD_TOKEN);
}

client.once('ready', async () => {
    console.log(`🔥 Bot connecté : ${client.user.tag}`);

    await registerSlashCommands().catch(error => {
        console.log('[Discord] Impossible d’enregistrer les commandes slash.');
        console.log(error?.message || error);
    });

    await dashboardService.updateAllDashboards();
    setInterval(() => {
        dashboardService.updateAllDashboards().catch(error => {
            console.log('[Dashboard] Erreur intervalle.');
            console.log(error?.message || error);
        });
    }, CONFIG.guild.dashboardUpdateIntervalMs);
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
        await handleInstagramMessage(message);
    } catch (error) {
        console.log('❌ Erreur workflow message');
        console.log(error?.message || error);
    }
});

bootstrap().catch(error => {
    console.log('[Process] Démarrage impossible.');
    console.log(error?.message || error);
    process.exitCode = 1;
});
