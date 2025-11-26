class GroupManager {
    constructor(userId, publish, questionFn, displayMessage) {
        this.userId = userId;
        this.publish = publish;
        this.question = questionFn;
        this.displayMessage = displayMessage;

        this.groupsMap = new Map();
        this.TOPIC_ROOT = "GROUPS";
    }

    updateGroupLocalState(groupData) {
        if (!groupData || !groupData.groupName) return;
        this.groupsMap.set(groupData.groupName, groupData);
    }

    async createGroup() {
        const groupName = await this.question("Nome do novo grupo (sem espaços): ");

        if (!groupName || groupName.trim() === "") {
            this.displayMessage("[ERRO] Nome inválido.");
            return;
        }

        if (this.groupsMap.has(groupName)) {
            this.displayMessage(`[ERRO] O grupo '${groupName}' já existe.`);
            return;
        }

        const newGroup = {
            groupName: groupName,
            leader: this.userId,
            members: [this.userId]
        };

        const topic = `${this.TOPIC_ROOT}/${groupName}`;
        this.publish(topic, newGroup, true);
        this.displayMessage(`[SUCESSO] Grupo '${groupName}' criado.`);
    }

    async listGroups() {
        if (this.groupsMap.size === 0) {
            console.log("\n(Nenhum grupo encontrado)");
            return;
        }

        console.log("\n=== Grupos Disponíveis ===");
        const groupsArray = Array.from(this.groupsMap.values());

        groupsArray.forEach((group, index) => {
            const isMember = group.members.includes(this.userId);
            const status = isMember ? "[MEMBRO]" : "[DISPONIVEL]";
            console.log(`${index + 1} - ${group.groupName} (Líder: ${group.leader}) ${status}`);
            console.log(`   Membros: ${group.members.join(", ")}`);
        });

        const option = await this.question("\nDigite o numero para SOLICITAR ENTRADA ou 'V' para voltar: ");
        if (option.toUpperCase() === 'V') return;

        const optionIndex = parseInt(option) - 1;
        if (optionIndex >= 0 && optionIndex < groupsArray.length) {
            const selectedGroup = groupsArray[optionIndex];

            if (selectedGroup.members.includes(this.userId)) {
                this.displayMessage("[INFO] Você já está neste grupo.");
                return;
            }

            const requestPayload = {
                sender: this.userId,
                messageMode: 'groupJoinRequest',
                groupName: selectedGroup.groupName
            };

            const leaderControlTopic = `${selectedGroup.leader}_Control`;
            this.publish(leaderControlTopic, requestPayload, false);
            this.displayMessage(`[INFO] Solicitação enviada ao líder ${selectedGroup.leader}.`);
        } else {
            this.displayMessage("Opção inválida.");
        }
    }

    addMemberToGroup(groupName, newMemberId) {
        const group = this.groupsMap.get(groupName);

        if (!group) {
            this.displayMessage("[ERRO] Grupo não encontrado localmente.");
            return;
        }

        if (!group.members.includes(newMemberId)) {
            group.members.push(newMemberId);

            const topic = `${this.TOPIC_ROOT}/${groupName}`;
            this.publish(topic, group, true);

            this.displayMessage(`[SUCESSO] ${newMemberId} adicionado ao grupo '${groupName}'.`);
        } else {
            this.displayMessage(`[INFO] Usuário já era membro.`);
        }
    }
}

module.exports = GroupManager;