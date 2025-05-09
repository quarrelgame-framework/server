import { Components } from "@flamework/components";
import { Modding, OnInit, OnStart, Reflect, Service } from "@flamework/core";
import Make from "@rbxts/make";
import { Players, StarterPlayer, Workspace } from "@rbxts/services";
import { Participant } from "components/participant.component";

import { QuarrelGameMetadata, Character, BlockMode, Animator, Entity } from "@quarrelgame-framework/common";

import { Events, Functions } from "network";
import { MatchService } from "./matchservice.service";
import { Constructor, getParentConstructor } from "@flamework/components/out/utility";
import { ICharacter } from "@quarrelgame-framework/types";

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
    constructor(private components: Components, private matchService: MatchService)
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

    private readonly characterListChangedHandler = new Set<OnCharacterListChanged>();

    private readonly participantAddedHandler = new Set<OnParticipantAdded>();

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
        const reparentCharacter = (t: Model) =>
        {
            task.wait(0.5);
            t.Parent = this.CharacterContainer;
        };

        Events.Joined.connect((player) =>
        {
            Events.SyncEntities.fire(player, [...this.registeredEntities].map<readonly [ICharacter, string]>(([ent, cons]) => [ent.instance, Reflect.getMetadata(ent, "identifier") as string] as const));

        });

        Functions.EntityIsRegistered.setCallback((_, entityId) =>
        {
            return !![...this.registeredEntities].find(([e]) => e.attributes.EntityId === entityId);
        })

        Players.PlayerAdded.Connect((player) =>
        {
            const newParticipant = this.components.addComponent(player, Participant);
            this.participants.push(newParticipant);

            // task.delay(2, () =>
            // {
                // Events.SyncEntities.broadcast([...this.registeredEntities].map(([e, c]) => [e.instance, Reflect.getMetadata(e, "identifier") as string | undefined] as const));

                for (const participant of this.participantAddedHandler)

                    participant.onParticipantAdded(newParticipant);
            // })

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
                for (const match of this.matchService.GetOngoingMatches())
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

        Functions.RequestSelectCharacter.setCallback((player, characterId) =>
        {
            assert(
                this.IsParticipant(player),
                `player ${player.UserId} is not a participant`,
            );

            return this.GetParticipant(player)!.SelectCharacter(characterId);
        });
    }

    protected registeredEntities: Set<[Entity, Constructor<Entity> | undefined]> = new Set();
    /*
     * Add an entity to the registered entities set.
     * Sends an event to all clients upon success.
     */
    public RegisterEntity(model: Model, entityClass: Constructor<Entity> = Entity): Entity
    {
       const newEntityComponent = this.components.addComponent(model, entityClass)
       this.registeredEntities.add([newEntityComponent, entityClass ?? Entity]);

       /* TODO: figure out if this shit is already set? why am i passing the entity id if its synced between the doohickey and the dooblam? */
       /* oh yeah i remembered its because what happens if they're fighting a client entity and then that entity becomes server recognized 
        * (like a training dummy that actually becomes meaningful or something)? then theres an entity id desync which means hits dont sync
        * at all... hmmm....
        */
       Events.EntityRegistered.broadcast(newEntityComponent.attributes.EntityId, newEntityComponent.instance, Reflect.getMetadata(newEntityComponent, "identifier") as string);

       return newEntityComponent;
    }

    /*
     * Remove an entity from the registered entities set.
     * Sends an event to all clients upon success.
     */
    public UnregisterEntity(entity: string | Entity)
    {
        const entityIsString = typeIs(entity, "string");
        const entityData = [...this.registeredEntities].find(([e]) => entityIsString ? e.attributes.EntityId === entity : e === entity);
        const [foundEntity, entityClass] = entityData ?? [];

        if (entityData && foundEntity)
        {
            if (entityIsString)
            {
                this.registeredEntities.delete(entityData)
                if (this.components.getComponent(foundEntity.instance))

                    this.components.removeComponent(foundEntity.instance, entityClass);

                Events.EntityUnregistered.fire(Players.GetPlayers(), foundEntity.attributes.EntityId);
                return true;
            } else if (entity) 
            {
                this.registeredEntities.delete(entityData);
                if (this.components.getComponent(foundEntity.instance, entityClass))

                    this.components.removeComponent(foundEntity.instance, entityClass);
            }
        } else return false;

        return !!entity;
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

        const player = Players.GetPlayerFromCharacter(item);
        assert(player, "character not found");

        return this.components.getComponent(player, Participant);
    }

    public participants: Array<Participant> = [];

    public ids: Array<string> = [];
}
