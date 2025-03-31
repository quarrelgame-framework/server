import { Components } from "@flamework/components";
import { Dependency, OnInit, OnStart, Service } from "@flamework/core";
import { Events, Functions } from "network";
import { Client, Identifier, Entity, EntityAttributes, TrainingAttributes, CharacterManager, QuarrelAssets } from "@quarrelgame-framework/common";

import { Participant, ParticipantAttributes } from "components/participant.component";
import { Map as MapNamespace, MatchSettings, MatchPhase, MatchData as SerializedMatchData } from "@quarrelgame-framework/common";
import { QuarrelGame } from "services/quarrelgame.service";

import Make from "@rbxts/make";
import Signal from "@rbxts/signal";
import { Workspace } from "@rbxts/services";

export enum ArenaTypeFlags
{
    "ALLOW_2D" = 1 << 0,
    "ALLOW_3D" = 1 << 1,
}

export const DefaultMatchSettings: MatchSettings = {
    ArenaType: ArenaTypeFlags["ALLOW_2D"] | ArenaTypeFlags["ALLOW_3D"],
    Map: "happyhome",
};

interface MatchData
{
    Participants: Participant[];

    Settings: MatchSettings;
}

export interface PostMatchData
{}

export class Match
{
    private readonly MatchService = Dependency<MatchService>();

    private matchSettings: MatchSettings = {
        ArenaType: ArenaTypeFlags["ALLOW_2D"] | ArenaTypeFlags["ALLOW_3D"],
        Map: "happyhome",
    };

    private readonly participants_ready: Set<Participant> = new Set();

    private readonly entity_connections: Map<Participant, RBXScriptConnection[]> = new Map();

    private readonly participants: Set<Participant> = new Set();

    private readonly matchFolder: Folder;

    private matchPhase: MatchPhase = MatchPhase.Waiting;

    private matchHost;

    /** Signals **/
    public readonly Respawning = new Signal<(entity: Entity) => void>()

    public readonly Died = new Signal<(entity?: Entity) => void>();

    public readonly Starting = new Signal<() => void>();

    public readonly Ended = new Signal<(postMatchData: PostMatchData) => void>();

    public readonly Ready = new Signal<(participant: string) => void>();

    public readonly NotReady = new Signal<(participant: string) => void>();

    public readonly Joining = new Signal<(participant: string) => void>();

    public readonly Leaving = new Signal<(participant: string) => void>();

    /* TODO: maybe turn this into a getter function?*/
    public readonly trainingDummy?: Entity;

    constructor(private readonly originalMatchHost: Participant, public readonly matchId = Identifier.Generate())
    {
        this.matchHost = originalMatchHost;
        this.matchFolder = Make("Folder", {
            Name: `Match-${this.matchId}`,
        });

            this.Starting.Connect(() => 
            {
                warn("starting")
                if (this.matchSettings.Training?.Enabled)
                {
                    if (!this.matchHost.entity)
                    {
                        warn("no match host entity")
                        this.matchHost.instance.CharacterAdded.Once((char) => {
                            let removingConnection: RBXScriptConnection | void | undefined;
                            warn("character added")

                            Promise
                                .race<void>([
                                    Dependency<Components>().waitForComponent<Entity>(char).then((entity) => entity).then(() => 
                                    {
                                        print("entity found on char")
                                        removingConnection = removingConnection?.Disconnect()
                                    }),
                                    new Promise<void>((_,rej) => 
                                    {
                                        return removingConnection = this.matchHost.instance.CharacterRemoving.Once(() => {
                                            removingConnection?.Disconnect();
                                            removingConnection = undefined;
                                            rej();
                                        })
                                    })
                                ])
                                .catch(() => /* TODO: if verbose mode print "no print training dummy */ warn("haha goofy hehee hoohoo test character"))
                                .then(() => this.RespawnTrainingDummy(this.matchHost))
                        })
                    }
                    else this.RespawnTrainingDummy(this.matchHost);
                } else warn("training not enabled:", this.matchSettings);
            });

        this.matchFolder.SetAttribute("MatchId", this.matchId);
    }

