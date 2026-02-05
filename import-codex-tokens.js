/**
 * Script per importare i token Codex esistenti in 9router
 * 
 * Questo script legge i token salvati da Codex CLI in ~/.codex/auth.json
 * e li importa direttamente nel database di 9router, evitando così
 * di dover rifare il login OAuth.
 * 
 * Utilizzo: node import-codex-tokens.js
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

// Usa crypto.randomUUID() nativo (Node 14.17.0+)
const uuidv4 = () => crypto.randomUUID();

// Percorsi
const HOME_DIR = os.homedir();
const CODEX_AUTH_PATH = path.join(HOME_DIR, '.codex', 'auth.json');
const NINEROUTER_DATA_DIR = process.platform === 'win32'
    ? path.join(process.env.APPDATA || path.join(HOME_DIR, 'AppData', 'Roaming'), '9router')
    : path.join(HOME_DIR, '.9router');
const NINEROUTER_DB_PATH = path.join(NINEROUTER_DATA_DIR, 'db.json');

// Struttura database di default
const defaultDbData = {
    providerConnections: [],
    providerNodes: [],
    modelAliases: {},
    combos: [],
    apiKeys: [],
    settings: {
        cloudEnabled: false,
        stickyRoundRobinLimit: 3,
        requireLogin: true
    },
    pricing: {}
};

async function main() {
    console.log('🔄 Importazione token Codex in 9router...\n');

    // 1. Verifica che esista il file auth.json di Codex
    if (!fs.existsSync(CODEX_AUTH_PATH)) {
        console.error('❌ File auth.json di Codex non trovato!');
        console.error(`   Percorso atteso: ${CODEX_AUTH_PATH}`);
        console.error('   Assicurati di aver effettuato il login con Codex CLI prima.');
        process.exit(1);
    }

    // 2. Leggi i token Codex
    console.log(`📖 Lettura token da: ${CODEX_AUTH_PATH}`);
    const codexAuth = JSON.parse(fs.readFileSync(CODEX_AUTH_PATH, 'utf-8'));

    if (!codexAuth.tokens || !codexAuth.tokens.access_token) {
        console.error('❌ Token non validi nel file auth.json!');
        console.error('   Effettua nuovamente il login con Codex CLI.');
        process.exit(1);
    }

    const { tokens, last_refresh } = codexAuth;
    console.log('✅ Token Codex trovati!\n');

    // 3. Estrai informazioni dall'id_token (JWT)
    let email = 'codex-user';
    let accountId = tokens.account_id || '';

    if (tokens.id_token) {
        try {
            // Decodifica il payload del JWT (seconda parte, base64)
            const payload = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64').toString());
            email = payload.email || email;
            console.log(`📧 Email rilevata: ${email}`);
            console.log(`💼 Account ID: ${accountId}`);
            console.log(`📅 Piano: ${payload['https://api.openai.com/auth']?.chatgpt_plan_type || 'unknown'}`);
        } catch (e) {
            console.log('⚠️  Impossibile decodificare id_token, uso valori di default');
        }
    }

    // 4. Crea/aggiorna il database di 9router
    console.log(`\n📁 Percorso database 9router: ${NINEROUTER_DB_PATH}`);

    // Assicurati che la directory esista
    if (!fs.existsSync(NINEROUTER_DATA_DIR)) {
        fs.mkdirSync(NINEROUTER_DATA_DIR, { recursive: true });
        console.log('📂 Directory 9router creata');
    }

    // Leggi o crea il database
    let db = defaultDbData;
    if (fs.existsSync(NINEROUTER_DB_PATH)) {
        try {
            db = JSON.parse(fs.readFileSync(NINEROUTER_DB_PATH, 'utf-8'));
            console.log('📖 Database esistente caricato');
        } catch (e) {
            console.log('⚠️  Database corrotto, verrà ricreato');
            db = defaultDbData;
        }
    } else {
        console.log('📝 Nuovo database verrà creato');
    }

    // Assicurati che providerConnections esista
    if (!db.providerConnections) {
        db.providerConnections = [];
    }

    // 5. Cerca se esiste già una connessione Codex con la stessa email
    const existingIndex = db.providerConnections.findIndex(
        c => c.provider === 'codex' && c.authType === 'oauth' && c.email === email
    );

    const now = new Date().toISOString();

    // Calcola la scadenza del token (expires_in non è disponibile, usiamo 10 giorni tipico)
    const expiresAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();

    const connectionData = {
        provider: 'codex',
        authType: 'oauth',
        name: email,
        email: email,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        idToken: tokens.id_token,
        expiresAt: expiresAt,
        isActive: true,
        testStatus: 'active',
        priority: 1,
        updatedAt: now,
    };

    if (existingIndex !== -1) {
        // Aggiorna connessione esistente
        db.providerConnections[existingIndex] = {
            ...db.providerConnections[existingIndex],
            ...connectionData,
        };
        console.log('\n🔄 Connessione Codex esistente aggiornata!');
    } else {
        // Crea nuova connessione
        const newConnection = {
            id: uuidv4(),
            ...connectionData,
            createdAt: now,
        };
        db.providerConnections.push(newConnection);
        console.log('\n✨ Nuova connessione Codex creata!');
    }

    // 6. Salva il database
    fs.writeFileSync(NINEROUTER_DB_PATH, JSON.stringify(db, null, 2));
    console.log('💾 Database 9router salvato!\n');

    // 7. Mostra riepilogo
    console.log('═══════════════════════════════════════════════════════');
    console.log('✅ IMPORTAZIONE COMPLETATA!');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`\n📊 Riepilogo connessioni provider (${db.providerConnections.length} totali):`);

    const providers = {};
    for (const conn of db.providerConnections) {
        if (!providers[conn.provider]) providers[conn.provider] = 0;
        providers[conn.provider]++;
    }
    for (const [provider, count] of Object.entries(providers)) {
        console.log(`   • ${provider}: ${count} connessione(i)`);
    }

    console.log('\n🚀 Prossimi passi:');
    console.log('   1. Avvia 9router: npm run dev (o npm start)');
    console.log('   2. Apri http://localhost:20128');
    console.log('   3. Vai in "Providers" e vedrai la connessione Codex importata!');
    console.log('   4. Usa il modello: cx/gpt-5.2-codex\n');
}

main().catch(err => {
    console.error('❌ Errore:', err.message);
    process.exit(1);
});
