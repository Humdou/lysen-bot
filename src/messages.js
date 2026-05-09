const { CONFIG } = require('./config');

function getOnboardingMessage() {
    return `
👋 **Bienvenue chez Lysen Agency**

━━━━━━━━━━━━━━

⚠️ IMPORTANT :
Lis bien toutes les étapes avant de commencer.

📚 **ÉTAPE 1 — FORMATIONS**

➜ ${CONFIG.resources.formationUrl}

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
le bot déplacera automatiquement ton salon dans la suite du workflow.
    `;
}

function getVaOpMessage(instagramProfile) {
    return `
📸 **Compte Instagram reçu :**

${instagramProfile.url}

━━━━━━━━━━━━━━

✅ Ton salon est maintenant passé en **VA OP 🫡**.

🔥 Continue maintenant :
• ton warm-up ;
• tes reels ;
• ta régularité.

📚 Ressources utiles :
➜ ${CONFIG.resources.usefulChannels[0]}
➜ ${CONFIG.resources.usefulChannels[1]}

🚀 Petit conseil :
Créer un compte Threads peut énormément aider ton compte à faire plus de vues.

━━━━━━━━━━━━━━
    `;
}

module.exports = {
    getOnboardingMessage,
    getVaOpMessage
};
