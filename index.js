require('dotenv').config();

const CATEGORY_ID = '1502055567760425122';
const VA_ROLE_ID = '1502068514264055909';
const COMPTE_CREE_ROLE_ID = '1502084425092169749';
const MANAGER_ROLE_ID = '1502083797993263144';
const COMPTE_CREE_CATEGORY_ID = '1502086337959038996';

const {
    Client,
    GatewayIntentBits,
    PermissionsBitField,
    ChannelType
} = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.once('ready', () => {
    console.log(`Bot connecté : ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {

    if (!interaction.isChatInputCommand()) return;

    // =========================
    // /start
    // =========================

    if (interaction.commandName === 'start') {

        const existingChannel = interaction.guild.channels.cache.find(
            channel => channel.topic === interaction.user.id
        );

        if (existingChannel) {
            return interaction.reply({
                content: `Tu as déjà un salon privé : ${existingChannel}`,
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
👋 Bienvenue chez Lysen Agency.

⚠️ IMPORTANT :
Lis bien toutes les étapes avant de commencer.

━━━━━━━━━━━━━━

📚 ÉTAPE 1 — FORMATIONS

Regarde les formations disponibles ici :

➜ https://discord.com/channels/1485476914218139740/1485480069358161940

━━━━━━━━━━━━━━

📱 ÉTAPE 2 — CRÉATION DU COMPTE INSTAGRAM

Une fois les formations regardées :

• crée ton compte Instagram ;
• prépare correctement le compte ;
• puis envoie le lien du compte directement dans ce salon.

━━━━━━━━━━━━━━

✅ EXEMPLE :

https://instagram.com/nomducompte

━━━━━━━━━━━━━━

🔥 Une fois le lien envoyé,
on te créera automatiquement un nouveau salon privé pour passer à la suite.
        `);

        await interaction.reply({
            content: `Ton salon privé a été créé : ${channel}`,
            ephemeral: true
        });
    }

    // =========================
    // /warmup
    // =========================

    if (interaction.commandName === 'warmup') {

        await interaction.reply({
            content: `
🔥 **WARM-UP INSTAGRAM**

━━━━━━━━━━━━━━

⏱️ **Le warm-up doit durer environ 10 à 20 minutes.**

📱 Pendant le warm-up :
• scroll ;
• like ;
• regarde des stories ;
• commente naturellement ;
• interagis normalement avec l’application.

⚠️ **Fais tout comme dans la vidéo.**

📚 **Vidéo warm-up :**
➜ https://discord.com/channels/1485476914218139740/1486893390262960320

⚠️ **Évite :**
• le spam ;
• les actions trop rapides ;
• le copier-coller.

✅ **Reste actif régulièrement sur le compte.**

━━━━━━━━━━━━━━
            `,
            ephemeral: true
        });
    }

    // =========================
    // /reels
    // =========================

    if (interaction.commandName === 'reels') {

        await interaction.reply({
            content: `
🎬 **REELS INSTAGRAM**

━━━━━━━━━━━━━━

🔥 **Fais ton warm-up avant de poster.**

📝 **Utilise les captions / tendances disponibles ici :**
➜ https://discord.com/channels/1485476914218139740/1485480614512693308

📈 **Poste régulièrement et reste constant en respectant le :**
➜ https://discord.com/channels/1485476914218139740/1485480754564694046

⚠️ **Respecte bien la formation sur les métadonnées :**
➜ https://discord.com/channels/1485476914218139740/1485480522023964772

━━━━━━━━━━━━━━
            `,
            ephemeral: true
        });
    }
    // =========================
    // /threads
    // =========================

    if (interaction.commandName === 'threads') {

        await interaction.reply({
            content: `
🧵 **THREADS INSTAGRAM**

━━━━━━━━━━━━━━

🔥 Créer un compte Threads peut énormément aider ton compte à faire plus de vues et ramener plus de trafic.

📈 Poste régulièrement et reste actif.

⚠️ Respecte vraiment bien le warm-up Threads :
➜ https://discord.com/channels/1485476914218139740/1496282368888275084

📚 Formation Threads :
➜ ‼️ FORMATION THREAD ‼️

━━━━━━━━━━━━━━
            `,
            ephemeral: true
        });
    }    // =========================
    // /views
    // =========================

    if (interaction.commandName === 'views') {

        await interaction.reply({
            content: `
📈 **VUES INSTAGRAM**

━━━━━━━━━━━━━━

⚠️ Si au bout de 4 jours ( environ 8 reels postés ),
aucun reel n’a dépassé les 400 vues :

➜ supprime le compte ;
➜ puis recrée-en un nouveau.

🔥 Respecter correctement :
• le warm-up ;
• les métadonnées ;
• les captions ;
• les tendances ;

peut énormément aider les performances.

📱 Il est vraiment très conseillé de créer un deuxième compte pour augmenter tes chances de faire des vues.

📈 Plus de comptes = plus de reels postés = plus de chances de faire des vues !

━━━━━━━━━━━━━━
            `,
            ephemeral: true
        });
    }    // =========================
    // /shadowban
    // =========================

    if (interaction.commandName === 'shadowban') {

        await interaction.reply({
            content: `
🚫 **SHADOWBAN INSTAGRAM**

━━━━━━━━━━━━━━

⚠️ Pour éviter les limitations / shadowban :

• respecte bien les conditions de création de compte ;
• mets-toi bien en 4G / 5G ;
• change correctement la région du téléphone ;
• respecte vraiment bien le warm-up.

🔥 Tout ça est très important.

⚠️ Pour éviter de te faire ban,
il est très intéressant de regarder le salon :
➜ https://discord.com/channels/1485476914218139740/1486856143279095868

📈 Un compte avec peu de vues n’est pas forcément shadowban.

━━━━━━━━━━━━━━
            `,
            ephemeral: true
        });
    }    // =========================
    // /pay
    // =========================

    if (interaction.commandName === 'pay') {

        await interaction.reply({
            content: `
💸 **PAIEMENTS**

━━━━━━━━━━━━━━

🔥 Exemple :
1000 clicks / jour = 100$ toutes les 2 semaines.

📈 Les clicks correspondent au nombre de personnes qui cliquent sur le lien qui te sera donné à mettre sur ton compte.

⚠️ En général,
le lien est donné quand un reel commence à bien performer ( environ 5k à 7k vues ou plus ).

📊 Plus tes reels font de vues,
plus tu as de chances d’avoir beaucoup de clicks.

🔥 Avec une bonne régularité et de la constance,
ces objectifs sont totalement atteignables.

📚 Salon Salaires et Bonus :
➜ https://discord.com/channels/1485476914218139740/1485482333829070999

━━━━━━━━━━━━━━
            `,
            ephemeral: true
        });
    }
    // =========================
    // /help
    // =========================

    if (interaction.commandName === 'help') {

        await interaction.reply({
            content: `
📚 **COMMANDES DISPONIBLES**

━━━━━━━━━━━━━━

➜ /start
➜ /warmup
➜ /reels
➜ /pay
➜ /threads
➜ /views
➜ /shadowban

━━━━━━━━━━━━━━
            `,
            ephemeral: true
        });
    }
});

