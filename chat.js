const Paho = require("paho-mqtt");
const readline = require("readline");
const ever = true;

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

async function main() {
    const userId = await question("Digite seu ID de usuário: ");
    const mosquitto = "ws://localhost:8083/mqtt";
    const client = new Paho.Client(mosquitto, String(userId));

    const TOPIC_USERS = "USERS";
    const TOPIC_GROUPS = "GROUPS";
    const TOPIC_SYNC_REQUEST = "SYNC_REQUEST";
    const ID_Control = `${userId}_Control`;

    const userStatusMap = new Map();

    client.onConnectionLost = () => {
        displayMessage("Conexão perdida.");
    };

    client.onMessageArrived = (msg) => {
        const topic = msg.destinationName;
        const payload = msg.payloadString;

        try {
            const data = JSON.parse(payload);

            if (topic === TOPIC_USERS) {
                if (data.user && data.status) {
                    userStatusMap.set(data.user, data.status);
                }
            }
            else if (topic === TOPIC_SYNC_REQUEST) {
                if (data.requester && data.requester !== userId) {
                    publish(TOPIC_USERS, { user: userId, status: "online" });
                }
            }

            if (topic === ID_Control) {
                displayMessage(`\n[SOLICITAÇÃO] Mensagem recebida de ${data.requesterUsername}`);
            }

        } catch {
            displayMessage("\n[ERRO] Mensagem inválida: " + payload);
        }
    };

    client.connect({
        onSuccess: async () => {
            displayMessage(`Conectado como ${userId}`);
            client.subscribe(TOPIC_USERS);
            client.subscribe(TOPIC_SYNC_REQUEST);
            client.subscribe(ID_Control);

            publish(TOPIC_USERS, { user: userId, status: "online" });

            publish(TOPIC_SYNC_REQUEST, { requester: userId });

            process.on("SIGINT", () => {
                publish(TOPIC_USERS, { user: userId, status: "offline" });
                displayMessage(`\n${userId} saiu`);
                client.disconnect();
                process.exit(0);
            });

            await menuLoop();
        },
        onFailure: (err) => {
            console.error("Falha ao conectar:", err.errorMessage);
        }
    });

    function publish(topic, obj) {
        const msg = new Paho.Message(JSON.stringify(obj));
        msg.destinationName = topic;
        client.send(msg);
    }

    async function menuLoop() {
        for(;ever;) {
            console.log("\nMenu KidConnect");
            console.log("1 - Solicitar conversa");
            console.log("2 - Listar usuários");
            console.log("3 - Sair\n");

            const option = await question("Digite sua opção: ");

            if (option === "1") {
                const username = await question("Informe o username do usuário: ");
                publish(`${username}_Control`, { requesterUsername: userId, messageMode: "private" });
                displayMessage("Solicitação enviada.");
            }

            else if (option === "2") {
                if (userStatusMap.size === 0) {
                    displayMessage("Nenhum usuário conhecido ainda.");
                } else {
                    console.log("\nUsuários Conhecidos");
                    for (const [user, status] of userStatusMap.entries()) {

                        if (user !== userId) {
                            console.log(`${user}: ${status}`);

                            continue;
                        }

                        console.log(`${userId}: usuario atual`)
                    }
                    console.log("\n");
                }
            }

            else if (option === "3") {
                publish(TOPIC_USERS, { user: userId, status: "offline" });
                displayMessage(`${userId} saiu.`);
                client.disconnect();
                process.exit(0);
            }

            else {
                displayMessage("Opção inválida.");
            }
        }
    }
}

main();
