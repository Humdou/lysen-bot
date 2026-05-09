const { ChannelType, PermissionsBitField } = require('discord.js');
const { CONFIG } = require('./config');

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
    if (interaction.deferred && !interaction.replied) {
        const { ephemeral, ...editOptions } = options;
        return interaction.editReply(editOptions);
    }

    if (interaction.replied) {
        return interaction.followUp(options);
    }

    return interaction.reply(options);
}

function isVaActiveWorkflowChannel(message, vaActiveCategoryId) {
    return message.channel?.type === ChannelType.GuildText &&
        message.channel.topic === message.author.id &&
        message.channel.parentId === vaActiveCategoryId;
}

module.exports = {
    createPrivateWorkflowChannel,
    fetchGuildChannels,
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
};