client.on('messageCreate', async message => {

    if (message.author.bot) return;

    if (
        message.content.includes('instagram.com') &&
        message.channel.topic === message.author.id
    ) {

        const member = message.member;

        const instagramLink = message.content;

        await member.roles.remove(VA_ROLE_ID);

        await member.roles.add(COMPTE_CREE_ROLE_ID);

        const newChannel = await message.guild.channels.create({
            name: `compte-${message.author.username}`,
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

        const pinnedMessage = await newChannel.send(`
📸 Compte Instagram :
${instagramLink}

👋 Ton compte a bien été validé, bien joué ✅

Tu as terminé la première étape, maintenant le plus important :
poste régulièrement tes reels et continue de warm-up ton compte environ 10 minutes par jour 🔥

📚 Pour t’aider :
➜ <#1485480560741847212>
➜ <#1485480522023964772>

🚀 Petit conseil :
Créer un compte Threads peut énormément aider ton compte à faire plus de vues et ramener plus de trafic.

Tu peux regarder la formation Threads ici :
➜ ‼️ FORMATION THREAD ‼️

Une fois ton compte Threads créé,
envoie le lien directement dans ce salon ! ✅
        `);

        await pinnedMessage.pin();

        await message.channel.delete();
    }
});

client.login(process.env.DISCORD_TOKEN);