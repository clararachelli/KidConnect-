const fs = require('fs');

const LOG_FILE = "debug.log";

function writeLog(message) {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${message}\n`;

    try {
        fs.appendFileSync(LOG_FILE, logLine, 'utf8');
    } catch (error) {
        console.error(`[ERRO LOG] Falha ao escrever no arquivo ${LOG_FILE}:`, error.message);
    }
}

function readLog() {
    try {
        return fs.readFileSync(LOG_FILE, 'utf8');
    } catch (error) {
        if (error.code === 'ENOENT') {
            return `[INFO] O arquivo de log ('${LOG_FILE}') ainda não existe.`;
        } else {
            return `[ERRO] Falha ao ler o arquivo de log: ${error.message}`;
        }
    }
}

module.exports = {
    writeLog,
    readLog
};