    /**
     * Adds a participant to the match.
     *
     * ⚠️ Can lead to unstable behavior if the match is in progress.
     *
     * @param participant The participant to add.
     */
    public AddParticipant(participant: Participant)
    {
        this.participants.add(participant);
        participant.attributes.MatchId = this.matchId;
    }

    /**
     * Mark a participant as 'ready.'
     * Errors if the participant is not added first.
     *
     * ⚠️ Can lead to unstable behavior if the match is in progress.
     *
     * @param participant The participant to add.
     */
    public ReadyParticipant(participant: Participant)
    {

        assert(this.participants.has(participant), `participant ${participant.instance.Name} is not in the current match (${this.matchId})`);
        assert(!this.participants_ready.has(participant), `participant ${participant.instance.Name} is already ready`);

        this.participants_ready.add(participant);
        this.Ready.Fire(participant.id);

        const entity_connections = this.entity_connections.set(participant, this.entity_connections.get(participant) ?? [] as RBXScriptConnection[]).get(participant)!;
        entity_connections.push(
            participant.EntitySpawned.Connect((entity) =>
            {
                this.Respawning.Fire(entity)
            }),
            participant.EntityDied.Connect((entity) =>
            {
                this.Died.Fire(entity)
            }));


        return true;
    }

    /**
     * Mark a participant as 'ready.'
     * Errors if the participant is not added first.
     *
     * ⚠️ Can lead to unstable behavior if the match is in progress.
     *
     * @param participant The participant to add.
     */
    public UnreadyParticipant(participant: Participant)
    {
        assert(this.participants.has(participant), `participant ${participant.instance.Name} is not in the current match (${this.matchId})`);
        assert(this.participants_ready.has(participant), `participant ${participant.instance.Name} is not ready`);

        this.participants_ready.delete(participant);
        this.NotReady.Fire(participant.id);
        this.entity_connections.get(participant)?.map((e) => e.Disconnect()).clear();
        return true;
    }

    /**
     * Removes a participant from the match.
     *
     * ⚠️ Can lead to unstable behavior if the match is in progress.
     *
     * 📝 If the participant is the host, then the original host will be set as
     * the new host. If the original host is not in the participants list, then
     * the new host will be the first participant in the participants list.
     *
     * @param participant The participant to remove.
     */
    public RemoveParticipant(participant: Participant)
    {
        if (this.matchHost === participant)
        {
            if (this.participants.has(this.originalMatchHost))
                this.matchHost = this.originalMatchHost;
            else
                this.matchHost = [ ...this.participants ][0];
        }

        participant.attributes.MatchId = undefined;
        this.participants.delete(participant);
        this.Leaving.Fire(participant.id);
    }

    /**
     * Clears the participants and sets the original host as the current host.
     *
     * ⚠️ Can lead to unstable behavior if the match is in progress.
     *
     * 📝 Automatically adds the match host back into the participants list.
     */
    public ClearParticipants()
    {
        for (const participant of this.participants)
        {
            this.participants.delete(participant)
            this.Leaving.Fire(participant.id);
        }
        this.participants.add(this.matchHost);
    }

    /**
     * 📝 Also checks if the player is inside of the lobby as well. If alternative
     * functionality is required, then iterate over the participants and check
     * for otherwise.
     *
     * @param player The {@link Player Player} or {@link Participant Participant} to check.
     * @returns Whether the specified player is either the original host or the current host of the match.
     */
    public HostIs(player: Player | Participant)
    {
        return (
            (this.matchHost.instance === player || this.matchHost === player || this.originalMatchHost === player || this.originalMatchHost.instance === player)
            && this.participants.has(this.matchHost) && [ ...this.participants ].find(
                    (n) => n === player || n.instance === player,
                ) !== undefined
        );
    }

    /**
     * Get the host that first created the match.
     * @returns The original host of the match.
     */
    public GetOriginalHost()
    {
        return this.originalMatchHost;
    }

