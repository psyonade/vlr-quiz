const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const EVENT_GROUPS = [
    { id: '86', name: 'VCT 2026' },
    { id: '74', name: 'VCT 2025' },
    { id: '61', name: 'VCT 2024' }
];

const VLR_REGIONS = [
    { code: 'na', target: 'AMER' },
    { code: 'la', target: 'AMER' },
    { code: 'br', target: 'AMER' },
    { code: 'eu', target: 'EMEA' },
    { code: 'ap', target: 'APAC' },
    { code: 'cn', target: 'CN' }
];

const COUNTRY_NAMES = {
    'us': 'United States', 'ca': 'Canada', 'br': 'Brazil', 'ar': 'Argentina', 'cl': 'Chile', 'mx': 'Mexico', 'pe': 'Peru', 'co': 'Colombia',
    'tr': 'Turkey', 'ru': 'Russia', 'fr': 'France', 'gb': 'United Kingdom', 'de': 'Germany', 'es': 'Spain', 'pl': 'Poland', 'ua': 'Ukraine', 'fi': 'Finland', 'se': 'Sweden', 'no': 'Norway', 'dk': 'Denmark', 'it': 'Italy', 'be': 'Belgium', 'nl': 'Netherlands', 'cz': 'Czech Republic', 'at': 'Austria', 'hu': 'Hungary', 'pt': 'Portugal', 'ie': 'Ireland', 'il': 'Israel', 'jo': 'Jordan', 'lb': 'Lebanon', 'eg': 'Egypt', 'ma': 'Morocco', 'za': 'South Africa', 'lt': 'Lithuania', 'hr': 'Croatia', 'kz': 'Kazakhstan',
    'kr': 'South Korea', 'jp': 'Japan', 'th': 'Thailand', 'id': 'Indonesia', 'ph': 'Philippines', 'sg': 'Singapore', 'my': 'Malaysia', 'vn': 'Vietnam', 'tw': 'Taiwan', 'in': 'India', 'au': 'Australia', 'nz': 'New Zealand', 'pk': 'Pakistan',
    'cn': 'China'
};

const API_BASE_URL = 'https://vlrggapi.vercel.app/v2';

async function scrapePlayerList() {
    console.log('Fetching player list from vlr.gg Tier 1 events...');
    const playerStats = {}; // id -> { id, ign, rounds, region }

    for (const group of EVENT_GROUPS) {
        for (const vlrReg of VLR_REGIONS) {
            const url = `https://www.vlr.gg/stats/?event_group_id=${group.id}&region=${vlrReg.code}&min_rounds=0&min_rating=0&agent=all&map_id=all&timespan=all`;
            console.log(`Scraping ${group.name} - ${vlrReg.code.toUpperCase()}...`);

            try {
                const response = await axios.get(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Cookie': 'abok=1'
                    }
                });
                const $ = cheerio.load(response.data);

                $('.wf-table tr').each((i, el) => {
                    if (i === 0) return;
                    const tds = $(el).find('td');
                    const nameLink = tds.first().find('a');
                    const href = nameLink.attr('href');
                    if (!href) return;

                    const id = href.split('/')[2];
                    const ign = nameLink.find('.text-of').text().trim();
                    const rounds = parseInt($(tds[2]).text().trim()) || 0;

                    if (!playerStats[id]) {
                        playerStats[id] = { id, ign, totalRounds: 0, region: vlrReg.target };
                    }
                    playerStats[id].totalRounds += rounds;
                });
            } catch (e) {
                console.error(`Error scraping ${group.name} ${vlrReg.code}: ${e.message}`);
            }
        }
    }

    // Filter by min 200 rounds (~10 games)
    const filtered = Object.values(playerStats).filter(p => p.totalRounds >= 200);
    console.log(`Found ${filtered.length} players with at least 200 rounds in Tier 1.`);
    return filtered;
}

async function getPlayerData(id, region) {
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
            let teamName = p.current_team?.name || 'Free Agent';

            // Clean up team name from VLR API debris (removes date ranges, "joined in", "inactive")
            const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
            const monthRegex = new RegExp(`(${months.join('|')}).*`, 'g');

            teamName = teamName
                .replace(/\s*(joined|left) in.*/gi, '')
                .replace(/\s*inactive/gi, '')
                .replace(monthRegex, '')
                .replace(/\d{4}\s*–.*/g, '')
                .trim();

            let finalRegion = region;
            // Manual overrides for specific player edge cases
            if (p.name?.toLowerCase() === 'infiltrator') finalRegion = 'AMER';

            return {
                ign: p.name,
                name: p.real_name || p.name,
                country: COUNTRY_NAMES[countryCode] || p.country || 'Unknown',
                region: finalRegion,
                tier: 'Tier 1',
                team: teamName || 'Free Agent',
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
    const limit = limitArg ? parseInt(limitArg.split('=')[1]) : (envLimit ? parseInt(envLimit) : 150);

    try {
        const allPlayers = await scrapePlayerList();
        if (allPlayers.length === 0) return;

        const shuffled = allPlayers.sort(() => 0.5 - Math.random());
        const selected = shuffled.slice(0, limit);

        console.log(`Fetching detailed data for ${selected.length} players...`);
        const results = [];

        for (let i = 0; i < selected.length; i++) {
            if (i % 10 === 0) console.log(`Progress: ${i}/${selected.length}`);
            const data = await getPlayerData(selected[i].id, selected[i].region);
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
