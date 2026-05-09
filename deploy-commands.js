require('dotenv').config();

const { REST, Routes } = require('discord.js');
const { getSlashCommands } = require('./src/commands');
const { CONFIG } = require('./src/config');

function requireDeployConfig() {
    if (!process.env.DISCORD_TOKEN) {
        throw new Error('DISCORD_TOKEN est manquant dans l’environnement.');
    }

    if (!CONFIG.app.clientId || !CONFIG.app.guildId) {
        throw new Error('DISCORD_CLIENT_ID ou DISCORD_GUILD_ID est manquant.');
    }
}

(async () => {
    try {
        requireDeployConfig();

        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        const commands = getSlashCommands();

        console.log('Déploiement des commandes...');

        await rest.put(
            Routes.applicationGuildCommands(CONFIG.app.clientId, CONFIG.app.guildId),
            { body: commands }
        );

        console.log('Commandes déployées.');
    } catch (error) {
        console.error(error?.message || error);
        process.exitCode = 1;
    }
})();
