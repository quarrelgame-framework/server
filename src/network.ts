import { QuarrelEvents, QuarrelFunctions } from "@quarrelgame-framework/common";

export const Events = QuarrelEvents.createServer({disableIncomingGuards: false});
export const Functions = QuarrelFunctions.createServer({});
