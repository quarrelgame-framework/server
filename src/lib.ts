import { Dependency } from "@flamework/core"
import type { SchedulerService } from "@quarrelgame-framework/common"
export const GetTickRate = () => Dependency<SchedulerService>().GetTickRate();
