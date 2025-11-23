const Paho = require("paho-mqtt");
const readline = require("readline");
const { readLog, writeLog } = require('./logHandler');
const GroupManager = require("./GroupManager");
const ever = true;

// Configurações Globais
const BROKER_URL = "ws://localhost:8083/mqtt";
const TOPIC_USERS_ROOT = "USERS";
const TOPIC_GROUPS_ROOT = "GROUPS"; // Raiz para grupos

// --- Interface de Linha de Comando ---
const userInput = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

let currentPrompt = "";
let isWaitingInput = false;

function displayMessage(message) {
    if (isWaitingInput) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        console.log(message);
        process.stdout.write(currentPrompt);
        if (userInput.line) {
            process.stdout.write(userInput.line);
        }
        return;
    }
    console.log(message);
}

function question(prompt) {
    currentPrompt = prompt;
    isWaitingInput = true;
    return new Promise((resolve) => {
        userInput.question(prompt, (answer) => {
            isWaitingInput = false;
            currentPrompt = "";
            resolve(answer);
        });
    });
}

// --- Lógica Principal ---
async function main() {
    console.clear();
    const userId = await question("Digite seu ID de usuário: ");

    // Definições de Tópicos do Usuário
    const MY_USER_TOPIC = `${TOPIC_USERS_ROOT}/${userId}`;
    const ID_Control = `${userId}_Control`;

    // Last Will (Status Offline)
    const lastWill = new Paho.Message(JSON.stringify({ user: userId, status: "offline" }));
    lastWill.destinationName = MY_USER_TOPIC;
    lastWill.qos = 1;
    lastWill.retained = true;

    const client = new Paho.Client(BROKER_URL, String(userId));

    // Estados Locais
    const userStatusMap = new Map();
    const conversationRequestsArray = [];

    // Função de publicação (Hoisted ou definida antes de passar para GroupManager)
    function publish(topic, obj, retain = false) {
        try {
            const msg = new Paho.Message(JSON.stringify(obj));
            msg.destinationName = topic;
            msg.qos = 1;
            msg.retained = retain;
            client.send(msg);
        } catch (e) {
            displayMessage(`[ERRO] Falha ao publicar: ${e.message}`);
        }
    }

    // Instancia o GroupManager
    const groupManager = new GroupManager(
        userId,
        publish,
        question,
        displayMessage
    );

    client.onConnectionLost = (responseObject) => {
        if (responseObject.errorCode !== 0) {
            displayMessage(`[ERRO] Conexão perdida: ${responseObject.errorMessage}`);
        }
    };

    client.onMessageArrived = async (msg) => {
        const topic = msg.destinationName;
        const payload = msg.payloadString;

        try {
            if (!payload) return; // Ignora payload vazio (retained clean)
            const data = JSON.parse(payload);

            // 1. Atualização de Usuários (USERS/+)
            if (topic.startsWith(TOPIC_USERS_ROOT)) {
                if (data.user && data.status) {
                    userStatusMap.set(data.user, data.status);
                }
            }

            // 2. Atualização de Grupos (GROUPS/+) - NOVA LÓGICA
            if (topic.startsWith(TOPIC_GROUPS_ROOT)) {
                // Passa o objeto do grupo recebido para o gerenciador atualizar a lista local
                groupManager.updateGroupLocalState(data);
            }

            // 3. Canal de Controle (ID_Control)
            if (topic === ID_Control) {
                if (data.messageMode === 'private') {
                    writeLog(`SOLICITACAO RECEBIDA: De ${data.sender}`);
                    const existingRequest = conversationRequestsArray.find(req => req.sender === data.sender);

                    if (!existingRequest) {
                        conversationRequestsArray.push({
                            sender: data.sender,
                            timestamp: Date.now()
                        });
                        displayMessage(`\n[SOLICITAÇÃO] Nova conversa de: ${data.sender}. (Menu 3 para ver)`);
                    }
                }
                else if (data.messageMode === 'chatConfirmation') {
                    writeLog(`CHAT INICIADO: Sala ${data.chatId}`);
                    displayMessage(`\n[INFO] Conversa aceita por ${data.sender}. Sala: ${data.chatId}`);
                    client.subscribe(data.chatId);
                }
            }

        } catch (e) {
            // writeLog(`[ERRO JSON] Tópico: ${topic} | ${e.message}`);
        }
    };

    client.connect({
        willMessage: lastWill,
        cleanSession: false,
        onSuccess: async () => {
            displayMessage(`[INFO] Conectado como: ${userId}`);

            // Assinaturas (Wildcards para Usuários e Grupos)
            client.subscribe(`${TOPIC_USERS_ROOT}/+`);
            client.subscribe(`${TOPIC_GROUPS_ROOT}/+`); // <-- AQUI: Ouve GROUPS/A, GROUPS/B, etc.
            client.subscribe(ID_Control);

            // Publica presença
            publish(MY_USER_TOPIC, { user: userId, status: "online" }, true);

            // Handler de Saída
            process.on("SIGINT", () => {
                displayMessage(`\n[INFO] Encerrando...`);
                const msg = new Paho.Message(JSON.stringify({ user: userId, status: "offline" }));
                msg.destinationName = MY_USER_TOPIC;
                msg.qos = 1;
                msg.retained = true;
                client.send(msg);

                setTimeout(() => {
                    client.disconnect();
                    process.exit(0);
                }, 500);
            });

            await menuLoop();
        },
        onFailure: (err) => {
            console.error("[CRÍTICO] Falha na conexão:", err.errorMessage);
            process.exit(1);
        }
    });

    // --- Funções Auxiliares do Menu ---

    async function manageRequests() {
        if (conversationRequestsArray.length === 0) {
            displayMessage("\n[INFO] Sem solicitações pendentes.");
            return;
        }

        console.log("\n--- Solicitações Pendentes ---");
        conversationRequestsArray.forEach((req, idx) => {
            console.log(`${idx + 1} - De: ${req.sender} (${new Date(req.timestamp).toLocaleTimeString()})`);
        });
        console.log("-----------------------------");

        const selection = await question("Número para aceitar (ou 'V' para voltar): ");
        if (selection.toUpperCase() === 'V') return;

        const index = parseInt(selection) - 1;
        if (index >= 0 && index < conversationRequestsArray.length) {
            const req = conversationRequestsArray[index];
            const chatId = `${req.sender}_${userId}_${req.timestamp}`;

            publish(`${req.sender}_Control`, {
                sender: userId,
                messageMode: 'chatConfirmation',
                chatId: chatId
            });

            client.subscribe(chatId);
            displayMessage(`\n[SUCESSO] Aceito! Sala: ${chatId}`);
            conversationRequestsArray.splice(index, 1);
        } else {
            displayMessage("Opção inválida.");
        }
    }

    async function groupSubMenu() {
        console.log("\n--- Menu de Grupos ---");
        console.log("1 - Criar Novo Grupo");
        console.log("2 - Listar Grupos Disponíveis");
        console.log("V - Voltar");

        const option = await question("Opção: ");

        if (option === '1') {
            await groupManager.createGroup();
        } else if (option === '2') {
            groupManager.listGroups();
        } else if (option.toUpperCase() !== 'V') {
            displayMessage("Opção inválida.");
        }
    }

    async function menuLoop() {
        for(;ever;) {
            console.log("\n=== KIDCONNECT MQTT ===");
            console.log("1 - Solicitar Bate-papo (Privado)");
            console.log("2 - Ver Usuários Online");
            console.log("3 - Gerenciar Solicitações");
            console.log("4 - Menu de Grupos");
            console.log("5 - Log de Depuração");
            console.log("0 - Sair");
            console.log("=======================");

            const option = await question("Opção: ");

            switch (option) {
                case "1":
                    const target = await question("ID do usuário alvo: ");
                    if (target === userId) {
                        displayMessage("Erro: Auto-conversa não permitida.");
                    } else {
                        publish(`${target}_Control`, { sender: userId, messageMode: "private" });
                        displayMessage(`Solicitação enviada para ${target}.`);
                    }
                    break;
                case "2":
                    console.log("\n--- Usuários ---");
                    if (userStatusMap.size === 0) console.log("(vazio)");
                    for (const [u, s] of userStatusMap.entries()) {
                        console.log(`> [${s.toUpperCase()}] ${u} ${(u===userId)?'(Você)':''}`);
                    }
                    console.log("----------------");
                    break;
                case "3":
                    await manageRequests();
                    break;
                case "4":
                    await groupSubMenu();
                    break;
                case "5":
                    await displayLog();
                    break;
                case "0":
                    process.emit("SIGINT");
                    break;
                default:
                    displayMessage("Comando desconhecido.");
            }
        }
    }
}

main().catch(console.error);