const { SlashCommandBuilder } = require('discord.js');
const { CONFIG } = require('./config');

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

module.exports = {
    COMMAND_RESPONSES,
    getSlashCommands
};