    /**
     * Get the host of the match.
     * @returns The current host of the match.
     */
    public GetHost()
    {
        return this.matchHost;
    }

    /**
     * Get the match settings.
     * @returns The match settings.
     */
    public GetMatchSettings()
    {
        return { ...this.matchSettings } as MatchSettings;
    }

    /**
     * Sets the match settings.
     *
     * ⚠️ Can lead to unstable behavior if the match is in progress.
     *
     * @param matchSettings The match settings to set.
     */
    public SetMatchSettings(matchSettings: MatchSettings)
    {
        this.matchSettings = matchSettings;
    }

    /**
     * Requests all participants to load the map.
     * @returns A promise that resolves when all participants have loaded the map.
     */
    private RequestParticipantsLoadMap(): Promise<Participant["id"][]>
    {
        return Promise.all<Promise<Participant["id"]>[]>(
            [ ...this.participants_ready ].map((participant) =>
            {
                print(`requesting participant ${participant.attributes.ParticipantId} to load map...`);
                return new Promise<Participant["id"]>(async (res, rej) =>
                {
                    return Functions.RequestLoadMap(
                        participant.instance,
                        this.matchSettings.Map,
                    )
                        .timeout(
                            5,
                            `RequestLoadMap for player ${participant.instance.Name} timed out.`,
                        )
                        .then(() =>
                        {
                            print(`participant ${participant.attributes.ParticipantId} has loaded!`)
                            res(participant.id);
                        })
                        .catch((err) => {
                            print(`participant ${participant.attributes.ParticipantId} failed to load map`)
                            rej(err)
                        });
                });
            }),
        );
    }

    /**
     * Start a new match.
     * @param matchHost The participant that is hosting the match.
     */
    public async StartMatch()
    {
        assert(this.GetReadyParticipants().size() > 0, "there are no ready participants");

        this.matchPhase = MatchPhase.Starting;

        return this.RequestParticipantsLoadMap().then(async () =>
        {
            for (const participant of this.GetReadyParticipants())
                participant.instance.SetAttribute("MatchId", this.matchId);

            this.matchPhase = MatchPhase.InProgress;
            // Get map, arena, and call Predict on respawnCharacter
            // and force them to spawn as Gio

            let map: MapNamespace.MapComponent;
            {
                this.matchFolder.Parent = Dependency<QuarrelGame>().MatchContainer;

                const _map = Make("Folder", {
                    Parent: this.matchFolder,
                    Name: `MapContainer-${this.matchId}`,
                    Children: [
                        Make("Folder", {
                            Name: "CharacterContainer",
                        }),
                    ],
                });

                _map.SetAttribute("MapId", this.matchSettings.Map);
                map = Dependency<Components>().addComponent(
                    _map,
                    MapNamespace.MapComponent,
                );
            }

            const randomStart = ArenaTypeFlags["ALLOW_2D"]; /* [
                ArenaTypeFlags[ "ALLOW_3D" ],
                ArenaTypeFlags[ "ALLOW_3D" ],
            ][ math.random(1, 2) - 1 ];*/

            /* load characters asynchronously but have them converge */
            const participantArray = [...this.GetReadyParticipants()];
            return new Promise((res, rej) => 
                Promise.allSettled(participantArray.map(async (participant) => 
                {
                    print("loading participant:", participant.instance.Name);
                    const startType = randomStart === ArenaTypeFlags["ALLOW_2D"] ? MapNamespace.ArenaType["2D"] : MapNamespace.ArenaType["3D"];
                    return await this.RespawnParticipant(participant, startType, 0)
                            .tap(() => warn(participant, participant.entity, startType, 0))
                            .then(() => Events.MatchStarted.fire(participant.instance, this.matchId, this.Serialize(participant)))
                }))
                .then((statuses) => statuses.filter((status) => status !== Promise.Status.Resolved)).then((failedPromises) =>
                {
                    const listSize = failedPromises.size();
                    if (listSize > 0)

                        warn(
                            `${
                                failedPromises.map((_, i) => participantArray[i].instance.Name)
                                .reduce((a,v,i) => participantArray[i + 1] ? `${v}, ` : `${v}`, `Client${listSize > 1 ? "s" : ""} `)} failed to load.`)

                    this.Starting.Fire();

                    return res(Promise.fromEvent(this.Ended).finally(
                        () => (this.matchPhase = MatchPhase.Ending),
                    ));
                }))
        }).then(() => print("match started"));
    }

