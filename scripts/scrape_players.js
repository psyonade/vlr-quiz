const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const EVENT_GROUPS = [
    { id: '86', tier: 'Tier 1' }, // VCT 2026
    { id: '85', tier: 'Tier 2' }, // Challengers 2026
    { id: '87', tier: 'Tier 2' }, // Game Changers 2026
];
const STATS_URL_BASE = 'https://www.vlr.gg/stats/?region=all&min_rounds=&min_rating=&agent=all&map_id=all&timespan=all&event_group_id=';
const API_BASE_URL = 'https://vlrggapi.vercel.app/v2';

const COUNTRY_TO_REGION = {
    // AMER
    'us': 'AMER', 'ca': 'AMER', 'br': 'AMER', 'ar': 'AMER', 'cl': 'AMER', 'mx': 'AMER', 'pe': 'AMER', 'co': 'AMER',
    // EMEA
    'tr': 'EMEA', 'ru': 'EMEA', 'fr': 'EMEA', 'gb': 'EMEA', 'de': 'EMEA', 'es': 'EMEA', 'pl': 'EMEA', 'ua': 'EMEA', 'fi': 'EMEA', 'se': 'EMEA', 'no': 'EMEA', 'dk': 'EMEA', 'it': 'EMEA', 'be': 'EMEA', 'nl': 'EMEA', 'cz': 'EMEA', 'at': 'EMEA', 'hu': 'EMEA', 'pt': 'EMEA', 'ie': 'EMEA', 'il': 'EMEA', 'jo': 'EMEA', 'lb': 'EMEA', 'eg': 'EMEA', 'ma': 'EMEA', 'za': 'EMEA', 'lt': 'EMEA', 'hr': 'EMEA', 'kz': 'EMEA',
    // APAC
    'kr': 'APAC', 'jp': 'APAC', 'th': 'APAC', 'id': 'APAC', 'ph': 'APAC', 'sg': 'APAC', 'my': 'APAC', 'vn': 'APAC', 'tw': 'APAC', 'in': 'APAC', 'au': 'APAC', 'nz': 'APAC', 'pk': 'APAC',
    // CN
    'cn': 'CN'
};

const COUNTRY_NAMES = {
    'us': 'United States', 'ca': 'Canada', 'br': 'Brazil', 'ar': 'Argentina', 'cl': 'Chile', 'mx': 'Mexico', 'pe': 'Peru', 'co': 'Colombia',
    'tr': 'Turkey', 'ru': 'Russia', 'fr': 'France', 'gb': 'United Kingdom', 'de': 'Germany', 'es': 'Spain', 'pl': 'Poland', 'ua': 'Ukraine', 'fi': 'Finland', 'se': 'Sweden', 'no': 'Norway', 'dk': 'Denmark', 'it': 'Italy', 'be': 'Belgium', 'nl': 'Netherlands', 'cz': 'Czech Republic', 'at': 'Austria', 'hu': 'Hungary', 'pt': 'Portugal', 'ie': 'Ireland', 'il': 'Israel', 'jo': 'Jordan', 'lb': 'Lebanon', 'eg': 'Egypt', 'ma': 'Morocco', 'za': 'South Africa', 'lt': 'Lithuania', 'hr': 'Croatia', 'kz': 'Kazakhstan',
    'kr': 'South Korea', 'jp': 'Japan', 'th': 'Thailand', 'id': 'Indonesia', 'ph': 'Philippines', 'sg': 'Singapore', 'my': 'Malaysia', 'vn': 'Vietnam', 'tw': 'Taiwan', 'in': 'India', 'au': 'Australia', 'nz': 'New Zealand', 'pk': 'Pakistan',
    'cn': 'China'
};

async function scrapePlayerList() {
    console.log('Fetching player list from vlr.gg...');
    const players = [];
    const seenIds = new Set();

    for (const group of EVENT_GROUPS) {
        console.log(`Scraping event group ${group.id} (${group.tier})...`);
        try {
            const response = await axios.get(STATS_URL_BASE + group.id, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Cookie': 'abok=1'
                }
            });
            const $ = cheerio.load(response.data);

            $('.wf-table tr').each((i, el) => {
                if (i === 0) return; // skip header
                const nameLink = $(el).find('td').first().find('a');
                const href = nameLink.attr('href');
                if (!href) return;

                const id = href.split('/')[2];
                if (seenIds.has(id)) return;

                const ign = nameLink.find('.text-inner').text().trim();
                seenIds.add(id);
                players.push({ id, ign, tier: group.tier });
            });
        } catch (e) {
            console.error(`Error scraping group ${group.id}: ${e.message}`);
        }
    }

    console.log(`Found ${players.length} unique players across all groups.`);
    return players;
}

