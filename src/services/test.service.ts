import { Components } from "@flamework/components";
import { Dependency, OnInit, OnStart, Service } from "@flamework/core";
import { Players, RunService, Workspace } from "@rbxts/services";
import { Entity } from "@quarrelgame-framework/common";
import { Participant } from "components/participant.component";
import { Functions } from "network";
import { ArenaTypeFlags, MatchService } from "./matchservice.service";
import { OnParticipantAdded, QuarrelGame } from "./quarrelgame.service";

import Character from "@quarrelgame-framework/common";

@Service({})
export class TestService implements OnStart, OnInit
{
    private readonly testParticipant: Promise<Participant> = new Promise(
        (res) =>
        {
            Players.PlayerAdded.Once((player) => res(Dependency<Components>().waitForComponent(player, Participant)));
        },
    );

    onInit()
    {
        this.deployJaneModel();
        Functions.MatchTest.setCallback((player) => !!this.tryMatchTest());
    }

    public deployJaneModel()
    {
        if (true)
            return false;
        /*
        const janeModel = Character.CharacterModel.jane.Clone();
        janeModel.SetAttribute("CharacterId", "Vannagio");
        janeModel.PivotTo(new CFrame(Vector3.FromAxis(Enum.Axis.Z).mul(5)));

        const janeCombatant = Dependency<Components>().addComponent(
            janeModel,
            Entity.Combatant,
        );
        const janeRotator = Dependency<Components>().addComponent(
            janeModel,
            Entity.EntityRotator,
        );
        RunService.Stepped.Connect(() =>
        {
            janeModel.Humanoid.WalkSpeed = 0;
            const targetPlayer = Players.GetPlayers()[0]?.Character;
            if (targetPlayer)
            {
                janeModel.Humanoid.Move(targetPlayer.GetPivot().LookVector);
                janeRotator.RotateTowards(targetPlayer.PrimaryPart);
            }
        });
        */
    }

    public tryMatchTest()
    {
        const matchService = Dependency<MatchService>();
        const quarrelGame = Dependency<QuarrelGame>();

        this.testParticipant.then(() =>
        {
            const match = matchService.CreateMatch({
                Participants: quarrelGame.GetAllParticipants(),
                Settings: {
                    Map: "happyhome",
                    ArenaType: ArenaTypeFlags.ALLOW_2D,
                },
            });

            match.Ready.Once(() => {
                if (match)
                    match.StartMatch();
            });
        });

        return true;
    }

    onStart()
    {}
}
