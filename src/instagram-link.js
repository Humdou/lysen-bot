const INSTAGRAM_RESERVED_PATHS = new Set([
    'about',
    'accounts',
    'direct',
    'explore',
    'p',
    'privacy',
    'reel',
    'reels'
]);

function parseInstagramUrl(rawValue) {
    const candidate = rawValue.startsWith('http://') || rawValue.startsWith('https://')
        ? rawValue
        : `https://${rawValue}`;

    try {
        const url = new URL(candidate);
        const hostname = url.hostname.replace(/^www\./, '').toLowerCase();

        if (hostname !== 'instagram.com') return null;

        const pathParts = url.pathname
            .split('/')
            .map(part => part.trim())
            .filter(Boolean);

        if (!pathParts.length) return null;

        const firstPart = pathParts[0].toLowerCase();
        const username = firstPart === 'stories' ? pathParts[1] : pathParts[0];

        if (!username || INSTAGRAM_RESERVED_PATHS.has(firstPart)) return null;

        const cleanUsername = username
            .replace(/^@/, '')
            .replace(/[^a-zA-Z0-9._]/g, '')
            .toLowerCase();

        if (!cleanUsername || cleanUsername.length > 30) return null;

        return {
            username: cleanUsername,
            url: `https://www.instagram.com/${cleanUsername}/`
        };
    } catch {
        return null;
    }
}

function extractInstagramProfile(content = '') {
    const urlMatches = content.match(/(?:https?:\/\/)?(?:www\.)?instagram\.com\/[^\s<>()]+/gi) || [];

    for (const match of urlMatches) {
        const profile = parseInstagramUrl(match);
        if (profile) return profile;
    }

    return null;
}

module.exports = {
    extractInstagramProfile,
    parseInstagramUrl
};
