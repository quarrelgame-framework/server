import { Dependency, OnInit, OnStart, Service } from "@flamework/core";
import { QuarrelGame } from "./quarrelgame.service";
import { Functions } from "network";
import { EntityState } from "@quarrelgame-framework/common";

@Service({})
export class MovementService implements OnStart, OnInit
{
    public readonly JumpStartFrames = 14;

    public readonly JumpEndFrames = 2;
    
    constructor(private readonly quarrelGame: QuarrelGame)
    {}

    onInit()
    {
        const fetchEntityFromPlayer = (player: Player) =>
        {
            assert(this.quarrelGame.IsParticipant(player), `player ${player} is not a participant`);
            assert(player.Character, "player is not defined");

            const participantPlayer = this.quarrelGame.GetParticipantFromCharacter(player.Character)!;
            assert(participantPlayer.entity, "state entity not defined");

            return participantPlayer.entity;
        };

        Functions.Crouch.setCallback((plr, crouchState) => 
        {
            const entity = fetchEntityFromPlayer(plr);
            assert(entity, `could not find entity from player ${plr.Name}`);

            entity.Crouch(crouchState === EntityState.Crouch);
            return true;
        })

        /* generally, this isn't _supposed_ to be used but it's fine */
        Functions.Jump.setCallback((plr) => {
            const entity = fetchEntityFromPlayer(plr);
            entity.Jump();

            return true;
        });
    }

    onStart()
    {
    }
}
