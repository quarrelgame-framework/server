import { BaseComponent, Component, Components } from "@flamework/components";
import { Dependency } from "@flamework/core";
import { HttpService, Workspace } from "@rbxts/services";
import { CharacterManager, Entity, EntityAttributes, EntityBase, ParticipantAttributes } from "@quarrelgame-framework/common";

import { MatchService } from "services/matchservice.service";
// import { EntityEvent } from "shared/components/new-entity.component";

interface CombatantLoader
{
    characterId?: string;
    matchId: string;
}

/**
 * A Participant inside of the game.
 */
@Component({
    defaults: {
        ParticipantId: HttpService.GenerateGUID(),
        MatchId: undefined,
    },
})
export class Participant extends BaseComponent<ParticipantAttributes, Player & { Character: defined; }>
{
    public readonly id: string = this.attributes.ParticipantId;
    constructor(protected readonly CharacterManager: CharacterManager)
    {
        super();
    }

    private onEntityDied()
    {
        if (this.attributes.MatchId)
        {
            for (const match of Dependency<MatchService>().GetOngoingMatches())
            {
                if (match.GetParticipants().has(this))
                    return match.RespawnParticipant(this);
            }
        }

        return;
    }

    public setupDiedHandler()
    {
        // TODO: fix potential memory leak?
        // this.entity?.RegisterEvent(EntityEvent.DEAD, () => this.onEntityDied());
        this.entity?.Humanoid.Died.Once(() => this.onEntityDied())
    }

    public async SelectCharacter(characterId: string): Promise<boolean>
    {
        const character = this.CharacterManager.GetCharacter(characterId);
        assert(character, `Character of ID ${characterId} does not exist.`);
        this.instance.SetAttribute("SelectedCharacter", characterId);

        return true;
    }

    /**
     * Loads the Participant's combatant.
     * 📝 This is generally used for battles.
     *
     * @param characterId The ID of the character that the Participant will spawn as.
     * @returns A promise that resolves when the character has been loaded.
     */
    public async LoadCombatant<A extends EntityAttributes = EntityAttributes>({
        characterId = this.instance.GetAttribute("SelectedCharacter") as string,
        matchId = this.instance.GetAttribute("MatchId") as string,
    }: CombatantLoader)
    {
        const characters = this.CharacterManager.GetCharacters();

        assert(
            characterId,
            "no character ID was provided, nor does the participant have a selected character.",
        );

        print("match id:", matchId);
        const thisMatch = [ ...Dependency<MatchService>().GetOngoingMatches() ].find(
            (match) => match.matchId === matchId,
        );
        if (thisMatch)
            this.instance.SetAttribute("MatchId", matchId);
        else
            error(`match of ID ${matchId} does not exist.`);

        return new Promise<Entity<A>>((res) =>
        {
            assert(
                this.CharacterManager.CharacterExists(characterId),
                `character of ID ${characterId} does not exist.`,
            );

            const newCharacter = characters.get(characterId)!;
            const newCharacterModel = newCharacter.Model.Clone();
            newCharacterModel.Parent = Workspace;
            print("character id:", characterId);
            newCharacterModel.SetAttribute("CharacterId", characterId);
            newCharacterModel.SetAttribute("MatchId", matchId);

            newCharacterModel.Humanoid.DisplayDistanceType = Enum.HumanoidDisplayDistanceType.None;
            newCharacterModel.Humanoid.HealthDisplayType = Enum.HumanoidHealthDisplayType.AlwaysOff;

            let _conn: RBXScriptConnection | void = this.instance.CharacterAdded.Connect((character) =>
            {
                if (character !== newCharacterModel)
                    return error(`${ character }, "!==", ${ newCharacterModel }`);

                print(`character ${character.Name} is now the participant's character.`);
                _conn = _conn?.Disconnect();

                res(this.entity as never);
            });

            this.entity = Dependency<Components>().addComponent<Entity>(newCharacterModel);
            this.instance.Character = newCharacterModel;
            this.character = this.instance.Character;

            this.setupDiedHandler();
            task.delay(2.5, () =>
            {
                if (_conn)
                    return _conn = _conn.Disconnect();
            });
        });
    }

    /**
     * Loads the Participant's online character.
     *
     * 📝 This generally is used for social features.
     */
    public async LoadCharacter()
    {
        return new Promise<Entity>((res) =>
        {
            this.instance.CharacterAdded.Once((char) =>
            {
                this.character = char;
                this.entity = Dependency<Components>().addComponent<Entity>(this.character);
                this.setupDiedHandler();

                return res(this.entity);
            });

            this.instance.LoadCharacter();
        });
    }

    public character = this.instance.Character;

    public entity?: Entity;
}

export { ParticipantAttributes } from "@quarrelgame-framework/common"
