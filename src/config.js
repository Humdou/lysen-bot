const CONFIG = {
    app: {
        clientId: process.env.DISCORD_CLIENT_ID || '1501621868258525275',
        guildId: process.env.DISCORD_GUILD_ID || '1485476914218139740'
    },
    guild: {
        vaActiveCategoryId: '1502055567760425122',
        vaOpCategoryId: '1502120982591045805',
        dashboardChannelName: '📊・dashboard',
        dashboardUpdateIntervalMs: 30 * 60 * 1000
    },
    categories: {
        vaActive: 'VA ACTIF 😎',
        vaOp: 'VA OP 🫡'
    },
    roles: {
        vaActive: '1502068514264055909',
        vaOp: '1502084425092169749',
        manager: '1502083797993263144'
    },
    resources: {
        formationUrl: 'https://discord.com/channels/1485476914218139740/1485480069358161940',
        warmupVideoUrl: 'https://discord.com/channels/1485476914218139740/1486893390262960320',
        usefulChannels: ['<#1485480560741847212>', '<#1485480522023964772>']
    }
};

module.exports = {
    CONFIG
};