async function getPlayerData(id, tier = 'Tier 1') {
    try {
        const response = await axios.get(`${API_BASE_URL}/player?id=${id}&timespan=all`);
        if (response.data.status === 'success' && response.data.data.segments.length > 0) {
            const p = response.data.data.segments[0];

            // Calculate overall stats
            let totalRounds = 0;
            let weightedRating = 0;
            let weightedAcs = 0;
            let weightedKd = 0;
            let weightedAdr = 0;

            const agents = p.agent_stats.map(as => {
                const rounds = parseInt(as.rounds) || 0;
                totalRounds += rounds;
                weightedRating += (parseFloat(as.rating) || 0) * rounds;
                weightedAcs += (parseFloat(as.acs) || 0) * rounds;
                weightedKd += (parseFloat(as.kd) || 0) * rounds;
                weightedAdr += (parseFloat(as.adr) || 0) * rounds;

                return {
                    name: as.agent.charAt(0).toUpperCase() + as.agent.slice(1),
                    matches: parseInt(as.usage_count) || 0,
                    rounds: rounds,
                    pct: as.usage_pct,
                    rating: parseFloat(as.rating) || 0,
                    acs: Math.round(parseFloat(as.acs)) || 0,
                    kd: parseFloat(as.kd) || 0,
                    adr: Math.round(parseFloat(as.adr)) || 0
                };
            }).sort((a, b) => b.rounds - a.rounds).slice(0, 5);

            const overall = {
                rating: totalRounds ? parseFloat((weightedRating / totalRounds).toFixed(2)) : 0,
                acs: totalRounds ? Math.round(weightedAcs / totalRounds) : 0,
                kd: totalRounds ? parseFloat((weightedKd / totalRounds).toFixed(2)) : 0,
                adr: totalRounds ? Math.round(weightedAdr / totalRounds) : 0
            };

            const countryCode = p.country?.toLowerCase();

            return {
                ign: p.name,
                name: p.real_name || p.name,
                country: COUNTRY_NAMES[countryCode] || p.country || 'Unknown',
                region: COUNTRY_TO_REGION[countryCode] || 'Unknown',
                tier: tier,
                team: p.current_team?.name || 'Free Agent',
                agents,
                overall
            };
        }
    } catch (e) {
        console.error(`Error fetching data for player ${id}: ${e.message}`);
    }
    return null;
}

async function main() {
    const limitArg = process.argv.find(arg => arg.startsWith('--limit='));
    const envLimit = process.env.SCRAPE_LIMIT;
    const limit = limitArg ? parseInt(limitArg.split('=')[1]) : (envLimit ? parseInt(envLimit) : 250);

    try {
        const allPlayers = await scrapePlayerList();
        if (allPlayers.length === 0) return;

        const shuffled = allPlayers.sort(() => 0.5 - Math.random());
        const selected = shuffled.slice(0, limit);

        console.log(`Fetching detailed data for ${selected.length} players...`);
        const results = [];

        for (let i = 0; i < selected.length; i++) {
            if (i % 10 === 0) console.log(`Progress: ${i}/${selected.length}`);
            const data = await getPlayerData(selected[i].id, selected[i].tier);
            if (data && data.agents.length > 0) {
                results.push(data);
            }
            await new Promise(r => setTimeout(r, 100));
        }

        console.log(`\nSuccessfully fetched data for ${results.length} players.`);

        const output = {
            updatedAt: new Date().toISOString(),
            players: results
        };

        const dataDir = path.join(__dirname, '../data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, {recursive: true});
        }
        fs.writeFileSync(
            path.join(dataDir, 'players.json'),
            JSON.stringify(output, null, 2)
        );
        console.log('Data saved to data/players.json');

    } catch (e) {
        console.error(`Main error: ${e.message}`);
    }
}

main();