    public Serialize(perspective: Participant)
    {
        return this.MatchService.SerializeMatch(perspective, this.matchId);
    }

    /**
     * Gets the map that the match is taking place in.
     *
     * 📝 This can only be executed whilst a match is currently
     * ongoing.
     * If you wish to get the map that the match will
     * take place in, then look at {@link Match.GetMatchSettings GetMatchSettings}.
     */
    public GetMap(): MapNamespace.MapComponent
    {
        const mapFolder = this.matchFolder.FindFirstChild(
            `MapContainer-${this.matchId}`,
        ) as Folder;
        assert(mapFolder, `map folder for match ${this.matchId} does not exist.`);

        const mapComponent = Dependency<Components>().getComponent(
            mapFolder,
            MapNamespace.MapComponent,
        );
        assert(
            mapComponent,
            `map component for match ${this.matchId} does not exist.`,
        );

        return mapComponent;
    }

    /**
     * Retrieve the participants in the match.
     * @returns The participants in the match.
     */
    public GetParticipants(): Set<Participant>
    {
        return new Set([ ...this.participants ]);
    }

    /**
     * Retrieve the ready participants in the match.
     * @returns The ready participants in the match.
     */
    public GetReadyParticipants(): Set<Participant>
    {
        return new Set([ ...this.participants_ready ]);
    }

    /**
     * @param participant The participant to respawn.
     * @param arenaType The type of arena to respawn the participant in.
     * @param arenaIndex The index of the arena to respawn the participant in.
     * @param combatMode The combat mode to set the participant to.
     */
    public async RespawnParticipant(
        participant: Participant,
        arenaType: MapNamespace.ArenaType = MapNamespace.ArenaType["2D"],
        arenaIndex = 0,
        combatMode: Client.CombatMode = Client.CombatMode.TwoDimensional,
    )
    {
        const map = this.GetMap();
        return participant
            .LoadCombatant({
                characterId: participant.attributes.SelectedCharacter,
                matchId: this.matchId,
            })
            .then((combatant) =>
            {
                map.MoveEntityToArena(arenaType, arenaIndex, combatant);
                print("map locations:", [...map.GetEntityLocations()].map(([e,k]) => [e.attributes.EntityId, k]))

                Events.ArenaChanged(participant.instance, map.attributes.MapId,  arenaIndex);

                Events.MatchParticipantRespawned.fire(
                    participant.instance,
                    combatant.instance,
                );

                Events.SetCombatMode.fire(participant.instance, combatMode);

                return combatant
            })
            .catch(warn)
            .finally(() => print("done respawning participant", participant?.instance.Name));
    }

