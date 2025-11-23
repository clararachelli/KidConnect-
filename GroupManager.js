class GroupManager {
    constructor(userId, publish, question, displayMessage) {
        this.userId = userId;
        this.publish = publish;
        this.question = question;
        this.displayMessage = displayMessage;

        // Armazena o estado local dos grupos recebidos do broker
        // Chave: Nome do Grupo, Valor: Objeto do Grupo
        this.groupsMap = new Map();

        this.TOPIC_ROOT = "GROUPS";
    }

    /**
     * Processa uma mensagem recebida do tópico GROUPS/+
     * Atualiza o mapa local para que a listagem esteja sempre sincronizada.
     */
    updateGroupLocalState(groupData) {
        if (!groupData || !groupData.groupName) return;

        // Atualiza ou insere o grupo no mapa local
        this.groupsMap.set(groupData.groupName, groupData);
    }

    /**
     * Cria um novo grupo e publica no tópico específico GROUPS/NomeDoGrupo
     */
    async createGroup() {
        const groupName = await this.question("Digite o nome do novo grupo (sem espaços): ");

        // Validação simples
        if (!groupName || groupName.includes(" ")) {
            this.displayMessage("\n[ERRO] Nome inválido. Use apenas letras/números sem espaços.");
            return;
        }

        // Verifica se já sabemos que esse grupo existe (pelo mapa local)
        if (this.groupsMap.has(groupName)) {
            this.displayMessage(`\n[ERRO] O grupo '${groupName}' já existe.`);
            return;
        }

        const newGroup = {
            groupName: groupName,
            leader: this.userId,
            members: [this.userId] // Inicia apenas com o criador
        };

        // Publica no tópico específico do grupo com RETAINED = true
        // Tópico: GROUPS/NomeDoGrupo
        const topic = `${this.TOPIC_ROOT}/${groupName}`;

        // A função publish deve vir do main.js e aceitar (topic, payload, retain)
        this.publish(topic, newGroup, true);

        this.displayMessage(`\n[SUCESSO] Grupo '${groupName}' criado e sincronizado na rede.`);
    }

    listGroups() {
        if (this.groupsMap.size === 0) {
            this.displayMessage("\n(Nenhum grupo encontrado na rede ainda)");
            return;
        }

        console.log("\n=== Grupos Disponíveis ===");
        this.groupsMap.forEach((group, name) => {
            const isLeader = group.leader === this.userId;
            const leaderDisplay = isLeader ? `${group.leader} (Você)` : group.leader;

            // Remove o líder da lista de membros para exibição, se quiser
            const otherMembers = group.members.filter(m => m !== group.leader);
            const membersList = otherMembers.length > 0 ? otherMembers.join(', ') : "(nenhum outro)";

            console.log(`\n[Grupo]: ${name}`);
            console.log(`   Líder: ${leaderDisplay}`);
            console.log(`   Membros: ${group.members.length} integrante(s)`);
            console.log(`   Lista: ${group.members.join(", ")}`);
        });
        console.log("==========================\n");
    }
}

module.exports = GroupManager;