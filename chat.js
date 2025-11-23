const Paho = require("paho-mqtt");
const readline = require("readline");
const { readLog, writeLog } = require('./logHandler');
const GroupManager = require("./GroupManager");
const ever = true;

// Configurações Globais
const BROKER_URL = "ws://localhost:8083/mqtt";
const TOPIC_USERS_ROOT = "USERS"; // Raiz para tópicos de usuários

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

    // Definições de Tópicos
    const MY_USER_TOPIC = `${TOPIC_USERS_ROOT}/${userId}`; // Ex: USERS/Joao
    const ID_Control = `${userId}_Control`;

    // Configuração do Last Will (Último Desejo)
    // Se a conexão cair, o broker publica automaticamente "offline" neste tópico e RETÉM a mensagem.
    const lastWill = new Paho.Message(JSON.stringify({ user: userId, status: "offline" }));
    lastWill.destinationName = MY_USER_TOPIC;
    lastWill.qos = 1;
    lastWill.retained = true;

    const client = new Paho.Client(BROKER_URL, String(userId));

    // Estruturas de Dados Locais
    const userStatusMap = new Map();
    const conversationRequestsArray = [];

    // Callbacks do Cliente MQTT
    client.onConnectionLost = (responseObject) => {
        if (responseObject.errorCode !== 0) {
            displayMessage(`[ERRO] Conexão perdida: ${responseObject.errorMessage}`);
        }
    };

    client.onMessageArrived = async (msg) => {
        const topic = msg.destinationName;
        const payload = msg.payloadString;

        try {
            // Se payload vazio (mensagem retida apagada), ignorar
            if (!payload) return;

            const data = JSON.parse(payload);

            // 1. Atualização de Status de Usuários (Via Tópicos Hierárquicos)
            // Captura qualquer mensagem em USERS/+
            if (topic.startsWith(TOPIC_USERS_ROOT)) {
                if (data.user && data.status) {
                    userStatusMap.set(data.user, data.status);

                    // Opcional: Notificar visualmente mudanças de status de outros
                    // if (data.user !== userId) displayMessage(`[STATUS] ${data.user} agora está ${data.status}`);
                }
            }

            // 2. Canal de Controle Privado
            if (topic === ID_Control) {
                if (data.messageMode === 'private') {
                    // Recebimento de solicitação de conversa
                    writeLog(`SOLICITACAO RECEBIDA: De ${data.sender}`);

                    // Verifica se já existe solicitação deste remetente
                    const existingRequest = conversationRequestsArray.find(req => req.sender === data.sender);

                    if (!existingRequest) {
                        conversationRequestsArray.push({
                            sender: data.sender,
                            timestamp: Date.now()
                        });
                        displayMessage(`\n[SOLICITAÇÃO] Nova conversa pendente de: ${data.sender}. Vá ao menu Gerenciar Solicitações.`);
                    } else {
                        // Atualiza timestamp se re-enviado
                        existingRequest.timestamp = Date.now();
                        displayMessage(`\n[INFO] Lembrete de solicitação pendente de ${data.sender}.`);
                    }
                }

                else if (data.messageMode === 'chatConfirmation') {
                    // Confirmação de que o outro usuário aceitou a conversa
                    writeLog(`CHAT INICIADO/CONFIRMADO: ID ${data.chatId}`);
                    displayMessage(`\n[INFO] Conversa iniciada com ${data.sender}! Sala: ${data.chatId}`);

                    // Assina o tópico do chat para começar a receber mensagens (futuro loop de chat)
                    client.subscribe(data.chatId);
                }
            }

            // 3. Atualização de Grupos
            if (topic === 'GROUPS') {
                // Futura implementação de merge de grupos
                // const groupsData = JSON.parse(payload);
                // groupManager.mergeGroups(groupsData);
            }

        } catch (e) {
            writeLog(`[ERRO PARSER] Tópico: ${topic} | Erro: ${e.message}`);
        }
    };

    // Conexão e Loop
    client.connect({
        willMessage: lastWill,
        cleanSession: false, // Importante para persistência de sessão QoS
        onSuccess: async () => {
            displayMessage(`[INFO] Conectado ao broker como: ${userId}`);

            // Assinaturas Iniciais
            client.subscribe(`${TOPIC_USERS_ROOT}/+`); // Assina USERS/Joao, USERS/Maria, etc. (Wildcard)
            client.subscribe(ID_Control);
            client.subscribe('GROUPS'); // Assina atualizações de grupos

            // Publica status ONLINE com retenção (para quem entrar depois ver)
            publish(MY_USER_TOPIC, { user: userId, status: "online" }, true);

            // Handler para encerramento gracioso (Ctrl+C)
            process.on("SIGINT", () => {
                displayMessage(`\n[INFO] Saindo... Atualizando status para offline.`);

                // Publica OFFLINE com retenção antes de sair
                const msg = new Paho.Message(JSON.stringify({ user: userId, status: "offline" }));
                msg.destinationName = MY_USER_TOPIC;
                msg.qos = 1;
                msg.retained = true;
                client.send(msg);

                // Pequeno delay para garantir envio antes de matar o processo
                setTimeout(() => {
                    client.disconnect();
                    process.exit(0);
                }, 500);
            });

            await menuLoop();
        },
        onFailure: (err) => {
            console.error("[CRÍTICO] Falha ao conectar ao broker:", err.errorMessage);
            process.exit(1);
        }
    });

    // Função Auxiliar de Publicação
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

    // Gerenciador de Grupos (Instanciação)
    const groupManager = new GroupManager(
        userId,
        publish,
        question,
        displayMessage
    );

    // --- Funções do Menu ---

    async function manageRequests() {
        if (conversationRequestsArray.length === 0) {
            displayMessage("\n[INFO] Nenhuma solicitação de conversa pendente.");
            return;
        }

        const requestsArray = conversationRequestsArray;

        console.log("\n--- Solicitações Pendentes ---");
        requestsArray.forEach((reqData, index) => {
            console.log(`${index + 1} - De: ${reqData.sender} (Recebida em: ${new Date(reqData.timestamp).toLocaleTimeString()})`);
        });
        console.log("-----------------------------\n");

        const selection = String(await question("Digite o número para ACEITAR, ou 'V' para voltar: "));

        if (selection.toUpperCase() === 'V') return;

        const index = parseInt(selection) - 1;

        if (index >= 0 && index < requestsArray.length) {
            const requestToAccept = requestsArray[index];
            const senderId = requestToAccept.sender;

            // Gera ID da Sessão: ID_Solicitante + ID_Aceitante + Timestamp
            // Requisito: "nome do tópico pode ser X_Y_timestamp"
            const chatId = `${senderId}_${userId}_${requestToAccept.timestamp}`;

            // Envia confirmação para o canal de controle do solicitante
            publish(`${senderId}_Control`, {
                sender: userId,
                messageMode: 'chatConfirmation',
                chatId: chatId
            });

            // O aceitante também assina o tópico para receber msg
            client.subscribe(chatId);

            displayMessage(`\n[SUCESSO] Conversa aceita com ${senderId}. Tópico: ${chatId}`);

            // Remove da lista de pendentes
            conversationRequestsArray.splice(index, 1);
        } else {
            displayMessage("[ERRO] Seleção inválida.");
        }
    }

    async function groupSubMenu() {
        console.log("\n--- Menu de Grupos ---");
        console.log("1 - Criar Novo Grupo");
        console.log("2 - Listar Grupos Cadastrados (Locais)");
        console.log("V - Voltar\n");

        const option = await question("Digite sua opção: ");

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
            console.log("\n=== Menu KidConnect ===");
            console.log("1 - Solicitar conversa (1-to-1)");
            console.log("2 - Listar usuários (Online/Offline)");
            console.log("3 - Gerenciar solicitações recebidas");
            console.log("4 - Gerenciar Grupos");
            console.log("5 - Exibir log de depuração");
            console.log("0 - Sair");
            console.log("=======================\n");

            const option = await question("Opção: ");

            switch (option) {
                case "1":
                    const targetUser = await question("Informe o ID do usuário destino: ");
                    if (targetUser === userId) {
                        displayMessage("[AVISO] Você não pode conversar consigo mesmo.");
                    } else {
                        // Envia solicitação para o tópico de controle do destino
                        publish(`${targetUser}_Control`, {
                            sender: userId,
                            messageMode: "private"
                        });
                        displayMessage(`[INFO] Solicitação enviada para ${targetUser}. Aguarde aceitação.`);
                    }
                    break;

                case "2":
                    console.log("\n--- Usuários na Rede ---");
                    if (userStatusMap.size === 0) {
                        console.log("(Nenhum usuário detectado ainda)");
                    }
                    for (const [user, status] of userStatusMap.entries()) {
                        const label = (user === userId) ? "(Você)" : "";
                        console.log(`> [${status.toUpperCase()}] ${user} ${label}`);
                    }
                    console.log("------------------------\n");
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
                    // Dispara evento SIGINT para saída graciosa
                    process.emit("SIGINT");
                    break;

                default:
                    displayMessage("Opção inválida, tente novamente.");
            }
        }
    }
}

// Inicialização
main().catch(err => console.error(err));