    public async RespawnTrainingDummy(caller: Participant)
    {
        // FIXME: add authority for this
        const {Training = {} as TrainingAttributes} = (this.matchSettings)
        const {CharacterId: DummyCharacterId} = Training.TrainingDummy;
        const Components = Dependency<Components>();
        assert (Training?.Enabled, "training is not enabled");
        assert (DummyCharacterId, "training dummy has no character id");
        assert(caller.entity, "caller has no entity");
        const callerEntityLocation = this.GetMap().GetEntityLocation(caller.entity);
        assert(callerEntityLocation, "could not find caller entity location");
        
        if (this.trainingDummy)
        {
            this.Died.Fire(this.trainingDummy)
            Components.removeComponent<Entity>(this.trainingDummy.instance);
            this.trainingDummy.instance.Destroy();
        }

        const DummyCharacter = Dependency<CharacterManager>().GetCharacter(DummyCharacterId)
        const DummyCharacterModel = DummyCharacter?.Model.Clone()!;
        DummyCharacterModel.Parent = Workspace.WaitForChild("CharacterContainer");
        assert (DummyCharacter, `training dummy has invalid character id ${DummyCharacterId}`)

        DummyCharacterModel.SetAttribute("CharacterId", DummyCharacterId);
        DummyCharacterModel.SetAttribute("MatchId", this.matchId);
        DummyCharacterModel.SetAttribute("IsServerEntity", true);

        const callerArena = this.GetMap().GetArenaFromIndex(callerEntityLocation.arenaType, callerEntityLocation.arenaIndex);
        assert(callerArena, "caller arena could not be found");

        (this as unknown as Record<string, unknown>).trainingDummy = Dependency<Components>().addComponent<Entity>(DummyCharacterModel);
        this.GetMap().MoveEntityToArena(callerEntityLocation.arenaType, callerEntityLocation.arenaIndex, this.trainingDummy!)
        this.Respawning.Fire(this.trainingDummy!)
        // switch (callerEntityLocation.arenaType)
        // {
        //     case MapNamespace.ArenaType["3D"]:
        //         DummyCharacterModel.PivotTo(callerArena.config.Origin.Value.add(new Vector3(0, this.trainingDummy.GroundController.GroundOffset + 0.5)));
        //
        //     case MapNamespace.ArenaType["2D"]:
        //         
        //         /* FIXME: this does not work when the training dummy is player 1
        //          * because i never specify where the player 1 spawns let alone
        //          * the question of who is player 1 or player 2
        //          *  
        //          * also the character might float for a sec if their bounding box is high lol:w
        //          */
        //         DummyCharacterModel.PivotTo(
        //             callerArena.config.Origin.Value.add(
        //                 callerArena.config.Axis.Value
        //                 .mul(-callerArena.config.CombatantSpacing.Value)
        //                 .add(new Vector3(0,this.trainingDummy.GroundController.GroundOffset + 0.5))
        //             )
        //         )
        // }

    }

    public GetMatchPhase()
    {
        return this.matchPhase;
    }
}

@Service({})
export class MatchService implements OnStart, OnInit
{
    private readonly ongoingMatches = new Map<string, Match>();

    onInit()
    {
        Functions.SetMatchSettings.setCallback((player, matchSettings) =>
        {
            const thisParticipant = Dependency<QuarrelGame>().GetParticipant(player);
            assert(thisParticipant, `participant for ${player} does not exist.`);

            for (const [ , match ] of this.ongoingMatches)
            {
                if (match.HostIs(thisParticipant))
                {
                    match.SetMatchSettings(matchSettings);

                    return true;
                }
            }

            return false;
        });

        Functions.Ready.setCallback((player) =>
        {
            const thisParticipant = Dependency<QuarrelGame>().GetParticipant(player);
            assert(thisParticipant, `participant for ${player} does not exist.`);
            assert(thisParticipant.attributes.MatchId, `participant ${player} is not in a match.`);

            const currentMatch = this.GetOngoingMatch(thisParticipant.attributes.MatchId);
            assert(currentMatch, `player ${player}'s current match is invalid`);

            return currentMatch.ReadyParticipant(thisParticipant);
        });

        Functions.Unready.setCallback((player) =>
        {
            const thisParticipant = Dependency<QuarrelGame>().GetParticipant(player);
            assert(thisParticipant, `participant for ${player} does not exist.`);
            assert(thisParticipant.attributes.MatchId, `participant ${player} is not in a match.`);

            const currentMatch = this.GetOngoingMatch(thisParticipant.attributes.MatchId);
            assert(currentMatch, `player ${player}'s current match is invalid`);

            return currentMatch.UnreadyParticipant(thisParticipant);
        });

        Functions.CreateMatch.setCallback(
            (player, matchSettings = DefaultMatchSettings) =>
            {
                const thisParticipant = Dependency<QuarrelGame>().GetParticipant(player);
                assert(thisParticipant, `participant for ${player} does not exist.`);
                assert(
                    !thisParticipant.attributes.MatchId || this.GetOngoingMatch(
                                thisParticipant.attributes.MatchId,
                            )?.GetMatchPhase() !== MatchPhase.Ended,
                    "participant is already in a match",
                );

                const newMatch = this.CreateMatch({
                    Participants: [ thisParticipant ],
                    Settings: matchSettings,
                });

                return newMatch.matchId;
            },
        );

        Functions.StartMatch.setCallback((player) =>
        {
            const thisParticipant = Dependency<QuarrelGame>().GetParticipant(player);
            assert(thisParticipant, `participant for ${player} does not exist.`);
            assert(
                thisParticipant.attributes.MatchId,
                "participant is not in a match",
            );

            const ongoingMatch = this.GetOngoingMatch(
                thisParticipant.attributes.MatchId,
            );
            assert(
                ongoingMatch?.HostIs(thisParticipant),
                "participant is not the host of the match",
            );

            ongoingMatch!.StartMatch();
            return true;
        });

        Functions.GetCurrentMatch.setCallback((player) =>
        {
            const thisParticipant = Dependency<QuarrelGame>().GetParticipant(player);
            assert(thisParticipant, `participant for ${player} does not exist`);
            if (!thisParticipant.attributes.MatchId)
                return new Promise<void>((_, rej) => rej("participant does not have a match id")) as never;

            const serializedMatch = this.SerializeMatch(thisParticipant, thisParticipant.attributes.MatchId);
            if (serializedMatch)
                return serializedMatch;

            return new Promise<void>((_, rej) => rej("participant is not in a match")) as never;
        });
    }

