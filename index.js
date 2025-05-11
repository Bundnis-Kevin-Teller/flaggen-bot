require('dotenv').config();
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events, EmbedBuilder } = require('discord.js');
const levenshtein = require('fast-levenshtein');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const fs = require('fs'); 

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const PREFIX = '!';
let currentAnswer = null;
let currentPlayer = null;
let acceptedAnswers = [];
let currentFlagURL = null;
let gameTimer = null;
let startTime = null;  
let points = 0;  
const leaderboardFile = './leaderboard.json';  


if (!fs.existsSync(leaderboardFile)) {
    fs.writeFileSync(leaderboardFile, JSON.stringify({}));
}

client.once('ready', () => {
    console.log(`✅ Bot gestartet als ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content === `${PREFIX}flagge`) {
        return startGame(message);
    }

    if (message.content === `${PREFIX}leaderboard`) {
        return showLeaderboard(message);
    }

    if (currentAnswer && message.author.id === currentPlayer?.id) {
        const userAnswer = normalizeInput(message.content);

        const isCorrect = acceptedAnswers.some(answer => {
            return levenshtein.get(userAnswer, normalizeInput(answer)) <= 3;
        });

        

        let timeTaken = Date.now() - startTime;  
        let speedBonus = Math.max(0, Math.floor(10000 - timeTaken) / 1000);  

        if (isCorrect) {
           
            points += Math.max(1, Math.floor(10 + speedBonus));  
        } else {
            
            points = 0; 
        }

        
        updateLeaderboard(currentPlayer.id, points);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('play_again')
                .setLabel('🔁 Neue Flagge')
                .setStyle(ButtonStyle.Primary)
        );

        const resultEmbed = new EmbedBuilder()
            .setColor(isCorrect ? 0x00ff00 : 0xff0000)
            .setTitle(isCorrect ? '🎉 Richtige Antwort!' : '❌ Falsche Antwort!')
            .setDescription(isCorrect
                ? `Du hast **${capitalize(currentAnswer)}** korrekt erraten!`
                : `Die richtige Antwort war **${capitalize(currentAnswer)}**.`)
            .setThumbnail(currentFlagURL)
            .addFields({ name: 'Punkte', value: `${points} 🏆`, inline: true })  
            .setFooter({ text: 'Flaggenquiz | Brought to you by EministarVR', iconURL: client.user.displayAvatarURL() });

        await message.reply({ embeds: [resultEmbed], components: [row] });

        console.log(`[LOG] ${message.author.tag} hat geantwortet: "${message.content}" → ${isCorrect ? '✔ korrekt' : '❌ falsch'}`);

        resetGame();
    }
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isButton()) return;
    if (interaction.customId === 'play_again') {
        return startGame(interaction);
    }
});

async function startGame(source) {
    const country = await fetchCountry();
    if (!country) {
        const errorEmbed = new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle('⚠️ Fehler')
            .setDescription('Die Flagge konnte nicht geladen werden. Versuch es später nochmal.');

        if (source.reply) return source.reply({ embeds: [errorEmbed] });
        else return source.channel.send({ embeds: [errorEmbed] });
    }

    currentAnswer = country.name.common;
    currentPlayer = source.user ?? source.author;
    currentFlagURL = country.flags?.png || '';

    acceptedAnswers = [
        country.name.common,
        country.name.official,
        country.translations?.de?.common || '',
        country.translations?.de?.official || ''
    ].filter(Boolean);

    const flagEmbed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle('🌍 Flaggenquiz')
        .setDescription(`Welche Flagge ist das? Schreib deine Vermutung in den Chat!`)
        .setImage(currentFlagURL)
        .setFooter({ text: `Spieler: ${currentPlayer.username}`, iconURL: currentPlayer.displayAvatarURL() });

    console.log(`[INFO] Neue Flagge gestartet für ${currentPlayer.tag} → Antwort ist: ${currentAnswer}`);

    if (source.reply) return source.reply({ embeds: [flagEmbed] });
    else return source.channel.send({ embeds: [flagEmbed] });

    
    startTime = Date.now();  
    startTimer(source);
}

async function fetchCountry() {
    try {
        const res = await fetch('https://restcountries.com/v3.1/all');
        const countries = await res.json();
        const random = countries[Math.floor(Math.random() * countries.length)];
        return random;
    } catch (err) {
        console.error('[FEHLER] Länder konnten nicht geladen werden:', err);
        return null;
    }
}

function startTimer(source) {
    let timeRemaining = 30;  
    gameTimer = setInterval(() => {
        if (timeRemaining <= 0) {
            clearInterval(gameTimer);
            const timeOutEmbed = new EmbedBuilder()
                .setColor(0xff0000)
                .setTitle('⏳ Zeit abgelaufen!')
                .setDescription(`Die Zeit ist leider abgelaufen! Die richtige Antwort war **${currentAnswer}**.`);

            source.reply({ embeds: [timeOutEmbed] });
            resetGame();
        } else {
            timeRemaining--;
        }
    }, 1000);
}

function updateLeaderboard(userId, points) {
    let leaderboard = {};

    
    if (fs.existsSync(leaderboardFile)) {
        try {
            console.log("[INFO] Lade Leaderboard...");
            leaderboard = JSON.parse(fs.readFileSync(leaderboardFile, 'utf8')); 
        } catch (err) {
            console.error("[ERROR] Fehler beim Laden der Leaderboard-Datei:", err);
        }
    } else {
        console.log("[INFO] Leaderboard-Datei existiert nicht, wird jetzt erstellt.");
    }

    
    if (leaderboard[userId]) {
        leaderboard[userId] += points; 
        console.log(`[INFO] Punkte für ${userId} wurden zu ${leaderboard[userId]} addiert.`);
    } else {
        leaderboard[userId] = points; 
        console.log(`[INFO] Neuer Spieler ${userId} hinzugefügt mit ${points} Punkten.`);
    }

    
    try {
        console.log("[INFO] Speichern der Daten...");
        fs.writeFileSync(leaderboardFile, JSON.stringify(leaderboard, null, 2)); 
        console.log(`[LOG] Punkte für ${userId} gespeichert: ${leaderboard[userId]}`);
    } catch (error) {
        console.error("[ERROR] Fehler beim Speichern der Leaderboard-Daten:", error);
    }
}

function showLeaderboard(message) {
    let leaderboard = {};

    
    if (fs.existsSync(leaderboardFile)) {
        try {
            console.log("[INFO] Lade Leaderboard...");
            leaderboard = JSON.parse(fs.readFileSync(leaderboardFile, 'utf8')); 
        } catch (err) {
            console.error("[ERROR] Fehler beim Laden der Leaderboard-Datei:", err);
        }
    } else {
        console.log("[INFO] Keine Leaderboard-Daten gefunden.");
    }

    
    const sortedLeaderboard = Object.entries(leaderboard)
        .sort((a, b) => b[1] - a[1]) 
        .slice(0, 10);  

    const leaderboardEmbed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle('🏆 Flaggenquiz Leaderboard')
        .setDescription('Die besten Spieler im Flaggenquiz!');

    
    sortedLeaderboard.forEach(([userId, userPoints], index) => {
        const user = client.users.cache.get(userId);  
        leaderboardEmbed.addFields({ name: `${index + 1}. ${user?.username || 'Unbekannt'}`, value: `${userPoints} 🏆`, inline: true });
    });

    
    message.reply({ embeds: [leaderboardEmbed] });
}

function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function normalizeInput(str) {
    return str
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ä/g, 'ae')
        .replace(/ö/g, 'oe')
        .replace(/ü/g, 'ue')
        .replace(/ß/g, 'ss')
        .replace(/[^a-z]/g, '');
}

function resetGame() {
    currentAnswer = null;
    currentPlayer = null;
    acceptedAnswers = [];
    currentFlagURL = null;
    points = 0;  
    clearInterval(gameTimer);  
    startTime = null;  
}

client.login(process.env.TOKEN);
