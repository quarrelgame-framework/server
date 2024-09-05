import { Dependency, Modding, OnInit, OnStart, Service } from "@flamework/core";
import { QuarrelGame } from "./quarrelgame.service";

import { Components } from "@flamework/components";
import { Players } from "@rbxts/services";
import { PhysicsEntity } from "components/physics.component";
import { Functions } from "network";
import { CharacterManager, Hitbox, Entity, Character, EntityAttributes, Skill, validateGroundedState } from "@quarrelgame-framework/common"
import { CommandNormal, Input, isCommandNormal, isInput, Motion, MotionInput, validateMotion, stringifyMotionInput } from "@quarrelgame-framework/common"
import { ConvertPercentageToNumber, EntityState, getEnumValues, HitboxRegion, HitResult, OnHit } from "@quarrelgame-framework/common"
import { EffectsService } from "services/effects.service";

@Service({
    loadOrder: 1,
})
export class CombatService implements OnStart, OnInit
{
    public readonly HitstopFrames: number = 12;

    private readonly lastSkillData = new Map<defined, {
        lastSkillTime?: number;
        lastSkillHitResult?: HitResult;
    }>();

    constructor(private readonly quarrelGame: QuarrelGame, private readonly CharacterManager: CharacterManager, private readonly effectsService: EffectsService)
    {}

    onInit()
    {
        Modding.onListenerAdded<OnHit>((l) => Hitbox.ActiveHitbox.onHitListeners.add(l));
        Modding.onListenerRemoved<OnHit>((l) => Hitbox.ActiveHitbox.onHitListeners.delete(l));
    }

    onStart()
    {
        // setup events
        const components = Dependency<Components>();
        Functions.KnockbackTest.setCallback(async (player) =>
        {
            assert(player.Character, "player has not spawned");
            assert(this.quarrelGame.IsParticipant(player), "player is not a participant");

            const participantItem = this.quarrelGame.GetParticipantFromCharacter(player.Character)!;
            const physicsEntity = components.getComponent<PhysicsEntity>(participantItem.character!);
            const normalEntity = components.getComponent<Entity>(participantItem.character!);

            assert(physicsEntity, "physics entity not found");

            const direction = physicsEntity.CFrame()
                .add(
                    physicsEntity.Backward()
                        .mul(new Vector3(1, 0, 1)),
                ).Position
                .mul(5);

            normalEntity?.LockRotation();
            const newImpulse = physicsEntity.ConstantImpulse(
                direction,
                100,
            );

            const knockbackTrail = this.effectsService.GenerateKnockbackTrail(player.Character);
            physicsEntity.RotateFacing(direction.mul(-1));
            newImpulse.Apply();

            return true;
        });

        Functions.TrailTest.setCallback(async (player) =>
        {
            assert(player.Character, "player has not spawned");
            assert(this.quarrelGame.IsParticipant(player), "player is not a participant");

            const knockbackTrail = this.effectsService.GenerateKnockbackTrail(player.Character);

            return true;
        });


        const handleInput = (player: Player, input: Input | CommandNormal | MotionInput) =>
        {
            print("hhh");
            assert(this.quarrelGame.IsParticipant(player), "player is not a participant");
            assert(player.Character, "character is not defined");

            let combatantComponent: Entity<EntityAttributes>;
            let selectedCharacter: Character.Character;
            assert(combatantComponent = this.GetEntity(player.Character) as never, "entity component not found");
            assert(selectedCharacter = this.GetSelectedCharacterFromCharacter(combatantComponent) as never, "selected character not found");

            const { lastSkillHitResult, lastSkillTime } = this.lastSkillData.get(combatantComponent)
                ?? this.lastSkillData.set(combatantComponent, {}).get(combatantComponent)!;

            if (isInput(input))
                input = [ Motion.Neutral, input ];

            const viableMotions = validateMotion(input, selectedCharacter).map(([_, maybeSkill]) => typeIs(maybeSkill, "function") ? maybeSkill(combatantComponent) : maybeSkill).filter((maybeSkill) => validateGroundedState(maybeSkill, combatantComponent));
            const attackSkill = viableMotions[0]
            if (attackSkill)
            {
                const attackFrameData = attackSkill.FrameData;
                const previousSkillId = combatantComponent.attributes.PreviousSkill;
                const attackDidLand = lastSkillHitResult !== HitResult.Whiffed;

                let skillDoesGatling = false;

                if (previousSkillId)
                {
                    const previousSkill = Skill.GetCachedSkill(previousSkillId);

                    skillDoesGatling = !!(
                        previousSkill?.GatlingsInto.has(attackSkill.Id)
                    );
                }

                const isRecovering = combatantComponent.IsState(EntityState.Recovery);
                print("is recovering:", isRecovering);
                if ((isRecovering && attackDidLand && skillDoesGatling) || !combatantComponent.IsNegative())
                {
                    if (skillDoesGatling)
                    {
                        if (attackDidLand)
                            print("ooh that does gattle fr");
                        else
                            print("attack does gattle, but it didn't land!");
                    }
                    else
                    {
                        print("doesn't gattle, but not negative!");
                    }

                    const currentLastSkillTime = os.clock();
                    combatantComponent.SetHitstop(-1);
                    this.lastSkillData.set(combatantComponent, {
                        lastSkillTime: currentLastSkillTime,
                        lastSkillHitResult,
                    });

                    print("executing frame data")
                    return this.executeFrameData(attackFrameData, combatantComponent, attackSkill, currentLastSkillTime);
                }
                else if (!skillDoesGatling)
                {
                    print(
                        `nah that dont gattle (${skillDoesGatling}):`,
                        previousSkillId ? Skill.GetCachedSkill(previousSkillId)?.GatlingsInto ?? "invalid skill id" : "no skill id",
                    );
                }


                return Promise.resolve(false);
            }

            return Promise.resolve(false);
        };

        Functions.SubmitMotionInput.setCallback(handleInput);

        // read input enums and setup events
        getEnumValues(Input).forEach(([ inputName, inputTranslation ]) =>
        {
            if (!(`${inputTranslation}` as Input in Functions))
            {
                warn(`${inputTranslation} is not a valid ServerFunction.`);

                return;
            }

            Functions[`${inputTranslation}` as Input].setCallback((player) => handleInput(player, inputTranslation));
        });
    }

