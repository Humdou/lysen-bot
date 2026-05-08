require('dotenv').config();

const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [

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

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

const CLIENT_ID = '1501621868258525275';
const GUILD_ID = '1485476914218139740';

(async () => {
    try {

        console.log('Déploiement des commandes...');

        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
            { body: commands }
        );

        console.log('Commandes déployées.');

    } catch (error) {
        console.error(error);
    }
})();