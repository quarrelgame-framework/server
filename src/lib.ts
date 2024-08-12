import { Dependency } from "@flamework/core"
import type { SchedulerService } from "services/scheduler.service"
export const GetTickRate = () => Dependency<SchedulerService>().GetTickRate();