    public SerializeMatch(thisParticipant: Participant, matchId: string): SerializedMatchData
    {
        const ongoingMatch = this.GetOngoingMatch(
            matchId,
        );

        assert(ongoingMatch, "no ongoing match");
        if (!thisParticipant.entity)

            return warn(`the current participant (${thisParticipant.instance.Name}) does not have an entity`, thisParticipant) as never;

        const currentMap = ongoingMatch.GetMap();
        const currentLocation = currentMap.GetEntityLocation(
            thisParticipant.entity,
        );

        print([...currentMap.GetEntityLocations()].map(([e,k]) => [e.attributes.EntityId, k]))
        assert(currentLocation, `participant is not in an arena.`);

        const matchParticipants = ongoingMatch.GetReadyParticipants();
        const matchEntitites = [ ...matchParticipants ].map(
            (participant) => participant.entity as Entity<EntityAttributes>,
        );

        const thisArena = ongoingMatch
            .GetMap()
            .GetArenaFromIndex(
                currentLocation.arenaType,
                currentLocation.arenaIndex,
            )!;

        return {
            Settings: ongoingMatch.GetMatchSettings(),
            Arena: thisArena,
            Participants: [ ...matchParticipants ].map<ParticipantAttributes>(
                (participant) => participant.attributes,
            ),
            State: {
                EntityStates: matchEntitites.map((n) => n.attributes),
                Tick: -1,
                Time: -1,
            },
            Map: ongoingMatch.GetMap().instance,
            Phase: ongoingMatch.GetMatchPhase(),
            MatchId: matchId,
        };
    }

    onStart()
    {}

    /**
     * Creates a new ongoing match with the specified settings.
     *
     * @param matchData The specifications of the match.
     * @returns The ID of the match.
     */
    public CreateMatch(matchData: MatchData)
    {
        const newMatch = new Match(matchData.Participants[0]);
        newMatch.SetMatchSettings(matchData.Settings);
        this.ongoingMatches.set(newMatch.matchId, newMatch);

        matchData.Participants.forEach((participant) => newMatch.AddParticipant(participant));

        return newMatch;
    }

    public GetOngoingMatch(matchId: string)
    {
        return this.ongoingMatches.get(matchId);
    }

    public GetOngoingMatches(): Set<Match>
    {
        return new Set([ ...this.ongoingMatches ].map(([ , match ]) => match));
    }
}
