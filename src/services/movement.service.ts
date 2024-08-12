import { Dependency, OnInit, OnStart, Service } from "@flamework/core";
import { QuarrelGame } from "./quarrelgame.service";

@Service({})
export class MovementService implements OnStart, OnInit
{
    public readonly JumpStartFrames = 14;

    public readonly JumpEndFrames = 2;
    
    constructor(private readonly quarrelGame: QuarrelGame)
    {}

    onInit()
    {
    }

    onStart()
    {
        const fetchEntityFromPlayer = (player: Player) =>
        {
            assert(this.quarrelGame.IsParticipant(player), `player ${player} is not a participant`);
            assert(player.Character, "player is not defined");

            const participantPlayer = this.quarrelGame.GetParticipantFromCharacter(player.Character)!;
            assert(participantPlayer.entity, "state entity not defined");

            return participantPlayer.entity;
        };
    }
}
