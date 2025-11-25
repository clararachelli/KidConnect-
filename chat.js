const Paho = require("paho-mqtt");
const readline = require("readline");
const GroupManager = require("./GroupManager");
const { readLog, writeLog } = require('./logHandler'); // Assumindo que você tem esse arquivo

// --- Configurações ---
const BROKER_URL = "ws://localhost:8083/mqtt";
const TOPIC_USERS_ROOT = "USERS";
const TOPIC_GROUPS_ROOT = "GROUPS";

// --- Interface Global Única ---
// Criamos apenas UMA vez para evitar conflitos de 'interface closed'
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: ''
});

// Variáveis de Estado
let currentPromptStr = "";
let activeChatId = null; // Se diferente de null, estamos no modo chat
let isAsking = false;    // Se true, o programa está esperando uma resposta de 'question'

// --- Função de Exibição Híbrida ---
// Permite imprimir notificações sem apagar o que o usuário está digitando
function displayMessage(message) {
    // 1. Limpa a linha atual e move o cursor para o início
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);

    // 2. Imprime a mensagem do sistema/chat
    console.log(message);

    // 3. Redesenha o prompt e o que o usuário já tinha digitado (buffer)
    // Isso garante a sensação de "tempo real" sem quebrar o input
    process.stdout.write(currentPromptStr);
    if (rl.line) {
        process.stdout.write(rl.line);
    }
}

// Wrapper para fazer perguntas (Promise)
function question(promptText) {
    currentPromptStr = promptText;
    isAsking = true;

    // Pequeno hack: forçamos o displayMessage a não sobrescrever
    // enquanto o readline nativo lida com o input
    return new Promise((resolve) => {
        rl.question(promptText, (answer) => {
            isAsking = false;
            currentPromptStr = "";
            resolve(answer.trim());
        });
    });
}