    private executeFrameData<
        T extends EntityAttributes,
    >(attackFrameData: Skill.FrameData, attackerEntity: Entity<T>, attackSkill: Skill.Skill, lastSkillTime: number)
    {
        return attackFrameData.Execute(attackerEntity, attackSkill).then(async (hitData) =>
        {
            print("hit data received:", hitData);
            if (await hitData.hitResult !== HitResult.Whiffed)
            {
                print("omg they didnt whiff!");
                const hitstopFrames = Dependency<CombatService>().HitstopFrames;
                hitData.attacker.SetHitstop(hitstopFrames);
                hitData.attacked?.SetHitstop(hitstopFrames);
            }

            this.lastSkillData.set(attackerEntity, {
                lastSkillHitResult: await hitData.hitResult,
                lastSkillTime,
            });

            return true;
        }) ?? Promise.resolve(false);
    }

    public GetEntity<T extends Model>(instance: T)
    {
        const components = Dependency<Components>();

        return components.getComponent(instance, Entity) ?? components.getComponent(instance, Entity);
    }

    public GetSelectedCharacterFromCharacter<T extends EntityAttributes>(instance: Model | Entity<T>)
    {
        const characterId = Players.GetPlayers().filter((n) =>
        {
            print("1:", n, n.GetAttributes());

            return !!n.GetAttribute("SelectedCharacter");
        })
            .find((n) =>
            {
                print("2:", n);

                return !!(typeIs(instance, "Instance") ? instance : instance.instance);
            })
            ?.GetAttribute("SelectedCharacter");

        assert(characterId, `character ${characterId} is not found`);

        return this.CharacterManager.GetCharacter(characterId as string);
    }

    public ApplyImpulse(impulseTarget: Model)
    {
    }
}

