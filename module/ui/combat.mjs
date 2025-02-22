import {SYSTEM} from "../settings.js";
import {Flags} from "../helpers/flags.mjs";

export const FRIENDLY = "friendly";

export const HOSTILE = "hostile";

/**
 * @property {Collection<FUCombatant>} combatants
 */
export class FUCombat extends Combat {
    get nextCombatant() {
        return null;
    }

    get combatant() {
        return null;
    }

    async rollInitiative(ids, options) {
        return this;
    }

    /**
     * @param {CombatData} data
     * @param context
     */
    constructor(data, context) {
        super(data, context);

        this.setTurnsTaken({})
    }

    /**
     * @return {string[]}
     */
    get currentRoundTurnsTaken() {
        const allRoundsTurnsTaken = this.getTurnsTaken() ?? {};
        return allRoundsTurnsTaken[this.round] ?? []
    }

    /**
     * @return {Object.<number, string[]>}
     */
    getTurnsTaken() {
        return this.getFlag(SYSTEM, Flags.CombatantsTurnTaken);
    }

    /**
     * @param {Object.<number,string[]>} flag
     */
    async setTurnsTaken(flag) {
        return this.setFlag(SYSTEM, Flags.CombatantsTurnTaken, flag);
    }

    /**
     * @param {FUCombatant} combatant
     */
    async markTurnTaken(combatant) {
        this.current.combatantId = combatant.id || null
        this.current.tokenId = combatant.tokenId || null

        const flag = this.getTurnsTaken();
        flag[this.round] ??= []
        flag[this.round].push(combatant.id)
        await this.setTurnsTaken(flag)

        this.setupTurns()

        await this.nextTurn()
    }

    determineNextTurn() {
        if (!this.started) {
            return undefined;
        }

        const turnsTaken = this.currentRoundTurnsTaken;

        if (turnsTaken.length) {
            const lastTurn = this.combatants.get(turnsTaken.at(-1)).faction

            const nextTurn = lastTurn === HOSTILE ? FRIENDLY : HOSTILE;
            let turnsNotTaken = this.combatants.filter(combatant => !turnsTaken.includes(combatant.id));

            const skip = this.settings.skipDefeated;
            if ( skip ) {
                turnsNotTaken = turnsNotTaken.filter(combatant => !combatant.isDefeated)
            }

            const factionsWithTurnsLeft = turnsNotTaken.map(combatant => combatant.faction)

            return factionsWithTurnsLeft.includes(nextTurn) ? nextTurn : lastTurn
        } else {
            return this.getFirstTurn()
        }
    }


    /**
     * @return {"hostile" | "friendly"}
     */
    getCurrentTurn() {
        return this.getFlag(SYSTEM, Flags.CurrentTurn);
    }

    /**
     * @param {"hostile" | "friendly"} flag
     */
    setCurrentTurn(flag) {
        if (flag) {
            return this.setFlag(SYSTEM, Flags.CurrentTurn, flag);
        } else {
            return this.unsetFlag(SYSTEM, Flags.CurrentTurn)
        }
    }

    _onCreateDescendantDocuments(parent, collection, documents, data, options, userId) {
        super._onCreateDescendantDocuments(parent, collection, documents, data, options, userId);
    }

    setupTurns() {
        const turnsTaken = this.currentRoundTurnsTaken.map(id => this.combatants.get(id));
        const turnsNotTaken = this.combatants.filter(combatant => !turnsTaken.includes(combatant));
        return this.turns = turnsTaken.concat(turnsNotTaken);
    }

    async startCombat() {

        const factions = [{
            value: FRIENDLY,
            translation: `FU.DialogFirstTurnFactionsFriendly`
        }, {
            value: HOSTILE,
            translation: `FU.DialogFirstTurnFactionsHostile`
        }];

        const firstTurnFaction = await Dialog.prompt({
            title: game.i18n.localize("FU.DialogFirstTurnTitle"),
            label: game.i18n.localize("FU.DialogFirstTurnLabel"),
            content: await renderTemplate('systems/projectfu/templates/dialog/dialog_first_turn.hbs', {factions, selected: FRIENDLY}),
            options: {classes: ["dialog-first-turn"]},
            rejectClose: false,
            /** @type {(jQuery) => "friendly"|"hostile"} */
            callback: (html) => html.find("select[name=faction]").val()
        })

        if (!firstTurnFaction) {
            return this;
        }

        await this.setFirstTurn(firstTurnFaction)
        await this.setCurrentTurn(firstTurnFaction)
        return super.startCombat();
    }

    /**
     * @return {"hostile" | "friendly"}
     */
    getFirstTurn() {
        return this.getFlag(SYSTEM, Flags.FirstTurn)
    }

    /**
     * @param {"hostile" | "friendly"} flag
     */
    async setFirstTurn(flag) {
        return this.setFlag(SYSTEM, Flags.FirstTurn, flag)
    }

    async previousTurn() {
        const turnsTaken = this.getTurnsTaken();

        if (turnsTaken[this.round]) {
            turnsTaken[this.round].pop()
            await this.setTurnsTaken(turnsTaken)
        }

        await super.previousTurn();
        await this.setCurrentTurn(this.determineNextTurn())
        return this;
    }

    async previousRound() {
        const flag = this.getTurnsTaken();

        if (flag[this.round]) {
            delete flag[this.round]
        }
        flag[this.round - 1]?.pop()
        await this.setTurnsTaken(flag)

        await this.setCurrentTurn(this.determineNextTurn())
        await super.previousRound();

        console.log(this.started)
        if (!this.started){
            await this.setCurrentTurn(undefined)
        }
        return this;
    }


    async nextTurn() {

        await this.setCurrentTurn(this.determineNextTurn())

        // Determine the next turn number

        const turnsTaken = this.currentRoundTurnsTaken.map(id => this.combatants.get(id));
        let turnsNotTaken = this.combatants.filter(combatant => !turnsTaken.includes(combatant));

        const skip = this.settings.skipDefeated;
        if ( skip ) {
            turnsNotTaken = turnsNotTaken.filter(combatant => !combatant.isDefeated)
        }

        const next = turnsNotTaken.length ? turnsTaken.length : null

        // Maybe advance to the next round
        let round = this.round;
        if ( (this.round === 0) || (next === null) || (next >= this.turns.length) ) {
            return this.nextRound();
        }

        // Update the document, passing data through a hook first
        const updateData = {round, turn: next};
        const updateOptions = {advanceTime: CONFIG.time.turnTime, direction: 1};
        Hooks.callAll("combatTurn", this, updateData, updateOptions);
        return this.update(updateData, updateOptions);
    }

    async nextRound() {
        await this.setCurrentTurn(this.getFirstTurn())

        let turn = this.turn === null ? null : 0; // Preserve the fact that it's no-one's turn currently.
        let advanceTime = Math.max(this.turns.length - this.turn, 0) * CONFIG.time.turnTime;
        advanceTime += CONFIG.time.roundTime;
        let nextRound = this.round + 1;

        // Update the document, passing data through a hook first
        const updateData = {round: nextRound, turn};
        const updateOptions = {advanceTime, direction: 1};
        Hooks.callAll("combatRound", this, updateData, updateOptions);
        return this.update(updateData, updateOptions);
    }
}