async function main() {
    console.clear();
    const userId = await question("Digite seu ID de usuário: ");

    // Tópicos
    const MY_USER_TOPIC = `${TOPIC_USERS_ROOT}/${userId}`;
    const ID_Control = `${userId}_Control`;

    // Last Will
    const lastWill = new Paho.Message(JSON.stringify({ user: userId, status: "offline" }));
    lastWill.destinationName = MY_USER_TOPIC;
    lastWill.qos = 1;
    lastWill.retained = true;

    const client = new Paho.Client(BROKER_URL, String(userId));

    // Dados Locais
    const userStatusMap = new Map();
    const conversationRequestsArray = [];
    const chatHistory = new Map();

    // Função Publish
    function publish(topic, obj, retain = false) {
        try {
            const msg = new Paho.Message(JSON.stringify(obj));
            msg.destinationName = topic;
            msg.qos = 1;
            msg.retained = retain;
            client.send(msg);
        } catch (e) {
            console.error(`Erro pub: ${e.message}`);
        }
    }

    // Instancia Gerenciador
    const groupManager = new GroupManager(userId, publish, question, displayMessage);

    // Callbacks MQTT
    client.onConnectionLost = (resp) => {
        if (resp.errorCode !== 0) displayMessage(`[SISTEMA] Conexão perdida: ${resp.errorMessage}`);
    };

    client.onMessageArrived = (msg) => {
        const topic = msg.destinationName;
        const payload = msg.payloadString;
        if (!payload) return;

        try {
            const data = JSON.parse(payload);

            // A. Mensagens de Chat
            if (chatHistory.has(topic)) {
                chatHistory.get(topic).push(data); // Salva histórico

                // Se for msg de OUTRA PESSOA no chat ATUAL, exibe
                if (activeChatId === topic && data.sender !== userId) {
                    displayMessage(`[${data.sender}]: ${data.text}`);
                }
                // Se for msg de OUTRO chat, avisa
                else if (activeChatId !== topic) {
                    // Opcional: displayMessage(`[NOVA MSG] de ${data.sender} em outra aba.`);
                }
            }

            // B. Controle (Solicitações)
            if (topic === ID_Control) {
                if (data.messageMode === 'private') {
                    // Evita duplicatas simples
                    const exists = conversationRequestsArray.find(r => r.sender === data.sender);
                    if (!exists) {
                        conversationRequestsArray.push({ sender: data.sender, timestamp: Date.now() });
                        displayMessage(`\n[SOLICITAÇÃO] ${data.sender} quer conversar. (Menu 3)`);
                    }
                }
                else if (data.messageMode === 'chatConfirmation') {
                    if (!chatHistory.has(data.chatId)) {
                        chatHistory.set(data.chatId, []);
                        client.subscribe(data.chatId);
                        displayMessage(`\n[INFO] Chat iniciado: ${data.chatId}`);
                    }
                }
            }

            // C. Atualizações de Estado
            if (topic.startsWith(TOPIC_USERS_ROOT) && data.user) {
                userStatusMap.set(data.user, data.status);
            }
            if (topic.startsWith(TOPIC_GROUPS_ROOT)) {
                groupManager.updateGroupLocalState(data);
            }

        } catch (e) {
            // Ignora JSON ruim
        }
    };

    // Conexão
    client.connect({
        willMessage: lastWill,
        cleanSession: false,
        onSuccess: async () => {
            displayMessage(`[SISTEMA] Conectado como: ${userId}`);

            client.subscribe(`${TOPIC_USERS_ROOT}/+`);
            client.subscribe(`${TOPIC_GROUPS_ROOT}/+`);
            client.subscribe(ID_Control);

            publish(MY_USER_TOPIC, { user: userId, status: "online" }, true);

            process.on("SIGINT", () => {
                const msg = new Paho.Message(JSON.stringify({ user: userId, status: "offline" }));
                msg.destinationName = MY_USER_TOPIC;
                msg.qos = 1;
                msg.retained = true;
                client.send(msg);
                setTimeout(() => { client.disconnect(); process.exit(0); }, 500);
            });

            await menuLoop();
        },
        onFailure: (err) => {
            console.error("Falha ao conectar:", err.errorMessage);
            process.exit(1);
        }
    });

    // --- MODO CHAT ---
    async function enterChatMode(chatId) {
        activeChatId = chatId;
        console.clear();
        console.log(`=== BATE-PAPO: ${chatId} ===`);
        console.log("Digite sua mensagem e ENTER. Digite '/sair' para voltar.\n");

        // 1. Mostra histórico
        const history = chatHistory.get(chatId) || [];
        history.forEach(msg => {
            const label = (msg.sender === userId) ? "Você" : msg.sender;
            console.log(`[${label}]: ${msg.text}`);
        });

        // 2. Loop de Input do Chat
        // Usamos um loop while com 'question' para manter o input focado no chat
        let inChat = true;
        while (inChat) {
            // O prompt muda para indicar modo chat
            const text = await question("> ");

            if (text === '/sair') {
                inChat = false;
                activeChatId = null;
                console.log("Saindo do chat...");
                break;
            }

            if (text) {
                const msgPayload = {
                    sender: userId,
                    text: text,
                    timestamp: Date.now()
                };

                // Envia
                publish(chatId, msgPayload, false);

                // Mostra localmente (feedback imediato)
                console.log(`[Você]: ${text}`);
                chatHistory.get(chatId).push(msgPayload);
            }
        }
    }

    // --- Funções Auxiliares Menu ---
    async function manageRequests() {
        if (conversationRequestsArray.length === 0) {
            console.log("Nenhuma solicitação pendente.");
            return;
        }
        console.log("\n--- Solicitações ---");
        conversationRequestsArray.forEach((req, idx) => console.log(`${idx+1}. De: ${req.sender}`));

        const sel = await question("Número para aceitar (ou V): ");
        if (sel.toUpperCase() === 'V') return;

        const idx = parseInt(sel) - 1;
        if (idx >= 0 && idx < conversationRequestsArray.length) {
            const req = conversationRequestsArray[idx];
            const chatId = `${req.sender}_${userId}_${req.timestamp}`;

            publish(`${req.sender}_Control`, {
                sender: userId,
                messageMode: 'chatConfirmation',
                chatId: chatId
            });

            if (!chatHistory.has(chatId)) chatHistory.set(chatId, []);
            client.subscribe(chatId);

            console.log(`[SUCESSO] Sala criada: ${chatId}`);
            conversationRequestsArray.splice(idx, 1);
        }
    }

    async function listActiveChats() {
        if (chatHistory.size === 0) {
            console.log("Nenhuma conversa ativa.");
            return null;
        }
        console.log("\n--- Conversas Ativas ---");
        const chats = Array.from(chatHistory.keys());
        chats.forEach((c, i) => console.log(`${i+1}. ${c}`));

        const sel = await question("Escolha o número (ou V): ");
        if (sel.toUpperCase() === 'V') return null;

        const idx = parseInt(sel) - 1;
        return (idx >= 0 && idx < chats.length) ? chats[idx] : null;
    }

    async function groupSubMenu() {
        console.log("\n--- Grupos ---");
        console.log("1. Criar");
        console.log("2. Listar");
        console.log("V. Voltar");
        const op = await question("Opção: ");
        if (op === '1') await groupManager.createGroup();
        else if (op === '2') groupManager.listGroups();
    }

    // --- LOOP PRINCIPAL DO MENU ---
    async function menuLoop() {
        while (true) { // Loop infinito seguro
            console.log("\n=== KIDCONNECT MQTT ===");
            console.log("1. Solicitar Bate-papo");
            console.log("2. Usuários Online");
            console.log("3. Solicitações Pendentes");
            console.log("4. Grupos");
            console.log("5. ENTRAR EM CONVERSA");
            console.log("0. Sair");

            const option = await question("Opção: ");

            switch (option) {
                case "1":
                    const target = await question("ID Alvo: ");
                    if (target !== userId) {
                        publish(`${target}_Control`, { sender: userId, messageMode: "private" });
                        console.log("Solicitação enviada.");
                    }
                    break;
                case "2":
                    console.log("\n--- Usuários ---");
                    for (const [u, s] of userStatusMap.entries()) console.log(`> [${s}] ${u}`);
                    break;
                case "3":
                    await manageRequests();
                    break;
                case "4":
                    await groupSubMenu();
                    break;
                case "5":
                    const chatToEnter = await listActiveChats();
                    if (chatToEnter) {
                        await enterChatMode(chatToEnter);
                    }
                    break;
                case "0":
                    process.emit("SIGINT");
                    return; // Sai do loop
                default:
                    console.log("Opção inválida.");
            }
        }
    }
}

main().catch(console.error);