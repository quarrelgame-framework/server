import { Components } from "@flamework/components";
import { Controller, Dependency, Modding, OnInit, OnStart, Reflect, Service } from "@flamework/core";
import Make from "@rbxts/make";
import { Players, StarterPlayer, Workspace } from "@rbxts/services";
import { Participant } from "components/participant.component";

import { Character, BlockMode } from "@quarrelgame-framework/common";

import { Functions } from "network";
import { MatchService } from "./matchservice.service";

export interface OnParticipantAdded
{
    onParticipantAdded(participant: Participant): void;
}

export interface OnCharacterListChanged
{
    onCharacterListChanged(newCharactersList: ReadonlyMap<string, Character.Character>): void;
}

@Service({
    loadOrder: -2,
})
export class QuarrelGame extends QuarrelGameMetadata implements OnStart, OnInit
{
    constructor()
    {
        super();
        print("what");
        print(Reflect.getMetadata(this, "identifier"));
    }

    public readonly DefaultBlockMode = BlockMode.MoveDirection;

    public readonly CharacterContainer = Make("Folder", {
        Parent: Workspace,
        Name: "CharacterContainer",
    });

    public readonly MatchContainer = Make("Folder", {
        Parent: Workspace,
        Name: "MapContainer",
    });

    public readonly characters: Map<string, Character.Character> = new Map();

    private readonly characterListChangedHandler = new Set<OnCharacterListChanged>();

    private readonly participantAddedHandler = new Set<OnParticipantAdded>();

    public SetCharacters(characters: ReadonlyMap<string, Character.Character>)
    {
        this.characters.clear();
        print("chars cleared huhuhuh");
        for (const [ k, v ] of characters)
            this.characters.set(k, v);

        for (const listener of this.characterListChangedHandler)
            listener.onCharacterListChanged(characters);
    }

    onInit()
    {
        StarterPlayer.DevComputerCameraMovementMode = Enum.DevComputerCameraMovementMode.Classic;
        StarterPlayer.EnableMouseLockOption = false;
        Players.CharacterAutoLoads = false;

        Modding.onListenerAdded<OnParticipantAdded>((l) => this.participantAddedHandler.add(l));
        Modding.onListenerRemoved<OnParticipantAdded>((l) => this.participantAddedHandler.delete(l));

        Modding.onListenerAdded<OnCharacterListChanged>((l) => this.characterListChangedHandler.add(l));
        Modding.onListenerRemoved<OnCharacterListChanged>((l) => this.characterListChangedHandler.delete(l));

        print("Quarrel Game is ready.");
    }

    onStart()
    {
        const components = Dependency<Components>();
        const reparentCharacter = (t: Model) =>
        {
            task.wait(0.5);
            t.Parent = this.CharacterContainer;
        };

        Players.PlayerAdded.Connect((player) =>
        {
            const newParticipant = components.addComponent(player, Participant);
            this.participants.push(newParticipant);
            for (const participant of this.participantAddedHandler)
                participant.onParticipantAdded(newParticipant);

            player.CharacterAdded.Connect((character) =>
            {
                if (!character.Parent)
                    character.AncestryChanged.Once(() => reparentCharacter(character));
                else
                    reparentCharacter(character);

                if (!character.FindFirstChild("Humanoid")?.FindFirstChild("Animator"))
                {
                    Make("Animator", {
                        Parent: character.WaitForChild("Humanoid"),
                    });
                }
            });
        });

        Players.PlayerRemoving.Connect((player) =>
        {
            for (const [ i, participant ] of pairs(this.participants))
            {
                if (participant.instance === player)
                    this.participants.remove(i);
            }
        });

        // setup events
        Functions.RespawnCharacter.setCallback((player) =>
        {
            assert(
                this.IsParticipant(player),
                `player ${player.UserId} is not a participant`,
            );
            const thisParticipant = this.GetParticipant(player)!;
            if (thisParticipant.attributes.MatchId)
            {
                for (const match of Dependency<MatchService>().GetOngoingMatches())
                {
                    if (match.GetParticipants().has(thisParticipant))
                    {
                        return thisParticipant
                            .LoadCombatant({ matchId: match.matchId })
                            .then((entity) => entity.instance);
                    }
                }

                warn(
                    `player ${player.UserId} is in a match, but the match was not found`,
                );
            }

            print("Loading character.");
            return thisParticipant.LoadCharacter().then((entity) => entity.instance);
        });

        Functions.SelectCharacter.setCallback((player, characterId) =>
        {
            assert(
                this.IsParticipant(player),
                `player ${player.UserId} is not a participant`,
            );

            return this.GetParticipant(player)!.SelectCharacter(characterId);
        });
    }

    public IsPlayer(item: unknown): item is Player
    {
        return typeIs(item, "Instance") && item.IsA("Player");
    }

    public IsParticipant(item: unknown): boolean
    {
        return !!this.participants.find((n) => n.instance === item);
    }

    public GetParticipant(player: Player)
    {
        return this.participants.find((n) => n.instance === player);
    }

    public GetParticipantFromId(id: string)
    {
        return this.participants.find((n) => n.id === id);
    }

    public GetAllParticipants()
    {
        return [ ...this.participants ];
    }

    public GetParticipantFromCharacter(
        item: Instance | undefined,
    ): Participant | undefined
    {
        if (!item)
            return undefined;

        const components = Dependency<Components>();
        const player = Players.GetPlayerFromCharacter(item);

        assert(player, "character not found");

        return components.getComponent(player, Participant);
    }

    public participants: Array<Participant> = [];

    public ids: Array<string> = [];
}
